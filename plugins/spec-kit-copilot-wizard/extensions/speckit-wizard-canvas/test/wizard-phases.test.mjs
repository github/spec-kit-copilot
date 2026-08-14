// Tests for catalog.mjs — pure data helpers whose behavior is NOT already
// covered by the module-seam integration tests (S1×S2 dispatch, S1×catalog
// vocabulary, S2 phase-id contract). Kept intentionally small: enum
// membership, vocabulary shape, and skill-mapping snapshots are all
// exercised end-to-end by integration tests that import both sides of the
// seam and would fail on the same regressions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isOptional, emptyPhaseSlice } from "../canvas-runtime/wizard-phases.mjs";

test("isOptional predicate matches PHASES declarations", () => {
    // Optional-vs-required is a semantic invariant the wizard uses to gate
    // Skip actions. Regression risk is high enough to keep this predicate
    // guarded independently: no integration test asserts the boolean.
    for (const id of ["clarify", "checklist", "analyze", "taskstoissues"]) {
        assert.equal(isOptional(id), true, `${id} must be optional`);
    }
    for (const id of ["setup", "preset", "constitution", "specify", "plan", "tasks", "implement"]) {
        assert.equal(isOptional(id), false, `${id} must NOT be optional`);
    }
});

test("emptyPhaseSlice derives artifactPath from phase metadata", () => {
    // Guards the constructor for state.json phase entries — the scanner
    // and state-store both rely on emptyPhaseSlice's shape when hydrating
    // missing entries.
    const constitution = emptyPhaseSlice("constitution");
    assert.equal(constitution.status, "empty");
    assert.equal(constitution.optionalSkipped, false);
    assert.equal(constitution.lastRunAt, null);
    assert.deepEqual(constitution.formValues, {});
    assert.equal(constitution.artifactPath, ".specify/memory/constitution.md");

    // Phases without an on-disk artifact carry a null artifactPath rather
    // than the empty string — the scanner's status derivation branches on
    // exactly that distinction.
    assert.equal(emptyPhaseSlice("implement").artifactPath, null);

    // Unknown ids still produce a well-shaped slice (defensive).
    const unknown = emptyPhaseSlice("nonexistent");
    assert.equal(unknown.artifactPath, null);
});
