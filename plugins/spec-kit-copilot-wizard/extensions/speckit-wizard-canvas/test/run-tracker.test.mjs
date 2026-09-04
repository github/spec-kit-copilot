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

afterEach(() => {
    __resetRunTrackerForTests();
    setSession(null);
});

function tmpWorkspace() {
    return mkdtempSync(join(tmpdir(), "speckit-run-token-"));
}

test("active run tokens reject overlapping runs", () => {
    const first = beginRun(INSTANCE, "speckit.plan", { startedAtMs: 1_000 });

    assert.throws(
        () => beginRun(INSTANCE, "speckit.plan", { startedAtMs: 2_000 }),
        /phase run already active/,
    );
    assert.equal(activeRunMatches(INSTANCE, "speckit.plan", first.runId), true);
});

test("active run tokens expire when terminal callbacks never arrive", async () => {
    const first = beginRun(INSTANCE, "speckit.plan", { startedAtMs: 1_000, expiresAfterMs: 1 });
    assert.equal(activeRunMatches(INSTANCE, "speckit.plan", first.runId), true);

    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.equal(activeRunMatches(INSTANCE, "speckit.plan", first.runId), false);
    const second = beginRun(INSTANCE, "speckit.plan", { startedAtMs: 2_000 });
    assert.equal(activeRunMatches(INSTANCE, "speckit.plan", second.runId), true);
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
