#!/usr/bin/env node
// speckit-wizard — composition extraction script.
//
// Scrapes composition metadata (preset/extension manifests, hooks, on-disk
// scripts, resolved templates) that the `specify` CLI does not yet expose
// as structured JSON. Once the CLI grows equivalent commands (e.g.
// `specify composition list --json`), this whole file goes away and the
// scanner calls those commands directly.
//
// GOVERNING RULES:
//   1. NEVER duplicates functionality any `speckit-*` skill already exposes.
//      The agent invokes `speckit-preset` / `speckit-extension` for CLI-level
//      metadata (list, info, priorities, enabled flags); this script only
//      fills gaps no skill covers.
//   2. NEVER writes into `.specify/` — that folder is Spec Kit's contract with
//      the project. All outputs go to stdout (JSON).
//   3. OS-agnostic across Windows, macOS, Linux — no shell metacharacters
//      (execFileSync with `shell: true` only on Windows, where `specify`
//      may ship as `.cmd`/`.bat` and Node ≥ 20.12.2 refuses to spawn those
//      without a shell), all paths via `node:path`, globs via
//      `fs.readdirSync({ recursive: true })`, `\r?\n` line splits.
//
// USAGE:
//   node collect.mjs [<workspace-root>]
//   Optional stdin JSON: { presets: [{id,...}], extensions: [{id,...}] }
//     — installed-list hint from the agent's earlier skill invocations.
//       Skipped when absent; the script falls back to enumerating
//       `.specify/{presets,extensions}/*/` directories.
//   Writes JSON to stdout with { presetsManifest, extensionsManifest,
//   onDiskScripts, workflows, hooksMap, coreInventory, resolverResults }.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, sep as pathSep, resolve as pathResolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { platform } from "node:os";

// ---- js-yaml (deferred import, mirrors preset-loader.mjs pattern) ----------
// Same reason as preset-loader.mjs: the `specify` CLI list commands don't
// return the full parsed manifest for presets/extensions/bundles, so we
// fetch and parse the raw .yml files ourselves — which needs a YAML parser.
let _yamlPromise = null;
async function getYaml() {
    if (!_yamlPromise) {
        _yamlPromise = import("js-yaml").then(
            (m) => {
                const mod = m.default ?? m;
                // Safe schema — reject custom JS-eval tags in untrusted YAML.
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

// ---- OS-agnostic helpers ---------------------------------------------------
const IS_CASE_INSENSITIVE_FS = platform() === "win32" || platform() === "darwin";
function pathsEqual(a, b) {
    if (!a || !b) return false;
    return IS_CASE_INSENSITIVE_FS ? a.toLowerCase() === b.toLowerCase() : a === b;
}
function splitLines(str) {
    return String(str ?? "").split(/\r?\n/);
}
function repoRelative(root, absPath) {
    if (!absPath) return absPath;
    const rel = absPath.startsWith(root) ? absPath.slice(root.length) : absPath;
    return rel.replace(/^[\\/]+/, "").split(pathSep).join("/");
}
function safeReadFile(path) {
    try { return readFileSync(path, "utf8"); } catch { return null; }
}
function safeReadDir(path) {
    try { return readdirSync(path, { withFileTypes: true }); } catch { return []; }
}

// ---- Manifest readers ------------------------------------------------------
async function readPresetManifest(root, id) {
    const yaml = await getYaml();
    const manifestPath = join(root, ".specify", "presets", id, "preset.yml");
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
        author: doc.author ?? null,
        priority: typeof doc.priority === "number" ? doc.priority : null,
        repository: doc.repository ?? null,
        homepage: doc.homepage ?? null,
        provides: doc.provides ?? {},
        entriesByKind: parseProvidesEntries(doc.provides, root, join(root, ".specify", "presets", id)),
        raw: doc,
    };
}

async function readExtensionManifest(root, id) {
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
        author: doc.author ?? null,
        priority: typeof doc.priority === "number" ? doc.priority : null,
        category: doc.category ?? null,
        effect: doc.effect ?? null,
        repository: doc.repository ?? null,
        homepage: doc.homepage ?? null,
        provides: doc.provides ?? {},
        entriesByKind: parseProvidesEntries(doc.provides, root, join(root, ".specify", "extensions", id)),
        hooks: parseHookDeclarations(doc.hooks),
        raw: doc,
    };
}

function parseProvidesEntries(provides, root, baseDir) {
    const out = { command: [], template: [], script: [] };
    if (!provides || typeof provides !== "object") return out;
    const inferStrategy = (entry) => {
        if (!entry || typeof entry !== "object") return "replace";
        // Explicit `strategy:` field wins over the shorthand keys — a preset
        // that writes `replaces: X` + `strategy: prepend` (see the
        // `copilot-sub-agents` preset) means "prepend before X", NOT "replace
        // X". Only fall back to shorthand-key inference when no explicit
        // strategy is declared.
        const explicit = entry.strategy;
        if (typeof explicit === "string") {
            const norm = explicit.toLowerCase();
            if (norm === "replace" || norm === "wrap" || norm === "prepend" || norm === "append") {
                return norm;
            }
        }
        if (typeof entry.replaces === "string") return "replace";
        if (typeof entry.wraps === "string") return "wrap";
        if (typeof entry.prepends === "string") return "prepend";
        if (typeof entry.appends === "string") return "append";
        return "replace";
    };
    const normalize = (entry, fallbackKind) => {
        if (!entry || typeof entry !== "object") return null;
        const kind = entry.type ?? fallbackKind;
        if (!kind || !(kind in out)) return null;
        const source = entry.source ?? entry.path ?? entry.file ?? null;
        const sourcePath = source && baseDir
            ? repoRelative(root, pathResolve(baseDir, source))
            : source;
        return {
            name: entry.name ?? entry.replaces ?? entry.wraps ?? entry.prepends ?? entry.appends ?? null,
            description: entry.description ?? "",
            sourcePath,
            strategy: inferStrategy(entry),
            replaces: entry.replaces ?? null,
            wraps: entry.wraps ?? null,
            prepends: entry.prepends ?? null,
            appends: entry.appends ?? null,
            raw: entry,
        };
    };
    for (const kind of ["command", "template", "script"]) {
        const list = provides[`${kind}s`];
        if (!Array.isArray(list)) continue;
        for (const entry of list) {
            const targetKind = entry?.type ?? kind;
            if (!(targetKind in out)) continue;
            const norm = normalize(entry, targetKind);
            if (norm && norm.name) out[targetKind].push(norm);
        }
    }
    return out;
}

function parseHookDeclarations(hooks) {
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

async function readHooksMap(root) {
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

// ---- Filesystem enumeration ------------------------------------------------
function globOnDiskScripts(root, layerKind, id) {
    const scriptsDir = join(root, ".specify", `${layerKind}s`, id, "scripts");
    if (!existsSync(scriptsDir)) return [];
    const byBareId = new Map();
    for (const runtime of ["bash", "powershell", "python"]) {
        const runtimeDir = join(scriptsDir, runtime);
        if (!existsSync(runtimeDir)) continue;
        for (const dirent of safeReadDir(runtimeDir)) {
            if (!dirent.isFile()) continue;
            const filename = dirent.name;
            const withoutExt = filename.replace(/\.(sh|ps1|py)$/i, "");
            const bareId = withoutExt.replace(/_/g, "-").toLowerCase();
            const absPath = join(runtimeDir, filename);
            const sourcePath = repoRelative(root, absPath);
            const existing = byBareId.get(bareId);
            if (existing) {
                if (!existing.runtimes.includes(runtime)) existing.runtimes.push(runtime);
                if (runtime === "powershell") existing.sourcePath = sourcePath;
                else if (runtime === "bash" && !existing.sourcePath.endsWith(".ps1")) existing.sourcePath = sourcePath;
            } else {
                byBareId.set(bareId, { bareId, sourcePath, runtimes: [runtime] });
            }
        }
    }
    return [...byBareId.values()];
}

function globWorkflows(root, layerKind, id) {
    const dir = join(root, ".specify", `${layerKind}s`, id, "workflows");
    if (!existsSync(dir)) return [];
    const out = [];
    for (const dirent of safeReadDir(dir)) {
        if (!dirent.isFile()) continue;
        if (!dirent.name.endsWith(".workflow.yml")) continue;
        out.push(repoRelative(root, join(dir, dirent.name)));
    }
    return out;
}

function enumerateInstalled(root, layerKind) {
    const dir = join(root, ".specify", `${layerKind}s`);
    if (!existsSync(dir)) return [];
    return safeReadDir(dir)
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .filter((id) => id !== "core");
}

// ---- Core inventory --------------------------------------------------------
async function loadCoreInventory() {
    const thisFile = fileURLToPath(import.meta.url);
    const inventoryPath = pathResolve(dirname(thisFile), "..", "pipeline", "canonical.mjs");
    try {
        const url = pathToFileURL(inventoryPath).href;
        const mod = await import(url);
        return {
            command: [...(mod.CORE_COMMANDS ?? [])],
            template: [...(mod.CORE_TEMPLATES ?? [])],
            script: [...(mod.CORE_SCRIPTS ?? [])],
        };
    } catch {
        return { command: [], template: [], script: [] };
    }
}

// ---- Template resolver batch -----------------------------------------------
function batchResolveTemplates(root, templateIds) {
    const out = {};
    for (const id of templateIds) {
        try {
            const stdout = execFileSync("specify", ["preset", "resolve", id], {
                cwd: root,
                encoding: "utf8",
                stdio: ["ignore", "pipe", "pipe"],
                // Windows may ship `specify` as `.cmd`/`.bat` (uv tool /
                // pipx layouts). Node ≥ 20.12.2 refuses to spawn those
                // without a shell (EINVAL / CVE-2024-27980). Route through
                // cmd.exe on Windows only; POSIX stays direct-exec for
                // safety and speed.
                shell: process.platform === "win32",
                timeout: 15_000,
            });
            const lines = splitLines(stdout).filter(Boolean);
            const path = lines.find((l) => !l.startsWith(" ") && !l.includes(":")) ?? null;
            const layerLine = lines.find((l) => /top layer/i.test(l));
            const layer = layerLine ? layerLine.replace(/^[^:]*:/i, "").trim() : null;
            out[id] = { path, layer };
        } catch {
            out[id] = null;
        }
    }
    return out;
}

// ---- stdin ingestion -------------------------------------------------------
function readStdinJson() {
    try {
        const raw = readFileSync(0, "utf8");
        if (!raw.trim()) return null;
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

// ---- Main ------------------------------------------------------------------
async function main() {
    const workspaceRoot = process.argv[2]
        ? pathResolve(process.argv[2])
        : pathResolve(process.cwd());
    const hint = readStdinJson();

    const presetIds = Array.isArray(hint?.presets)
        ? hint.presets.map((p) => p.id).filter(Boolean)
        : enumerateInstalled(workspaceRoot, "preset");
    const extensionIds = Array.isArray(hint?.extensions)
        ? hint.extensions.map((e) => e.id).filter(Boolean)
        : enumerateInstalled(workspaceRoot, "extension");

    const presetsManifest = {};
    const extensionsManifest = {};
    const onDiskScripts = { presets: {}, extensions: {} };
    const workflows = { presets: {}, extensions: {} };

    for (const id of presetIds) {
        const manifest = await readPresetManifest(workspaceRoot, id);
        if (manifest) presetsManifest[id] = manifest;
        onDiskScripts.presets[id] = globOnDiskScripts(workspaceRoot, "preset", id);
        workflows.presets[id] = globWorkflows(workspaceRoot, "preset", id);
    }
    for (const id of extensionIds) {
        const manifest = await readExtensionManifest(workspaceRoot, id);
        if (manifest) extensionsManifest[id] = manifest;
        onDiskScripts.extensions[id] = globOnDiskScripts(workspaceRoot, "extension", id);
        workflows.extensions[id] = globWorkflows(workspaceRoot, "extension", id);
    }

    const hooksMap = await readHooksMap(workspaceRoot);
    const coreInventory = await loadCoreInventory();

    const templateIds = new Set(coreInventory.template);
    for (const m of Object.values(presetsManifest)) {
        for (const entry of m.entriesByKind?.template ?? []) {
            if (entry.name) templateIds.add(entry.name);
        }
    }
    const resolverResults = batchResolveTemplates(workspaceRoot, [...templateIds]);

    const output = {
        presetsManifest,
        extensionsManifest,
        onDiskScripts,
        workflows,
        hooksMap,
        coreInventory,
        resolverResults,
    };

    process.stdout.write(JSON.stringify(output, null, 2));
}

const invokedDirectly = (() => {
    try {
        const thisFile = fileURLToPath(import.meta.url);
        return process.argv[1] && pathsEqual(pathResolve(process.argv[1]), thisFile);
    } catch {
        return false;
    }
})();
if (invokedDirectly) {
    main().catch((err) => {
        process.stderr.write(`collect: ${err?.stack ?? err}\n`);
        process.exit(1);
    });
}

export {
    readPresetManifest,
    readExtensionManifest,
    parseProvidesEntries,
    parseHookDeclarations,
    readHooksMap,
    globOnDiskScripts,
    globWorkflows,
    enumerateInstalled,
    loadCoreInventory,
    batchResolveTemplates,
    pathsEqual,
    repoRelative,
    splitLines,
    IS_CASE_INSENSITIVE_FS,
};
