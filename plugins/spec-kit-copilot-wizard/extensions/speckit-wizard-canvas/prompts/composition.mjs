// speckit-wizard — LLM prompt builders for the "composition" action family.
//
// This file (and its `prompts/*.mjs` siblings) is where the wizard stores
// the text prompts it sends to the Copilot agent. Most builders in this
// module emit a `/speckit-<skill>` slash command; the two outliers are
// `composition.refresh` and `composition.inferPipeline`, which emit
// **natural-language instructions with no slash command** — pipeline shape
// inference needs README fetching + mermaid/prose reasoning that no
// existing speckit skill provides, so the agent runs the reasoning
// directly against the state store and emits `inferredPipeline`.
//
// This module owns the "composition" family — actions that mutate or
// inspect the wizard's rendered stack of installed presets and extensions:
//   • composition.refresh / .inferPipeline           → LLM composition rebuild
//   • composition.{view,update,remove}Preset         → /speckit-preset
//   • composition.{view,update,remove}Extension      → /speckit-extension
//   • extension.inferArtifactTargets                 → /speckit-extension
//
// See `../prompts.mjs` for the top-level dispatcher and family split.

import { FILE_CONTRACT_PREAMBLE, fmtHeader } from "./shared.mjs";

export const COMPOSITION_KINDS = new Set([
    "composition.refresh",
    "composition.inferPipeline",
    "composition.viewExtension",
    "composition.updateExtension",
    "composition.removeExtension",
    "composition.viewPreset",
    "composition.updatePreset",
    "composition.removePreset",
    "extension.inferArtifactTargets",
]);

export function buildCompositionPrompt(kind, payload, context, { workspacePath, skill }) {
    void context;
    switch (kind) {
        case "composition.refresh":
        case "composition.inferPipeline": {
            // Stage 2 (inferPipeline) only. Stage 1 — building
            // { presets, extensions, artifacts } — is now handled entirely
            // by the deterministic fast assembler (composition-assembler.mjs)
            // which runs on install/boot. This prompt is the LLM path for
            // pipeline shape inference, which still needs README fetching
            // and mermaid/prose reasoning that the CLI can't provide.
            //
            // When the fast path can synthesize the pipeline from the
            // canonical spine (no new commands, no wraps/prepends/appends),
            // `runFastComposition` stamps `inferredPipeline` directly and
            // this prompt is never triggered. It only runs when the user
            // explicitly clicks Refresh Now AND `computeStage2Necessity`
            // returned `needed: true`.
            //
            // Reads the composition slice from state.json (populated by the
            // fast path) and emits ONLY `inferredPipeline` — partial-merge
            // in the `showInferredPipeline` handler preserves everything else.
            const parts = [
                `Kind: ${kind}`,
                "Scope: Infer the pipeline shape for the current composition.",
                FILE_CONTRACT_PREAMBLE,
                "",
                "## Infer pipeline",
                "",
                "Read `state.composition.{presets,extensions,artifacts}` from `.speckit-wizard/state.json`. If empty, the fast composition assembler has not run yet — surface a log warning and stop (do NOT emit an `inferredPipeline` against an empty artifact set).",
                "Push `showInferredPipeline({ inferredPipeline: { shape, pipeline, unplaced, rationale } })` — no other keys.",
                "",
                "**Best-effort README fetch** — for each preset/extension whose manifest has a `repository:` or `homepage:` URL, fetch that README's markdown (prefer subdirectory URL → `raw.githubusercontent.com/...README.md`, fall back to repo root on 404). Failures are non-fatal.",
                "",
                "**Shape selector:**",
                "- ANY enabled preset replaces a core canonical → `shape: \"augmented-canonical\"`.",
                "- Else, a `category: process` extension with zero hooks + a README describing 3+ end-to-end commands → `shape: \"standalone\"`.",
                "- Else → `shape: \"augmented-canonical\"` (safe default).",
                "",
                "**Order signals (highest → lowest):**",
                "1. Preset/extension workflow file `steps:` array (from state's workflows list) — authoritative when present. Follow `default:` on branch/switch steps; skip runtime-only kinds without `command:`.",
                "2. Preset `provides.commands[]` `wraps:`/`prepends:`/`appends:` keys naming a core phase.",
                "3. README mermaid flowchart or numbered `Typical Flow` / `Usage`.",
                "4. Extension `before_X` / `after_X` hooks confirm phase `X`'s neighborhood. Hook target commands are EXCLUDED from `pipeline` and `unplaced` (runtime auto-fires them).",
                "5. Extension `provides.commands[]` declaration order for multi-command extensions with no other signal.",
                "6. Command description prose (`Next step:`, `Prerequisites:`, verb-tense cues).",
                "",
                "**Constraints (validator enforces — the action returns `inferredPipelineStatus.reason` on rejection; retry same turn on `accepted: false`):**",
                "- Every id in `pipeline` / `unplaced` is a command artifact id from state — i.e. `commands/<full-command-id>` (e.g. `commands/speckit.specify`) — with `kind: \"command\"` in `artifacts[]` (closed vocabulary). For `augmented-canonical`, the five canonical anchors `commands/speckit.{constitution,specify,plan,tasks,implement}` are required.",
                "- Hook target ids appear in neither `pipeline` nor `unplaced`.",
                "- `augmented-canonical` requires the five core canonicals (`speckit.{constitution,specify,plan,tasks,implement}`) in `pipeline`.",
                "- `standalone` requires `pipeline.length >= 3`.",
                "- No duplicates. Total ≤ 30.",
                "- Do not reorder canonicals in `augmented-canonical`; you may insert extension commands between them.",
                "",
                "Core-only project (no presets, no extensions): the fast path already synthesizes `augmented-canonical` from the canonical spine — this prompt should never fire for that case. If it does, emit the same shape.",
                "",
                `Payload: \`${JSON.stringify(payload)}\``,
                "`.speckit-wizard/state.json` is the state store.",
            ];
            return parts.join("\n");
        }

        case "composition.viewExtension":
        case "composition.updateExtension":
        case "composition.removeExtension": {
            const verbMap = {
                "composition.viewExtension": "info",
                "composition.updateExtension": "update",
                "composition.removeExtension": "remove",
            };
            const cliVerb = verbMap[kind];
            return (
                fmtHeader({
                    skill,
                    kind,
                    workspacePath,
                    boundary: `Run \`specify extension ${cliVerb} <id>\` on exactly the named extension.`,
                }) +
                [
                    `Run \`specify extension ${cliVerb} ${payload?.name ?? "<id>"}\`.`,
                    cliVerb === "info"
                        ? "Do NOT modify state. This is a read-only inspection; do NOT auto-dispatch `composition.refresh`."
                        : "Do NOT auto-dispatch `composition.refresh` after the CLI succeeds — the fast composition assembler re-runs automatically when the wizard re-fetches the catalog.",
                    `Payload: \`${JSON.stringify(payload)}\``,
                    "`.speckit-wizard/state.json` is the state store.",
                ].join("\n")
            );
        }

        // Composition row actions — preset counterparts of the extension
        // view/update/remove group above. Dispatched from the flat-layer
        // fallback table (`ui/composition/stack-layer.js`) when
        // `l.kind === "preset"`.
        case "composition.viewPreset":
        case "composition.updatePreset":
        case "composition.removePreset": {
            const verb = kind.split(".")[1];
            return (
                fmtHeader({
                    skill,
                    kind,
                    workspacePath,
                    boundary: `Perform "${verb}" on exactly the named item.`,
                }) +
                [
                    `Payload: \`${JSON.stringify(payload)}\``,
                    "Then refresh via the wizard's fast composition assembler. `.speckit-wizard/state.json` is the state store.",
                ]
                    .filter(Boolean)
                    .join("\n")
            );
        }

        case "extension.inferArtifactTargets": {
            // Payload from ui/app.js:
            //   { commands: [{ commandId, skillPath }], origin, token }
            const commands = Array.isArray(payload?.commands) ? payload.commands : [];
            const origin = typeof payload?.origin === "string" ? payload.origin : "";
            const token = typeof payload?.token === "string" ? payload.token : "";
            const cmdBullets = commands
                .map((c) => `  • \`${c?.commandId ?? "?"}\`  ← \`${c?.skillPath ?? "?"}\``)
                .join("\n");
            return (
                fmtHeader({
                    skill,
                    kind,
                    workspacePath,
                    boundary: "Infer artifact-target paths, one-line descriptions, and args-input hints for the listed extension commands only. Read files, POST results, then stop — do NOT run or explain the commands.",
                }) +
                [
                    "The wizard's phase cards need four things per extension command, ALL best-attempt-inferable from the skill body:",
                    "  1. `writesTo` — path template for `Writes to <path>` link.",
                    "  2. `description` — one-sentence tagline shown UNDER the phase title (says what the phase does overall).",
                    "  3. `argsHint` — one short sentence shown as the primary placeholder in the args input (says WHAT to type).",
                    "  4. `argsWhenEmpty` — one short sentence shown as the italic hint after the primary (says what happens if the input is left empty).",
                    "Extensions don't declare any of these in a machine-readable way, so infer from the command's skill (or command markdown) body.",
                    "",
                    "**Commands to inspect** (each row = one command id and the file to read):",
                    cmdBullets || "  (none — nothing to do; return early)",
                    "",
                    "**Procedure (do this for EVERY command in the list, in parallel batches):**",
                    "  1. `view` the file at `skillPath`. Skills typically open with an H1 tagline (source of `writesTo` + `description`) and have a `## User Input` section (source of `argsHint` + `argsWhenEmpty`).",
                    "  2. **writesTo** — first `.specify/…/*.md` path template in the opening description (before the first `##`). Use `<slug>` VERBATIM for any per-run identifier — do NOT substitute a concrete value. Omit if the skill genuinely writes nothing.",
                    "  3. **description** — one plain sentence (≤120 chars) that says what this command does, derived from the H1 tagline. Strip the artifact path — the path is shown separately. No backticks, no command name, no trailing period-only fragments.",
                    "  4. **argsHint** — one short sentence (≤120 chars), imperative form, describing what the user should type as arguments. Derived from the skill's `## User Input` section — the sentence that describes what `$ARGUMENTS` should contain. Example: `The idea to intake — pasted text, a URL, or a codebase pointer.` Omit if the skill's User Input section is missing or purely mechanical.",
                    "  5. **argsWhenEmpty** — one short sentence (≤120 chars) starting with `If left empty, `, describing what the skill does when no args are provided. Derived from the same `## User Input` section — usually the last sentence about empty/missing input. Example: `If left empty, the skill will ask you for the idea, or stop if no human is driving.` Omit if the skill doesn't specify empty-input behavior.",
                    "  6. Any field you cannot confidently derive: OMIT it (do not invent). Submit the entry as long as AT LEAST ONE of the four fields is present. If you can't produce any of them, omit the whole command.",
                    "",
                    "**Submit results** by POSTing to the wizard once, all commands in one call:",
                    "```",
                    `POST ${origin}/api/artifact-targets?token=${token}`,
                    "Content-Type: application/json",
                    "",
                    "{",
                    "  \"entries\": {",
                    "    \"commands/<full-command-id>\": {",
                    "      \"writesTo\": \".specify/<domain>/<slug>/<filename>.md\",",
                    "      \"description\": \"<one plain sentence, ≤120 chars>\",",
                    "      \"argsHint\": \"<imperative sentence, ≤120 chars>\",",
                    "      \"argsWhenEmpty\": \"<sentence starting with 'If left empty, ', ≤120 chars>\",",
                    "      \"source\": \"llm\",",
                    "      \"skillPath\": \"<the skillPath you read>\"",
                    "    }",
                    "  }",
                    "}",
                    "```",
                    "",
                    "Use `Invoke-RestMethod` on PowerShell or `curl -s -X POST -H 'Content-Type: application/json' -d '{...}' <url>` on bash. Verify a `200 { \"ok\": true, \"merged\": N }` response. If you get a 4xx/5xx, log the body and stop — do not retry blindly.",
                    "",
                    "Do NOT modify the skill files, run the commands, or produce any other artifact. This is a metadata-only pass.",
                    `Payload: \`${JSON.stringify(payload)}\``,
                    "State store: `.speckit-wizard/state.json` (untouched by this step). Cache written to: `.speckit-wizard/artifact-targets.json` (the wizard writes it — you just POST).",
                ].join("\n")
            );
        }

        default:
            throw new Error(`buildCompositionPrompt: unexpected kind ${kind}`);
    }
}
