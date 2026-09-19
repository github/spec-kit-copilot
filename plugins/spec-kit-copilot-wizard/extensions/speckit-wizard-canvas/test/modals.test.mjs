import assert from "node:assert/strict";
import { test } from "node:test";
import {
    artifactContext, clarificationDrafts, flushClarifications, setViewersDeps,
    closeArtifactViewer, openArtifactViewer, openCommandViewer, openCatalogViewer, refreshArtifactViewer,
} from "../ui/modals.js";
import { state } from "../ui/state.js";
import { isPhaseRunning } from "../ui/phase-runtime.js";

test("Wizard browses checklist folders instead of reading them as Markdown files", async (t) => {
    const saved = { document: globalThis.document, fetch: globalThis.fetch };
    const body = { innerHTML: "", querySelectorAll: () => [] };
    const root = {
        innerHTML: "", hidden: true,
        querySelector: (selector) => selector === ".artifact-viewer-body" ? body : null,
    };
    globalThis.document = { getElementById: () => root };
    t.after(() => { globalThis.document = saved.document; globalThis.fetch = saved.fetch; });
    const folder = "specs/alpha/checklists";
    for (const phase of [{ artifactPath: `${folder}/` }, { artifactPath: null, folderPath: folder }]) {
        for (const files of [[], [{ name: "security.md" }, { name: "accessibility.md" }]]) {
            const requests = [];
            globalThis.fetch = async (url) => {
                const parsed = new URL(url, "http://127.0.0.1");
                requests.push(parsed.pathname);
                assert.equal(parsed.searchParams.get("p"), folder);
                return { ok: true, json: async () => ({ files }) };
            };
            await openArtifactViewer({ ...phase, title: "Checklist" });
            assert.deepEqual(requests, ["/api/artifact-list"]);
            assert.equal(root.hidden, false);
            assert.match(body.innerHTML, files.length ? /security\.md[\s\S]*accessibility\.md/ : /No <code>\.md<\/code> files/);
        }
    }
});

test("Wizard drafts are artifact-scoped; Apply answers never invokes the phase or clears in-flight edits", async () => {
    state.snapshot = { workspacePath: "wizard-test" };
    const context = artifactContext({ commandName: "speckit.plan", artifactPath: "specs/alpha/plan.md" });
    const mark = { marker: "[NEEDS CLARIFICATION: Scope?]", question: "Scope?" };
    const view = { context, content: mark.marker, marks: [mark] };
    clarificationDrafts.queue(context, mark.question, "Initial", mark.marker);
    let posted;
    setViewersDeps({ postJson: async (url, input) => {
        posted = { url, input };
        clarificationDrafts.queue(context, mark.question, "Newer", mark.marker);
        return { ok: true, phase: context.phase, artifact: context.artifact };
    } });
    assert.equal((await flushClarifications(view)).accepted, true);
    assert.equal(posted.url, "/api/artifact/amend");
    assert.equal(posted.input.answers[0].answer, "Initial");
    assert.equal(clarificationDrafts.list(context)[0].answer, "Newer");
    assert.equal(isPhaseRunning(context.phase), false);
    assert.deepEqual(clarificationDrafts.list({ ...context, artifact: "specs/beta/plan.md" }), []);
    assert.equal((await flushClarifications(view)).accepted, true);
    assert.equal(posted.input.answers[0].answer, "Newer", "edited drafts can be reapplied without waiting for marker removal");
});

test("Wizard failed sends retain drafts and never set phase running or submitted state", async () => {
    const context = { scope: "failed-wizard", phase: "speckit.constitution", artifact: ".specify/memory/constitution.md" };
    const mark = { marker: "[NEEDS CLARIFICATION: Testing?]", question: "Testing?" };
    const view = { context, content: mark.marker, marks: [mark] };
    clarificationDrafts.queue(context, mark.question, "Required", mark.marker);
    setViewersDeps({ postJson: async () => { throw new Error("offline"); } });
    await assert.rejects(flushClarifications(view), /offline/);
    assert.equal(clarificationDrafts.list(context)[0].answer, "Required");
    assert.equal(isPhaseRunning(context.phase), false);
    assert.equal(clarificationDrafts.isPending(context), false);
});

for (const viewer of ["command", "catalog"]) {
    for (const pendingRead of ["initial", "refresh", "failed refresh"]) {
        test(`${viewer} overlay survives a late artifact ${pendingRead} without losing drafts or submission observation`, async (t) => {
            const saved = { document: globalThis.document, fetch: globalThis.fetch, snapshot: state.snapshot };
            const element = () => ({
                innerHTML: "", hidden: false, scrollTop: 0,
                querySelector: () => null, querySelectorAll: () => [], addEventListener() {},
            });
            const root = element(), body = element(), banner = element();
            root.querySelector = (selector) => ({
                ".artifact-viewer-body": body,
                ".artifact-viewer-clarify-banner": banner,
            })[selector] ?? null;
            globalThis.document = { getElementById: () => root };
            state.snapshot = { workspacePath: `overlay-${viewer}-${pendingRead}` };
            t.after(async () => {
                await closeArtifactViewer();
                globalThis.document = saved.document;
                globalThis.fetch = saved.fetch;
                state.snapshot = saved.snapshot;
            });
            const phase = { commandName: "speckit.plan", artifactPath: "specs/alpha/plan.md", title: "Plan" };
            const context = artifactContext(phase);
            const marker = "[NEEDS CLARIFICATION: Scope?]";
            clarificationDrafts.queue(context, "Scope?", "Keep this draft", marker);
            await clarificationDrafts.flush(context, {
                content: marker,
                dispatch: async () => ({ ok: true, phase: context.phase, artifact: context.artifact }),
            });
            let hold = pendingRead === "initial", release, reject, artifactReads = 0;
            const response = (text) => ({ ok: true, text: async () => text });
            globalThis.fetch = async (url) => {
                const parsed = new URL(url, "http://127.0.0.1");
                if (parsed.searchParams.get("p") === phase.artifactPath) {
                    artifactReads++;
                    if (hold) return new Promise((resolve, fail) => { release = resolve; reject = fail; });
                    return response(marker);
                }
                return response(viewer === "command" ? "# Command source" : '{"catalog":"Fixture"}');
            };
            let pending;
            if (pendingRead === "initial") pending = openArtifactViewer(phase);
            else {
                await openArtifactViewer(phase);
                hold = true;
                pending = refreshArtifactViewer();
            }
            assert.equal(typeof release, "function");
            if (viewer === "command") await openCommandViewer("commands/example.md", "Command");
            else await openCatalogViewer("https://example.test/catalog.json", "Catalog");
            const displayed = body.innerHTML;
            assert.match(displayed, viewer === "command" ? /Command source/ : /Fixture/);
            const reads = artifactReads;
            await refreshArtifactViewer();
            assert.equal(artifactReads, reads, "routine refresh must not target a non-artifact overlay");
            if (pendingRead === "failed refresh") reject(new Error("late artifact failure"));
            else release(response("# Late artifact response"));
            await pending;
            assert.equal(body.innerHTML, displayed, "late reads must not repaint the switched overlay");
            assert.equal(clarificationDrafts.list(context)[0].answer, "Keep this draft");
            assert.equal(clarificationDrafts.isPending(context), true, "switching views must preserve submission observation");
        });
    }
}
