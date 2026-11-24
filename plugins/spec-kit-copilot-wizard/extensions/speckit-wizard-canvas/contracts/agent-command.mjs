export const COMMAND_COMPLETION_STATUSES = ["done", "skipped", "error"];

export const commandCompletionInputSchema = {
    type: "object",
    required: ["commandId", "runId", "status"],
    properties: {
        commandId: { type: "string", minLength: 1, maxLength: 100, pattern: "^[\\w.-]+$" },
        runId: { type: "string", minLength: 1, maxLength: 128, pattern: "^[\\w.-]+$" },
        status: { type: "string", enum: COMMAND_COMPLETION_STATUSES },
    },
    additionalProperties: false,
};

export function validateCommandCompletionInput(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        return { ok: false, error: "invalid command completion" };
    }
    if (Object.keys(input).some((key) => !["commandId", "runId", "status"].includes(key))) {
        return { ok: false, error: "invalid command completion" };
    }
    const { commandId, runId, status } = input;
    if (typeof commandId !== "string" || !/^[\w.-]{1,100}$/.test(commandId)) {
        return { ok: false, error: "invalid commandId" };
    }
    if (typeof runId !== "string" || !/^[\w.-]{1,128}$/.test(runId)) {
        return { ok: false, error: "invalid runId" };
    }
    if (!COMMAND_COMPLETION_STATUSES.includes(status)) {
        return { ok: false, error: "invalid status" };
    }
    return { ok: true, value: { commandId, runId, status } };
}
