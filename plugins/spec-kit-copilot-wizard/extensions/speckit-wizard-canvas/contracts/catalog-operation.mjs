const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const KINDS = new Set(["preset.install", "preset.remove", "extension.install",
    "extension.remove", "bundle.install", "bundle.remove"]);
const ALIASES = {
    "composition.removePreset": "preset.remove",
    "composition.removeExtension": "extension.remove",
};

export function catalogOperationKind(kind) {
    const canonical = ALIASES[kind] ?? kind;
    return KINDS.has(canonical) ? canonical : null;
}

export class CatalogOperationError extends Error {
    constructor(message, { status = 400, stage = "validation", changed = false, cause } = {}) {
        super(message, { cause });
        this.status = status;
        this.stage = stage;
        this.changed = changed;
    }
}

export function validateCatalogRequest(kind, payload) {
    const canonical = catalogOperationKind(kind);
    if (!canonical || !payload || typeof payload !== "object" || Array.isArray(payload)
        || Object.keys(payload).some((key) =>
            !["name", "source", "downloadUrl", "bundleYml", "confirmed", "priority"].includes(key))
        || typeof payload.name !== "string" || !ID.test(payload.name)
        || (payload.source !== undefined && (typeof payload.source !== "string" || !ID.test(payload.source)))
        || (payload.confirmed !== undefined && typeof payload.confirmed !== "boolean")
        || (payload.priority !== undefined && (!Number.isSafeInteger(payload.priority)
            || payload.priority < 0))
        || (payload.bundleYml != null && (typeof payload.bundleYml !== "string"
            || payload.bundleYml.length > 200000))) {
        throw new CatalogOperationError("Invalid catalog package request");
    }
    if (payload.downloadUrl != null) {
        let url;
        try { url = new URL(payload.downloadUrl); }
        catch { throw new CatalogOperationError("Invalid package download URL"); }
        if (typeof payload.downloadUrl !== "string" || url.protocol !== "https:"
            || url.username || url.password) {
            throw new CatalogOperationError("Package downloads require an approved HTTPS URL");
        }
    }
    const [group, action] = canonical.split(".");
    if ((payload.bundleYml != null && group !== "bundle")
        || (payload.priority !== undefined && (group === "bundle" || action !== "install"))
        || (action === "remove" && (payload.downloadUrl != null || payload.bundleYml != null))) {
        throw new CatalogOperationError("Unsupported package operation options");
    }
    return { kind: canonical, group, action, ...payload };
}

export function validateCatalogResult(result, { kind } = {}) {
    if (!result || result.ok !== true || !KINDS.has(result.kind)
        || (kind !== undefined && result.kind !== catalogOperationKind(kind))
        || typeof result.id !== "string" || !ID.test(result.id)
        || !["changed", "already-satisfied"].includes(result.outcome)
        || typeof result.skillsReloaded !== "boolean"
        || !result.timings || typeof result.timings !== "object"
        || !Number.isFinite(result.timings.total)
        || !Object.values(result.timings).every((value) => Number.isFinite(value) && value >= 0)) {
        throw new CatalogOperationError("Invalid catalog completion result", { stage: "completion", status: 500 });
    }
    return result;
}
