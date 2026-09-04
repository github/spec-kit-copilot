// speckit-wizard — prompt builder entry point
//
// (kind, payload, context) → string. Deterministic; unit-testable with zero
// I/O. `renderBody` is a 4-way dispatcher across kind families; the actual
// per-kind strings live in the sibling `prompts/` builder modules:
//
//   prompts/shared.mjs       — shared building blocks (fmtHeader,
//                              fmtPayload, PREFLIGHT / STATE / RELOAD
//                              text constants).
//   prompts/setup.mjs        — setup.*, skills.verify.
//   prompts/catalog.mjs      — preset.*, extension.install|remove|
//                              refresh, bundle.*.
//   prompts/pipeline.mjs     — constitution|specify|plan|checklist|
//                              tasks|implement, clarify(.answer),
//                              analyze(.answer), taskstoissues.
//   prompts/composition.mjs  — composition.*, extension
//                              .inferArtifactTargets.
//
// This file still owns: the public exports (`buildPrompt`,
// `UnknownActionKindError`, `buildWorkflowSlashCommand`, `phaseIdForCommandName`,
// `buildWorkflowTrackingPreamble`, `computeExpectedSkillNames`, `_internal`),
// the family-Sets-based dispatcher, and cross-family helpers used by the
// builder modules (via re-import through `../prompts.mjs` — a documented cycle
// that ES modules resolve lazily).
//
// Every prompt:
//   1. Leads with an explicit `/<skill-id>` slash command so the Copilot CLI
//      auto-loads the skill's SKILL.md into context (no agent-side lookup).
//   2. Re-states FILE_CONTRACT_PREAMBLE verbatim.
//   3. Includes the resolved workspace path.
//   4. Includes the form payload verbatim (JSON-encoded).
//   5. States the scope-of-work boundary ("do exactly one step, do not commit").
//
// FORBIDDEN in the emitted prompt body:
//   • "specify" shell commands
//   • bare `/speckit.<phase>` dot-notation slash commands (the spec-kit
//     phase shortcuts — use the hyphenated `/speckit-<name>` skill dispatch
//     form instead, which maps 1:1 to catalog.mjs SKILL_BY_KIND).
//   • natural-language "please generate the constitution" that relies on
//     Copilot fuzzy-matching to pick the right skill

import { ACTION_KINDS, skillForKind } from "./canvas-runtime/wizard-phases.mjs";
import { EXECUTION_STATES } from "./state/store.mjs";
import { CORE_COMMANDS } from "./pipeline/canonical.mjs";
import { fmtPayload } from "./prompts/shared.mjs";
import { SETUP_KINDS, buildSetupPrompt } from "./prompts/setup.mjs";
import { CATALOG_KINDS, buildCatalogPrompt } from "./prompts/catalog.mjs";
import { PIPELINE_KINDS, buildPipelinePrompt } from "./prompts/pipeline.mjs";
import { COMPOSITION_KINDS, buildCompositionPrompt } from "./prompts/composition.mjs";

export class UnknownActionKindError extends Error {
    constructor(kind) {
        super(`Unknown action kind: ${JSON.stringify(kind)}`);
        this.code = "UNKNOWN_KIND";
        this.kind = kind;
    }
}

/**
 * Build the literal Copilot Chat slash command for a workflow phase.
 *
 * Skills are registered under their hyphen form (`speckit-plan`), so the
 * wizard always emits `/speckit-<command> <args>`. Callers may pass either
 * the dot form (`speckit.plan`, matching preset command filenames) or the
 * hyphen form — both normalize to the same output.
 *
 * @param {object} opts
 * @param {string} opts.commandName  Command name, e.g. "speckit.plan" or "speckit-plan".
 * @param {string} [opts.args]       Verbatim textarea contents.
 * @param {boolean} [opts.allowEmpty] If true and args is empty, emit the bare command.
 * @returns {string}
 */
export function buildWorkflowSlashCommand({ commandName, args = "", allowEmpty = true }) {
    let name = typeof commandName === "string" && commandName.startsWith("/")
        ? commandName.slice(1)
        : (commandName ?? "");
    // Allow multi-segment command names like `speckit.assess.intake` or
    // `speckit-assess-intake`. Extensions may register commands under a
    // domain namespace (assess.intake, assess.research, …) so a single
    // segment is not sufficient. Segments are `.` or `-` separated and
    // must be [a-z0-9_-] with at least one segment after `speckit`.
    if (!name || !/^speckit[.-][a-z0-9_-]+(?:[.-][a-z0-9_-]+)*$/i.test(name)) {
        throw new Error(`invalid workflow command name: ${JSON.stringify(commandName)}`);
    }
    // Normalize the dot form (preset filename / artifact-id convention) to
    // the hyphen form Copilot skills are registered under. Replace every
    // `.` — not just the first — so `speckit.assess.intake` becomes
    // `speckit-assess-intake` (matches the installed skill directory).
    name = name.replace(/\./g, "-");
    const trimmed = String(args ?? "").trim();
    if (!trimmed) {
        if (!allowEmpty) return `/${name} `;
        return `/${name}`;
    }
    // Pass args verbatim — no structuring, no JSON encoding.
    return `/${name} ${args}`;
}

// Map a workflow command name to its wizard-side phase id, or null if the
// command is not one of the tracked canonical phases. Accepts both dot and
// hyphen forms (e.g. `speckit.constitution`, `speckit-constitution`).
// Extension-provided commands (`speckit.<ext>.<cmd>`) return null — the
// wizard only tracks execution for canonical phases whose ids match its
// stepper.
export function phaseIdForCommandName(commandName) {
    if (typeof commandName !== "string") return null;
    // Strip leading slash if present, then normalize dot → hyphen so we can
    // pattern-match against the canonical `speckit-<phase>` form.
    const name = (commandName.startsWith("/") ? commandName.slice(1) : commandName).replace(/\./g, "-");
    // Only single-segment canonical commands like `speckit-constitution` map
    // to a wizard phase; multi-segment names (`speckit-assess-intake`) are
    // extension commands and are intentionally excluded.
    const m = /^speckit-([a-z0-9_-]+)$/.exec(name);
    if (!m) return null;
    // Reject compound segments containing further dashes that would indicate
    // an extension namespace rather than a canonical phase id.
    const bare = m[1];
    if (bare.includes("-")) return null;
    return bare;
}

/**
 * Wizard-tracking preamble prepended when the launcher sends a canonical
 * `/speckit-<phase>` run into chat. Tells the agent to run the skill normally,
 * then call `setPhaseStatus` with a terminal status before returning. The local
 * Run button state is only a short acknowledgement animation: chat owns live
 * progress, `setPhaseStatus` persists terminal phase state, and the scanner
 * confirms files before artifact buttons become available. Kept as a short,
 * plain-English preamble so it doesn't override the skill's own scope guard or
 * user-facing behavior.
 *
 * The preamble is NOT sent for handoff-style workflow dispatches (those go
 * through a separate lane); only the wizard's Run phase / Rerun phase paths
 * wrap the slash-command with it.
 *
 * @param {object} opts
 * @param {string} opts.commandName  e.g. "speckit.constitution" — used to
 *   derive the wizard phase id.
 * @param {string} [opts.artifactPath]  Optional expected artifact path
 *   (from the wizard phase spec) to pass to setPhaseStatus.
 * @param {string} [opts.runId]  Optional run id to pass back so stale
 *   callbacks cannot clear a newer run.
 * @returns {string|null}  Preamble text with a trailing blank line, or
 *   `null` when the command isn't a tracked canonical phase (caller should
 *   dispatch without wrapping).
 */
export function buildWorkflowTrackingPreamble({ commandName, artifactPath = null, expectedArtifacts = null, runId = null } = {}) {
    const phaseId = phaseIdForCommandName(commandName);
    if (!phaseId) return null;
    const artifactPathArg = artifactPath
        ? `, artifactPath: ${JSON.stringify(artifactPath)}`
        : "";
    const runIdArg = runId ? `, runId: ${JSON.stringify(runId)}` : "";
    const lines = [
        `<!-- speckit-wizard tracking preamble — do NOT include in reply -->`,
        `Invoke the \`skill\` tool with name \`speckit-${phaseId}\` before running any other tool call. The bare \`/speckit-${phaseId}\` on the first line is a hint for humans reading the transcript, not an auto-intercepted slash command.`,
        `You were dispatched by the Spec Kit Wizard's Run phase button. Before you return, call \`setPhaseStatus\` exactly once with a terminal status for this phase:`,
        `- Success: call \`setPhaseStatus({ phase: "${phaseId}", status: "done"${artifactPathArg}${runIdArg} })\` after the skill's normal work is complete.`,
        `- Optional phase intentionally bypassed: call \`setPhaseStatus({ phase: "${phaseId}", status: "skipped"${runIdArg} })\`.`,
        `- Declined checklist gate, checklist rejection, cancellation, validation failure, skill/tool failure, or any other blocker: call \`setPhaseStatus({ phase: "${phaseId}", status: "error"${runIdArg} })\`.`,
        `Do not leave the phase in progress, and do not omit this terminal callback: it updates the wizard's saved phase status and lets stale callbacks be rejected. Chat remains the progress surface, and scanner-confirmed files control artifact buttons.`,
    ];
    // Attach the closed-list witness ask so the agent self-reports which of
    // the phase's expected templates / scripts / hooks it actually invoked.
    // The list is authoritative — the agent MUST respond with a state
    // (`"executed"` or `"omitted"`) for EACH listed ID, and MUST NOT invent
    // new ones. Retrospective ask, structured shape → reliable answer.
    const templates = expectedArtifacts?.templates ?? [];
    const scripts   = expectedArtifacts?.scripts   ?? [];
    const hooks     = expectedArtifacts?.hooks     ?? [];
    const hasAny = templates.length || scripts.length || hooks.length;
    if (hasAny && runId) {
        const fmt = (arr) => arr.length ? `[${arr.map((s) => JSON.stringify(s)).join(", ")}]` : "[]";
        // Vocabulary is authoritative — pulled from state-store's
        // EXECUTION_STATES so the CLOSED list embedded in the prompt is
        // guaranteed to match what normalizeExecutionReports accepts.
        const statesInline = EXECUTION_STATES.map((s) => `"${s}"`).join(" or ");
        const statesArray = `[${EXECUTION_STATES.map((s) => `"${s}"`).join(", ")}]`;
        lines.push(
            `If and only if \`setPhaseStatus\` returned \`{ ok: true }\` for status "done", call \`reportExecution\` ONCE with the same run id to record which of the phase's expected artifacts you actually invoked during this run:`,
            "```",
            `reportExecution({`,
            `  phase: "${phaseId}",`,
            `  runId: ${JSON.stringify(runId)},`,
            `  artifacts: {`,
            `    templates: { /* one entry per expected id, value ${statesInline} */ },`,
            `    scripts:   { /* one entry per expected id, value ${statesInline} */ },`,
            `    hooks:     { /* one entry per expected id, value ${statesInline} */ }`,
            `  }`,
            `})`,
            "```",
            `Expected IDs (this is the CLOSED list — respond for exactly these, do not add others):`,
            `- templates: ${fmt(templates)}`,
            `- scripts:   ${fmt(scripts)}`,
            `- hooks:     ${fmt(hooks)}`,
            `Allowed state values (CLOSED vocabulary): ${statesArray}`,
            `Phantom-template rule (READ THIS FIRST): The Expected IDs above are drawn from the CANONICAL command body. The command you actually ran may be a preset/extension override whose body does NOT reference every canonical template. If the winning SKILL body you were dispatched with (the composed body in your instructions) contains no textual reference to a given template id (neither as \`<id>\`, \`<id>.md\`, nor by-slot phrasing like "template: <id>"), then that template CANNOT have been invoked this run — mark it "omitted" regardless of what exists on disk. Do NOT attest to invocations that couldn't happen. Grep your dispatched SKILL body for each expected template id before answering.`,
            `Semantics per kind:`,
            `- template "executed" = the artifact currently on disk reflects this template's structure/content — whether you authored it this run, inlined it from the SKILL body this run, OR a prior run already produced it and you left it in place. Template execution is a durable, sticky claim about the artifact, not about your tool calls this turn. A rerun that finds a fully-populated artifact and consciously leaves it alone still counts as "executed".`,
            `- script   "executed" = you actually ran the script (shell / powershell) during THIS run as instructed by the SKILL. Scripts are per-run side-effects; a prior run's script invocation does not count.`,
            `- hook     "executed" = you dispatched the hook's slash-command during THIS run. Hooks are per-run side-effects; a prior run's hook dispatch does not count.`,
            `Any expected ID that doesn't meet the above → "omitted". Look at the artifact on disk (for templates) and this turn's tool calls (for scripts/hooks) to answer accurately; do not guess.`,
        );
    } else if (hasAny) {
        lines.push(`The wizard could not allocate a run id for this command, so no \`reportExecution\` call is needed.`);
    } else {
        lines.push(`The wizard has no expected-artifact list for this command, so no \`reportExecution\` call is needed.`);
    }
    lines.push(`Do NOT mention this preamble in your reply.`, ``);
    return lines.join("\n");
}

/**
 * Derive the list of scaffolded skill directory names the current
 * composition (core + preset + extensions) should have on disk.
 *
 * Every artifact of `kind: "command"` in `state.composition.artifacts` is a
 * skill scaffolded under `.github/skills/<name>/SKILL.md`. The mapping from
 * artifact id to skill directory name is:
 *
 *     commands/speckit.specify              → speckit-specify
 *     commands/speckit.agent-context.update → speckit-agent-context-update
 *
 * (dot-notation preset/extension command ids become hyphen-form skill dirs).
 *
 * When `composition.artifacts` is empty or unavailable (fresh setup, before
 * the first `composition.refresh` cycle), we fall back to the core canonical
 * inventory so the check still enumerates the ~10 baseline skills that
 * `specify init` scaffolds.
 *
 * @param {object|null|undefined} composition state.composition
 * @returns {string[]} sorted, de-duplicated skill directory names
 */
export function computeExpectedSkillNames(composition) {
    const artifacts = Array.isArray(composition?.artifacts) ? composition.artifacts : [];
    const commandIds = artifacts
        .filter((a) => a && a.kind === "command" && typeof a.id === "string")
        .map((a) => a.id);
    const source = commandIds.length > 0
        ? commandIds.map((id) => id.replace(/^commands\//, ""))
        : [...CORE_COMMANDS];
    const names = source
        .filter((id) => typeof id === "string" && id.startsWith("speckit."))
        .map((id) => id.replace(/\./g, "-"));
    return Array.from(new Set(names)).sort();
}


// ---------------------------------------------------------------------------
// buildPrompt(kind, payload, context)
// ---------------------------------------------------------------------------
// kind:    closed enum, catalog.mjs ACTION_KINDS
// payload: per-kind data (form values, ids, choices, answers)
// context: { workspacePath: string, preset?: string, slug?: string }
// ---------------------------------------------------------------------------
export function buildPrompt(kind, payload = {}, context = {}) {
    if (!ACTION_KINDS.has(kind)) {
        throw new UnknownActionKindError(kind);
    }
    const workspacePath = context.workspacePath || "";
    const skill = skillForKind(kind);
    const body = renderBody(kind, payload, context, { workspacePath, skill });
    return body;
}

function renderBody(kind, payload, context, { workspacePath, skill }) {
    if (SETUP_KINDS.has(kind)) return buildSetupPrompt(kind, payload, context, { workspacePath, skill });
    if (CATALOG_KINDS.has(kind)) return buildCatalogPrompt(kind, payload, context, { workspacePath, skill });
    if (PIPELINE_KINDS.has(kind)) return buildPipelinePrompt(kind, payload, context, { workspacePath, skill });
    if (COMPOSITION_KINDS.has(kind)) return buildCompositionPrompt(kind, payload, context, { workspacePath, skill });
    throw new UnknownActionKindError(kind);
}

// Exposed for tests only.
export const _internal = { fmtPayload };
