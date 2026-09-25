import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import * as yaml from "js-yaml";

const DESIGN = "canvas-design";
const KINDS = new Set(["preset", "extension", "bundle"]);

function manifestTags(document, kind, id, location) {
    const tags = document?.tags;
    if (!document || typeof document !== "object" || Array.isArray(document)
        || document[kind]?.id !== id
        || !Array.isArray(tags) || tags.some((tag) => typeof tag !== "string")) {
        throw new Error(`Invalid ${location} ${kind} manifest tags: ${id}`);
    }
    return tags;
}

async function loadAvailableManifest(url, kind, id, fetcher) {
    if (!KINDS.has(kind) || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)
        || typeof url !== "string" || !url.startsWith("https://")) {
        throw new Error(`No verifiable available ${kind} manifest: ${id}`);
    }
    const response = await fetcher(url);
    if (!response.ok) throw new Error(`Available ${kind} manifest unavailable: ${id} (HTTP ${response.status})`);
    const text = await response.text();
    if (text.length > 128 * 1024) throw new Error(`Available ${kind} manifest too large: ${id}`);
    const document = yaml.load(text, { schema: yaml.JSON_SCHEMA });
    manifestTags(document, kind, id, "available");
    return document;
}

export async function availableManifestTags(url, kind, id, fetcher = fetch) {
    return (await loadAvailableManifest(url, kind, id, fetcher)).tags;
}

export async function availableBundleMembers(url, id, fetcher = fetch) {
    const document = await loadAvailableManifest(url, "bundle", id, fetcher);
    const provides = document.provides;
    if (!provides || typeof provides !== "object" || Array.isArray(provides)
        || Object.keys(provides).some((kind) => !["presets", "extensions"].includes(kind))) {
        throw new Error(`Bundle has non-design or unverifiable members: ${id}`);
    }
    const members = [];
    for (const kind of ["presets", "extensions"]) {
        const entries = provides[kind] ?? [];
        if (!Array.isArray(entries)) throw new Error(`Invalid bundle members: ${id}`);
        for (const entry of entries) {
            if (!entry || typeof entry.id !== "string") throw new Error(`Invalid bundle member: ${id}`);
            members.push({ kind: kind.slice(0, -1), id: entry.id });
        }
    }
    if (!members.length) throw new Error(`Bundle has no members: ${id}`);
    return members;
}

export async function installedManifestTags(workspace, kind, id) {
    if (!KINDS.has(kind) || typeof id !== "string"
        || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
        throw new TypeError("Invalid installed package identity");
    }
    let directory = workspace;
    for (const part of [".specify", `${kind}s`, id]) {
        directory = join(directory, part);
        const stat = await lstat(directory);
        if (!stat.isDirectory() || stat.isSymbolicLink()) {
            throw new Error(`Unsafe installed ${kind} directory: ${id}`);
        }
    }
    const file = join(directory, `${kind}.yml`);
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 128 * 1024) {
        throw new Error(`Unsafe installed ${kind} manifest: ${id}`);
    }
    return manifestTags(yaml.load(await readFile(file, "utf8"), { schema: yaml.JSON_SCHEMA }),
        kind, id, "installed");
}

export function classifyDesignItem(item, selectedCommands = [], artifacts = []) {
    const catalogTagged = item.source === "local" && item.active
        ? item.installedTags?.includes(DESIGN) === true
        : item.tags?.includes(DESIGN) === true && item.availableTags?.includes(DESIGN) === true;
    const installedTagged = item.active ? item.installedTags?.includes(DESIGN) === true : null;
    const mismatch = item.active && item.source !== "local"
        && item.tags?.includes(DESIGN) !== installedTagged;
    const contributor = item.active && selectedCommands.some((command) =>
        artifacts.some((artifact) => artifact.kind === "command"
            && (artifact.name === command || artifact.id === `commands/${command}`)
            && artifact.stack?.some((layer) =>
                (layer.sourceId ?? layer.presetId) === item.installedId
                && layer.layer === item.kind && layer.active)));
    return {
        ...item,
        design: catalogTagged && !item.tagError && !mismatch && !contributor,
        designError: item.tagError ?? (mismatch
            ? `Catalog and installed ${item.kind} tags disagree for ${item.id}.`
            : contributor ? `${item.id} contributes to a selected phase command.` : null),
        excludedFromRuntime: item.tags?.includes(DESIGN) === true || installedTagged === true,
    };
}

export function validateDesignBundle(bundle, catalog) {
    if (!bundle.design) return bundle;
    if (!Array.isArray(bundle.members) || !bundle.members.length) {
        return { ...bundle, design: false, designError: "Bundle has no verifiable design-only members." };
    }
    if (!Array.isArray(bundle.manifestMembers)
        || bundle.members.length !== bundle.manifestMembers.length
        || bundle.members.some((member) => !bundle.manifestMembers.some((actual) =>
            actual.kind === member.kind && actual.id === member.id))) {
        return { ...bundle, design: false, designError: "Bundle catalog and available manifest members disagree." };
    }
    for (const member of bundle.members) {
        const entries = member.kind === "preset" ? catalog.presets
            : member.kind === "extension" ? catalog.extensions : null;
        const candidate = entries?.find((entry) => entry.id === member.id
            || entry.installedId === member.id);
        if (!member.tags?.includes(DESIGN) || !candidate?.design
            || bundle.active && (!candidate.active || !candidate.installedTags?.includes(DESIGN))) {
            return {
                ...bundle, design: false,
                designError: `Bundle member ${member.kind ?? "unknown"} ${member.id ?? "unknown"} is missing or not verified as design-only.`,
            };
        }
    }
    return bundle;
}
