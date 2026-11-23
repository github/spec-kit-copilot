import { commandAliasKey } from "../pipeline/effective-phases.mjs";

const commandRuns = new Map();
let sequence = 0;

function runsFor(instanceId, create = false) {
    let runs = commandRuns.get(instanceId);
    if (!runs && create) {
        runs = new Map();
        commandRuns.set(instanceId, runs);
    }
    return runs;
}

export function beginCommandRun(instanceId, commandId, runId = null) {
    const normalized = commandAliasKey(commandId);
    if (!instanceId || !normalized) return null;
    const id = runId ?? `command-run-${++sequence}`;
    const sourceCommandId = commandId.replace(/^\/+/, "").replace(/^commands\//, "");
    const run = { commandId: normalized, sourceCommandId, runId: id, consumed: false };
    runsFor(instanceId, true).set(normalized, run);
    return { ...run };
}

export function clearCommandRun(instanceId, commandId, runId) {
    const normalized = commandAliasKey(commandId);
    const runs = runsFor(instanceId);
    const run = runs?.get(normalized);
    if (!run || run.runId !== runId) return false;
    runs.delete(normalized);
    if (!runs.size) commandRuns.delete(instanceId);
    return true;
}

export function consumeCommandRun(instanceId, commandId, runId) {
    const normalized = commandAliasKey(commandId);
    const run = runsFor(instanceId)?.get(normalized);
    if (!run || run.runId !== runId || run.consumed) return false;
    run.consumed = true;
    return { ...run };
}

export function currentCommandRunMatches(instanceId, commandId, runId) {
    const normalized = commandAliasKey(commandId);
    const run = runsFor(instanceId)?.get(normalized);
    return Boolean(run && run.runId === runId && run.consumed);
}

export function commandRunMatches(instanceId, commandId, runId) {
    const normalized = commandAliasKey(commandId);
    return runsFor(instanceId)?.get(normalized)?.runId === runId;
}

export function clearCommandRunsForInstance(instanceId) {
    commandRuns.delete(instanceId);
}

export function __resetCommandRunsForTests() {
    commandRuns.clear();
    sequence = 0;
}
