// HTTP handlers for phase-family endpoints: /api/prompt, /api/phase/submit.
//
// These are thin wrappers that parse the HTTP body and delegate to the
// shared phase dispatch helpers and direct package-operation service. UI
// clicks and agent-facing canvas actions use the same underlying operation.

import { UnknownActionKindError } from "../prompts.mjs";
import { ACTION_KINDS, PHASE_BY_ID } from "../canvas-runtime/wizard-phases.mjs";
import { dispatchKindPrompt, dispatchPhaseCommand } from "../canvas-runtime/dispatch.mjs";
import { jsonError, jsonRes } from "./http-utils.mjs";
import { catalogOperationKind } from "../contracts/catalog-operation.mjs";
import { catalogFailure, runCatalogOperation } from "../canvas-runtime/catalog-operations.mjs";
import { isPhaseSetupReady } from "../contracts/setup-readiness.mjs";
import { reviewAnswersMatchArguments, validateReviewSubmission } from "../contracts/review-submission.mjs";
import { OutputInferenceRequestError } from "../contracts/output-inference-request.mjs";

export async function handlePrompt(res, body, { log, getInstance, catalogOperation = runCatalogOperation }) {
    const kind = body?.kind;
    const payload = body?.payload ?? {};
    if (!kind) return jsonError(res, 400, "missing kind");
    if (!ACTION_KINDS.has(kind)) return jsonError(res, 400, `unknown kind: ${kind}`);

    const inst = getInstance();
    if (catalogOperationKind(kind)) {
        try {
            return jsonRes(res, 200, await catalogOperation(inst, kind, payload));
        } catch (error) {
            return jsonRes(res, error.status ?? 500, catalogFailure(error));
        }
    }
    try {
        await dispatchKindPrompt(inst, kind, payload);
    } catch (err) {
        if (err instanceof UnknownActionKindError || err instanceof OutputInferenceRequestError) {
            return jsonError(res, 400, err.message);
        }
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
 * tracking preamble so the agent reports a terminal phase status and, on
 * success, `reportExecution` with a per-artifact executed/omitted verdict. Handoff
 * calls pass `track: false` so neither the preamble nor the witness window
 * are engaged.
 */
export async function dispatchWorkflowCommand(res, { commandName, args, allowEmpty = true, track = false }, { log, getInstance }) {
    let inst;
    try {
        inst = getInstance?.();
    } catch { /* best-effort */ }
    try {
        const run = await dispatchPhaseCommand(inst, { commandName, args, allowEmpty, track });
        if (log) await log(`dispatch workflow ${commandName}`, "info");
        return jsonRes(res, 202, {
            queued: true,
            commandName,
            tracked: run?.tracked === true,
            untracked: run?.untracked === true,
            runId: run?.runId,
            startedAt: run?.startedAt,
        });
    } catch (err) {
        return jsonError(res, 400, err?.message ?? String(err));
    }
}

async function validateReviewedClarifications(res, body, service) {
    try {
        await validateReviewSubmission(service, body.review, body.commandName);
        return true;
    } catch (error) {
        if (error?.code === "review_unavailable") {
            jsonError(res, 409, "Review context is not available.");
        } else if (error?.code === "changed_source") {
            jsonError(res, 409, "Clarification source changed. Refresh before submitting.");
        } else if (["invalid_request", "invalid_context", "artifact_unavailable", "artifact_too_large",
            "unsupported_artifact", "invalid_encoding"].includes(error?.code)) {
            jsonError(res, 400, "Clarification answers are invalid or exceed the review submission limit.");
        } else {
            throw error;
        }
        return false;
    }
}

export async function handlePhaseSubmit(res, body, deps) {
    // New (v2) dispatch path: when the client sends `commandName` (e.g.
    // "speckit.constitution") we dispatch a literal Copilot Chat slash
    // command with the textarea contents as $ARGUMENTS. This is the
    // workflow lane and is preset-agnostic.
    //
    // `track: true` prepends the wizard tracking preamble so the agent
    // reports a terminal phase status, and opens a witness window so the
    // extension records which artifacts actually fired on successful runs.
    if (typeof body?.commandName === "string") {
        const service = body.review ? deps.getInstance?.()?.reviewService : null;
        if (body.review && !await validateReviewedClarifications(res, body, service)) return;
        if (!isPhaseSetupReady(await deps.getState())) {
            return jsonError(res, 409, "Complete setup before running phases or applying clarifications.");
        }
        if (body.review && deps.getInstance?.()?.reviewService !== service) {
            return jsonError(res, 409, "Review context is not available.");
        }
        if (body.review && !await validateReviewedClarifications(res, body, service)) return;
        if (body.review && deps.getInstance?.()?.reviewService !== service) {
            return jsonError(res, 409, "Review context is not available.");
        }
        const args = typeof body.args === "string" ? body.args : "";
        if (body.review && !reviewAnswersMatchArguments(args, body.review.answers)) {
            return jsonError(res, 400, "Dispatched arguments must include the validated clarification answers.");
        }
        return dispatchWorkflowCommand(res, {
            commandName: body.commandName,
            args,
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
    if (!isPhaseSetupReady(await deps.getState())) {
        return jsonError(res, 409, "Complete setup before running phases or applying clarifications.");
    }
    return handlePrompt(res, { kind, payload: body?.values ?? {} }, deps);
}
