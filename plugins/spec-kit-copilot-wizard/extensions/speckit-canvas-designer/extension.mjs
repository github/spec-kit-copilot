import { createCanvas, CanvasError, joinSession } from "@github/copilot-sdk/extension";
import { readHandoff } from "./handoff.mjs";
import { startShell } from "./server.mjs";
import { loadPreparedPages } from "./pages.mjs";

const servers = new Map();

const session = await joinSession({
    canvases: [createCanvas({
        id: "speckit-canvas-designer",
        displayName: "Spec Kit Canvas Designer",
        description: "Open the Designer shell, or load registered pages for a prepared Wizard handoff.",
        inputSchema: {
            type: "object", additionalProperties: false,
            properties: { handoffId: {
                type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$",
            } },
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
                    ? await loadPreparedPages(handoff, session.workspacePath, process.cwd()) : null;
                const next = await startShell(handoff, model);
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
