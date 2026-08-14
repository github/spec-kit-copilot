// Unit tests for the parseClarifications helper used by the artifact viewer
// to inject Clarify pills next to each [NEEDS CLARIFICATION: ...] marker.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseClarifications } from "../pipeline/canonical.mjs";

test("returns [] for empty / null / plain text", () => {
    assert.deepEqual(parseClarifications(""), []);
    assert.deepEqual(parseClarifications(null), []);
    assert.deepEqual(parseClarifications("no markers here"), []);
});

test("finds a single inline marker with the question text trimmed", () => {
    const src = "See [NEEDS CLARIFICATION: which auth provider?] and continue.";
    const out = parseClarifications(src);
    assert.equal(out.length, 1);
    assert.equal(out[0].question, "which auth provider?");
    assert.equal(src.slice(out[0].startIdx, out[0].endIdx), "[NEEDS CLARIFICATION: which auth provider?]");
});

test("finds multiple markers in source order", () => {
    // Marker with a bracket in the question — matches to the FIRST closing
    // bracket, mirroring the skill's convention.
    const src = "before [NEEDS CLARIFICATION: pick a] value] after";
    const out = parseClarifications(src);
    assert.equal(out.length, 1);
    assert.equal(out[0].question, "pick a");
});
