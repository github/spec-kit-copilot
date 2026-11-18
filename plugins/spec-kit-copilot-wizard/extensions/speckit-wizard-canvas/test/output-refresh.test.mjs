import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { buildCatalogPrompt } from "../prompts/catalog.mjs";
import { buildCompositionPrompt } from "../prompts/composition.mjs";
import {
    beginOutputInference as beginInferenceGroup,
    createOutputInferenceWorker,
    failOutputInference as failInferenceWorker,
    finishOutputInference as finishInferenceWorker,
    unassignedOutputRequests,
} from "../canvas-runtime/output-inference.mjs";
import { commandId } from "../artifact-evidence.mjs";
import { dispatchKindPrompt } from "../canvas-runtime/dispatch.mjs";
import { failRefresh, finishRefreshPart, setRefreshWork, startRefresh } from "../canvas-runtime/refresh-status.mjs";
import { validateCandidates } from "../artifact-evidence.mjs";
import { attachOutputEvidence } from "../canvas-runtime/output-availability.mjs";
import { compositionActions } from "../canvas-runtime/actions/composition.mjs";
import { runFastComposition } from "../canvas-runtime/composition-apply.mjs";
import { catalogActions } from "../canvas-runtime/actions/catalog.mjs";
import { allInstances, fsDeps, getInstance } from "../canvas-runtime/instances.mjs";
import { commitOwnedFile } from "../canvas-runtime/owned-commit.mjs";
import { normalizeState, writeState } from "../state/store.mjs";
import { assertReplyRunId, replyRunIdSchema } from "../contracts/agent-replies.mjs";
import { inferredPipelineInputSchema } from "../contracts/agent-pipeline.mjs";

test("both reply paths share the originating run ID contract", () => {
    const id = randomUUID();
    assert.equal(inferredPipelineInputSchema.properties.runId, replyRunIdSchema);
    assert.ok(inferredPipelineInputSchema.required.includes("runId"));
    assert.doesNotThrow(() => assertReplyRunId(id, id));
    for (const invalid of [undefined, null, 1, "", "not-a-run", "00000000-0000-4000-8000-00000000000A"]) {
        assert.throws(() => assertReplyRunId(invalid, id), { status: 400 });
    }
    assert.throws(() => assertReplyRunId(id, randomUUID()), { status: 409 });
    assert.throws(() => assertReplyRunId(id, null), { status: 409 });
});

const request = { commandId: "speckit.plan", fingerprint: "a".repeat(64) };
const instance = () => ({ url: "http://127.0.0.1:1234", token: "test-token", broadcast() {} });

function beginOutputInference(inst, requests) {
    const inference = beginInferenceGroup(inst, requests);
    let worker;
    const unassigned = unassignedOutputRequests(inference);
    if (unassigned.length) {
        ({ worker } = createOutputInferenceWorker(inst, inference, unassigned));
    } else {
        worker = [...inference.workers.values()].find((candidate) =>
            requests.every((item) => candidate.requests.get(commandId(item.commandId))?.fingerprint
                === item.fingerprint));
    }
    if (!worker) throw new Error("No worker was assigned to the requested inference");
    const endpoint = new URL("/api/artifact-targets", inst.url);
    endpoint.searchParams.set("token", inst.token);
    endpoint.searchParams.set("runId", worker.id);
    return endpoint;
}

function finishOutputInference(inst, inference, commands) {
    const completed = new Set(commands.map(commandId));
    const worker = [...inference.workers.values()].find((candidate) =>
        [...completed].every((id) => candidate.requests.has(id)));
    if (!worker) return false;
    return finishInferenceWorker(inst, inference, worker.id, commands);
}

function failOutputInference(inst, inference) {
    for (const workerId of [...inference.workers.keys()]) {
        failInferenceWorker(inst, inference, workerId);
    }
}

function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

const dispatchDeps = (send) => ({
    compose: async () => ({ ok: true, stage2Needed: true }),
    getSnapshot: async () => ({ artifactInferenceRequests: [request] }),
    getInstalledCounts: async () => ({}),
    buildInferencePrompt: async ({ commands, endpoint, workspacePath }) =>
        buildCompositionPrompt("extension.inferArtifactTargets",
            { commands, endpoint, skillSources: [] }, {}, { workspacePath }),
    send,
    sendInference: send,
});

async function actionFixture(run) {
    const root = await mkdtemp(join(import.meta.dirname, ".refresh-fixture-"));
    const id = randomUUID();
    const inst = getInstance(id);
    Object.assign(inst, instance(), { workspacePath: root });
    try {
        await mkdir(join(root, ".specify"));
        await run(inst);
    } finally {
        clearTimeout(inst.refreshStatus?.timer);
        clearTimeout(inst.outputInference?.timer);
        allInstances().delete(id);
        await rm(root, { recursive: true, force: true });
    }
}

for (const replacement of ["refresh", "inference"]) {
    test(`owned swap and publication finish before queued ${replacement} work`, async () => {
        await actionFixture(async (inst) => {
            startRefresh(inst);
            beginOutputInference(inst, [request], inst.refreshStatus);
            const refresh = inst.refreshStatus;
            const inference = inst.outputInference;
            const temp = join(inst.workspacePath, "prepared.tmp");
            const target = join(inst.workspacePath, "committed.json");
            await writeFile(temp, "current payload");
            let published = false;
            commitOwnedFile(temp, target, () => {
                assert.equal(inst.refreshStatus, refresh);
                assert.equal(inst.outputInference, inference);
                queueMicrotask(() => {
                    if (replacement === "refresh") startRefresh(inst);
                    beginOutputInference(inst, [request], inst.refreshStatus);
                });
            }, () => {
                assert.equal(inst.refreshStatus, refresh);
                assert.equal(inst.outputInference, inference);
                published = true;
            });
            assert.equal(published, true);
            assert.equal(inst.outputInference, inference);
            await new Promise(setImmediate);
            assert.equal(inst.outputInference, inference);
            assert.equal(await readFile(target, "utf8"), "current payload");
        });
    });
}

test("owned swap rejects a stale owner and never publishes after a failed rename", async () => {
    await actionFixture(async (inst) => {
        const temp = join(inst.workspacePath, "prepared.tmp");
        const target = join(inst.workspacePath, "committed.json");
        await writeFile(temp, "new payload");
        await writeFile(target, "old payload");
        let published = false;
        assert.throws(() => commitOwnedFile(temp, target, () => {
            throw new Error("stale owner");
        }, () => { published = true; }), /stale owner/);
        assert.equal(await readFile(target, "utf8"), "old payload");
        assert.equal(published, false);
        assert.throws(() => commitOwnedFile(join(inst.workspacePath, "missing.tmp"), target,
            () => {}, () => { published = true; }), { code: "ENOENT" });
        assert.equal(await readFile(target, "utf8"), "old payload");
        assert.equal(published, false);
    });
});

test("owned state retry rechecks refresh ownership before another rename", async () => {
    await actionFixture(async (inst) => {
        await mkdir(join(inst.workspacePath, ".speckit-wizard"));
        const statePath = join(inst.workspacePath, ".speckit-wizard", "state.json");
        await writeFile(statePath, "previous state");
        startRefresh(inst);
        const owner = inst.refreshStatus;
        let attempts = 0;
        let published = false;
        const assertCurrent = () => {
            if (inst.refreshStatus !== owner) throw new Error("stale owner");
        };

        await assert.rejects(writeState(inst.workspacePath, inst.state, {
            ...fsDeps,
            platform: "win32",
            waitForRenameRetry: async () => { startRefresh(inst); },
        }, (temp, target) => {
            attempts++;
            if (attempts === 1) {
                assertCurrent();
                throw Object.assign(new Error("temporary sharing violation"), { code: "EPERM" });
            }
            commitOwnedFile(temp, target, assertCurrent, () => { published = true; });
        }), /stale owner/);

        assert.equal(attempts, 2);
        assert.equal(published, false);
        assert.equal(await readFile(statePath, "utf8"), "previous state");
        assert.deepEqual((await readdir(join(inst.workspacePath, ".speckit-wizard")))
            .filter((name) => name.endsWith(".tmp")), []);
    });
});

for (const pause of ["state read", "queued state write", "temporary state write"]) {
    for (const replacementFails of [false, true]) {
        test(`pipeline replacement during ${pause}${replacementFails ? " with failed assembly" : ""} preserves saved and cached ordering`, async () => {
            await actionFixture(async (inst) => {
                const order = ["commands/speckit.specify", "commands/speckit.plan", "commands/speckit.tasks"];
                const composition = { artifacts: order.map((id) => ({ id, kind: "command" })),
                    inferredPipeline: { shape: "standalone", pipeline: order, unplaced: [], rationale: "Keep this order" } };
                inst.cachedComposition = composition;
                inst.state = normalizeState({ composition, currentPhase: "plan" });
                await mkdir(join(inst.workspacePath, ".speckit-wizard"));
                const statePath = join(inst.workspacePath, ".speckit-wizard", "state.json");
                const saved = JSON.stringify(inst.state, null, 2) + "\n";
                await writeFile(statePath, saved);
                startRefresh(inst);
                const oldRefresh = inst.refreshStatus;
                const originalDeps = { ...fsDeps };
                const entered = deferred(), release = deferred();
                const frames = [];
                inst.broadcast = (frame) => frames.push(frame);
                let blocker;
                try {
                    if (pause === "queued state write") {
                        const blocking = deferred();
                        blocker = writeState(inst.workspacePath, inst.state, {
                            ...fsDeps, mkdir: async () => { blocking.resolve(); await release.promise; },
                            writeFile: async () => {}, rename: async () => {},
                        });
                        await blocking.promise;
                    }
                    fsDeps.readFile = async (path, ...args) => {
                        if (path === statePath && pause !== "temporary state write") {
                            entered.resolve();
                            if (pause === "state read") await release.promise;
                        }
                        return originalDeps.readFile(path, ...args);
                    };
                    fsDeps.writeFile = async (path, ...args) => {
                        await originalDeps.writeFile(path, ...args);
                        if (pause === "temporary state write" && path.endsWith(".tmp")) {
                            entered.resolve();
                            await release.promise;
                        }
                    };
                    const running = compositionActions[0].handler({ instanceId: inst.instanceId, input: {
                        runId: oldRefresh.id,
                        inferredPipeline: { shape: "standalone", pipeline: [...order].reverse(),
                            unplaced: [], rationale: "Superseded old reply" },
                    } });
                    await entered.promise;
                    await new Promise(setImmediate);
                    assert.equal(inst.cachedComposition, composition);
                    assert.equal(await readFile(statePath, "utf8"), saved);
                    startRefresh(inst);
                    if (replacementFails) failRefresh(inst, inst.refreshStatus);
                    const current = inst.refreshStatus;
                    const currentState = inst.state;
                    frames.length = 0;
                    release.resolve();
                    const result = await running;
                    await blocker;
                    assert.equal(result.ok, false);
                    assert.equal(result.inferredPipelineStatus.accepted, false);
                    assert.match(result.inferredPipelineStatus.reason, /runId is no longer current/);
                    assert.equal(inst.refreshStatus, current);
                    assert.equal(current.status, replacementFails ? "incomplete" : "refreshing");
                    assert.equal(current.pipelinePending, true);
                    assert.equal(current.outputsPending, false);
                    assert.equal(inst.cachedComposition, composition);
                    assert.equal(inst.state, currentState);
                    assert.equal(await readFile(statePath, "utf8"), saved);
                    assert.deepEqual((await readdir(join(inst.workspacePath, ".speckit-wizard")))
                        .filter((name) => name.endsWith(".tmp")), []);
                    assert.deepEqual(frames, []);
                } finally {
                    release.resolve();
                    await blocker;
                    Object.assign(fsDeps, originalDeps);
                }
            });
        });
    }
}

test("pipeline replacement during the postcommit scan cannot publish or install an old snapshot", async () => {
    await actionFixture(async (inst) => {
        const order = ["commands/speckit.specify", "commands/speckit.plan", "commands/speckit.tasks"];
        const composition = { artifacts: order.map((id) => ({ id, kind: "command" })) };
        inst.cachedComposition = composition;
        inst.state = normalizeState({ composition, currentPhase: "plan" });
        await mkdir(join(inst.workspacePath, ".speckit-wizard"));
        const statePath = join(inst.workspacePath, ".speckit-wizard", "state.json");
        await writeFile(statePath, JSON.stringify(inst.state));
        startRefresh(inst);
        const oldRefresh = inst.refreshStatus;
        const originalRead = fsDeps.readFile;
        const entered = deferred(), release = deferred();
        let stateReads = 0;
        const frames = [];
        try {
            fsDeps.readFile = async (path, ...args) => {
                if (path === statePath && ++stateReads === 2) {
                    entered.resolve();
                    await release.promise;
                }
                return originalRead(path, ...args);
            };
            const running = compositionActions[0].handler({ instanceId: inst.instanceId, input: {
                runId: oldRefresh.id, inferredPipeline: { shape: "standalone", pipeline: order,
                    unplaced: [], rationale: "Committed before replacement" },
            } });
            await entered.promise;
            assert.deepEqual(JSON.parse(await readFile(statePath, "utf8")).composition.inferredPipeline.pipeline, order);
            assert.equal(oldRefresh.pipelinePending, false);
            const duplicate = await compositionActions[0].handler({ instanceId: inst.instanceId, input: {
                runId: oldRefresh.id, inferredPipeline: { shape: "standalone", pipeline: [...order].reverse(),
                    unplaced: [], rationale: "Duplicate before the first scan returns" },
            } });
            assert.equal(duplicate.ok, false);
            assert.equal(duplicate.inferredPipelineStatus.accepted, false);
            assert.deepEqual(JSON.parse(await readFile(statePath, "utf8")).composition.inferredPipeline.pipeline, order);
            startRefresh(inst);
            const currentState = normalizeState({ currentPhase: "tasks" });
            const currentScan = { marker: "new scan" };
            const currentComposition = { ...composition, refreshedAt: "new composition" };
            inst.state = currentState;
            inst.cwdBoundState = currentScan;
            inst.cachedComposition = currentComposition;
            inst.broadcast = (frame) => frames.push(frame);
            release.resolve();
            const result = await running;
            assert.equal(result.inferredPipelineStatus.accepted, true);
            assert.equal(inst.state, currentState);
            assert.equal(inst.cwdBoundState, currentScan);
            assert.equal(inst.cachedComposition, currentComposition);
            assert.equal(inst.refreshStatus.pipelinePending, true);
            assert.deepEqual(frames, []);
        } finally {
            release.resolve();
            fsDeps.readFile = originalRead;
        }
    });
});

for (const failure of ["preparation", "swap"]) {
    test(`failed pipeline ${failure} does not publish staged composition or report persistence success`, async () => {
        await actionFixture(async (inst) => {
            const order = ["commands/speckit.specify", "commands/speckit.plan", "commands/speckit.tasks"];
            const composition = { artifacts: order.map((id) => ({ id, kind: "command" })) };
            inst.cachedComposition = composition;
            inst.state = normalizeState({ composition });
            const originalState = inst.state;
            startRefresh(inst);
            const originalWrite = fsDeps.writeFile;
            const frames = [];
            inst.broadcast = (frame) => frames.push(frame);
            try {
                fsDeps.writeFile = async (path, ...args) => {
                    await originalWrite(path, ...args);
                    if (failure === "preparation") throw new Error("temporary write failed");
                    await rm(path);
                };
                await assert.rejects(compositionActions[0].handler({ instanceId: inst.instanceId, input: {
                    runId: inst.refreshStatus.id, inferredPipeline: { shape: "standalone", pipeline: order,
                        unplaced: [], rationale: "Cannot commit this payload" },
                } }), failure === "preparation" ? /temporary write failed/ : { code: "ENOENT" });
                assert.equal(inst.cachedComposition, composition);
                assert.equal(inst.state, originalState);
                assert.equal(inst.refreshStatus.pipelinePending, true);
                assert.deepEqual(frames, []);
                assert.deepEqual((await readdir(join(inst.workspacePath, ".speckit-wizard")))
                    .filter((name) => name.endsWith(".tmp")), []);
            } finally {
                fsDeps.writeFile = originalWrite;
            }
        });
    });
}

for (const refreshing of [false, true]) {
    test(`superseded fast composition ${refreshing ? "with" : "without"} a prior refresh cannot commit staged state`, async () => {
        await actionFixture(async (inst) => {
            const composition = { artifacts: [], presets: [], extensions: [] };
            inst.cachedComposition = composition;
            inst.state = normalizeState({ composition });
            const originalState = inst.state;
            await mkdir(join(inst.workspacePath, ".speckit-wizard"));
            const statePath = join(inst.workspacePath, ".speckit-wizard", "state.json");
            const saved = JSON.stringify(inst.state, null, 2) + "\n";
            await writeFile(statePath, saved);
            if (refreshing) startRefresh(inst);
            const originalWrite = fsDeps.writeFile;
            const entered = deferred(), release = deferred();
            const frames = [];
            inst.broadcast = (frame) => frames.push(frame);
            try {
                fsDeps.writeFile = async (path, ...args) => {
                    await originalWrite(path, ...args);
                    entered.resolve();
                    await release.promise;
                };
                const running = runFastComposition(inst, { reason: "refresh-button" });
                await entered.promise;
                startRefresh(inst);
                failRefresh(inst, inst.refreshStatus);
                frames.length = 0;
                release.resolve();
                const result = await running;
                assert.equal(result.ok, false);
                assert.match(result.reason, /superseded/);
                assert.equal(await readFile(statePath, "utf8"), saved);
                assert.equal(inst.cachedComposition, composition);
                assert.equal(inst.state, originalState);
                assert.equal(inst.refreshStatus.status, "incomplete");
                assert.deepEqual(frames.filter((frame) => ["state", "composition"].includes(frame.type)), []);
                assert.deepEqual((await readdir(join(inst.workspacePath, ".speckit-wizard")))
                    .filter((name) => name.endsWith(".tmp")), []);
            } finally {
                release.resolve();
                fsDeps.writeFile = originalWrite;
            }
        });
    });
}

for (const reply of ["missing", "malformed", "delayed", "duplicate", "expired"]) {
    test(`${reply} pipeline reply cannot change persisted ordering or complete the current refresh`, async () => {
        await actionFixture(async (inst) => {
            const pipeline = ["commands/speckit.specify", "commands/speckit.plan", "commands/speckit.tasks"];
            const composition = { artifacts: pipeline.map((id) => ({ id, kind: "command" })),
                inferredPipeline: { shape: "standalone", pipeline, unplaced: [], rationale: "Current order" } };
            inst.cachedComposition = composition;
            inst.state = { composition };
            await mkdir(join(inst.workspacePath, ".speckit-wizard"));
            const statePath = join(inst.workspacePath, ".speckit-wizard", "state.json");
            const saved = JSON.stringify(inst.state);
            await writeFile(statePath, saved);
            startRefresh(inst);
            const oldRunId = inst.refreshStatus.id;
            if (reply === "delayed") startRefresh(inst);
            if (reply === "duplicate") finishRefreshPart(inst, "pipeline", inst.refreshStatus);
            if (reply === "expired") failRefresh(inst, inst.refreshStatus);
            const current = inst.refreshStatus;
            const frames = [];
            inst.broadcast = (frame) => frames.push(frame);
            const result = await compositionActions[0].handler({ instanceId: inst.instanceId, input: {
                runId: reply === "missing" ? undefined : reply === "malformed" ? "bad" : oldRunId,
                inferredPipeline: { shape: "standalone", pipeline: [...pipeline].reverse(),
                    unplaced: [], rationale: "Delayed old order" },
            } });
            assert.equal(result.ok, false);
            assert.equal(result.inferredPipelineStatus.accepted, false);
            assert.match(result.inferredPipelineStatus.reason,
                reply === "missing" || reply === "malformed" ? /runId is required/ : /runId is no longer current/);
            assert.equal(inst.cachedComposition, composition);
            assert.equal(await readFile(statePath, "utf8"), saved);
            assert.equal(inst.refreshStatus, current);
            assert.equal(current.status, reply === "expired" ? "incomplete"
                : reply === "duplicate" ? "up-to-date" : "refreshing");
            assert.equal(current.pipelinePending, reply !== "duplicate");
            assert.equal(current.outputsPending, false);
            assert.deepEqual(frames, []);
        });
    });
}

test("pipeline prompt requires the captured runId and artifact prompts retain the full originating endpoint", () => {
    const runId = randomUUID();
    const endpoint = `http://127.0.0.1:1234/api/artifact-targets?token=test-token&runId=${randomUUID()}`;
    assert.throws(() => buildCompositionPrompt("composition.refresh", {}, {},
        { workspacePath: "C:\\workspace" }), /runId is required/);
    const pipeline = buildCompositionPrompt("composition.refresh", { runId }, {},
        { workspacePath: "C:\\workspace" });
    assert.ok(pipeline.includes(`showInferredPipeline({ runId: "${runId}"`));
    assert.match(pipeline, /never read a newer runId/);
    const outputs = buildCompositionPrompt("extension.inferArtifactTargets",
        { commands: [request], endpoint }, {}, { workspacePath: "C:\\workspace" });
    assert.ok(outputs.includes(`POST ${endpoint}`));
    assert.match(outputs, /Never reconstruct it or substitute a newer endpoint/);
});

test("accepted pipeline callback releases its background task", async () => {
    await actionFixture(async (inst) => {
        const pipeline = ["commands/speckit.specify", "commands/speckit.plan", "commands/speckit.tasks"];
        inst.cachedComposition = { artifacts: pipeline.map((id) => ({ id, kind: "command" })) };
        const refresh = startRefresh(inst);
        const taskKey = `pipeline:${refresh.id}`;
        inst.pipelineInferenceTaskKey = taskKey;
        inst.backgroundInferences = new Map([[taskKey, { cancel() {} }]]);
        const result = await compositionActions[0].handler({ instanceId: inst.instanceId, input: {
            runId: refresh.id,
            inferredPipeline: { shape: "standalone", pipeline, unplaced: [], rationale: "Specify, plan, then tasks" },
        } });
        assert.equal(result.inferredPipelineStatus.accepted, true);
        assert.equal(inst.backgroundInferences.has(taskKey), false);
        assert.equal(inst.pipelineInferenceTaskKey, undefined);
        assert.equal(refresh.status, "up-to-date");
    });
});

for (const kind of ["composition.refresh", "composition.inferPipeline", "extension.inferArtifactTargets"]) {
    test(`${kind} dispatch uses its own correlated background task or callback rather than caller run IDs`, async () => {
        const inst = instance();
        const sent = [];
        const tasks = [];
        try {
            const deps = dispatchDeps((message) => sent.push(message));
            deps.startInferenceTask = async (_inst, { prompt }, _session, isCurrent, taskKey) => {
                assert.equal(isCurrent(), true);
                tasks.push({ prompt, taskKey });
            };
            const result = await dispatchKindPrompt(inst, kind, { runId: randomUUID(), endpoint: "caller-endpoint" },
                deps);
            await new Promise(setImmediate);
            if (kind !== "extension.inferArtifactTargets") {
                assert.equal(sent.length, 0);
                assert.equal(tasks.length, 1);
                const prompt = tasks[0].prompt;
                assert.ok(prompt.includes(`runId: "${inst.refreshStatus.id}"`));
                assert.ok(!prompt.includes("/api/artifact-targets?"));
                assert.equal(tasks[0].taskKey, `pipeline:${inst.refreshStatus.id}`);
            } else {
                assert.equal(tasks.length, 0);
                assert.equal(sent.length, 1);
                const prompt = sent[0].prompt;
                const match = prompt.match(/http:\/\/127\.0\.0\.1:1234\/api\/artifact-targets\?[^ )]+/);
                assert.ok(match);
                const runId = new URL(match[0]).searchParams.get("runId");
                assert.ok(prompt.includes(`runId=${runId}`));
                assert.equal(inst.refreshStatus, undefined);
                assert.equal(result.fastComposition, true);
            }
            assert.ok(![...sent, ...tasks].some((item) => item.prompt?.includes("caller-endpoint")));
        } finally {
            clearTimeout(inst.refreshStatus?.timer);
            clearTimeout(inst.outputInference?.timer);
        }
    });
}

test("starting a refresh leaves useful output inference active", () => {
    const inst = instance();
    startRefresh(inst);
    beginOutputInference(inst, [request], inst.refreshStatus);
    const refresh = inst.refreshStatus;
    const inference = inst.outputInference;
    try {
        const next = startRefresh(inst);
        assert.equal(next, inst.refreshStatus);
        assert.notEqual(next, refresh);
        assert.equal(inst.outputInference, inference);
        assert.equal(refresh.timer._destroyed, true);
        assert.equal(inference.timer._destroyed, false);
        assert.equal(inference.pending.size, 1);
    } finally {
        clearTimeout(inst.refreshStatus.timer);
        clearTimeout(inference.timer);
    }
});

test("refresh ownership is independent from output inference ownership", () => {
    const inst = instance();
    startRefresh(inst);
    const previous = inst.refreshStatus;
    startRefresh(inst);
    const current = inst.refreshStatus;
    try {
        setRefreshWork(inst, { pipeline: false, outputs: false }, previous);
        finishRefreshPart(inst, "pipeline", previous);
        failRefresh(inst, previous);
        beginOutputInference(inst, [request]);
        assert.equal(inst.refreshStatus, current);
        assert.equal(current.status, "refreshing");
        assert.equal(current.pipelinePending, true);
        assert.equal(current.outputsPending, false);
        assert.equal(inst.outputInference.status, "updating");
        assert.equal(current.timer._destroyed, false);
    } finally {
        clearTimeout(current.timer);
    }
});

test("a failed output worker does not fail composition refresh", () => {
    const inst = instance();
    startRefresh(inst);
    beginOutputInference(inst, [request], inst.refreshStatus);
    const inference = inst.outputInference;
    try {
        failOutputInference(inst, inference);
        assert.equal(inst.outputInference.status, "incomplete");
        assert.equal(inst.outputInference.timer, null);
        assert.equal(inst.refreshStatus.status, "refreshing");
    } finally {
        clearTimeout(inst.outputInference.timer);
        clearTimeout(inst.refreshStatus.timer);
    }
});

test("output timeout does not fail or complete the composition refresh", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const inst = instance();
    try {
        startRefresh(inst);
        beginOutputInference(inst, [request], inst.refreshStatus);
        t.mock.timers.tick(9 * 60 * 1000);
        const refresh = startRefresh(inst);
        t.mock.timers.tick(60 * 1000);
        assert.equal(inst.refreshStatus, refresh);
        assert.equal(inst.refreshStatus.status, "refreshing");
        assert.equal(inst.outputInference.status, "incomplete");
        t.mock.timers.tick(9 * 60 * 1000);
        assert.equal(inst.refreshStatus.status, "incomplete");
    } finally {
        t.mock.timers.reset();
    }
});

test("a failed evidence scan retains warnings without failing a newer refresh", async () => {
    const inst = instance();
    startRefresh(inst);
    const previous = inst.refreshStatus;
    startRefresh(inst);
    try {
        const snap = { warnings: [], phases: {}, commands: [] };
        await attachOutputEvidence(inst, {}, snap, {
            evidence: {}, requests: [], incomplete: true, warnings: ["old source read failed"],
        }, undefined, previous);
        assert.deepEqual(snap.warnings, ["old source read failed"]);
        assert.equal(snap.artifactEvidenceIncomplete, true);
        assert.equal(snap.refreshStatus, "refreshing");
        assert.equal(inst.refreshStatus.status, "refreshing");
    } finally {
        clearTimeout(inst.refreshStatus.timer);
    }
});

test("a pipeline accepted before an await cannot complete a refresh started during persistence", async () => {
    await actionFixture(async (inst) => {
        const pipeline = ["commands/speckit.specify", "commands/speckit.plan", "commands/speckit.tasks"];
        inst.cachedComposition = { artifacts: pipeline.map((id) => ({ id, kind: "command" })) };
        startRefresh(inst);
        const runId = inst.refreshStatus.id;
        inst.broadcast = (frame) => {
            if (frame.type === "composition") startRefresh(inst);
        };
        const result = await compositionActions[0].handler({ instanceId: inst.instanceId, input: {
            runId,
            inferredPipeline: { shape: "standalone", pipeline,
                unplaced: [], rationale: "Specify, plan, then tasks" },
        } });
        assert.equal(result.inferredPipelineStatus.accepted, true);
        assert.equal(inst.refreshStatus.status, "refreshing");
        assert.equal(inst.refreshStatus.pipelinePending, true);
    });
});

for (const replacement of ["refresh", "inference"]) {
    test(`a delayed catalog push is isolated from newer ${replacement} work`, async () => {
        await actionFixture(async (inst) => {
            let currentInference;
            let replaced = false;
            inst.broadcast = (frame) => {
                if (frame.type !== "state" || replaced) return;
                replaced = true;
                if (replacement === "refresh") startRefresh(inst);
                beginOutputInference(inst, [request], inst.refreshStatus);
                currentInference = inst.outputInference;
            };
            const action = catalogActions.find(({ name }) => name === "showExtensionCatalog");
            const pending = action.handler({ instanceId: inst.instanceId, input: { items: [] } });
            if (replacement === "refresh") {
                await assert.rejects(pending, /superseded/);
            } else {
                assert.equal((await pending).ok, true);
            }
            assert.ok(replaced);
            assert.equal(inst.outputInference, currentInference);
            assert.equal(currentInference.status, "updating");
            assert.equal(currentInference.timer._destroyed, false);
        });
    });
}

for (const refreshing of [false, true]) {
    test(`a catalog push ${refreshing ? "with" : "without"} a refresh can finish when its output completes during persistence`, async () => {
        await actionFixture(async (inst) => {
            if (refreshing) startRefresh(inst);
            beginOutputInference(inst, [request], inst.refreshStatus);
            const inference = inst.outputInference;
            inst.broadcast = (frame) => {
                if (frame.type === "state") finishOutputInference(inst, inference, ["speckit.plan"]);
            };
            const action = catalogActions.find(({ name }) => name === "showExtensionCatalog");
            const result = await action.handler({ instanceId: inst.instanceId, input: { items: [] } });
            assert.equal(result.ok, true);
            assert.equal(inference.pending.size, 0);
            assert.equal(inference.timer, null);
            if (!refreshing) assert.equal(inst.refreshStatus, undefined);
        });
    });
}

test("a refresh-less catalog push does not couple to inference work during persistence", async () => {
    await actionFixture(async (inst) => {
        beginOutputInference(inst, [request], inst.refreshStatus);
        const previous = inst.outputInference;
        let replacement;
        inst.broadcast = (frame) => {
            if (frame.type !== "state" || replacement) return;
            beginOutputInference(inst, [{ ...request, commandId: "speckit.tasks" }], inst.refreshStatus);
            replacement = inst.outputInference;
            finishOutputInference(inst, replacement, ["speckit.tasks"]);
        };
        const action = catalogActions.find(({ name }) => name === "showExtensionCatalog");
        const result = await action.handler({ instanceId: inst.instanceId, input: { items: [] } });
        assert.equal(result.ok, true);
        assert.ok(replacement);
        assert.equal(replacement, previous);
        assert.equal(previous.pending.size, 1);
        assert.equal(previous.workers.size, 1);
        assert.equal(inst.outputInference, previous);
        assert.equal(inst.refreshStatus, undefined);
    });
});

for (const [stage, value, failure] of [
    ["compose", { ok: true, stage2Needed: true }],
    ["getInstalledCounts", {}],
    ["getInstalledCounts", null, "installed-count probe failed"],
]) {
    test(`superseded composition dispatch ${failure ? "failure" : "result"} at ${stage} preserves current work`, async () => {
        const inst = instance();
        const entered = deferred();
        const waiting = deferred();
        const sent = [];
        const deps = dispatchDeps((message) => sent.push(message));
        deps[stage] = () => { entered.resolve(); return waiting.promise; };
        const running = dispatchKindPrompt(inst, "composition.refresh", {}, deps);
        await entered.promise;
        const refresh = startRefresh(inst);
        beginOutputInference(inst, [request], refresh);
        setRefreshWork(inst, { pipeline: true, outputs: false }, refresh);
        const inference = inst.outputInference;
        try {
            if (failure) waiting.reject(new Error(failure));
            else waiting.resolve(value);
            await assert.rejects(running, failure ? /installed-count probe failed/ : /superseded/);
            assert.equal(inst.refreshStatus, refresh);
            assert.equal(refresh.status, "refreshing");
            assert.equal(refresh.pipelinePending, true);
            assert.equal(refresh.outputsPending, false);
            assert.equal(refresh.timer._destroyed, false);
            assert.equal(inst.outputInference, inference);
            assert.equal(inference.status, "updating");
            assert.equal(inference.timer._destroyed, false);
            assert.deepEqual(sent, []);
        } finally {
            clearTimeout(refresh.timer);
            clearTimeout(inference.timer);
        }
    });
}

test("a queued refresh task is skipped if a newer refresh starts before dispatch", async () => {
    const inst = instance();
    const tasks = [];
    try {
        const deps = dispatchDeps(() => assert.fail("pipeline inference must not enter chat"));
        deps.startInferenceTask = async (...args) => { tasks.push(args); };
        await dispatchKindPrompt(inst, "composition.refresh", {}, deps);
        startRefresh(inst);
        await new Promise(setImmediate);
        assert.deepEqual(tasks, []);
        assert.equal(inst.refreshStatus.status, "refreshing");
        assert.equal(inst.refreshStatus.pipelinePending, true);
        assert.equal(inst.refreshStatus.outputsPending, false);
    } finally {
        clearTimeout(inst.refreshStatus.timer);
        clearTimeout(inst.outputInference?.timer);
    }
});

for (const retry of [null, "refresh", "inference"]) {
    test(`background task admission failure after ${retry ?? "no replacement"} affects only its owning work`, async () => {
        const inst = instance();
        const entered = deferred();
        const transport = deferred();
        try {
            const deps = dispatchDeps(() => assert.fail("pipeline inference must not enter chat"));
            deps.startInferenceTask = () => {
                entered.resolve();
                return transport.promise;
            };
            await dispatchKindPrompt(inst, "composition.refresh", {}, deps);
            await entered.promise;
            if (retry === "refresh") {
                startRefresh(inst);
            }
            if (retry === "refresh" || retry === "inference") {
                beginOutputInference(inst, [request], inst.refreshStatus);
            }
            const refresh = inst.refreshStatus;
            const inference = inst.outputInference;
            transport.reject(new Error("session unavailable"));
            await new Promise(setImmediate);
            assert.equal(inst.refreshStatus, refresh);
            assert.equal(inst.outputInference, inference);
            const superseded = retry === "refresh";
            assert.equal(refresh.status, superseded ? "refreshing" : "incomplete");
            if (inference) {
                assert.equal(inference.status, "updating");
                assert.equal(inference.timer._destroyed, false);
            }
        } finally {
            clearTimeout(inst.refreshStatus.timer);
            clearTimeout(inst.outputInference?.timer);
        }
    });
}

test("catalog inference without an explicit refresh can complete or fail normally", () => {
    const inst = instance();
    try {
        beginOutputInference(inst, [request], inst.refreshStatus);
        const completed = inst.outputInference;
        finishOutputInference(inst, completed, ["speckit.plan"]);
        assert.equal(inst.outputInference, null);
        assert.equal(completed.status, "complete");
        assert.equal(completed.timer, null);
        assert.equal(inst.refreshStatus, undefined);
        beginOutputInference(inst, [request], inst.refreshStatus);
        const failed = inst.outputInference;
        failOutputInference(inst, failed);
        assert.equal(failed.status, "incomplete");
        assert.equal(failed.timer, null);
        assert.equal(inst.refreshStatus, undefined);
    } finally {
        clearTimeout(inst.outputInference?.timer);
    }
});

test("current output inference still times out and broadcasts its concrete failure", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const frames = [];
    const inst = { ...instance(), broadcast: (frame) => frames.push(frame) };
    try {
        beginOutputInference(inst, [request], inst.refreshStatus);
        t.mock.timers.tick(10 * 60 * 1000);
        assert.equal(inst.outputInference.status, "incomplete");
        assert.ok(frames.some(({ reason }) => reason === "output inference timed out"));
    } finally {
        t.mock.timers.reset();
    }
});

test("refresh completion is independent of output inference", () => {
    const frames = [];
    const inst = { url: "http://127.0.0.1:1234", token: "test-token",
        broadcast: (frame) => frames.push(frame) };
    startRefresh(inst);
    const endpoint = beginOutputInference(inst, [
        { commandId: "speckit.plan", fingerprint: "a".repeat(64) },
    ], inst.refreshStatus);
    assert.equal(endpoint.searchParams.get("token"), "test-token");
    setRefreshWork(inst, { pipeline: true, outputs: false }, inst.refreshStatus);
    finishRefreshPart(inst, "pipeline", inst.refreshStatus);
    assert.equal(inst.refreshStatus.status, "up-to-date");
    assert.equal(inst.outputInference.status, "updating");
    finishOutputInference(inst, inst.outputInference, ["speckit.plan"]);
    assert.equal(inst.refreshStatus.status, "up-to-date");
    assert.equal(inst.outputInference, null);
    assert.ok(frames.some(({ type, reason }) => type === "invalidate"
        && reason === "composition refresh status changed"));
    const completedId = inst.refreshStatus.id;
    startRefresh(inst);
    assert.equal(inst.refreshStatus.status, "refreshing");
    assert.notEqual(inst.refreshStatus.id, completedId);
    failRefresh(inst, inst.refreshStatus);
    assert.equal(inst.refreshStatus.status, "incomplete");
});

test("output inference failure does not mark refresh incomplete", () => {
    const inst = { url: "http://127.0.0.1:1234", token: "test-token", broadcast() {} };
    startRefresh(inst);
    beginOutputInference(inst, [{ commandId: "speckit.specify", fingerprint: "b".repeat(64) }], inst.refreshStatus);
    failOutputInference(inst, inst.outputInference);
    assert.equal(inst.outputInference.status, "incomplete");
    assert.equal(inst.outputInference.timer, null);
    assert.equal(inst.refreshStatus.status, "refreshing");
    assert.equal(inst.refreshStatus.outputsPending, false);
});

test("output inference timeout cancels its workers without cancelling pipeline inference", () => {
    const inst = { ...instance(), broadcast() {} };
    const refresh = startRefresh(inst);
    const endpoint = beginOutputInference(inst, [request], refresh);
    const inference = inst.outputInference;
    const outputWorkerId = endpoint.searchParams.get("runId");
    const pipelineTaskKey = `pipeline:${refresh.id}`;
    const cancelled = [];
    inst.backgroundInferences = new Map([
        [outputWorkerId, { cancel: () => cancelled.push(outputWorkerId) }],
        [pipelineTaskKey, { cancel: () => cancelled.push(pipelineTaskKey) }],
    ]);

    try {
        failInferenceWorker(inst, inference, undefined, "output inference timed out");

        assert.deepEqual(cancelled, [outputWorkerId]);
        assert.equal(inst.backgroundInferences.has(outputWorkerId), false);
        assert.equal(inst.backgroundInferences.has(pipelineTaskKey), true);
        assert.equal(refresh.status, "refreshing");
    } finally {
        clearTimeout(inference.timer);
        clearTimeout(refresh.timer);
    }
});

test("catalog changes do not request output inference, including removal", () => {
    for (const kind of ["preset.install", "preset.remove", "extension.install",
        "extension.remove", "bundle.install", "bundle.remove"]) {
        const prompt = buildCatalogPrompt(kind, { name: "example" }, {},
            { workspacePath: "C:\\workspace", skill: "speckit-bundle" });
        const finalCatalog = prompt.indexOf(kind.startsWith("preset.") ? "showPresetCatalog"
            : "showExtensionCatalog");
        assert.ok(finalCatalog >= 0);
        assert.doesNotMatch(prompt, /artifactInferenceEndpoint|Infer outputs|artifact-targets/);
        assert.doesNotMatch(prompt, /pipeline output details in the background/);
    }
});

test("inference prompt distinguishes feature-relative paths from named roots", () => {
    for (const prompt of [buildCompositionPrompt("extension.inferArtifactTargets",
        { commands: [request], endpoint: `http://127.0.0.1:1234/api/artifact-targets?token=test&runId=${randomUUID()}` },
        {}, { workspacePath: "C:\\workspace" })]) {
        assert.match(prompt, /Never include root and relativeTo on the same candidate/);
        assert.match(prompt, /including helpers that call it FEATURE_DIR/);
        assert.match(prompt, /\"path\":\"plan\.md\",\"relativeTo\":\"feature\"/);
        assert.match(prompt, /\"root\":\{\"name\":\"REPORT_DIR\",\"path\":\"reports\/<slug>\"\}/);
    }
    const feature = { kind: "file", path: "plan.md", relativeTo: "feature",
        source: "inference", effect: "creates", evidence: "Writes FEATURE_DIR/plan.md" };
    const named = { kind: "file", path: "summary.md",
        root: { name: "REPORT_DIR", path: "reports/<slug>" },
        source: "inference", effect: "creates", evidence: "Writes REPORT_DIR/summary.md" };
    assert.equal(validateCandidates([feature, named], { inference: true }).length, 2);
    assert.throws(() => validateCandidates([{ ...feature, root: named.root }], { inference: true }),
        /Invalid feature-relative artifact evidence/);
});

test("inference prompts require copying fresh fingerprints rather than transcribing them", () => {
    for (const prompt of [
        buildCompositionPrompt("extension.inferArtifactTargets",
            { commands: [{ commandId: "speckit.plan", skillPath: ".github/skills/speckit-plan/SKILL.md",
                fingerprint: "a".repeat(64) }],
                endpoint: "http://127.0.0.1:1234/api/artifact-targets?token=test-token&runId=00000000-0000-4000-8000-000000000001" },
            {}, { workspacePath: "C:\\workspace", skill: "speckit-plan" }),
    ]) {
        assert.match(prompt, /GET \/api\/state on the artifactInferenceEndpoint origin with the same token/);
        assert.match(prompt, /artifactInferenceRequests as the data source for command IDs and fingerprints/);
        assert.match(prompt, /Verify each listed command appears exactly once/);
        assert.match(prompt, /Build entries programmatically by joining your inferred candidates by command ID/);
        assert.match(prompt, /If a listed ID is missing, duplicated, or lacks a fingerprint or inference result, stop without POST/);
        assert.match(prompt, /fingerprint copied programmatically from matching GET request/);
        assert.match(prompt, /Use the supplied bundled SKILL\.md text/);
    }
});
