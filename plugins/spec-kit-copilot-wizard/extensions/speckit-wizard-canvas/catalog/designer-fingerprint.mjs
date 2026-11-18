import { createHash } from "node:crypto";

export function designerCatalogFingerprint(catalog) {
    const rows = ["presets", "extensions", "bundles"].flatMap((kind) =>
        (catalog?.[kind] ?? []).filter((item) =>
            item?.id && (item.active === true
                || (Array.isArray(item.tags) && item.tags.includes("canvas-design")
                    && (["community", "copilot"].includes(item.source)
                        || (kind === "bundles" && item.source === "default")))))
            .map((item) => [kind, item.id, item.installedId ?? item.id, item.source,
                item.version ?? null, item.downloadUrl ?? null,
                item.bundleYml ?? null, item.installAllowed !== false]));
    rows.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}
