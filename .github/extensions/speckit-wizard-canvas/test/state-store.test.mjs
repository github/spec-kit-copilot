// Tests for state/store.mjs — defensive normalization + read/write.
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeState, readState, writeState, applyPatch, coerceStringArray, validateInferredPipeline, overlayCachedComposition, normalizeExecutionReports, computeItemStatuses, mergeExecutionReportEntry } from "../state/store.mjs";
import { PHASE_ORDER } from "../canvas-runtime/wizard-phases.mjs";

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

