// Phase-tracking canvas action handlers: setPhaseStatus, reportExecution.
// Called by the scaffolded skills to mark completion and record which
// artifacts actually fired during a run.
//
// Lives under `canvas-runtime/actions/` alongside `catalog.mjs` and
// `composition.mjs` — those three files are the wizard's canvas-action
// registry, split by concern (phase / catalog / composition). Phase
// actions apply to the composed pipeline whether the current phase's
// command comes from a preset OR a Spec Kit extension — this module
// operates on the resolved phase graph, not on any particular source
// layer.

import { RUNNABLE_PHASE_ORDER, RUNNABLE_PHASES } from "../wizard-phases.mjs";
import { withInstance } from "../instances.mjs";
import { persistAndBroadcast } from "../composition-apply.mjs";
import { normalizeExecutionReports, mergeExecutionReportEntry } from "../../state/store.mjs";
import { activeArtifactsForCommand } from "../../pipeline/active-artifacts.mjs";
import { dispatchPhaseCommand } from "../dispatch.mjs";
import { activeRunMatches, clearRun, consumeReportableRun, finishRun, hasActiveRun } from "../run-tracker.mjs";

// Helper used by `reportExecution` below to merge the agent's per-phase
// self-report into `composition.executionReports`. The agent is the sole
// source of witness reports now (the deterministic tool-call inference
// pipeline was removed).
async function applyExecutionReport(inst, input) {
    const commandId = typeof input.commandId === "string" && input.commandId.length
        ? input.commandId
        : null;
    if (!commandId) return { ok: false, error: "missing commandId" };
    // Backfill EXPECTED from the composition-derived active artifacts when
    // the caller doesn't supply it. This uses the SAME derivation as the
    // phase card's pill rendering and the tracking preamble's closed list,
    // so state.json's `expected` always matches what the agent was told.
    const derivedExpected = activeArtifactsForCommand(inst?.cachedComposition, commandId);
    const expected = input.expected && typeof input.expected === "object"
        ? input.expected
        : derivedExpected;
    const key = `commands/${commandId}`;
    const slice = { [key]: {
        expected,
        artifacts: input.artifacts === null ? null : input.artifacts,
        sourcePath: input.sourcePath,
        sourceHash: input.sourceHash,
        sessionId: input.sessionId,
        sessionWindow: input.sessionWindow,
        analyzedAt: input.analyzedAt ?? new Date().toISOString(),
        stale: false,
    } };
    const norm = normalizeExecutionReports(slice);
    if (!norm) return { ok: false, error: "invalid execution report shape" };
    const prev = inst.cachedComposition
        ?? inst.state?.composition
        ?? {};
    const prevReports = prev.executionReports ?? {};
    const mergedReports = { ...prevReports };
    for (const [k, nextEntry] of Object.entries(norm)) {
        mergedReports[k] = mergeExecutionReportEntry(prevReports[k], nextEntry);
    }
    // Keep the in-memory cache in sync so subsequent same-turn reads see
    // the merge, but persist ONLY the executionReports slice — applyPatch's
    // per-key merge preserves presets/extensions/artifacts on disk.
    const composition = {
        ...prev,
        executionReports: mergedReports,
    };
    inst.cachedComposition = composition;
    inst.broadcast({ type: "composition", ...composition });
    await persistAndBroadcast(inst, { composition: { executionReports: mergedReports } });
    return { ok: true, merged: Object.keys(norm).length };
}

export const phaseActions = [
    {
        name: "setPhaseStatus",
        description:
            "Update the status (and optional artifact path) of a single wizard phase after the scaffolded skill finishes.",
        inputSchema: {
            type: "object",
            required: ["phase", "status"],
            properties: {
                phase: { type: "string", enum: RUNNABLE_PHASE_ORDER },
                status: { type: "string", enum: ["empty", "in_progress", "done", "skipped", "error"] },
                artifactPath: { type: "string" },
                runId: { type: "string" },
            },
        },
        handler: (ctx) =>
            withInstance(ctx, async (inst) => {
                const { phase, status, artifactPath, runId } = ctx.input ?? {};
                if (!phase || !RUNNABLE_PHASES.has(phase)) return { ok: false, error: "invalid phase" };
                if (["done", "skipped", "error"].includes(status)) {
                    const commandName = `speckit.${phase}`;
                    // The wizard starts the phase, then the chat shows whether
                    // it is still working. If a user starts the same phase
                    // again before chat finishes, the runs may overlap; that
                    // is outside the wizard's normal guided flow.
                    //
                    // This check rejects callbacks already known to be stale,
                    // but it does not serialize the status write below.
                    if (runId) {
                        if (!activeRunMatches(inst.instanceId, commandName, runId)) {
                            return { ok: false, error: "stale phase run" };
                        }
                    } else if (hasActiveRun(inst.instanceId, commandName)) {
                        return { ok: false, error: "stale phase run" };
                    }
                }
                await persistAndBroadcast(inst, {
                    phases: {
                        [phase]: {
                            status,
                            artifactPath: artifactPath ?? undefined,
                            lastRunAt: new Date().toISOString(),
                        },
                    },
                });
                if (["done", "skipped", "error"].includes(status)) {
                    if (runId) {
                        finishRun(inst.instanceId, `speckit.${phase}`, runId, { allowReport: status === "done" });
                    } else {
                        clearRun(inst.instanceId, `speckit.${phase}`, runId);
                    }
                }
                // No deterministic witness anymore — the agent self-reports
                // via `reportExecution` per the tracking preamble.
                return { ok: true };
            }),
    },
    {
        name: "runPhase",
        description:
            "Kick off a wizard phase by dispatching its `/speckit-<phase>` slash command through the session — the same code path the wizard's Run phase button uses. Includes the wizard tracking preamble so the agent knows to report a terminal status and, on success, call `reportExecution`. Use this when the user asks the agent to run a phase directly instead of clicking the button.",
        inputSchema: {
            type: "object",
            required: ["phase"],
            properties: {
                phase: { type: "string", enum: RUNNABLE_PHASE_ORDER },
                args: { type: "string", description: "Verbatim textarea contents to append after the slash command." },
            },
        },
        handler: (ctx) =>
            withInstance(ctx, async (inst) => {
                const { phase, args = "" } = ctx.input ?? {};
                if (!phase || !RUNNABLE_PHASES.has(phase)) return { ok: false, error: "invalid phase" };
                const commandName = `speckit.${phase}`;
                try {
                    const run = await dispatchPhaseCommand(inst, { commandName, args, allowEmpty: true, track: true });
                    return {
                        ok: true,
                        commandName,
                        tracked: run?.tracked === true,
                        untracked: run?.untracked === true,
                        runId: run?.runId,
                        startedAt: run?.startedAt,
                    };
                } catch (err) {
                    return { ok: false, error: err?.message ?? String(err) };
                }
            }),
    },
    {
        name: "reportExecution",
        description:
            "Report which of the phase's expected templates / scripts / hooks the agent actually invoked, per the tracking preamble's closed list. Call once after setPhaseStatus(status:'done').",
        inputSchema: {
            type: "object",
            required: ["phase", "artifacts", "runId"],
            properties: {
                phase: { type: "string", enum: RUNNABLE_PHASE_ORDER },
                runId: { type: "string" },
                artifacts: {
                    type: "object",
                    description:
                        "Per-kind map of bareId → 'executed' | 'omitted'. Use the exact IDs the tracking preamble listed as expected. Do not invent IDs.",
                    properties: {
                        templates: {
                            type: "object",
                            additionalProperties: { type: "string", enum: ["executed", "omitted"] },
                        },
                        scripts: {
                            type: "object",
                            additionalProperties: { type: "string", enum: ["executed", "omitted"] },
                        },
                        hooks: {
                            type: "object",
                            additionalProperties: { type: "string", enum: ["executed", "omitted"] },
                        },
                    },
                },
            },
        },
        handler: (ctx) =>
            withInstance(ctx, async (inst) => {
                const { phase, artifacts, runId } = ctx.input ?? {};
                if (!phase || !RUNNABLE_PHASES.has(phase)) return { ok: false, error: "invalid phase" };
                if (!runId) return { ok: false, error: "missing runId" };
                if (!artifacts || typeof artifacts !== "object") return { ok: false, error: "missing artifacts" };
                const normalized = { template: {}, script: {}, hook: {} };
                const KIND_MAP = { templates: "template", scripts: "script", hooks: "hook" };
                for (const [pluralKey, singular] of Object.entries(KIND_MAP)) {
                    const bag = artifacts[pluralKey];
                    if (!bag || typeof bag !== "object") continue;
                    for (const [id, state] of Object.entries(bag)) {
                        if (state !== "executed" && state !== "omitted") continue;
                        normalized[singular][id] = { state, detail: null };
                    }
                }
                if (!consumeReportableRun(inst.instanceId, `speckit.${phase}`, runId)) {
                    return { ok: false, error: "stale phase run" };
                }
                return applyExecutionReport(inst, {
                    commandId: `speckit.${phase}`,
                    artifacts: normalized,
                    sourcePath: "witness:llm-selfreport",
                    analyzedAt: new Date().toISOString(),
                });
            }),
    },
];
