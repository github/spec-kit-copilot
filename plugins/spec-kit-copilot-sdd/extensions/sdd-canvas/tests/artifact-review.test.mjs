import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { reviewFreshnessTests } from "../../../../spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/test/review-freshness-fixture.mjs";
import { reviewHttpSecurityTests } from "../../../../spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/test/review-http-security-fixture.mjs";

reviewHttpSecurityTests("sdd");

const require = createRequire(new URL("../../../../spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/ui/markdown-reader/package.json", import.meta.url));
const { JSDOM } = require("jsdom");

async function serviceFixture(run) {
    const domain = await import("../artifact-review.mjs").catch((error) => {
        if (error.code === "ERR_MODULE_NOT_FOUND") assert.fail("T023: SDD primary review service is missing");
        throw error;
    });
    const root = await fs.mkdtemp(join(tmpdir(), "sdd-primary-review-"));
    try {
        await fs.mkdir(join(root, "specs/001-fixture"), { recursive: true });
        await fs.mkdir(join(root, ".specify/memory"), { recursive: true });
        await fs.writeFile(join(root, "specs/001-fixture/spec.md"), "# SDD fixture\n");
        await fs.writeFile(join(root, ".specify/memory/constitution.md"), "# Governance\n");
        const state = { projectRoot: root, prerequisites: { setupRequired: true }, features: [
            { slug: "001-fixture", stages: { specify: { exists: true, done: true } } },
        ] };
        const service = domain.createSddReviewService({ workspacePath: root, instanceId: "sdd-fixture", getState: async () => state });
        await run({ root, state, service });
    } finally { await fs.rm(root, { recursive: true, force: true }); }
}

test("SDD reviews a primary artifact even when stage execution is gated", () => serviceFixture(async ({ service, state }) => {
    const before = structuredClone(state);
    const opened = await service.open({ feature: "001-fixture", stage: "specify" });
    const document = await service.content(opened.contextId, opened.primaryArtifactId);
    assert.equal(document.content, "# SDD fixture\n");
    assert.equal(document.artifact.relativePath, "specs/001-fixture/spec.md");
    assert.match(document.revision, /^sha256:[a-f0-9]{64}$/);
    assert.deepEqual(state, before);
}));

test("SDD constitution review is project scoped and does not require a feature", () => serviceFixture(async ({ service }) => {
    const opened = await service.open({ stage: "constitution" });
    const document = await service.content(opened.contextId, opened.primaryArtifactId);
    assert.equal(document.artifact.relativePath, ".specify/memory/constitution.md");
    assert.equal(document.content, "# Governance\n");
}));

test("SDD rejects unknown features and keeps artifact IDs inside their context", () => serviceFixture(async ({ service, state }) => {
    await assert.rejects(service.open({ feature: "../escape", stage: "specify" }), { code: "artifact_unavailable" });
    const opened = await service.open({ feature: "001-fixture", stage: "specify" });
    const other = await service.open({ stage: "constitution" });
    await assert.rejects(service.content(other.contextId, opened.primaryArtifactId), { code: "artifact_unavailable" });
    state.features = [];
    await assert.rejects(service.content(opened.contextId, opened.primaryArtifactId), { code: "invalid_context" });
}));

test("SDD uses exact-byte revisions and reports a deleted primary artifact", () => serviceFixture(async ({ service, root }) => {
    const opened = await service.open({ feature: "001-fixture", stage: "specify" });
    const document = await service.content(opened.contextId, opened.primaryArtifactId);
    await fs.writeFile(join(root, "specs/001-fixture/spec.md"), "# Changed\n");
    await assert.rejects(service.content(opened.contextId, opened.primaryArtifactId, { expectedRevision: document.revision }), { code: "changed_source" });
    await fs.rm(join(root, "specs/001-fixture/spec.md"));
    await assert.rejects(service.content(opened.contextId, opened.primaryArtifactId), { code: "artifact_unavailable" });
}));

test("SDD adapter mounts in the current artifact view, keeps capability, and returns focus", async () => {
    const adapter = await import("../ui/artifact-review.js").catch((error) => {
        if (error.code === "ERR_MODULE_NOT_FOUND") assert.fail("T023: SDD reader adapter is missing");
        throw error;
    });
    const dom = new JSDOM('<button id="trigger">Specify</button><div id="scroll"><div id="reader"></div></div>', { url: "http://127.0.0.1:32101/?cap=fixture-cap" });
    const trigger = dom.window.document.getElementById("trigger");
    const container = dom.window.document.getElementById("reader");
    trigger.focus();
    const artifact = { id: "artifact_sdd", relativePath: "specs/001-fixture/spec.md", label: "Specification", role: "primary", availability: "available", suffix: ".md" };
    let disposed = 0;
    let mounted;
    const requests = [];
    const review = adapter.createArtifactReview({
        container, scrollElement: container.parentElement, readerId: "sdd-fixture",
        mount: (_element, options) => { mounted = options; return { update() {}, unmount() { disposed++; } }; },
        fetch: async (input, options) => {
            const url = new URL(input);
            requests.push({ cap: url.searchParams.get("cap"), method: options?.method ?? "GET" });
            const data = url.pathname.endsWith("/context")
                ? { contextId: "ctx_sdd", generation: 1, primaryArtifactId: artifact.id, items: [artifact] }
                : { artifact, content: "# SDD\n", revision: `sha256:${"b".repeat(64)}`, byteSize: 6, sourceKind: "working-tree" };
            return { ok: true, json: async () => ({ ok: true, data }) };
        },
    });
    try {
        await review.open({ feature: "001-fixture", stage: "specify" });
        assert.equal(mounted.document.artifact.id, artifact.id);
        assert.deepEqual(requests, [{ cap: "fixture-cap", method: "GET" }, { cap: "fixture-cap", method: "GET" }]);
        review.close();
        review.close();
        assert.equal(disposed, 1);
        assert.equal(dom.window.document.activeElement, trigger);
    } finally { review.close(); dom.window.close(); }
});

test("SDD discovery includes supporting Markdown, checklists, contracts, and constitution only in scope", () => serviceFixture(async ({ root, service }) => {
    await fs.mkdir(join(root, "specs/001-fixture/checklists"), { recursive: true });
    await fs.mkdir(join(root, "specs/001-fixture/contracts"), { recursive: true });
    await fs.mkdir(join(root, "specs/002-other"), { recursive: true });
    const supporting = ["research.md", "data-model.md", "custom.markdown", "checklists/requirements.md", "contracts/api.md"];
    for (const file of supporting) await fs.writeFile(join(root, "specs/001-fixture", file), "# Supporting\n");
    await fs.writeFile(join(root, "specs/002-other/private.md"), "Other feature");
    const opened = await service.open({ feature: "001-fixture", stage: "specify" });
    const paths = opened.items.map((entry) => entry.relativePath);
    for (const file of supporting) assert.ok(paths.includes(`specs/001-fixture/${file}`), `Missing scoped artifact ${file}`);
    assert.ok(paths.includes(".specify/memory/constitution.md"));
    assert.ok(!paths.includes("specs/002-other/private.md"));
    const expected = opened.items.find((entry) => entry.relativePath.endsWith("/plan.md"));
    assert.equal(expected?.availability, "expected");
    await assert.rejects(service.content(opened.contextId, expected.id), { code: "artifact_unavailable" });
}));

test("SDD discovery pages supporting files without duplicates or a workflow transition", () => serviceFixture(async ({ root, service, state }) => {
    for (let index = 0; index < 205; index++) await fs.writeFile(join(root, `specs/001-fixture/note-${String(index).padStart(3, "0")}.md`), "# Note\n");
    const before = structuredClone(state);
    const opened = await service.open({ feature: "001-fixture", stage: "specify" });
    assert.equal(opened.items.length, 200);
    assert.ok(opened.nextCursor);
    const next = await service.list(opened.contextId, { cursor: opened.nextCursor });
    const all = [...opened.items, ...next.items];
    assert.equal(all.filter((entry) => /\/note-/.test(entry.relativePath)).length, 205);
    assert.equal(new Set(all.map((entry) => entry.id)).size, all.length);
    assert.equal(next.nextCursor, null);
    assert.deepEqual(state, before);
}));

test("SDD resolves only revision-validated safe Markdown references", () => serviceFixture(async ({ root, service }) => {
    await fs.writeFile(join(root, "specs/001-fixture/research.md"), "# Research\n");
    const opened = await service.open({ feature: "001-fixture", stage: "specify" });
    const source = await service.content(opened.contextId, opened.primaryArtifactId);
    assert.equal(typeof service.resolveLink, "function", "T033: SDD link resolution is missing");
    const linked = await service.resolveLink(opened.contextId, opened.primaryArtifactId, source.revision, "research.md#research");
    assert.equal(linked.kind, "artifact");
    assert.equal(linked.artifact.role, "reference");
    assert.equal((await service.content(opened.contextId, linked.artifact.id)).content, "# Research\n");
    assert.equal((await service.resolveLink(opened.contextId, opened.primaryArtifactId, source.revision, "file:///private.md")).kind, "inert");
    await assert.rejects(service.resolveLink(opened.contextId, opened.primaryArtifactId, `sha256:${"0".repeat(64)}`, "#research"), { code: "changed_source" });
}));

test("SDD packaged discovery retains the cumulative inspection bound", async () => {
    const discovery = await import("../vendor/artifact-discovery.mjs").catch((error) => {
        if (error.code === "ERR_MODULE_NOT_FOUND") assert.fail("T033: packaged bounded discovery is missing");
        throw error;
    });
    const entries = async function* () {
        for (let index = 0; index < 10_001; index++) yield {
            name: index % 2 ? `image-${index}.png` : `note-${index}.md`,
            isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false,
        };
    };
    const result = await discovery.scanArtifactCandidates({ workspacePath: tmpdir(), roots: ["specs/001-fixture"], explicit: [], entries });
    assert.equal(result.inspectedCount, 10_000);
    assert.equal(result.limitReached, true);
    assert.equal(result.candidates.length, 5000);
});

test("SDD guarded review HTTP routes preserve legacy content and deny unauthorized contexts", async () => {
    const { startFixture } = await import("../../../../../scripts/canvas-reader/serve-fixture.mjs");
    const fixture = await startFixture({ canvas: "sdd" });
    const endpoint = (route, parameters = {}) => {
        const url = new URL(fixture.url);
        url.pathname = route;
        for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
        return url;
    };
    try {
        const response = await fetch(endpoint("/api/review/context", { feature: "999-canvas-preview-fixture", stage: "specify" }));
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.equal(response.headers.get("x-content-type-options"), "nosniff");
        const { data: opened } = await response.json();
        assert.ok(opened.items.some((artifact) => artifact.relativePath.endsWith("/research.md")));
        const current = await (await fetch(endpoint("/api/review/content", { context: opened.contextId, artifactId: opened.primaryArtifactId }))).json();
        const legacy = await (await fetch(endpoint("/api/artifact", { feature: "999-canvas-preview-fixture", stage: "specify" }))).json();
        assert.equal(current.data.content, legacy.content);
        const linked = await fetch(endpoint("/api/review/resolve-link"), {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contextId: opened.contextId, sourceArtifactId: opened.primaryArtifactId, expectedRevision: current.data.revision, target: "research.md#findings" }),
        });
        assert.equal(linked.status, 200);
        assert.equal((await linked.json()).data.kind, "artifact");
        const forbidden = endpoint("/api/review/artifacts", { context: opened.contextId });
        forbidden.searchParams.delete("cap");
        assert.equal((await fetch(forbidden)).status, 403);
        const invalid = await fetch(endpoint("/api/review/artifacts", { context: "ctx_other_instance" }));
        assert.equal(invalid.status, 404);
        assert.equal((await invalid.json()).error.code, "invalid_context");
        assert.equal(fixture.dispatchCount(), 0);
        assert.equal(fixture.blockedWrites(), 0);
        assert.equal(fixture.workspaceChanged(), false);
    } finally { assert.equal((await fixture.stop()).cleaned, true); }
});

reviewFreshnessTests("SDD", new URL("../ui/artifact-review.js", import.meta.url).href);

test("SDD refresh retains expected descriptors across atomic replacement and deletion", () => serviceFixture(async ({ root, service }) => {
    const opened = await service.open({ feature: "001-fixture", stage: "specify" });
    const original = await service.content(opened.contextId, opened.primaryArtifactId);
    await fs.writeFile(join(root, "replacement.md"), "# Atomic replacement\n");
    await fs.rename(join(root, "replacement.md"), join(root, "specs/001-fixture/spec.md"));
    await assert.rejects(service.content(opened.contextId, opened.primaryArtifactId, { expectedRevision: original.revision }), { code: "changed_source" });
    await fs.rm(join(root, "specs/001-fixture/spec.md"));
    const page = await service.list(opened.contextId);
    assert.equal(page.items.find((artifact) => artifact.id === opened.primaryArtifactId)?.availability, "expected");
    await assert.rejects(service.content(opened.contextId, opened.primaryArtifactId), { code: "artifact_unavailable" });
}));

test("SDD refresh signature detects scoped supporting changes without reading document bodies", () => serviceFixture(async ({ root, service }) => {
    await fs.writeFile(join(root, "specs/001-fixture/research.md"), "# First\n");
    await service.open({ feature: "001-fixture", stage: "specify" });
    assert.equal(typeof service.signature, "function", "Scoped review signature is missing");
    const first = await service.signature();
    assert.match(first, /^[a-f0-9]{64}$/);
    await fs.writeFile(join(root, "specs/001-fixture/research.md"), "# Different supporting document\n");
    const second = await service.signature();
    assert.notEqual(first, second);
    await fs.writeFile(join(root, "specs/001-fixture/new.markdown"), "# New\n");
    assert.notEqual(await service.signature(), second);
}));

test("SDD clarification bindings revalidate exact revision, index, and question without batching", () => serviceFixture(async ({ root, service }) => {
    await fs.writeFile(join(root, "specs/001-fixture/spec.md"), "# Questions\n\n[NEEDS CLARIFICATION: Which scope?]\n\n`[NEEDS CLARIFICATION: Example?]`\n");
    const opened = await service.open({ feature: "001-fixture", stage: "specify" });
    assert.equal(typeof service.clarifications, "function", "T068: revision-bound question descriptors are missing");
    const bindings = await service.clarifications(opened.contextId, opened.primaryArtifactId);
    assert.equal(bindings.length, 1);
    assert.equal(bindings[0].mode, "sdd-immediate");
    assert.equal(bindings[0].question, "Which scope?");
    assert.equal(bindings[0].index, 0);
    const request = { questionId: bindings[0].questionId, question: bindings[0].question, index: 0, answer: "Only this feature" };
    const accepted = await service.validateClarifications(opened.contextId, opened.primaryArtifactId, bindings[0].revision, [request]);
    assert.equal(accepted[0].answer, request.answer);
    await assert.rejects(service.validateClarifications(opened.contextId, opened.primaryArtifactId, bindings[0].revision, [{ ...request, question: "Changed question" }]), { code: "changed_source" });
    await assert.rejects(service.validateClarifications(opened.contextId, opened.primaryArtifactId, bindings[0].revision, [request, request]), { code: "invalid_request" });
    await fs.writeFile(join(root, "specs/001-fixture/spec.md"), "# Changed\n\n[NEEDS CLARIFICATION: New question?]\n");
    await assert.rejects(service.validateClarifications(opened.contextId, opened.primaryArtifactId, bindings[0].revision, [request]), { code: "changed_source" });
}));

test("SDD supporting documents never inherit primary-spec clarification actions", () => serviceFixture(async ({ root, service }) => {
    await fs.writeFile(join(root, "specs/001-fixture/research.md"), "[NEEDS CLARIFICATION: Inert supporting question?]\n");
    const opened = await service.open({ feature: "001-fixture", stage: "specify" });
    assert.equal(typeof service.clarifications, "function", "T068: supporting-document clarification isolation is missing");
    const research = opened.items.find((artifact) => artifact.relativePath.endsWith("/research.md"));
    assert.deepEqual(await service.clarifications(opened.contextId, research.id), []);
}));

test("SDD immediate HTTP submission denies stale questions before the mocked SDK dispatch", async () => {
    const { startFixture } = await import("../../../../../scripts/canvas-reader/serve-fixture.mjs");
    const fixture = await startFixture({ canvas: "sdd", markdown: "# Scope\n\n[NEEDS CLARIFICATION: Which scope?]\n", allowMockDispatch: true });
    const endpoint = (route, parameters = {}) => {
        const url = new URL(fixture.url);
        url.pathname = route;
        for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
        return url;
    };
    try {
        const { data: opened } = await (await fetch(endpoint("/api/review/context", { feature: "999-canvas-preview-fixture", stage: "specify" }))).json();
        const { data: current } = await (await fetch(endpoint("/api/review/content", { context: opened.contextId, artifactId: opened.primaryArtifactId }))).json();
        const question = current.clarifications[0];
        const body = { feature: "999-canvas-preview-fixture", contextId: opened.contextId, artifactId: opened.primaryArtifactId,
            expectedRevision: current.revision, questionId: question.questionId, index: question.index, question: question.question, answer: "Only this fixture" };
        const submit = (value) => fetch(endpoint("/api/clarify"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
        for (const invalid of [{ ...body, expectedRevision: `sha256:${"0".repeat(64)}` }, { ...body, question: "Other question" }, { ...body, index: 2 }]) {
            assert.equal((await submit(invalid)).status, 400);
            assert.equal(fixture.dispatchCount(), 0);
        }
        const response = await submit(body);
        assert.equal(response.status, 200);
        assert.equal((await response.json()).ok, true);
        assert.equal(fixture.dispatchCount(), 1);
        assert.equal(fixture.workspaceChanged(), false);
    } finally { assert.equal((await fixture.stop()).cleaned, true); }
});
