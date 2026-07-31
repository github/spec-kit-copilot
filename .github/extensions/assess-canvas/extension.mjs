// Extension: assess-canvas
// A visual dashboard that wraps the Spec Kit "assess" extension — the
// five-stage idea-assessment discovery funnel (intake → research → define →
// shape → decide) that writes artifacts under `.specify/assessments/<slug>/`.
//
// The canvas reads those artifacts to show progress, previews each artifact,
// and drives the pipeline by sending `/speckit.assess.*` slash commands back
// to the agent via `session.send`. It never writes assessment files itself —
// only the assess commands do that.

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { joinSession, createCanvas, CanvasError } from "@github/copilot-sdk/extension";
import {
    scanAssessments,
    readArtifact,
    findProjectRoot,
    normalizeSlug,
    isAllowedCommand,
    stageByKey,
    stateSignature,
    STAGES,
} from "./assess.js";

let PROJECT_ROOT = findProjectRoot();
const INDEX_HTML = readFileSync(fileURLToPath(new URL("./index.html", import.meta.url)), "utf8");
const SETUP_PROMPT = [
    "Set up the Spec Kit assess pipeline in this repository.",
    "If `.specify/` is missing, run `specify init --here --force --integration copilot --integration-options=\"--skills\"`.",
    "Then run `specify extension add assess` and reload Copilot skills in this session.",
    "Report when the assess commands are ready.",
].join(" ");

// instanceId -> { server, url, clients:Set<res>, lastSig:string, timer }
const servers = new Map();

function currentState() {
    return scanAssessments(PROJECT_ROOT);
}

function sendJson(res, code, obj) {
    res.writeHead(code, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(obj));
}

async function readBody(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > 1_000_000) throw new Error("request body too large");
        chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    if (!raw) return {};
    try {
        return JSON.parse(raw);
    } catch {
        return {};
    }
}

// Turn a stage command + slug (+ idea for intake) into the slash-command
// prompt we hand to the agent. Rejects anything outside the allowlist.
function buildPrompt(command, slug, idea, instructions) {
    if (!isAllowedCommand(command)) return { error: "command not allowed" };
    if (command === "speckit.assess.intake") {
        const capturedIdea = typeof idea === "string" ? idea.trim() : "";
        if (!capturedIdea) return { error: "intake needs idea text" };
        const parts = [];
        parts.push(capturedIdea);
        if (slug) parts.push(`slug=${slug}`);
        return { prompt: `/${command} ${parts.join(" ")}`.trim() };
    }
    if (!slug) return { error: "slug required" };
    const direction = typeof instructions === "string" ? instructions.trim() : "";
    const assessment = currentState().assessments.find((item) => item.slug === slug);
    const has = (stage) => Boolean(assessment?.stages?.[stage]?.exists);
    if (command === "speckit.assess.research" && !has("intake") && !direction) {
        return { error: "research needs substantive idea text when intake.md is missing" };
    }
    if (command === "speckit.assess.define" && !has("intake") && !has("research") && !direction) {
        return { error: "define needs substantive problem text when intake.md and research.md are missing" };
    }
    if (command === "speckit.assess.shape" && !has("define")) {
        return { error: "shape requires problem.md; run define first" };
    }
    if (command === "speckit.assess.decide" && !has("define")) {
        return { error: "decide requires problem.md; run define first" };
    }
    return { prompt: `/${command}${direction ? ` ${direction}` : ""} slug=${slug}` };
}

function broadcast(entry) {
    const state = currentState();
    const sig = stateSignature(state);
    if (sig === entry.lastSig) return;
    entry.lastSig = sig;
    const payload = `event: state\ndata: ${JSON.stringify(state)}\n\n`;
    for (const client of entry.clients) {
        try {
            client.write(payload);
        } catch {
            // client gone; cleaned up on its own 'close'
        }
    }
}

function makeHandler(entry) {
    return async (req, res) => {
        let url;
        try {
            url = new URL(req.url, "http://127.0.0.1");
        } catch {
            sendJson(res, 400, { ok: false, error: "bad url" });
            return;
        }
        const path = url.pathname;
        try {
            if (path === "/" || path === "/index.html") {
                res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
                res.end(INDEX_HTML);
                return;
            }
            if (path === "/api/state") {
                sendJson(res, 200, currentState());
                return;
            }
            if (path === "/api/artifact") {
                sendJson(res, 200, readArtifact(PROJECT_ROOT, url.searchParams.get("slug"), url.searchParams.get("stage")));
                return;
            }
            if (path === "/api/setup" && req.method === "POST") {
                session.send({ prompt: SETUP_PROMPT });
                sendJson(res, 200, { ok: true, prompt: SETUP_PROMPT });
                return;
            }
            if (path === "/events") {
                res.writeHead(200, {
                    "Content-Type": "text/event-stream",
                    "Cache-Control": "no-cache",
                    Connection: "keep-alive",
                });
                res.write(`event: state\ndata: ${JSON.stringify(currentState())}\n\n`);
                entry.clients.add(res);
                req.on("close", () => entry.clients.delete(res));
                return;
            }
            if (path === "/api/run" && req.method === "POST") {
                if (currentState().prerequisites.setupRequired) {
                    sendJson(res, 409, { ok: false, error: "Set up Spec Kit and the assess extension first" });
                    return;
                }
                const body = await readBody(req);
                const command = String(body.command || "");
                const slug = normalizeSlug(body.slug || "");
                const idea = typeof body.idea === "string" ? body.idea.slice(0, 4000) : "";
                const instructions = typeof body.instructions === "string" ? body.instructions.slice(0, 4000) : "";
                const built = buildPrompt(command, slug, idea, instructions);
                if (built.error) {
                    sendJson(res, 400, { ok: false, error: built.error });
                    return;
                }
                session.send({ prompt: built.prompt });
                sendJson(res, 200, { ok: true, prompt: built.prompt });
                return;
            }
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("not found");
        } catch (err) {
            sendJson(res, 500, { ok: false, error: String((err && err.message) || err) });
        }
    };
}

async function startServer(instanceId) {
    const entry = { clients: new Set(), lastSig: "", server: null, url: "", timer: null };
    const server = createServer(makeHandler(entry));
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    entry.server = server;
    entry.url = `http://127.0.0.1:${port}/`;
    // Poll the filesystem and push SSE updates when the assessment state
    // changes (e.g. after an assess command writes a new artifact).
    entry.timer = setInterval(() => broadcast(entry), 1500);
    return entry;
}

const canvas = createCanvas({
    id: "assess-canvas",
    displayName: "Idea Assessment",
    description: "Visual dashboard for the assess pipeline: track, preview, and run intake → research → define → shape → decide for each idea.",
    actions: [
        {
            name: "list_assessments",
            description: "List all idea assessments with per-stage progress and any recorded verdict.",
            handler: async () => {
                const state = currentState();
                return {
                    projectRoot: state.projectRoot,
                    prerequisites: state.prerequisites,
                    exists: state.exists,
                    funnel: state.funnel,
                    verdicts: state.verdicts,
                    assessments: state.assessments.map((a) => ({
                        slug: a.slug,
                        title: a.title,
                        completed: a.completed,
                        total: a.total,
                        nextStage: a.nextStage,
                        verdict: a.verdict,
                    })),
                };
            },
        },
        {
            name: "setup_assess",
            description: "Initialize Spec Kit if needed and install the assess extension before running the funnel.",
            handler: async () => {
                session.send({ prompt: SETUP_PROMPT });
                return { ok: true, prompt: SETUP_PROMPT };
            },
        },
        {
            name: "run_stage",
            description: "Run an assess stage for a slug by sending the matching /speckit.assess.* command to the agent.",
            inputSchema: {
                type: "object",
                properties: {
                    slug: { type: "string", description: "Assessment slug (kebab-case)." },
                    stage: {
                        type: "string",
                        enum: STAGES.map((s) => s.key),
                        description: "Which stage to run.",
                    },
                    idea: { type: "string", description: "Idea text (only used for the intake stage)." },
                    instructions: {
                        type: "string",
                        description: "Optional direction, constraints, links, or questions for research, define, shape, or decide.",
                    },
                },
                required: ["stage"],
            },
            handler: async (ctx) => {
                if (currentState().prerequisites.setupRequired) {
                    throw new CanvasError("setup_required", "Set up Spec Kit and the assess extension first");
                }
                const stage = stageByKey(ctx.input?.stage);
                if (!stage) throw new CanvasError("invalid_stage", "Unknown stage");
                const slug = normalizeSlug(ctx.input?.slug || "");
                const built = buildPrompt(stage.command, slug, ctx.input?.idea || "", ctx.input?.instructions || "");
                if (built.error) throw new CanvasError("invalid_input", built.error);
                session.send({ prompt: built.prompt });
                return { ok: true, prompt: built.prompt };
            },
        },
    ],
    open: async (ctx) => {
        let entry = servers.get(ctx.instanceId);
        if (!entry) {
            entry = await startServer(ctx.instanceId);
            servers.set(ctx.instanceId, entry);
        }
        return {
            title: "Idea Assessment",
            status: PROJECT_ROOT,
            url: entry.url,
        };
    },
    onClose: async (ctx) => {
        const entry = servers.get(ctx.instanceId);
        if (!entry) return;
        servers.delete(ctx.instanceId);
        if (entry.timer) clearInterval(entry.timer);
        for (const client of entry.clients) {
            try {
                client.end();
            } catch {
                // ignore
            }
        }
        await new Promise((resolve) => entry.server.close(() => resolve()));
    },
});

const session = await joinSession({ canvases: [canvas] });
const metadata = await session.rpc.metadata.snapshot();
PROJECT_ROOT = findProjectRoot(metadata.workingDirectory);
await session.log("assess-canvas ready — open the Idea Assessment canvas to drive the assess pipeline.", { ephemeral: true });
