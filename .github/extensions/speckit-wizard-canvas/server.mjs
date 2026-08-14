// speckit-wizard — HTTP router + server bootstrap.
//
// Two exports:
//   • createHandler(deps) → (req, res) → Promise<void>
//       Pure-ish handler factory: no socket bound, easy to test with mock
//       req/res objects. All side-effect surfaces are on `deps`.
//   • startServer(instanceId, deps) → Promise<{ server, url, token }>
//       Boots a 127.0.0.1 loopback server on an ephemeral port and returns
//       the URL with a per-instance secret token in the query string.
//
// Route handlers live in `./server/handlers-phase.mjs` and
// `./server/handlers-ops.mjs`; low-level HTTP helpers in
// `./server/http-utils.mjs`.
//
// Token-guarded, body-cap 256 KB, JSON errors, testable
// handler factory separate from bootstrap.

import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join, resolve as pathResolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

import {
    BODY_CAP,
    MAX_ARTIFACT_BYTES,
    CONTENT_TYPES,
    send,
    jsonRes,
    jsonError,
    tokensMatch,
    readBody,
    extractToken,
    serveFile,
    resolveWorkspacePath,
    isInside,
} from "./server/http-utils.mjs";
import {
    handlePrompt,
    handlePhaseSubmit,
} from "./server/handlers-phase.mjs";
import {
    handlePipelineMutation,
    handleArtifactTargets,
    handleSkipDefaults,
    handleSkillsReload,
    handleProbeEnv,
} from "./server/handlers-ops.mjs";
import { ensureEnvProbe } from "./env/probe-cache.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_UI_DIR = join(__dirname, "ui");
const DEFAULT_SHARED_DIR = join(__dirname, "shared");
// Root-level module folders imported by client code (e.g. ui/app.js →
// "../pipeline/canonical.mjs"). The browser resolves those to
// absolute paths like /pipeline/*, /composition/*, so the
// static router must expose them alongside /ui/*.
const SHARED_ROOT_DIRS = ["pipeline", "composition"];

// ------------------------------------------------------------------------
// deps bag:
//   session:              { send(prompt): Promise<any>, log?(msg, opts?) }
//   log(text, level?):    Promise<void>  (goes to session.log in prod)
//   getState():           Promise<snapshot>   (calls scanner + buildStateSnapshot)
//   getInstance():        InstanceRecord (per-instance mutable state)
//   broadcast(msg):       void  (sends SSE to all subscribers)
//   registerSse(req,res): void  (adds SSE client)
//   fs:                   node:fs/promises namespace (injectable for tests)
//   uiDir:                absolute path to UI files (defaults to sibling ui/)
//   token:                per-instance secret required on every request
// ------------------------------------------------------------------------
export function createHandler(deps) {
    const {
        session,
        log,
        getState,
        getInstance,
        broadcast,
        registerSse,
        fs = { readFile, stat },
        uiDir = DEFAULT_UI_DIR,
        sharedDir = DEFAULT_SHARED_DIR,
        token,
    } = deps;

    if (!token) throw new Error("createHandler requires deps.token");

    return async function handle(req, res) {
        try {
            const url = new URL(req.url, "http://127.0.0.1");
            const method = req.method ?? "GET";

            // --- Token gate. Static /ui/* + / are also guarded so a stray
            // fetch without the token can't inspect the shell. Constant-time
            // compare avoids leaking the token via response-time side channel.
            const provided = extractToken(url, req);
            if (!tokensMatch(provided, token)) {
                return jsonError(res, 401, "unauthorized");
            }

            // ---------- Static UI ----------
            if (method === "GET" && (url.pathname === "/" || url.pathname === "/ui" || url.pathname === "/ui/")) {
                // Set a session cookie so subresource requests from the iframe
                // (styles.css, app.js, /api/*, /api/events) carry the token
                // automatically. HttpOnly so page scripts can't read it;
                // SameSite=Strict so cross-origin requests can't ride it.
                res.setHeader(
                    "Set-Cookie",
                    `canvas_token=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict`,
                );
                return await serveFile(res, join(uiDir, "index.html"), "text/html; charset=utf-8", fs);
            }
            if (method === "GET" && url.pathname.startsWith("/ui/")) {
                const rel = url.pathname.slice(4).replace(/\?.*$/, "");
                const safe = pathResolve(uiDir, rel);
                if (!isInside(uiDir, safe)) return send(res, 403, "Forbidden");
                const ext = safe.slice(safe.lastIndexOf(".")).toLowerCase();
                return await serveFile(res, safe, CONTENT_TYPES[ext] ?? "application/octet-stream", fs);
            }
            if (method === "GET" && url.pathname.startsWith("/shared/")) {
                const rel = url.pathname.slice(8).replace(/\?.*$/, "");
                const safe = pathResolve(sharedDir, rel);
                if (!isInside(sharedDir, safe)) return send(res, 403, "Forbidden");
                const ext = safe.slice(safe.lastIndexOf(".")).toLowerCase();
                return await serveFile(res, safe, CONTENT_TYPES[ext] ?? "application/octet-stream", fs);
            }
            if (method === "GET") {
                // Serve root-level module folders (pipeline/, core/,
                // composition/) that the browser reaches via relative
                // imports from /ui/. Path-traversal is blocked by the
                // isInside check just like /ui/ and /shared/.
                for (const rootName of SHARED_ROOT_DIRS) {
                    const prefix = `/${rootName}/`;
                    if (!url.pathname.startsWith(prefix)) continue;
                    const rootDir = join(__dirname, rootName);
                    const rel = url.pathname.slice(prefix.length).replace(/\?.*$/, "");
                    const safe = pathResolve(rootDir, rel);
                    if (!isInside(rootDir, safe)) return send(res, 403, "Forbidden");
                    const ext = safe.slice(safe.lastIndexOf(".")).toLowerCase();
                    return await serveFile(res, safe, CONTENT_TYPES[ext] ?? "application/octet-stream", fs);
                }
            }

            // ---------- API ----------
            if (method === "GET" && url.pathname === "/api/state") {
                const snapshot = await getState();
                return jsonRes(res, 200, snapshot);
            }

            if (method === "GET" && url.pathname === "/api/events") {
                res.writeHead(200, {
                    "Content-Type": "text/event-stream",
                    "Cache-Control": "no-cache",
                    Connection: "keep-alive",
                });
                res.write("retry: 2000\n\n");
                registerSse(req, res);
                return;
            }

            if (method === "GET" && url.pathname === "/api/artifact") {
                const p = url.searchParams.get("p");
                if (!p) return jsonError(res, 400, "missing ?p=");
                const safe = resolveWorkspacePath(res, getInstance()?.workspacePath, p);
                if (!safe) return;
                try {
                    const st = await fs.stat(safe);
                    if (st.size && st.size > MAX_ARTIFACT_BYTES) {
                        return jsonError(res, 413, `file exceeds ${MAX_ARTIFACT_BYTES} bytes`);
                    }
                    const text = await fs.readFile(safe, "utf8");
                    return send(res, 200, text, "text/plain; charset=utf-8");
                } catch (err) {
                    return jsonError(res, 404, `not found: ${err?.message ?? err}`);
                }
            }

            // Fallback for when the inferred artifact filename is wrong or
            // the skill wrote to a different file in the same folder: list
            // the .md files under `?p=<folder>` so the UI can offer a
            // "Browse folder" affordance. Same sandbox rule as /api/artifact.
            if (method === "GET" && url.pathname === "/api/artifact-list") {
                const p = url.searchParams.get("p");
                if (!p) return jsonError(res, 400, "missing ?p=");
                const safe = resolveWorkspacePath(res, getInstance()?.workspacePath, p);
                if (!safe) return;
                try {
                    const st = await fs.stat(safe);
                    if (!st.isDirectory()) return jsonError(res, 400, "not a directory");
                    const entries = await fs.readdir(safe, { withFileTypes: true });
                    const files = [];
                    for (const ent of entries) {
                        if (!ent.isFile()) continue;
                        if (!ent.name.toLowerCase().endsWith(".md")) continue;
                        try {
                            const fst = await fs.stat(pathResolve(safe, ent.name));
                            files.push({
                                name: ent.name,
                                size: fst.size ?? 0,
                                mtimeMs: fst.mtimeMs ?? 0,
                            });
                        } catch {
                            files.push({ name: ent.name, size: 0, mtimeMs: 0 });
                        }
                    }
                    files.sort((a, b) => b.mtimeMs - a.mtimeMs);
                    return jsonRes(res, 200, { folder: p, files });
                } catch (err) {
                    return jsonError(res, 404, `not found: ${err?.message ?? err}`);
                }
            }

            // Look up a locally-cached preset catalog JSON by its remote URL.
            // Used by the Catalogs tab so users can click a source row to
            // preview its JSON without leaving the wizard. Scans
            // `.specify/workflows/.cache/*-meta.json` for a matching `url`,
            // then returns the paired data file (same name minus `-meta`).
            if (method === "GET" && url.pathname === "/api/catalog-cache") {
                const remote = url.searchParams.get("url");
                if (!remote) return jsonError(res, 400, "missing ?url=");
                const cwd = getInstance()?.workspacePath;
                if (!cwd) return jsonError(res, 400, "workspace path unavailable");
                const cacheDir = pathResolve(cwd, ".specify/workflows/.cache");
                let cacheHit = false;
                try {
                    const entries = await fs.readdir(cacheDir);
                    for (const name of entries) {
                        if (!name.endsWith("-meta.json")) continue;
                        const metaPath = pathResolve(cacheDir, name);
                        try {
                            const metaTxt = await fs.readFile(metaPath, "utf8");
                            const meta = JSON.parse(metaTxt);
                            if (meta?.url === remote) {
                                cacheHit = true;
                                const dataName = name.replace(/-meta\.json$/, ".json");
                                const dataPath = pathResolve(cacheDir, dataName);
                                const text = await fs.readFile(dataPath, "utf8");
                                return send(res, 200, text, "application/json; charset=utf-8");
                            }
                        } catch { /* skip malformed entry */ }
                    }
                } catch { /* cache dir missing — treat as miss */ }
                if (cacheHit) return; // unreachable safety
                // Cache miss — try a live fetch so the user still gets a
                // preview. Restricted to safe read-only hosts.
                try {
                    const host = new URL(remote).host;
                    const allowed = host === "github.com"
                        || host === "raw.githubusercontent.com"
                        || host.endsWith(".githubusercontent.com");
                    if (!allowed) return jsonError(res, 404, "no cached catalog matches that url");
                    const r = await fetch(remote);
                    if (!r.ok) return jsonError(res, r.status, `remote fetch ${r.status}`);
                    const text = await r.text();
                    const ct = r.headers.get("content-type") || "application/json; charset=utf-8";
                    return send(res, 200, text, ct);
                } catch (err) {
                    return jsonError(res, 502, `live fetch failed: ${err?.message ?? err}`);
                }
            }

            if (method === "POST" && url.pathname === "/api/reveal") {
                // Read body for optional { sub: "relative/path" }.
                let body = {};
                try { body = await readBody(req); } catch { /* ignore, treat as empty */ }
                const cwd = getInstance()?.workspacePath;
                if (!cwd) return jsonError(res, 400, "workspace path unavailable");
                let target = cwd;
                const sub = typeof body?.sub === "string" ? body.sub : "";
                if (sub) {
                    const safe = resolveWorkspacePath(res, cwd, sub);
                    if (!safe) return;
                    target = safe;
                }
                try {
                    let cmd, args;
                    if (process.platform === "win32") {
                        cmd = "explorer.exe";
                        args = [target];
                    } else if (process.platform === "darwin") {
                        cmd = "open";
                        args = [target];
                    } else {
                        cmd = "xdg-open";
                        args = [target];
                    }
                    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
                    child.on("error", () => { /* ignore */ });
                    child.unref();
                    return jsonRes(res, 200, { ok: true, path: target });
                } catch (err) {
                    return jsonError(res, 500, `reveal failed: ${err?.message ?? err}`);
                }
            }

            // ---- POST endpoints share a body-parsing block ----
            if (method === "POST" && url.pathname.startsWith("/api/")) {
                let body;
                try {
                    body = await readBody(req);
                } catch (err) {
                    if (err.code === "BODY_TOO_LARGE") return jsonError(res, 413, "body too large");
                    if (err.code === "BAD_JSON") return jsonError(res, 400, err.message);
                    return jsonError(res, 400, `bad request: ${err.message}`);
                }

                // Route table. Adding a new POST endpoint = one entry here; no
                // copy-paste `if (url.pathname === ...) return handleXxx(...)`
                // scaffolding to remember. Deps bundles per handler because a
                // few take different sub-sets of the closure environment.
                const postRoutes = {
                    "/api/prompt": () => handlePrompt(res, body, { session, log, broadcast, getInstance }),
                    "/api/phase/submit": () => handlePhaseSubmit(res, body, { session, log, broadcast, getInstance }),
                    "/api/pipeline": () => handlePipelineMutation(res, body, { getState, broadcast, getInstance }),
                    "/api/artifact-targets": () => handleArtifactTargets(res, body, { broadcast, getInstance }),
                    "/api/skills/reload": () => handleSkillsReload(res, { session, broadcast, getInstance }),
                    "/api/setup/skip-defaults": () => handleSkipDefaults(res, body, { broadcast, getInstance }),
                    "/api/env/probe": () => handleProbeEnv(res, { getState, broadcast, getInstance, ensureEnvProbe }),
                };
                const route = postRoutes[url.pathname];
                if (route) return route();
            }

            return jsonError(res, 404, "not found");
        } catch (err) {
            // Top-level catch — never leak an unhandled promise rejection.
            try {
                if (log) await log(`server error: ${err?.message ?? err}`, "error");
            } catch { /* ignore */ }
            return jsonError(res, 500, `server error: ${err?.message ?? err}`);
        }
    };
}

// ------------------------------------------------------------------------
// Bootstrap: bind loopback socket, mint token, wire SSE.
// ------------------------------------------------------------------------
export async function startServer(instanceId, deps) {
    const token = randomBytes(24).toString("hex");
    const inst = deps.getInstance();
    if (inst) inst.token = token;

    const sseClients = new Set();
    const registerSse = (req, res) => {
        sseClients.add(res);
        // Push an initial state snapshot on subscribe.
        deps
            .getState()
            .then((snapshot) => {
                try {
                    res.write(`data: ${JSON.stringify({ type: "state", data: snapshot })}\n\n`);
                } catch { /* client gone */ }
            })
            .catch(() => {});
        const hb = setInterval(() => {
            try { res.write(": hb\n\n"); } catch { /* client gone */ }
        }, 20_000);
        req.on("close", () => {
            clearInterval(hb);
            sseClients.delete(res);
        });
    };
    const broadcast = (message) => {
        const payload = `data: ${JSON.stringify(message)}\n\n`;
        for (const res of Array.from(sseClients)) {
            try {
                res.write(payload);
            } catch {
                sseClients.delete(res);
                try { res.end(); } catch { /* ignore */ }
            }
        }
    };
    if (inst) {
        inst.sseClients = sseClients;
        inst.broadcast = broadcast;
    }

    const handler = createHandler({
        ...deps,
        token,
        broadcast,
        registerSse,
    });

    const server = createServer((req, res) => {
        handler(req, res).catch((err) => {
            try {
                jsonError(res, 500, `unhandled: ${err?.message ?? err}`);
            } catch { /* headers already sent */ }
        });
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    const url = `http://127.0.0.1:${port}/?token=${token}`;

    if (inst) {
        inst.server = server;
        inst.url = url;
    }
    return { server, url, token, sseClients, broadcast };
}

// Exposed for tests.
export const _internal = { readBody, BODY_CAP, MAX_ARTIFACT_BYTES };
