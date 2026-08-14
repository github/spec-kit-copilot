// speckit-wizard — LLM prompt builders for the "setup" action family.
//
// This file (and its `prompts/*.mjs` siblings) is where the wizard stores
// the text prompts it sends to the Copilot agent. Most builders emit a
// prompt that begins with a `/speckit-<skill>` slash command; a few use a
// Copilot CLI slash command instead (see `setup.reloadSkills` below).
//
// This module owns the "setup" family:
//   • setup.init          → /speckit-init         (skill: scaffold `.specify/`)
//   • setup.reloadSkills  → /skills reload        (Copilot CLI command, not a
//                                                  speckit skill — reloads the
//                                                  skill index for this session)
//   • skills.verify       → /speckit-cli-setup    (skill: verify installed CLI)
//
// See `../prompts.mjs` for the top-level dispatcher and family split.

import { skillForKind } from "../canvas-runtime/wizard-phases.mjs";
import { computeExpectedSkillNames } from "../prompts.mjs";
import {
    FILE_CONTRACT_PREAMBLE,
    PREFLIGHT_STATE_READ,
    RELOAD_VALIDATION_BLOCK,
    fmtHeader,
} from "./shared.mjs";

export const SETUP_KINDS = new Set([
    "setup.init",
    "setup.reloadSkills",
    "skills.verify",
]);

export function buildSetupPrompt(kind, payload, context, { workspacePath, skill }) {
    switch (kind) {
        case "setup.init": {
            void payload;
            void workspacePath;
            return (
                fmtHeader({
                    skill,
                    kind,
                    workspacePath,
                    boundary: "Scaffold the Spec Kit project into the current workspace and record success in state.json.",
                }) +
                [
                    PREFLIGHT_STATE_READ,
                    "Flags: `setup.projectInitialized` (this step) and `setup.cliInstalled` (prerequisite).",
                    "If `setup.projectInitialized` is already `true` AND a `.specify/` directory exists in the workspace, DO NOT re-run init. Push a `showEnvReport` from cached state and stop.",
                    "",
                    "Otherwise:",
                    "1. If `setup.cliInstalled` is `true` in state.json, TRUST IT and skip re-verifying. Only when the flag is missing or false, invoke `speckit-cli-setup` first and set `setup.cliInstalled: true` (and `setup.cliVersion` when available).",
                    "2. Run the `speckit-init` skill to scaffold into the current workspace non-interactively (merge over existing files, PowerShell script flavor on Windows / sh elsewhere, Copilot integration with the `--skills` option so `.github/skills/speckit-<phase>/` folders are scaffolded rather than legacy `.github/prompts/*.prompt.md`).",
                    "3. After init succeeds, verify `.specify/` exists and set `setup.projectInitialized: true` in `.speckit-wizard/state.json`. If init fails, report the error in chat and leave the flag false.",
                ].join("\n")
            );
        }
        case "setup.reloadSkills": {
            // Two paths:
            //   • FAST — no presets and no extensions installed on disk. The
            //     expected skill set is the hardcoded core canonical list
            //     (10 skills). No CLI scan needed. This is the pure-core
            //     initial-setup case: fresh `specify init`, no customization.
            //   • FULL — any preset or extension is installed. Delegate to
            //     `skills.verify`, which discovers the on-disk skill set at
            //     runtime (from `.github/skills/speckit-*`) and reloads +
            //     verifies without needing the full composition scan.
            //
            // The server passes `installedPresetCount` and
            // `installedExtensionCount` in context (cheap fs dir counts on
            // .specify/presets and .specify/extensions). Missing/undefined
            // is treated as 0 so unit tests without a workspace still hit
            // the fast path.
            const presetCount = Number(context?.installedPresetCount ?? 0);
            const extensionCount = Number(context?.installedExtensionCount ?? 0);
            const coreOnly = presetCount === 0 && extensionCount === 0;
            if (!coreOnly) {
                return buildSetupPrompt(
                    "skills.verify",
                    payload,
                    context,
                    { workspacePath, skill: skillForKind("skills.verify") },
                );
            }
            void payload;
            void workspacePath;
            void skill;
            const expected = computeExpectedSkillNames(null);
            const jsonList = JSON.stringify(expected);
            return [
                `Scope: verify the ${expected.length} core Spec Kit skills required by this project are on disk AND loaded in this session.`,
                FILE_CONTRACT_PREAMBLE,
                "",
                PREFLIGHT_STATE_READ,
                "Flag: `setup.skillsReloaded`.",
                "",
                `This is a **core-only project** — no presets or extensions are installed under \`.specify/presets/\` or \`.specify/extensions/\`. The expected skill set is the hardcoded ${expected.length} core canonicals; no composition scan is needed.`,
                "",
                `Authoritative \`EXPECTED\` list for this call (use verbatim, do not re-derive):`,
                `  ${jsonList}`,
                "",
                RELOAD_VALIDATION_BLOCK,
                "",
                "Notes for this fast path:",
                "  • Skip `EXPECTED` derivation (step 1 in the block above) — use the list printed above verbatim.",
                "  • You DO NOT need to run any composition step here. The composition view will remain empty (client-side synthesis renders the core canonicals for display) until the user installs a preset/extension and clicks Refresh Now.",
                "  • This whole path exists so initial setup does not pay the cost of a full composition scan when there is nothing to compose.",
            ].join("\n");
        }
        case "skills.verify": {
            // Plain natural-language prompt modeled on the reference
            // spec-kit-copilot canvas plugins (assess/sdd/bugfix), which
            // reliably reload skills with a single prose instruction:
            //   "…reload Copilot skills in this session, and report when
            //    they are ready."
            // The LLM decides how to reload (typically by emitting
            // `/skills reload` on its own line, which the Copilot CLI
            // composer intercepts). We trust it to do the right thing
            // rather than trying to script the exact assistant-message
            // format. If the reload still doesn't take effect, the
            // verification step will catch it and ask the user to
            // reload manually.
            void payload;
            void workspacePath;
            void skill;
            return [
                "Reload Copilot skills in this session so the in-memory registry picks up any newly scaffolded Spec Kit skills, then briefly confirm they loaded.",
                "",
                "**To reload skills, invoke the `reloadSessionSkills` canvas action via `invoke_canvas_action` on this wizard instance.** This calls `session.rpc.skills.reload()` directly and is the reliable way to refresh the in-memory skill registry. Do NOT emit `/skills reload` as plain text — the composer does not reliably intercept it from the assistant.",
                "",
                "After reloading, run `copilot skill list` once to confirm the reload succeeded and briefly note the result in chat (e.g. \"reloaded — 43 speckit-* skills present\"). Do NOT call `showEnvReport`; do NOT batch per-skill `skill` tool probes.",
            ].join("\n");
        }

        default:
            throw new Error(`buildSetupPrompt: unexpected kind ${kind}`);
    }
}
