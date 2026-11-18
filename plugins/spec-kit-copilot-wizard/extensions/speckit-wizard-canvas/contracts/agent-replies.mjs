export const replyRunIdSchema = Object.freeze({
    type: "string",
    pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    description: "Server-issued originating run ID. Copy from the request; never substitute a newer run ID.",
});

export class ReplyRunError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

export function assertReplyRunId(runId, expectedId) {
    if (typeof runId !== "string" || !new RegExp(replyRunIdSchema.pattern).test(runId)) {
        throw new ReplyRunError(400, "A valid originating runId is required");
    }
    if (!expectedId || runId !== expectedId) {
        throw new ReplyRunError(409, "Reply runId is no longer current; stop without retrying against a newer run");
    }
}
