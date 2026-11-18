import { createHash } from "node:crypto";

export const REQUEST_LIMIT = 4 * 1024 * 1024;

export function validateGenerationRequestIntegrity(request, handoffId, requestId) {
    const { integrity, ...payload } = request;
    const hash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    if (integrity !== hash || request.handoffId !== handoffId || request.requestId !== requestId) {
        throw new Error("Generation request integrity mismatch");
    }
}
