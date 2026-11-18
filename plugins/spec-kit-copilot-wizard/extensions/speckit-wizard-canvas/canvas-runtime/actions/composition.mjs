// Composition-view canvas action handler: showInferredPipeline.
//
// Renamed from `showComposition` because the composition slice
// (`{ presets, extensions, artifacts }`) is written by the deterministic
// fast assembler in `canvas-runtime/composition-apply.mjs::runFastComposition`
// directly from Node (no agent involvement). The one remaining
// LLM-driven writer is the `composition.inferPipeline` prompt in
// `prompts/composition.mjs`, and it pushes `{ runId, inferredPipeline }`.
// The action also requires the originating refresh runId before handing
// the inferred pipeline to `applyComposition`, which partial-
// merges it into the cached composition (preserving the assembler-owned
// slice untouched).

import { withInstance } from "../instances.mjs";
import { applyComposition } from "../composition-apply.mjs";
import { finishRefreshPart } from "../refresh-status.mjs";
import { releaseBackgroundInference } from "../background-inference.mjs";
import { inferredPipelineInputSchema } from "../../contracts/agent-pipeline.mjs";
import { assertReplyRunId, ReplyRunError } from "../../contracts/agent-replies.mjs";

export const compositionActions = [
    {
        name: "showInferredPipeline",
        description:
            "Push the LLM's inferred pipeline ordering with the unchanged originating runId from the refresh prompt. Missing, stale, or completed run IDs are rejected before applying. Partial-merge preserves the assembler-owned composition slice (`{ presets, extensions, artifacts }`). Every id in `pipeline` / `unplaced` must be an artifact id with `kind: \"command\"` in the current cached composition.",
        inputSchema: inferredPipelineInputSchema,
        handler: (ctx) =>
            withInstance(ctx, async (inst) => {
                const refresh = inst.refreshStatus;
                const isCurrent = () => inst.refreshStatus === refresh;
                const assertCurrent = () => assertReplyRunId(ctx.input?.runId,
                    isCurrent() && refresh?.status === "refreshing" && refresh.pipelinePending ? refresh.id : null);
                try {
                    assertCurrent();
                    const result = await applyComposition(inst, { inferredPipeline: ctx.input.inferredPipeline },
                        { assertCurrent, isCurrent,
                            onCommitted: () => finishRefreshPart(inst, "pipeline", refresh) });
                    if (result.inferredPipelineStatus.accepted) {
                        const taskKey = `pipeline:${refresh.id}`;
                        releaseBackgroundInference(inst, taskKey);
                        if (inst.pipelineInferenceTaskKey === taskKey) {
                            delete inst.pipelineInferenceTaskKey;
                        }
                    }
                    return { ok: true, inferredPipelineStatus: result.inferredPipelineStatus };
                } catch (error) {
                    if (!(error instanceof ReplyRunError)) throw error;
                    return { ok: false, inferredPipelineStatus: { accepted: false,
                        provided: ctx.input?.inferredPipeline !== undefined, reason: error.message } };
                }
            }),
    },
];
