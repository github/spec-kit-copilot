// Tests for preset-order.mjs — the SINGLE SOURCE of preset precedence.
//
// These tests lock in the parser's contract so the wizard's precedence
// determination stays glued to the CLI's own ordering. If someone tries
// to reintroduce a priority-based sort anywhere, `orderPresetsByCliList`
// still guarantees CLI-first output.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
    parsePresetListOutput,
    orderPresetsByCliList,
} from "../composition/preset-order.mjs";

// ---------------------------------------------------------------------
// parsePresetListOutput

test("parsePresetListOutput preserves CLI-declared order (first line = winner)", () => {
    const stdout = [
        "Installed Presets:",
        "",
        "  Pirate Speak (Full) (pirate-full-preset) v1.0.0 — enabled — priority 10",
        "    Arrr! Transforms all Spec Kit output into pirate speak.",
        "    Tags: fun, pirate",
        "    Templates: 15",
        "",
        "  Screenwriting (screenwriting) v1.0.0 — enabled — priority 10",
        "    Spec-Driven Development for screenwriting.",
        "    Templates: 25",
        "",
    ].join("\n");
    const r = parsePresetListOutput(stdout);
    assert.deepEqual(r.orderedIds, ["pirate-full-preset", "screenwriting"]);
    assert.equal(r.byId.get("pirate-full-preset").name, "Pirate Speak (Full)");
    assert.equal(r.byId.get("pirate-full-preset").version, "1.0.0");
    assert.equal(r.byId.get("pirate-full-preset").enabled, true);
    assert.equal(r.byName.get("pirate speak (full)"), "pirate-full-preset");
});

test("parsePresetListOutput handles preset names that contain parentheses", () => {
    // The name "Pirate Speak (Full)" contains parens; the id is in the
    // FINAL `(...)` pair before the version. Confirm we split correctly.
    const stdout = "  Pirate Speak (Full) (pirate-full-preset) v1.0.0 — enabled — priority 10\n";
    const r = parsePresetListOutput(stdout);
    assert.deepEqual(r.orderedIds, ["pirate-full-preset"]);
    assert.equal(r.byId.get("pirate-full-preset").name, "Pirate Speak (Full)");
});

test("parsePresetListOutput treats missing enabled marker as enabled", () => {
    const stdout = "  Some (simple-preset) v2.0.0\n";
    const r = parsePresetListOutput(stdout);
    assert.equal(r.byId.get("simple-preset").enabled, true);
});

test("parsePresetListOutput recognizes explicit 'disabled' marker", () => {
    const stdout = "  Off (off-preset) v1.0.0 — disabled — priority 10\n";
    const r = parsePresetListOutput(stdout);
    assert.equal(r.byId.get("off-preset").enabled, false);
});

test("parsePresetListOutput returns empty structures on empty / non-string input", () => {
    for (const bad of ["", null, undefined, 42]) {
        const r = parsePresetListOutput(bad);
        assert.deepEqual(r.orderedIds, []);
        assert.equal(r.byId.size, 0);
        assert.equal(r.byName.size, 0);
    }
});

test("parsePresetListOutput ignores non-header lines (descriptions, tags, blank lines)", () => {
    const stdout = [
        "Installed Presets:",
        "",
        "  Alpha (alpha) v1.0.0",
        "    Some description without an id line",
        "    Tags: a, b, c",
        "  Beta (beta) v2.0.0",
        "    Another description",
    ].join("\n");
    const r = parsePresetListOutput(stdout);
    assert.deepEqual(r.orderedIds, ["alpha", "beta"]);
});

// ---------------------------------------------------------------------
// orderPresetsByCliList

test("orderPresetsByCliList reorders presets to match CLI order", () => {
    const presets = [
        { id: "b", name: "B" },
        { id: "a", name: "A" },
        { id: "c", name: "C" },
    ];
    const out = orderPresetsByCliList(presets, ["a", "b", "c"]);
    assert.deepEqual(out.map((p) => p.id), ["a", "b", "c"]);
});

test("orderPresetsByCliList appends unlisted presets after CLI-listed ones (registry order)", () => {
    const presets = [
        { id: "a", name: "A" },
        { id: "b", name: "B" },
        { id: "c", name: "C" },
    ];
    const out = orderPresetsByCliList(presets, ["b"]);
    // b first (CLI-declared), then a and c in original registry order
    assert.deepEqual(out.map((p) => p.id), ["b", "a", "c"]);
});

test("orderPresetsByCliList returns caller order untouched when orderedIds is empty / missing", () => {
    const presets = [{ id: "a" }, { id: "b" }];
    assert.deepEqual(orderPresetsByCliList(presets, []).map((p) => p.id), ["a", "b"]);
    assert.deepEqual(orderPresetsByCliList(presets, null).map((p) => p.id), ["a", "b"]);
    assert.deepEqual(orderPresetsByCliList(presets, undefined).map((p) => p.id), ["a", "b"]);
});

test("orderPresetsByCliList ignores CLI-listed ids that aren't in the loaded set", () => {
    const presets = [{ id: "a" }, { id: "b" }];
    const out = orderPresetsByCliList(presets, ["ghost", "a", "phantom", "b"]);
    assert.deepEqual(out.map((p) => p.id), ["a", "b"]);
});
