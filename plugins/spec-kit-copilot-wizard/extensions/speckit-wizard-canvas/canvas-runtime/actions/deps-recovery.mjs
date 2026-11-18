// Canvas actions for deps-error recovery.
//
// runNpmDiagnostics — dispatch a scripted prompt to the parent session so
// the Copilot agent walks the diagnostic + repair checklist and calls the
// Wizard's Retry control when done. Fire-and-forget — the
// action returns immediately; the agent's turn shows up in chat.
//
// Mirrors the shape of catalog.mjs actions and reuses the shared
// dispatchPromptToSession helper (same fire-and-forget send used
// everywhere else in the wizard).

import { withInstance } from "../instances.mjs";
import { dispatchPromptToSession } from "../dispatch.mjs";
import { buildNpmDiagnosticPrompt } from "../../env/deps-recovery.mjs";
import { getExtensionDir } from "../../env/deps-check.mjs";

export const depsRecoveryActions = [
    {
        name: "runNpmDiagnostics",
        description:
            "Ask the Copilot agent to diagnose and repair a failed Wizard or Designer dependency install. The agent will inspect npm configuration, ask about the user's org's approved feed / CA / proxy, propose a minimal config change, retry the install, and direct the user to click Retry in the Wizard when it succeeds. Use this when the boot overlay shows a `deps-install` failure.",
        inputSchema: {
            type: "object",
            properties: {
                errorCode: {
                    type: "string",
                    description:
                        "Optional classified npm error code. When omitted, the most recent classified error stashed on the instance is used.",
                },
                force: {
                    type: "boolean",
                    description:
                        "When true, dispatch even if there is no cached error (useful when the user opens the canvas and clicks the button before the failure is broadcast).",
                },
            },
        },
        handler: (ctx) =>
            withInstance(ctx, (inst) => {
                const cached = inst?.depsError ?? null;
                const errorCode = typeof ctx.input?.errorCode === "string" && ctx.input.errorCode.trim()
                    ? ctx.input.errorCode.trim()
                    : cached?.code ?? "UNKNOWN";
                const force = !!ctx.input?.force;
                if (!cached && !force) {
                    return { ok: false, error: "no cached deps error; pass force: true to dispatch anyway" };
                }
                const prompt = buildNpmDiagnosticPrompt({
                    extDir: cached?.extDir ?? getExtensionDir(),
                    packageName: cached?.packageName ?? "js-yaml",
                    errorCode,
                    stderr: cached?.stderrTail ?? "",
                    workspacePath: inst?.workspacePath ?? null,
                });
                void dispatchPromptToSession({ prompt }).catch(() => {});
                return { ok: true, errorCode };
            }),
    },
];
