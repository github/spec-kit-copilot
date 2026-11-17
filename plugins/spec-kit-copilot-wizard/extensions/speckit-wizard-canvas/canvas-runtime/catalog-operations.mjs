import { realpath } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { CATALOG_FIELDS, mutateCatalogPackage } from "../server/catalog-operations.mjs";
import { CatalogOperationError, validateCatalogResult } from "../contracts/catalog-operation.mjs";
import { sessionAdapter } from "./instances.mjs";
import { runSkillsReload } from "../server/handlers-ops.mjs";
import { persistAndBroadcast, runFastComposition } from "./composition-apply.mjs";
import { isCurrentRefresh } from "./refresh-status.mjs";
import { snapshot } from "./snapshot.mjs";

const mutations = new Set();

export function reconcileCatalogInventories(inst, inventories, installed) {
    for (const [group, field] of Object.entries(CATALOG_FIELDS)) {
        const remaining = new Set(inventories[group].map((item) => item.id));
        inst[field] = (inst[field] ?? []).map((item) => {
            const selected = installed?.request.group === group
                && installed.selected.id === item.id && installed.selected.source === item.source;
            const id = selected ? installed.id : item.installedId ?? item.id;
            const actual = inventories[group].find((entry) => entry.id === id);
            if (actual) remaining.delete(actual.id);
            return { ...item, active: !!actual, ...(actual ? { installedId: actual.id } : {}) };
        });
        for (const actual of inventories[group].filter((item) => remaining.has(item.id))) {
            inst[field].push({ id: actual.id, installedId: actual.id, name: actual.name ?? actual.id,
                description: actual.description ?? "", version: actual.version, active: true,
                source: actual.source?.catalog ?? "local" });
        }
        inst.broadcast({ type: `${group}-catalog`, items: [...inst[field]],
            ...(group === "preset" ? { activePresetId: inst.state?.preset ?? null } : {}) });
    }
}

export async function finishCatalogUpdate(inst, { reason, activePresetId,
    refresh = inst.refreshStatus } = {}) {
    if (!isCurrentRefresh(inst, refresh)) throw new Error("Catalog refresh superseded by newer refresh work");
    const result = await runFastComposition(inst, { reason });
    if (!result.ok) throw new Error(`Composition refresh failed: ${result.reason}`);
    const snap = activePresetId
        ? await persistAndBroadcast(inst, { preset: activePresetId })
        : await snapshot(inst, () => isCurrentRefresh(inst, refresh));
    if (!snap || !isCurrentRefresh(inst, refresh)) {
        throw new Error("Catalog refresh superseded by newer refresh work");
    }
    return { ok: true };
}

function effectiveSkills(inventories) {
    return JSON.stringify(["preset", "extension"].map((kind) =>
        inventories[kind].map(({ id, version, enabled, priority }) => ({ id, version, enabled, priority }))
            .sort((a, b) => a.id.localeCompare(b.id))));
}

function boundedReload(session, timeoutMs) {
    if (!session.rpc?.skills?.reload) return session;
    return { rpc: { skills: { reload: async () => {
        let timer;
        try {
            return await Promise.race([session.rpc.skills.reload(), new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error("Skills reload timed out; retry Reload skills")), timeoutMs);
            })]);
        } finally { clearTimeout(timer); }
    } } } };
}

export function catalogFailure(error) {
    return { ok: false, error: error.message, stage: error.stage ?? "completion",
        changed: error.changed === true, ...(error.timings ? { timings: error.timings } : {}) };
}

export async function runCatalogOperation(inst, kind, payload, {
    mutate = mutateCatalogPackage, reload = runSkillsReload, finish = finishCatalogUpdate,
    session = sessionAdapter(), reloadTimeoutMs = 120000, ...runner
} = {}) {
    if (!inst?.workspacePath) throw new CatalogOperationError("Workspace path unavailable");
    const project = await realpath(inst.workspacePath);
    const key = process.platform === "win32" ? project.toLowerCase() : project;
    if (mutations.has(key)) {
        throw new CatalogOperationError("Another package operation is running in this checkout; retry when it finishes",
            { status: 409, stage: "busy" });
    }
    mutations.add(key);
    const owners = { refresh: inst.refreshStatus };
    const started = performance.now();
    const timings = {};
    let before, after, changed = false, stage = "command", operation, failure;
    try {
        try {
            operation = await mutate(inst, kind, payload, { ...runner, observe: (inventory) => {
                before ??= inventory;
                after = inventory;
            } });
            ({ before, after, changed } = operation);
            Object.assign(timings, operation.timings);
        } catch (error) {
            failure = error;
            changed = error.changed === true;
            after = changed ? error.inventories : after;
            Object.assign(timings, error.timings);
        }
        if (after) {
            reconcileCatalogInventories(inst, after, operation ?? failure?.operation);
            // Seed from actual inventories, not a catalog's first-observation cache.
            for (const group of ["preset", "extension"]) {
                inst[group === "preset" ? "_lastInstalledPresetIds" : "_lastInstalledExtensionIds"]
                    = new Set(after[group].map((item) => item.id));
            }
        }
        let skillsReloaded = false;
        if (changed && !after) inst._catalogSkillsDirty = true;
        if (before && after && effectiveSkills(before) !== effectiveSkills(after)) inst._catalogSkillsDirty = true;
        if (after && inst._catalogSkillsDirty) {
            stage = "skills";
            const at = performance.now();
            const result = await reload({ session: boundedReload(session, reloadTimeoutMs),
                broadcast: inst.broadcast, getInstance: () => inst });
            timings.reload = performance.now() - at;
            skillsReloaded = result?.ok === true;
            if (skillsReloaded) inst._catalogSkillsDirty = false;
            else {
                const message = `Package state changed, but skills reload failed: ${result?.error ?? `${result?.errors ?? "unknown"} errors`}`;
                failure = new CatalogOperationError(failure ? `${failure.message}; ${message}` : message,
                    { status: 500, stage: "skills", changed });
            }
        }
        if (after && (operation || changed)) {
            stage = "composition";
            const at = performance.now();
            await finish(inst, { reason: "catalog operation", ...owners });
            timings.composition = performance.now() - at;
        }
        if (failure) throw failure;
        timings.total = performance.now() - started;
        return validateCatalogResult({ ok: true, id: operation.id, kind: operation.request.kind,
            outcome: changed ? "changed" : "already-satisfied", skillsReloaded, timings });
    } catch (cause) {
        const message = failure && failure !== cause ? `${failure.message}; ${cause.message}` : cause.message;
        const error = new CatalogOperationError(message,
            { status: cause.status ?? 500, stage: cause.stage ?? stage, changed, cause });
        error.timings = { ...timings, total: performance.now() - started };
        throw error;
    } finally {
        mutations.delete(key);
    }
}
