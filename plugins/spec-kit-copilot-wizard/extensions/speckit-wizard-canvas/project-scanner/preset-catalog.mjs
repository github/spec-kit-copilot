// speckit-wizard — preset catalog scan.
//
// Extracted from scanner.mjs. Reads:
//   • The core CLI's `catalog.json` (several plausible paths) →
//     normalized preset list.
//   • `.specify/preset-catalogs.yml` written by `specify preset catalog add`
//     → configured catalog sources (parsed with line-based heuristics to
//     avoid a YAML dep).

import { join } from "node:path";
import { MAX_FILE_BYTES } from "./fs-helpers.mjs";
import { readBoundedJson } from "./fs-helpers.mjs";

export async function scanPresetCatalog(workspacePath, deps) {
    // The core spec-kit CLI writes catalog.json somewhere under .specify/.
    // Search a few plausible paths defensively — LLM output may vary.
    const CANDIDATES = [
        ".specify/catalog.json",
        ".specify/catalogs/presets.json",
        ".specify/catalog/presets.json",
    ];
    let presets = [];
    for (const rel of CANDIDATES) {
        const p = join(workspacePath, rel);
        if (!(await deps.pathExists(p))) continue;
        const raw = await readBoundedJson(p, deps);
        if (!raw) continue;
        presets = normalizePresetList(raw);
        if (presets.length) break;
    }
    // The wizard uses a hardcoded set of plugin-owned catalogs — see
    // catalog/sources.mjs. That fixed list is what the Catalogs tab
    // renders. Any user-added catalogs from `.specify/preset-catalogs.yml`
    // are still surfaced here as a passive scan for potential future use,
    // but are NOT wired into the wizard's active catalog view (third-party
    // catalogs are out of scope in the current wizard design).
    const configured = await scanPresetCatalogSources(workspacePath, deps).catch(() => []);
    const sources = configured.map((s) => ({ ...s, configured: true }));
    return { presets, sources };
}

// Parse `.specify/preset-catalogs.yml` written by `specify preset catalog add`.
// The file is small, well-formed YAML with a fixed shape, but we avoid a YAML
// dep by parsing the handful of fields we care about with line-based
// heuristics. Returns [{ name, url, priority, installAllowed, description }].
async function scanPresetCatalogSources(workspacePath, deps) {
    const p = join(workspacePath, ".specify/preset-catalogs.yml");
    if (!(await deps.pathExists(p))) return [];
    let text;
    try {
        const st = await deps.stat(p);
        if (st?.size && st.size > MAX_FILE_BYTES) return [];
        text = await deps.readFile(p, "utf8");
    } catch {
        return [];
    }
    if (typeof text !== "string" || !text.length) return [];
    const lines = text.split(/\r?\n/);
    const out = [];
    let cur = null;
    const flush = () => {
        if (cur && cur.name && cur.url) out.push(cur);
        cur = null;
    };
    for (const raw of lines) {
        const line = raw.replace(/\s+$/, "");
        if (!line || line.startsWith("#")) continue;
        const listItem = line.match(/^\s*-\s+name:\s*(.+)$/);
        if (listItem) {
            flush();
            cur = { name: unquote(listItem[1]), url: "", priority: null, installAllowed: false, description: "" };
            continue;
        }
        if (!cur) continue;
        const kv = line.match(/^\s+([a-zA-Z_]+):\s*(.+)$/);
        if (!kv) continue;
        const key = kv[1];
        const val = unquote(kv[2]);
        if (key === "url") cur.url = val;
        else if (key === "priority") cur.priority = Number.isFinite(Number(val)) ? Number(val) : null;
        else if (key === "install_allowed" || key === "installAllowed") cur.installAllowed = /^(true|yes|1)$/i.test(val);
        else if (key === "description") cur.description = val;
    }
    flush();
    return out;
}

function unquote(s) {
    if (typeof s !== "string") return "";
    const t = s.trim();
    if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
        return t.slice(1, -1);
    }
    return t;
}

export function normalizePresetList(raw) {
    const items = Array.isArray(raw)
        ? raw
        : Array.isArray(raw?.presets)
          ? raw.presets
          : Array.isArray(raw?.items)
            ? raw.items
            : [];
    const out = [];
    for (const it of items) {
        if (!it || typeof it !== "object") continue;
        const name = typeof it.name === "string" ? it.name : typeof it.id === "string" ? it.id : null;
        if (!name) continue;
        out.push({
            id: typeof it.id === "string" ? it.id : name,
            name,
            source: typeof it.source === "string" ? it.source : "catalog",
            version: typeof it.version === "string" ? it.version : null,
            active: Boolean(it.active ?? it.installed ?? false),
            description: typeof it.description === "string" ? it.description : "",
        });
    }
    return out;
}
