// speckit-wizard — markdown artifact reader.
//
// Extracted from scanner.mjs. Reads a markdown file with a size bound,
// returning `{ path, marker, preview, truncated }` or null. Also parses
// the optional `<!-- speckit:<phase> v<n> -->` marker on the first line.

import { join } from "node:path";
import { MAX_FILE_BYTES, MAX_MARKDOWN_PREVIEW } from "./fs-helpers.mjs";

// Reads a markdown artifact with a size bound; returns { path, marker, preview } or null.
export async function readMarkdownArtifact(cwd, relPath, deps) {
    const path = join(cwd, relPath);
    if (!(await deps.pathExists(path))) return null;
    let st;
    try {
        st = await deps.stat(path);
    } catch {
        return null;
    }
    if (st?.size && st.size > MAX_FILE_BYTES) {
        try {
            const partial = await deps.readFile(path, "utf8");
            const truncated = partial.slice(0, MAX_MARKDOWN_PREVIEW);
            return {
                path: relPath,
                marker: extractMarker(truncated),
                preview: truncated,
                truncated: true,
            };
        } catch {
            return null;
        }
    }
    try {
        const text = await deps.readFile(path, "utf8");
        return {
            path: relPath,
            marker: extractMarker(text),
            preview: text.slice(0, MAX_MARKDOWN_PREVIEW),
            truncated: text.length > MAX_MARKDOWN_PREVIEW,
        };
    } catch {
        return null;
    }
}

export function extractMarker(text) {
    const firstLine = String(text ?? "").split("\n", 1)[0] ?? "";
    const m = firstLine.match(/<!--\s*speckit:([a-z0-9_-]+)\s+v(\d+)\s*-->/i);
    if (!m) return null;
    return { phase: m[1], version: Number(m[2]) };
}
