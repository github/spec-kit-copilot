import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { afterEach, test } from "node:test";
import { setSession } from "../canvas-runtime/instances.mjs";
import {
    activeRunsSnapshot,
    beginRun,
    configureRunTracker,
    __resetRunTrackerForTests,
} from "../canvas-runtime/run-tracker.mjs";

afterEach(() => {
    __resetRunTrackerForTests();
    setSession(null);
});

test("run tracker clears runs when the session idles after dispatch", () => {
    const changes = [];
    const session = new EventEmitter();
    setSession(session);
    configureRunTracker({ onChange: (runs) => changes.push(runs) });

    const run = beginRun("speckit.plan", { startedAtMs: 1_000 });

    assert.equal(run.commandName, "speckit.plan");
    assert.equal(activeRunsSnapshot().length, 1);

    session.emit("session.idle");
    assert.deepEqual(activeRunsSnapshot(), []);
    assert.equal(changes.length, 2);
});
