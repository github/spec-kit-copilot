import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { reviewFreshnessTests } from "./review-freshness-fixture.mjs";
import { artifactSourcePath } from "../ui/composition-artifacts.js";

const require = createRequire(new URL("../ui/markdown-reader/package.json", import.meta.url));
const { JSDOM } = require("jsdom");
const revision = `sha256:${"a".repeat(64)}`;

async function serviceFixture(run) {
    const domain = await import("../server/artifact-review.mjs");
    assert.equal(typeof domain.createWizardReviewService, "function", "T022: Wizard primary review service is missing");
    const root = await fs.mkdtemp(join(tmpdir(), "wizard-primary-review-"));
    try {
        await fs.mkdir(join(root, "specs/001-fixture"), { recursive: true });
        await fs.writeFile(join(root, "specs/001-fixture/spec.md"), "# Primary fixture\n");
        const snapshot = {
            workspacePath: root, slug: "001-fixture", currentPhase: "specify",
            setup: { pluginInstalled: false, skillsReloaded: false },
            phases: { specify: { artifactPath: "specs/001-fixture/spec.md", locked: true } },
            commands: [], composition: { artifacts: [] },
        };
        const service = domain.createWizardReviewService({ workspacePath: root, instanceId: "fixture", getState: async () => snapshot });
        await run({ root, snapshot, service });
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
}

test("Wizard reviews scanner-owned primary Markdown while execution is unavailable", () => serviceFixture(async ({ service, snapshot }) => {
    const before = structuredClone(snapshot);
    const opened = await service.open({ stage: "specify" });
    assert.match(opened.contextId, /^ctx_/);
    const document = await service.content(opened.contextId, opened.primaryArtifactId);
    assert.equal(document.content, "# Primary fixture\n");
    assert.equal(document.artifact.relativePath, "specs/001-fixture/spec.md");
    assert.equal(document.artifact.owningStage, "specify");
    assert.match(document.revision, /^sha256:[a-f0-9]{64}$/);
    assert.deepEqual(snapshot, before);
}));

test("Wizard denies fabricated source hints and invalidates a changed feature context", () => serviceFixture(async ({ service, snapshot }) => {
    await assert.rejects(service.open({ stage: "specify", source: "private.md" }), { code: "artifact_unavailable" });
    const opened = await service.open({ stage: "specify" });
    snapshot.slug = "002-other";
    await assert.rejects(service.content(opened.contextId, opened.primaryArtifactId), { code: "invalid_context" });
}));

test("Wizard preserves exact legacy-file bytes and refuses a changed expected revision", () => serviceFixture(async ({ service, root }) => {
    const opened = await service.open({ stage: "specify" });
    const first = await service.content(opened.contextId, opened.primaryArtifactId);
    await fs.writeFile(join(root, "specs/001-fixture/spec.md"), "# Updated fixture\n");
    await assert.rejects(service.content(opened.contextId, opened.primaryArtifactId, { expectedRevision: first.revision }), { code: "changed_source" });
    assert.equal((await fs.readFile(join(root, "specs/001-fixture/spec.md"), "utf8")), "# Updated fixture\n");
}));

async function adapterFixture(run) {
    const adapter = await import("../ui/artifact-review.js").catch((error) => {
        if (error.code === "ERR_MODULE_NOT_FOUND") assert.fail("T022: Wizard reader adapter is missing");
        throw error;
    });
    const dom = new JSDOM('<button id="trigger">View artifact</button><div id="scroll"><div id="reader"></div></div>', { url: "http://127.0.0.1:32100/?token=fixture" });
    const container = dom.window.document.getElementById("reader");
    const scrollElement = dom.window.document.getElementById("scroll");
    const trigger = dom.window.document.getElementById("trigger");
    trigger.focus();
    const calls = [];
    const mounted = [];
    let disposed = 0;
    const artifact = { id: "artifact_fixture", relativePath: "specs/001-fixture/spec.md", label: "Specification", role: "primary", availability: "available", suffix: ".md" };
    const artifacts = [artifact, ...Array.from({ length: 52 }, (_, index) => ({ ...artifact, id: `artifact_${index}`, relativePath: `specs/001-fixture/document-${index}.md`, label: `document-${index}.md`, role: "supporting" }))];
    const revisions = new Map();
    const request = async (input, options) => {
        const url = new URL(input);
        calls.push({ path: url.pathname, method: options?.method ?? "GET" });
        const data = url.pathname.endsWith("/context")
            ? { contextId: "ctx_fixture", generation: 1, primaryArtifactId: artifact.id, items: artifacts }
            : { artifact: artifacts.find((entry) => entry.id === url.searchParams.get("artifactId")), content: "# Fixture\n", revision: revisions.get(url.searchParams.get("artifactId")) ?? revision, byteSize: 10, sourceKind: "working-tree" };
        return { ok: true, json: async () => ({ ok: true, data }) };
    };
    const review = adapter.createArtifactReview({
        container, scrollElement, readerId: "wizard-fixture", fetch: request,
        mount: (_element, options) => {
            mounted.push(options);
            options.onRendered?.({ artifactId: options.document?.artifact.id, revision: options.document?.revision });
            return { update: (next) => mounted.push(next), unmount: () => disposed++ };
        },
    });
    try { await run({ review, container, scrollElement, trigger, calls, mounted, artifacts, revisions, disposed: () => disposed }); }
    finally { review.close(); dom.window.close(); }
}

test("Wizard adapter mounts in the existing container using GET-only validated content", () => adapterFixture(async ({ review, container, mounted, calls }) => {
    await review.open({ stage: "specify" });
    assert.equal(container.dataset.reviewContext, "ctx_fixture");
    assert.equal(mounted.at(-1).document.revision, revision);
    assert.equal(mounted.at(-1).document.artifact.id, "artifact_fixture");
    assert.deepEqual(calls.map((call) => call.method), ["GET", "GET"]);
}));

test("Wizard adapter disposes idempotently and restores its invoking control and scroll", () => adapterFixture(async ({ review, scrollElement, trigger, disposed }) => {
    scrollElement.scrollTop = 125;
    await review.open({ stage: "specify" });
    scrollElement.scrollTop = 500;
    review.close();
    review.close();
    assert.equal(disposed(), 1);
    assert.equal(trigger.ownerDocument.activeElement, trigger);
    assert.equal(scrollElement.scrollTop, 125);
}));

test("Wizard adapter can reopen without retaining the previous reader root", () => adapterFixture(async ({ review, disposed, mounted }) => {
    await review.open({ stage: "specify" });
    review.close();
    await review.open({ stage: "specify" });
    assert.equal(disposed(), 1);
    assert.equal(mounted.filter((options) => options.document).length, 2);
}));

test("Wizard discovery includes scoped supporting/custom/checklist/contract and constitution artifacts", () => serviceFixture(async ({ root, snapshot, service }) => {
    await fs.mkdir(join(root, "specs/001-fixture/checklists"), { recursive: true });
    await fs.mkdir(join(root, "specs/001-fixture/contracts"), { recursive: true });
    await fs.mkdir(join(root, ".specify/memory"), { recursive: true });
    await fs.mkdir(join(root, "specs/002-other"), { recursive: true });
    const supporting = ["research.md", "custom.MARKDOWN", "checklists/requirements.md", "contracts/api.md"];
    for (const file of supporting) await fs.writeFile(join(root, "specs/001-fixture", file), "# Supporting\n");
    await fs.writeFile(join(root, ".specify/memory/constitution.md"), "# Constitution\n");
    await fs.writeFile(join(root, "specs/002-other/private.md"), "Other feature");
    snapshot.phases.plan = { artifactPath: "specs/001-fixture/plan.md" };
    const opened = await service.open({ stage: "specify" });
    const paths = opened.items.map((entry) => entry.relativePath);
    for (const file of supporting) assert.ok(paths.includes(`specs/001-fixture/${file}`), `Missing scoped artifact ${file}`);
    assert.ok(paths.includes(".specify/memory/constitution.md"));
    assert.ok(!paths.includes("specs/002-other/private.md"));
    const expected = opened.items.find((entry) => entry.relativePath.endsWith("/plan.md"));
    assert.equal(expected?.availability, "expected");
    await assert.rejects(service.content(opened.contextId, expected.id), { code: "artifact_unavailable" });
}));

test("Wizard discovery paginates actual files without duplicates or workflow changes", () => serviceFixture(async ({ root, service, snapshot }) => {
    for (let index = 0; index < 205; index++) {
        await fs.writeFile(join(root, `specs/001-fixture/note-${String(index).padStart(3, "0")}.md`), "# Note\n");
    }
    const before = structuredClone(snapshot);
    const opened = await service.open({ stage: "specify" });
    assert.equal(opened.items.length, 200);
    assert.ok(opened.nextCursor);
    const next = await service.list(opened.contextId, { cursor: opened.nextCursor });
    const items = [...opened.items, ...next.items];
    assert.equal(items.length, 206);
    assert.equal(new Set(items.map((entry) => entry.id)).size, items.length);
    assert.equal(next.nextCursor, null);
    assert.deepEqual(snapshot, before);
}));

test("Wizard resolves revision-bound local references without fetching external targets", () => serviceFixture(async ({ root, service }) => {
    await fs.writeFile(join(root, "specs/001-fixture/research.md"), "# Research\n");
    const opened = await service.open({ stage: "specify" });
    const source = await service.content(opened.contextId, opened.primaryArtifactId);
    assert.equal(typeof service.resolveLink, "function", "T032: safe relative link resolution is missing");
    const resolved = await service.resolveLink(opened.contextId, opened.primaryArtifactId, source.revision, "research.md#research");
    assert.equal(resolved.kind, "artifact");
    assert.equal(resolved.artifact.role, "reference");
    assert.equal(resolved.fragment, "research");
    assert.equal((await service.content(opened.contextId, resolved.artifact.id)).content, "# Research\n");
    assert.equal((await service.resolveLink(opened.contextId, opened.primaryArtifactId, source.revision, "https://example.invalid/" )).requiresUserAction, true);
    assert.equal((await service.resolveLink(opened.contextId, opened.primaryArtifactId, source.revision, "javascript:alert(1)")).kind, "inert");
    await fs.writeFile(join(root, "specs/001-fixture/spec.md"), "# Changed\n");
    await assert.rejects(service.resolveLink(opened.contextId, opened.primaryArtifactId, source.revision, "#section"), { code: "changed_source" });
}));

test("Wizard discovery bounds entry inspection and returns a partial terminal page", async () => {
    const discovery = await import("../server/artifact-discovery.mjs").catch((error) => {
        if (error.code === "ERR_MODULE_NOT_FOUND") assert.fail("T032: bounded scoped discovery is missing");
        throw error;
    });
    let inspected = 0;
    const entries = async function* () {
        for (let index = 0; index < 10_001; index++) {
            inspected++;
            yield { name: `note-${index}.md`, isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false };
        }
    };
    const result = await discovery.scanArtifactCandidates({ workspacePath: tmpdir(), roots: ["specs/001-fixture"], explicit: [], entries });
    assert.equal(result.inspectedCount, 10_000);
    assert.equal(result.limitReached, true);
    assert.ok(inspected <= 10_001);
    assert.equal(result.candidates.length, 10_000);
});

test("Wizard history retains at most fifty entries and discards forward history after a new selection", () => adapterFixture(async ({ review }) => {
    await review.open({ stage: "specify" });
    for (let index = 0; index < 52; index++) await review.selectArtifact(`artifact_${index}`);
    assert.equal(review.history.length, 50);
    await review.navigateHistory("back");
    assert.equal(review.document.artifact.id, "artifact_50");
    await review.selectArtifact("artifact_fixture");
    assert.equal(review.navigateHistory("forward"), false);
}));

test("Wizard toolbar navigates filename neighbors without browsing history", () => adapterFixture(async ({ review, mounted, artifacts }) => {
    const primary = artifacts[0];
    artifacts.splice(1, artifacts.length - 1,
        { ...primary, id: "tasks", relativePath: "specs/001-fixture/tasks.md", label: "Tasks" },
        { ...primary, id: "plan", relativePath: "specs/001-fixture/plan.md", label: "Plan" },
        { ...primary, id: "research", relativePath: "specs/001-fixture/research.md", label: "Research" },
    );
    await review.open({ stage: "specify" });
    assert.equal(mounted.at(-1).canNavigateBack, true);
    assert.equal(mounted.at(-1).canNavigateForward, true);
    await mounted.at(-1).onNavigateHistory("forward");
    assert.equal(review.document.artifact.id, "tasks");
    assert.equal(mounted.at(-1).canNavigateForward, false);
    await mounted.at(-1).onNavigateHistory("back");
    assert.equal(review.document.artifact.id, primary.id);
    await mounted.at(-1).onNavigateHistory("back");
    assert.equal(review.document.artifact.id, "research");
    await mounted.at(-1).onNavigateHistory("back");
    assert.equal(review.document.artifact.id, "plan");
    assert.equal(mounted.at(-1).canNavigateBack, false);
    assert.equal(await mounted.at(-1).onNavigateHistory("back"), false);
}));

test("Wizard toolbar skips unavailable files and stays in the selected folder", () => adapterFixture(async ({ review, mounted, artifacts }) => {
    const primary = artifacts[0];
    artifacts.splice(1, artifacts.length - 1,
        { ...primary, id: "missing", relativePath: "specs/001-fixture/plan.md", availability: "expected" },
        { ...primary, id: "unsupported", relativePath: "specs/001-fixture/notes.txt", suffix: ".txt" },
        { ...primary, id: "nested", relativePath: "specs/001-fixture/checklists/requirements.md" },
        { ...primary, id: "other", relativePath: ".specify/memory/constitution.md" },
        { ...primary, id: "tasks", relativePath: "specs/001-fixture/tasks.MARKDOWN", suffix: ".MARKDOWN" },
    );
    await review.open({ stage: "specify" });
    assert.equal(mounted.at(-1).canNavigateBack, false);
    assert.equal(mounted.at(-1).canNavigateForward, true);
    await mounted.at(-1).onNavigateHistory("forward");
    assert.equal(review.document.artifact.id, "tasks");
    await review.selectArtifact("nested");
    assert.equal(mounted.at(-1).canNavigateBack, false);
    assert.equal(mounted.at(-1).canNavigateForward, false);
    assert.equal(await mounted.at(-1).onNavigateHistory("forward"), false);
}));

test("Wizard toolbar sorts numbered filenames naturally and restores unchanged scroll positions", () => adapterFixture(async ({ review, mounted, scrollElement, revisions }) => {
    await review.open({ stage: "specify" });
    await review.selectArtifact("artifact_10");
    scrollElement.scrollTop = 225;
    await mounted.at(-1).onNavigateHistory("back");
    assert.equal(review.document.artifact.id, "artifact_9");
    scrollElement.scrollTop = 140;
    await mounted.at(-1).onNavigateHistory("forward");
    assert.equal(review.document.artifact.id, "artifact_10");
    assert.equal(scrollElement.scrollTop, 225);
    await mounted.at(-1).onNavigateHistory("back");
    assert.equal(scrollElement.scrollTop, 140);
    revisions.set("artifact_10", `sha256:${"c".repeat(64)}`);
    await mounted.at(-1).onNavigateHistory("forward");
    assert.equal(scrollElement.scrollTop, 0);
}));

test("Wizard toolbar disables neighboring navigation while a document loads", () => adapterFixture(async ({ review, mounted }) => {
    await review.open({ stage: "specify" });
    const loading = review.selectArtifact("artifact_10");
    assert.equal(mounted.at(-1).canNavigateBack, false);
    assert.equal(mounted.at(-1).canNavigateForward, false);
    assert.equal(await mounted.at(-1).onNavigateHistory("back"), false);
    await loading;
    assert.equal(review.document.artifact.id, "artifact_10");
    assert.equal(mounted.at(-1).canNavigateBack, true);
    assert.equal(mounted.at(-1).canNavigateForward, true);
}));

test("Wizard history restores scroll only for the same revision", () => adapterFixture(async ({ review, scrollElement, revisions }) => {
    await review.open({ stage: "specify" });
    scrollElement.scrollTop = 125;
    await review.selectArtifact("artifact_0");
    scrollElement.scrollTop = 222;
    await review.navigateHistory("back");
    assert.equal(scrollElement.scrollTop, 125);
    await review.navigateHistory("forward");
    assert.equal(scrollElement.scrollTop, 222);
    revisions.set("artifact_fixture", `sha256:${"c".repeat(64)}`);
    await review.navigateHistory("back");
    assert.equal(scrollElement.scrollTop, 0);
}));

test("Wizard source entry points accept only scoped folder files and current composition sources", () => serviceFixture(async ({ root, snapshot, service }) => {
    await fs.mkdir(join(root, "specs/001-fixture/contracts"), { recursive: true });
    await fs.mkdir(join(root, ".specify/templates"), { recursive: true });
    await fs.mkdir(join(root, ".specify/presets/fixture/commands"), { recursive: true });
    await fs.writeFile(join(root, "specs/001-fixture/contracts/api.markdown"), "# Contract\n");
    await fs.writeFile(join(root, ".specify/templates/fixture.md"), "# Template\n");
    const customized = {
        id: "commands/speckit.specify", kind: "command",
        stack: [{ layer: "preset", sourcePath: ".specify/presets/fixture/commands/speckit.specify.md", active: true }],
    };
    const source = artifactSourcePath(customized, customized.stack.find((layer) => layer.active));
    await fs.writeFile(join(root, source), "# Customized command\n");
    snapshot.composition.artifacts = [
        { id: "templates/fixture", kind: "template", stack: [{ sourcePath: ".specify/templates/fixture.md", active: true }] },
        customized,
    ];
    const folder = await service.open({ stage: "specify", source: "specs/001-fixture/contracts/api.markdown" });
    assert.equal((await service.content(folder.contextId, folder.primaryArtifactId)).content, "# Contract\n");
    const command = await service.open({ source: ".specify/templates/fixture.md" });
    assert.equal((await service.content(command.contextId, command.primaryArtifactId)).content, "# Template\n");
    const overridden = await service.open({ source });
    assert.equal((await service.content(overridden.contextId, overridden.primaryArtifactId)).content, "# Customized command\n");
    await assert.rejects(service.open({ source: ".specify/templates/unlisted.md" }), { code: "artifact_unavailable" });
}));

test("Wizard retains the composition UI's conventional template source previews", () => serviceFixture(async ({ root, snapshot, service }) => {
    const artifact = { id: "templates/spec-template", kind: "template", stack: [] };
    const source = artifactSourcePath(artifact, null);
    assert.equal(source, ".specify/templates/spec-template.md");
    await fs.mkdir(join(root, ".specify/templates"), { recursive: true });
    await fs.writeFile(join(root, source), "# Existing specification template\n");
    snapshot.composition.artifacts = [artifact];
    const before = structuredClone(snapshot);
    const opened = await service.open({ source });
    assert.equal((await service.content(opened.contextId, opened.primaryArtifactId)).content, "# Existing specification template\n");
    assert.deepEqual(snapshot, before);
    await assert.rejects(service.open({ source: ".specify/templates/unregistered.md" }), { code: "artifact_unavailable" });
}));

reviewFreshnessTests("Wizard", new URL("../ui/artifact-review.js", import.meta.url).href);

test("Wizard refresh keeps context when its primary is deleted or atomically replaced", () => serviceFixture(async ({ root, snapshot, service }) => {
    const opened = await service.open({ stage: "specify" });
    const initial = await service.content(opened.contextId, opened.primaryArtifactId);
    await fs.writeFile(join(root, "replacement.md"), "# Replaced specification\n");
    await fs.rename(join(root, "replacement.md"), join(root, "specs/001-fixture/spec.md"));
    await assert.rejects(service.content(opened.contextId, opened.primaryArtifactId, { expectedRevision: initial.revision }), { code: "changed_source" });
    await fs.rm(join(root, "specs/001-fixture/spec.md"));
    snapshot.phases.specify.artifactPath = null;
    const page = await service.list(opened.contextId);
    assert.equal(page.items.find((artifact) => artifact.id === opened.primaryArtifactId)?.availability, "expected");
    await assert.rejects(service.content(opened.contextId, opened.primaryArtifactId), { code: "artifact_unavailable" });
}));

test("Wizard clarification bindings are prose-only and reject a stale revision or another command", () => serviceFixture(async ({ root, service }) => {
    await fs.writeFile(join(root, "specs/001-fixture/spec.md"), "# Scope\n\n[NEEDS CLARIFICATION: Which scope?]\n\n`[NEEDS CLARIFICATION: Example?]`\n");
    const opened = await service.open({ stage: "specify" });
    const document = await service.content(opened.contextId, opened.primaryArtifactId);
    assert.equal(document.clarifications.length, 1);
    const binding = document.clarifications[0];
    const answers = [{ questionId: binding.questionId, question: binding.question, answer: "Current feature" }];
    assert.equal((await service.validateClarifications(opened.contextId, opened.primaryArtifactId, document.revision, answers, "speckit.specify")).length, 1);
    await assert.rejects(service.validateClarifications(opened.contextId, opened.primaryArtifactId, document.revision, answers, "speckit.plan"), { code: "changed_source" });
    await fs.writeFile(join(root, "specs/001-fixture/spec.md"), "# New scope\n");
    await assert.rejects(service.validateClarifications(opened.contextId, opened.primaryArtifactId, document.revision, answers, "speckit.specify"), { code: "changed_source" });
}));
