// speckit-wizard — shared building blocks for the LLM prompt builders.
//
// The wizard's prompts (in `catalog.mjs`, `setup.mjs`, `pipeline.mjs`,
// `composition.mjs`) are the text it sends to the Copilot agent to invoke
// `speckit-*` skills from the `spec-kit-copilot` skills plugin. This module
// exposes the pure, side-effect-free helpers that every builder stitches
// into that text:
//
//   • fmtPayload / fmtHeader     — the standard prompt lead-in (kind, scope,
//                                   file contract, workspace path).
//   • PREFLIGHT_STATE_READ /
//     STATE_UPDATE_HINT          — reusable text fragments the setup and
//                                   pipeline builders embed.
//   • RELOAD_VALIDATION_BLOCK    — the full reload-and-validate body used by
//                                   `setup.reloadSkills`.
//
// Zero I/O, zero side effects — safe to import from anywhere.

// Standing preamble stated verbatim in every dispatched prompt. Kept to a
// single line: the full file-contract spec lives in the wizard's SKILL.md.
// Restating 7 lines every turn floods the chat window without carrying new
// information.
export const FILE_CONTRACT_PREAMBLE =
    "File-contract rules: Persist all outputs to files (never inline in chat); markdown starts with a `<!-- speckit:<phase> v1 -->` provenance marker; state.json lives under `.speckit-wizard/` (preserve shape, own only your fields); do only this turn's step.";

export function fmtPayload(payload) {
    if (payload === undefined || payload === null) return "(empty)";
    try {
        return JSON.stringify(payload, null, 2);
    } catch {
        return String(payload);
    }
}

export function fmtHeader({ skill, kind, workspacePath, boundary }) {
    // kind and workspacePath are retained in the signature for callers/tests
    // but intentionally omitted from the emitted prompt: the invoked skill
    // operates on the session's cwd, and Kind duplicates the skill name.
    void kind;
    void workspacePath;
    // Lead with a bare `/<skill>` slash command so the CLI auto-injects the
    // skill's SKILL.md. Slash commands MUST be the first line of the message.
    // The follow-up line is a HARD requirement: the agent MUST call the
    // `skill` tool with the skill name as its first tool call. The slash
    // lead alone is not enough — programmatically-sent slash commands are
    // NOT intercepted as slash commands (only human-typed ones are), so
    // without this line the agent would follow the wizard's inline
    // instructions without ever loading the skill's SKILL.md.
    const lines = [
        `/${skill}`,
        `Invoke the \`skill\` tool with name \`${skill}\` before running any other tool call.`,
    ];
    if (boundary) lines.push(`Scope: ${boundary}`);
    lines.push(FILE_CONTRACT_PREAMBLE, "");
    return lines.join("\n");
}

// Setup-step short-circuit: every setup prompt first tells the agent to
// read `.speckit-wizard/state.json` and, when the corresponding flag is
// already `true`, verify cheaply (a single shell probe) and stop. This
// avoids redundant `specify --version` invocations across turns — the
// wizard has already recorded the outcome.
export const PREFLIGHT_STATE_READ =
    "Preflight: read `.speckit-wizard/state.json` first. If the flag below is already `true`, run only the single cheap verification listed and skip re-invoking the full skill.";

export const STATE_UPDATE_HINT =
    "Then update `.speckit-wizard/state.json` in place: only touch `phases.<phaseId>.{status,lastRunAt,artifactPath,formValues}` and top-level `currentPhase`.";

/**
 * Shared reload-and-validate block. Embedded verbatim in `setup.reloadSkills`
 * as the entire body — verifies the current composition still matches disk +
 * session.
 *
 * The block assumes the caller has an authoritative `artifacts` array in
 * memory. `setup.reloadSkills` supplies its own preamble: read
 * `state.composition.artifacts` from state.json, or fall back to the
 * hardcoded core canonical list when empty.
 */
export const RELOAD_VALIDATION_BLOCK = [
    "  1. **Compute expected skill directory names.** Filter the authoritative `artifacts` array to entries with `kind === \"command\"`. For each, take the `id`, strip the leading `commands/`, and replace every `.` with `-`. Example: `commands/speckit.agent-context.update` → `speckit-agent-context-update`. De-duplicate and sort. Call this list `EXPECTED`.",
    "  2. **On-disk probe (check A) — one call:**",
    "     ```",
    "     copilot skill list",
    "     ```",
    "     Cross-reference the output against `EXPECTED`. Every name in `EXPECTED` must appear; note any missing.",
    "  3. **In-session probe (check B) — one `skill` tool call per name in `EXPECTED`, batched in a single response.** Success means the session's registry sees it; a `not found` / `unknown skill` error means the session cache is stale for that name.",
    "  4. **Self-heal when A passes but B fails.** If check A is green but any name in `EXPECTED` fails check B, invoke the `reloadSessionSkills` canvas action via `invoke_canvas_action` on this wizard instance, then re-run check B ONCE for the names that failed. Do NOT emit `/skills reload` as plain text — it is not tool-callable. Use the post-reload B result for the final verdict.",
    "  5. **Push the result:** call `showEnvReport({ scaffoldedSkills: EXPECTED, skillsReloaded: <bool> })` where `skillsReloaded` is `true` iff BOTH A and (post-self-heal) B pass for every name in `EXPECTED`. This action also sets `setup.skillsReloaded` in `.speckit-wizard/state.json`.",
    "  6. **Interpretation branches:**",
    "     • Both A and B green (with or without self-heal) → push with `skillsReloaded: true`; the setup phase's Reload Skills step auto-marks done.",
    "     • A fails (name missing from disk) → push with `skillsReloaded: false`, list the missing names in chat, and tell the user which step to re-run (setup.init for a missing core, preset step for a missing preset command, extension step for a missing extension command).",
    "     • A passes but B still fails after the self-heal reload → push with `skillsReloaded: false` and tell the user the reload did not take effect; ask them to restart the Copilot session and click Refresh Composition again.",
].join("\n");
