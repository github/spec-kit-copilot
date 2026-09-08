import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { setSession } from "../canvas-runtime/instances.mjs";
import { phaseActions } from "../canvas-runtime/actions/phase.mjs";
import {
    activeRunMatches,
    beginRun,
    __resetRunTrackerForTests,
} from "../canvas-runtime/run-tracker.mjs";

const INSTANCE = "inst-1";
const setPhaseStatus = phaseActions.find((action) => action.name === "setPhaseStatus");
const runPhase = phaseActions.find((action) => action.name === "runPhase");
const reportExecution = phaseActions.find((action) => action.name === "reportExecution");

afterEach(() => {
    __resetRunTrackerForTests();
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
