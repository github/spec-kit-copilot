import { RUNNABLE_PHASE_ORDER } from "../canvas-runtime/wizard-phases.mjs";
import { EXECUTION_STATES } from "../state/execution-reports.mjs";

export const phaseStatusInputSchema = {
    type: "object",
    required: ["phase", "status"],
    properties: {
        phase: { type: "string", enum: RUNNABLE_PHASE_ORDER },
        status: { type: "string", enum: ["empty", "in_progress", "done", "skipped", "error"] },
        artifactPath: { type: "string" },
        runId: { type: "string" },
    },
};

export const phaseExecutionInputSchema = {
    type: "object",
    required: ["phase", "artifacts", "runId"],
    properties: {
        phase: { type: "string", enum: RUNNABLE_PHASE_ORDER },
        runId: { type: "string" },
        artifacts: {
            type: "object",
            description:
                "Per-kind map of bareId → 'executed' | 'omitted'. Use the exact IDs the tracking preamble listed as expected. Do not invent IDs.",
            properties: Object.fromEntries(["templates", "scripts", "hooks"].map((kind) =>
                [kind, { type: "object", additionalProperties: { type: "string", enum: EXECUTION_STATES } }])),
        },
    },
};

export { EXECUTION_STATES };
