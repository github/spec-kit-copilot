import assert from "node:assert/strict";
import { test } from "node:test";
import { badgesForTarget, capabilities } from
    "../extension-canvas-design/generated-host/phase-control/generated-phase-adapter.mjs";

test("badge placements bind to an exact phase and its own output, not a cross-product", () => {
    assert.ok(capabilities.includes("workflow.badges.targets.v1"));
    const badges = [
        { id: "spec", targets: [{ phase: "specify", output: "specs/<slug>/spec.md" }] },
        { id: "plan", targets: [{ phase: "plan", output: "specs/<slug>/plan.md" }] },
        { id: "plan-card", targets: [{ phase: "plan", output: null }] },
        { id: "legacy", phase: "specify", showIn: ["phase-card"] },
    ];
    const ids = (phase, output) => badgesForTarget(badges, phase, output)
        .map((badge) => badge.id);
    assert.deepEqual(ids("specify", "specs/<slug>/spec.md"), ["spec"]);
    assert.deepEqual(ids("plan", "specs/<slug>/plan.md"), ["plan"]);
    assert.deepEqual(ids("plan", "specs/<slug>/spec.md"), []);
    assert.deepEqual(ids("specify", "specs/<slug>/plan.md"), []);
    assert.deepEqual(ids("plan", null), ["plan-card"]);
    assert.deepEqual(ids("specify", null), ["legacy"]);
});
