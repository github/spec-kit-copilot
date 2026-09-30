import { createCanvas, CanvasError, joinSession } from "@github/copilot-sdk/extension";
import { readHandoff } from "./handoff.mjs";
import { startShell } from "./server.mjs";

const servers = new Map();

const session = await joinSession({
    canvases: [createCanvas({
        id: "speckit-canvas-designer",
        displayName: "Spec Kit Canvas Designer",
        description: "Open the Designer shell for a validated Wizard handoff.",
        inputSchema: {
            type: "object", additionalProperties: false, required: ["handoffId"],
            properties: { handoffId: {
                type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$",
            } },
        },
        open: async (ctx) => {
            try {
                const handoff = await readHandoff(session.workspacePath, ctx.input.handoffId);
                const previous = servers.get(ctx.instanceId);
                if (previous?.handoffId === handoff.handoffId) {
                    return { title: "Spec Kit Canvas Designer", url: previous.url };
                }
                const next = await startShell(handoff);
                servers.set(ctx.instanceId, { ...next, handoffId: handoff.handoffId });
                if (previous) await previous.close();
                return { title: "Spec Kit Canvas Designer", url: next.url };
            } catch (error) {
                throw new CanvasError("designer_handoff_invalid", error.message);
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
