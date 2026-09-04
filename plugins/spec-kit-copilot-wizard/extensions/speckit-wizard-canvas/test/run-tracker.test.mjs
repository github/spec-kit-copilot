import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { afterEach, test } from "node:test";
import { setSession } from "../canvas-runtime/instances.mjs";
import {
    activeRunsSnapshot,
    beginRun,
    configureRunTracker,
    reconcileRunsWithPhases,
    __resetRunTrackerForTests,
} from "../canvas-runtime/run-tracker.mjs";

afterEach(() => {
    __resetRunTrackerForTests();
    setSession(null);
});

test("run tracker keeps any phase active through question, idle, and answer until terminal status", () => {
    const changes = [];
    const session = new EventEmitter();
    setSession(session);
    configureRunTracker({ onChange: (runs) => changes.push(runs) });

    const run = beginRun("speckit.plan", { startedAtMs: 1_000 });

    assert.equal(run.commandName, "speckit.plan");
    assert.equal(activeRunsSnapshot().length, 1);

    session.emit("user_input.requested", {
        timestamp: new Date(1_100).toISOString(),
        data: { requestId: "question-1", question: "Which checklist?" },
    });
    session.emit("session.idle", { timestamp: new Date(1_200).toISOString() });

    assert.equal(activeRunsSnapshot().length, 1);

    session.emit("user_input.completed", {
        timestamp: new Date(1_300).toISOString(),
        data: { requestId: "question-1", answer: "security" },
    });
    session.emit("session.idle", { timestamp: new Date(1_400).toISOString() });

    assert.equal(activeRunsSnapshot().length, 1);

    reconcileRunsWithPhases({
        plan: {
            status: "done",
            lastRunAt: new Date(1_500).toISOString(),
        },
    });

    assert.deepEqual(activeRunsSnapshot(), []);
    assert.ok(changes.length >= 2);
});

test("run tracker clears runs when scanner observes a post-dispatch artifact timestamp", () => {
    setSession(new EventEmitter());
    configureRunTracker();

    beginRun("speckit.assess.intake", { startedAtMs: 1_000 });
    assert.equal(activeRunsSnapshot().length, 1);

    reconcileRunsWithPhases({
        "commands/speckit.assess.intake": {
            status: "done",
            lastRunAt: new Date(1_500).toISOString(),
        },
    });

    assert.deepEqual(activeRunsSnapshot(), []);
});
