import { createCanvas, CanvasError, joinSession } from "@github/copilot-sdk/extension";
import { readHandoff } from "./handoff.mjs";
import { startShell } from "./server.mjs";
import { loadDesignerPages } from "./pages.mjs";

const servers = new Map();

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
    }],
    canvases: [createCanvas({
        id: "speckit-canvas-designer",
        displayName: "Spec Kit Canvas Designer",
        description: "Open the Designer shell, or load registered pages from the current project for a Wizard handoff.",
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
                    ? await loadDesignerPages(handoff, process.cwd()) : null;
                if (handoff) await reloadSessionSkills();
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
