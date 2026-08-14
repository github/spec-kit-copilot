// Tests for the wizard's composition extraction script.
// Delete alongside `composition/collect.mjs` when speckit exposes the
// composition data model natively.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
    parseProvidesEntries,
    parseHookDeclarations,
    splitLines,
    repoRelative,
    pathsEqual,
    IS_CASE_INSENSITIVE_FS,
} from "../composition/collect.mjs";
import { platform } from "node:os";

// ---- parseProvidesEntries ---------------------------------------------------

test("parseProvidesEntries derives strategy from replaces/wraps/prepends/appends keys", () => {
    const provides = {
        templates: [
            { name: "spec-template", replaces: "spec-template" },
            { name: "plan-wrapper", wraps: "plan-template" },
            { name: "tasks-prepend", prepends: "tasks-template" },
            { name: "impl-append", appends: "impl-template" },
            { name: "plain-add" },
        ],
    };
    const parsed = parseProvidesEntries(provides);
    const byName = Object.fromEntries(parsed.template.map((e) => [e.name, e.strategy]));
    assert.equal(byName["spec-template"], "replace");
    assert.equal(byName["plan-wrapper"], "wrap");
    assert.equal(byName["tasks-prepend"], "prepend");
    assert.equal(byName["impl-append"], "append");
    // No key → default `replace` (matches CLI tie-breaker).
    assert.equal(byName["plain-add"], "replace");
});

test("parseProvidesEntries drops entries with no name/replaces target", () => {
    const provides = { commands: [{ description: "orphan, no name" }, null, 42] };
    const parsed = parseProvidesEntries(provides);
    assert.deepEqual(parsed.command, []);
});

test("parseProvidesEntries handles empty / malformed provides", () => {
    assert.deepEqual(parseProvidesEntries(null), { command: [], template: [], script: [] });
    assert.deepEqual(parseProvidesEntries("nope"), { command: [], template: [], script: [] });
    assert.deepEqual(parseProvidesEntries({}), { command: [], template: [], script: [] });
});

test("parseProvidesEntries populates all three kind buckets independently", () => {
    const provides = {
        commands: [{ name: "cmd-a" }],
        templates: [{ name: "tpl-a" }],
        scripts: [{ name: "scr-a" }],
    };
    const parsed = parseProvidesEntries(provides);
    assert.equal(parsed.command.length, 1);
    assert.equal(parsed.template.length, 1);
    assert.equal(parsed.script.length, 1);
});

test("parseProvidesEntries falls back name → replaces/wraps/etc. when name absent", () => {
    // Cross-named replace (entry has no `name:` but has `replaces:`) MUST
    // still surface as an entry keyed by the replaces target — that is the
    // stack-match key.
    const parsed = parseProvidesEntries({
        templates: [{ replaces: "core-spec" }],
    });
    assert.equal(parsed.template[0].name, "core-spec");
    assert.equal(parsed.template[0].replaces, "core-spec");
    assert.equal(parsed.template[0].strategy, "replace");
});

test("parseProvidesEntries: explicit `strategy:` field beats the `replaces:` shorthand", () => {
    // Real-world case: `copilot-sub-agents` uses `replaces: X` + `strategy: prepend`
    // to mean "prepend before X". Without the explicit-field override, the
    // shorthand-based inferStrategy would silently coerce this to "replace" and
    // computeStage2Necessity would miss the stack directive.
    const parsed = parseProvidesEntries({
        templates: [
            { type: "command", name: "speckit.specify", replaces: "speckit.specify", strategy: "prepend" },
            { type: "command", name: "speckit.plan", replaces: "speckit.plan", strategy: "wrap" },
            { type: "command", name: "speckit.tasks", replaces: "speckit.tasks", strategy: "append" },
            { type: "command", name: "speckit.impl", replaces: "speckit.impl", strategy: "REPLACE" },
        ],
    });
    const byName = Object.fromEntries(parsed.command.map((e) => [e.name, e.strategy]));
    assert.equal(byName["speckit.specify"], "prepend");
    assert.equal(byName["speckit.plan"], "wrap");
    assert.equal(byName["speckit.tasks"], "append");
    // Case-normalized to lower.
    assert.equal(byName["speckit.impl"], "replace");
});

test("parseProvidesEntries: unknown explicit strategy falls back to shorthand-key inference", () => {
    const parsed = parseProvidesEntries({
        templates: [
            { name: "x", replaces: "x", strategy: "bogus" },
        ],
    });
    assert.equal(parsed.template[0].strategy, "replace");
});

// ---- parseHookDeclarations --------------------------------------------------

test("parseHookDeclarations normalizes phase + command; drops incomplete entries", () => {
    const hooks = [
        { phase: "after_specify", command: "assess-intake" },
        { trigger: "before_plan", targetCommand: "capture-context" }, // alt keys
        { phase: "after_plan" }, // no command → dropped
        null, // → dropped
        { command: "orphan" }, // no phase → dropped
    ];
    const parsed = parseHookDeclarations(hooks);
    assert.equal(parsed.length, 2);
    assert.equal(parsed[0].phase, "after_specify");
    assert.equal(parsed[0].command, "assess-intake");
    assert.equal(parsed[1].phase, "before_plan");
    assert.equal(parsed[1].command, "capture-context");
});

test("parseHookDeclarations returns [] for non-arrays", () => {
    assert.deepEqual(parseHookDeclarations(null), []);
    assert.deepEqual(parseHookDeclarations({}), []);
    assert.deepEqual(parseHookDeclarations("nope"), []);
});

test("parseHookDeclarations coerces optional + priority defaults", () => {
    const [h] = parseHookDeclarations([
        { phase: "after_specify", command: "x", optional: 1, priority: "not-a-number" },
    ]);
    assert.equal(h.optional, true);
    assert.equal(h.priority, null);
});

// ---- OS-agnostic string / path helpers --------------------------------------

test("splitLines handles LF + CRLF + missing input", () => {
    assert.deepEqual(splitLines("a\nb\nc"), ["a", "b", "c"]);
    assert.deepEqual(splitLines("a\r\nb\r\nc"), ["a", "b", "c"]);
    assert.deepEqual(splitLines(""), [""]);
    assert.deepEqual(splitLines(null), [""]);
    assert.deepEqual(splitLines(undefined), [""]);
});

test("repoRelative always emits forward-slashes (JSON-portable)", () => {
    // Windows-style
    const winRel = repoRelative("C:\\repo", "C:\\repo\\.specify\\presets\\p\\preset.yml");
    assert.equal(winRel.includes("\\"), false, `should not contain backslashes: ${winRel}`);
    // POSIX-style
    const posixRel = repoRelative("/repo", "/repo/.specify/presets/p/preset.yml");
    assert.equal(posixRel, ".specify/presets/p/preset.yml");
});

test("repoRelative preserves absolute paths outside the workspace root", () => {
    const out = repoRelative("/repo", "/other/file.txt");
    // Not prefixed by root → returned mostly as-is, forward-slash-normalized.
    assert.ok(out.length > 0);
    assert.ok(!out.includes("\\"));
});

test("pathsEqual respects the case-sensitivity of the running OS", () => {
    const a = "C:/Repo/File.txt";
    const b = "c:/repo/file.txt";
    if (IS_CASE_INSENSITIVE_FS) {
        assert.equal(pathsEqual(a, b), true);
    } else {
        assert.equal(pathsEqual(a, b), false);
    }
    // Exact match always true regardless of platform.
    assert.equal(pathsEqual(a, a), true);
    // Nullish → false.
    assert.equal(pathsEqual(null, a), false);
    assert.equal(pathsEqual(a, ""), false);
});

test("IS_CASE_INSENSITIVE_FS matches the running platform's default", () => {
    // Windows + macOS default to case-insensitive filesystems; Linux to
    // case-sensitive. The extraction script's behavior depends on this
    // constant, so its derivation must match the platform we're running on.
    const p = platform();
    const expected = p === "win32" || p === "darwin";
    assert.equal(IS_CASE_INSENSITIVE_FS, expected);
});
