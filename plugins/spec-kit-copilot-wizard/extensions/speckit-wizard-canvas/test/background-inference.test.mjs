import assert from "node:assert/strict";
import { test } from "node:test";
import { startBackgroundInference, cancelBackgroundInference } from "../canvas-runtime/background-inference.mjs";
import { inferenceTaskApi, inferenceTaskId } from "../contracts/background-inference.mjs";
import {
    beginOutputInference,
    createOutputInferenceWorker,
    failOutputInference,
} from "../canvas-runtime/output-inference.mjs";
import { startRefresh } from "../canvas-runtime/refresh-status.mjs";
import { dispatchKindPrompt } from "../canvas-runtime/dispatch.mjs";
import { setSession } from "../canvas-runtime/instances.mjs";
import { buildCompositionPrompt } from "../prompts/composition.mjs";
import { validateOutputInferenceRequest } from "../contracts/output-inference-request.mjs";

function fixture() {
    const calls = [], cancellations = [];
    const inst = { workspacePath: "C:\\project", url: "http://127.0.0.1:1234", token: "test", broadcast() {} };
    const session = {
        send: () => assert.fail("inference must not enter the foreground conversation"),
        rpc: { tasks: {
            startAgent: async (request) => { calls.push(request); return { agentId: "worker-1" }; },
            cancel: async ({ id }) => { cancellations.push(id); return { cancelled: true }; },
        } },
    };
    return { inst, session, calls, cancellations };
}

test("output inference request accepts scoped and legacy forms and rejects incompatible command IDs", () => {
    assert.deepEqual(validateOutputInferenceRequest({}), {});
    assert.deepEqual(validateOutputInferenceRequest({ commandId: "speckit.plan" }),
        { commandId: "speckit.plan" });
    for (const payload of [[], "plan", { commandId: "" }, { commandId: null },
        { commandId: undefined }, { commandId: " plan " }, { commandId: ["speckit.plan"] }]) {
        assert.throws(() => validateOutputInferenceRequest(payload), /Invalid output inference/);
    }
});

for (const [payload, expected] of [
    [{ commandId: "speckit.plan" }, ["speckit.plan"]],
    [{}, ["speckit.plan", "speckit.tasks"]],
]) {
    test(`output retry dispatch ${payload.commandId ? "scopes to the selected command" : "preserves legacy pipeline scope"}`, async () => {
        const f = fixture();
        const dispatched = [];
        setSession(f.session);
        try {
            const deps = {
                getSnapshot: async () => ({
                    pipeline: [{ id: "plan" }, { id: "tasks" }],
                    artifactInferenceRequests: ["plan", "tasks"].map((id) =>
                        ({ commandId: `speckit.${id}`, fingerprint: id.repeat(64) })),
                }),
                buildInferencePrompt: async ({ commands }) => commands.map(({ commandId }) => commandId).join(","),
                sendInference: async ({ prompt }) => dispatched.push(prompt),
            };
            await dispatchKindPrompt(f.inst, "extension.inferArtifactTargets", payload, deps);
            if (payload.commandId) await dispatchKindPrompt(f.inst, "extension.inferArtifactTargets", payload, deps);
            await new Promise(setImmediate);
            assert.deepEqual([...f.inst.outputInference.pending.values()].map(({ commandId }) => commandId), expected);
            assert.deepEqual(dispatched, [expected.join(",")]);
        } finally {
            setSession(null);
            clearTimeout(f.inst.outputInference?.timer);
        }
    });
}

test("background boundary accepts runtime IDs and rejects unavailable or incompatible exchanges", () => {
    const f = fixture();
    assert.equal(inferenceTaskApi(f.session), f.session.rpc.tasks);
    assert.equal(inferenceTaskId({ agentId: "opaque-runtime-id" }), "opaque-runtime-id");
    for (const session of [null, {}, { rpc: { tasks: { startAgent() {} } } }]) {
        assert.throws(() => inferenceTaskApi(session), /Background inference is unavailable/);
    }
    for (const result of [null, {}, { agentId: "" }, { agentId: 1 }, { taskId: "not-an-agent-id" }]) {
        assert.throws(() => inferenceTaskId(result), /invalid agent ID/);
    }
});

test("background task inherits runtime configuration and is cancellable without a foreground turn", async () => {
    const f = fixture();
    await startBackgroundInference(f.inst, { prompt: "Infer only these commands" }, f.session, () => true);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].agentType, "general-purpose");
    assert.match(f.calls[0].prompt, /C:\\\\project/);
    assert.match(f.calls[0].prompt, /Do not install packages, edit project files, or delegate/);
    assert.match(f.calls[0].prompt, /After the Wizard callback accepts your result.*only `Done\.`/);
    assert.match(f.calls[0].prompt, /Infer only these commands/);
    assert.equal(Object.hasOwn(f.calls[0], "model"), false);
    cancelBackgroundInference(f.inst);
    await new Promise(setImmediate);
    assert.deepEqual(f.cancellations, ["worker-1"]);
});

test("supersession before dispatch starts no task and supersession during admission cancels only the admitted worker", async () => {
    const f = fixture();
    await assert.rejects(startBackgroundInference(f.inst, { prompt: "old" }, f.session, () => false), /superseded/);
    assert.equal(f.calls.length, 0);
    let admit;
    f.session.rpc.tasks.startAgent = () => new Promise((resolve) => { admit = resolve; });
    const old = startBackgroundInference(f.inst, { prompt: "old" }, f.session, () => true);
    cancelBackgroundInference(f.inst);
    const newer = { cancel() {} };
    f.inst.backgroundInference = newer;
    admit({ agentId: "late-worker" });
    await assert.rejects(old, /superseded/);
    await new Promise(setImmediate);
    assert.deepEqual(f.cancellations, ["late-worker"]);
    assert.equal(f.inst.backgroundInference, newer);
});

test("composition pipeline inference runs in one background task through its existing callback", async () => {
    const f = fixture();
    setSession(f.session);
    try {
        await dispatchKindPrompt(f.inst, "composition.refresh", {}, {
            compose: async () => ({ ok: true, stage2Needed: true }),
            getInstalledCounts: async () => ({}),
        });
        await new Promise(setImmediate);
        assert.equal(f.calls.length, 1);
        const runId = f.inst.refreshStatus.id;
        assert.ok(f.calls[0].prompt.includes(`showInferredPipeline({ runId: "${runId}"`));
        assert.equal(f.inst.pipelineInferenceTaskKey, `pipeline:${runId}`);
        assert.equal(f.inst.refreshStatus.pipelinePending, true);
    } finally {
        setSession(null);
        cancelBackgroundInference(f.inst);
        clearTimeout(f.inst.refreshStatus?.timer);
    }
});

test("a newer composition refresh cancels its superseded background task", async () => {
    const f = fixture();
    setSession(f.session);
    try {
        const deps = {
            compose: async () => ({ ok: true, stage2Needed: true }),
            getInstalledCounts: async () => ({}),
        };
        await dispatchKindPrompt(f.inst, "composition.refresh", {}, deps);
        await new Promise(setImmediate);
        await dispatchKindPrompt(f.inst, "composition.refresh", {}, deps);
        await new Promise(setImmediate);
        assert.equal(f.calls.length, 2);
        assert.deepEqual(f.cancellations, ["worker-1"]);
        assert.equal(f.inst.refreshStatus.pipelinePending, true);
    } finally {
        setSession(null);
        cancelBackgroundInference(f.inst);
        clearTimeout(f.inst.refreshStatus?.timer);
    }
});

for (const reason of ["replacement refresh", "replacement inference", "failure"]) {
    test(`${reason} ${reason === "failure" ? "cancels" : "preserves"} the background worker`, async () => {
        const f = fixture();
        const request = { commandId: "speckit.example", fingerprint: "a".repeat(64) };
        const inference = beginOutputInference(f.inst, [request], f.inst.refreshStatus);
        const { worker } = createOutputInferenceWorker(f.inst, inference, [request]);
        const workerKey = worker.id;
        const agentId = "worker-1";
        try {
            await startBackgroundInference(f.inst, { prompt: "infer" }, f.session, () => true, workerKey);
            if (reason === "replacement refresh") startRefresh(f.inst);
            else if (reason === "replacement inference") beginOutputInference(f.inst, [request], f.inst.refreshStatus);
            else failOutputInference(f.inst, inference);
            await new Promise(setImmediate);
            assert.deepEqual(f.cancellations, reason === "failure" ? [agentId] : []);
            if (reason !== "failure") {
                assert.equal(f.inst.backgroundInferences.get(workerKey)?.agentId, agentId);
            }
        } finally {
            clearTimeout(inference.timer);
            clearTimeout(f.inst.outputInference?.timer);
            clearTimeout(f.inst.refreshStatus?.timer);
        }
    });
}

test("pipeline inference uses the runtime background API and retains a retryable failure state", async () => {
    const f = fixture();
    setSession(f.session);
    try {
        const deps = {
            compose: async () => ({ ok: true, stage2Needed: true }),
            getSnapshot: async () => ({ pipeline: [{ id: "speckit.example" }], artifactInferenceRequests: [
                { commandId: "speckit.example", fingerprint: "a".repeat(64) },
            ] }),
            getInstalledCounts: async () => ({}),
            buildInferencePrompt: async ({ commands, endpoint, workspacePath }) =>
                buildCompositionPrompt("extension.inferArtifactTargets",
                    { commands, endpoint, skillSources: [] }, {}, { workspacePath }),
        };
        f.session.rpc.tasks.startAgent = async (request) => {
            f.calls.push(request);
            throw new Error("worker unavailable");
        };
        await dispatchKindPrompt(f.inst, "extension.inferArtifactTargets", {}, deps);
        await new Promise(setImmediate);
        await new Promise(setImmediate);
        assert.equal(f.calls.length, 1);
        assert.equal(f.inst.outputInference.status, "incomplete");
        assert.equal(f.inst.refreshStatus, undefined);
        f.session.rpc.tasks.startAgent = async (request) => {
            f.calls.push(request);
            throw new Error("worker unavailable");
        };
        await dispatchKindPrompt(f.inst, "extension.inferArtifactTargets", {}, deps);
        await new Promise(setImmediate);
        await new Promise(setImmediate);
        assert.equal(f.calls.length, 2);
        assert.equal(f.inst.outputInference.status, "incomplete");
        assert.equal(f.inst.refreshStatus, undefined);
    } finally {
        setSession(null);
        cancelBackgroundInference(f.inst);
        clearTimeout(f.inst.outputInference?.timer);
        clearTimeout(f.inst.refreshStatus?.timer);
    }
});
