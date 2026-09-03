// Server-owned phase run tracking.
//
// Dispatch starts a run. Wizard-owned completion signals clear it: phase status
// reports, scanner-observed artifact timestamps, or the safety timeout. SDK idle
// is only a fallback and is ignored while the agent is waiting on user input.

import { ensureSessionActivity, onSessionActivity } from "./session-activity.mjs";
import { PHASE_BY_ID } from "./wizard-phases.mjs";

export const RUN_TRACKER_SAFETY_MS = 5 * 60 * 1000;

const activeRuns = new Map(); // commandName -> { runId, commandName, startedAt, startedAtMs }
const safetyTimers = new Map();
const listeners = new Set();
let sequence = 0;
let activitySubscription = null;

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

export function beginRun(commandName, { startedAtMs = Date.now() } = {}) {
    if (!commandName) return null;
    const run = {
        runId: `run-${++sequence}`,
        commandName,
        startedAt: new Date(startedAtMs).toISOString(),
        startedAtMs,
    };
    activeRuns.set(commandName, run);
    resetSafetyTimer(commandName);
    emitChange();
    return { runId: run.runId, commandName: run.commandName, startedAt: run.startedAt };
}

export function clearRun(commandName) {
    if (!activeRuns.has(commandName)) return false;
    activeRuns.delete(commandName);
    clearSafetyTimer(commandName);
    emitChange();
    return true;
}

export function activeRunsSnapshot() {
    return Array.from(activeRuns.values())
        .sort((a, b) => a.startedAtMs - b.startedAtMs)
        .map(({ runId, commandName, startedAt }) => ({ runId, commandName, startedAt }));
}

export function reconcileRunsWithPhases(phases) {
    if (!phases || typeof phases !== "object") return false;
    let changed = false;
    for (const [commandName, run] of Array.from(activeRuns.entries())) {
        const phase = phases[phaseKeyForCommand(commandName)];
        const lastRunAtMs = Date.parse(phase?.lastRunAt);
        if (Number.isFinite(lastRunAtMs) && lastRunAtMs > run.startedAtMs) {
            activeRuns.delete(commandName);
            clearSafetyTimer(commandName);
            changed = true;
        }
    }
    if (changed) emitChange();
    return changed;
}

export function __resetRunTrackerForTests() {
    for (const commandName of Array.from(safetyTimers.keys())) clearSafetyTimer(commandName);
    activeRuns.clear();
    listeners.clear();
    sequence = 0;
    if (activitySubscription) {
        try { activitySubscription(); } catch { /* ignore */ }
        activitySubscription = null;
    }
}

function handleSessionActivity(event) {
    if (event?.kind !== "session-idle") return;
    if (event.awaitingUserInput) return;
    const idleAt = Number.isFinite(event.at) ? event.at : Date.now();
    let changed = false;
    for (const [commandName, run] of Array.from(activeRuns.entries())) {
        if (run.startedAtMs <= idleAt) {
            activeRuns.delete(commandName);
            clearSafetyTimer(commandName);
            changed = true;
        }
    }
    if (changed) emitChange();
}

function phaseKeyForCommand(commandName) {
    if (typeof commandName !== "string") return "";
    if (commandName.startsWith("commands/")) return commandName;
    if (!commandName.startsWith("speckit.")) return commandName;
    const phase = commandName.slice("speckit.".length);
    return PHASE_BY_ID[phase] ? phase : `commands/${commandName}`;
}

function resetSafetyTimer(commandName) {
    clearSafetyTimer(commandName);
    const timer = setTimeout(() => {
        if (activeRuns.delete(commandName)) emitChange();
        safetyTimers.delete(commandName);
    }, RUN_TRACKER_SAFETY_MS);
    timer.unref?.();
    safetyTimers.set(commandName, timer);
}

function clearSafetyTimer(commandName) {
    const timer = safetyTimers.get(commandName);
    if (!timer) return;
    clearTimeout(timer);
    safetyTimers.delete(commandName);
}

function emitChange() {
    const snapshot = activeRunsSnapshot();
    for (const listener of Array.from(listeners)) {
        try { listener(snapshot); } catch { /* isolate listeners */ }
    }
}
