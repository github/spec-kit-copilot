export function isRuntimeCatalogItem(item) {
    return item?.excludedFromRuntime !== true
        && !item?.tags?.includes("canvas-design")
        && !item?.installedTags?.includes("canvas-design");
}

export async function sendDesignMutation(kind, entry, dispatch) {
    if (!["preset", "extension", "bundle"].includes(kind) || entry?.design !== true
        || typeof entry.id !== "string" || typeof dispatch !== "function") {
        throw new Error("Canvas Design package is not eligible for this operation.");
    }
    const action = entry.active ? "remove" : "install";
    const payload = {
        name: entry.active ? entry.installedId ?? entry.id : entry.id,
        ...(action === "install" ? { downloadUrl: entry.downloadUrl ?? null } : {}),
        ...(action === "install" ? { design: true } : {}),
        ...(kind === "bundle" && action === "install"
            ? { bundleYml: entry.bundleYml ?? null } : {}),
    };
    const response = await dispatch(`${kind}.${action}`, payload);
    if (!response?.queued) throw new Error(`Could not queue ${kind} ${action}.`);
}
