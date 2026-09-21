import { randomUUID } from "node:crypto";
import { access, readFile, readdir, stat } from "node:fs/promises";
import { registerHooks } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createOwnedWorkspace } from "./fixtures/workspace.mjs";
import { REPOSITORY_ROOT } from "./sync-assets.mjs";

export function parseArguments(args) {
    if (args.length === 1 && args[0] === "--help") return { help: true };
    if (args.length === 2 && args[0] === "--canvas" && ["wizard", "sdd"].includes(args[1])) {
        return { canvas: args[1] };
    }
    throw new Error("Choose --canvas wizard or --canvas sdd; arbitrary workspace roots are not accepted.");
}

export async function startFixture({ canvas, pluginRoot, markdown, allowMutations = false, allowMockDispatch = false } = {}) {
    if (!["wizard", "sdd"].includes(canvas)) throw new Error("Choose an existing Wizard or SDD canvas.");
    const fixture = await createOwnedWorkspace({ markdown, allowMutations });
    const root = pluginRoot || join(REPOSITORY_ROOT, `plugins/spec-kit-copilot-${canvas}`);
    const extension = join(root, "extensions", canvas === "wizard" ? "speckit-wizard-canvas" : "sdd-canvas");
    let entry;
    let dispatches = 0;
    let deniedWrites = 0;
    let stopped = false;
    let eventsPaused = false;
    const session = {
        send: async () => {
            dispatches++;
            if (!allowMockDispatch) throw new Error("Workflow dispatch is disabled in the owned fixture.");
            return { ok: true };
        },
        log: async () => {},
        rpc: { metadata: { snapshot: async () => ({ workingDirectory: fixture.workspace }) } },
    };
    try {
        if (canvas === "wizard") {
            const { startServer } = await import(pathToFileURL(join(extension, "server.mjs")).href);
            const { scanWorkspace } = await import(pathToFileURL(join(extension, "project-scanner.mjs")).href);
            const { buildStateSnapshot } = await import(pathToFileURL(join(extension, "canvas-runtime/snapshot-builder.mjs")).href);
            const instance = { workspacePath: fixture.workspace };
            const fs = { readFile, stat, readdir, pathExists: async (path) => { try { await access(path); return true; } catch { return false; } }, log: async () => {} };
            entry = await startServer(fixture.id, {
                session,
                log: async () => {},
                getInstance: () => instance,
                getState: async () => {
                    const scanned = await scanWorkspace(fixture.workspace, fs);
                    const commands = ["constitution", "specify", "plan", "tasks"];
                    return buildStateSnapshot({
                        ...scanned,
                        currentPhase: "specify",
                        pipeline: commands.map((id) => ({ id })),
                        phaseGraph: { commands: commands.map((id) => ({ id, name: `speckit.${id}`, description: id, artifact: scanned.phases[id]?.artifactPath, source: "core" })) },
                        boot: { phase: "ready", steps: [] },
                        environment: { pluginInstalled: true, cliInstalled: true },
                        setup: { ...scanned.setup, pluginInstalled: true, cliInstalled: true, skillsReloaded: true, projectInitialized: true, catalogsLoaded: true },
                    });
                },
            });
        } else {
            const key = `__readerFixture_${randomUUID().replaceAll("-", "")}`;
            globalThis[key] = session;
            const sdk = `export const createCanvas = definition => definition; export class CanvasError extends Error {} export async function joinSession() { return globalThis[${JSON.stringify(key)}]; }`;
            const sdkUrl = `data:text/javascript,${encodeURIComponent(sdk)}`;
            const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
                if (specifier === "@github/copilot-sdk/extension") return { url: sdkUrl, shortCircuit: true };
                return nextResolve(specifier, context);
            } });
            try {
                const module = await import(`${pathToFileURL(join(extension, "extension.mjs")).href}?fixture=${fixture.id}`);
                entry = await module.startServer();
            } finally { hooks.deregister(); delete globalThis[key]; }
        }
        const listeners = entry.server.listeners("request");
        entry.server.removeAllListeners("request");
        const readRoutes = new Set(["/api/state", "/api/events", "/api/artifact", "/api/artifact-list", "/api/clarifications",
            "/api/review/context", "/api/review/artifacts", "/api/review/content"]);
        entry.server.on("request", (request, response) => {
            const path = new URL(request.url, "http://127.0.0.1").pathname;
            if (eventsPaused && ["/api/events", "/events"].includes(path)) { response.writeHead(503); response.end(); return; }
            const readOnlyLink = request.method === "POST" && ["/api/review/resolve-link", "/api/review/validate-clarifications"].includes(path);
            const mockClarification = allowMockDispatch && canvas === "sdd" && request.method === "POST" && path === "/api/clarify";
            if (!mockClarification && !readOnlyLink && (request.method !== "GET" || (path.startsWith("/api/") && !readRoutes.has(path)))) {
                deniedWrites++;
                response.writeHead(403, { "Content-Type": "application/json", "Cache-Control": "no-store" });
                response.end(JSON.stringify({ ok: false, error: "fixture is read-only" }));
                return;
            }
            for (const listener of listeners) listener.call(entry.server, request, response);
        });
        const url = new URL(entry.url);
        return {
            url: url.href,
            workspace: fixture.workspace,
            fixtureId: fixture.id,
            dispatchCount: () => dispatches,
            blockedWrites: () => deniedWrites,
            workspaceChanged: fixture.changed,
            async mutateArtifact(name, content) {
                await fixture.mutateArtifact(name, content);
                const review = { kind: "artifact-set" };
                const message = canvas === "wizard" ? `data: ${JSON.stringify({ type: "review", review })}\n\n`
                    : `event: review\ndata: ${JSON.stringify(review)}\n\n`;
                for (const client of entry.sseClients || entry.clients || []) client.write(message);
            },
            pauseEvents() {
                eventsPaused = true;
                for (const client of entry.sseClients || entry.clients || []) client.end();
            },
            resumeEvents() { eventsPaused = false; },
            async stop() {
                if (!stopped) {
                    stopped = true;
                    if (entry.timer) clearInterval(entry.timer);
                    for (const client of entry.sseClients || entry.clients || []) client.end();
                    await new Promise((resolveClose) => {
                        entry.server.close(resolveClose);
                        entry.server.closeAllConnections();
                    });
                }
                return fixture.cleanup();
            },
        };
    } catch {
        if (entry) {
            if (entry.timer) clearInterval(entry.timer);
            entry.server.closeAllConnections();
            entry.server.close();
        }
        await fixture.cleanup();
        throw new Error("Owned canvas fixture could not start; verify the staged plugin and approved prerequisites.");
    }
}

export async function runCommand(args) {
    const options = parseArguments(args);
    if (options.help) {
        console.log("Usage: node scripts/canvas-reader/serve-fixture.mjs --canvas <wizard|sdd>");
        console.log("Uses an owned synthetic workspace and the existing canvas server with dispatch disabled.");
        return;
    }
    const fixture = await startFixture(options);
    console.log(JSON.stringify({ status: "running", canvas: options.canvas, origin: new URL(fixture.url).origin, capability: "not printed", fixtureId: fixture.fixtureId }));
    const stop = () => { fixture.stop().catch(() => { process.exitCode = 1; }); };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
    runCommand(process.argv.slice(2)).catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
