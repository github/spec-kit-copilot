// HTTP handlers for phase-family endpoints: /api/prompt, /api/phase/submit.
//
// These are thin wrappers that parse the HTTP body and delegate to the
// shared dispatch helpers in `canvas-runtime/dispatch.mjs`. The same
// helpers are called from the agent-facing canvas actions (runPhase,
// addPreset, addExtension), so a UI click and an agent NL invocation
// produce byte-identical prompts.

import { UnknownActionKindError } from "../prompts.mjs";
import { ACTION_KINDS, PHASE_BY_ID } from "../canvas-runtime/wizard-phases.mjs";
import { dispatchKindPrompt, dispatchPhaseCommand } from "../canvas-runtime/dispatch.mjs";
import { jsonError, jsonRes } from "./http-utils.mjs";

export async function handlePrompt(res, body, { log, getInstance }) {
    const kind = body?.kind;
    const payload = body?.payload ?? {};
    if (!kind) return jsonError(res, 400, "missing kind");
    if (!ACTION_KINDS.has(kind)) return jsonError(res, 400, `unknown kind: ${kind}`);

    const inst = getInstance();
    try {
        await dispatchKindPrompt(inst, kind, payload);
    } catch (err) {
        if (err instanceof UnknownActionKindError) return jsonError(res, 400, err.message);
        return jsonError(res, 500, `prompt build failed: ${err?.message ?? err}`);
    }
    // Ephemeral feedback line so the click "landed" visually.
    if (log) await log(`dispatch ${kind}`, "info");
    return jsonRes(res, 202, { queued: true, kind });
}

export function phaseSubmitKind(phase) {
    if (phase === "setup") return null; // no direct submit — setup has sub-step endpoints
    return phase;
}

/**
 * Dispatch a raw workflow slash-command through the shared helper. Bypasses
 * ACTION_KINDS and the plugin-skill prompt builder — used for phases whose
 * primary button routes to `/speckit.<name>` and for handoff buttons.
 *
 * When `track: true` (default for Run phase / Rerun phase clicks — passed
 * through `handlePhaseSubmit`), the shared helper prepends the wizard
 * tracking preamble so the agent calls `setPhaseStatus` on completion and
 * `reportExecution` with a per-artifact executed/omitted verdict. Handoff
 * calls pass `track: false` so neither the preamble nor the witness window
 * are engaged.
 */
export async function dispatchWorkflowCommand(res, { commandName, args, allowEmpty = true, track = false }, { log, getInstance }) {
    let inst;
    try {
        inst = getInstance?.();
    } catch { /* best-effort */ }
    try {
        dispatchPhaseCommand(inst, { commandName, args, allowEmpty, track });
    } catch (err) {
        return jsonError(res, 400, err?.message ?? String(err));
    }
    if (log) await log(`dispatch workflow ${commandName}`, "info");
    return jsonRes(res, 202, { queued: true, commandName });
}

export async function handlePhaseSubmit(res, body, deps) {
    // New (v2) dispatch path: when the client sends `commandName` (e.g.
    // "speckit.constitution") we dispatch a literal Copilot Chat slash
    // command with the textarea contents as $ARGUMENTS. This is the
    // workflow lane and is preset-agnostic.
    //
    // `track: true` prepends the wizard tracking preamble so the agent
    // calls `setPhaseStatus` when the skill completes, and opens a witness
    // window so the extension records which artifacts actually fired.
    if (typeof body?.commandName === "string") {
        return dispatchWorkflowCommand(res, {
            commandName: body.commandName,
            args: typeof body.args === "string" ? body.args : "",
            allowEmpty: body.allowEmpty !== false,
            track: true,
        }, deps);
    }
    // Setup path: dispatch via the plugin skill kind.
    const phase = body?.phase;
    if (!phase || !PHASE_BY_ID[phase]) return jsonError(res, 400, "missing/invalid phase");
    const kind = body?.kind || phaseSubmitKind(phase);
    if (!kind) return jsonError(res, 400, `no dispatch kind for phase ${phase}`);
    if (!ACTION_KINDS.has(kind)) return jsonError(res, 400, `unknown kind: ${kind}`);
    return handlePrompt(res, { kind, payload: body?.values ?? {} }, deps);
}
