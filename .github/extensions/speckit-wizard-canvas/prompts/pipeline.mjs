// speckit-wizard — LLM prompt builders for the "pipeline" action family.
//
// This file (and its `prompts/*.mjs` siblings) is where the wizard stores
// the text prompts it sends to the Copilot agent. All builders in THIS file
// dispatch to a `/speckit-<skill>` slash command so Copilot CLI auto-loads
// the matching SKILL.md into context — none of the pipeline phases use
// natural-language or CLI slash commands. (For the non-skill outliers, see
// `composition.mjs` and `setup.mjs`.)
//
// This module owns the "pipeline" family — the nine canonical Spec-Driven
// phase kinds plus the issue-conversion phase:
//   • constitution / specify / clarify / plan / checklist / tasks / analyze
//     / implement                    → /speckit-<phase>
//   • taskstoissues                  → /speckit-taskstoissues
//
// See `../prompts.mjs` for the top-level dispatcher and family split.

import { getPhase } from "../canvas-runtime/wizard-phases.mjs";
import { CANONICAL_PHASES } from "../pipeline/canonical.mjs";
import { fmtHeader, fmtPayload, STATE_UPDATE_HINT } from "./shared.mjs";

// The 9 canonical Spec-Driven phase kinds (constitution … implement) are
// spread from CANONICAL_PHASES so this Set auto-tracks the single source
// of truth in `pipeline/canonical.mjs`.
export const PIPELINE_KINDS = new Set([
    ...CANONICAL_PHASES,
]);

export function buildPipelinePrompt(kind, payload, context, { workspacePath, skill }) {
    void context;
    switch (kind) {
        // -------- Wizard phases --------
        case "constitution":
        case "specify":
        case "clarify":
        case "plan":
        case "checklist":
        case "tasks":
        case "analyze":
        case "implement": {
            const phase = getPhase(kind);
            const artifact = phase?.artifact ?? "(none)";
            return (
                fmtHeader({
                    skill,
                    kind,
                    workspacePath,
                    boundary: `Run the ${kind} phase only.`,
                }) +
                [
                    `Artifact: \`${artifact}\` (first line must be \`<!-- speckit:${kind} v1 -->\`).`,
                    `Payload:\n\`\`\`json\n${fmtPayload(payload)}\n\`\`\``,
                    STATE_UPDATE_HINT,
                ].join("\n")
            );
        }
        case "taskstoissues": {
            return (
                fmtHeader({
                    skill,
                    kind,
                    workspacePath,
                    boundary: "File tasks from the most recent `specs/<slug>/tasks.md` as GitHub issues. Do not modify tasks.md.",
                }) +
                [
                    `Payload:\n\`\`\`json\n${fmtPayload(payload)}\n\`\`\``,
                    "Then briefly summarize the result in chat and update `.speckit-wizard/state.json` for phase `taskstoissues` (status: done, lastRunAt: now).",
                ].join("\n")
            );
        }

        default:
            throw new Error(`buildPipelinePrompt: unexpected kind ${kind}`);
    }
}
