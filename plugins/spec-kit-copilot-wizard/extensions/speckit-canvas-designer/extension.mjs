import { createCanvas, CanvasError, joinSession } from "@github/copilot-sdk/extension";
import { randomUUID } from "node:crypto";
import { readHandoff, validateHandoffId } from "./handoff.mjs";
import { startShell } from "./server.mjs";
import { assertPageCommand, loadDesignerPages, PAGE_NAME, storeDesignerPages } from "./pages.mjs";

const servers = new Map();
const loads = new Map();
const writing = new Set();
const handoffIdSchema = { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$" };

function publish(handoffId, model) {
    for (const entry of servers.values()) {
        if (entry.handoffId === handoffId) entry.update(model, loads.get(handoffId));
    }
}

function failLoad(handoffId, error, requestId) {
    if (requestId && loads.get(handoffId)?.requestId !== requestId) return;
    loads.set(handoffId, { pending: false, error });
    publish(handoffId);
}

async function requestReload(handoffId, retry = false) {
    if (writing.has(handoffId)) throw new Error("Designer is applying pages; wait for this load to finish");
    if (loads.get(handoffId)?.pending && !retry) throw new Error("Designer page reload is already pending");
    const requestId = randomUUID();
    loads.set(handoffId, { pending: true, requestId, error: "" });
    publish(handoffId);
    try {
        await readHandoff(session.workspacePath, handoffId);
        await assertPageCommand(process.cwd());
        await reloadSessionSkills();
        const prompt = `/speckit-canvas-design-load-page
Invoke the skill tool with name "speckit-canvas-design-load-page" before any other tool call.
Use the generated, preset-composed skill. Context: ${JSON.stringify({ handoffId, requestId })}.
Resolve and submit the complete page set once. Report resolution failures with the same custom load tool's error input. Do not open another panel or install packages.`;
        setImmediate(() => {
            Promise.resolve().then(() => {
                if (loads.get(handoffId)?.requestId === requestId) return session.send({ prompt });
            }).catch((error) => {
                failLoad(handoffId, error.message, requestId);
                const message = `Designer reload dispatch failed: ${error.message}`;
                void Promise.resolve().then(() => session.log(message, { level: "error" }))
                    .catch((logError) => console.error(message, `Logging failed: ${logError}`));
            });
        });
        return { queued: true };
    } catch (error) {
        failLoad(handoffId, error.message, requestId);
        throw error;
    }
}

async function acceptPages(input) {
    let id, acquired = false, current = false;
    try {
        id = validateHandoffId(input.handoffId);
        if (writing.has(id)) throw new Error("Designer is already applying a page load");
        const expected = loads.get(id)?.requestId;
        if ((expected || input.requestId) && expected !== input.requestId) {
            throw new Error("Designer page load was superseded; use the current reload request");
        }
        current = true;
        const handoff = await readHandoff(session.workspacePath, id);
        if (Object.hasOwn(input, "error")) throw new Error(input.error);
        // Recheck after asynchronous handoff reads, before taking the write lock.
        if (writing.has(id)) {
            current = false;
            throw new Error("Designer is already applying a page load");
        }
        writing.add(id);
        acquired = true;
        await assertPageCommand(process.cwd());
        const model = await storeDesignerPages(handoff, session.workspacePath, process.cwd(), input.pages,
            () => loads.get(id)?.requestId === expected);
        loads.set(id, { pending: false, error: "" });
        publish(id, model);
        return JSON.stringify({ loaded: true, handoffId: id,
            pages: model.pages.map((page) => ({ name: page.id, title: page.title })),
            revision: model.revision });
    } catch (error) {
        if (id && current && loads.get(id)?.requestId === input.requestId) {
            failLoad(id, error.message, input.requestId);
        }
        return { resultType: "failure", textResultForLlm: error.message };
    } finally {
        if (acquired) writing.delete(id);
    }
}

async function reloadSessionSkills() {
    if (!session.rpc?.skills?.reload) throw new Error("Session skill reload is unavailable");
    const diagnostics = await session.rpc.skills.reload();
    if (!Array.isArray(diagnostics?.errors) || !Array.isArray(diagnostics?.warnings)
        || [...diagnostics.errors, ...diagnostics.warnings].some((message) => typeof message !== "string")) {
        throw new Error("Invalid session skill reload diagnostics");
    }
    for (const warning of diagnostics.warnings) {
        await session.log(warning, { level: "warning" });
    }
    if (diagnostics.errors.length) {
        throw new Error(`Session skill reload failed: ${diagnostics.errors.join("; ")}`);
    }
    return diagnostics;
}

const session = await joinSession({
    tools: [{
        name: "speckit_designer_reload_skills",
        description: "Reload this session's skills after Spec Kit init or package installation, before opening Designer. Reports reload failures; does not install anything.",
        parameters: { type: "object", properties: {}, additionalProperties: false },
        handler: async () => JSON.stringify(await reloadSessionSkills()),
    }, {
        name: "speckit_designer_load_pages",
        description: "Validate agent-resolved Designer JSON paths and store the complete page model before opening, or update open panels. Does not resolve templates or install packages. Report resolution failures with error instead of pages.",
        parameters: {
            type: "object", additionalProperties: false, required: ["handoffId"],
            properties: {
                handoffId: handoffIdSchema,
                requestId: { type: "string", format: "uuid" },
                pages: { type: "array", minItems: 1, maxItems: 100, items: {
                    type: "object", additionalProperties: false, required: ["name", "path"],
                    properties: { name: { type: "string", pattern: PAGE_NAME },
                        path: { type: "string", minLength: 1, maxLength: 4096 } },
                } },
                error: { type: "string", minLength: 1, maxLength: 32768 },
            },
            oneOf: [{ required: ["pages"], not: { required: ["error"] } },
                { required: ["error"], not: { required: ["pages"] } }],
        },
        handler: acceptPages,
    }],
    canvases: [createCanvas({
        id: "speckit-canvas-designer",
        displayName: "Spec Kit Canvas Designer",
        description: "Open Designer using pages already validated by the composed load-page skill and custom tool.",
        inputSchema: {
            type: "object", additionalProperties: false,
            properties: { handoffId: handoffIdSchema },
        },
        open: async (ctx) => {
            const handoffId = ctx.input?.handoffId;
            let handoff = null;
            if (handoffId !== undefined) {
                try {
                    handoff = await readHandoff(session.workspacePath, handoffId);
                } catch (error) {
                    throw new CanvasError("designer_handoff_invalid", error.message);
                }
            }
            const previous = servers.get(ctx.instanceId);
            if (previous && previous.handoffId === handoffId) {
                return { title: "Spec Kit Canvas Designer", url: previous.url };
            }
            try {
                const model = handoff
                    ? await loadDesignerPages(handoff, session.workspacePath, process.cwd()) : null;
                if (handoff) await reloadSessionSkills();
                const next = await startShell(handoff, model,
                    { reload: (retry) => requestReload(handoffId, retry), load: loads.get(handoffId) });
                servers.set(ctx.instanceId, { ...next, handoffId });
                if (previous) await previous.close();
                return { title: "Spec Kit Canvas Designer", url: next.url };
            } catch (error) {
                throw new CanvasError("designer_open_failed", error.message);
            }
        },
        onClose: async ({ instanceId }) => {
            const entry = servers.get(instanceId);
            if (!entry) return;
            servers.delete(instanceId);
            await entry.close();
        },
    })],
});
