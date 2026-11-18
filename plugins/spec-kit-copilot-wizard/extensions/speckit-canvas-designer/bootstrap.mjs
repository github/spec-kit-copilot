import { isAbsolute } from "node:path";
import { readHandoff } from "./handoff.mjs";
import { bootstrapDiagnosticPath, readBootstrapRecord, requireSetupRecord,
    transferDesignerHandoff, writeBootstrapRecord } from "./bootstrap-artifacts.mjs";
import { assertDiagnosticSize, BootstrapError, DESIGNER_CANVAS, DESIGNER_PROVIDER,
    DIAGNOSTIC_ERROR_RESERVE, DIAGNOSTIC_LIMIT, nativeOpenSnapshot, nativeOpenText, normalizeNativeOpenResult,
    validateBootstrapInput, validateBootstrapOutput, validateBootstrapRecord, validateFinalizeInput,
    validateOpenSnapshot, validateSetupStageResult } from "./contracts/bootstrap.mjs";

const installSetup = async (...args) =>
    (await import("../speckit-wizard-canvas/server/designer-setup.mjs")).installDesignerSetup(...args);
const finalizeSetup = async (...args) =>
    (await import("../speckit-wizard-canvas/server/designer-setup.mjs")).finalizeDesignerSetup(...args);

async function bounded(work, milliseconds, code) {
    let timer;
    try {
        return await Promise.race([work(), new Promise((_, reject) => {
            timer = setTimeout(() => reject(new BootstrapError(code,
                "Native Designer operation timed out. Inspect diagnostics before retrying.")), milliseconds);
        })]);
    } finally {
        clearTimeout(timer);
    }
}

function status(record, context, opened = false) {
    const warnings = new Set([...(record.install?.warnings ?? []),
        ...(record.reload?.warnings ?? []), ...(record.finalize?.warnings ?? [])]);
    return validateBootstrapOutput({ schemaVersion: 1, status: opened ? "shell-opened" : "installed",
        handoffId: record.launchRef.handoffId, warningCount: warnings.size,
        timings: { ...record.install.timings, ...record.finalize?.timings },
        diagnosticsPath: bootstrapDiagnosticPath(context.root, record.launchRef.handoffId),
        ...(opened ? { instanceId: `designer-${record.launchRef.handoffId}` } : {}) });
}

export function createDesignerBootstrap({
    getContext, checkNative, reloadSkills, openCanvas, listOpenCanvases, log,
    install = installSetup, finalize = finalizeSetup, nativeTimeoutMs = 120000,
}) {
    const active = new Set();
    const pendingReloads = new Map();
    return async (request, invocation) => {
        let context, record, reference, key;
        let stage = "request";
        try {
            validateBootstrapInput(request);
            reference = request.launchRef;
            stage = request.stage;
            await checkNative();
            context = await bounded(() => getContext(invocation), nativeTimeoutMs, "designer_session_metadata_timeout");
            if (!context || !isAbsolute(context.root ?? "") || !isAbsolute(context.project ?? "")
                || !context.sessionId || context.sessionId === reference.sourceSessionId) {
                throw new BootstrapError("designer_child_required", "Designer bootstrap requires its own app-native child checkout and session-state root.");
            }
            key = `${context.sessionId}:${reference.handoffId}`;
            if (active.has(key)) {
                key = undefined;
                throw new BootstrapError("designer_bootstrap_busy", "This Designer bootstrap stage is already running; retry after it returns.");
            }
            active.add(key);
            if (stage === "install") await transferDesignerHandoff(reference, context);
            else await readHandoff(context.root, reference.handoffId, undefined, reference.sha256);
            record = await readBootstrapRecord(context.root, reference.handoffId);
            if (record) validateBootstrapRecord(record, reference);
            else record = { schemaVersion: 1, launchRef: reference, skillsReloaded: false, opening: false };
            const save = async (updates = {}) => {
                const next = { ...record, ...updates };
                const details = { ...next, opening: false };
                delete details.error;
                assertDiagnosticSize(details, DIAGNOSTIC_LIMIT - DIAGNOSTIC_ERROR_RESERVE);
                await writeBootstrapRecord(context.root, reference.handoffId, next);
                record = next;
            };
            if (stage === "install") {
                if (record.reloadPending) {
                    throw new BootstrapError("designer_skill_reload_pending",
                        "A previous skill reload may still be running; use finalize-open to reconcile it or start a new launch.");
                }
                if (record.opening || record.nativeResult) {
                    throw new BootstrapError("designer_already_opened", "Designer opening already began; use finalize-open to reconcile it or start a new launch.");
                }
                record.skillsReloaded = false;
                delete record.install;
                delete record.reload;
                delete record.finalize;
                delete record.error;
                await save();
                record.install = await install(context.project, context.root, reference.handoffId, reference.sha256);
                validateSetupStageResult(record.install, "installed");
                await save();
                return status(record, context);
            }
            if (!record.install) {
                throw new BootstrapError("designer_install_required", "Invoke the Designer bootstrap install stage before finalize-open.");
            }
            await requireSetupRecord(context.root, reference.handoffId, reference.sha256);
            if (!record.skillsReloaded) {
                let pending = pendingReloads.get(key);
                if (record.reloadPending && !pending) {
                    throw new BootstrapError("designer_skill_reload_unknown",
                        "The previous skill reload outcome is unknown after a provider restart. Start a new Designer launch; bootstrap will not reload twice.");
                }
                if (!pending) {
                    record.reloadPending = true;
                    await save();
                    pending = Promise.resolve().then(() => reloadSkills());
                    pendingReloads.set(key, pending);
                }
                try {
                    record.reload = await bounded(() => pending, nativeTimeoutMs, "designer_skill_reload_timeout");
                } catch (error) {
                    if (!(error instanceof BootstrapError && error.code === "designer_skill_reload_timeout")) {
                        delete record.reloadPending;
                        pendingReloads.delete(key);
                    }
                    throw error;
                }
                delete record.reloadPending;
                pendingReloads.delete(key);
                if (!Array.isArray(record.reload?.errors) || !Array.isArray(record.reload?.warnings)
                    || [...record.reload.errors, ...record.reload.warnings].some((message) => typeof message !== "string")
                    || record.reload.errors.length) {
                    const messages = Array.isArray(record.reload?.errors)
                        ? record.reload.errors.filter((message) => typeof message === "string").join("; ") : "";
                    throw new BootstrapError("designer_skill_reload_failed",
                        `Designer skill reload failed or returned invalid diagnostics${messages ? `: ${messages}` : "."}`);
                }
                record.skillsReloaded = true;
                await save();
            }
            record.finalize = await finalize(context.project, context.root, reference.handoffId, reference.sha256);
            await save();
            if (record.finalize?.stage === "manual-resolution") {
                throw new BootstrapError("designer_scripted_verifier_required",
                    "Canvas Design lacks scripts/verify-launch.mjs. This Designer launch requires the scripted verifier; no legacy resolution/open fallback is supported.");
            }
            validateSetupStageResult(record.finalize, "ready");
            const input = validateFinalizeInput(record.finalize.openInput, reference.handoffId);
            const findOpen = async () => {
                const current = await bounded(() => listOpenCanvases(), nativeTimeoutMs, "designer_native_snapshot_timeout");
                if (!Array.isArray(current?.openCanvases)) {
                    throw new BootstrapError("designer_native_snapshot_invalid", "Could not read native open canvas instances.");
                }
                return current.openCanvases.find((entry) => entry.instanceId === `designer-${reference.handoffId}`);
            };
            const existing = await findOpen();
            if (existing) {
                validateOpenSnapshot(existing, reference.handoffId, input);
                await save({ opening: false, openSnapshot: existing });
                return status(record, context, true);
            }
            if (record.opening) {
                throw new BootstrapError("designer_native_open_unknown",
                    "The previous native open outcome is unknown. Inspect the stable canvas instance or start a new launch; bootstrap will not open it twice.");
            }
            record.opening = true;
            delete record.error;
            await save();
            const nativeResult = normalizeNativeOpenResult(await bounded(() => openCanvas({
                canvasId: DESIGNER_CANVAS, extensionId: DESIGNER_PROVIDER,
                instanceId: `designer-${reference.handoffId}`, input,
            }), nativeTimeoutMs, "designer_native_open_unknown"));
            await save({ nativeResult });
            nativeOpenText(record.nativeResult);
            if (typeof record.nativeResult === "string") {
                validateOpenSnapshot(nativeOpenSnapshot(record.nativeResult), reference.handoffId, input);
            }
            const openSnapshot = validateOpenSnapshot(await findOpen(), reference.handoffId, input);
            await save({ opening: false, openSnapshot });
            return status(record, context, true);
        } catch (error) {
            const failure = { code: error instanceof BootstrapError ? error.code
                : `designer_bootstrap_${stage.replaceAll("-", "_")}_failed`,
            message: String(error.message || error).slice(0, 2048) };
            if (record && context) {
                record.error = { ...failure };
                if (error.knownOutcome) record.opening = false;
                try { await writeBootstrapRecord(context.root, reference.handoffId, record); }
                catch (diagnosticError) {
                    failure.message = `${failure.message}; diagnostics could not be saved: ${diagnosticError.message}`.slice(0, 2048);
                }
            }
            try { await log?.(failure.message, "error"); }
            catch (logError) { console.error(failure.message, logError); }
            return validateBootstrapOutput({ schemaVersion: 1, status: "failure", error: failure,
                ...(record && context ? { handoffId: reference.handoffId,
                    diagnosticsPath: bootstrapDiagnosticPath(context.root, reference.handoffId) } : {}) });
        } finally {
            if (key) active.delete(key);
        }
    };
}
