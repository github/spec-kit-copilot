// Lightweight phase status token tracking.
//
// Chat owns execution progress, while the scanner owns artifact availability.
// These tokens protect canonical phase status callbacks from stale writes.
// Tokens do not appear in UI snapshots.

import { PHASE_BY_ID } from "./wizard-phases.mjs";

const activeTokens = new Map();
const reportableTokens = new Map();
let sequence = 0;

function runKey(instanceId, commandName) {
    return `${instanceId}::${commandName}`;
}

export function beginRun(instanceId, commandName, { startedAtMs = Date.now() } = {}) {
    const trackedCommandName = normalizeTrackedCommandName(commandName);
    if (!instanceId || !trackedCommandName) return null;
    const key = runKey(instanceId, trackedCommandName);
    const run = {
        runId: `run-${++sequence}`,
        instanceId,
        commandName: trackedCommandName,
        startedAt: new Date(startedAtMs).toISOString(),
        startedAtMs,
    };
    activeTokens.set(key, run);
    reportableTokens.delete(key);
    return { runId: run.runId, commandName: run.commandName, startedAt: run.startedAt };
}

export function clearRun(instanceId, commandName, runId = null) {
    const key = runKey(instanceId, normalizeTrackedCommandName(commandName));
    const run = activeTokens.get(key);
    if (!run) return false;
    if (runId && run.runId !== runId) return false;
    activeTokens.delete(key);
    reportableTokens.delete(key);
    return true;
}

export function finishRun(instanceId, commandName, runId, { allowReport = false } = {}) {
    const key = runKey(instanceId, normalizeTrackedCommandName(commandName));
    const run = activeTokens.get(key);
    if (!run || !runId || run.runId !== runId) return false;
    activeTokens.delete(key);
    if (allowReport) {
        reportableTokens.set(key, { runId });
    } else {
        reportableTokens.delete(key);
    }
    return true;
}

export function consumeReportableRun(instanceId, commandName, runId) {
    if (!runId) return false;
    const key = runKey(instanceId, normalizeTrackedCommandName(commandName));
    const reportable = reportableTokens.get(key);
    if (reportable?.runId !== runId) return false;
    reportableTokens.delete(key);
    return true;
}

export function activeRunMatches(instanceId, commandName, runId) {
    if (!runId) return false;
    const key = runKey(instanceId, normalizeTrackedCommandName(commandName));
    return activeTokens.get(key)?.runId === runId;
}

export function hasActiveRun(instanceId, commandName) {
    const key = runKey(instanceId, normalizeTrackedCommandName(commandName));
    return activeTokens.has(key);
}

export function __resetRunTrackerForTests() {
    activeTokens.clear();
    reportableTokens.clear();
    sequence = 0;
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
