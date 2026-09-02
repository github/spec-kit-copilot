// speckit-wizard — hook-metadata extraction.
//
// The `specify artifact` CLI doesn't emit hook metadata — hook attribution
// is a wizard concern. This module reads extension manifests and
// `.specify/extensions.yml` directly to feed the hook enrichment step in
// composition/artifact-cli.mjs.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, sep as pathSep, resolve as pathResolve } from "node:path";
import { platform } from "node:os";

const IS_CASE_INSENSITIVE_FS = platform() === "win32" || platform() === "darwin";

let _yamlPromise = null;
async function getYaml() {
    if (!_yamlPromise) {
        _yamlPromise = import("js-yaml").then(
            (m) => {
                const mod = m.default ?? m;
                const schema = mod.JSON_SCHEMA ?? mod.FAILSAFE_SCHEMA;
                return {
                    ...mod,
                    load: (raw, opts = {}) => mod.load(raw, { schema, ...opts }),
                };
            },
            (err) => {
                _yamlPromise = null;
                throw err;
            },
        );
    }
    return _yamlPromise;
}

function safeReadFile(path) {
    try { return readFileSync(path, "utf8"); } catch { return null; }
}

function safeReadDir(path) {
    try { return readdirSync(path, { withFileTypes: true }); } catch { return []; }
}

function repoRelative(root, absPath) {
    if (!absPath) return absPath;
    const rel = absPath.startsWith(root) ? absPath.slice(root.length) : absPath;
    return rel.replace(/^[\\/]+/, "").split(pathSep).join("/");
}

/**
 * Read one extension manifest at .specify/extensions/<id>/extension.yml.
 * Returns null on missing file, `{ id, error }` on parse failure, else the
 * parsed manifest with `hooks` normalized.
 */
export async function readExtensionManifest(root, id) {
    const yaml = await getYaml();
    const manifestPath = join(root, ".specify", "extensions", id, "extension.yml");
    const raw = safeReadFile(manifestPath);
    if (!raw) return null;
    let doc;
    try { doc = yaml.load(raw); } catch { return { id, error: "yaml-parse" }; }
    if (!doc || typeof doc !== "object") return { id, error: "empty" };
    return {
        id,
        manifestPath: repoRelative(root, manifestPath),
        name: doc.name ?? id,
        description: doc.description ?? "",
        version: doc.version ?? null,
        priority: typeof doc.priority === "number" ? doc.priority : null,
        category: doc.category ?? null,
        effect: doc.effect ?? null,
        hooks: parseHookDeclarations(doc.hooks),
        raw: doc,
    };
}

/**
 * Read `.specify/extensions.yml` and return the flattened per-phase hook
 * bindings — used to compute the `registered` flag on inline hook chips.
 */
export async function readHooksMap(root) {
    const yaml = await getYaml();
    const path = join(root, ".specify", "extensions.yml");
    const raw = safeReadFile(path);
    if (!raw) return null;
    let doc;
    try { doc = yaml.load(raw); } catch { return null; }
    if (!doc || typeof doc !== "object" || !doc.hooks || typeof doc.hooks !== "object") return null;
    const out = {};
    for (const [phase, bindings] of Object.entries(doc.hooks)) {
        if (!Array.isArray(bindings)) continue;
        out[phase] = bindings.map((b) => {
            if (typeof b === "string") return { extension: b, command: null, optional: false, description: "" };
            if (b && typeof b === "object") {
                return {
                    extension: b.extension ?? null,
                    command: b.command ?? null,
                    optional: !!b.optional,
                    description: b.description ?? "",
                };
            }
            return null;
        }).filter(Boolean);
    }
    return out;
}

/**
 * Normalize an extension manifest's `hooks` field. Accepts either the
 * array form (`[{ phase, command, ... }]`) or the object form
 * (`{ before_specify: { command: … } }`).
 */
export function parseHookDeclarations(hooks) {
    if (hooks && typeof hooks === "object" && !Array.isArray(hooks)) {
        hooks = Object.entries(hooks).map(([phase, cfg]) => ({
            phase,
            ...(cfg && typeof cfg === "object" ? cfg : {}),
        }));
    }
    if (!Array.isArray(hooks)) return [];
    return hooks
        .map((h) => {
            if (!h || typeof h !== "object") return null;
            return {
                phase: h.phase ?? h.trigger ?? null,
                command: h.command ?? h.targetCommand ?? null,
                optional: !!h.optional,
                priority: typeof h.priority === "number" ? h.priority : null,
                description: h.description ?? "",
                raw: h,
            };
        })
        .filter((h) => h && h.phase && h.command);
}

// Filesystem helpers re-exported for other composition modules.
export { safeReadFile, safeReadDir, repoRelative, IS_CASE_INSENSITIVE_FS, pathResolve, existsSync };
