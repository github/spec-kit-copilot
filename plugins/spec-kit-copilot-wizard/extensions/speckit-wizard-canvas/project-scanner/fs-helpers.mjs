// speckit-wizard — small FS helpers shared by scanner submodules.
//
// Extracted from scanner.mjs. All functions take `deps` explicitly (no closure
// capture). Kept together because they're mutually referenced (pickNewestSubdir
// uses safeReaddir; the extension-artifacts hydrator uses everything here).

import { isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { PHASE_ORDER, emptyPhaseSlice } from "../canvas-runtime/wizard-phases.mjs";

// Normalize path separators to forward slashes so state.json is portable
// across Windows and POSIX and so scanner output is stable in tests.
export const toPortable = (p) => (typeof p === "string" ? p.split(sep).join("/") : p);

export const canonicalizePath = (p) => /^[\\/](?![\\/])/.test(p) ? normalize(p) : resolve(p);

export function isPathContained(root, candidate) {
    const rel = relative(root, candidate);
    return !rel || !(rel === ".." || rel.startsWith("../") || rel.startsWith("..\\") || isAbsolute(rel));
}

export async function securePathWithin(candidatePath, rootPath, cwd, deps) {
    const resolvedRoot = canonicalizePath(rootPath);
    const resolvedCandidate = canonicalizePath(candidatePath);
    if (!isPathContained(resolvedRoot, resolvedCandidate)) return null;
    if (!deps.realpath) return resolvedCandidate;

    const realpathOrNull = async (p) => {
        try {
            return canonicalizePath(await deps.realpath(p));
        } catch {
            return null;
        }
    };

    const [realCwd, realRoot, realCandidate] = await Promise.all([
        realpathOrNull(cwd),
        realpathOrNull(resolvedRoot),
        realpathOrNull(resolvedCandidate),
    ]);
    if (!realCwd || !realRoot || !realCandidate) return null;
    if (!isPathContained(realCwd, realRoot)) return null;
    if (!isPathContained(realRoot, realCandidate)) return null;
    return realCandidate;
}

export const SKIP_DIRS = new Set([
    "node_modules",
    ".git",
    ".hg",
    ".svn",
    ".venv",
    "venv",
    "dist",
    "build",
    "target",
    "out",
    ".next",
    ".turbo",
    ".cache",
    "coverage",
]);

export const MAX_FILE_BYTES = 512 * 1024; // 512 KB safety cap on any single read
export const MAX_MARKDOWN_PREVIEW = 8 * 1024; // 8 KB preview to keep state light

export function emptyPhases() {
    const out = {};
    for (const id of PHASE_ORDER) out[id] = emptyPhaseSlice(id);
    return out;
}

export async function safeReaddir(path, deps) {
    return deps.readdir(path, { withFileTypes: true });
}

// Pick the most-recently-modified subdirectory under `root`. Returns
// `{ path, name, mtimeMs }` or null when nothing usable is found. Shared
// by two callers with the same "auto-select the active slug" semantics:
//   • the top-level specs/ scan that resolves the spec-kit feature slug,
//   • the extension artifact resolver that resolves per-run slugs like
//     `.specify/assessments/<slug>/`.
// Silent on I/O failure — returns null and lets the caller fall back.
export async function pickNewestSubdir(root, deps) {
    const entries = await safeReaddir(root, deps).catch(() => []);
    const candidates = [];
    for (const e of entries) {
        if (!e?.isDirectory?.()) continue;
        if (SKIP_DIRS.has(e.name)) continue;
        const p = join(root, e.name);
        const st = await deps.stat(p).catch(() => null);
        if (st) candidates.push({ path: p, name: e.name, mtimeMs: st.mtimeMs ?? 0 });
    }
    candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return candidates[0] ?? null;
}

export async function readBoundedJson(path, deps) {
    try {
        const st = await deps.stat(path);
        if (st?.size && st.size > MAX_FILE_BYTES) return null;
    } catch {
        return null;
    }
    try {
        const text = await deps.readFile(path, "utf8");
        if (!text || text.length > MAX_FILE_BYTES) return null;
        return JSON.parse(text);
    } catch {
        return null;
    }
}
