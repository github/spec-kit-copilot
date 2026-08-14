// Wizard-shell canvas action handlers: cross-cutting actions that manage the
// wizard's overall shell state (env report, session skills reload,
// artifact-changed notifications). These aren't tied to any one
// domain (composition, catalog, phase) — they drive the wizard UI as a whole.

import { withInstance } from "../instances.mjs";
import { runSkillsReload } from "../../server/handlers-ops.mjs";
import { persistAndBroadcast } from "../composition-apply.mjs";
import { getSession } from "../instances.mjs";

export const wizardShellActions = [
    {
        name: "showEnvReport",
        description:
            "Push environment status to the Setup → Environment sub-panel: CLI version, individual probes, scaffolded skills.",
        inputSchema: {
            type: "object",
            properties: {
                cliInstalled: { type: "boolean" },
                cliVersion: { type: "string" },
                upgradeAvailable: { type: "string" },
                checks: {
                    type: "array",
                    items: {
                        type: "object",
                        required: ["name", "status"],
                        properties: {
                            name: { type: "string" },
                            status: { type: "string" },
                            level: { type: "string", enum: ["ok", "info", "warn", "error"] },
                            detail: { type: "string" },
                        },
                    },
                },
                scaffoldedSkills: { type: "array", items: { type: "string" } },
            },
        },
        handler: (ctx) =>
            withInstance(ctx, async (inst) => {
                // Normalize caller-provided `level: "info"` to `"ok"` so
                // downstream consumers only see the canonical trio.
                const input = { ...(ctx.input ?? {}) };
                if (Array.isArray(input.checks)) {
                    input.checks = input.checks.map((c) => {
                        if (c && c.level === "info") return { ...c, level: "ok" };
                        return c;
                    });
                }
                const env = { ...(inst.cachedProbes?.summary ?? {}), ...input };
                inst.cachedProbes = { at: Date.now(), results: inst.cachedProbes?.results ?? [], summary: env };
                const setupPatch = {};
                if (input.cliInstalled === true) {
                    setupPatch.cliInstalled = true;
                }
                await persistAndBroadcast(inst, Object.keys(setupPatch).length ? { setup: setupPatch } : null);
                return { ok: true };
            }),
    },
    {
        name: "reloadSessionSkills",
        description: "Reload Copilot's in-memory skill registry for this session. Equivalent to typing `/skills reload` in the composer, but callable as a tool. Returns diagnostic counts (errors/warnings) from the reload. Use this whenever you need freshly scaffolded skills (from `specify init`, preset install, extension install, etc.) to become resolvable in the current session.",
        inputSchema: {
            type: "object",
            properties: {},
        },
        handler: (ctx) =>
            withInstance(ctx, async (inst) => {
                // Funnel through the shared reload core so this path has the
                // same one-way-sticky persistence rules as the setup flow:
                // success flips `setup.skillsReloaded: true` once and never
                // back; failures log/tooltip only, never re-lock the UI.
                const result = await runSkillsReload({
                    session: getSession(),
                    broadcast: (msg) => inst.broadcast?.(msg),
                    getInstance: () => inst,
                });
                if (result.ok) {
                    return { ok: true, errors: result.errors, warnings: result.warnings };
                }
                return { ok: false, errors: result.errors, warnings: result.warnings, error: result.error };
            }),
    },
];
