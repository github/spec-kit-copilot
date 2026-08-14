// Tests for ui/canonical.mjs — small surface of pure predicates and a
// CORE_CAPABILITIES-driven template lookup. Kept intentionally narrow:
// canonical labels and the frozen-list snapshot were pure copy/style
// tests; the positive isCanonical loop is subsumed by the S1×catalog
// vocabulary integration test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalSpine, canonicalTemplateIds, isCanonical } from "../pipeline/canonical.mjs";

test("canonicalSpine returns a fresh mutable copy each call", () => {
    // Mutation-safety invariant: callers reorder / append and must never
    // observe a shared array. A regression here would silently corrupt
    // the wizard's phase list across pages.
    const a = canonicalSpine();
    const b = canonicalSpine();
    assert.notStrictEqual(a, b);
    a.push("mutated");
    assert.equal(b.includes("mutated"), false);
    assert.equal(canonicalSpine().includes("mutated"), false);
});

test("isCanonical rejects non-canonical, empty, and non-string values", () => {
    // Positive predicate (every canonical is accepted) is exercised via the
    // S1×catalog and S2 integration tests. This test guards only the
    // branches those don't cover: type/case rejection.
    assert.equal(isCanonical("outline"), false);
    assert.equal(isCanonical("Specify"), false, "must be case-sensitive");
    assert.equal(isCanonical(""), false);
    assert.equal(isCanonical(null), false);
    assert.equal(isCanonical(undefined), false);
    assert.equal(isCanonical(42), false);
    assert.equal(isCanonical({ id: "specify" }), false);
});

test("canonicalTemplateIds contracts with CORE_CAPABILITIES (specify carries two templates)", () => {
    // Real regression this test guards: specify has TWO templates
    // (spec-template + checklist-template) that must both surface on the
    // phase card. Missing the second one silently hid a phase artifact
    // until this was added. This is an integration between canonical.mjs
    // and core-capabilities.mjs — do not mock either.
    assert.deepEqual(canonicalTemplateIds("specify"), ["spec-template", "checklist-template"]);

    // Required canonicals with a single template come straight from
    // CORE_CAPABILITIES.
    assert.deepEqual(canonicalTemplateIds("constitution"), ["constitution-template"]);
    assert.deepEqual(canonicalTemplateIds("plan"), ["plan-template"]);
    assert.deepEqual(canonicalTemplateIds("tasks"), ["tasks-template"]);

    // Optional canonicals + preset-added canonicals fall back to the
    // `<phase>-template` convention rather than throwing.
    assert.deepEqual(canonicalTemplateIds("checklist"), ["checklist-template"]);
    assert.deepEqual(canonicalTemplateIds("outline"), ["outline-template"]);

    // Empty-template phases (implement, clarify, taskstoissues, analyze)
    // carry the empty list from CORE_CAPABILITIES — NOT the fallback.
    assert.deepEqual(canonicalTemplateIds("implement"), []);
    assert.deepEqual(canonicalTemplateIds("clarify"), []);

    // Non-string input never throws and returns [].
    assert.deepEqual(canonicalTemplateIds(""), []);
    assert.deepEqual(canonicalTemplateIds(null), []);
    assert.deepEqual(canonicalTemplateIds(42), []);
});

test("canonicalTemplateIds returns a fresh array each call", () => {
    // Same mutation-safety guarantee as canonicalSpine.
    const a = canonicalTemplateIds("specify");
    a.push("mutated");
    assert.equal(canonicalTemplateIds("specify").includes("mutated"), false);
});
