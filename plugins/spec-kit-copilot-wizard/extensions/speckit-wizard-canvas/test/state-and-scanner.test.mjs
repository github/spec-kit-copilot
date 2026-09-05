import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { PHASE_ORDER } from "../canvas-runtime/wizard-phases.mjs";
import { _internal as scannerInternal, readMarkdownArtifact, scanWorkspace } from "../project-scanner.mjs";
import {
    buildPrompt,
    buildWorkflowSlashCommand,
    _internal as promptsInternal,
    phaseIdForCommandName,
    UnknownActionKindError,
} from "../prompts.mjs";
import {
    applyPatch,
    coerceStringArray,
    computeItemStatuses,
    mergeExecutionReportEntry,
    normalizeExecutionReports,
    normalizeState,
    overlayCachedComposition,
    readState,
    validateInferredPipeline,
    writeState,
} from "../state/store.mjs";

describe("state-store", () => {
// Tests for state/store.mjs — defensive normalization + read/write.

test("normalizeState(null) returns default shape", () => {
    const s = normalizeState(null);
    assert.equal(s.$schema, "speckit-wizard/v1");
    assert.equal(s.currentPhase, "setup");
    // preset defaults to null — the wizard starts at the Preset picker with
    // nothing selected; the user must pick one before the flow advances.
    assert.equal(s.preset, null);
    for (const id of PHASE_ORDER) assert.ok(s.phases[id]);
});

test("normalizeState defensively coerces status aliases", () => {
    const s = normalizeState({
        phases: {
            constitution: { status: "COMPLETED" },
            specify: { status: "in-progress" },
            plan: { status: "running" },
            tasks: { status: "SKIP" },
        },
    });
    assert.equal(s.phases.constitution.status, "done");
    assert.equal(s.phases.specify.status, "in_progress");
    assert.equal(s.phases.plan.status, "in_progress");
    assert.equal(s.phases.tasks.status, "skipped");
});

test("normalizeState drops invalid status values to 'empty'", () => {
    const s = normalizeState({ phases: { constitution: { status: "banana" } } });
    assert.equal(s.phases.constitution.status, "empty");
});

test("normalizeState preserves error as a terminal phase status", () => {
    const s = normalizeState({ phases: { implement: { status: "error" } } });
    assert.equal(s.phases.implement.status, "error");
});

test("normalizeState coerces booleans from strings", () => {
    const s = normalizeState({
        setup: {
            pluginInstalled: "yes",
            cliInstalled: "true",
            projectInitialized: "1",
            skillsReloaded: "off",
        },
    });
    assert.equal(s.setup.pluginInstalled, true);
    assert.equal(s.setup.cliInstalled, true);
    assert.equal(s.setup.projectInitialized, true);
    assert.equal(s.setup.skillsReloaded, false);
});

test("normalizeState drops non-object formValues", () => {
    const s = normalizeState({ phases: { constitution: { formValues: "not an object" } } });
    assert.deepEqual(s.phases.constitution.formValues, {});
});

test("normalizeState drops non-string artifactPath", () => {
    const s = normalizeState({ phases: { constitution: { artifactPath: 42 } } });
    // Falls back to base slice default (constitution has a default artifact path).
    assert.equal(typeof s.phases.constitution.artifactPath === "string" || s.phases.constitution.artifactPath === null, true);
});

test("normalizeState parses valid ISO lastRunAt", () => {
    const iso = "2024-01-02T03:04:05.000Z";
    const s = normalizeState({ phases: { plan: { lastRunAt: iso } } });
    assert.equal(s.phases.plan.lastRunAt, iso);
});

test("normalizeState drops garbage lastRunAt", () => {
    const s = normalizeState({ phases: { plan: { lastRunAt: "not-a-date" } } });
    assert.equal(s.phases.plan.lastRunAt, null);
});

test("coerceStringArray accepts arrays, strings, drops non-strings", () => {
    assert.deepEqual(coerceStringArray(["a", "b"]), ["a", "b"]);
    assert.deepEqual(coerceStringArray("x"), ["x"]);
    assert.deepEqual(coerceStringArray(""), []);
    assert.deepEqual(coerceStringArray(42), []);
    assert.deepEqual(coerceStringArray(["a", 1, "b"]), ["a", "b"]);
    assert.deepEqual(coerceStringArray(null), []);
});

test("applyPatch merges shallow + phase slices", () => {
    const base = normalizeState(null);
    const patched = applyPatch(base, {
        currentPhase: "specify",
        phases: { constitution: { status: "done" } },
    });
    assert.equal(patched.currentPhase, "specify");
    assert.equal(patched.phases.constitution.status, "done");
    // Other phases untouched.
    assert.equal(patched.phases.plan.status, "empty");
});

test("readState with no directory returns absent state", async () => {
    const deps = {
        pathExists: async () => false,
        readFile: async () => "",
    };
    const r = await readState("/proj", deps);
    assert.equal(r.present, false);
    assert.equal(r.state.currentPhase, "setup");
});

test("readState with malformed JSON reports warning + safe default", async () => {
    const files = new Set(["/proj/.speckit-wizard", "/proj/.speckit-wizard/state.json"]);
    const deps = {
        pathExists: async (p) => files.has(String(p).replace(/\\/g, "/")),
        readFile: async () => "{ not json",
    };
    const r = await readState("/proj", deps);
    assert.equal(r.present, true);
    assert.equal(r.state.currentPhase, "setup");
    assert.ok(r.warnings.length > 0);
});

test("readState with valid JSON hydrates state", async () => {
    const files = new Set(["/proj/.speckit-wizard", "/proj/.speckit-wizard/state.json"]);
    const deps = {
        pathExists: async (p) => files.has(String(p).replace(/\\/g, "/")),
        readFile: async () => JSON.stringify({ currentPhase: "plan", preset: "lean" }),
    };
    const r = await readState("/proj", deps);
    assert.equal(r.present, true);
    assert.equal(r.state.currentPhase, "plan");
    assert.equal(r.state.preset, "lean");
});

test("writeState mkdirs and writes JSON body", async () => {
    let mkdirCalled = null;
    let writeCalled = null;
    let renameCalled = null;
    const deps = {
        mkdir: async (p, opts) => { mkdirCalled = { p, opts }; },
        writeFile: async (p, body) => { writeCalled = { p, body }; },
        rename: async (from, to) => { renameCalled = { from, to }; },
    };
    const state = normalizeState({ currentPhase: "plan" });
    await writeState("/proj", state, deps);
    assert.ok(mkdirCalled.p.replace(/\\/g, "/").endsWith(".speckit-wizard"));
    assert.deepEqual(mkdirCalled.opts, { recursive: true });
    // writeFile hits the tmp path; rename swaps it into place atomically.
    assert.ok(writeCalled.p.replace(/\\/g, "/").includes(".speckit-wizard/state.json."));
    assert.ok(writeCalled.p.endsWith(".tmp"));
    assert.equal(renameCalled.from, writeCalled.p);
    assert.ok(renameCalled.to.replace(/\\/g, "/").endsWith(".speckit-wizard/state.json"));
    const parsed = JSON.parse(writeCalled.body);
    assert.equal(parsed.currentPhase, "plan");
});


// -------- Pipeline (user-authored spine) --------
test("normalizeState defaults pipeline to null (untouched sentinel)", () => {
    const s = normalizeState({});
    assert.equal(s.pipeline, null);
});

test("normalizeState accepts array pipeline with {id} entries", () => {
    const s = normalizeState({ pipeline: [{ id: "specify" }, { id: "plan" }] });
    assert.deepEqual(s.pipeline, [{ id: "specify" }, { id: "plan" }]);
});

test("normalizeState accepts array pipeline with bare string entries", () => {
    const s = normalizeState({ pipeline: ["specify", "plan"] });
    assert.deepEqual(s.pipeline, [{ id: "specify" }, { id: "plan" }]);
});

test("normalizeState empty array pipeline stays empty (user cleared)", () => {
    const s = normalizeState({ pipeline: [] });
    assert.deepEqual(s.pipeline, []);
});

test("normalizeState rejects non-array non-null pipeline (falls back to null)", () => {
    assert.equal(normalizeState({ pipeline: "specify,plan" }).pipeline, null);
    assert.equal(normalizeState({ pipeline: 42 }).pipeline, null);
    assert.equal(normalizeState({ pipeline: {} }).pipeline, null);
});

test("normalizeState drops pipeline entries missing an id", () => {
    const s = normalizeState({ pipeline: [{ id: "specify" }, {}, { id: "" }, null, { id: "plan" }] });
    assert.deepEqual(s.pipeline, [{ id: "specify" }, { id: "plan" }]);
});

test("applyPatch: pipeline explicit null resets to inferred-spine sentinel", () => {
    const state = normalizeState({ pipeline: [{ id: "specify" }] });
    const patched = applyPatch(state, { pipeline: null });
    assert.equal(patched.pipeline, null);
});

test("applyPatch: pipeline array replaces prior array", () => {
    const state = normalizeState({ pipeline: [{ id: "specify" }] });
    const patched = applyPatch(state, { pipeline: [{ id: "plan" }, { id: "tasks" }] });
    assert.deepEqual(patched.pipeline, [{ id: "plan" }, { id: "tasks" }]);
});

test("applyPatch: pipeline absent from patch preserves prior value", () => {
    const state = normalizeState({ pipeline: [{ id: "specify" }] });
    const patched = applyPatch(state, { currentPhase: "plan" });
    assert.deepEqual(patched.pipeline, [{ id: "specify" }]);
});


// ------- inferredPipeline validation gate -------

const CANONICAL_ARTIFACTS = [
    { id: "commands/speckit.constitution", kind: "command" },
    { id: "commands/speckit.specify", kind: "command" },
    { id: "commands/speckit.plan", kind: "command" },
    { id: "commands/speckit.tasks", kind: "command" },
    { id: "commands/speckit.implement", kind: "command" },
    { id: "commands/speckit.companion.capture", kind: "command" },
];
const ASSESS_ARTIFACTS = [
    { id: "commands/speckit.assess.intake", kind: "command" },
    { id: "commands/speckit.assess.research", kind: "command" },
    { id: "commands/speckit.assess.define", kind: "command" },
    { id: "commands/speckit.assess.shape", kind: "command" },
    { id: "commands/speckit.assess.decide", kind: "command" },
];

test("validateInferredPipeline accepts augmented-canonical with all canonicals present", () => {
    const out = validateInferredPipeline({
        shape: "augmented-canonical",
        pipeline: [
            "commands/speckit.constitution",
            "commands/speckit.specify",
            "commands/speckit.companion.capture",
            "commands/speckit.plan",
            "commands/speckit.tasks",
            "commands/speckit.implement",
        ],
        unplaced: [],
        rationale: "companion hook after_specify inserts capture",
    }, CANONICAL_ARTIFACTS);
    assert.ok(out.ok);
    assert.equal(out.value.shape, "augmented-canonical");
    assert.equal(out.value.pipeline.length, 6);
});

test("validateInferredPipeline drops augmented-canonical missing a required canonical", () => {
    // Missing speckit.implement.
    const out = validateInferredPipeline({
        shape: "augmented-canonical",
        pipeline: [
            "commands/speckit.constitution",
            "commands/speckit.specify",
            "commands/speckit.plan",
            "commands/speckit.tasks",
        ],
    }, CANONICAL_ARTIFACTS);
    assert.equal(out.ok, false);
    assert.match(out.reason, /augmented-canonical.*speckit\.implement/);
});

test("validateInferredPipeline accepts standalone without canonicals", () => {
    const out = validateInferredPipeline({
        shape: "standalone",
        pipeline: [
            "commands/speckit.assess.intake",
            "commands/speckit.assess.research",
            "commands/speckit.assess.define",
            "commands/speckit.assess.shape",
            "commands/speckit.assess.decide",
        ],
        unplaced: [],
        rationale: "assess README typical flow",
    }, ASSESS_ARTIFACTS);
    assert.ok(out.ok);
    assert.equal(out.value.shape, "standalone");
    assert.equal(out.value.pipeline[0], "commands/speckit.assess.intake");
});

test("validateInferredPipeline drops standalone with pipeline.length < 3", () => {
    const out = validateInferredPipeline({
        shape: "standalone",
        pipeline: [
            "commands/speckit.assess.intake",
            "commands/speckit.assess.research",
        ],
    }, ASSESS_ARTIFACTS);
    assert.equal(out.ok, false);
    assert.match(out.reason, /standalone.*length >= 3/);
});

test("validateInferredPipeline drops any shape referencing an unknown command id", () => {
    const out = validateInferredPipeline({
        shape: "augmented-canonical",
        pipeline: [
            "commands/speckit.constitution",
            "commands/speckit.specify",
            "commands/speckit.plan",
            "commands/speckit.tasks",
            "commands/speckit.implement",
            "commands/speckit.does.not.exist",
        ],
    }, CANONICAL_ARTIFACTS);
    assert.equal(out.ok, false);
    assert.match(out.reason, /unknown command id.*does\.not\.exist/);
});

test("validateInferredPipeline drops unknown or missing shape", () => {
    assert.equal(validateInferredPipeline(null, CANONICAL_ARTIFACTS).ok, false);
    assert.match(validateInferredPipeline(null, CANONICAL_ARTIFACTS).reason, /missing/);
    assert.equal(validateInferredPipeline({}, CANONICAL_ARTIFACTS).ok, false);
    assert.equal(validateInferredPipeline({ shape: "hybrid", pipeline: [] }, CANONICAL_ARTIFACTS).ok, false);
});

test("validateInferredPipeline drops duplicates across pipeline and unplaced", () => {
    const out = validateInferredPipeline({
        shape: "standalone",
        pipeline: [
            "commands/speckit.assess.intake",
            "commands/speckit.assess.research",
            "commands/speckit.assess.define",
        ],
        unplaced: ["commands/speckit.assess.intake"], // dup
    }, ASSESS_ARTIFACTS);
    assert.equal(out.ok, false);
    assert.match(out.reason, /pipeline and unplaced|duplicat/);
});

test("applyPatch(composition.inferredPipeline) round-trips shape/pipeline/unplaced/rationale", () => {
    const patched = applyPatch(null, {
        composition: {
            presets: [], extensions: [], artifacts: [], refreshedAt: "2025-01-01T00:00:00Z",
            inferredPipeline: {
                shape: "standalone",
                pipeline: ["a", "b", "c"],
                unplaced: ["d"],
                rationale: "why",
            },
        },
    });
    assert.deepEqual(patched.composition.inferredPipeline, {
        shape: "standalone",
        pipeline: ["a", "b", "c"],
        unplaced: ["d"],
        rationale: "why",
    });
});

test("applyPatch leaves state.pipeline (user pin) untouched by inferredPipeline patches", () => {
    const before = applyPatch(null, { pipeline: [{ id: "specify" }] });
    assert.deepEqual(before.pipeline, [{ id: "specify" }]);
    const after = applyPatch(before, {
        composition: {
            presets: [], extensions: [], artifacts: [], refreshedAt: null,
            inferredPipeline: {
                shape: "standalone",
                pipeline: ["a", "b", "c"],
                unplaced: [],
                rationale: "x",
            },
        },
    });
    assert.deepEqual(after.pipeline, [{ id: "specify" }]);
    assert.equal(after.composition.inferredPipeline.shape, "standalone");
});

// -------- overlayCachedComposition (regression guardrail) --------
// The `snapshot()` helper in extension.mjs used to enumerate composition
// fields by name when overlaying `inst.cachedComposition` onto the API
// response. That silently dropped `inferredPipeline` after it was added,
// which forced the wizard's phase strip to fall back to the canonical
// spine even after showInferredPipeline accepted a standalone pipeline. These
// tests pin the overlay contract so that class of drop can't recur.

test("overlayCachedComposition preserves inferredPipeline", () => {
    const cached = {
        presets: [],
        extensions: [{ id: "assess" }],
        artifacts: [{ id: "commands/speckit.assess.intake", kind: "command" }],
        refreshedAt: "2025-01-01T00:00:00.000Z",
        inferredPipeline: {
            shape: "standalone",
            pipeline: ["commands/speckit.assess.intake"],
            unplaced: [],
            rationale: "test",
        },
    };
    const out = overlayCachedComposition(cached);
    assert.ok(out, "overlay returned");
    assert.equal(out.inferredPipeline.shape, "standalone");
    assert.deepEqual(out.inferredPipeline.pipeline, ["commands/speckit.assess.intake"]);
});

test("overlayCachedComposition omits inferredPipeline when cache lacks it", () => {
    const cached = {
        presets: [],
        extensions: [],
        artifacts: [],
        refreshedAt: null,
    };
    const out = overlayCachedComposition(cached);
    assert.ok(out);
    assert.equal("inferredPipeline" in out, false, "should not synthesize a null field");
});

test("overlayCachedComposition rejects a malformed inferredPipeline shape", () => {
    // Guard: cache is normally validated on write, but if a bad shape ever
    // leaks in (e.g. a stray string), the overlay must not propagate it.
    const cached = { presets: [], extensions: [], artifacts: [], inferredPipeline: "nope" };
    const out = overlayCachedComposition(cached);
    assert.equal("inferredPipeline" in out, false);
});

test("overlayCachedComposition returns null when cache is null/undefined", () => {
    assert.equal(overlayCachedComposition(null), null);
    assert.equal(overlayCachedComposition(undefined), null);
});

test("overlayCachedComposition copies arrays (not references) so mutations don't leak", () => {
    const cached = {
        presets: [],
        extensions: [],
        artifacts: [{ id: "a" }],
        refreshedAt: null,
    };
    const out = overlayCachedComposition(cached);
    out.artifacts.push({ id: "b" });
    assert.equal(cached.artifacts.length, 1, "cached.artifacts must not be mutated");
});

// ---------------------------------------------------------------------------
// normalizeExecutionReports + computeItemStatuses (phase.viewExecution)
// ---------------------------------------------------------------------------
// The wizard's phase card renders per-artifact pills from a witness map
// keyed by singular kind. The normalizer is the last line of defense: it
// gates what makes it out of the state store, so the UI can trust the
// shape without extra validation.

test("normalizeExecutionReports returns null for non-objects", () => {
    assert.equal(normalizeExecutionReports(null), null);
    assert.equal(normalizeExecutionReports(undefined), null);
    assert.equal(normalizeExecutionReports("nope"), null);
    assert.equal(normalizeExecutionReports([]), null);
});

test("normalizeExecutionReports drops entries without expected", () => {
    // Entries need at least an `expected` bucket — that's what the
    // canonical body declares. artifacts can legitimately be null (agent
    // declined to report).
    const out = normalizeExecutionReports({
        "commands/speckit.specify": { artifacts: null },
    });
    assert.equal(out, null);
});

test("normalizeExecutionReports keeps well-formed v2 entries and preserves artifacts:null", () => {
    const out = normalizeExecutionReports({
        "commands/speckit.specify": {
            expected: {
                templates: ["spec-template"],
                scripts: ["check-prerequisites"],
                hooks: ["before_specify", "after_specify"],
            },
            artifacts: null,
            sourcePath: ".github/skills/speckit-specify/SKILL.md",
            sourceHash: "sha256:abc",
            sessionId: "s-1",
            sessionWindow: { startedAt: "2026-01-01T00:00:00Z", endedAt: "2026-01-01T00:01:00Z" },
            analyzedAt: "2026-01-01T00:02:00Z",
            stale: false,
        },
    });
    const e = out["commands/speckit.specify"];
    assert.deepEqual(e.expected.templates, ["spec-template"]);
    assert.equal(e.artifacts, null, "artifacts:null must be preserved");
    assert.equal(e.sourcePath, ".github/skills/speckit-specify/SKILL.md");
    assert.equal(e.stale, false);
});

test("normalizeExecutionReports accepts v2 artifacts witness map with per-id state", () => {
    const out = normalizeExecutionReports({
        "commands/speckit.constitution": {
            expected: {
                templates: ["constitution-template"],
                scripts: [],
                hooks: ["before_constitution", "after_constitution"],
            },
            artifacts: {
                template: { "constitution-template": { state: "executed", detail: "loaded" } },
                hook: {
                    before_constitution: { state: "omitted", detail: "no hooks registered" },
                    after_constitution:  { state: "omitted" },
                },
                // script bucket intentionally omitted — should be empty
            },
        },
    });
    const e = out["commands/speckit.constitution"];
    assert.equal(e.artifacts.template["constitution-template"].state, "executed");
    assert.equal(e.artifacts.template["constitution-template"].detail, "loaded");
    assert.equal(e.artifacts.hook.before_constitution.state, "omitted");
    assert.equal(e.artifacts.hook.after_constitution.state, "omitted");
    assert.equal(e.artifacts.hook.after_constitution.detail, null);
    assert.deepEqual(e.artifacts.script, {});
});

test("normalizeExecutionReports accepts plural kind aliases (templates/scripts/hooks)", () => {
    // The wire schema uses singular keys, but plural aliases are tolerated
    // so agents don't fail silently on typos.
    const out = normalizeExecutionReports({
        "commands/speckit.tasks": {
            expected: { templates: ["tasks-template"], scripts: [], hooks: [] },
            artifacts: {
                templates: { "tasks-template": { state: "executed" } },
            },
        },
    });
    assert.equal(out["commands/speckit.tasks"].artifacts.template["tasks-template"].state, "executed");
});

test("normalizeExecutionReports treats missing artifacts as agent-declined (null)", () => {
    // No `artifacts` key at all → witness map is null (agent didn't report).
    const out = normalizeExecutionReports({
        "commands/speckit.setup": {
            expected: { templates: [], scripts: [], hooks: [] },
        },
    });
    assert.equal(out["commands/speckit.setup"].artifacts, null);
});

test("normalizeExecutionReports drops keys that aren't commands/*", () => {
    const out = normalizeExecutionReports({
        "artifacts/foo": { expected: { templates: ["x"], scripts: [], hooks: [] } },
        "commands/speckit.plan": {
            expected: { templates: ["plan-template"], scripts: [], hooks: [] },
            artifacts: { template: { "plan-template": { state: "executed" } } },
        },
    });
    assert.ok(out);
    assert.equal("artifacts/foo" in out, false);
    assert.ok("commands/speckit.plan" in out);
});

test("normalizeExecutionReports coerces missing expected buckets to empty arrays", () => {
    // Partial `expected` is fine — a phase with no scripts still has an
    // expected.scripts:[] slot so the renderer can iterate without guards.
    const out = normalizeExecutionReports({
        "commands/speckit.checklist": {
            expected: { templates: ["checklist-template"] },
            artifacts: { hook: { after_checklist: { state: "executed" } } },
        },
    });
    const e = out["commands/speckit.checklist"];
    assert.deepEqual(e.expected.scripts, []);
    assert.deepEqual(e.expected.hooks, []);
    // artifacts.script and artifacts.template must exist as empty maps for
    // stable iteration in the renderer.
    assert.deepEqual(e.artifacts.template, {});
    assert.deepEqual(e.artifacts.script, {});
});

test("applyPatch composition writes executionReports through the normalizer", () => {
    let state = normalizeState({});
    state = applyPatch(state, {
        composition: {
            executionReports: {
                "commands/speckit.specify": {
                    expected: { templates: ["spec-template"], scripts: [], hooks: ["after_specify"] },
                    artifacts: {
                        template: { "spec-template": { state: "executed" } },
                        hook: { after_specify: { state: "omitted" } },
                    },
                    sourcePath: ".github/skills/speckit-specify/SKILL.md",
                    analyzedAt: "2026-01-01T00:00:00Z",
                },
                "artifacts/foo": { expected: { templates: ["x"] } },
            },
        },
    });
    const er = state.composition.executionReports;
    assert.ok(er);
    assert.equal("artifacts/foo" in er, false, "non-command keys must be dropped");
    assert.equal(er["commands/speckit.specify"].artifacts.hook.after_specify.state, "omitted");
});

// ---------------------------------------------------------------------------
// mergeExecutionReportEntry — sticky-executed rule so an amendment run
// (e.g. resolving a [NEEDS CLARIFICATION] without reloading the template)
// doesn't downgrade a previously observed `executed` verdict to `omitted`.
// ---------------------------------------------------------------------------

const _mkEntry = (artifacts) => ({
    expected: { templates: ["spec-template"], scripts: [], hooks: ["after_specify"] },
    artifacts,
    sourcePath: ".github/skills/speckit-specify/SKILL.md",
    sourceHash: null,
    sessionId: null,
    sessionWindow: null,
    analyzedAt: "2026-01-02T00:00:00Z",
    stale: false,
});

test("mergeExecutionReportEntry keeps prior executed when new report says omitted", () => {
    const prev = _mkEntry({
        template: { "spec-template": { state: "executed", detail: "first run" } },
        script: {},
        hook: {},
    });
    const next = _mkEntry({
        template: { "spec-template": { state: "omitted", detail: "amendment run" } },
        script: {},
        hook: {},
    });
    const merged = mergeExecutionReportEntry(prev, next);
    assert.equal(merged.artifacts.template["spec-template"].state, "executed");
    assert.equal(merged.artifacts.template["spec-template"].detail, "first run");
});

test("mergeExecutionReportEntry keeps prior executed when new report omits the id", () => {
    const prev = _mkEntry({
        template: { "spec-template": { state: "executed", detail: null } },
        script: {},
        hook: { after_specify: { state: "omitted", detail: null } },
    });
    const next = _mkEntry({ template: {}, script: {}, hook: {} });
    const merged = mergeExecutionReportEntry(prev, next);
    assert.equal(merged.artifacts.template["spec-template"].state, "executed");
    assert.equal(merged.artifacts.hook.after_specify.state, "omitted");
});

test("mergeExecutionReportEntry lets new executed win over prior omitted", () => {
    const prev = _mkEntry({
        template: { "spec-template": { state: "omitted", detail: null } },
        script: {},
        hook: {},
    });
    const next = _mkEntry({
        template: { "spec-template": { state: "executed", detail: "reran" } },
        script: {},
        hook: {},
    });
    const merged = mergeExecutionReportEntry(prev, next);
    assert.equal(merged.artifacts.template["spec-template"].state, "executed");
    assert.equal(merged.artifacts.template["spec-template"].detail, "reran");
});

test("mergeExecutionReportEntry keeps prior artifacts when new artifacts is null (agent declined)", () => {
    const prev = _mkEntry({
        template: { "spec-template": { state: "executed", detail: null } },
        script: {},
        hook: {},
    });
    const next = _mkEntry(null);
    const merged = mergeExecutionReportEntry(prev, next);
    assert.equal(merged.artifacts.template["spec-template"].state, "executed");
});

test("mergeExecutionReportEntry returns new entry when no prior exists", () => {
    const next = _mkEntry({
        template: { "spec-template": { state: "executed", detail: null } },
        script: {},
        hook: {},
    });
    const merged = mergeExecutionReportEntry(null, next);
    assert.equal(merged, next);
});

// ---------------------------------------------------------------------------
// computeItemStatuses — expected-vs-artifacts status list
// ---------------------------------------------------------------------------

test("computeItemStatuses maps expected+artifacts to the witness vocabulary", () => {
    const statuses = computeItemStatuses(
        { templates: ["spec-template"], scripts: ["check-prerequisites"], hooks: ["before_specify", "after_specify"] },
        {
            template: { "spec-template": { state: "executed" } },
            script:   {},  // check-prerequisites → unknown (absence)
            hook: {
                after_specify: { state: "omitted" },
                custom_hook:   { state: "executed" }, // unexpected bonus
            },
        },
    );
    assert.deepEqual(statuses, [
        { kind: "template", name: "spec-template", status: "executed" },
        { kind: "script", name: "check-prerequisites", status: "unknown" },
        { kind: "hook", name: "before_specify", status: "unknown" },
        { kind: "hook", name: "after_specify", status: "omitted" },
        { kind: "hook", name: "custom_hook", status: "unexpected", reportedState: "executed" },
    ]);
});

test("computeItemStatuses returns 'unknown' for every expected item when artifacts is null", () => {
    const statuses = computeItemStatuses(
        { templates: ["spec-template"], scripts: [], hooks: ["after_specify"] },
        null,
    );
    assert.deepEqual(statuses, [
        { kind: "template", name: "spec-template", status: "unknown" },
        { kind: "hook", name: "after_specify", status: "unknown" },
    ]);
});

test("computeItemStatuses handles missing/empty buckets gracefully", () => {
    assert.deepEqual(computeItemStatuses({}, {}), []);
    assert.deepEqual(
        computeItemStatuses(
            { templates: ["a"] },
            { template: { a: { state: "executed" } } },
        ),
        [{ kind: "template", name: "a", status: "executed" }],
    );
});
});

describe("scanner", () => {
// Tests for project-scanner.mjs — uses an injected in-memory fs bag; no real disk.

// Simple in-memory filesystem.
// Files map: { "abs/path" → string content, "abs/path/DIR" → true (marker) }.
function makeFs(files) {
    const norm = (p) => p.replace(/\\/g, "/");
    const store = new Map(Object.entries(files).map(([k, v]) => [norm(k), v]));
    const fileContent = (v) => (typeof v === "object" && v !== null ? v.content : v);
    const fileMtimeMs = (v) => (typeof v === "object" && v !== null ? v.mtimeMs : 2);
    const isDir = (p) => {
        const np = norm(p);
        if (store.get(np) === "__DIR__") return true;
        // Directory if any file lives under it.
        for (const k of store.keys()) {
            if (k.startsWith(np + "/")) return true;
        }
        return false;
    };
    return {
        _store: store,
        pathExists: async (p) => {
            const np = norm(p);
            return store.has(np) || isDir(np);
        },
        stat: async (p) => {
            const np = norm(p);
            if (isDir(np) && !store.has(np))
                return { isFile: () => false, isDirectory: () => true, size: 0, mtimeMs: 1 };
            const v = store.get(np);
            if (v === undefined) throw new Error(`ENOENT: ${p}`);
            const content = fileContent(v);
            const size = typeof content === "string" ? content.length : 0;
            return { isFile: () => v !== "__DIR__", isDirectory: () => v === "__DIR__", size, mtimeMs: fileMtimeMs(v) };
        },
        readFile: async (p) => {
            const v = fileContent(store.get(norm(p)));
            if (typeof v !== "string" || v === "__DIR__") throw new Error(`ENOENT: ${p}`);
            return v;
        },
        realpath: async (p) => {
            const np = norm(p);
            if (!store.has(np) && !isDir(np)) throw new Error(`ENOENT: ${p}`);
            return p;
        },
        readdir: async (p) => {
            const np = norm(p) + "/";
            const names = new Set();
            for (const k of store.keys()) {
                if (!k.startsWith(np)) continue;
                const rest = k.slice(np.length);
                const first = rest.split("/")[0];
                if (!first) continue;
                names.add(first);
            }
            return Array.from(names).map((name) => ({
                name,
                isFile: () => !isDir(np + name),
                isDirectory: () => isDir(np + name),
            }));
        },
    };
}

test("scanWorkspace with empty workspace returns un-initialized state", async () => {
    const fs = makeFs({});
    const scan = await scanWorkspace("/proj", fs);
    assert.equal(scan.projectInitialized, false);
    assert.equal(scan.setup.projectInitialized, false);
    assert.equal(scan.currentPhase, "setup");
    // Composition scanner emits { presets, extensions } — empty when
    // no .specify/*.json files exist. The synthetic "core" bottom layer
    // is added by consumers via deriveLayers (ui/composition.js).
    assert.deepEqual(scan.composition.presets, []);
    assert.deepEqual(scan.composition.extensions, []);
});

test("scanWorkspace picks up constitution.md and sets phase status", async () => {
    const fs = makeFs({
        "/proj/.specify": "__DIR__",
        "/proj/.specify/memory/constitution.md": "<!-- speckit:constitution v1 -->\nprinciples...",
    });
    const scan = await scanWorkspace("/proj", fs);
    assert.equal(scan.projectInitialized, true);
    assert.equal(scan.constitutionPath, ".specify/memory/constitution.md");
    assert.equal(scan.phases.constitution.status, "done");
});

test("scanWorkspace keeps constitution done when placeholder breadcrumbs are only in comments", async () => {
    const withCommentPlaceholders = [
        "<!--",
        "Sync Impact Report",
        "- [PRINCIPLE_1_NAME] → I. Clarity Over Cleverness",
        "- [PRINCIPLE_2_NAME] → II. Small, Reviewable Changes",
        "- [SECTION_2_NAME] → Engineering Standards",
        "- [SECTION_3_NAME] → Governance",
        "-->",
        "# Project Constitution",
        "",
        "## I. Clarity Over Cleverness",
        "Prefer readable code.",
    ].join("\n");
    const fs = makeFs({
        "/proj/.specify": "__DIR__",
        "/proj/.specify/memory/constitution.md": withCommentPlaceholders,
    });
    const scan = await scanWorkspace("/proj", fs);
    assert.equal(scan.phases.constitution.status, "done");
    assert.equal(scan.phases.constitution.artifactPath, ".specify/memory/constitution.md");
});

test("scanWorkspace keeps untouched constitution scaffold empty", async () => {
    const fs = makeFs({
        "/proj/.specify": "__DIR__",
        "/proj/.specify/memory/constitution.md": [
            "# [PROJECT_NAME] Constitution",
            "",
            "## I. [PRINCIPLE_1_NAME]",
            "[PRINCIPLE_1_DESCRIPTION]",
        ].join("\n"),
    });
    const scan = await scanWorkspace("/proj", fs);
    assert.equal(scan.phases.constitution.status, "empty");
    assert.equal(scan.phases.constitution.artifactPath, ".specify/memory/constitution.md");
});

test("scanWorkspace treats existing spec artifacts as done even with placeholders", async () => {
    const fs = makeFs({
        "/proj/.specify": "__DIR__",
        "/proj/specs/feature/spec.md": [
            "# Feature",
            "",
            "Call the [API] endpoint and render the [URL].",
        ].join("\n"),
    });
    const scan = await scanWorkspace("/proj", fs);
    assert.equal(scan.phases.specify.status, "done");
    assert.equal(scan.phases.specify.artifactPath, "specs/feature/spec.md");
});

test("scanWorkspace hydrates specs/<slug>/ artifacts and picks most recent slug", async () => {
    const fs = makeFs({
        "/proj/.specify": "__DIR__",
        "/proj/specs/older-slug/spec.md": "<!-- speckit:specify v1 -->\n",
        "/proj/specs/newer-slug/spec.md": "<!-- speckit:specify v1 -->\n",
        "/proj/specs/newer-slug/plan.md": "<!-- speckit:plan v1 -->\n",
        "/proj/specs/newer-slug/tasks.md": "<!-- speckit:tasks v1 -->\n",
    });
    // Force different mtimes: newer-slug last.
    const origStat = fs.stat;
    fs.stat = async (p) => {
        const s = await origStat(p);
        if (String(p).includes("newer-slug")) return { ...s, mtimeMs: 999 };
        return s;
    };
    const scan = await scanWorkspace("/proj", fs);
    assert.equal(scan.slug, "newer-slug");
    assert.equal(scan.phases.specify.status, "done");
    assert.equal(scan.phases.plan.status, "done");
    assert.equal(scan.phases.tasks.status, "done");
    assert.equal(scan.phases.converge.status, "empty");
    assert.equal(scan.phases.converge.artifactPath, "specs/newer-slug/tasks.md");
});

test("scanWorkspace treats existing task artifact as done with task markers", async () => {
    const fs = makeFs({
        "/proj/.specify": "__DIR__",
        "/proj/specs/feature/tasks.md": [
            "# Tasks",
            "",
            "- [ ] T001 [P] [US1] [ID] Write unit tests",
            "- [ ] T002 [US1] [ID] Implement feature path",
            "- [ ] T010 [P] [US10] Add reporting flow",
            "- [ ] T011 [US11] Wire admin flow",
        ].join("\n"),
    });
    const scan = await scanWorkspace("/proj", fs);
    assert.equal(scan.phases.tasks.status, "done");
    assert.equal(scan.phases.tasks.artifactPath, "specs/feature/tasks.md");
});

test("scanWorkspace does not mark checklist done from directory contents alone", async () => {
    const fs = makeFs({
        "/proj/.specify": "__DIR__",
        "/proj/specs/feature/checklists/requirements.md": "# Requirements",
    });
    const scan = await scanWorkspace("/proj", fs);
    assert.equal(scan.phases.checklist.status, "empty");
    assert.equal(scan.phases.checklist.artifactPath, "specs/<slug>/checklists/");
});

test("scanWorkspace prefers configured checklist file when checklist already ran", async () => {
    const fs = makeFs({
        "/proj/.specify": "__DIR__",
        "/proj/.speckit-wizard": "__DIR__",
        "/proj/.speckit-wizard/state.json": JSON.stringify({
            phases: {
                checklist: {
                    status: "done",
                    formValues: { checklistFile: "security.md" },
                },
            },
        }),
        "/proj/specs/feature/checklists/requirements.md": "# Requirements",
        "/proj/specs/feature/checklists/security.md": "# Security",
    });
    const scan = await scanWorkspace("/proj", fs);
    assert.equal(scan.phases.checklist.status, "done");
    assert.equal(scan.phases.checklist.artifactPath, "specs/feature/checklists/security.md");
});

test("scanWorkspace lets rerun checklist filename override persisted artifact path", async () => {
    const fs = makeFs({
        "/proj/.specify": "__DIR__",
        "/proj/.speckit-wizard": "__DIR__",
        "/proj/.speckit-wizard/state.json": JSON.stringify({
            phases: {
                checklist: {
                    status: "done",
                    artifactPath: "specs/feature/checklists/requirements.md",
                    formValues: { checklistFile: "security.md" },
                },
            },
        }),
        "/proj/specs/feature/checklists/requirements.md": "# Requirements",
        "/proj/specs/feature/checklists/security.md": "# Security",
    });
    const scan = await scanWorkspace("/proj", fs);
    assert.equal(scan.phases.checklist.status, "done");
    assert.equal(scan.phases.checklist.artifactPath, "specs/feature/checklists/security.md");
});

test("scanWorkspace resolves checklist folder to newest markdown file after checklist ran", async () => {
    const fs = makeFs({
        "/proj/.specify": "__DIR__",
        "/proj/.speckit-wizard": "__DIR__",
        "/proj/.speckit-wizard/state.json": JSON.stringify({
            phases: {
                checklist: {
                    status: "done",
                    artifactPath: "specs/feature/checklists/",
                },
            },
        }),
        "/proj/specs/feature/checklists/requirements.md": "# Requirements",
        "/proj/specs/feature/checklists/security.md": "# Security",
        "/proj/specs/feature/checklists/accessibility.md": "# Accessibility",
    });
    const origStat = fs.stat;
    fs.stat = async (p) => {
        const s = await origStat(p);
        if (String(p).includes("security.md")) return { ...s, mtimeMs: 20 };
        if (String(p).includes("accessibility.md")) return { ...s, mtimeMs: 30 };
        if (String(p).includes("requirements.md")) return { ...s, mtimeMs: 10 };
        return s;
    };
    const scan = await scanWorkspace("/proj", fs);
    assert.equal(scan.phases.checklist.status, "done");
    assert.equal(scan.phases.checklist.artifactPath, "specs/feature/checklists/accessibility.md");
});

test("scanWorkspace falls back to checklist folderPath when done checklist file is missing", async () => {
    const fs = makeFs({
        "/proj/.specify": "__DIR__",
        "/proj/.speckit-wizard": "__DIR__",
        "/proj/.speckit-wizard/state.json": JSON.stringify({
            phases: {
                checklist: {
                    status: "done",
                    artifactPath: "specs/<slug>/checklists/",
                    formValues: { checklistFile: "security.md" },
                },
            },
        }),
        "/proj/specs/feature/checklists": "__DIR__",
    });
    const scan = await scanWorkspace("/proj", fs);
    assert.equal(scan.phases.checklist.status, "done");
    assert.equal(scan.phases.checklist.artifactPath, null);
    assert.equal(scan.phases.checklist.folderPath, "specs/feature/checklists");
});

test("scanWorkspace ignores checklist paths outside the active checklists directory", async () => {
    const fs = makeFs({
        "/proj/.specify": "__DIR__",
        "/proj/.speckit-wizard": "__DIR__",
        "/proj/.speckit-wizard/state.json": JSON.stringify({
            phases: {
                checklist: {
                    status: "done",
                    artifactPath: "../outside/secret.md",
                    formValues: { checklistFile: "/outside/secret.md" },
                },
            },
        }),
        "/proj/specs/feature/checklists/requirements.md": "# Requirements",
        "/outside/secret.md": "# Secret",
    });
    for (const op of ["pathExists", "readdir", "stat"]) {
        const original = fs[op];
        fs[op] = async (p, ...args) => {
            assert.equal(String(p).replace(/\\/g, "/").includes("/outside/"), false, `${op} probed ${p}`);
            return original(p, ...args);
        };
    }
    const scan = await scanWorkspace("/proj", fs);
    assert.equal(scan.phases.checklist.status, "done");
    assert.equal(scan.phases.checklist.artifactPath, "specs/feature/checklists/requirements.md");
});

test("scanWorkspace defensively normalizes malformed state.json", async () => {
    const fs = makeFs({
        "/proj/.specify": "__DIR__",
        "/proj/.speckit-wizard": "__DIR__",
        // Malformed JSON — should not throw, should not corrupt state.
        "/proj/.speckit-wizard/state.json": "{ not json",
    });
    const scan = await scanWorkspace("/proj", fs);
    // Should default currentPhase to 'setup', phases populated with empty slices
    assert.equal(scan.currentPhase, "setup");
    assert.equal(scan.phases.constitution.status, "empty");
});

test("scanWorkspace ignores alias status strings gracefully", async () => {
    const fs = makeFs({
        "/proj/.specify": "__DIR__",
        "/proj/.speckit-wizard": "__DIR__",
        "/proj/.speckit-wizard/state.json": JSON.stringify({
            $schema: "speckit-wizard/v1",
            currentPhase: "plan",
            preset: "core",
            setup: { cliInstalled: true, projectInitialized: true, skillsReloaded: true },
            phases: {
                constitution: { status: "COMPLETED" },
                specify: { status: "in-progress" },
                plan: { status: "running" },
                clarify: { status: "skip", optionalSkipped: true },
            },
        }),
    });
    const scan = await scanWorkspace("/proj", fs);
    assert.equal(scan.phases.constitution.status, "done");
    assert.equal(scan.phases.specify.status, "in_progress");
    assert.equal(scan.phases.plan.status, "in_progress");
    assert.equal(scan.phases.clarify.status, "skipped");
    assert.equal(scan.phases.clarify.optionalSkipped, true);
    assert.equal(scan.currentPhase, "plan");
});

test("scanWorkspace drops malformed composition entries defensively", async () => {
    const fs = makeFs({
        "/proj/.specify": "__DIR__",
        "/proj/.specify/presets.json": JSON.stringify([
            { name: "lean" },
            { source: "no name" }, // dropped (no name)
            null, // dropped
            "string", // dropped
        ]),
    });
    const scan = await scanWorkspace("/proj", fs);
    const names = scan.composition.presets.map((p) => p.name);
    assert.ok(names.includes("lean"));
    // 3 malformed entries should not appear
    assert.equal(scan.composition.presets.length, 1);
});

test("readMarkdownArtifact: detects provenance marker and returns null for missing paths", async () => {
    const fs = makeFs({
        "/proj/.specify/memory/constitution.md": "<!-- speckit:constitution v1 -->\nbody",
    });
    const r = await readMarkdownArtifact("/proj", ".specify/memory/constitution.md", fs);
    assert.deepEqual(r.marker, { phase: "constitution", version: 1 });
    const missing = await readMarkdownArtifact("/proj", "does/not/exist.md", fs);
    assert.equal(missing, null);
});

test("scanWorkspace tolerates missing artifact-targets.json (no cache = no extension entries)", async () => {
    const fs = makeFs({
        "/proj/.specify": "__DIR__",
        "/proj/.specify/extensions/assess/commands/speckit.assess.intake.md": "# skill",
        "/proj/.specify/assessments/foo/intake.md": "some content",
    });
    const scan = await scanWorkspace("/proj", fs);
    // Without a cache, we don't guess. Extension command has no phase entry.
    assert.equal(scan.phases["commands/speckit.assess.intake"], undefined);
    assert.deepEqual(scan.warnings, []);
});

test("scanWorkspace leaves writesTo template as-is when there is no slug", async () => {
    const fs = makeFs({
        "/proj/.specify": "__DIR__",
        // Extension command file must exist so pruning doesn't drop the entry.
        "/proj/.specify/extensions/assess/commands/speckit.assess.intake.md": "# intake skill",
        "/proj/.speckit-wizard/artifact-targets.json": JSON.stringify({
            version: 1,
            entries: {
                "commands/speckit.assess.intake": {
                    writesTo: ".specify/assessments/<slug>/intake.md",
                    source: "manual",
                },
            },
        }),
    });
    const scan = await scanWorkspace("/proj", fs);
    // No specs/<slug>/ folder → slug is null → template stays literal so the
    // UI can still surface "where this will eventually write".
    assert.equal(
        scan.phases["commands/speckit.assess.intake"]?.artifactPath,
        ".specify/assessments/<slug>/intake.md",
    );
    assert.equal(scan.phases["commands/speckit.assess.intake"]?.status, "empty");
});

test("scanWorkspace treats existing extension artifacts as done even with placeholders", async () => {
    const fs = makeFs({
        "/proj/.specify": "__DIR__",
        "/proj/.specify/extensions/assess/commands/speckit.assess.intake.md": "# intake skill",
        "/proj/.specify/assessments/demo/intake.md": "Capture [API] and [URL] details.",
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
    const scan = await scanWorkspace("/proj", fs);
    assert.equal(scan.phases["commands/speckit.assess.intake"]?.status, "done");
    assert.equal(scan.phases["commands/speckit.assess.intake"]?.artifactPath, ".specify/assessments/demo/intake.md");
});

test("scanWorkspace emits relative artifact paths for absolute in-workspace extension targets", async () => {
    const fs = makeFs({
        "/proj/.specify": "__DIR__",
        "/proj/.specify/extensions/assess/commands/speckit.assess.intake.md": "# intake skill",
        "/proj/.specify/assessments/demo/intake.md": "intake",
        "/proj/.speckit-wizard/artifact-targets.json": JSON.stringify({
            version: 1,
            entries: {
                "commands/speckit.assess.intake": {
                    writesTo: "/proj/.specify/assessments/demo/intake.md",
                    source: "manual",
                },
            },
        }),
    });

    const scan = await scanWorkspace("/proj", fs);
    const phase = scan.phases["commands/speckit.assess.intake"];
    assert.equal(phase?.status, "done");
    assert.equal(phase?.artifactPath, ".specify/assessments/demo/intake.md");
});

test("scanWorkspace keeps missing extension artifacts empty when realpath is unavailable", async () => {
    const fs = makeFs({
        "/proj/.specify": "__DIR__",
        "/proj/.specify/extensions/assess/commands/speckit.assess.intake.md": "# intake skill",
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
    delete fs.realpath;

    const scan = await scanWorkspace("/proj", fs);
    const phase = scan.phases["commands/speckit.assess.intake"];
    assert.equal(phase?.status, "empty");
    assert.equal(phase?.artifactPath, ".specify/assessments/demo/intake.md");
    assert.equal(phase?.lastRunAt ?? null, null);
});

test("scanWorkspace advances extension folder fallback lastRunAt from newest off-name markdown", async () => {
    const firstRunMs = Date.parse("2026-01-01T00:00:00.000Z");
    const secondRunMs = Date.parse("2026-01-01T00:05:00.000Z");
    const fs = makeFs({
        "/proj/.specify": "__DIR__",
        "/proj/.specify/extensions/assess/commands/speckit.assess.intake.md": "# intake skill",
        "/proj/.specify/assessments/demo/notes.md": { content: "first run", mtimeMs: firstRunMs },
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

    const firstScan = await scanWorkspace("/proj", fs);
    assert.equal(
        firstScan.phases["commands/speckit.assess.intake"]?.lastRunAt,
        new Date(firstRunMs).toISOString(),
    );

    fs._store.set("/proj/.specify/assessments/demo/notes.md", { content: "second run", mtimeMs: secondRunMs });
    const secondScan = await scanWorkspace("/proj", fs);
    assert.equal(
        secondScan.phases["commands/speckit.assess.intake"]?.lastRunAt,
        new Date(secondRunMs).toISOString(),
    );
});

test("scanWorkspace leaves extension folder fallback lastRunAt null when folder has no markdown", async () => {
    const fs = makeFs({
        "/proj/.specify": "__DIR__",
        "/proj/.specify/extensions/assess/commands/speckit.assess.intake.md": "# intake skill",
        "/proj/.specify/assessments/demo": "__DIR__",
        "/proj/.specify/assessments/demo/notes.txt": { content: "not markdown", mtimeMs: Date.parse("2026-01-01T00:00:00.000Z") },
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
    const scan = await scanWorkspace("/proj", fs);
    assert.equal(scan.phases["commands/speckit.assess.intake"]?.folderPath, ".specify/assessments/demo");
    assert.equal(scan.phases["commands/speckit.assess.intake"]?.lastRunAt ?? null, null);
});

test("scanWorkspace ignores malformed cache entries", async () => {
    const fs = makeFs({
        "/proj/.specify": "__DIR__",
        // Only .shape is installed; the others would be pruned as orphans even if
        // present in cache, but the test is really about MALFORMED entries — so
        // include the installed file for the well-formed one.
        "/proj/.specify/extensions/assess/commands/speckit.assess.shape.md": "# shape skill",
        "/proj/.speckit-wizard/artifact-targets.json": JSON.stringify({
            version: 1,
            entries: {
                "commands/speckit.assess.intake": { writesTo: null }, // bad
                "commands/speckit.assess.define": {},                  // missing
                "not-a-command/foo": { writesTo: ".specify/foo.md" },   // wrong prefix
                "commands/speckit.assess.shape": { writesTo: ".specify/assessments/x/concept.md" }, // good
            },
        }),
    });
    const scan = await scanWorkspace("/proj", fs);
    assert.equal(scan.phases["commands/speckit.assess.intake"], undefined);
    assert.equal(scan.phases["commands/speckit.assess.define"], undefined);
    assert.equal(scan.phases["not-a-command/foo"], undefined);
    assert.equal(
        scan.phases["commands/speckit.assess.shape"]?.artifactPath,
        ".specify/assessments/x/concept.md",
    );
});


test("scanWorkspace prunes orphan cache entries whose extension is no longer installed", async () => {
    // Two branches collapsed: (a) extensions dir exists but is empty (user
    // uninstalled everything), (b) extensions dir doesn't exist at all
    // (never installed). Both must produce the same behavior: every
    // commands/* entry in the cache is pruned as an orphan.
    for (const extDirPresent of [true, false]) {
        const files = {
            "/proj/.specify": "__DIR__",
            "/proj/.speckit-wizard/artifact-targets.json": JSON.stringify({
                version: 1,
                entries: {
                    "commands/speckit.assess.intake": { writesTo: ".specify/assessments/<slug>/intake.md", source: "llm" },
                    "commands/speckit.assess.decide": { writesTo: ".specify/assessments/<slug>/decision.md", source: "llm" },
                },
            }),
        };
        if (extDirPresent) files["/proj/.specify/extensions"] = "__DIR__";
        const fs = makeFs(files);
        const scan = await scanWorkspace("/proj", fs);
        assert.equal(scan.phases["commands/speckit.assess.intake"], undefined, `extDirPresent=${extDirPresent}`);
        assert.equal(scan.phases["commands/speckit.assess.decide"], undefined, `extDirPresent=${extDirPresent}`);
    }
});

test("scanWorkspace keeps entries that match installed extension commands, prunes only the rest", async () => {
    const fs = makeFs({
        "/proj/.specify": "__DIR__",
        // Only `intake` is currently installed.
        "/proj/.specify/extensions/assess/commands/speckit.assess.intake.md": "# intake skill",
        "/proj/.speckit-wizard/artifact-targets.json": JSON.stringify({
            version: 1,
            entries: {
                "commands/speckit.assess.intake":   { writesTo: ".specify/assessments/<slug>/intake.md",   source: "llm" },
                // Orphan — its skill was removed but cache still has it.
                "commands/speckit.assess.research": { writesTo: ".specify/assessments/<slug>/research.md", source: "llm" },
            },
        }),
    });
    const scan = await scanWorkspace("/proj", fs);
    assert.equal(scan.phases["commands/speckit.assess.intake"]?.artifactPath, ".specify/assessments/<slug>/intake.md");
    assert.equal(scan.phases["commands/speckit.assess.research"], undefined);
});

test("scanWorkspace: empty workspace (no extensions, no cache) doesn't create phase entries or errors", async () => {
    // The "first launch, nothing installed" case — a canary for the trigger
    // timing. Nothing to hydrate, nothing to prune, no warnings.
    const fs = makeFs({});
    const scan = await scanWorkspace("/proj", fs);
    // No commands/* keys in phases.
    const cmdKeys = Object.keys(scan.phases).filter((k) => k.startsWith("commands/"));
    assert.deepEqual(cmdKeys, []);
    assert.deepEqual(scan.warnings, []);
});
});

describe("prompts", () => {
// Tests for prompts.mjs — only the pure structural checks that are NOT
// covered by the module-seam integration tests.
//
// Everything phrase/regex/substring on the emitted prompt body has been
// dropped; the integration tests (S1×S2 dispatchable, S2 phase-id
// contract, S2 executionReports vocabulary, S3×S2 http-roundtrip) exercise
// the real data contract between prompt builder → agent → state-store,
// and would fail on the same regressions.

const CTX = { workspacePath: "C:/Users/me/proj" };

test("buildPrompt throws UnknownActionKindError for unknown kind", () => {
    // The prompt builder is the dispatch table's endpoint — any unknown
    // kind must throw a typed error so the server can 400 on it rather
    // than silently emit an empty prompt to the agent.
    assert.throws(
        () => buildPrompt("bogus.kind", {}, CTX),
        (e) => e instanceof UnknownActionKindError && e.code === "UNKNOWN_KIND",
    );
});

test("buildPrompt embeds the form payload as parseable JSON", () => {
    // The prompt is the wire between the UI form and the agent — the agent
    // must be able to JSON.parse the payload block. We assert only the
    // structural round-trip, not the surrounding copy.
    const payload = { principles: "Testing first", flag: true, nested: { count: 3 } };
    const p = buildPrompt("constitution", payload, CTX);
    // Find any JSON object in the prompt whose structure matches our
    // payload. This test would fail if the prompt builder ever stopped
    // JSON-encoding the payload, without needing to know the exact
    // wrapping copy.
    const roundTrip = promptsInternal.fmtPayload(payload);
    const parsed = JSON.parse(roundTrip);
    assert.deepEqual(parsed, payload);
    assert.ok(p.includes(roundTrip), "prompt body must embed the JSON payload verbatim");
});

test("buildWorkflowSlashCommand normalizes command names to hyphen form", () => {
    // Pure string-transform contract: dot ↔ hyphen, leading slash tolerated,
    // multi-segment extension commands preserved, non-speckit rejected.
    assert.equal(
        buildWorkflowSlashCommand({ commandName: "speckit.constitution" }),
        "/speckit-constitution",
    );
    assert.equal(
        buildWorkflowSlashCommand({ commandName: "/speckit-plan", args: "extra" }),
        "/speckit-plan extra",
    );
    assert.equal(
        buildWorkflowSlashCommand({ commandName: "speckit.foo.bar" }),
        "/speckit-foo-bar",
    );
    // Non-speckit commands are rejected — the wizard only speaks
    // speckit-* slash commands.
    assert.throws(() => buildWorkflowSlashCommand({ commandName: "other.command" }));
    assert.throws(() => buildWorkflowSlashCommand({ commandName: "" }));
});

test("phaseIdForCommandName distinguishes canonical, extension, and junk", () => {
    // Positive canonical mapping is covered end-to-end by the S2 phase-id
    // contract integration test (which iterates every canonical command);
    // this test guards the two branches integration doesn't reach:
    // extension commands (multi-segment slug) return null, and junk input
    // returns null.
    assert.equal(phaseIdForCommandName("speckit.review"), null);
    assert.equal(phaseIdForCommandName("speckit.extension.custom-thing"), null);
    assert.equal(phaseIdForCommandName("speckit-extension-custom-thing"), null);
    assert.equal(phaseIdForCommandName(""), null);
    assert.equal(phaseIdForCommandName(null), null);
    assert.equal(phaseIdForCommandName("nothing-speckit-here"), null);
});
});
