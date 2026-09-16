// Unit tests for canvas-runtime/boot-progress.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

import { createBootTracker, BOOT_STEPS } from "../canvas-runtime/boot-progress.mjs";

function harness() {
    const events = [];
    const inst = {};
    const tracker = createBootTracker({
        broadcast: (msg) => events.push(msg),
        inst,
    });
    return { tracker, inst, events };
}

test("BOOT_STEPS enumerates the expected ordered steps", () => {
    assert.deepEqual(
        BOOT_STEPS.map((s) => s.id),
        ["workspace", "deps-check", "deps-install", "env-probe", "catalog", "composition", "ready"],
    );
});

test("initial boot record: all steps pending, phase=booting", () => {
    const { inst } = harness();
    assert.equal(inst.boot.phase, "booting");
    assert.ok(inst.boot.startedAt);
    for (const s of inst.boot.steps) {
        assert.equal(s.status, "pending");
        assert.equal(s.startedAt, null);
        assert.equal(s.durationMs, null);
    }
});

test("start() marks step running and broadcasts snapshot", () => {
    const { tracker, inst, events } = harness();
    tracker.start("workspace");
    const s = inst.boot.steps.find((x) => x.id === "workspace");
    assert.equal(s.status, "running");
    assert.ok(s.startedAt);
    assert.equal(events.at(-1).type, "boot.update");
});

test("ok() marks running step ok with durationMs", async () => {
    const { tracker, inst } = harness();
    tracker.start("workspace");
    await delay(5);
    tracker.ok("workspace", { path: "/foo" });
    const s = inst.boot.steps.find((x) => x.id === "workspace");
    assert.equal(s.status, "ok");
    assert.ok(s.endedAt);
    assert.ok(s.durationMs >= 0);
    assert.deepEqual(s.meta, { path: "/foo" });
});

test("fail() sets step failed and phase=failed with classified error", () => {
    const { tracker, inst, events } = harness();
    tracker.start("deps-install");
    tracker.fail("deps-install", {
        title: "npm can't reach the registry",
        hint: "corp TLS?",
        code: "TLS_HANDSHAKE",
        canRetry: true,
        stderrTail: "schannel: SEC_E_ILLEGAL_MESSAGE",
    });
    const s = inst.boot.steps.find((x) => x.id === "deps-install");
    assert.equal(s.status, "failed");
    assert.equal(s.error.code, "TLS_HANDSHAKE");
    assert.equal(s.error.canRetry, true);
    assert.match(s.error.stderrTail, /schannel/);
    assert.equal(inst.boot.phase, "failed");
    assert.equal(events.at(-1).boot.phase, "failed");
});

test("fail() accepts a bare string as the error title", () => {
    const { tracker, inst } = harness();
    tracker.start("deps-install");
    tracker.fail("deps-install", "kablammo");
    const s = inst.boot.steps.find((x) => x.id === "deps-install");
    assert.equal(s.error.title, "kablammo");
});

test("skip() marks step skipped with a reason", () => {
    const { tracker, inst } = harness();
    tracker.skip("deps-install", "already-installed");
    const s = inst.boot.steps.find((x) => x.id === "deps-install");
    assert.equal(s.status, "skipped");
    assert.deepEqual(s.meta, { reason: "already-installed" });
});

test("ready() marks the ready step ok and sets phase=ready", () => {
    const { tracker, inst } = harness();
    tracker.ready();
    assert.equal(inst.boot.phase, "ready");
    assert.equal(inst.boot.steps.at(-1).status, "ok");
});

test("tick() only records output when the step is running", () => {
    const { tracker, inst } = harness();
    tracker.tick("deps-install", "reify:js-yaml");
    // step is pending, so tick is a no-op
    assert.equal(inst.boot.steps.find((s) => s.id === "deps-install").output, null);
    tracker.start("deps-install");
    tracker.tick("deps-install", "reify:js-yaml");
    assert.equal(inst.boot.steps.find((s) => s.id === "deps-install").output, "reify:js-yaml");
});

test("tick() throttles broadcasts but always keeps output current", async () => {
    const { tracker, inst, events } = harness();
    tracker.start("deps-install");
    const before = events.length;
    tracker.tick("deps-install", "line-1");
    tracker.tick("deps-install", "line-2");
    tracker.tick("deps-install", "line-3");
    // First broadcast is immediate (last<0 → now-last>TICK_THROTTLE_MS).
    // The subsequent ones coalesce into a single delayed emit.
    const s = inst.boot.steps.find((x) => x.id === "deps-install");
    assert.equal(s.output, "line-3");
    // Wait past the throttle window; delayed emit should have fired.
    await delay(300);
    assert.ok(events.length - before >= 1);
});

test("snapshot() returns a deep clone; mutations do not affect state", () => {
    const { tracker, inst } = harness();
    tracker.start("workspace");
    const snap = tracker.snapshot();
    snap.phase = "explode";
    snap.steps[0].status = "explode";
    assert.equal(inst.boot.phase, "booting");
    assert.equal(inst.boot.steps[0].status, "running");
});

test("createBootTracker requires inst", () => {
    assert.throws(() => createBootTracker({ broadcast: () => {} }), /requires inst/);
});

test("preserves existing inst.boot on second create (retry path)", () => {
    const events = [];
    const inst = {};
    const t1 = createBootTracker({ broadcast: (m) => events.push(m), inst });
    t1.start("workspace");
    t1.ok("workspace");
    const t2 = createBootTracker({ broadcast: (m) => events.push(m), inst });
    const s = t2.snapshot().steps.find((x) => x.id === "workspace");
    assert.equal(s.status, "ok");
});
