export function normalizeObservedVersions(stdout, kind, relevantIds) {
    let entries;
    try { entries = JSON.parse(stdout); }
    catch { throw new Error(`Invalid ${kind} JSON from Specify`); }
    if (!Array.isArray(entries)) {
        throw new Error(`Invalid ${kind} inventory from Specify`);
    }
    entries = entries.filter((entry) =>
        relevantIds.has(kind === "bundles" ? entry?.bundle_id : entry?.id));
    if (entries.length > 40) {
        throw new Error(`Invalid ${kind} inventory from Specify`);
    }
    const seen = new Set();
    return entries.map((entry) => {
        const id = kind === "bundles" ? entry?.bundle_id : entry?.id;
        if (typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(id)
            || typeof entry.version !== "string"
            || !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/.test(entry.version)
            || (kind !== "bundles" && !Number.isSafeInteger(entry.priority))
            || seen.has(id)) {
            throw new Error(`Invalid ${kind} package identity or version from Specify`);
        }
        seen.add(id);
        return { id, version: entry.version,
            ...(kind === "bundles" ? {} : { priority: entry.priority }) };
    });
}
