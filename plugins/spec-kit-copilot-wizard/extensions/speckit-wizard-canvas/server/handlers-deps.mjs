// HTTP endpoints for the boot-overlay's deps-error card.
//
//   POST /api/deps/diagnose  — dispatch the agent diagnostic prompt.
//                              Mirrors the runSkillsReload/handleSkillsReload
//                              split: the same underlying work is done by
//                              the runNpmDiagnostics canvas action, so the
//                              UI click and agent action share code.
//   POST /api/deps/retry     — re-run installDeps, driving the boot tracker
//                              so the overlay animates the retry inline.

import { jsonRes, jsonError } from "./http-utils.mjs";
import { buildNpmDiagnosticPrompt } from "../env/deps-recovery.mjs";
import { dispatchPromptToSession } from "../canvas-runtime/dispatch.mjs";
import { checkDeps, installDeps, getExtensionDir } from "../env/deps-check.mjs";
import { createBootTracker } from "../canvas-runtime/boot-progress.mjs";
import { snapshot } from "../canvas-runtime/snapshot.mjs";

export async function handleNpmDiagnose(res, body, { broadcast, getInstance }) {
    const inst = getInstance?.();
    if (!inst) return jsonError(res, 400, "instance unavailable");
    if (inst.depsDiagnoseInFlight) {
        return jsonError(res, 409, "diagnose already in flight");
    }
    inst.depsDiagnoseInFlight = true;
    try {
        const cached = inst.depsError ?? null;
        const errorCode = typeof body?.errorCode === "string" && body.errorCode.trim()
            ? body.errorCode.trim()
            : cached?.code ?? "UNKNOWN";
        if (!cached && !body?.force) {
            return jsonError(res, 400, "no cached deps error; pass force: true to dispatch anyway");
        }
        // Guard against stale-state re-dispatch: the cached depsError may
        // be from a failure the user has since fixed manually. If deps are
        // now installed, don't spam the agent — clear the record, broadcast
        // the new state, and tell the client we resolved.
        if (!body?.force) {
            try {
                const recheck = await checkDeps();
                if (recheck.ready) {
                    inst.depsError = null;
                    try {
                        const snap = await snapshot(inst);
                        broadcast?.({ type: "state", data: snap });
                    } catch { /* best-effort */ }
                    return jsonRes(res, 200, { ok: true, resolved: true });
                }
            } catch { /* fall through and dispatch */ }
        }
        const prompt = buildNpmDiagnosticPrompt({
            extDir: cached?.extDir ?? getExtensionDir(),
            errorCode,
            stderr: cached?.stderrTail ?? "",
            workspacePath: inst.workspacePath ?? null,
        });
        dispatchPromptToSession({ prompt });
        return jsonRes(res, 200, { ok: true, errorCode });
    } finally {
        // Release the guard after a short window so the button stays
        // disabled long enough for the user to see the "dispatching" state
        // but doesn't get permanently stuck if the client never rerenders.
        setTimeout(() => { inst.depsDiagnoseInFlight = false; }, 1500);
    }
}

export async function handleNpmRetry(res, body, { broadcast, getInstance }) {
    const inst = getInstance?.();
    if (!inst) return jsonError(res, 400, "instance unavailable");
    if (inst.depsRetryInFlight) {
        return jsonError(res, 409, "retry already in flight");
    }
    inst.depsRetryInFlight = true;
    try {
        // Recreate a tracker bound to the same inst.boot record so the UI
        // sees the deps-install row animate again.
        const tracker = createBootTracker({ broadcast, inst });
        tracker.start("deps-install");

        // Refresh missing set — some deps may already be installed if the user
        // ran `npm install` manually since the failure.
        const initial = await checkDeps();
        if (initial.ready) {
            tracker.ok("deps-install", { alreadyInstalled: true });
            inst.depsError = null;
            try {
                const snap = await snapshot(inst);
                broadcast?.({ type: "state", data: snap });
            } catch { /* best-effort */ }
            return jsonRes(res, 200, { ok: true, alreadyInstalled: true });
        }

        const installResult = await installDeps(initial.missing, {
            onProgress: (line) => tracker.tick("deps-install", line),
        });
        const recheck = await checkDeps();
        if (recheck.ready) {
            tracker.ok("deps-install", { installed: initial.missing });
            inst.depsError = null;
            try {
                const snap = await snapshot(inst);
                broadcast?.({ type: "state", data: snap });
            } catch { /* best-effort */ }
            return jsonRes(res, 200, { ok: true, installed: initial.missing });
        }
        const classified = installResult.classified ?? {
            code: "UNKNOWN",
            title: "npm install failed",
            hint: "The Copilot agent can help diagnose the failure.",
            canRetry: true,
        };
        const stderrTail = String(installResult.stderr ?? "").split(/\r?\n/).filter(Boolean).slice(-8).join("\n");
        inst.depsError = {
            ...classified,
            extDir: getExtensionDir(),
            packages: initial.missing,
            stderrTail,
            timestamp: new Date().toISOString(),
        };
        tracker.fail("deps-install", { ...classified, stderrTail });
        try {
            const snap = await snapshot(inst);
            broadcast?.({ type: "state", data: snap });
        } catch { /* best-effort */ }
        return jsonRes(res, 200, { ok: false, classified });
    } finally {
        inst.depsRetryInFlight = false;
    }
}
