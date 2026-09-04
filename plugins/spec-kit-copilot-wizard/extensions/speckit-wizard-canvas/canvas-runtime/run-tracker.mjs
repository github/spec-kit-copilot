// Server-owned phase run tracking.
//
// Dispatch starts a run. Wizard-owned completion signals clear it: phase status
// reports, scanner-observed terminal statuses, correlated SDK turn completion,
// or the safety timeout. SDK idle is ignored while the session is waiting on
// user input because conversation phases can legitimately pause there.
//
// Runs are scoped per canvas instance (`instanceId`): the extension can have
// multiple canvas instances/workspaces open concurrently, and a run started
// in one must never be visible to, or clearable by, another.

import { ensureSessionActivity, onSessionActivity } from "./session-activity.mjs";
import { PHASE_BY_ID } from "./wizard-phases.mjs";

export const RUN_TRACKER_SAFETY_MS = 5 * 60 * 1000;
const TERMINAL_PHASE_STATUSES = new Set(["done", "skipped", "error"]);

// runKey (`${instanceId}::${commandName}`) -> { runId, instanceId, commandName, startedAt, startedAtMs, turnStartedAtMs }
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
    const trackedCommandName = normalizeTrackedCommandName(commandName);
    if (!instanceId || !trackedCommandName) return null;
    const key = runKey(instanceId, trackedCommandName);
    if (activeRuns.has(key)) throw new Error(`run already active for ${trackedCommandName}`);
    const run = {
        runId: `run-${++sequence}`,
        instanceId,
        commandName: trackedCommandName,
        startedAt: new Date(startedAtMs).toISOString(),
        startedAtMs,
    };
    activeRuns.set(key, run);
    resetSafetyTimer(key, safetyMs);
    emitChange();
    return { runId: run.runId, commandName: run.commandName, startedAt: run.startedAt };
}

export function clearRun(instanceId, commandName) {
    const key = runKey(instanceId, normalizeTrackedCommandName(commandName));
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
    let changed = false;
    for (const [key, run] of Array.from(activeRuns.entries())) {
        if (event.kind === "turn-start" && event.at >= run.startedAtMs) {
            run.turnStartedAtMs = event.at;
            continue;
        }
        if (!isTerminalSessionActivity(event)) continue;
        if (event.awaitingUserInput) continue;
        if (!Number.isFinite(run.turnStartedAtMs)) continue;
        if (event.at < run.turnStartedAtMs) continue;
        activeRuns.delete(key);
        clearSafetyTimer(key);
        changed = true;
    }
    if (changed) {
        emitChange();
        return;
    }
    emitChange();
}

function isTerminalSessionActivity(event) {
    return event.kind === "turn-end" || event.kind === "session-idle";
}

export function phaseKeyForCommand(commandName) {
    const normalized = normalizeTrackedCommandName(commandName);
    if (typeof normalized !== "string") return "";
    if (normalized.startsWith("commands/")) return normalized;
    if (!normalized.startsWith("speckit.")) return normalized;
    const phase = normalized.slice("speckit.".length);
    return PHASE_BY_ID[phase] ? phase : `commands/${commandName}`;
}

function normalizeTrackedCommandName(commandName) {
    if (typeof commandName !== "string") return "";
    const name = commandName.startsWith("/") ? commandName.slice(1) : commandName;
    const hyphenMatch = /^speckit-([a-z0-9_]+)$/i.exec(name);
    if (hyphenMatch && PHASE_BY_ID[hyphenMatch[1]]) {
        return `speckit.${hyphenMatch[1]}`;
    }
    return name;
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
