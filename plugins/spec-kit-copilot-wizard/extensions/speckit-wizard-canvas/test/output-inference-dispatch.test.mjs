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
