import assert from "node:assert/strict";
import {
    mkdirSync,
    mkdtempSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { platform, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { assembleComposition, computeStage2Necessity } from "../composition/assembler.mjs";
import {
    IS_CASE_INSENSITIVE_FS,
    parseHookDeclarations,
    parseProvidesEntries,
    pathsEqual,
    repoRelative,
    splitLines,
} from "../composition/collect.mjs";
import { canonicalSpine, canonicalTemplateIds, isCanonical } from "../pipeline/canonical.mjs";
import { effectivePipelinePhases, stripCommandsPrefix } from "../pipeline/effective-phases.mjs";
import { scanWorkspace } from "../project-scanner.mjs";
import { state } from "../ui/state.js";
import {
    clearPhaseRunning,
    markPhaseRunning,
    observePhaseProgress,
    renderMoreCommandsPanel,
    resolvePipelineEntry,
    setRunLockDeps,
} from "../ui/phase-runtime.js";

function makeScannerFs(files) {
    const norm = (p) => p.replace(/\\/g, "/");
    const store = new Map(Object.entries(files).map(([k, v]) => [norm(k), v]));
    const isDir = (p) => {
        const np = norm(p);
        if (store.get(np) === "__DIR__") return true;
        for (const k of store.keys()) {
            if (k.startsWith(np + "/")) return true;
        }
        return false;
    };
    return {
        _store: store,
        pathExists: async (p) => store.has(norm(p)) || isDir(p),
        stat: async (p) => {
            const np = norm(p);
            if (isDir(np) && !store.has(np)) return { isFile: () => false, isDirectory: () => true, size: 0, mtimeMs: 1 };
            const v = store.get(np);
            if (v === undefined) throw new Error(`ENOENT: ${p}`);
            return { isFile: () => v !== "__DIR__", isDirectory: () => v === "__DIR__", size: typeof v === "string" ? v.length : 0, mtimeMs: 2 };
        },
        readFile: async (p) => {
            const v = store.get(norm(p));
            if (typeof v !== "string" || v === "__DIR__") throw new Error(`ENOENT: ${p}`);
            return v;
        },
        readdir: async (p) => {
            const np = norm(p) + "/";
            const names = new Set();
            for (const k of store.keys()) {
                if (!k.startsWith(np)) continue;
                const first = k.slice(np.length).split("/")[0];
                if (first) names.add(first);
            }
            return Array.from(names).map((name) => ({
                name,
                isFile: () => !isDir(np + name),
                isDirectory: () => isDir(np + name),
            }));
        },
    };
}

describe("canonical", () => {
// Tests for ui/canonical.mjs — small surface of pure predicates and a
// CORE_CAPABILITIES-driven template lookup. Kept intentionally narrow:
// canonical labels and the frozen-list snapshot were pure copy/style
// tests; the positive isCanonical loop is subsumed by the S1×catalog
// vocabulary integration test.

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
});

describe("effective-phases", () => {
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
});

describe("pipeline-resolver", () => {
const snapshotWith = (arts, exts) => ({
    composition: { artifacts: arts, extensions: exts },
});

test("resolvePipelineEntry: canonical id → core", () => {
    const r = resolvePipelineEntry("specify", snapshotWith([], []));
    assert.equal(r.kind, "core");
    assert.equal(r.phase.id, "specify");
    assert.equal(r.phase.name, "Specify");
    assert.equal(r.phase.locked, false);
});

test("resolvePipelineEntry: extension command → extension with prefix-stripped label", () => {
    const snap = snapshotWith(
        [{
            id: "commands/speckit.assess.intake",
            kind: "command",
            stack: [{ layer: "extension", active: true, presetId: "assess", sourcePath: ".specify/extensions/assess/commands/intake.md" }],
        }],
        [{ id: "assess", name: "Idea Assessment Pipeline", version: "1.0.0" }],
    );
    const r = resolvePipelineEntry("commands/speckit.assess.intake", snap);
    assert.equal(r.kind, "extension");
    assert.equal(r.phase.name, "intake");
    assert.equal(r.phase.commandName, "speckit.assess.intake");
    assert.equal(r.phase.source, "extension:assess");
    assert.equal(r.ext.id, "assess");
    assert.equal(r.ext.name, "Idea Assessment Pipeline");
    assert.equal(r.sourcePath, ".specify/extensions/assess/commands/intake.md");
});

// Regression: pipelineItems() strips the `commands/` prefix from
// inferredPipeline ids (so `isCanonical()` recognizes core phases). That
// caused extension entries to arrive here as bare `speckit.<ext>.<cmd>`,
// which then failed the resolver's startsWith("commands/") gate and
// rendered "Pipeline references unknown commands" — a blank phases page.
test("resolvePipelineEntry: bare extension id (prefix already stripped) → extension", () => {
    const snap = snapshotWith(
        [{
            id: "commands/speckit.assess.intake",
            kind: "command",
            stack: [{ layer: "extension", active: true, presetId: "assess", sourcePath: ".specify/extensions/assess/commands/intake.md" }],
        }],
        [{ id: "assess", name: "Idea Assessment Pipeline", version: "1.0.0" }],
    );
    snap.phases = {
        "commands/speckit.assess.intake": {
            status: "done",
            artifactPath: ".specify/assessments/dead-sea-undersea-game/intake.md",
        },
    };
    const r = resolvePipelineEntry("speckit.assess.intake", snap);
    assert.equal(r.kind, "extension");
    assert.equal(r.phase.name, "intake");
    assert.equal(r.phase.commandName, "speckit.assess.intake");
    assert.equal(r.phase.status, "done");
    assert.equal(r.phase.artifactPath, ".specify/assessments/dead-sea-undersea-game/intake.md");
    assert.equal(r.ext.id, "assess");
});

test("resolvePipelineEntry: hook-bound artifact still resolves as extension", () => {
    // Kind changed from command → hook (e.g. re-classified after user bound it).
    // Stepper + phase card should still render the id sensibly.
    const snap = snapshotWith(
        [{
            id: "commands/speckit.assess.research",
            kind: "hook",
            stack: [{ layer: "extension", active: true, presetId: "assess" }],
        }],
        [{ id: "assess", name: "Assess", version: "1.0.0" }],
    );
    const r = resolvePipelineEntry("commands/speckit.assess.research", snap);
    assert.equal(r.kind, "extension");
    assert.equal(r.phase.name, "research");
});

test("resolvePipelineEntry: unknown extension command id → orphan", () => {
    const snap = snapshotWith([], []);
    const r = resolvePipelineEntry("commands/speckit.nonexistent.foo", snap);
    assert.equal(r.kind, "orphan");
    assert.equal(r.id, "commands/speckit.nonexistent.foo");
});

test("resolvePipelineEntry: bare bogus id → orphan", () => {
    const r = resolvePipelineEntry("random-bogus", snapshotWith([], []));
    assert.equal(r.kind, "orphan");
});

test("resolvePipelineEntry: non-string id → orphan (defensive)", () => {
    assert.equal(resolvePipelineEntry(null, snapshotWith([], [])).kind, "orphan");
    assert.equal(resolvePipelineEntry(undefined, snapshotWith([], [])).kind, "orphan");
    assert.equal(resolvePipelineEntry(42, snapshotWith([], [])).kind, "orphan");
});

test("resolvePipelineEntry: missing snapshot fields → orphan for extension ids, still works for canonical", () => {
    // Extension branch needs composition, canonical branch is snapshot-free.
    assert.equal(resolvePipelineEntry("commands/speckit.x.y", {}).kind, "orphan");
    assert.equal(resolvePipelineEntry("specify", {}).kind, "core");
});

test("resolvePipelineEntry: extension artifact whose active layer isn't extension is not treated as extension", () => {
    // Defensive: a preset shadowing an extension command would resolve as preset, not extension.
    const snap = snapshotWith(
        [{
            id: "commands/speckit.assess.intake",
            kind: "command",
            stack: [{ layer: "preset", active: true, presetId: "my-preset" }],
        }],
        [{ id: "assess", name: "Assess" }],
    );
    // Not extension-layered → falls through to orphan (phase card / stepper
    // will use the flat command list for it via commands()).
    const r = resolvePipelineEntry("commands/speckit.assess.intake", snap);
    assert.equal(r.kind, "orphan");
});

test("observePhaseProgress clears extension run locks using commands/<id> phase slices", () => {
    let renders = 0;
    setRunLockDeps({ render: () => { renders += 1; } });
    try {
        state.snapshot = {
            phases: {
                "commands/speckit.assess.intake": { status: "empty", lastRunAt: null },
            },
        };
        markPhaseRunning("speckit.assess.intake");
        assert.equal(state.phaseRunning.has("speckit.assess.intake"), true);

        state.snapshot = {
            phases: {
                "commands/speckit.assess.intake": {
                    status: "done",
                    lastRunAt: "2026-01-01T00:00:00.000Z",
                    artifactPath: ".specify/assessments/demo/intake.md",
                },
            },
        };
        observePhaseProgress();

        assert.equal(state.phaseRunning.has("speckit.assess.intake"), false);
        assert.ok(renders >= 2);
    } finally {
        clearPhaseRunning("speckit.assess.intake");
        setRunLockDeps({ render: () => {} });
        state.snapshot = null;
    }
});

test("observePhaseProgress clears extension rerun lock when scanner-observed artifact mtime advances", async () => {
    let renders = 0;
    setRunLockDeps({ render: () => { renders += 1; } });
    try {
        const fs = makeScannerFs({
            "/proj/.specify": "__DIR__",
            "/proj/.specify/extensions/assess/commands/speckit.assess.intake.md": "# intake skill",
            "/proj/.specify/assessments/demo/intake.md": "done",
            "/proj/.speckit-wizard/artifact-targets.json": JSON.stringify({
                version: 1,
                entries: {
                    "commands/speckit.assess.intake": {
                        writesTo: ".specify/assessments/demo/intake.md",
                        source: "manual",
                    },
                },
            }),
        });
        const origStat = fs.stat;
        let artifactMtimeMs = Date.parse("2026-01-01T00:00:00.000Z");
        fs.stat = async (p) => {
            const s = await origStat(p);
            if (String(p).replace(/\\/g, "/").endsWith("/.specify/assessments/demo/intake.md")) {
                return { ...s, mtimeMs: artifactMtimeMs };
            }
            return s;
        };

        state.snapshot = await scanWorkspace("/proj", fs);
        state.snapshot.composition = {
            artifacts: [{
                id: "commands/speckit.assess.intake",
                kind: "command",
                stack: [{ layer: "extension", active: true, presetId: "assess" }],
            }],
            extensions: [{ id: "assess", name: "Assess", version: "1.0.0" }],
        };
        markPhaseRunning("speckit.assess.intake");
        assert.equal(state.phaseRunning.has("speckit.assess.intake"), true);
        let resolved = resolvePipelineEntry("speckit.assess.intake", state.snapshot);
        assert.equal(resolved.phase.status, "in_progress");

        state.snapshot = await scanWorkspace("/proj", fs);
        state.snapshot.composition = {
            artifacts: [{
                id: "commands/speckit.assess.intake",
                kind: "command",
                stack: [{ layer: "extension", active: true, presetId: "assess" }],
            }],
            extensions: [{ id: "assess", name: "Assess", version: "1.0.0" }],
        };
        observePhaseProgress();
        assert.equal(state.phaseRunning.has("speckit.assess.intake"), true);
        resolved = resolvePipelineEntry("speckit.assess.intake", state.snapshot);
        assert.equal(resolved.phase.status, "in_progress");

        artifactMtimeMs = Date.parse("2026-01-01T00:01:00.000Z");
        state.snapshot = await scanWorkspace("/proj", fs);
        state.snapshot.composition = {
            artifacts: [{
                id: "commands/speckit.assess.intake",
                kind: "command",
                stack: [{ layer: "extension", active: true, presetId: "assess" }],
            }],
            extensions: [{ id: "assess", name: "Assess", version: "1.0.0" }],
        };
        observePhaseProgress();
        assert.equal(state.phaseRunning.has("speckit.assess.intake"), false);
        resolved = resolvePipelineEntry("speckit.assess.intake", state.snapshot);
        assert.equal(resolved.phase.status, "done");
        assert.equal(resolved.phase.artifactPath, ".specify/assessments/demo/intake.md");
        assert.ok(renders >= 2);
    } finally {
        clearPhaseRunning("speckit.assess.intake");
        setRunLockDeps({ render: () => {} });
        state.snapshot = null;
    }
});

test("resolvePipelineEntry suppresses core artifact readiness only while owner command is running", async () => {
    let renders = 0;
    setRunLockDeps({ render: () => { renders += 1; } });
    try {
        const fs = makeScannerFs({
            "/proj/.specify": "__DIR__",
            "/proj/specs/feature/spec.md": "<!-- speckit:specify v1 -->\nready",
            "/proj/.speckit-wizard/state.json": JSON.stringify({
                phases: {
                    specify: {
                        status: "done",
                        lastRunAt: "2026-01-01T00:00:00.000Z",
                    },
                },
            }),
        });

        state.snapshot = await scanWorkspace("/proj", fs);
        let resolved = resolvePipelineEntry("specify", state.snapshot);
        assert.equal(resolved.phase.status, "done");

        markPhaseRunning("speckit.specify");
        resolved = resolvePipelineEntry("specify", state.snapshot);
        assert.equal(resolved.phase.status, "in_progress");
        assert.equal(resolved.phase.artifactPath, "specs/feature/spec.md");

        fs._store.set("/proj/.speckit-wizard/state.json", JSON.stringify({
            phases: {
                specify: {
                    status: "done",
                    lastRunAt: "2026-01-01T00:01:00.000Z",
                },
            },
        }));
        state.snapshot = await scanWorkspace("/proj", fs);
        observePhaseProgress();

        assert.equal(state.phaseRunning.has("speckit.specify"), false);
        resolved = resolvePipelineEntry("specify", state.snapshot);
        assert.equal(resolved.phase.status, "done");
        assert.equal(resolved.phase.artifactPath, "specs/feature/spec.md");
        assert.ok(renders >= 2);
    } finally {
        clearPhaseRunning("speckit.specify");
        setRunLockDeps({ render: () => {} });
        state.snapshot = null;
    }
});

test("renderMoreCommandsPanel keeps customized canonicals available in the Core list", () => {
    const el = {
        innerHTML: "",
        querySelectorAll: () => [],
    };
    const priorDocument = globalThis.document;
    globalThis.document = {
        getElementById: (id) => (id === "more-commands" ? el : null),
    };
    state.moreCollapsedSections = new Set();
    state.snapshot = {
        commands: [{
            id: "constitution",
            commandName: "speckit.constitution",
            shortLabel: "Constitution",
            source: "preset:lean",
        }],
        composition: {
            presets: [{ id: "lean", name: "Lean" }],
            extensions: [],
            artifacts: [{
                id: "commands/speckit.constitution",
                kind: "command",
                stack: [{ layer: "preset", active: true, presetId: "lean", presetName: "Lean" }],
            }],
        },
    };

    try {
        renderMoreCommandsPanel();
        assert.match(el.innerHTML, /data-mc-section="core"/);
        assert.equal((el.innerHTML.match(/data-phase-id="constitution"/g) ?? []).length, 2);
        assert.match(el.innerHTML, /Core/);
    } finally {
        state.snapshot = null;
        state.moreCollapsedSections = new Set();
        if (priorDocument === undefined) delete globalThis.document;
        else globalThis.document = priorDocument;
    }
});
});

describe("collect-composition", () => {
// Tests for the wizard's composition extraction script.
// Delete alongside `composition/collect.mjs` when speckit exposes the
// composition data model natively.

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
});

describe("composition-assembler", () => {
// Integration tests for composition-assembler.mjs.
//
// Each case builds a synthetic workspace tree under an OS tmpdir with
// `.specify/presets/<id>/preset.yml`, `.specify/extensions/<id>/extension.yml`,
// and (optionally) `.specify/extensions.yml`, then calls
// `assembleComposition({ workspaceRoot, presetItems, extensionItems })` and
// asserts against small snapshot objects (not full JSON dumps) — verify only
// the fields that matter for the case, so unrelated churn doesn't cascade
// into test edits. `computeStage2Necessity` is exercised at the same time.
//
// Delete alongside composition-assembler.mjs when the speckit CLI exposes
// the composition model natively.


// ---- tmpdir workspace builder ----------------------------------------------

function makeWorkspace() {
    const root = mkdtempSync(join(tmpdir(), "speckit-assembler-"));
    mkdirSync(join(root, ".specify"), { recursive: true });
    return root;
}

function writeYaml(path, obj) {
    // js-yaml is available (see collect.mjs), but here we just
    // handwrite YAML — the shapes are simple and this avoids adding an
    // extra import purely for the test scaffolding.
    writeFileSync(path, toYaml(obj));
}

function toYaml(obj, indent = 0) {
    const pad = "  ".repeat(indent);
    if (obj == null) return "null";
    if (typeof obj === "string") {
        // Quote if it contains special chars.
        if (/[:#\-\n]/.test(obj)) return JSON.stringify(obj);
        return obj;
    }
    if (typeof obj === "number" || typeof obj === "boolean") return String(obj);
    if (Array.isArray(obj)) {
        if (obj.length === 0) return "[]";
        return obj.map((v) => `${pad}- ${toYamlInline(v, indent + 1)}`).join("\n");
    }
    // object
    const keys = Object.keys(obj);
    if (keys.length === 0) return "{}";
    return keys
        .map((k) => {
            const v = obj[k];
            if (v && typeof v === "object" && !Array.isArray(v)) {
                return `${pad}${k}:\n${toYaml(v, indent + 1)}`;
            }
            if (Array.isArray(v)) {
                if (v.length === 0) return `${pad}${k}: []`;
                return `${pad}${k}:\n${toYaml(v, indent + 1)}`;
            }
            return `${pad}${k}: ${toYamlScalar(v)}`;
        })
        .join("\n");
}

function toYamlInline(v, indent) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
        // Emit as block mapping starting on the next line, aligned with array item.
        const pad = "  ".repeat(indent);
        const keys = Object.keys(v);
        if (keys.length === 0) return "{}";
        const first = keys[0];
        const rest = keys.slice(1);
        const firstLine = renderInlinePair(first, v[first], indent);
        if (rest.length === 0) return firstLine;
        const others = rest
            .map((k) => `${pad}${renderInlinePair(k, v[k], indent)}`)
            .join("\n");
        return `${firstLine}\n${others}`;
    }
    return toYamlScalar(v);
}

function renderInlinePair(k, v, indent) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
        return `${k}:\n${toYaml(v, indent + 1)}`;
    }
    if (Array.isArray(v)) {
        if (v.length === 0) return `${k}: []`;
        return `${k}:\n${toYaml(v, indent + 1)}`;
    }
    return `${k}: ${toYamlScalar(v)}`;
}

function toYamlScalar(v) {
    if (v == null) return "null";
    if (typeof v === "boolean" || typeof v === "number") return String(v);
    if (typeof v === "string") {
        if (v === "") return '""';
        if (/[:#\n"]/.test(v)) return JSON.stringify(v);
        return v;
    }
    return JSON.stringify(v);
}

function writePreset(root, id, doc) {
    const dir = join(root, ".specify", "presets", id);
    mkdirSync(dir, { recursive: true });
    writeYaml(join(dir, "preset.yml"), { name: id, ...doc });
}

function writeExtension(root, id, doc) {
    const dir = join(root, ".specify", "extensions", id);
    mkdirSync(dir, { recursive: true });
    writeYaml(join(dir, "extension.yml"), { name: id, ...doc });
}

function writeHooksRegistry(root, hooks) {
    writeYaml(join(root, ".specify", "extensions.yml"), { hooks });
}

function presetItem(id, extra = {}) {
    return { id, installedId: id, active: true, enabled: true, priority: 10, ...extra };
}

function extensionItem(id, extra = {}) {
    return { id, installedId: id, active: true, enabled: true, priority: 10, ...extra };
}

function findArtifact(comp, id) {
    return comp.artifacts.find((a) => a.id === id);
}

function activeLayer(artifact) {
    return artifact?.stack.find((l) => l.active);
}

// ---- Cases -----------------------------------------------------------------

test("core-only workspace: no presets/extensions, synthesized canonical pipeline", async () => {
    const root = makeWorkspace();
    try {
        const comp = await assembleComposition({
            workspaceRoot: root,
            presetItems: [],
            extensionItems: [],
        });
        assert.equal(comp.presets.length, 0);
        assert.equal(comp.extensions.length, 0);
        // Every artifact should have exactly one `core` layer, active.
        for (const a of comp.artifacts) {
            const active = activeLayer(a);
            assert.equal(active?.layer, "core", `artifact ${a.id} should be core-active`);
        }
        // Canonical commands present.
        assert.ok(findArtifact(comp, "commands/speckit.constitution"));
        assert.ok(findArtifact(comp, "commands/speckit.specify"));

        const s2 = computeStage2Necessity(comp, comp._presetManifests);
        assert.equal(s2.needed, false, "core-only should not need Stage 2");
        assert.deepEqual(s2.newCommands, []);
        assert.equal(s2.hasStackDirectives, false);
        assert.ok(s2.syntheticPipeline, "synthesized pipeline should be produced");
        assert.equal(s2.syntheticPipeline.shape, "augmented-canonical");
        assert.equal(s2.syntheticPipeline.synthetic, true);
        // Canonical anchors present in synthesized order.
        assert.ok(s2.syntheticPipeline.pipeline.includes("commands/speckit.constitution"));
        assert.ok(s2.syntheticPipeline.pipeline.includes("commands/speckit.implement"));
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test("preset that replaces a template: stack has preset (active, replace) above core", async () => {
    const root = makeWorkspace();
    try {
        writePreset(root, "custom-plan", {
            description: "Custom plan template",
            version: "1.0.0",
            provides: {
                templates: [
                    { name: "plan-template", replaces: "plan-template", description: "custom plan" },
                ],
            },
        });
        const comp = await assembleComposition({
            workspaceRoot: root,
            presetItems: [presetItem("custom-plan", { priority: 5 })],
            extensionItems: [],
        });
        assert.equal(comp.presets.length, 1);
        assert.equal(comp.presets[0].id, "custom-plan");
        assert.equal(comp.presets[0].provides.templates, 1);

        const plan = findArtifact(comp, "plan-template");
        assert.ok(plan, "plan-template artifact exists");
        assert.equal(plan.stack.length, 2);
        assert.equal(plan.stack[0].layer, "preset");
        assert.equal(plan.stack[0].presetId, "custom-plan");
        assert.equal(plan.stack[0].active, true);
        assert.equal(plan.stack[0].strategy, "replace");
        assert.equal(plan.stack[1].layer, "core");
        assert.equal(plan.stack[1].active, false);

        // Other core artifacts untouched (single core layer, active).
        const spec = findArtifact(comp, "spec-template");
        assert.equal(spec.stack.length, 1);
        assert.equal(spec.stack[0].layer, "core");

        // No new commands, no stack directives → no Stage 2 needed.
        const s2 = computeStage2Necessity(comp, comp._presetManifests);
        assert.equal(s2.needed, false);
        assert.ok(s2.syntheticPipeline);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test("preset adding a novel command: Stage 2 becomes required", async () => {
    const root = makeWorkspace();
    try {
        writePreset(root, "with-review", {
            provides: {
                commands: [{ name: "speckit.review", description: "Review step" }],
            },
        });
        const comp = await assembleComposition({
            workspaceRoot: root,
            presetItems: [presetItem("with-review")],
            extensionItems: [],
        });
        const review = findArtifact(comp, "commands/speckit.review");
        assert.ok(review, "novel command artifact exists");
        assert.equal(review.stack.length, 1);
        assert.equal(review.stack[0].layer, "preset");
        assert.equal(review.stack[0].presetId, "with-review");
        assert.equal(review.stack[0].active, true);

        const s2 = computeStage2Necessity(comp, comp._presetManifests);
        assert.equal(s2.needed, true, "novel command requires Stage 2");
        assert.deepEqual(s2.newCommands, ["commands/speckit.review"]);
        assert.equal(s2.syntheticPipeline, null);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test("extension adds command + hook binding: standalone hook artifact + inline attribution", async () => {
    const root = makeWorkspace();
    try {
        writeExtension(root, "guardrails", {
            description: "Adds a plan guardrail hook",
            version: "0.2.0",
            category: "process",
            effect: "read-only",
            provides: {
                commands: [{ name: "guardrails.check", description: "Check guardrails" }],
            },
            hooks: [
                { phase: "after_plan", command: "guardrails.check", optional: false },
            ],
        });
        writeHooksRegistry(root, {
            after_plan: [{ extension: "guardrails", command: "guardrails.check" }],
        });

        const comp = await assembleComposition({
            workspaceRoot: root,
            presetItems: [],
            extensionItems: [extensionItem("guardrails")],
        });

        assert.equal(comp.extensions.length, 1);
        assert.equal(comp.extensions[0].provides.hooks, 1);

        // Standalone hook artifact
        const hook = findArtifact(comp, "commands/guardrails.check");
        assert.ok(hook, "hook artifact exists");
        assert.equal(hook.kind, "hook");
        assert.equal(hook.hookBinding.phase, "after_plan");
        assert.equal(hook.hookBinding.extensionId, "guardrails");

        // Inline hook attribution on target phase command.
        const plan = findArtifact(comp, "commands/speckit.plan");
        assert.ok(plan.hooks?.length, "plan command has inline hook attribution");
        const attr = plan.hooks[0];
        assert.equal(attr.phase, "after_plan");
        assert.equal(attr.extensionId, "guardrails");
        assert.equal(attr.declared, true);
        assert.equal(attr.registered, true);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test("preset with a wraps: directive on a canonical command forces Stage 2", async () => {
    const root = makeWorkspace();
    try {
        writePreset(root, "wrapper", {
            provides: {
                commands: [
                    { name: "speckit.plan-wrap", wraps: "speckit.plan", description: "wraps plan" },
                ],
            },
        });
        const comp = await assembleComposition({
            workspaceRoot: root,
            presetItems: [presetItem("wrapper")],
            extensionItems: [],
        });
        const s2 = computeStage2Necessity(comp, comp._presetManifests);
        assert.equal(s2.hasStackDirectives, true, "wraps: directive detected");
        assert.equal(s2.needed, true);
        assert.equal(s2.syntheticPipeline, null);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test("preset using `replaces: X` + explicit `strategy: prepend` — Stage 2 sees the prepend", async () => {
    // Regression test for the `copilot-sub-agents` shape: shorthand
    // `replaces:` combined with an explicit `strategy: prepend` field means
    // "prepend before X", NOT "replace X". `computeStage2Necessity` must
    // honor the explicit strategy so `hasStackDirectives` is true.
    const root = makeWorkspace();
    try {
        writePreset(root, "sub-agents", {
            provides: {
                templates: [
                    {
                        type: "command",
                        name: "speckit.specify",
                        file: "commands/speckit.specify.md",
                        replaces: "speckit.specify",
                        strategy: "prepend",
                    },
                ],
            },
        });
        const comp = await assembleComposition({
            workspaceRoot: root,
            presetItems: [presetItem("sub-agents")],
            extensionItems: [],
        });
        // Layer strategy on the artifact should reflect prepend.
        const spec = findArtifact(comp, "commands/speckit.specify");
        const presetLayer = spec.stack.find((l) => l.layer === "preset");
        assert.equal(presetLayer.strategy, "prepend");

        const s2 = computeStage2Necessity(comp, comp._presetManifests);
        assert.equal(s2.hasStackDirectives, true, "explicit strategy: prepend detected");
        assert.equal(s2.needed, true);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test("hook artifact IDs are excluded from synthesized pipeline", async () => {
    const root = makeWorkspace();
    try {
        writeExtension(root, "audit", {
            provides: { commands: [{ name: "audit.check" }] },
            hooks: [{ phase: "after_tasks", command: "audit.check" }],
        });
        writeHooksRegistry(root, {
            after_tasks: [{ extension: "audit", command: "audit.check" }],
        });
        const comp = await assembleComposition({
            workspaceRoot: root,
            presetItems: [],
            extensionItems: [extensionItem("audit")],
        });
        const s2 = computeStage2Necessity(comp, comp._presetManifests);
        // audit.check is a hook target — should be excluded from newCommands
        // for pipeline placement purposes. But because it appears as an
        // extension-provided command entry, it also lives in `artifacts` as a
        // command kind. The important thing is the synthesized pipeline (if
        // any) doesn't include it.
        if (s2.syntheticPipeline) {
            assert.ok(
                !s2.syntheticPipeline.pipeline.includes("commands/audit.check"),
                "hook target excluded from synthesized pipeline",
            );
        }
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test("fingerprint-like stability: running twice on same fixture produces identical artifacts", async () => {
    const root = makeWorkspace();
    try {
        writePreset(root, "stable", {
            provides: { templates: [{ name: "plan-template", replaces: "plan-template" }] },
        });
        const items = [presetItem("stable", { priority: 5 })];
        const a = await assembleComposition({
            workspaceRoot: root,
            presetItems: items,
            extensionItems: [],
        });
        const b = await assembleComposition({
            workspaceRoot: root,
            presetItems: items,
            extensionItems: [],
        });
        // Strip side channel before comparing.
        const stripA = { presets: a.presets, extensions: a.extensions, artifacts: a.artifacts };
        const stripB = { presets: b.presets, extensions: b.extensions, artifacts: b.artifacts };
        assert.deepEqual(stripA, stripB);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});
});
