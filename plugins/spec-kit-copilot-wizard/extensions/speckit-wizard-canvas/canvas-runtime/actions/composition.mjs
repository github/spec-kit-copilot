// Composition-view canvas action handler: showInferredPipeline.
//
// Renamed from `showComposition` because the composition slice
// (`{ presets, extensions, artifacts }`) is written by the deterministic
// fast assembler in `canvas-runtime/composition-apply.mjs::runFastComposition`
// directly from Node (no agent involvement). The one remaining
// LLM-driven writer is the `composition.inferPipeline` prompt in
// `prompts/composition.mjs`, and it only ever pushes `{ inferredPipeline }`.
// So this action's real contract is: receive one payload — the LLM's
// inferred pipeline — and hand it to `applyComposition`, which partial-
// merges it into the cached composition (preserving the assembler-owned
// slice untouched).

import { withInstance } from "../instances.mjs";
import { applyComposition } from "../composition-apply.mjs";

export const compositionActions = [
    {
        name: "showInferredPipeline",
        description:
            "Push the LLM's inferred pipeline ordering (`{ shape, pipeline, unplaced, rationale }`) to the wizard. Emitted by the `composition.inferPipeline` prompt after reading `state.composition.artifacts` + fetched READMEs. Partial-merge in the handler preserves the assembler-owned composition slice (`{ presets, extensions, artifacts }`) untouched. Every id in `pipeline` / `unplaced` must be an artifact id with `kind: \"command\"` in the current cached composition — closed vocabulary.",
        inputSchema: {
            type: "object",
            required: ["inferredPipeline"],
            properties: {
                inferredPipeline: {
                    type: "object",
                    description: "LLM-emitted best-guess pipeline order derived from the artifacts, manifests, and READMEs in state. Two shapes are legal: `augmented-canonical` (canonical spine with extension commands inserted) and `standalone` (self-contained pipeline that replaces the canonical spine — used by discovery-track extensions like `assess`). Every id in `pipeline`/`unplaced` must be a command artifact id in state — i.e. `commands/<full-command-id>` (e.g. `commands/speckit.specify`). For `augmented-canonical`, the five canonical anchors `commands/speckit.{constitution,specify,plan,tasks,implement}` are required.",
                    properties: {
                        shape: {
                            type: "string",
                            enum: ["augmented-canonical", "standalone"],
                            description: "Which output shape this pipeline uses. Controls shape-conditional validation (canonicals required or not).",
                        },
                        pipeline: {
                            type: "array",
                            description: "Ordered list of command artifact ids the user is expected to follow. Each entry must equal an artifact id with `kind: \"command\"` in cached composition — namespaced as `commands/<full-command-id>` (e.g. `commands/speckit.specify`).",
                            items: { type: "string" },
                        },
                        unplaced: {
                            type: "array",
                            description: "Command artifact ids (`commands/<full-command-id>`) the LLM couldn't confidently place. Rendered as a draggable side-bin in the wizard UI.",
                            items: { type: "string" },
                        },
                        rationale: {
                            type: "string",
                            description: "One-sentence explanation of which signals drove the pipeline choice (e.g. `assess extension has category:process, zero hooks, and README mermaid chart intake→research→define→shape→decide`).",
                        },
                    },
                },
            },
        },
        handler: (ctx) =>
            withInstance(ctx, async (inst) => {
                const result = await applyComposition(inst, ctx.input ?? {});
                // Surface inferredPipeline acceptance so the LLM sees the
                // drop in-turn (silent-drop was the previous failure mode).
                return { ok: true, inferredPipelineStatus: result.inferredPipelineStatus };
            }),
    },
];
