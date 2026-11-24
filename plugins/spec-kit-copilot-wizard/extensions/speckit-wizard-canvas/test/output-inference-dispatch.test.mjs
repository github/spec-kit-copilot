import assert from "node:assert/strict";
import { test } from "node:test";
import {
    beginOutputInference,
    createOutputInferenceWorker,
    failOutputInference,
    finishOutputInference,
    outputInferenceProgress,
    unassignedOutputRequests,
} from "../canvas-runtime/output-inference.mjs";
import * as outputInference from "../canvas-runtime/output-inference.mjs";
import { ensurePipelineOutputInference, waitForOutputInference } from "../canvas-runtime/output-inference-dispatch.mjs";
import { attachOutputEvidence } from "../canvas-runtime/output-availability.mjs";

const request = (id) => ({ commandId: `speckit.${id}`, fingerprint: id.repeat(64) });

function fixture() {
    const inst = {
        workspacePath: "C:\\project",
        url: "http://127.0.0.1:1234",
        token: "test",
        broadcast() {},
    };
    return inst;
}

test("inference dispatch batches current pipeline requests into one worker", async (t) => {
    const inst = fixture();
    t.after(() => clearTimeout(inst.outputInference?.timer));
    const requests = ["plan", "tasks", "review", "test", "deploy", "docs", "outside"].map(request);
    const dispatched = [];
    const result = await ensurePipelineOutputInference(inst, {
        getSnapshot: async () => ({
            pipeline: [{ id: "plan" }, { id: "tasks" }, { id: "speckit.review" },
                { id: "speckit.test" }, { id: "speckit.deploy" }, { id: "speckit.docs" }],
            artifactInferenceRequests: requests,
        }),
        session: {},
        buildPrompt: async ({ commands }) => commands.map(({ commandId }) => commandId).join(","),
        startWorker: async (_target, { prompt }, _session, isCurrent, workerId) => {
            assert.equal(isCurrent(), true);
            dispatched.push({ workerId, commands: prompt.split(",") });
        },
    });
    await new Promise(setImmediate);
    assert.equal(result.queued, true);
    assert.equal(result.requests.length, 6);
    assert.equal(dispatched.length, 1);
    assert.equal(inst.outputInference.workers.size, 1);
    assert.deepEqual(dispatched.flatMap(({ commands }) => commands).sort(),
        ["speckit.plan", "speckit.tasks", "speckit.review", "speckit.test",
            "speckit.deploy", "speckit.docs"].sort());
    assert.equal(dispatched[0].commands.length, 6);
});

test("inference dispatch can add only the selected command's request", async (t) => {
    const inst = fixture();
    t.after(() => clearTimeout(inst.outputInference?.timer));
    const dispatched = [];
    const result = await ensurePipelineOutputInference(inst, {
        getSnapshot: async () => ({
            pipeline: [{ id: "plan" }, { id: "tasks" }],
            artifactInferenceRequests: [request("plan"), request("tasks")],
        }),
        commandIds: ["speckit.plan"],
        session: {},
        buildPrompt: async ({ commands }) => commands.map(({ commandId }) => commandId).join(","),
        startWorker: async (_target, { prompt }) => dispatched.push(prompt),
    });
    await new Promise(setImmediate);
    assert.deepEqual(result.requests.map(({ commandId }) => commandId), ["speckit.plan"]);
    assert.deepEqual(dispatched, ["speckit.plan"]);
});

test("scoped inference resolves supported aliases without changing evidence IDs", async (t) => {
    const review = "speckit.extension-wizard-flow-test.review";
    const other = "speckit.extension-wizard-flow-test.audit";
    const requests = [request("plan"), request("tasks"),
        { commandId: review, fingerprint: "a".repeat(64) },
        { commandId: other, fingerprint: "b".repeat(64) }];
    const pipeline = [{ id: "plan" }, { id: "tasks" }, { id: review }, { id: other }];
    for (const [alias, expected] of [
        ["speckit.plan", "speckit.plan"],
        ["speckit-plan", "speckit.plan"],
        ["/speckit-plan", "speckit.plan"],
        [review, review],
        ["speckit-extension-wizard-flow-test-review", review],
        ["/speckit-extension-wizard-flow-test-review", review],
    ]) {
        const inst = fixture();
        t.after(() => clearTimeout(inst.outputInference?.timer));
        const dispatched = [];
        const result = await ensurePipelineOutputInference(inst, {
            getSnapshot: async () => ({ pipeline, artifactInferenceRequests: requests }),
            commandIds: [alias],
            session: {},
            buildPrompt: async ({ commands }) => commands.map(({ commandId }) => commandId).join(","),
            startWorker: async (_target, { prompt }) => dispatched.push(prompt),
        });
        await new Promise(setImmediate);
        assert.deepEqual(result.requests.map(({ commandId }) => commandId), [expected], alias);
        assert.deepEqual(dispatched, [expected], alias);
    }
});

test("scoped inference rejects ambiguous aliases but respects an exact command ID", async (t) => {
    const first = "speckit.example-one.review";
    const second = "speckit.example.one-review";
    const pipeline = [{ id: first }, { id: second }];
    const requests = [
        { commandId: first, fingerprint: "a".repeat(64) },
        { commandId: second, fingerprint: "b".repeat(64) },
    ];
    const inst = fixture();
    t.after(() => clearTimeout(inst.outputInference?.timer));
    const dependencies = {
        getSnapshot: async () => ({ pipeline, artifactInferenceRequests: requests }),
        session: {},
        buildPrompt: async () => "prompt",
        startWorker: async () => {},
    };
    await assert.rejects(ensurePipelineOutputInference(inst, {
        ...dependencies, commandIds: ["speckit-example-one-review"],
    }), /ambiguous command alias/i);
    assert.equal(inst.outputInference, undefined);
    const exact = await ensurePipelineOutputInference(inst, {
        ...dependencies, commandIds: [first],
    });
    assert.deepEqual(exact.requests.map(({ commandId }) => commandId), [first]);
});

test("scoped inference does not enqueue a stale completion after snapshot work", async () => {
    const inst = fixture();
    let resolveSnapshot;
    let current = true;
    const pending = ensurePipelineOutputInference(inst, {
        getSnapshot: () => new Promise((resolve) => { resolveSnapshot = resolve; }),
        commandIds: ["speckit.plan"],
        isCurrent: () => current,
        session: {},
        buildPrompt: async () => "prompt",
        startWorker: async () => assert.fail("stale completion must not start a worker"),
    });
    current = false;
    resolveSnapshot({
        pipeline: [{ id: "plan" }],
        artifactInferenceRequests: [request("plan")],
    });
    assert.deepEqual(await pending, { queued: false, requests: [] });
    assert.equal(inst.outputInference, undefined);
});

test("new pipeline checks share active inference without cancelling useful workers", async (t) => {
    const inst = fixture();
    t.after(() => clearTimeout(inst.outputInference?.timer));
    const dispatched = [];
    const dependencies = (pipeline, requests) => ({
        getSnapshot: async () => ({ pipeline, artifactInferenceRequests: requests }),
        session: {},
        buildPrompt: async ({ commands }) => commands[0].commandId,
        startWorker: async (_target, { prompt }, _session, _isCurrent, workerId) => {
            dispatched.push({ prompt, workerId });
        },
    });
    await ensurePipelineOutputInference(inst, dependencies([{ id: "plan" }], [request("plan")]));
    await new Promise(setImmediate);
    const firstInference = inst.outputInference;
    const firstWorker = [...firstInference.workers.keys()][0];
    await ensurePipelineOutputInference(inst, dependencies([{ id: "tasks" }], [request("tasks")]));
    await new Promise(setImmediate);
    assert.equal(inst.outputInference, firstInference);
    assert.equal(firstInference.workers.size, 1);
    assert.equal(dispatched.length, 1);
    assert.deepEqual(unassignedOutputRequests(firstInference).map(({ commandId }) => commandId),
        ["speckit.tasks"]);
    assert.ok(firstInference.workers.has(firstWorker));
    finishOutputInference(inst, firstInference, firstWorker, ["speckit.plan"]);
    await new Promise(setImmediate);
    assert.equal(firstInference.workers.size, 1);
    assert.equal(dispatched.length, 2);
    assert.equal(dispatched[1].prompt, "speckit.tasks");
});

test("a stale View snapshot cannot requeue evidence committed while it was loading", async (t) => {
    const inst = fixture();
    t.after(() => clearTimeout(inst.outputInference?.timer));
    const intake = request("intake"), define = request("define");
    const dispatched = [];
    const pipeline = [{ id: "speckit.intake" }, { id: "speckit.define" }];
    const deps = {
        session: {},
        buildPrompt: async ({ commands }) => commands.map(({ commandId }) => commandId).join(","),
        startWorker: async (_target, { prompt }) => dispatched.push(prompt),
    };
    await ensurePipelineOutputInference(inst, {
        ...deps, getSnapshot: async () => ({ pipeline, artifactInferenceRequests: [intake] }),
    });
    await new Promise(setImmediate);
    const inference = inst.outputInference;
    const workerId = [...inference.workers.keys()][0];
    let release, reads = 0;
    const staleView = ensurePipelineOutputInference(inst, {
        ...deps, commandIds: ["speckit.intake"],
        getSnapshot: () => ++reads === 1
            ? new Promise((resolve) => { release = () => resolve({ pipeline, artifactInferenceRequests: [intake] }); })
            : Promise.resolve({ pipeline, artifactInferenceRequests: [define] }),
    });
    finishOutputInference(inst, inference, workerId, ["speckit.intake"]);
    release();
    assert.deepEqual(await staleView, { queued: false, requests: [] });
    assert.equal(reads, 2);
    await ensurePipelineOutputInference(inst, {
        ...deps, commandIds: ["speckit.define"],
        getSnapshot: async () => ({ pipeline, artifactInferenceRequests: [define] }),
    });
    await new Promise(setImmediate);
    assert.deepEqual(dispatched, ["speckit.intake", "speckit.define"]);
});

test("admission reports repeated concurrent evidence changes instead of looping indefinitely", async () => {
    const inst = fixture();
    let reads = 0;
    await assert.rejects(ensurePipelineOutputInference(inst, {
        getSnapshot: async () => {
            reads++;
            inst.artifactEvidenceRevision = reads;
            return { pipeline: [], artifactInferenceRequests: [] };
        },
    }), /Artifact evidence changed repeatedly/);
    assert.equal(reads, 3);
    assert.equal(inst.outputInference, undefined);
});

test("reconciliation releases obsolete workers but preserves unresolved mixed assignments", (t) => {
    const inst = fixture();
    t.after(() => clearTimeout(inst.outputInference?.timer));
    const intake = request("intake"), define = request("define");
    const inference = beginOutputInference(inst, [intake, define]);
    const { worker } = createOutputInferenceWorker(inst, inference, [intake, define]);
    const cancelled = [];
    inst.backgroundInferences = new Map([[worker.id, { cancel: () => cancelled.push(worker.id) }]]);
    const resolved = {
        "speckit.intake": { fingerprint: intake.fingerprint, candidates: [{ kind: "none" }], primaryIndex: null },
        "speckit.define": { fingerprint: define.fingerprint, candidates: [] },
    };
    outputInference.reconcileOutputInference(inst, { evidence: resolved, requests: [define] });
    assert.equal(inference.workers.has(worker.id), true);
    assert.deepEqual([...inference.pending.keys()], ["speckit.define"]);
    assert.deepEqual(cancelled, []);
    resolved["speckit.define"] = { fingerprint: define.fingerprint, candidates: [{ kind: "unknown" }], primaryIndex: null };
    outputInference.reconcileOutputInference(inst, { evidence: resolved, requests: [] });
    assert.deepEqual(cancelled, [worker.id]);
    assert.equal(inst.outputInference, null);
});

test("older evidence cannot clear a newer request or its worker", (t) => {
    const inst = fixture();
    t.after(() => clearTimeout(inst.outputInference?.timer));
    const old = request("intake");
    const newer = { ...old, fingerprint: "new" };
    const inference = beginOutputInference(inst, [newer]);
    const { worker } = createOutputInferenceWorker(inst, inference, [newer]);
    outputInference.reconcileOutputInference(inst, {
        evidence: { "speckit.intake": { fingerprint: old.fingerprint, candidates: [], primaryIndex: null } },
        requests: [],
    });
    assert.equal(inference.pending.get("speckit.intake"), newer);
    assert.equal(inference.workers.get(worker.id), worker);
});

test("a newer fingerprint retires an obsolete worker and starts without waiting for its timeout", async (t) => {
    const inst = fixture();
    t.after(() => clearTimeout(inst.outputInference?.timer));
    const old = request("intake");
    const newer = { ...old, fingerprint: "new" };
    const inference = beginOutputInference(inst, [old]);
    const { worker: previous } = createOutputInferenceWorker(inst, inference, [old]);
    const cancelled = [], dispatched = [];
    inst.backgroundInferences = new Map([[previous.id, { cancel: () => cancelled.push(previous.id) }]]);
    await ensurePipelineOutputInference(inst, {
        getSnapshot: async () => ({
            pipeline: [{ id: "speckit.intake" }],
            artifactEvidence: { "speckit.intake": { fingerprint: "new", candidates: [] } },
            artifactInferenceRequests: [newer],
        }),
        session: {},
        buildPrompt: async ({ commands }) => commands[0].fingerprint,
        startWorker: async (_target, { prompt }) => dispatched.push(prompt),
    });
    await new Promise(setImmediate);
    assert.deepEqual(cancelled, [previous.id]);
    assert.deepEqual(dispatched, ["new"]);
    assert.equal(inference.pending.get("speckit.intake"), newer);
    failOutputInference(inst, inference, previous.id, "late failure");
    assert.equal(inference.pending.get("speckit.intake"), newer);
    assert.equal(inference.workers.size, 1);
});

test("resolved evidence suppresses stale status without hiding a new fingerprint", async (t) => {
    const inst = fixture();
    t.after(() => clearTimeout(inst.outputInference?.timer));
    const intake = request("intake"), define = request("define");
    const inference = beginOutputInference(inst, [intake, define]);
    createOutputInferenceWorker(inst, inference, [intake, define]);
    const outputs = {
        evidence: {
            "speckit.intake": { fingerprint: intake.fingerprint, candidates: [{ kind: "none" }], primaryIndex: null },
            "speckit.define": { fingerprint: define.fingerprint, candidates: [] },
        },
        requests: [define], warnings: [], incomplete: false,
    };
    const snap = { pipeline: [{ id: "intake" }, { id: "define" }], phases: {}, warnings: [] };
    await attachOutputEvidence(inst, {}, snap, outputs);
    assert.deepEqual(snap.outputInferenceStatus, { "speckit.define": "updating" });
});

test("a timed-out worker fails only its assignments and the next worker gets a full deadline", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const inst = fixture();
    const intake = request("intake"), define = request("define");
    const inference = beginOutputInference(inst, [intake]);
    const first = createOutputInferenceWorker(inst, inference, [intake]).worker;
    beginOutputInference(inst, [define]);
    let second;
    inference.schedule = () => { second = createOutputInferenceWorker(inst, inference, [define]).worker; };
    t.mock.timers.tick(10 * 60 * 1000);
    assert.equal(inference.failures.has("speckit.intake"), true);
    assert.equal(inference.failures.has("speckit.define"), false);
    assert.equal(inference.pending.has("speckit.define"), true);
    assert.ok(second);
    failOutputInference(inst, inference, first.id, "late failure");
    assert.equal(inference.workers.has(second.id), true);
    t.mock.timers.tick(10 * 60 * 1000 - 1);
    assert.equal(inference.pending.has("speckit.define"), true);
    t.mock.timers.tick(1);
    assert.equal(inference.failures.has("speckit.define"), true);
    t.mock.timers.reset();
});

test("closing the canvas during snapshot prevents starting inference", async () => {
    const inst = fixture();
    let resolveSnapshot, starts = 0;
    const pending = ensurePipelineOutputInference(inst, {
        getSnapshot: () => new Promise((resolve) => { resolveSnapshot = resolve; }),
        session: {},
        buildPrompt: async () => "prompt",
        startWorker: async () => { starts++; },
    });
    inst.closed = true;
    resolveSnapshot({
        pipeline: [{ id: "plan" }],
        artifactInferenceRequests: [request("plan")],
    });
    assert.deepEqual(await pending, { queued: false, requests: [] });
    await new Promise(setImmediate);
    assert.equal(inst.outputInference, undefined);
    assert.equal(starts, 0);
});

test("progress ignores failed work outside the current pipeline request set", (t) => {
    const inst = fixture();
    t.after(() => clearTimeout(inst.outputInference?.timer));
    const unrelated = request("unrelated");
    const inference = beginOutputInference(inst, [unrelated]);
    const { worker } = createOutputInferenceWorker(inst, inference, [unrelated]);
    failOutputInference(inst, inference, worker.id, "worker failed");
    assert.equal(outputInferenceProgress(inst, [request("plan")]), null);
    assert.deepEqual(outputInferenceProgress(inst, [unrelated]), {
        status: "incomplete", total: 1, remaining: 0,
    });
});

test("snapshot progress follows the selected pipeline, including failed work", async (t) => {
    const inst = fixture();
    t.after(() => clearTimeout(inst.outputInference?.timer));
    const outside = request("outside");
    const inference = beginOutputInference(inst, [outside]);
    const { worker } = createOutputInferenceWorker(inst, inference, [outside]);
    failOutputInference(inst, inference, worker.id, "worker failed");
    const outputs = { evidence: {}, requests: [outside], warnings: [], incomplete: false };
    const snap = { pipeline: [{ id: "plan" }], phases: {}, warnings: [] };
    await attachOutputEvidence(inst, {}, snap, outputs);
    assert.equal(snap.outputInferenceProgress, null);
    snap.pipeline = [{ id: "speckit.outside" }];
    await attachOutputEvidence(inst, {}, snap, outputs);
    assert.equal(snap.outputInferenceProgress.status, "incomplete");
});

test("waitForOutputInference resolves once the run stops updating", async () => {
    const inst = fixture();
    const inference = beginOutputInference(inst, [request("plan")]);
    let settled = false;
    const wait = waitForOutputInference(inst, inference, { intervalMs: 5 }).then(() => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(settled, false);
    failOutputInference(inst, inference, undefined, "timed out");
    await wait;
    assert.equal(inference.status, "incomplete");
    clearTimeout(inference.timer);
});

test("pipeline wait completes without waiting for unrelated work", async () => {
    const inst = fixture();
    const selected = request("plan"), unrelated = request("other");
    const inference = beginOutputInference(inst, [selected, unrelated]);
    const { worker } = createOutputInferenceWorker(inst, inference, [selected]);
    const wait = waitForOutputInference(inst, inference, { intervalMs: 5, requests: [selected] });
    failOutputInference(inst, inference, worker.id, "failed");
    await wait;
    assert.equal(inference.status, "updating");
    assert.equal(inference.pending.has("speckit.other"), true);
    clearTimeout(inference.timer);
});
