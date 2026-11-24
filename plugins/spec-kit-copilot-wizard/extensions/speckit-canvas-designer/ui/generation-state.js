export const GENERATION_PENDING = "Generation is already queued for this Designer panel";
export const GENERATION_EXISTS = "Canvas already exists; review and confirm regeneration if it belongs to this Designer handoff, or save a different Canvas ID.";

export function generationAvailability(pending, exists) {
    if (typeof pending !== "boolean" || typeof exists !== "boolean") {
        throw new Error("Invalid Designer generation availability");
    }
    return { available: !pending && !exists,
        error: pending ? GENERATION_PENDING : exists ? GENERATION_EXISTS : null };
}
