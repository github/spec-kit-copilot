// Wizard phase catalog — pure data + pure helpers.
//
// This is the single source of truth for the wizard's UI screens ("phases":
// Setup, Preset, Constitution, Specify, Clarify, Plan, Tasks, Analyze,
// Implement, Checklist). For each phase it declares:
//
//   • display copy (name, tagline) shown in the phase strip and card
//   • which artifact (if any) the phase produces
//   • which underlying skill/action kind runs it (SKILL_BY_KIND) — this is
//     how a phase like "specify" dispatches to the `speckit.specify` skill
//   • flow flags: `optional` (skippable), `special: "setup"` (multi-row
//     setup panel), `conversation: true` (LLM asks questions, user answers
//     via /api/phase/answer)
//
// Consumers:
//   • ui/phase/*.js — reads PHASES to render the strip and the card
//   • canvas-runtime/actions/phase.mjs — uses SKILL_BY_KIND to route
//     the phase to the correct skill invocation
//   • state/normalize.mjs — DEFAULT_STATE + emptyPhaseSlice seed state.json
//
// The graph phase card renders a single free-form `args` textarea for every
// phase — there is no per-phase field schema (no `form.fields`). Phase input
// placeholders/hints live in `ui/render/graph-phase-card.js` (see
// `PHASE_INPUT_PLACEHOLDERS`), not here. Conversation-driven phases
// (clarify/analyze) route through a Q&A flow instead of the args textarea.
//
// Pure module: zero I/O, zero SDK, zero subprocess — safely importable in
// tests.

import { CANONICAL_PHASES, canonicalLabel, isCanonicalOptional } from "../pipeline/canonical.mjs";

// Helper: for canonical phases, derive `name` and `optional` from the
// canonical.mjs record so display copy and skip-eligibility stay in a
// single source of truth. Non-canonical wizard-only phases (setup, preset,
// extension, composition) still declare their own name/optional inline.
function canonical(id, extras) {
    return { id, name: canonicalLabel(id), optional: isCanonicalOptional(id), ...extras };
}

// Ordered phase list. `optional: true` allows skip. `special: "setup"` means
// the phase is a multi-row sub-step surface (not a form/conversation card).
// `conversation: true` means the agent asks questions and the user answers
// through /api/phase/answer.
export const PHASES = [
    {
        id: "setup",
        name: "Setup",
        tagline: "Complete these steps in order to get your environment ready before we start.",
        optional: false,
        special: "setup",
        artifact: null,
    },
    {
        id: "preset",
        name: "Preset",
        tagline: "Pick a preset. The built-in core catalog is shown; browse all presets to add more.",
        optional: false,
        artifact: null, // no direct artifact — records selection in state.json
    },
    canonical("constitution", {
        tagline:
            "Create your project's governing principles and development guidelines that will guide all subsequent development.",
        artifact: ".specify/memory/constitution.md",
    }),
    canonical("specify", {
        tagline: "Describe what you want to build. Focus on the what and why, not the tech stack.",
        artifact: "specs/<slug>/spec.md",
    }),
    canonical("clarify", {
        tagline: "Answer a few questions to sharpen the spec.",
        conversation: true,
        artifact: "specs/<slug>/spec.md",
    }),
    canonical("checklist", {
        tagline: "Generate a focused quality checklist.",
        artifact: "specs/<slug>/checklists/",
    }),
    canonical("plan", {
        tagline: "Provide your tech stack and architecture choices.",
        artifact: "specs/<slug>/plan.md",
    }),
    canonical("tasks", {
        tagline: "Break the plan into tasks.",
        artifact: "specs/<slug>/tasks.md",
    }),
    canonical("analyze", {
        tagline: "Cross-check the spec, plan, and tasks for consistency.",
        conversation: true,
        artifact: "specs/<slug>/analysis.md",
    }),
    canonical("taskstoissues", {
        tagline: "File the task list as GitHub issues.",
        artifact: null, // writes GH issues, no on-disk artifact
        gated: true, // requires a preset that contributes speckit-taskstoissues
    }),
    canonical("implement", {
        tagline: "Execute all tasks and build according to the plan.",
        artifact: null,
    }),
];

export const PHASE_ORDER = PHASES.map((p) => p.id);
export const PHASE_BY_ID = Object.fromEntries(PHASES.map((p) => [p.id, p]));

// The single source of truth for phase → skill id dispatch.
// The prompt builder MUST use this map; there is no fallback and no
// natural-language matching. Setup rows dispatch via three
// specific skills; preset uses speckit-preset for install + add-source.
export const SKILL_BY_KIND = Object.freeze({
    // Setup sub-steps
    // Plugin + CLI install are handled MANUALLY by the user (external to the
    // wizard) — the setup page displays live-probe status and links to the
    // manual install docs. Only `setup.init` and `setup.reloadSkills` are
    // dispatched.
    //
    // `setup.init` invokes the `speckit-init` skill. The skill's SKILL.md
    // encodes the `specify init` invocation and the wizard prompt conveys the
    // workspace-specific customization (init in place, merge existing files,
    // script flavor).
    "setup.init": "speckit-init",
    "setup.reloadSkills": null, // dispatched as an instruction to /skills reload, not a skill
    // Lightweight skill-registry probe. Same natural-language body as
    // setup.reloadSkills' fast path (RELOAD_VALIDATION_BLOCK). Dispatched
    // by the wizard when a skill-registry sync failure is suspected — for
    // example, the Composition tab may surface a `Verify skills` action
    // when catalog reads disagree with `state.setup.skillsReloaded`.
    "skills.verify": null,

    // Preset
    "preset.install": "speckit-preset",
    "preset.remove": "speckit-preset",

    // Extension
    "extension.install": "speckit-extension",
    "extension.remove": "speckit-extension",

    // Bundle
    "bundle.install": "speckit-bundle",
    "bundle.remove": "speckit-bundle",

    // Wizard phases (scaffolded, post-init). Sourced from canonical.mjs so
    // adding/removing a canonical phase there flows through automatically —
    // the naming rule is deterministic: canonical id `X` → skill
    // `speckit-X`.
    ...Object.fromEntries(CANONICAL_PHASES.map((id) => [id, `speckit-${id}`])),

    // LLM pipeline inference. Composition extraction is now handled
    // by the deterministic fast assembler (composition-assembler.mjs) which
    // runs on install/boot — no LLM turn, no ACTION_KINDS entry. The two
    // remaining kinds both route to the same non-fast inference prompt; the
    // wizard emits `composition.refresh` from the "Refresh Now" button as a
    // stable name for backwards-compat with older sessions.
    "composition.refresh": null,
    "composition.inferPipeline": null,
    "composition.viewPreset": "speckit-preset",
    "composition.updatePreset": "speckit-preset",
    "composition.removePreset": "speckit-preset",
    "composition.viewExtension": "speckit-extension",
    "composition.updateExtension": "speckit-extension",
    "composition.removeExtension": "speckit-extension",
    // Extension artifact-target inference (LLM-driven, not filename-guessing).
    // Payload shape: `{ commands: [{ commandId, skillPath }], origin, token }`.
    // The agent reads each `skillPath`, extracts the `.specify/…/<file>.md`
    // path template from the skill's opening paragraph, and POSTs the
    // results back to `${origin}/api/artifact-targets?token=${token}`. The
    // wizard scanner then reads `.speckit-wizard/artifact-targets.json`
    // on the next tick and lights up the "Writes to" link on each
    // extension phase card. Skill choice is `speckit-extension` because
    // extension metadata is that skill's domain.
    "extension.inferArtifactTargets": "speckit-extension",
});

export const ACTION_KINDS = Object.freeze(new Set(Object.keys(SKILL_BY_KIND)));

// Helpers ------------------------------------------------------------------

export function getPhase(id) {
    return PHASE_BY_ID[id] ?? null;
}

export function isOptional(phaseId) {
    return !!PHASE_BY_ID[phaseId]?.optional;
}

export function skillForKind(kind) {
    if (!ACTION_KINDS.has(kind)) return undefined;
    return SKILL_BY_KIND[kind];
}

// Emitted from state.json for phases the canvas hasn't seen before.
export function emptyPhaseSlice(phaseId) {
    const phase = PHASE_BY_ID[phaseId];
    return {
        status: "empty",
        optionalSkipped: false,
        lastRunAt: null,
        formValues: {},
        artifactPath: phase?.artifact ?? null,
    };
}

export const DEFAULT_STATE = Object.freeze({
    $schema: "speckit-wizard/v1",
    currentPhase: "setup",
    preset: null,
    setup: {
        pluginInstalled: false,
        cliInstalled: false,
        projectInitialized: false,
        skillsReloaded: false,
        catalogsLoaded: false,
    },
    phases: Object.freeze(
        Object.fromEntries(PHASE_ORDER.map((id) => [id, emptyPhaseSlice(id)])),
    ),
});
