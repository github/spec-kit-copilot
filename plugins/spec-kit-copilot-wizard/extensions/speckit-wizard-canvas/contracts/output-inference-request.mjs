export class OutputInferenceRequestError extends Error {}

// Omitted commandId keeps legacy pipeline-wide requests; other legacy fields are ignored.
export function validateOutputInferenceRequest(payload) {
    if (payload == null) return {};
    if (typeof payload !== "object" || Array.isArray(payload)) {
        throw new OutputInferenceRequestError("Invalid output inference request");
    }
    if (!Object.hasOwn(payload, "commandId")) return {};
    if (typeof payload.commandId !== "string" || !payload.commandId
        || payload.commandId.trim() !== payload.commandId) {
        throw new OutputInferenceRequestError("Invalid output inference commandId");
    }
    return { commandId: payload.commandId };
}
