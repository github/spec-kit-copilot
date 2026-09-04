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
//
// The wizard is designed for one active command per canvas instance. The
// tracker prevents accidental duplicate clicks, but timeout favors recovery:
// once the safety window expires, the run is removed so the user can retry.
// Generic session turn correlation is best-effort UX cleanup, not a strict
// concurrency scheduler.

import { ensureSessionActivity, onSessionActivity } from "./session-activity.mjs";
import { PHASE_BY_ID } from "./wizard-phases.mjs";

export const RUN_TRACKER_SAFETY_MS = 5 * 60 * 1000;
const TERMINAL_PHASE_STATUSES = new Set(["done", "skipped", "error"]);

// runKey (`${instanceId}::${commandName}`) -> { runId, instanceId, commandName, startedAt, startedAtMs, turnStartedAtMs }
const activeRuns = new Map();
const dispatchQueue = [];
const safetyTimers = new Map();
const listeners = new Set();
let sequence = 0;
let dispatchSequence = 0;
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

export function clearRun(instanceId, commandName, runId = null) {
    const key = runKey(instanceId, normalizeTrackedCommandName(commandName));
    const run = activeRuns.get(key);
    if (!run) return false;
    if (runId && run.runId !== runId) return false;
    removeRun(key);
    emitChange();
    return true;
}

export function activeRunMatches(instanceId, commandName, runId) {
    if (!runId) return false;
    const key = runKey(instanceId, normalizeTrackedCommandName(commandName));
    return activeRuns.get(key)?.runId === runId;
}

export function activeRunsSnapshot(instanceId) {
    return Array.from(activeRuns.values())
        .filter((run) => run.instanceId === instanceId)
        .sort((a, b) => a.startedAtMs - b.startedAtMs)
        .map(({ runId, commandName, startedAt }) => ({ runId, commandName, startedAt }));
}

export function registerSessionDispatch({ instanceId = null, commandName = null, runId = null } = {}) {
    const trackedCommandName = normalizeTrackedCommandName(commandName);
    const key = instanceId && trackedCommandName && runId
        ? runKey(instanceId, trackedCommandName)
        : null;
    const dispatch = {
        dispatchId: `dispatch-${++dispatchSequence}`,
        instanceId,
        commandName: trackedCommandName || null,
        runId: runId || null,
        runKey: key,
        sent: false,
        turnStartedAtMs: null,
    };
    dispatchQueue.push(dispatch);
    return dispatch.dispatchId;
}

export function markSessionDispatchSent(dispatchId, sentAtMs = Date.now()) {
    const dispatch = dispatchQueue.find((item) => item.dispatchId === dispatchId);
    if (!dispatch) return false;
    dispatch.sent = true;
    dispatch.sentAtMs = sentAtMs;
    return true;
}

export function failSessionDispatch(dispatchId) {
    const index = dispatchQueue.findIndex((item) => item.dispatchId === dispatchId);
    if (index < 0) return false;
    const [dispatch] = dispatchQueue.splice(index, 1);
    const changed = clearDispatchRun(dispatch);
    if (changed) emitChange();
    return true;
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
            removeRun(key);
            changed = true;
        }
    }
    if (changed) emitChange();
    return changed;
}

export function __resetRunTrackerForTests() {
    for (const key of Array.from(safetyTimers.keys())) clearSafetyTimer(key);
    activeRuns.clear();
    dispatchQueue.length = 0;
    listeners.clear();
    sequence = 0;
    dispatchSequence = 0;
    if (activitySubscription) {
        try { activitySubscription(); } catch { /* ignore */ }
        activitySubscription = null;
    }
}

function handleSessionActivity(event) {
    if (!event) return;
    if (!activeRuns.size && !dispatchQueue.length) return;
    if (event.kind === "turn-start") {
        correlateRunWithTurnStart(event.at);
        emitChange();
        return;
    }
    let changed = false;
    if (isTerminalSessionActivity(event) && !event.awaitingUserInput) {
        const dispatchIndex = dispatchQueue.findIndex((item) => Number.isFinite(item.turnStartedAtMs));
        if (dispatchIndex >= 0) {
            const [dispatch] = dispatchQueue.splice(dispatchIndex, 1);
            if (event.at >= dispatch.turnStartedAtMs) {
                changed = clearDispatchRun(dispatch);
            }
        }
    }
    if (changed) {
        emitChange();
        return;
    }
    emitChange();
}

function correlateRunWithTurnStart(turnStartedAtMs) {
    const dispatch = dispatchQueue.find((item) => item.sent && !Number.isFinite(item.turnStartedAtMs));
    if (!dispatch) return;
    dispatch.turnStartedAtMs = turnStartedAtMs;
    const run = dispatch.runKey ? activeRuns.get(dispatch.runKey) : null;
    if (run && run.runId === dispatch.runId) run.turnStartedAtMs = turnStartedAtMs;
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
    return PHASE_BY_ID[phase] ? phase : `commands/${normalized}`;
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
        if (activeRuns.has(key)) {
            removeRun(key);
            emitChange();
        } else {
            safetyTimers.delete(key);
        }
    }, safetyMs);
    timer.unref?.();
    safetyTimers.set(key, timer);
}

function clearDispatchRun(dispatch) {
    if (!dispatch?.runKey || !dispatch.runId) return false;
    const run = activeRuns.get(dispatch.runKey);
    if (!run || run.runId !== dispatch.runId) return false;
    removeRun(dispatch.runKey);
    return true;
}

function removeRun(key) {
    activeRuns.delete(key);
    clearSafetyTimer(key);
    for (let i = dispatchQueue.length - 1; i >= 0; i -= 1) {
        if (dispatchQueue[i]?.runKey === key) dispatchQueue.splice(i, 1);
    }
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
