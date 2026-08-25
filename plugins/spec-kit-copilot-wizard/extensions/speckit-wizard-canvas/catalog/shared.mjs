// Shared catalog helper used by presets.mjs / extensions.mjs /
// bundles.mjs. Given a list of catalog source descriptors (each with a
// hardcoded URL, see catalog/sources.mjs), this fetches the catalog
// JSON directly over HTTPS and populates the wizard's cache slot with a
// flat item list for the client renderer.
//
// This module does NOT shell out to the `specify` CLI. Catalog metadata
// (name/url/description) is hardcoded in the plugin (see index.mjs) rather
// than enumerated via `specify preset catalog list`, because the wizard
// intentionally exposes only a fixed plugin-owned set of catalogs — not
// user-added third-party catalogs. Preset/extension/bundle *installation*
// still goes through the CLI (`specify preset add --from <url>`, etc.);
// only the catalog listing step is CLI-free.

import { fetchCatalogJson } from "./sources.mjs";
import { spawn } from "node:child_process";
import { buildAugmentedPath } from "../env/resolve-path.mjs";

const EMPTY_INSTALLED = Object.freeze({ ids: new Set(), names: new Set(), byName: new Map(), orderedIds: [] });

// Memoize the augmented PATH lookup. This runs on every `specify` invocation
// (list installed, etc.), so scanning SDK/uv/pipx dirs once per process is
// worth it. Matches the pattern in env/probe-cache.mjs.
let augmentedPathPromise = null;
function getAugmentedPath() {
    if (!augmentedPathPromise) augmentedPathPromise = buildAugmentedPath();
    return augmentedPathPromise;
}

/**
 * Spawn `specify <args...>` with the standard Windows-vs-POSIX shell rule
 * and stdout capture. Resolves with the captured stdout on success/error —
 * NEVER throws. On `spawn` error, resolves with `null` so callers can
 * degrade gracefully to an empty installed set.
 *
 * On Windows `specify` is a `.cmd` shim that Node's spawn can only launch
 * through cmd.exe; on macOS/Linux it's a real binary that spawn runs
 * directly. `shell: true` on Windows only.
 *
 * PATH is augmented with known SDK / uv / pipx install locations so
 * `specify` resolves even when the user's shell PATH doesn't include them.
 */
export async function specifyRun(args, cwd) {
    const augmentedPath = await getAugmentedPath();
    return new Promise((resolve) => {
        const child = spawn("specify", args, {
            cwd,
            shell: process.platform === "win32",
            windowsHide: true,
            env: { ...process.env, PATH: augmentedPath },
        });
        let stdout = "";
        child.stdout?.on("data", (d) => { stdout += String(d); });
        child.on("error", () => resolve(null));
        child.on("close", () => resolve(stdout));
    });
}

/**
 * Fetch each catalog source and populate `inst[cfg.outputField]` with a flat
 * item list ready for the wizard's client renderer.
 *
 * @param {object} inst   Wizard instance (workspacePath, broadcast, cache slot).
 * @param {Array}  sources  Catalog source descriptors: `{ name, url, installAllowed? }`.
 *                          Sources without a `url` are skipped.
 * @param {object} cfg
 * @param {string} cfg.kind         Human tag used in log messages (e.g. "preset").
 * @param {string} cfg.dataKey      Top-level key inside catalog JSON (e.g. "presets").
 * @param {string} cfg.outputField  Name of the cache slot on inst (e.g. "cachedPresetItems").
 * @param {(cwd: string) => Promise<{
 *     ids: Set<string>,
 *     names: Set<string>,
 *     byName: Map<string, string>,
 *     orderedIds?: string[]
 * }>} cfg.listInstalled  `listInstalled*` fn from the caller's module.
 * @param {(raw: object, ctx: { installedId: string|null, installed: object }) => object}
 *     [cfg.extraFields]  Optional hook returning kind-specific fields (e.g.
 *     `cliOrder` for presets/extensions, `bundleYml` for bundles). Called
 *     once per catalog entry.
 */
export async function hydrateFromCatalogSources(inst, sources, cfg) {
    const { kind, dataKey, outputField, listInstalled, extraFields } = cfg;
    if (!Array.isArray(sources) || !sources.length) {
        inst[outputField] = [];
        return;
    }
    const installed = inst.workspacePath ? await listInstalled(inst.workspacePath) : EMPTY_INSTALLED;
    // Fetch all catalog JSONs in parallel — each one is an independent
    // remote GET and sources are typically 2–3 per kind. Serial iteration
    // was the dominant per-hydrator latency on cold caches.
    const fetched = await Promise.all(
        sources.map(async (src) => {
            if (!src?.url) return { src: null, data: null };
            try {
                const data = await fetchCatalogJson(src.url);
                return { src, data };
            } catch {
                // best-effort catalog hydrate; a failing source is skipped
                return { src, data: null };
            }
        }),
    );
    const items = [];
    for (const { src, data } of fetched) {
        if (!src) continue;
        const entries = data?.[dataKey];
        if (!entries || typeof entries !== "object") continue;
        for (const [id, raw] of Object.entries(entries)) {
                const itemId = raw?.id ?? id;
                const itemName = raw?.name ?? itemId;
                const nameKey = String(itemName).toLowerCase();
                // Match by id first; fall back to display-name so catalog
                // entries whose declared id differs from the installed
                // manifest's id still show as installed (e.g. catalog `foo`
                // vs installed `foo-full-preset`).
                let installedId = null;
                if (installed.ids.has(itemId)) installedId = itemId;
                else if (installed.byName.has(nameKey)) installedId = installed.byName.get(nameKey);
                const base = {
                    id: itemId,
                    // Real installed id — used by Remove to call
                    // `specify <group> remove <installedId>` correctly.
                    installedId: installedId ?? itemId,
                    name: itemName,
                    source: src.name,
                    version: raw?.version ?? null,
                    description: raw?.description ?? "",
                    active: !!installedId,
                    downloadUrl: raw?.download_url ?? null,
                    installAllowed: src.installAllowed !== false,
                    author: raw?.author ?? null,
                    repository: raw?.repository ?? null,
                    homepage: raw?.homepage ?? null,
                    documentation: raw?.documentation ?? null,
                    license: raw?.license ?? null,
                };
                const extras = extraFields ? extraFields(raw, { installedId, installed }) : null;
                items.push(extras ? { ...base, ...extras } : base);
        }
    }
    inst[outputField] = items;
}

/**
 * Compute `cliOrder` the way presets and extensions both need: 0-based
 * position in `orderedIds` (winner-first from the CLI's own list output),
 * or `null` when the item isn't installed or the CLI didn't ship ordering.
 */
export function cliOrderFromInstalled(installedId, installed) {
    if (!installedId) return null;
    const idx = installed.orderedIds?.indexOf(installedId) ?? -1;
    return idx >= 0 ? idx : null;
}
