// Lightweight phase status token tracking.
//
// Chat owns execution progress, while the scanner owns artifact availability.
// These tokens protect canonical phase status callbacks from stale writes
// and prevent overlapping runs. Tokens do not appear in UI snapshots.

import { PHASE_BY_ID } from "./wizard-phases.mjs";

const activeTokens = new Map();
const RUN_TOKEN_TTL_MS = 30 * 60 * 1000;
let sequence = 0;

function runKey(instanceId, commandName) {
    return `${instanceId}::${commandName}`;
}

export function beginRun(instanceId, commandName, { startedAtMs = Date.now(), expiresAfterMs = RUN_TOKEN_TTL_MS } = {}) {
    const trackedCommandName = normalizeTrackedCommandName(commandName);
    if (!instanceId || !trackedCommandName) return null;
    const key = runKey(instanceId, trackedCommandName);
    if (activeTokens.has(key)) throw new Error("phase run already active");
    const run = {
        runId: `run-${++sequence}`,
        instanceId,
        commandName: trackedCommandName,
        startedAt: new Date(startedAtMs).toISOString(),
        startedAtMs,
        timeout: setTimeout(() => clearRun(instanceId, trackedCommandName, run.runId), expiresAfterMs),
    };
    run.timeout.unref?.();
    activeTokens.set(key, run);
    return { runId: run.runId, commandName: run.commandName, startedAt: run.startedAt };
}

export function clearRun(instanceId, commandName, runId = null) {
    const key = runKey(instanceId, normalizeTrackedCommandName(commandName));
    const run = activeTokens.get(key);
    if (!run) return false;
    if (runId && run.runId !== runId) return false;
    clearTimeout(run.timeout);
    activeTokens.delete(key);
    return true;
}

export function activeRunMatches(instanceId, commandName, runId) {
    if (!runId) return false;
    const key = runKey(instanceId, normalizeTrackedCommandName(commandName));
    return activeTokens.get(key)?.runId === runId;
}

export function __resetRunTrackerForTests() {
    for (const run of activeTokens.values()) clearTimeout(run.timeout);
    activeTokens.clear();
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
