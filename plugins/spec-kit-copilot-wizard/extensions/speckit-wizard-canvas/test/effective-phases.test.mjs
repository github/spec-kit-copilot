import { test } from "node:test";
import assert from "node:assert/strict";
import { effectivePipelinePhases, stripCommandsPrefix } from "../pipeline/effective-phases.mjs";

test("stripCommandsPrefix normalizes canonicals, preserves non-canonical ids, and passes bare ids through", () => {
    // canonical + prefix → bare short name
    assert.equal(stripCommandsPrefix("commands/speckit.constitution"), "constitution");
    // non-canonical + prefix → prefix stripped, namespaced form kept
    assert.equal(stripCommandsPrefix("commands/speckit.assess.intake"), "speckit.assess.intake");
    // already bare → unchanged (no-prefix early return)
    assert.equal(stripCommandsPrefix("plan"), "plan");
});

test("effectivePipelinePhases returns the user-authored pipeline array verbatim", () => {
    const snap = { pipeline: [{ id: "constitution" }, { id: "specify" }] };
    assert.deepEqual(effectivePipelinePhases(snap), [{ id: "constitution" }, { id: "specify" }]);
});

test("effectivePipelinePhases derives from inferred pipeline, strips commands/ prefix, and filters hook targets", () => {
    const snap = {
        composition: {
            artifacts: [
                { kind: "hook", hookBinding: { targetCommand: "commands/speckit.companion.capture" } },
            ],
            inferredPipeline: {
                pipeline: [
                    "commands/speckit.constitution",
                    "commands/speckit.companion.capture",
                    "commands/speckit.implement",
                ],
            },
        },
    };
    assert.deepEqual(effectivePipelinePhases(snap), [
        { id: "constitution" },
        { id: "implement" },
    ]);
});

test("effectivePipelinePhases falls back to the full canonical spine and filters hook targets", () => {
    const snap = {
        composition: {
            artifacts: [
                { kind: "hook", hookBinding: { targetCommand: "commands/speckit.tasks" } },
            ],
        },
    };
    assert.deepEqual(effectivePipelinePhases(snap), [
        { id: "constitution" },
        { id: "specify" },
        { id: "clarify" },
        { id: "plan" },
        { id: "taskstoissues" },
        { id: "analyze" },
        { id: "checklist" },
        { id: "implement" },
    ]);
});

