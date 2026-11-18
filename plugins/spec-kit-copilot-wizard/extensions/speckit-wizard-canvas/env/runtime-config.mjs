import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import defaults from "../config/runtime-defaults.json" with { type: "json" };

export const runtimeDefaults = defaults;
export const DEFAULT_SETTINGS_PATH = (home) => join(home, ".copilot", "spec-kit", "runtime-settings.json");
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function keys(value, allowed, label) {
    if (!object(value)) throw new Error(`${label} must be an object`);
    for (const key of Object.keys(value)) {
        if (!allowed.includes(key)) throw new Error(`Unknown ${label} setting: ${key}`);
    }
}

export function validateRuntimeSettings(value) {
    keys(value, ["catalogs", "copilotCatalogName", "generateCanvasEnabled"], "runtime");
    if (Object.hasOwn(value, "generateCanvasEnabled") && typeof value.generateCanvasEnabled !== "boolean") {
        throw new Error("generateCanvasEnabled must be a boolean");
    }
    if (Object.hasOwn(value, "copilotCatalogName")
        && (typeof value.copilotCatalogName !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.copilotCatalogName))) {
        throw new Error("copilotCatalogName must be a lowercase hyphenated identifier");
    }
    if (Object.hasOwn(value, "catalogs")) {
        keys(value.catalogs, Object.keys(defaults.catalogs), "catalogs");
        for (const [source, catalogs] of Object.entries(value.catalogs)) {
            keys(catalogs, Object.keys(defaults.catalogs[source]), `catalogs.${source}`);
            for (const [kind, address] of Object.entries(catalogs)) {
                let url;
                try { url = new URL(address); } catch { throw new Error(`Invalid catalog URL: ${source}.${kind}`); }
                if (typeof address !== "string" || address.length > 2048 || /[\s\x00-\x1f\x7f]/.test(address)
                    || url.protocol !== "https:" || !url.hostname || url.username || url.password || url.hash) {
                    throw new Error(`Catalog URL ${source}.${kind} must be HTTPS without credentials or fragments`);
                }
            }
        }
    }
    return structuredClone(value);
}

export async function resolveRuntimeConfig({ env = process.env, home = homedir(), read = readFile } = {}) {
    const explicit = Object.hasOwn(env, "SPECKIT_CONFIG_FILE");
    const path = explicit ? env.SPECKIT_CONFIG_FILE : DEFAULT_SETTINGS_PATH(home);
    if (typeof path !== "string" || !isAbsolute(path)) throw new Error("SPECKIT_CONFIG_FILE must be an absolute file path");
    let overrides = {};
    let selected = path;
    try {
        overrides = validateRuntimeSettings(JSON.parse(await read(path, "utf8")));
    } catch (error) {
        if (!explicit && error.code === "ENOENT") selected = null;
        else throw new Error(`Unable to load Spec Kit runtime settings at ${path}: ${error.message}`, { cause: error });
    }
    const settings = { ...structuredClone(defaults), ...overrides, catalogs: structuredClone(defaults.catalogs) };
    for (const [source, catalogs] of Object.entries(overrides.catalogs ?? {})) {
        Object.assign(settings.catalogs[source], catalogs);
    }
    return { settings, path: selected };
}
