import { UserError } from "../files.mjs";
import { validateValue } from "../contract.mjs";
import { RESPONSE_LIMIT } from "./agent-actions.mjs";

export const pendingId = (id) => /^__new__:[1-9]\d*$/.test(id);
export const newItem = (id) => id === "__new__" || pendingId(id);
export const freshState = () => ({ version: 1, revision: 0, selected: "__new__", phase: null, slug: "",
    name: "", names: {}, drafts: {}, runs: [], values: {}, pendingWorkflows: [], workflowSerial: 0 });

export function validatePendingRemoval(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)
        || Object.keys(input).some((key) => !["itemId", "revision", "confirmation"].includes(key))
        || !pendingId(input.itemId) || !Number.isSafeInteger(input.revision)
        || input.confirmation !== undefined && input.confirmation !== "discard") {
        throw new UserError("Invalid unstarted workflow removal.");
    }
    return input;
}

export function validateWorkflowState(state, phases, valueFields) {
    if (!state || state.version !== 1 || !Number.isSafeInteger(state.revision) || !Array.isArray(state.runs)
        || typeof state.drafts !== "object" || !state.drafts || Array.isArray(state.drafts)
        || typeof state.selected !== "string" || typeof state.slug !== "string"
        || (state.approvedUrlSources !== undefined
            && (!Array.isArray(state.approvedUrlSources) || state.approvedUrlSources.length > 80
                || state.approvedUrlSources.some((receipt) =>
                    typeof receipt !== "string" || receipt.length > 8192)))
        || (state.name !== undefined && (typeof state.name !== "string" || state.name.length > 120))
        || (state.names !== undefined && (!state.names || typeof state.names !== "object"
            || Array.isArray(state.names) || Object.values(state.names).some((name) =>
                typeof name !== "string" || name.length > 120)))
        || (state.workflowSerial !== undefined && (!Number.isSafeInteger(state.workflowSerial)
            || state.workflowSerial < 0))
        || (state.pendingWorkflows !== undefined && (!Array.isArray(state.pendingWorkflows)
            || state.pendingWorkflows.length > 100
            || state.pendingWorkflows.some((entry) => !entry || !pendingId(entry.id)
                || typeof entry.name !== "string" || entry.name.length > 120
                || typeof entry.slug !== "string" || entry.slug.length > 100)
            || new Set(state.pendingWorkflows.map((entry) => entry.id)).size !== state.pendingWorkflows.length))
        || state.runs.some((run) => !run || typeof run.runId !== "string" || typeof run.item !== "string"
            || !phases.some((phase) => phase.id === run.phase) || typeof run.sessionId !== "string"
            || typeof run.instanceId !== "string" || typeof run.args !== "string" || !Array.isArray(run.before)
            || (run.name !== undefined && (typeof run.name !== "string" || run.name.length > 120
                || /[\x00-\x1f\x7f]/.test(run.name)))
            || !["Request sent", "Running", "Unconfirmed", "Run output unconfirmed", "Completed", "Failed"].includes(run.status)
            || (run.artifact !== null && typeof run.artifact !== "string")
            || (run.artifacts !== undefined && (!Array.isArray(run.artifacts)
                || run.artifacts.length > 100 || run.artifacts.some((path) => typeof path !== "string")))
            || (run.response !== undefined && run.response !== null
                && (typeof run.response !== "string" || Buffer.byteLength(run.response) > RESPONSE_LIMIT))
            || (run.responseError !== undefined && run.responseError !== null && typeof run.responseError !== "string")
            || (run.stoppedAt !== undefined && (typeof run.autopilotId !== "string" || !run.autopilotId
                || typeof run.stoppedAt !== "string" || !Number.isFinite(Date.parse(run.stoppedAt))
                || new Date(run.stoppedAt).toISOString() !== run.stoppedAt))
            || (run.messageId !== null && typeof run.messageId !== "string"))
        || Object.values(state.drafts).some((draft) => typeof draft !== "string" || draft.length > 32000)
        || (state.values !== undefined && (!state.values || typeof state.values !== "object"
            || Array.isArray(state.values) || Object.entries(state.values).some(([id, value]) => {
                const field = valueFields.find((entry) => entry.id === id && entry.presentation === "stock.editable");
                if (!field) return true;
                try { validateValue(field.schema, value, id); return false; } catch { return true; }
            })))
        || (state.autopilot !== undefined && (!state.autopilot
            || typeof state.autopilot.id !== "string" || typeof state.autopilot.item !== "string"
            || typeof state.autopilot.instanceId !== "string" || typeof state.autopilot.sessionId !== "string"
            || !Number.isInteger(state.autopilot.current) || state.autopilot.current < 0
            || state.autopilot.current > phases.filter((step) => !step.project).length
            || !["Request sent", "Running", "Finishing", "Completed", "Blocked", "Paused"].includes(state.autopilot.status)
            || (state.autopilot.messageId !== null && typeof state.autopilot.messageId !== "string")
            || !["interactive", "plan", "autopilot", "shell"].includes(state.autopilot.previousMode)))) {
        throw new UserError("Saved canvas state is invalid. Restore its state.json before continuing.");
    }
    return state;
}
