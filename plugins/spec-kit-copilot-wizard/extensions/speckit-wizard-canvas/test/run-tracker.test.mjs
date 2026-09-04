import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { afterEach, test } from "node:test";
import { setSession } from "../canvas-runtime/instances.mjs";
import {
    activeRunsSnapshot,
    beginRun,
    clearRun,
    configureRunTracker,
    reconcileRunsWithPhases,
    __resetRunTrackerForTests,
} from "../canvas-runtime/run-tracker.mjs";

const INSTANCE = "inst-1";

afterEach(() => {
    __resetRunTrackerForTests();
    setSession(null);
});

test("run tracker keeps any phase active through question and clears on correlated turn completion", () => {
    const changes = [];
    const session = new EventEmitter();
    setSession(session);
    configureRunTracker({ onChange: (runs) => changes.push(runs) });

    const run = beginRun(INSTANCE, "speckit.plan", { startedAtMs: 1_000 });

    assert.equal(run.commandName, "speckit.plan");
    assert.equal(activeRunsSnapshot(INSTANCE).length, 1);

    session.emit("assistant.turn_start", { timestamp: new Date(1_050).toISOString() });
    session.emit("user_input.requested", {
        timestamp: new Date(1_100).toISOString(),
        data: { requestId: "question-1", question: "Which checklist?" },
    });
    session.emit("session.idle", { timestamp: new Date(1_200).toISOString() });

    assert.equal(activeRunsSnapshot(INSTANCE).length, 1);

    session.emit("user_input.completed", {
        timestamp: new Date(1_300).toISOString(),
        data: { requestId: "question-1", answer: "security" },
    });
    session.emit("assistant.turn_end", { timestamp: new Date(1_400).toISOString() });

    assert.deepEqual(activeRunsSnapshot(INSTANCE), []);
    assert.ok(changes.length >= 2);
});

test("run tracker normalizes canonical hyphen commands before tracking", () => {
    setSession(new EventEmitter());
    configureRunTracker();

    const run = beginRun(INSTANCE, "speckit-plan", { startedAtMs: 1_000 });

    assert.equal(run.commandName, "speckit.plan");
    assert.deepEqual(activeRunsSnapshot(INSTANCE), [{
        runId: run.runId,
        commandName: "speckit.plan",
        startedAt: new Date(1_000).toISOString(),
    }]);

    reconcileRunsWithPhases(INSTANCE, {
        plan: {
            status: "done",
            lastRunAt: new Date(1_500).toISOString(),
        },
    });

    assert.deepEqual(activeRunsSnapshot(INSTANCE), []);
});

test("run tracker treats canonical dot and hyphen forms as duplicate runs", () => {
    setSession(new EventEmitter());
    configureRunTracker();

    beginRun(INSTANCE, "speckit.plan", { startedAtMs: 1_000 });

    assert.throws(
        () => beginRun(INSTANCE, "speckit-plan", { startedAtMs: 2_000 }),
        /run already active for speckit\.plan/,
    );
});

test("run tracker clears runs when scanner observes a post-dispatch artifact timestamp", () => {
    setSession(new EventEmitter());
    configureRunTracker();

    beginRun(INSTANCE, "speckit.assess.intake", { startedAtMs: 1_000 });
    assert.equal(activeRunsSnapshot(INSTANCE).length, 1);

    reconcileRunsWithPhases(INSTANCE, {
        "commands/speckit.assess.intake": {
            status: "done",
            lastRunAt: new Date(1_500).toISOString(),
        },
    });

    assert.deepEqual(activeRunsSnapshot(INSTANCE), []);
});

test("run tracker treats an advanced lastRunAt with a folder fallback as completion", () => {
    setSession(new EventEmitter());
    configureRunTracker();

    beginRun(INSTANCE, "speckit.assess.define", { startedAtMs: 1_000 });
    assert.equal(activeRunsSnapshot(INSTANCE).length, 1);

    // Extension wrote an off-name file: status stays "empty", but the
    // scanner emits a folderPath fallback plus an advanced lastRunAt.
    reconcileRunsWithPhases(INSTANCE, {
        "commands/speckit.assess.define": {
            status: "empty",
            folderPath: ".specify/assessments/demo",
            lastRunAt: new Date(1_500).toISOString(),
        },
    });

    assert.deepEqual(activeRunsSnapshot(INSTANCE), []);
});

test("run tracker clears extension runs on correlated session completion when artifact mtime does not advance", () => {
    const session = new EventEmitter();
    setSession(session);
    configureRunTracker();

    beginRun(INSTANCE, "speckit.assess.define", { startedAtMs: 1_000 });
    session.emit("assistant.turn_start", { timestamp: new Date(1_100).toISOString() });

    reconcileRunsWithPhases(INSTANCE, {
        "commands/speckit.assess.define": {
            status: "empty",
            folderPath: ".specify/assessments/demo",
            lastRunAt: new Date(1_000).toISOString(),
        },
    });
    assert.equal(activeRunsSnapshot(INSTANCE).length, 1);

    session.emit("session.idle", { timestamp: new Date(1_500).toISOString() });

    assert.deepEqual(activeRunsSnapshot(INSTANCE), []);
});

test("run tracker correlates only one queued run to each session turn", () => {
    const session = new EventEmitter();
    setSession(session);
    configureRunTracker();

    const first = beginRun(INSTANCE, "speckit.assess.define", { startedAtMs: 1_000 });
    const second = beginRun(INSTANCE, "speckit.implement", { startedAtMs: 1_010 });

    session.emit("assistant.turn_start", { timestamp: new Date(1_100).toISOString() });
    session.emit("assistant.turn_end", { timestamp: new Date(1_500).toISOString() });

    assert.deepEqual(activeRunsSnapshot(INSTANCE), [{
        runId: second.runId,
        commandName: "speckit.implement",
        startedAt: new Date(1_010).toISOString(),
    }]);

    session.emit("assistant.turn_start", { timestamp: new Date(1_600).toISOString() });
    session.emit("assistant.turn_end", { timestamp: new Date(1_900).toISOString() });

    assert.deepEqual(activeRunsSnapshot(INSTANCE), []);
    assert.ok(first.runId);
});

test("run tracker ignores stale terminal session activity without a post-dispatch turn start", () => {
    const session = new EventEmitter();
    setSession(session);
    configureRunTracker();

    beginRun(INSTANCE, "speckit.assess.define", { startedAtMs: 1_000 });
    session.emit("session.idle", { timestamp: new Date(1_100).toISOString() });

    assert.equal(activeRunsSnapshot(INSTANCE).length, 1);
});

test("run tracker clears runs on the safety timeout when no terminal status arrives", async () => {
    setSession(new EventEmitter());
    configureRunTracker();

    beginRun(INSTANCE, "speckit.implement", { startedAtMs: 1_000, safetyMs: 5 });
    assert.equal(activeRunsSnapshot(INSTANCE).length, 1);

    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.deepEqual(activeRunsSnapshot(INSTANCE), []);
});

test("run tracker scopes runs per instance so one workspace can't see or clear another's run", () => {
    setSession(new EventEmitter());
    configureRunTracker();

    beginRun("inst-a", "speckit.plan", { startedAtMs: 1_000 });
    beginRun("inst-b", "speckit.plan", { startedAtMs: 1_000 });

    assert.equal(activeRunsSnapshot("inst-a").length, 1);
    assert.equal(activeRunsSnapshot("inst-b").length, 1);

    // Neither instance's reconcile or clear pass touches the other's run.
    reconcileRunsWithPhases("inst-a", {
        plan: { status: "done", lastRunAt: new Date(1_500).toISOString() },
    });
    assert.deepEqual(activeRunsSnapshot("inst-a"), []);
    assert.equal(activeRunsSnapshot("inst-b").length, 1);

    assert.equal(clearRun("inst-a", "speckit.plan"), false);
    assert.equal(clearRun("inst-b", "speckit.plan"), true);
    assert.deepEqual(activeRunsSnapshot("inst-b"), []);
});

test("run tracker rejects duplicate active runs for the same instance and command", () => {
    setSession(new EventEmitter());
    configureRunTracker();

    const first = beginRun(INSTANCE, "speckit.plan", { startedAtMs: 1_000 });

    assert.throws(
        () => beginRun(INSTANCE, "speckit.plan", { startedAtMs: 2_000 }),
        /run already active for speckit\.plan/,
    );
    assert.deepEqual(activeRunsSnapshot(INSTANCE), [{
        runId: first.runId,
        commandName: "speckit.plan",
        startedAt: new Date(1_000).toISOString(),
    }]);
});
