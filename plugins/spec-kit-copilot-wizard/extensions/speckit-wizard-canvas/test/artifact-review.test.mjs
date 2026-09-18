// Validate optional example-derived vocabularies and bounded, scoped artifact assessments.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";
import { ARTIFACT_OUTCOME_GUIDANCE, createArtifactReviewer } from "../generation/generated-canvas-template/artifact-review.mjs";
import { createWorkflowAdapter, validateWorkflowConfig } from "../generation/generated-canvas-template/workflow-adapter.mjs";

const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
export const reviewConfig = () => ({
    phase: "last", sampleFingerprint: "a".repeat(64), goal: "Document an evidence-backed decision.",
    successStatusId: "decided", complementLabel: "Decision not made",
    statuses: [
        { id: "pending", label: "Decision pending", criterion: "Evidence exists but a decision is not yet stated." },
        { id: "decided", label: "Decision made", criterion: "A decision and supporting evidence are stated, including a decision not to proceed." },
    ],
});
const settings = (artifactReview) => ({ version: 1, itemLabels: {}, phaseArguments: {}, artifactReview });
const pipeline = { pipeline: { steps: [
    { instanceKey: "first", artifact: { persistent: true, pathTemplate: "first.md" } },
    { instanceKey: "last", artifact: { persistent: true, pathTemplate: "last.md" } },
] } };

test("review config is optional, immutable, final-phase-bound and tied to the captured example", () => {
    assert.doesNotThrow(() => validateWorkflowConfig(settings(null), pipeline, { example: null }));
    const config = settings(reviewConfig());
    const example = { available: true, sample: { phase: "last", fingerprint: "a".repeat(64) } };
    assert.doesNotThrow(() => validateWorkflowConfig(config, pipeline, { example }));
    assert.throws(() => validateWorkflowConfig(config, pipeline, { example: null }), /captured final example/);
    const adapter = createWorkflowAdapter(config, pipeline);
    config.artifactReview.statuses[0].label = "Mutated";
    adapter.artifactReview().statuses[0].label = "Also mutated";
    assert.equal(adapter.artifactReview().statuses[0].label, "Decision pending");
    for (const edit of [
        (r) => { r.phase = "first"; }, (r) => { r.goal = ""; }, (r) => { r.statuses = []; },
        (r) => { r.statuses[0].label = "This has four words"; },
        (r) => { r.statuses[0].label = "Clarification needed"; },
        (r) => { r.statuses[1].label = r.statuses[0].label.toUpperCase(); },
        (r) => { r.statuses[1].id = r.statuses[0].id; },
        (r) => { r.statuses[0].id = "needs-review"; },
        (r) => { r.statuses[0].criterion = "one\ntwo"; },
        (r) => { r.statuses[0].extra = true; },
        (r) => { r.sampleFingerprint = "bad"; },
        (r) => { delete r.successStatusId; },
        (r) => { r.successStatusId = "invented"; },
        (r) => { r.successStatusId = "needs-review"; },
        (r) => { delete r.complementLabel; },
        (r) => { r.complementLabel = "Decision made"; },
        (r) => { r.complementLabel = "Clarification needed"; },
        (r) => { r.complementLabel = "One two three four"; },
        (r) => { r.complementLabel = "Not\nready"; },
        (r) => { r.complementLabel = "x".repeat(61); },
    ]) {
        const review = reviewConfig(); edit(review);
        assert.throws(() => validateWorkflowConfig(settings(review), pipeline));
    }
    const transient = structuredClone(pipeline);
    transient.pipeline.steps.at(-1).artifact.persistent = false;
    assert.throws(() => validateWorkflowConfig(settings(reviewConfig()), transient), /final artifact/);
});

async function fixture() {
    const cwd = await mkdtemp(join(dirname(fileURLToPath(import.meta.url)), ".artifact-review-"));
    roots.push(cwd);
    const inst = { cwd, identity: "example-canvas", instanceId: "example-panel" };
    const contents = new Map([["alpha", "Evidence gathered. Decision: stop."], ["beta", "Evidence gathered. Decision: proceed."]]);
    let clock = 0, failing = false;
    const sends = [];
    const options = {
        config: reviewConfig(), now: () => clock,
        dispatch: async (input) => { if (failing) throw new Error("SDK private detail"); sends.push(input); },
        readCurrent: async (_inst, itemId) => contents.has(itemId) ? { artifact: `${itemId}.md`, content: contents.get(itemId) } : null,
    };
    const reviewer = createArtifactReviewer(options);
    const observe = (id = "alpha", overrides = {}, runtime = reviewer, panel = inst) => runtime.observe(panel, {
        itemId: id, artifact: `${id}.md`, content: contents.get(id), clarificationCount: 0, canDispatch: true, ...overrides,
    });
    const response = () => ({ requestId: sends.at(-1).prompt.match(/"requestId":"([^"]+)"/)[1], statusId: "decided" });
    return { inst, reviewer, options, contents, sends, observe, response,
        advance: (ms = 3100) => { clock += ms; }, fail: () => { failing = true; } };
}

test("settled artifacts get one review and fixed labels across items, panels and reloads", async () => {
    const f = await fixture();
    assert.equal((await f.observe()).label, "Needs review");
    f.advance();
    await f.observe("alpha", { canDispatch: false });
    assert.equal(f.sends.length, 0);
    assert.equal((await f.observe()).label, "Reviewing");
    await Promise.all([f.observe(), f.observe("alpha", {}, f.reviewer, { ...f.inst, instanceId: "panel-two" })]);
    assert.equal(f.sends.length, 1);
    assert.match(f.sends[0].prompt, /Do not read skills\/templates, edit files, execute phases/);
    assert.ok(f.sends[0].prompt.includes(ARTIFACT_OUTCOME_GUIDANCE));
    assert.match(f.sends[0].prompt, /Use this evidence to select exactly one configured status ID; use needs-review/);
    await assert.rejects(f.reviewer.report({ ...f.inst, identity: "other" }, f.response()), /Unknown/);
    await assert.rejects(f.reviewer.report(f.inst, { ...f.response(), statusId: "invented" }), /configured/);
    assert.equal((await f.reviewer.report(f.inst, f.response())).label, "Decision made");
    await assert.rejects(f.reviewer.report(f.inst, f.response()), /Unknown/);
    const reloaded = createArtifactReviewer(f.options);
    assert.equal((await f.observe("alpha", {}, reloaded)).label, "Decision made");
    assert.equal((await f.observe("alpha", {}, reloaded)).statusId, "decided");
    await f.observe("beta"); f.advance(); await f.observe("beta");
    assert.equal((await f.reviewer.report(f.inst, f.response())).label, "Decision made");
    assert.equal((await f.observe("beta")).statusId, "decided");
    assert.equal((await readdir(join(f.inst.cwd, ".speckit-wizard", "artifact-reviews"))).length, 2);
});

test("changed inputs and deleted items cannot receive stale results", async () => {
    const f = await fixture();
    await f.observe(); f.advance();
    f.contents.set("alpha", "Partial write");
    assert.equal((await f.observe()).state, "pending");
    assert.equal(f.sends.length, 0);
    f.advance(); await f.observe();
    const old = f.response();
    f.contents.set("alpha", "Revised evidence");
    await assert.rejects(f.reviewer.report(f.inst, old), /stale/);
    await f.observe(); f.advance(); await f.observe();
    await assert.rejects(f.reviewer.report(f.inst, old), /Unknown/);
    assert.equal((await f.reviewer.report(f.inst, { ...f.response(), statusId: "needs-review" })).label, "Needs review");
    const revised = createArtifactReviewer({ ...f.options, config: { ...reviewConfig(), goal: "Changed goal" } });
    assert.equal((await f.observe("alpha", {}, revised)).state, "pending");
    f.contents.set("alpha", "Last change"); await f.observe(); f.advance(); await f.observe();
    f.contents.delete("alpha");
    await assert.rejects(f.reviewer.report(f.inst, f.response()), /stale/);
});

test("reviews cached without semantic reading guidance are assessed again", async () => {
    const f = await fixture();
    await f.observe(); f.advance(); await f.observe();
    await f.reviewer.report(f.inst, f.response());
    const directory = join(f.inst.cwd, ".speckit-wizard", "artifact-reviews");
    const oldFingerprint = createHash("sha256")
        .update(JSON.stringify([f.options.config, "alpha.md", f.contents.get("alpha")])).digest("hex");
    await writeFile(join(directory, (await readdir(directory))[0]),
        JSON.stringify({ version: 1, fingerprint: oldFingerprint, statusId: "decided" }));
    const reloaded = createArtifactReviewer(f.options);
    assert.equal((await f.observe("alpha", {}, reloaded)).state, "pending");
    f.advance();
    assert.equal((await f.observe("alpha", {}, reloaded)).state, "reviewing");
    assert.equal(f.sends.length, 2);
});

test("standard behavior and unresolved/empty artifacts never dispatch reviews", async () => {
    const f = await fixture();
    const standard = createArtifactReviewer({ ...f.options, config: null });
    for (const input of [{ clarificationCount: 1 }, { artifact: null }, { content: null }, { content: "" }]) {
        assert.equal(await f.observe("alpha", input), null);
        f.advance();
        assert.equal(await f.observe("alpha", input), null);
    }
    assert.equal(await f.observe("alpha", {}, standard), null);
    assert.equal(f.sends.length, 0);
    await assert.rejects(readdir(join(f.inst.cwd, ".speckit-wizard")), { code: "ENOENT" });
});

test("timeouts and failures have bounded dispatch and recover on existing rerun or reopen", async () => {
    for (const failedSend of [false, true]) {
        const f = await fixture();
        if (failedSend) f.fail();
        await f.observe(); f.advance(); await f.observe(); f.advance(121_000);
        const status = await f.observe();
        assert.equal(status.label, "Review unavailable");
        assert.doesNotMatch(status.error, /SDK private/);
        await f.observe(); f.advance(); await f.observe();
        assert.equal(f.sends.length, failedSend ? 0 : 1);
        f.reviewer.retry(f.inst, "alpha");
        assert.equal((await f.observe()).state, "pending");
        f.reviewer.close(f.inst);
        assert.equal((await f.observe()).state, "pending");
    }
});

test("bad saved records produce explicit failure, not invented completion", async () => {
    const f = await fixture();
    await f.observe(); f.advance(); await f.observe();
    await f.reviewer.report(f.inst, f.response());
    const directory = join(f.inst.cwd, ".speckit-wizard", "artifact-reviews");
    await writeFile(join(directory, (await readdir(directory))[0]), "{bad");
    assert.equal((await f.observe("alpha", {}, createArtifactReviewer(f.options))).label, "Review unavailable");
    assert.equal(f.sends.length, 1);
});
