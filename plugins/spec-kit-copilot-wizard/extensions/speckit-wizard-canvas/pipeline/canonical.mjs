// Wizard-owned canonical data for the Spec Kit "core" layer.
//
// Consolidates three concerns that were previously split across
// pipeline/canonical.mjs + core/capabilities.mjs + core/inventory.mjs:
//
//   1. CORE_CAPABILITIES  — hand-curated per-canonical baseline
//                           (templates / scripts / hooks / writesTo / notes)
//   2. CANONICAL phase list + helpers (canonicalSpine, isCanonical, …)
//   3. CORE_INVENTORY     — the flat "what ships with core" lists
//                           (commands / templates / scripts)
//
// All pure data + pure helpers, no I/O and no side effects. Ordered leaf-first:
// capabilities (no deps) → canonical (uses CORE_CAPABILITIES) → inventory
// (uses CANONICAL_PHASES + CANONICAL_UNSEEDED).

// -------- Section: capabilities (was core/capabilities.mjs) --------
// Hand-curated canonical capability baseline for Spec Kit's five required
// core phases. Every entry describes what a stock/core command body does:
// which templates it loads, which scripts it invokes, which inputs it reads,
// which primary artifact it writes, and which sub-artifacts it produces
// alongside the primary.
//
// Purpose
// -------
// Composition layers (see CORE_INVENTORY below and composition state) tell us
// which layer *wins the slot* for a given template/script/hook. That's the
// "resolved precedence" story. But the winning **command body** may not
// actually invoke every layer that resolves. Example: a preset's
// `speckit.specify.md` may win the specify slot but not reference
// `spec-template`, so a lower-priority `spec-template` layer
// resolves-but-is-never-invoked.
//
// This module is the ground truth we diff winning bodies against to detect
// those gaps. The `composition.refresh` prompt reads each canonical entry
// here and asks the LLM: "does the winning body reference X?" — retained
// entries render as green chips under the phase card, dropped entries as
// amber chips.
//
// Baseline source
// ---------------
// Extracted from a scratch `specify init --here --script ps --force
// --integration copilot --integration-options=--skills` in a temp dir with
// no presets installed. Read the ten `.github/skills/speckit-*/SKILL.md`
// bodies to derive the fields below.
//
// Baseline captured against **specify 0.15.0**. Users may have any CLI
// version installed — this file just records what a scratch `specify init`
// produced at that version so the LLM has a stable reference for
// canonical-body drift detection. If a newer CLI ships materially different
// canonical bodies, redo the scratch init and refresh the entries below.
// Field shapes are stable across CLI versions; entry contents are not.
//
// Field guide (per canonical id)
// ------------------------------
// * `templates`     — bare template names the canonical loads
//                     (matches CORE_TEMPLATES entries).
// * `scripts`       — bare script names the canonical invokes
//                     (matches CORE_SCRIPTS entries where applicable; may
//                     include others not in the inventory).
// * `hooks`         — hook event ids the canonical body explicitly dispatches
//                     (e.g. `before_specify`, `after_specify`). Every stock
//                     core body has "Pre-Execution Checks" (reads
//                     `hooks.before_<phase>` from `.specify/extensions.yml`
//                     and invokes each entry) AND "Mandatory Post-Execution
//                     Hooks" (reads `hooks.after_<phase>` and invokes each).
//                     Lean / minimal preset bodies strip these sections,
//                     which means registered hooks silently never fire —
//                     that's the diff signal.
// * `writesTo`      — the primary artifact the canonical writes. Retained
//                     for UI's "Writes to" row; not diffed (presets almost
//                     always preserve the primary output path).
// * `notes`         — optional short prose the LLM can use as context when
//                     matching. Not rendered directly.
//
// Scope
// -----
// Covers all TEN core canonicals — the five required (constitution, specify,
// plan, tasks, implement) plus the five optional/repair canonicals (clarify,
// analyze, checklist, taskstoissues, converge). Any of these can be overridden
// by a preset, so all ten need a baseline for the behavior-vs-canonical diff.
// Extension-added commands are intentionally out of scope — they have no
// canonical baseline to diff against.

export const CORE_CAPABILITIES = Object.freeze({
    "speckit.constitution": Object.freeze({
        templates: Object.freeze(["constitution-template"]),
        scripts: Object.freeze([]),
        hooks: Object.freeze(["before_constitution", "after_constitution"]),
        writesTo: ".specify/memory/constitution.md",
        notes: "Loads the existing constitution (initialized from constitution-template at project setup), fills placeholders, prepends a Sync Impact Report HTML comment, and overwrites the same file. Body has explicit `## Pre-Execution Checks` (before_constitution) and `## Post-Execution Checks` (after_constitution) sections that read `.specify/extensions.yml` and dispatch registered hooks.",
    }),

    "speckit.specify": Object.freeze({
        templates: Object.freeze(["spec-template", "checklist-template"]),
        scripts: Object.freeze([]),
        hooks: Object.freeze(["before_specify", "after_specify"]),
        writesTo: "specs/<slug>/spec.md",
        notes: "Resolves spec-template via the preset stack (equivalent to `specify preset resolve spec-template`), copies it to specs/<slug>/spec.md, and separately generates a Spec Quality checklist under checklists/requirements.md using checklist-template. Slug generation and feature-directory creation are handled inline by the SKILL body (using `.specify/init-options.json` for numbering). Body has explicit `## Pre-Execution Checks` (before_specify) and `## Mandatory Post-Execution Hooks` (after_specify) sections. Branch creation is optional and delegated to the `before_specify` hook when a git extension is registered.",
    }),

    "speckit.plan": Object.freeze({
        templates: Object.freeze(["plan-template"]),
        scripts: Object.freeze(["setup-plan"]),
        hooks: Object.freeze(["before_plan", "after_plan"]),
        writesTo: "specs/<slug>/plan.md",
        notes: "Runs `.specify/scripts/{bash,powershell}/setup-plan.{sh,ps1} -Json` to bootstrap FEATURE_SPEC/IMPL_PLAN/SPECS_DIR. Loads plan-template as IMPL_PLAN. Executes Phase 0 (research.md) and Phase 1 (data-model.md, contracts/*, quickstart.md) design artifacts. Body has `## Pre-Execution Checks` (before_plan) and `## Mandatory Post-Execution Hooks` (after_plan).",
    }),

    "speckit.tasks": Object.freeze({
        templates: Object.freeze(["tasks-template"]),
        scripts: Object.freeze(["setup-tasks"]),
        hooks: Object.freeze(["before_tasks", "after_tasks"]),
        writesTo: "specs/<slug>/tasks.md",
        notes: "Runs `.specify/scripts/{bash,powershell}/setup-tasks.{sh,ps1} -Json` to bootstrap FEATURE_DIR/TASKS_TEMPLATE/AVAILABLE_DOCS. Loads tasks-template (or falls back to .specify/templates/tasks-template.md). Body has `## Pre-Execution Checks` (before_tasks) and `## Mandatory Post-Execution Hooks` (after_tasks).",
    }),

    "speckit.implement": Object.freeze({
        templates: Object.freeze([]),
        scripts: Object.freeze(["check-prerequisites"]),
        hooks: Object.freeze(["before_implement", "after_implement"]),
        writesTo: "specs/<slug>/tasks.md",
        notes: "Runs `.specify/scripts/{bash,powershell}/check-prerequisites.{sh,ps1} -Json -RequireTasks -IncludeTasks`. Validates checklists status, then executes tasks in tasks.md phase by phase. Body has `## Pre-Execution Checks` (before_implement) and `## Mandatory Post-Execution Hooks` (after_implement).",
    }),

    "speckit.clarify": Object.freeze({
        templates: Object.freeze([]),
        scripts: Object.freeze(["check-prerequisites"]),
        hooks: Object.freeze(["before_clarify", "after_clarify"]),
        writesTo: "specs/<slug>/spec.md",
        notes: "Runs `.specify/scripts/{bash,powershell}/check-prerequisites.{sh,ps1} -Json -PathsOnly` to locate the feature spec. Asks up to 5 targeted clarification questions and encodes answers back into `## Clarifications` in spec.md. Body has `## Pre-Execution Checks` (before_clarify) and `## Mandatory Post-Execution Hooks` (after_clarify).",
    }),

    "speckit.analyze": Object.freeze({
        templates: Object.freeze([]),
        scripts: Object.freeze(["check-prerequisites"]),
        hooks: Object.freeze(["before_analyze", "after_analyze"]),
        writesTo: null,
        notes: "Runs `.specify/scripts/{bash,powershell}/check-prerequisites.{sh,ps1} -Json -RequireTasks -IncludeTasks`. Non-destructive cross-artifact consistency analysis; reports findings without editing files. Body has `## Pre-Execution Checks` (before_analyze) and post-execution hook dispatch (after_analyze).",
    }),

    "speckit.checklist": Object.freeze({
        templates: Object.freeze(["checklist-template"]),
        scripts: Object.freeze(["check-prerequisites"]),
        hooks: Object.freeze(["before_checklist", "after_checklist"]),
        writesTo: "specs/<slug>/checklists/<name>.md",
        notes: "Runs `.specify/scripts/{bash,powershell}/check-prerequisites.{sh,ps1} -Json`. Generates a custom checklist under specs/<slug>/checklists/ using `.specify/templates/checklist-template.md` as the structural reference. Body has `## Pre-Execution Checks` (before_checklist) and `## Post-Execution Checks` (after_checklist).",
    }),

    "speckit.taskstoissues": Object.freeze({
        templates: Object.freeze([]),
        scripts: Object.freeze(["check-prerequisites"]),
        hooks: Object.freeze(["before_taskstoissues", "after_taskstoissues"]),
        writesTo: null,
        notes: "Runs `.specify/scripts/{bash,powershell}/check-prerequisites.{sh,ps1} -Json -RequireTasks -IncludeTasks`. Creates GitHub issues from tasks.md entries via `gh issue create`; no local file writes. Body has `## Pre-Execution Checks` (before_taskstoissues) and `## Post-Execution Checks` (after_taskstoissues).",
    }),

    "speckit.converge": Object.freeze({
        templates: Object.freeze([]),
        scripts: Object.freeze(["check-prerequisites"]),
        hooks: Object.freeze(["before_converge", "after_converge"]),
        writesTo: "specs/<slug>/tasks.md",
        notes: "Runs `.specify/scripts/{bash,powershell}/check-prerequisites.{sh,ps1} -Json -RequireTasks -IncludeTasks`. Repair-loop utility: assesses codebase against spec/plan/tasks and appends remediation tasks to tasks.md. Body has `## Pre-Execution Checks` (before_converge) and `## Post-Execution Checks` (after_converge).",
    }),
});

// Shared / library scripts — not invoked directly by any canonical command
// body but sourced/imported by the other scripts. Renders in the UI as
// "shared library" so users understand it exists but isn't per-phase.
const SHARED_CORE_SCRIPTS = Object.freeze([
    "common",
]);

// Templates that aren't referenced by any `CORE_CAPABILITIES.templates` list
// but still ship in the core inventory. Hardcoded here so the "used by"
// sub-line on template rows can attribute them to their consuming command.
// `agent-file-template` is loaded by the unseeded `speckit.agent-context.update`
// command (not one of the ten canonicals in CORE_CAPABILITIES).
const EXTRA_TEMPLATE_TO_COMMANDS = Object.freeze({
    "agent-file-template": Object.freeze(["speckit.agent-context.update"]),
});

// Reverse index: bare script id → sorted list of canonical command ids
// whose canonical body invokes that script. Built once at module load
// from `CORE_CAPABILITIES`. Scripts in `SHARED_CORE_SCRIPTS` (like
// `common`) return an empty list — they're used by other scripts, not
// directly by any command body. Used by:
//   • the phase page's Scripts row, to show ONLY the scripts that apply
//     to the current phase inline next to "Core:",
//   • the Composition page's Scripts tab, to show a "Used by" sub-line
//     on each core script row.
const _reverseByScript = (() => {
    const map = new Map();
    for (const script of SHARED_CORE_SCRIPTS) map.set(script, []);
    for (const [cmdId, entry] of Object.entries(CORE_CAPABILITIES)) {
        for (const script of entry.scripts ?? []) {
            const list = map.get(script) ?? [];
            if (!list.includes(cmdId)) list.push(cmdId);
            map.set(script, list);
        }
    }
    // Sort each list for stable rendering.
    for (const [k, v] of map.entries()) map.set(k, Object.freeze([...v].sort()));
    return map;
})();

/**
 * Return the canonical command ids whose stock body invokes the given
 * bare script id. Returns `[]` for shared-library scripts (like `common`)
 * and for anything not covered by CORE_CAPABILITIES.
 */
export function commandsForCoreScript(bareScriptId) {
    return _reverseByScript.get(bareScriptId) ?? [];
}

/**
 * True when the bare script id is a shared-library script (sourced by
 * other scripts, not directly invoked by any command).
 */
export function isSharedCoreScript(bareScriptId) {
    return SHARED_CORE_SCRIPTS.includes(bareScriptId);
}

/**
 * Return the bare script ids the canonical body of the given command
 * invokes. Returns `[]` when the command has no scripts or isn't in
 * CORE_CAPABILITIES.
 */
export function coreScriptsForCommand(commandId) {
    return CORE_CAPABILITIES[commandId]?.scripts ?? [];
}

/**
 * Return the canonical command ids whose stock body loads the given
 * bare template id (e.g. `spec-template` → `["speckit.specify"]`).
 * Returns `[]` for anything not covered by CORE_CAPABILITIES or the
 * EXTRA_TEMPLATE_TO_COMMANDS override map.
 */
export function commandsForCoreTemplate(bareTemplateId) {
    const out = [];
    for (const [cmdId, entry] of Object.entries(CORE_CAPABILITIES)) {
        if ((entry.templates ?? []).includes(bareTemplateId)) out.push(cmdId);
    }
    for (const cmdId of EXTRA_TEMPLATE_TO_COMMANDS[bareTemplateId] ?? []) {
        if (!out.includes(cmdId)) out.push(cmdId);
    }
    return out.sort();
}

// -------- Section: canonical phase list (was pipeline/canonical.mjs) --------
// Wizard-owned canonical phase list.
//
// Spec Kit does not expose a schema field for pipeline ordering or removal, so
// the wizard owns the authoritative order. This list mirrors the core commands
// shipped in `github/spec-kit` (`templates/commands/*.md`) as of the Spec Kit
// version this extension is pinned against. Bump the list when the supported
// speckit_version bumps.
//
// Deliberately NOT derived from the active preset. Every canonical phase is
// available in the wizard regardless of whether the preset customizes it —
// unhandled canonicals fall through to core at runtime (Spec Kit's resolver
// only supports replace / wrap / prepend / append, never hide).

/**
 * Single source of truth for every canonical Spec Kit phase.
 *
 * Each entry carries the display label, short description, and two flags:
 *   • required — must appear in a valid augmented-canonical pipeline
 *   • seeded   — part of the default seeded pipeline; when false the phase
 *                still exists in core but users add it on demand (currently
 *                only `converge`, a repair-loop utility).
 *
 * Object insertion order IS the seeded-pipeline order — do not reorder
 * without checking downstream consumers that iterate `CANONICAL_PHASES`.
 */
const CANONICAL = Object.freeze({
    constitution:  { label: "Constitution",   description: "Establish project principles and governance rules",   required: true,  seeded: true },
    specify:       { label: "Specify",        description: "Define feature requirements and user scenarios",       required: true,  seeded: true },
    clarify:       { label: "Clarify",        description: "Resolve ambiguities before planning begins",           required: false, seeded: true },
    plan:          { label: "Plan",           description: "Generate implementation plan and design artifacts",    required: true,  seeded: true },
    tasks:         { label: "Tasks",          description: "Break plan into actionable task list",                 required: true,  seeded: true },
    taskstoissues: { label: "Tasks → Issues", description: "Convert generated task list into GitHub issues",       required: false, seeded: true },
    analyze:       { label: "Analyze",        description: "Cross-check spec, plan, and tasks consistency",        required: false, seeded: true },
    checklist:     { label: "Checklist",      description: "Generate domain-specific quality validation checklist", required: false, seeded: true },
    implement:     { label: "Implement",      description: "Execute tasks to build the feature",                   required: true,  seeded: true },
    converge:      { label: "Converge",       description: "Assess codebase, append gaps as tasks",                required: false, seeded: false },
});

const CANONICAL_KEYS = Object.freeze(Object.keys(CANONICAL));

// Wizard-owned canonical phase list.
//
// Spec Kit does not expose a schema field for pipeline ordering or removal, so
// the wizard owns the authoritative order. This list mirrors the core commands
// shipped in `github/spec-kit` (`templates/commands/*.md`) as of the Spec Kit
// version this extension is pinned against. Bump the CANONICAL record when
// the supported speckit_version bumps.
//
// Deliberately NOT derived from the active preset. Every canonical phase is
// available in the wizard regardless of whether the preset customizes it —
// unhandled canonicals fall through to core at runtime (Spec Kit's resolver
// only supports replace / wrap / prepend / append, never hide).
export const CANONICAL_PHASES = Object.freeze(CANONICAL_KEYS.filter((k) => CANONICAL[k].seeded));

/**
 * Canonical commands that exist in core but are NOT part of the default
 * seeded pipeline. They surface in the CORE group of the Commands panel and
 * users add them on demand. `converge` is a repair-loop utility — reactive,
 * not a linear step.
 */
export const CANONICAL_UNSEEDED = Object.freeze(CANONICAL_KEYS.filter((k) => !CANONICAL[k].seeded));

const CANONICAL_SET = new Set(CANONICAL_KEYS);

/**
 * Canonical phases that a valid `augmented-canonical` pipeline MUST contain.
 * These are the "required" spec-kit spine anchors — the LLM (and the
 * fast-path synthesizer) may insert optional phases between them, but may
 * not drop any of them.
 *
 * Single source of truth. Consumed by:
 *   • `state/store.mjs validateInferredPipeline` — rejects a pipeline
 *     missing any of these.
 *   • `composition-assembler.mjs computePipelineFastPath` — falls back to
 *     LLM inference when any of these are absent from the active command set,
 *     since the fast path can't synthesize a valid pipeline without them.
 */
export const REQUIRED_CANONICAL_PHASES = Object.freeze(CANONICAL_KEYS.filter((k) => CANONICAL[k].required));

/**
 * Canonical phases the wizard treats as optional. Commands ship in core and
 * — when seeded — are included in the default flow, but downstream commands
 * still work if you skip them. Includes unseeded canonicals too (they're
 * optional by definition).
 */
const CANONICAL_OPTIONAL = new Set(CANONICAL_KEYS.filter((k) => !CANONICAL[k].required));

/** Returns the canonical spine as a fresh array (safe to mutate). */
export function canonicalSpine() {
    return CANONICAL_PHASES.slice();
}

/**
 * Return the canonical spine as fully-qualified command artifact ids —
 * `commands/speckit.<name>` — in seeded-pipeline order. Fresh array on each
 * call. Used by the fast-path pipeline synthesizer and any other consumer
 * that needs the artifact-id form (LLM inference prompt, validators, etc.).
 */
export function canonicalPipelineIds() {
    return CANONICAL_PHASES.map((name) => `commands/speckit.${name}`);
}

/**
 * Return the REQUIRED canonical anchors as fully-qualified command
 * artifact ids. Fresh array on each call. Used by
 * `validateInferredPipeline` and `computePipelineFastPath`.
 */
export function requiredCanonicalPipelineIds() {
    return REQUIRED_CANONICAL_PHASES.map((name) => `commands/speckit.${name}`);
}

/** True when `id` is a canonical Spec Kit phase. */
export function isCanonical(id) {
    return typeof id === "string" && CANONICAL_SET.has(id);
}

/** Human-friendly title for a canonical id. Falls back to the id itself. */
export function canonicalLabel(id) {
    if (!isCanonical(id)) return typeof id === "string" ? id : "";
    return CANONICAL[id].label;
}

/**
 * Short action-oriented description for a canonical id, or "" if the id
 * isn't canonical or has no hardcoded description.
 */
export function canonicalDescription(id) {
    if (!isCanonical(id)) return "";
    return CANONICAL[id].description ?? "";
}

/** True when the canonical phase is optional in the default pipeline. */
export function isCanonicalOptional(id) {
    return CANONICAL_OPTIONAL.has(id);
}

/**
 * Bare template artifact ids consumed by a canonical phase, or `[]` when
 * the phase has no phase-specific template(s).
 *
 * Single source of truth: `CORE_CAPABILITIES` (above). That data is the
 * hand-curated ground truth used by the behavior-vs-canonical diff pass;
 * this function projects the same list into the phase-card "What runs in
 * this phase" renderer so both views agree.
 *
 * CORE_CAPABILITIES is keyed by fully-qualified command ids
 * (`speckit.specify`, `speckit.plan`) so it can share keys with capability
 * reports emitted by composition refresh. The wizard UI + pipeline speak
 * bare-phase ids (`specify`, `plan`), so we prefix with `speckit.` inline.
 *
 * Fallback: for non-canonical / extension-provided phase ids not covered by
 * CORE_CAPABILITIES, guess `["<phase>-template"]` — the wizard's default
 * naming convention.
 */
export function canonicalTemplateIds(phase) {
    if (typeof phase !== "string" || phase.length === 0) return [];
    const entry = CORE_CAPABILITIES[`speckit.${phase}`];
    if (entry) return entry.templates ? [...entry.templates] : [];
    return [`${phase}-template`];
}

// -------- Section: core inventory (was core/inventory.mjs) --------
// Wizard-owned canonical inventory of the Spec Kit "core" layer.
//
// This is the single source of truth for what "core" ships with — the same
// list is:
//   • embedded in the `composition.refresh` prompt (prompts.mjs) so the LLM
//     knows which artifacts to run `specify preset resolve` on, and
//   • rendered by the UI (ui/phase-contributors.js) as a static Core-only
//     view when no preset is installed and `composition.artifacts` hasn't
//     been populated by a refresh cycle yet.
//
// Command IDs are derived from CANONICAL_PHASES + CANONICAL_UNSEEDED (above)
// so the phase list and the composition list can never drift out of sync.
// Templates and scripts remain hand-maintained here — they have no
// canonical counterpart today.
//
// Naming conventions match `specify preset resolve <lookup-name>`:
//   • commands — dot-notation without extension (e.g. `speckit.specify`)
//   • templates — bare name without extension (e.g. `spec-template`)
//   • scripts  — bare name without extension (e.g. `check-prerequisites`)

export const CORE_COMMANDS = Object.freeze(
    [...CANONICAL_PHASES, ...CANONICAL_UNSEEDED].map((name) => `speckit.${name}`),
);

export const CORE_TEMPLATES = Object.freeze([
    "spec-template",
    "plan-template",
    "tasks-template",
    "checklist-template",
    "constitution-template",
    "agent-file-template",
]);

export const CORE_SCRIPTS = Object.freeze([
    "check-prerequisites",
    "common",
    "setup-plan",
    "setup-tasks",
]);

export const CORE_INVENTORY = Object.freeze({
    command: CORE_COMMANDS,
    template: CORE_TEMPLATES,
    script: CORE_SCRIPTS,
});

// -------- Section: clarification-marker parser (was pipeline/clarifications.mjs) --------
// Pure parser for the `[NEEDS CLARIFICATION: <question>]` markers that
// SpecKit skills embed in the artifacts they produce (spec.md, plan.md,
// tasks.md, …). Used by the wizard's artifact viewer to inject a
// per-marker Clarify pill.
//
// Matching rules:
//   - Case-insensitive on the "NEEDS CLARIFICATION" prefix.
//   - Question text is any characters up to the first matching ']'; the
//     regex is non-greedy so the first ']' terminates the question — same
//     shape the skill emits today.
//   - Multi-line questions ARE supported. The skill's template convention
//     keeps them on a single line in practice.
//
// Returns an array of { question, startIdx, endIdx } in source order.
export function parseClarifications(markdown) {
    const src = String(markdown ?? "");
    const re = /\[NEEDS CLARIFICATION:\s*([\s\S]*?)\]/gi;
    const out = [];
    let m;
    while ((m = re.exec(src)) !== null) {
        out.push({
            question: m[1].trim(),
            startIdx: m.index,
            endIdx: m.index + m[0].length,
        });
    }
    return out;
}
