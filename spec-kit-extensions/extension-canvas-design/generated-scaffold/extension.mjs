import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { joinSession, createCanvas } from "@github/copilot-sdk/extension";
import { readConfig, createWorkflowRoutes } from "./server.mjs";
import { createRuntime } from "./runtime.mjs";
import { agentActionSchemas } from "./contracts/agent-actions.mjs";

const servers = new Map();
const config = readConfig();
let runtime;
let initializing;
let session;
let lifecycle = Promise.resolve();
function withLifecycle(action) {
    const result = lifecycle.then(action);
    lifecycle = result.catch(() => {});
    return result;
}

async function getRuntime() {
    await sessionReady;
    if (runtime) return runtime;
    if (!initializing) initializing = (async () => {
        const metadata = await session.rpc.metadata.snapshot();
        const cwd = metadata.workingDirectory ?? metadata.workspace?.cwd ?? metadata.workspace?.git_root;
        if (!cwd || !session.workspacePath) throw new Error("Canvas checkout or session state unavailable");
        return createRuntime({ config, cwd, workspace: session.workspacePath, session,
            notify: () => { for (const entry of servers.values()) entry.routes.broadcast(); } });
    })();
    try { runtime = await initializing; return runtime; }
    finally { initializing = null; }
}

async function startServer(instanceId) {
    const value = await getRuntime();
    const token = randomBytes(32).toString("hex");
    let server;
    const routes = createWorkflowRoutes(config, { runtime: value, instanceId, token,
        port: () => server.address().port,
        log: (message) => session.log(message, { level: "error" }) });
    server = createServer((req, res) => {
        void routes.handle(req, res).catch((error) => res.destroy(error));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    return { server, routes, url: `http://127.0.0.1:${port}/?token=${token}` };
}

function opened(ctx, action) {
    if (!servers.has(ctx.instanceId) || !runtime) throw new Error("Open this canvas first");
    return action(runtime);
}

// Defer registration until the readiness promise exists, even for synchronous restores.
const sessionReady = Promise.resolve().then(() => joinSession({
    canvases: [
        createCanvas({
            id: config.canvas.id,
            displayName: config.canvas.displayName,
            description: config.canvas.description,
            actions: [
                { name: "run_phase", description: "Run an installed phase skill in this session.",
                    inputSchema: agentActionSchemas.run_phase,
                    handler: (ctx) => opened(ctx, (value) => value.run(ctx.input, ctx.instanceId)) },
                { name: "report_workflow_slug", description: "Record the actual workflow directory slug.",
                    inputSchema: agentActionSchemas.report_workflow_slug,
                    handler: (ctx) => opened(ctx, (value) => value.reportSlug(ctx.input, ctx.instanceId)) },
                { name: "report_phase_artifact", description: "Report a phase artifact.",
                    inputSchema: agentActionSchemas.report_phase_artifact,
                    handler: (ctx) => opened(ctx, (value) => value.report(ctx.input, ctx.instanceId)) },
                { name: "report_autopilot_step", description: "Start or verify one step in a Copilot Autopilot run.",
                    inputSchema: agentActionSchemas.report_autopilot_step,
                    handler: (ctx) => opened(ctx, (value) => value.reportAutopilotStep(ctx.input, ctx.instanceId)) },
            ],
            open: (ctx) => withLifecycle(async () => {
                let entry = servers.get(ctx.instanceId);
                if (!entry) {
                    entry = await startServer(ctx.instanceId);
                    servers.set(ctx.instanceId, entry);
                }
                return { title: config.canvas.displayName, url: entry.url };
            }),
            onClose: (ctx) => withLifecycle(async () => {
                const entry = servers.get(ctx.instanceId);
                if (entry) {
                    servers.delete(ctx.instanceId);
                    entry.routes.close();
                    await new Promise((resolve, reject) => {
                        entry.server.close((error) => error ? reject(error) : resolve());
                        entry.server.closeAllConnections();
                    });
                    if (!servers.size && runtime) { runtime.close(); runtime = null; }
                }
            }),
        }),
    ],
})).then((joined) => { session = joined; });

await sessionReady;
