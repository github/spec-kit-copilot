export const BADGE_IMPORT_FILE_LIMIT = 2 * 1024 * 1024;
export const BADGE_IMPORT_REQUEST_LIMIT = 4 * 1024 * 1024;

const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const keys = (value, expected) => record(value)
    && Object.keys(value).sort().join() === [...expected].sort().join();

export function validateBadgeImportRequest(value) {
    if (!keys(value, ["schemaVersion", "modelRevision", "config", "badges", "outputs"])
        || value.schemaVersion !== 1 || typeof value.modelRevision !== "string"
        || !value.modelRevision || !record(value.config)
        || !Array.isArray(value.badges) || !record(value.outputs)) {
        throw new Error("Invalid Designer badge import request");
    }
    return value;
}

export function validateBadgeImportResponse(value, expectedBadges) {
    if (!keys(value, ["schemaVersion", "badges"]) || value.schemaVersion !== 1
        || !Array.isArray(value.badges) || !Array.isArray(expectedBadges)
        || JSON.stringify(value.badges) !== JSON.stringify(expectedBadges)) {
        throw new Error("Designer returned an incompatible badge import result");
    }
    return value;
}

export function validateBadgeImportError(value) {
    if (!keys(value, ["error"]) || typeof value.error !== "string" || !value.error.trim()) {
        throw new Error("Designer returned an incompatible badge import error");
    }
    return value;
}
