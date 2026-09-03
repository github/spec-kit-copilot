import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
    activeRunsSnapshot,
    beginRun,
    configureRunTracker,
    __resetRunTrackerForTests,
} from "../canvas-runtime/run-tracker.mjs";
import { __emitSessionActivityForTests } from "../canvas-runtime/session-activity.mjs";

afterEach(() => {
    __resetRunTrackerForTests();
});

test("run tracker clears runs when the session idles after dispatch", () => {
    const changes = [];
    configureRunTracker({ onChange: (runs) => changes.push(runs) });

    const run = beginRun("speckit.plan", { startedAtMs: 1_000 });

    assert.equal(run.commandName, "speckit.plan");
    assert.equal(activeRunsSnapshot().length, 1);

    __emitSessionActivityForTests({ kind: "session-idle", working: false, at: 999 });
    assert.equal(activeRunsSnapshot().length, 1);

    __emitSessionActivityForTests({ kind: "session-idle", working: false, at: 1_001 });
    assert.deepEqual(activeRunsSnapshot(), []);
    assert.equal(changes.length, 2);
});
