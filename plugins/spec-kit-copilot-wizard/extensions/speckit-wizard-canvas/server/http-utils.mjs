// Low-level HTTP helpers: constants, request-body parser, token extraction,
// constant-time token compare, and JSON/error/static-file response writers.

import { timingSafeEqual } from "node:crypto";
import { isAbsolute, relative as pathRelative, resolve as pathResolve } from "node:path";

export const BODY_CAP = 256 * 1024;
export const MAX_ARTIFACT_BYTES = 512 * 1024;

export const CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
};

export function send(res, code, body, type = "text/plain; charset=utf-8") {
    if (res.headersSent) {
        try { res.end(); } catch { /* ignore */ }
        return;
    }
    res.writeHead(code, { "Content-Type": type });
    res.end(body);
}
export function jsonRes(res, code, obj) {
    send(res, code, JSON.stringify(obj), "application/json; charset=utf-8");
}
export function jsonError(res, code, message, extra = {}) {
    jsonRes(res, code, { error: message, ...extra });
}

// Resolve a workspace-relative path with sandbox + missing-cwd checks. Writes
// the JSON error response and returns null on failure (400 no cwd, 403
// outside workspace), or the absolute safe path on success. Concentrates the
// path-traversal security seam that all workspace-file endpoints must share.
export function resolveWorkspacePath(res, cwd, relPath) {
    if (!cwd) {
        jsonError(res, 400, "workspace path unavailable");
        return null;
    }
    // Reject absolute inputs outright — path.resolve would return them
    // verbatim, escaping the workspace even before the boundary check.
    if (typeof relPath !== "string" || isAbsolute(relPath)) {
        jsonError(res, 403, "outside workspace");
        return null;
    }
    const safe = pathResolve(cwd, relPath);
    if (!isInside(cwd, safe)) {
        jsonError(res, 403, "outside workspace");
        return null;
    }
    return safe;
}

// isInside returns true when `child` is `parent` or a descendant of it. Uses
// path.relative (OS-agnostic — handles Windows drive letters and separators)
// so a sibling directory whose name shares `parent`'s prefix does NOT pass,
// unlike a plain `startsWith`.
export function isInside(parent, child) {
    if (!parent || !child) return false;
    const rel = pathRelative(parent, child);
    if (rel === "") return true;
    if (rel.startsWith("..")) return false;
    if (isAbsolute(rel)) return false; // different drive on Windows
    return true;
}
// Constant-time comparison. Rejects mismatched lengths without leaking the
// token length via early return.
export function tokensMatch(provided, expected) {
    if (typeof provided !== "string" || typeof expected !== "string") return false;
    const a = Buffer.from(provided, "utf8");
    const b = Buffer.from(expected, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
}

export async function readBody(req) {
    let received = 0;
    const chunks = [];
    for await (const c of req) {
        received += c.length;
        if (received > BODY_CAP) {
            const err = new Error("body too large");
            err.code = "BODY_TOO_LARGE";
            throw err;
        }
        chunks.push(c);
    }
    const text = Buffer.concat(chunks).toString("utf8");
    if (!text) return {};
    try {
        return JSON.parse(text);
    } catch (err) {
        const e = new Error(`invalid JSON body: ${err.message}`);
        e.code = "BAD_JSON";
        throw e;
    }
}

export function extractToken(url, req) {
    const q = url.searchParams.get("token");
    if (q) return q;
    const h = req.headers["x-canvas-token"];
    if (typeof h === "string") return h;
    if (Array.isArray(h) && h.length) return h[0];
    const cookie = req.headers["cookie"];
    if (typeof cookie === "string") {
        for (const part of cookie.split(";")) {
            const [k, ...vRest] = part.trim().split("=");
            if (k === "canvas_token" && vRest.length) {
                return decodeURIComponent(vRest.join("="));
            }
        }
    }
    return null;
}

export async function serveFile(res, path, type, fs) {
    try {
        const data = await fs.readFile(path);
        res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
        res.end(data);
    } catch {
        return send(res, 404, "not found");
    }
}
