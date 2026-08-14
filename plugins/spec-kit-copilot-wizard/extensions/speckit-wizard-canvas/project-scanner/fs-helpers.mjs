// speckit-wizard — small FS helpers shared by scanner submodules.
//
// Extracted from scanner.mjs. All functions take `deps` explicitly (no closure
// capture). Kept together because they're mutually referenced (pickNewestSubdir
// uses safeReaddir; the extension-artifacts hydrator uses everything here).
// Also owns the scanner's shared constants (path normalization, size caps,
// placeholder-token regex) since every scanner submodule pulls at least one
// of these through this file.

import { join, sep } from "node:path";
import { PHASE_ORDER, emptyPhaseSlice } from "../canvas-runtime/wizard-phases.mjs";

// Normalize path separators to forward slashes so state.json is portable
// across Windows and POSIX and so scanner output is stable in tests.
export const toPortable = (p) => (typeof p === "string" ? p.split(sep).join("/") : p);

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

// Regex matching template placeholder tokens like [PROJECT_NAME] or
// [PRINCIPLE_1_DESCRIPTION]. Deliberately narrow: only UPPER_SNAKE inside
// square brackets so it never matches [NEEDS CLARIFICATION: …] (has spaces
// and a colon) or ordinary prose like [link text].
export const PLACEHOLDER_TOKEN_RE = /\[[A-Z][A-Z0-9_]*\]/g;

// Strip HTML comment blocks (`<!-- … -->`) before running placeholder
// detection. The constitution SKILL prescribes a "Sync Impact Report" at
// the top of `constitution.md` written inside an HTML comment. Its whole
// purpose is to record replacements like
//     - [PRINCIPLE_1_NAME] → I. Clarity Over Cleverness
// which contain literal bracket tokens as breadcrumbs — they are NOT
// unfilled placeholders in the rendered content. Without this strip the
// scanner would false-positive-downgrade the phase from `done` to `empty`
// on every re-scan and the phase card would refuse to show
// View + Rerun. `[sg]` on the regex handles multi-line comments and is
// safe on preview slices (a truncated comment just leaves stray brackets,
// which the two-distinct-token threshold already tolerates).
export const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;

export function emptyPhases() {
    const out = {};
    for (const id of PHASE_ORDER) out[id] = emptyPhaseSlice(id);
    return out;
}

export async function safeReaddir(path, deps) {
    return deps.readdir(path, { withFileTypes: true });
}

// Read up to MAX_MARKDOWN_PREVIEW bytes of a markdown artifact and decide
// whether it still looks like the raw scaffolded template (unfilled
// placeholder tokens). Two or more distinct tokens is the threshold — a
// single stray uppercase token could be legitimate content.
export async function looksLikeUnfilledTemplate(path, deps) {
    try {
        const text = await deps.readFile(path, "utf8");
        const preview = text.length > MAX_MARKDOWN_PREVIEW ? text.slice(0, MAX_MARKDOWN_PREVIEW) : text;
        const stripped = preview.replace(HTML_COMMENT_RE, "");
        const matches = stripped.match(PLACEHOLDER_TOKEN_RE);
        if (!matches) return false;
        const distinct = new Set(matches);
        return distinct.size >= 2;
    } catch {
        return false;
    }
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
