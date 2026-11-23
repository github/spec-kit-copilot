import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { setSession } from "../canvas-runtime/instances.mjs";
import { phaseActions } from "../canvas-runtime/actions/phase.mjs";
import { completeCommandRun } from "../canvas-runtime/actions/phase.mjs";
import {
    commandCompletionInputSchema,
    validateCommandCompletionInput,
} from "../contracts/agent-command.mjs";
import {
    beginCommandRun,
    clearCommandRunsForInstance,
    currentCommandRunMatches,
    __resetCommandRunsForTests,
} from "../canvas-runtime/command-run-tracker.mjs";
import {
    activeRunMatches,
    beginRun,
    __resetRunTrackerForTests,
} from "../canvas-runtime/run-tracker.mjs";

const INSTANCE = "inst-1";
const setPhaseStatus = phaseActions.find((action) => action.name === "setPhaseStatus");
const runPhase = phaseActions.find((action) => action.name === "runPhase");
const reportExecution = phaseActions.find((action) => action.name === "reportExecution");
const reportCommandComplete = phaseActions.find((action) => action.name === "reportCommandComplete");

afterEach(() => {
    __resetRunTrackerForTests();
    __resetCommandRunsForTests();
    setSession(null);
});

function tmpWorkspace() {
    return mkdtempSync(join(tmpdir(), "speckit-run-token-"));
}

test("active run tokens keep only the latest overlapping run", () => {
    const first = beginRun(INSTANCE, "speckit.plan", { startedAtMs: 1_000 });
    const second = beginRun(INSTANCE, "speckit.plan", { startedAtMs: 2_000 });

    assert.equal(activeRunMatches(INSTANCE, "speckit.plan", first.runId), false);
    assert.equal(activeRunMatches(INSTANCE, "speckit.plan", second.runId), true);
});

test("command completion infers only once for its matching command run", async () => {
    const run = beginCommandRun(INSTANCE, "speckit.assess.intake");
    const calls = [];
    const infer = async (_inst, options) => {
        calls.push(options);
        assert.deepEqual(options.commandIds, ["speckit.assess.intake"]);
        assert.equal(options.isCurrent(), true);
        return { queued: true };
    };
    const inst = { instanceId: INSTANCE };
    const result = await completeCommandRun(inst, {
        commandId: "speckit.assess.intake",
        runId: run.runId,
        status: "done",
    }, { infer });
    assert.deepEqual(result, { ok: true, queued: true });

    const duplicate = await completeCommandRun(inst, {
        commandId: "speckit.assess.intake",
        runId: run.runId,
        status: "done",
    }, { infer });
    assert.deepEqual(duplicate, { ok: false, error: "stale command run" });
    assert.equal(calls.length, 1);
});

test("command completion rejects mismatched and superseded tokens", async () => {
    const first = beginCommandRun(INSTANCE, "speckit.plan");
    const second = beginCommandRun(INSTANCE, "speckit.plan");
    const otherCommand = beginCommandRun(INSTANCE, "speckit.tasks");
    const infer = async () => ({ queued: true });
    const inst = { instanceId: INSTANCE };

    assert.deepEqual(await completeCommandRun(inst, {
        commandId: "speckit.tasks",
        runId: first.runId,
        status: "done",
    }, { infer }), { ok: false, error: "stale command run" });
    assert.deepEqual(await completeCommandRun(inst, {
        commandId: "speckit.plan",
        runId: first.runId,
        status: "done",
    }, { infer }), { ok: false, error: "stale command run" });
    assert.deepEqual(await completeCommandRun({ instanceId: "other-instance" }, {
        commandId: "speckit.tasks",
        runId: otherCommand.runId,
        status: "done",
    }, { infer }), { ok: false, error: "stale command run" });
    assert.deepEqual(await completeCommandRun(inst, {
        commandId: "speckit.tasks",
        runId: otherCommand.runId,
        status: "skipped",
    }, { infer }), { ok: true, queued: false });
    assert.equal(currentCommandRunMatches(INSTANCE, "speckit.plan", second.runId), false);
});

for (const [dotted, hyphenated] of [
    ["speckit.plan", "speckit-plan"],
    ["speckit.extension-wizard-flow-test.review", "speckit-extension-wizard-flow-test-review"],
]) {
    test(`command completion supersedes aliases of ${dotted}`, async () => {
        const first = beginCommandRun(INSTANCE, dotted);
        const other = beginCommandRun(INSTANCE, "speckit.tasks");
        const latest = beginCommandRun(INSTANCE, `/${hyphenated}`);
        const calls = [];
        const infer = async (_inst, options) => {
            calls.push(options.commandIds);
            return { queued: true };
        };
        const inst = { instanceId: INSTANCE };

        assert.equal(first.commandId, hyphenated);
        assert.equal(latest.commandId, hyphenated);
        assert.deepEqual(await completeCommandRun(inst, {
            commandId: dotted, runId: first.runId, status: "done",
        }, { infer }), { ok: false, error: "stale command run" });
        assert.deepEqual(await completeCommandRun(inst, {
            commandId: "speckit.tasks", runId: latest.runId, status: "done",
        }, { infer }), { ok: false, error: "stale command run" });
        assert.deepEqual(await completeCommandRun(inst, {
            commandId: hyphenated, runId: latest.runId, status: "error",
        }, { infer }), { ok: true, queued: true });
        assert.deepEqual(calls, [[hyphenated]]);
        assert.deepEqual(await completeCommandRun(inst, {
            commandId: dotted, runId: latest.runId, status: "done",
        }, { infer }), { ok: false, error: "stale command run" });
        assert.deepEqual(await completeCommandRun(inst, {
            commandId: "speckit.tasks", runId: other.runId, status: "skipped",
        }, { infer }), { ok: true, queued: false });
    });
}

test("command completion rejects invalid input and clears instance-owned tokens", async () => {
    const run = beginCommandRun(INSTANCE, "speckit.plan");
    let inferenceCalls = 0;
    const infer = async () => { inferenceCalls++; return { queued: true }; };
    const invalid = await completeCommandRun({ instanceId: INSTANCE }, {
        commandId: "speckit.plan",
        runId: run.runId,
        status: "pending",
    }, { infer });
    assert.deepEqual(invalid, { ok: false, error: "invalid status" });

    clearCommandRunsForInstance(INSTANCE);
    const stale = await completeCommandRun({ instanceId: INSTANCE }, {
        commandId: "speckit.plan",
        runId: run.runId,
        status: "done",
    }, { infer });
    assert.deepEqual(stale, { ok: false, error: "stale command run" });
    assert.equal(inferenceCalls, 0);
});

test("reportCommandComplete exposes a closed, validated action contract", () => {
    assert.deepEqual(commandCompletionInputSchema.required, ["commandId", "runId", "status"]);
    assert.equal(commandCompletionInputSchema.properties.status.enum.join(","), "done,skipped,error");
    assert.equal(reportCommandComplete.inputSchema, commandCompletionInputSchema);
    assert.deepEqual(validateCommandCompletionInput({
        commandId: "speckit.plan", runId: "run-1", status: "done",
    }), { ok: true, value: { commandId: "speckit.plan", runId: "run-1", status: "done" } });
    assert.deepEqual(validateCommandCompletionInput({
        commandId: "speckit.plan", runId: "run-1", status: "done", extra: true,
    }), { ok: false, error: "invalid command completion" });
});

test("runPhase schema and runtime reject meta phases", async () => {
    const phaseEnum = runPhase.inputSchema.properties.phase.enum;
    assert.equal(phaseEnum.includes("setup"), false);
    assert.equal(phaseEnum.includes("preset"), false);
    assert.equal(phaseEnum.includes("plan"), true);

    const setup = await runPhase.handler({
        instanceId: INSTANCE,
        input: { phase: "setup" },
    });
    assert.deepEqual(setup, { ok: false, error: "invalid phase" });

    const preset = await runPhase.handler({
        instanceId: INSTANCE,
        input: { phase: "preset" },
    });
    assert.deepEqual(preset, { ok: false, error: "invalid phase" });
});

test("setPhaseStatus rejects stale terminal run ids before persisting status", async () => {
    const ws = tmpWorkspace();
    try {
        setSession(new EventEmitter());

        const run = beginRun(INSTANCE, "speckit.plan", { startedAtMs: 1_000 });
        const stale = await setPhaseStatus.handler({
            instanceId: INSTANCE,
            input: { cwd: ws, phase: "plan", status: "done", runId: "stale-run" },
        });

        assert.deepEqual(stale, { ok: false, error: "stale phase run" });
        assert.equal(activeRunMatches(INSTANCE, "speckit.plan", run.runId), true);

        const matching = await setPhaseStatus.handler({
            instanceId: INSTANCE,
            input: { cwd: ws, phase: "plan", status: "done", runId: run.runId },
        });
        assert.deepEqual(matching, { ok: true });
        assert.equal(activeRunMatches(INSTANCE, "speckit.plan", run.runId), false);
    } finally {
        rmSync(ws, { recursive: true, force: true });
    }
});

test("setPhaseStatus rejects tokenless terminal callbacks only while a run is active", async () => {
    const ws = tmpWorkspace();
    try {
        setSession(new EventEmitter());

        beginRun(INSTANCE, "speckit.plan", { startedAtMs: 1_000 });
        const activeTokenless = await setPhaseStatus.handler({
            instanceId: INSTANCE,
            input: { cwd: ws, phase: "plan", status: "done" },
        });
        assert.deepEqual(activeTokenless, { ok: false, error: "stale phase run" });

        __resetRunTrackerForTests();
        const legacy = await setPhaseStatus.handler({
            instanceId: INSTANCE,
            input: { cwd: ws, phase: "plan", status: "done" },
        });
        assert.deepEqual(legacy, { ok: true });
    } finally {
        rmSync(ws, { recursive: true, force: true });
    }
});

test("reportExecution accepts only the run id whose done status was accepted", async () => {
    const ws = tmpWorkspace();
    try {
        setSession(new EventEmitter());

        const first = beginRun(INSTANCE, "speckit.plan", { startedAtMs: 1_000 });
        const second = beginRun(INSTANCE, "speckit.plan", { startedAtMs: 2_000 });
        const staleDone = await setPhaseStatus.handler({
            instanceId: INSTANCE,
            input: { cwd: ws, phase: "plan", status: "done", runId: first.runId },
        });
        assert.deepEqual(staleDone, { ok: false, error: "stale phase run" });

        const staleReport = await reportExecution.handler({
            instanceId: INSTANCE,
            input: {
                cwd: ws,
                phase: "plan",
                runId: first.runId,
                artifacts: { templates: {}, scripts: {}, hooks: {} },
            },
        });
        assert.deepEqual(staleReport, { ok: false, error: "stale phase run" });

        const matchingDone = await setPhaseStatus.handler({
            instanceId: INSTANCE,
            input: { cwd: ws, phase: "plan", status: "done", runId: second.runId },
        });
        assert.deepEqual(matchingDone, { ok: true });

        const matchingReport = await reportExecution.handler({
            instanceId: INSTANCE,
            input: {
                cwd: ws,
                phase: "plan",
                runId: second.runId,
                artifacts: { templates: {}, scripts: {}, hooks: {} },
            },
        });
        assert.deepEqual(matchingReport, { ok: true, merged: 1 });
    } finally {
        rmSync(ws, { recursive: true, force: true });
    }
});
