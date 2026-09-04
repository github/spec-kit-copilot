// Server-owned phase run tracking.
//
// Dispatch starts a run. Wizard-owned completion signals clear it: phase status
// reports, scanner-observed terminal statuses, or the safety timeout. SDK idle
// is never treated as completion because conversation phases can idle while
// waiting on user input.
//
// Runs are scoped per canvas instance (`instanceId`): the extension can have
// multiple canvas instances/workspaces open concurrently, and a run started
// in one must never be visible to, or clearable by, another.

import { ensureSessionActivity, onSessionActivity } from "./session-activity.mjs";
import { PHASE_BY_ID } from "./wizard-phases.mjs";

export const RUN_TRACKER_SAFETY_MS = 5 * 60 * 1000;
const TERMINAL_PHASE_STATUSES = new Set(["done", "skipped", "error"]);

// runKey (`${instanceId}::${commandName}`) -> { runId, instanceId, commandName, startedAt, startedAtMs }
const activeRuns = new Map();
const safetyTimers = new Map();
const listeners = new Set();
let sequence = 0;
let activitySubscription = null;

function runKey(instanceId, commandName) {
    return `${instanceId}::${commandName}`;
}

export function configureRunTracker({ onChange } = {}) {
    if (typeof onChange === "function") listeners.add(onChange);
    if (!activitySubscription) {
        activitySubscription = onSessionActivity(handleSessionActivity);
    }
    ensureSessionActivity();
    return () => {
        if (typeof onChange === "function") listeners.delete(onChange);
    };
}

export function beginRun(instanceId, commandName, { startedAtMs = Date.now(), safetyMs = RUN_TRACKER_SAFETY_MS } = {}) {
    if (!instanceId || !commandName) return null;
    const key = runKey(instanceId, commandName);
    const run = {
        runId: `run-${++sequence}`,
        instanceId,
        commandName,
        startedAt: new Date(startedAtMs).toISOString(),
        startedAtMs,
    };
    activeRuns.set(key, run);
    resetSafetyTimer(key, safetyMs);
    emitChange();
    return { runId: run.runId, commandName: run.commandName, startedAt: run.startedAt };
}

export function clearRun(instanceId, commandName) {
    const key = runKey(instanceId, commandName);
    if (!activeRuns.has(key)) return false;
    activeRuns.delete(key);
    clearSafetyTimer(key);
    emitChange();
    return true;
}

export function activeRunsSnapshot(instanceId) {
    return Array.from(activeRuns.values())
        .filter((run) => run.instanceId === instanceId)
        .sort((a, b) => a.startedAtMs - b.startedAtMs)
        .map(({ runId, commandName, startedAt }) => ({ runId, commandName, startedAt }));
}

export function reconcileRunsWithPhases(instanceId, phases) {
    if (!phases || typeof phases !== "object") return false;
    let changed = false;
    for (const [key, run] of Array.from(activeRuns.entries())) {
        if (run.instanceId !== instanceId) continue;
        const phase = phases[phaseKeyForCommand(run.commandName)];
        // A terminal phase status is the normal completion signal, but
        // extension commands that write an off-name file only get the
        // "browse folder" fallback (`folderPath` + an advanced `lastRunAt`)
        // — `status` stays "empty" in that case. Treat either as a
        // completion signal so those runs don't sit locked until the
        // safety timeout.
        const hasCompletionSignal = TERMINAL_PHASE_STATUSES.has(phase?.status) || Boolean(phase?.folderPath);
        if (!hasCompletionSignal) continue;
        const lastRunAtMs = Date.parse(phase?.lastRunAt);
        if (Number.isFinite(lastRunAtMs) && lastRunAtMs > run.startedAtMs) {
            activeRuns.delete(key);
            clearSafetyTimer(key);
            changed = true;
        }
    }
    if (changed) emitChange();
    return changed;
}

export function __resetRunTrackerForTests() {
    for (const key of Array.from(safetyTimers.keys())) clearSafetyTimer(key);
    activeRuns.clear();
    listeners.clear();
    sequence = 0;
    if (activitySubscription) {
        try { activitySubscription(); } catch { /* ignore */ }
        activitySubscription = null;
    }
}

function handleSessionActivity(event) {
    if (!event) return;
    if (!activeRuns.size) return;
    emitChange();
}

export function phaseKeyForCommand(commandName) {
    if (typeof commandName !== "string") return "";
    if (commandName.startsWith("commands/")) return commandName;
    if (!commandName.startsWith("speckit.")) return commandName;
    const phase = commandName.slice("speckit.".length);
    return PHASE_BY_ID[phase] ? phase : `commands/${commandName}`;
}

function resetSafetyTimer(key, safetyMs) {
    clearSafetyTimer(key);
    if (!Number.isFinite(safetyMs) || safetyMs <= 0) return;
    const timer = setTimeout(() => {
        if (activeRuns.delete(key)) emitChange();
        safetyTimers.delete(key);
    }, safetyMs);
    timer.unref?.();
    safetyTimers.set(key, timer);
}

function clearSafetyTimer(key) {
    const timer = safetyTimers.get(key);
    if (!timer) return;
    clearTimeout(timer);
    safetyTimers.delete(key);
}

function emitChange() {
    // Not instance-scoped: listeners re-derive per-instance state
    // themselves (e.g. `extension.mjs` fans this out to every open canvas
    // instance and calls `activeRunsSnapshot(inst.instanceId)` for each).
    for (const listener of Array.from(listeners)) {
        try { listener(); } catch { /* isolate listeners */ }
    }
}
