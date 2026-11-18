export { validateInferredPipeline } from "../pipeline/validate.mjs";
import { replyRunIdSchema } from "./agent-replies.mjs";

export const inferredPipelineInputSchema = {
    type: "object",
    required: ["runId", "inferredPipeline"],
    properties: {
        runId: replyRunIdSchema,
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
};
