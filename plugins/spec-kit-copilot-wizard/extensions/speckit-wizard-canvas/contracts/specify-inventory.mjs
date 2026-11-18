const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export function normalizeInstalledWorkflowInventory(inventories) {
    const result = { presets: [], extensions: [], bundles: [] };
    for (const kind of ["presets", "extensions"]) {
        const items = inventories?.[kind];
        if (!Array.isArray(items) || items.length > 40) {
            throw new Error(`Invalid installed ${kind} inventory from Specify CLI`);
        }
        const seen = new Set();
        for (const item of items) {
            if (typeof item?.id !== "string" || !ID.test(item.id)
                || typeof item.version !== "string"
                || !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/.test(item.version)
                || !Number.isSafeInteger(item.priority)
                || typeof item.enabled !== "boolean"
                || !item.source || !["local", "catalog"].includes(item.source.kind)
                || (item.source.kind === "catalog"
                    && (typeof item.source.catalog !== "string"
                        || !ID.test(item.source.catalog) || item.source.catalog === "local"))
                || seen.has(item.id)) {
                throw new Error(`Invalid installed ${kind} identity, version, state, priority or source from Specify CLI`);
            }
            seen.add(item.id);
            result[kind].push({ id: item.id, version: item.version, priority: item.priority,
                enabled: item.enabled, source: item.source.kind === "local"
                    ? "local" : item.source.catalog });
        }
    }
    result.bundles = normalizeInstalledBundles(inventories?.bundles);
    return result;
}

export function normalizeInstalledBundles(items) {
    if (!Array.isArray(items) || items.length > 40) {
        throw new Error("Invalid installed bundle inventory from Specify CLI");
    }
    const seen = new Set();
    return items.map((item) => {
        if (typeof item?.bundle_id !== "string" || !ID.test(item.bundle_id)
            || typeof item.version !== "string"
            || !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/.test(item.version)
            || seen.has(item.bundle_id)) {
            throw new Error("Invalid installed bundle identity or version from Specify CLI");
        }
        seen.add(item.bundle_id);
        return { id: item.bundle_id, version: item.version };
    });
}
