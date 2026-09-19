// Exercise standalone draft controls and partial clarification submission behavior.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, test } from "node:test";
import { compileBlueprint } from "../generation/compiler.mjs";

const globals = Object.fromEntries(["document", "EventSource", "fetch", "localStorage"].map((key) => [key, globalThis[key]]));
const directories = [];
const timers = [];
const realTimeout = globalThis.setTimeout;
afterEach(async () => {
    timers.splice(0).forEach(clearTimeout);
    globalThis.setTimeout = realTimeout;
    Object.assign(globalThis, globals);
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});
const tick = () => new Promise((resolve) => setImmediate(resolve));
const realNow = Date.now;
let resolveSelector = () => null;
afterEach(() => { Date.now = realNow; resolveSelector = () => null; });

function element() {
    const listeners = new Map(), selectors = new Map();
    let html = "", markers = [];
    return {
        dataset: {}, value: "", hidden: false, disabled: false, scrollTop: 0, renders: 0,
        classList: { toggle() {} },
        removeAttribute(name) { delete this[name]; },
        get innerHTML() { return html + [...selectors.values()].map((child) => child.innerHTML).join(""); },
        set innerHTML(value) {
            this.renders++;
            selectors.clear();
            html = value;
            markers = Array.from(value.matchAll(/data-clarify-idx="(\d+)"/g), (match) => {
                const button = element();
                button.dataset.clarifyIdx = match[1];
                return button;
            });
        },
        addEventListener(type, handler) { listeners.set(type, handler); },
        emit(type, event = {}) { return listeners.get(type)?.(event); },
        focus() { globalThis.document.activeElement = this; },
        querySelector(selector) {
            const found = resolveSelector(selector);
            if (found) return found;
            if (!selectors.has(selector)) selectors.set(selector, element());
            return selectors.get(selector);
        },
        querySelectorAll(selector) { return selector === "[data-clarify-idx]" ? [...markers, ...[...selectors.values()].flatMap((child) => child.querySelectorAll(selector))] : []; },
        insertAdjacentHTML(_position, value) { this.innerHTML += value; },
    };
}

async function fixture() {
    let time = 100;
    Date.now = () => time;
    const polls = [];
    globalThis.setTimeout = (...args) => {
        const timer = realTimeout(...args);
        timers.push(timer);
        if (args[1] === 2000) polls.push({ timer, callback: args[0] });
        return timer;
    };
    const elements = new Map(), values = new Map(), posts = [];
    const get = (id) => {
        if (!elements.has(id)) elements.set(id, element());
        return elements.get(id);
    };
    resolveSelector = (selector) => selector.startsWith("#") ? get(selector.slice(1))
        : selector === ".artifact-viewer-clarify-banner" ? get("clarification-banner") : null;
    globalThis.document = { documentElement: { dataset: {} }, getElementById: get };
    globalThis.localStorage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
    let events;
    globalThis.EventSource = class { constructor() { events = this; } };
    const pipeline = compileBlueprint({ pipeline: [{ id: "specify" }, { id: "plan" }, { id: "constitution" }] },
        { extensionId: "clarification-ui", displayName: "Test", description: "Isolated renderer fixture" },
        { userProvidesSlug: true, multiInstance: true });
    pipeline.runtime.multiInstance = true;
    const [specify, plan, constitution] = pipeline.pipeline.steps;
    const snapshot = {
        clarificationScope: "isolated-workspace-canvas",
        pipeline, setup: { ready: true }, selectedItemId: "alpha",
        projectArtifacts: { constitution: { state: "ready", ready: true, viewable: true, path: constitution.artifact.pathTemplate } },
        items: ["alpha", "beta"].map((id) => ({
            id, slug: id, label: id, latestPhase: plan.instanceKey, phases: {
                [specify.instanceKey]: { artifact: `specs/${id}/spec.md` },
                [plan.instanceKey]: { artifact: `specs/${id}/plan.md` },
            },
        })),
    };
    let send = async (input) => ({ ok: true, phase: input.phase, artifact: input.artifact });
    let readArtifact = async () => ({ content: "# Artifact\n[NEEDS CLARIFICATION: Which <scope>?]\n\n[NEEDS CLARIFICATION: Tests?]" });
    globalThis.fetch = async (url, options) => {
        let result;
        if (options) {
            const input = JSON.parse(options.body);
            posts.push({ url, input });
            result = await send(input);
        } else result = url.startsWith("/api/artifact") ? await readArtifact(url) : {
            ...structuredClone(snapshot), items: snapshot.items.map((item) => ({ ...structuredClone(item),
                resultTags: [...new Set(Object.values(item.phases)
                    .filter((phase) => phase.review?.state === "reviewed" && !phase.review.error && !(phase.clarificationCount > 0))
                    .map((phase) => snapshot.artifactReview?.labels[Number(phase.review.statusId?.replace("result-", "")) - 1])
                    .filter(Boolean))],
            })),
        };
        return { ok: true, json: async () => result };
    };
    const directory = join(dirname(fileURLToPath(import.meta.url)), `.clarification-ui-${randomUUID()}`);
    directories.push(directory);
    await mkdir(directory);
    await Promise.all(["app.js", "markdown.mjs", "clarifications.mjs", "clarification-controls.mjs", "command-views.mjs", "workflow-slug.mjs"].map((name) => (
        copyFile(new URL(["markdown.mjs", "clarifications.mjs", "clarification-controls.mjs"].includes(name) ? `../shared-workflow-ui/${name}` : `../generation/generated-canvas-template/ui/${name}`, import.meta.url), join(directory, name === "app.js" ? "app.mjs" : name))
    )));
    await import(pathToFileURL(join(directory, "app.mjs")).href);
    await tick();
    const buttons = () => get("artifact-viewer").querySelectorAll("[data-clarify-idx]");
    const answer = async (text, index = 0) => {
        await buttons()[index].emit("click");
        get("clarification-answer").value = text;
        await get("clarification-answer").emit("input");
        await get("queue-clarification").emit("click");
    };
    const decide = (value) => get("modal-root").querySelector(`[data-answer="${value}"]`).emit("click");
    const select = (id) => get("instance-collection").emit("click", {
        target: { closest: (selector) => selector === "[data-instance]" ? { dataset: { instance: id } } : null },
    });
    return { get, snapshot, specify, plan, constitution, posts, buttons, answer, decide, select,
        poll: async () => { time += 2000; const poll = polls.pop(); assert.ok(poll, "amendment schedules observation polling"); clearTimeout(poll.timer); await poll.callback(); },
        refresh: async () => { events.onmessage(); await tick(); },
        setSend: (callback) => { send = callback; },
        setRead: (callback) => { readArtifact = callback; },
    };
}

test("collection counts use distinct workflow tags while clarification counts remain independent", async () => {
    const f = await fixture();
    f.snapshot.artifactReview = {
        labels: ["Decision made", "Decision deferred", "Decision not made"],
    };
    const [alpha, beta] = f.snapshot.items;
    for (const item of [alpha, beta]) {
        item.phases[f.specify.instanceKey].clarificationCount = 4;
        item.phases[f.plan.instanceKey].clarificationCount = 0;
    }
    alpha.phases[f.plan.instanceKey].review = { state: "reviewed", statusId: "result-1", label: "Decision made" };
    beta.phases[f.plan.instanceKey].review = { state: "pending", label: "Decision made" };
    await f.refresh();
    const summary = () => f.get("instance-collection").innerHTML.match(/<div class="collection-summary"[\s\S]*?<\/div>/)[0];
    assert.match(summary(), />Decision made: 1</);
    assert.match(summary(), />Clarification needed: 2</);
    assert.match(summary(), />Decision not made: 0</);
    assert.doesNotMatch(summary(), />Not determined:/);
    beta.phases[f.plan.instanceKey].review = { state: "reviewed", statusId: "not-determined", label: "Not determined" };
    await f.refresh();
    assert.doesNotMatch(f.get("instance-collection").innerHTML, /Not determined/);
    assert.match(summary(), />Decision deferred: 0</);
    beta.phases[f.plan.instanceKey].review = { state: "reviewed", statusId: "result-3", label: "Decision made" };
    await f.refresh();
    assert.match(summary(), />Decision made: 1</);
    assert.match(summary(), />Decision not made: 1</);
    assert.doesNotMatch(summary(), />Not determined:/);
    beta.phases[f.plan.instanceKey].review = { state: "reviewed", statusId: "invented", label: "Decision made", success: true };
    await f.refresh();
    assert.doesNotMatch(summary(), />Not determined:/);
    beta.phases[f.plan.instanceKey].review = { state: "reviewed", statusId: "result-1", label: "Decision made" };
    await f.refresh();
    assert.match(summary(), />Decision made: 2</);
    assert.match(summary(), />Decision not made: 0</);
    assert.doesNotMatch(summary(), />Not determined:/);
    beta.phases[f.plan.instanceKey].clarificationCount = 1;
    await f.refresh();
    assert.match(summary(), />Decision made: 1</);
    assert.doesNotMatch(summary(), />Not determined:/);
    assert.match(f.get("instance-collection").innerHTML, />Clarification needed<\/span>/);
    beta.phases[f.plan.instanceKey].artifact = null;
    beta.phases[f.plan.instanceKey].clarificationCount = null;
    delete beta.phases[f.plan.instanceKey].review;
    beta.latestPhase = null;
    await f.refresh();
    assert.match(f.get("instance-collection").innerHTML, />Clarification needed<\/span>/);
    assert.doesNotMatch(f.get("instance-collection").innerHTML, />Run Plan<\/span>/);
    await f.get("next-phase").emit("click");
    assert.doesNotMatch(f.get("instance-collection").innerHTML, />Run Plan<\/span>/);
    beta.phases[f.specify.instanceKey].clarificationCount = 0;
    beta.phases[f.specify.instanceKey].hasRun = true;
    await f.refresh();
    assert.match(f.get("instance-collection").innerHTML, />Run Plan<\/span>/);
    assert.equal(f.posts.length, 0);
});

test("unconfigured results show only clarification pills while retaining inline artifact errors and indicators", async () => {
    const f = await fixture();
    const [alpha, beta] = f.snapshot.items;
    alpha.phases[f.specify.instanceKey].clarificationCount = 3;
    alpha.phases[f.plan.instanceKey].clarificationCount = 0;
    alpha.phases[f.plan.instanceKey].hasRun = true;
    beta.phases[f.specify.instanceKey].clarificationCount = 0;
    beta.phases[f.plan.instanceKey] = { artifact: "specs/beta/plan.md", clarificationCount: null, artifactError: "Cannot read <artifact>" };
    await f.refresh();
    const html = f.get("instance-collection").innerHTML;
    assert.match(html, />Clarification needed: 1</);
    assert.match(html, />Clarification needed<\/span>/);
    assert.match(html, /role="status">Cannot read &lt;artifact&gt;<\/span>/);
    assert.doesNotMatch(html, /Artifact ready:|Artifact not ready:|>Run Plan<|>Not determined/);
    assert.equal((html.match(/class="phase-notice"/g) ?? []).length, 2);
    await f.select("beta");
    await f.get("next-phase").emit("click");
    assert.match(f.get("phase-card").innerHTML, /role="status">Cannot read &lt;artifact&gt;<\/span>/);
    assert.doesNotMatch(f.get("phase-card").innerHTML, /class="phase-notice"/);
    await f.select("alpha");
    assert.match(f.get("phase-navigation").innerHTML, /needs-clarification/);
    assert.match(f.get("phase-navigation").innerHTML, /phase-run/);
    f.snapshot.pipeline.runtime.multiInstance = false;
    await f.refresh();
    assert.equal(f.get("instance-collection").hidden, true);
    assert.equal(f.posts.length, 0);
});

test("View artifact stays available before execution and shows inline errors with refresh recovery", async () => {
    const f = await fixture();
    f.snapshot.items[0].phases[f.specify.instanceKey].artifact = null;
    await f.refresh();
    assert.match(f.get("phase-card").innerHTML, /id="view-artifact"[^>]*>View artifact/);
    assert.doesNotMatch(f.get("phase-card").innerHTML, /id="view-artifact"[^>]*disabled/);
    f.get("phase-args").value = "Keep my draft";
    await f.get("phase-args").emit("input", { target: f.get("phase-args") });
    const reads = [];
    f.setRead(async (url) => {
        reads.push(url);
        throw new Error("Artifact <missing>");
    });
    await f.get("view-artifact").emit("click");
    assert.equal(f.get("artifact-viewer").hidden, false);
    assert.equal(reads[0], "/api/artifact?path=specs%2Falpha%2Fspec.md");
    assert.match(f.get("artifact-viewer").innerHTML, /Could not load the artifact/);
    assert.match(f.get("artifact-viewer").innerHTML, /Artifact &lt;missing&gt;/);
    f.setRead(async () => ({ content: "# Newly created artifact" }));
    await f.refresh();
    assert.match(f.get("artifact-viewer").innerHTML, /Newly created artifact/);
    assert.doesNotMatch(f.get("artifact-viewer").innerHTML, /Could not load the artifact/);
    await f.get("close-artifact").emit("click");
    assert.equal(f.get("artifact-viewer").hidden, true);
    assert.equal(f.get("phase-args").value, "Keep my draft");
    assert.equal(f.posts.length, 0);
});

test("View artifact explains unresolved and undeclared outputs without requesting invalid paths", async () => {
    const f = await fixture();
    f.snapshot.items[0].phases[f.specify.instanceKey].artifact = null;
    f.snapshot.items[0].slug = null;
    let reads = 0;
    f.setRead(async () => { reads++; return { content: "# Unexpected request" }; });
    await f.refresh();
    await f.get("view-artifact").emit("click");
    assert.match(f.get("artifact-viewer").innerHTML, /No artifact is available yet/);
    await f.refresh();
    assert.equal(reads, 0);
    await f.get("close-artifact").emit("click");
    delete f.specify.artifact;
    await f.refresh();
    assert.match(f.get("phase-card").innerHTML, /id="view-artifact"/);
    await f.get("view-artifact").emit("click");
    assert.match(f.get("artifact-viewer").innerHTML, /no declared artifact/);
    assert.equal(reads, 0);
    assert.equal(f.posts.length, 0);
});

test("viewer stages, edits and cancels answers without dispatch; Back, workflows and phases isolate drafts", async () => {
    const f = await fixture();
    await f.get("view-artifact").emit("click");
    assert.equal(f.buttons().length, 2);
    await f.buttons()[0].emit("click");
    assert.match(f.get("modal-root").innerHTML, /Which &lt;scope&gt;\?/);
    f.get("clarification-answer").value = "Discard unsaved";
    await f.get("cancel-clarification").emit("click");
    assert.equal(f.get("clarification-banner").hidden, true);
    await f.answer("Alpha only");
    await f.answer("Focused tests", 1);
    assert.equal(f.buttons()[0].textContent, "Edit draft");
    assert.doesNotMatch(f.get("artifact-viewer").innerHTML, /Answered|clarify-pill-answered/);
    assert.equal(f.posts.length, 0, "even answering all markers must not dispatch");
    await f.refresh();
    assert.equal(f.posts.length, 0, "polling must not dispatch");
    await f.get("close-artifact").emit("click");
    await f.get("view-artifact").emit("click");
    assert.equal(f.buttons()[0].title, "Alpha only");
    await f.get("close-artifact").emit("click");
    await f.select("beta");
    await f.get("view-artifact").emit("click");
    assert.equal(f.buttons()[0].textContent, "Clarify");
    await f.answer("Beta only");
    await f.get("close-artifact").emit("click");
    await f.select("alpha");
    await f.get("next-phase").emit("click");
    await f.get("view-artifact").emit("click");
    assert.equal(f.buttons()[0].textContent, "Clarify");
    await f.get("close-artifact").emit("click");
    await f.get("previous-phase").emit("click");
    await f.get("view-artifact").emit("click");
    assert.equal(f.buttons()[0].title, "Alpha only");
    assert.match(f.get("clarification-banner").innerHTML, /Apply answers/);
    await f.get("apply-clarifications").emit("click");
    assert.equal(f.posts.length, 1);
    assert.equal(f.buttons()[0].title, "Alpha only");
});

test("captured amendment survives selection changes and retains concurrent edits until observation", async () => {
    const f = await fixture();
    await f.get("view-artifact").emit("click");
    await f.answer("Initial");
    let release;
    f.setSend(() => new Promise((resolve) => { release = resolve; }));
    const sending = f.get("apply-clarifications").emit("click");
    await tick();
    assert.equal(f.posts.length, 1);
    assert.match(f.get("clarification-banner").innerHTML, /id="apply-clarifications"[^>]*disabled/);
    await f.get("apply-clarifications").emit("click");
    assert.equal(f.posts.length, 1, "transport-in-flight still prevents a duplicate");
    assert.deepEqual(Object.keys(f.posts[0].input), ["phase", "itemId", "artifact", "answers"]);
    assert.equal(f.posts[0].input.phase, f.specify.instanceKey);
    assert.equal(f.posts[0].input.itemId, "alpha");
    assert.equal(f.posts[0].input.artifact, "specs/alpha/spec.md");
    assert.equal(f.posts[0].input.answers[0].answer, "Initial");
    await f.answer("Edited in flight");
    await f.answer("Added in flight", 1);
    await f.get("close-artifact").emit("click");
    await f.select("beta");
    await f.get("view-artifact").emit("click");
    release({ ok: true, phase: f.specify.instanceKey, artifact: "specs/alpha/spec.md" });
    await sending;
    assert.equal(f.buttons()[0].textContent, "Clarify", "alpha completion must not repaint beta");
    await f.get("close-artifact").emit("click");
    await f.select("alpha");
    await f.get("view-artifact").emit("click");
    assert.equal(f.buttons()[0].title, "Edited in flight");
    assert.equal(f.buttons()[1].title, "Added in flight");
    assert.doesNotMatch(f.get("clarification-banner").innerHTML, /id="apply-clarifications"[^>]*disabled|data-draft-refresh|Refresh artifact/);
    f.setSend(async (input) => ({ ok: true, phase: input.phase, artifact: input.artifact }));
    await f.get("apply-clarifications").emit("click");
    assert.equal(f.posts.length, 2, "artifact observation never locks out a follow-up submission");
    assert.equal(f.posts[1].input.answers[0].answer, "Edited in flight");
});

test("an insufficient answer stays editable and can be reapplied before the observation timeout", async () => {
    const f = await fixture();
    await f.get("view-artifact").emit("click");
    await f.answer("Core");
    await f.get("apply-clarifications").emit("click");
    f.setRead(async () => ({ content: "# Artifact\n[NEEDS CLARIFICATION: Which <scope>?]\nPlease name the included features.\n\n[NEEDS CLARIFICATION: Tests?]" }));
    await f.poll();
    assert.equal(f.buttons()[0].textContent, "Edit draft");
    await f.answer("Include intake and research; exclude implementation.");
    assert.doesNotMatch(f.get("clarification-banner").innerHTML, /id="apply-clarifications"[^>]*disabled|data-draft-refresh/);
    await f.get("apply-clarifications").emit("click");
    assert.equal(f.posts.length, 2);
    assert.deepEqual(f.posts[1].input.answers, [{
        question: "Which <scope>?", marker: "[NEEDS CLARIFICATION: Which <scope>?]",
        answer: "Include intake and research; exclude implementation.",
    }]);
    assert.equal(f.buttons()[1].textContent, "Clarify", "unanswered questions remain open");
});

test("failed/gated sends keep answers and Constitution dispatch stays project-scoped", async () => {
    const f = await fixture();
    await f.get("view-constitution").emit("click");
    await f.answer("Project testing rules");
    for (const response of [
        new Error("offline"),
        { ok: false, approvalRequired: true },
        { ok: false, code: "setup_required" },
    ]) {
        f.setSend(async () => { if (response instanceof Error) throw response; return response; });
        const submission = f.get("apply-clarifications").emit("click");
        await submission;
        assert.equal(f.buttons()[0].title, "Project testing rules");
        assert.match(f.get("clarification-banner").innerHTML, /preserved/);
    }
    await f.select("beta");
    f.setSend(async (input) => ({ ok: true, phase: input.phase, artifact: input.artifact }));
    const queued = f.get("apply-clarifications").emit("click");
    await queued;
    assert.equal(f.buttons()[0].title, "Project testing rules");
    assert.match(f.get("clarification-banner").innerHTML, /waiting for an artifact update/);
    for (const { url, input } of f.posts) {
        assert.equal(url, "/api/artifact/amend");
        assert.equal(input.phase, f.constitution.instanceKey);
        assert.equal(Object.hasOwn(input, "itemId"), false);
        assert.equal(Object.hasOwn(input, "slug"), false);
    }
});

test("fresh artifact observations update only changed content, preserve scroll/modal drafts and retain unresolved answers", async () => {
    const f = await fixture();
    await f.get("view-artifact").emit("click");
    await f.answer("Core");
    await f.answer("Focused", 1);
    await f.get("apply-clarifications").emit("click");
    assert.equal(f.buttons().length, 2);
    const body = f.get("artifact-viewer").querySelector(".artifact-viewer-body");
    body.scrollTop = 71;
    const renders = body.renders;
    await f.buttons()[0].emit("click");
    f.get("clarification-answer").value = "Unsaved editor draft";
    await f.refresh();
    assert.equal(body.renders, renders, "unchanged reads must not replace the artifact DOM");
    assert.equal(f.get("clarification-answer").value, "Unsaved editor draft");
    f.setRead(async () => ({ content: "# Artifact\nCore is selected.\n\n[NEEDS CLARIFICATION: Tests?]" }));
    await f.poll();
    assert.equal(body.scrollTop, 71);
    assert.equal(f.buttons().length, 1);
    assert.equal(f.buttons()[0].title, "Focused");
    assert.equal(f.get("clarification-answer").value, "Unsaved editor draft");
    await f.get("queue-clarification").emit("click");
    f.setRead(async () => ({ content: "# Artifact\nCore is selected. Focused tests are required." }));
    await f.refresh();
    await f.poll();
    assert.match(f.get("clarification-banner").innerHTML, /Selected markers are no longer visible/);
    assert.match(f.get("clarification-banner").innerHTML, /retained draft.*need review/);
    assert.doesNotMatch(f.get("clarification-banner").innerHTML, /Apply answers/, "unmatched drafts cannot be submitted to another marker");
    assert.equal(f.posts.length, 1);
});

test("late artifact reads cannot replace the newly selected artifact context", async () => {
    const f = await fixture();
    let release;
    f.setRead((url) => url.includes("alpha") ? new Promise((resolve) => { release = resolve; }) : Promise.resolve({ content: "[NEEDS CLARIFICATION: Beta?]" }));
    const first = f.get("view-artifact").emit("click");
    await f.select("beta");
    await f.get("view-artifact").emit("click");
    release({ content: "[NEEDS CLARIFICATION: Alpha?]" });
    await first;
    assert.match(f.get("artifact-viewer").innerHTML, /Beta\?/);
    assert.doesNotMatch(f.get("artifact-viewer").innerHTML, /Alpha\?/);
    assert.equal(f.posts.length, 0);
});

test("a failed request reports to a reopened same-artifact viewer without losing its draft", async () => {
    const f = await fixture();
    await f.get("view-artifact").emit("click");
    await f.answer("Retain me");
    let reject;
    f.setSend(() => new Promise((_resolve, fail) => { reject = fail; }));
    const sending = f.get("apply-clarifications").emit("click");
    await tick();
    await f.get("close-artifact").emit("click");
    await f.get("view-artifact").emit("click");
    reject(new Error("offline"));
    await sending;
    assert.match(f.get("clarification-banner").innerHTML, /offline.*preserved/);
    assert.equal(f.buttons()[0].title, "Retain me");
});
