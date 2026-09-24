// Latest phase runs and accepted reporting results, not an execution history.
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { resolveWorkspaceDirectory } from "./workspace-files.mjs";
import { validateWorkflowSlug } from "../ui/workflow-slug.mjs";
import { RESPONSE_LIMIT } from "../phase-response.mjs";

const LIMIT = 512 * 1024;
const writes = new Map();
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const validSlug = (value) => typeof value === "string" && value.length > 0
    && validateWorkflowSlug(value).slug === value && !validateWorkflowSlug(value).error;
const empty = () => ({ version: 1, items: [], pending: [], binding: null });

function artifactField(content, field) {
    if (typeof content !== "string") return null;
    content = content.replace(/\r\n/g, "\n");
    if (!content.startsWith("---\n")) return null;
    const end = content.indexOf("\n---\n", 4);
    if (end < 0 || end > 16 * 1024) return null;
    const entries = content.slice(4, end).split("\n")
        .filter((line) => line.startsWith(`${field}:`));
    if (entries.length !== 1) return null;
    const value = entries[0].slice(field.length + 1).trim();
    const id = value.match(/^([a-zA-Z0-9][a-zA-Z0-9._-]*)$|^"([a-zA-Z0-9][a-zA-Z0-9._-]*)"$|^'([a-zA-Z0-9][a-zA-Z0-9._-]*)'$/);
    return id?.slice(1).find(Boolean) ?? null;
}

export function currentPhaseSummary(steps, evidence, runs, phaseResults, options = {}) {
    const phases = {};
    const seen = new Map();
    let pendingClarifications = 0;
    const tasks = { complete: 0, total: 0 };
    for (const step of steps) {
        const current = evidence[step.instanceKey] ?? {};
        const run = runs.find((entry) => entry.phase === step.instanceKey);
        const stale = Boolean(run?.completed && runs.some((upstream) =>
            steps.findIndex((phase) => phase.instanceKey === upstream.phase)
                < steps.findIndex((phase) => phase.instanceKey === step.instanceKey)
            && (!upstream.completed || upstream.sequence > run.sequence)));
        const status = !run ? "pending" : !run.completed ? "running"
            : run.error ? "failed" : stale ? "stale" : "completed";
        const unresolved = Number.isInteger(current.clarificationCount)
            ? Math.max(0, current.clarificationCount) : 0;
        pendingClarifications += unresolved;
        const configured = phaseResults.get(step.instanceKey);
        let id = null;
        if (status === "completed" && configured && unresolved === 0
            && (!step.artifact?.pathTemplate || current.artifact)) {
            if (configured.source.kind === "phase-report") {
                id = run.reporting?.settledId ?? null;
            } else if (configured.source.kind === "artifact-field"
                && Number.isFinite(current.mtimeMs)
                && Number.isFinite(run.startedAt)
                && current.mtimeMs >= run.startedAt - 1000) {
                id = artifactField(current.content, configured.source.field);
            }
        }
        const value = configured?.values.find((entry) => entry.id === id);
        const result = value ? {
            id: value.id, label: value.label, tone: value.tone, summary: configured.summary,
        } : null;
        phases[step.instanceKey] = { status, clarificationCount: unresolved, result };
        if (result?.summary) seen.set(result.label, {
            id: result.id, label: result.label, tone: result.tone,
        });
        if (step.commandName === "speckit.tasks" && typeof current.content === "string") {
            for (const match of current.content.matchAll(/^\s*-\s*\[([ xX])\]/gm)) {
                tasks.total++;
                if (match[1].toLowerCase() === "x") tasks.complete++;
            }
        }
    }
    return {
        phases, results: [...seen.values()], clarificationCount: pendingClarifications,
        ...(options.showProgress ? { progress: tasks } : {}),
    };
}

// Reporting only: artifact times where known, completed run order otherwise.
export function milestoneTags(steps, evidence, runs, labels) {
    const upstream = [], tags = new Set();
    for (const step of steps) {
        const current = evidence[step.instanceKey] ?? {};
        const run = runs.find((entry) => entry.phase === step.instanceKey);
        const result = run?.result;
        const sequence = result?.sequence ?? (run?.completed ? run.sequence : 0);
        const timed = Number.isFinite(current.mtimeMs);
        const fresh = !(result?.artifact && !timed) && upstream.every((prior) => {
            if (!prior.fresh) return false;
            if (prior.artifact && prior.artifact === current.artifact) return true;
            return Number.isFinite(prior.mtimeMs) && timed ? prior.mtimeMs <= current.mtimeMs
                : !sequence || prior.sequence <= sequence;
        });
        let tasksComplete = true;
        if (step.commandName === "speckit.implement") {
            const taskEvidence = /(?:^|\/)tasks\.md$/.test(current.artifact ?? "") ? current
                : upstream.findLast((entry) => entry.commandName === "speckit.tasks");
            if (typeof taskEvidence?.content === "string") {
                const tasks = [...taskEvidence.content.matchAll(/^\s*-\s*\[([ xX])\]/gm)];
                tasksComplete = tasks.length > 0 && tasks.every((task) => task[1].toLowerCase() === "x");
            }
        }
        if (fresh && tasksComplete && !(current.clarificationCount > 0) && labels.includes(result?.label)) tags.add(result.label);
        upstream.push({ ...current, commandName: step.commandName, fresh,
            sequence: run?.completed ? run.sequence : result?.sequence ?? 0 });
    }
    return [...tags];
}

export function createPhaseRunStore({ extensionId, pipeline, phaseResults = new Map() }) {
    const steps = pipeline.pipeline.steps;
    const phaseKeys = new Set(steps.map((step) => step.instanceKey));
    const contract = [extensionId, pipeline.runtime, steps.map((step) => [step.instanceKey, step.invocation])];
    const key = (inst) => hash([resolve(inst.cwd), contract]);

    async function location(inst, create = false) {
        for (const relative of [".speckit-canvas", ".speckit-canvas/phase-runs"]) {
            if (create) await mkdir(join(inst.cwd, relative)).catch((error) => { if (error.code !== "EEXIST") throw error; });
            await resolveWorkspaceDirectory(inst.cwd, relative);
        }
        return join(await resolveWorkspaceDirectory(inst.cwd, ".speckit-canvas/phase-runs"), `${key(inst)}.json`);
    }

    function validate(record) {
        const runsValid = (runs) => runs === undefined || (Array.isArray(runs)
            && new Set(runs.map((run) => run?.phase)).size === runs.length
            && runs.every((run) => run && phaseKeys.has(run.phase) && typeof run.runId === "string" && run.runId
                && typeof run.messageId === "string" && typeof run.sessionId === "string"
                && Number.isSafeInteger(run.sequence) && run.sequence > 0 && typeof run.completed === "boolean"
                && (run.startedAt === undefined || Number.isFinite(run.startedAt) && run.startedAt > 0)
                && (run.response === null || (typeof run.response === "string" && Buffer.byteLength(run.response) <= RESPONSE_LIMIT))
                && (run.error === null || typeof run.error === "string")
                && (run.reporting === undefined || (run.reporting && typeof run.reporting.instanceId === "string"
                    && run.reporting.instanceId.length > 0
                    && typeof run.reporting.instanceToken === "string" && run.reporting.instanceToken.length > 0
                    && Array.isArray(run.reporting.allowed) && run.reporting.allowed.length > 0
                    && run.reporting.allowed.every((id) => typeof id === "string" && id.length > 0)
                    && phaseResults.get(run.phase)?.source.kind === "phase-report"
                    && JSON.stringify(run.reporting.allowed) === JSON.stringify(
                        phaseResults.get(run.phase).values.map((value) => value.id))
                    && (run.reporting.resultId === null || run.reporting.allowed.includes(run.reporting.resultId))
                    && (run.reporting.settledId === null || run.reporting.allowed.includes(run.reporting.settledId))))
                && (run.result === undefined || (run.result && Number.isSafeInteger(run.result.sequence)
                    && run.result.sequence > 0 && run.result.sequence <= run.sequence
                    && (run.result.label === null || typeof run.result.label === "string" && run.result.label.length <= 60)
                    && (run.result.artifact === null || typeof run.result.artifact === "string")))));
        const phasesValid = (phases) => Array.isArray(phases) && phases.every((phase) => phaseKeys.has(phase))
            && new Set(phases).size === phases.length;
        if (record?.version !== 1 || !Array.isArray(record.items)
            || (record.sequence !== undefined && (!Number.isSafeInteger(record.sequence) || record.sequence < 0))
            || record.items.some((item) => !item || !(item.id === "project" || validSlug(item.id)) || !phasesValid(item.phases))
            || record.items.some((item) => !runsValid(item.runs))
            || new Set(record.items.map((item) => item.id)).size !== record.items.length
            || !(record.binding === null || validSlug(record.binding))
            || !Array.isArray(record.pending)
            || new Set(record.pending.map((entry) => entry?.slug)).size !== record.pending.length
            || record.pending.some((entry) => !entry || !phasesValid(entry.phases)
                || !runsValid(entry.runs)
                || !(entry.slug === null || validSlug(entry.slug))
                || !entry.baseline || typeof entry.baseline !== "object" || Array.isArray(entry.baseline)
                || !Object.entries(entry.baseline).every(([slug, time]) => validSlug(slug) && Number.isFinite(time)))) {
            throw new Error("Malformed phase run state");
        }
        return record;
    }

    async function read(inst) {
        let handle;
        try {
            const file = await location(inst);
            const stat = await lstat(file);
            if (!stat.isFile() || stat.isSymbolicLink() || stat.size > LIMIT) throw new Error("Unsafe phase run state");
            handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
            const opened = await handle.stat();
            if (!opened.isFile() || opened.size > LIMIT || opened.ino !== stat.ino || opened.dev !== stat.dev) {
                throw new Error("Phase run state changed during read");
            }
            const bytes = Buffer.alloc(LIMIT + 1);
            const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
            if (bytesRead > LIMIT) throw new Error("Oversized phase run state");
            return validate(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, bytesRead))));
        } catch (error) {
            if (error.code === "ENOENT") return empty();
            throw Object.assign(new Error("Cannot read phase run state. Check .speckit-canvas/phase-runs and reopen the canvas.", {
                cause: error,
            }), { code: "PHASE_RUN_STATE" });
        } finally { await handle?.close(); }
    }

    async function update(inst, change) {
        const scope = key(inst);
        const pending = (writes.get(scope) ?? Promise.resolve()).catch(() => {}).then(async () => {
            const record = await read(inst);
            const before = JSON.stringify(record);
            change(record);
            const payload = JSON.stringify(validate(record));
            if (payload === before) return record;
            if (Buffer.byteLength(payload) > LIMIT) throw new Error("Phase run state exceeds the storage limit.");
            const file = await location(inst, true);
            const temporary = `${file}.${randomUUID()}.pending`;
            let handle;
            try {
                handle = await open(temporary, "wx", 0o600);
                await handle.writeFile(payload, "utf8");
                await handle.sync();
                await handle.close();
                handle = null;
                await location(inst);
                await read(inst);
                await rename(temporary, file);
            } finally {
                await handle?.close();
                await unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; });
            }
            return record;
        });
        writes.set(scope, pending);
        try { return await pending; }
        finally { if (writes.get(scope) === pending) writes.delete(scope); }
    }

    function mergeRuns(...groups) {
        const runs = new Map();
        for (const run of groups.flatMap((group) => group ?? [])) {
            if (!runs.has(run.phase) || runs.get(run.phase).sequence < run.sequence) runs.set(run.phase, run);
        }
        return [...runs.values()];
    }

    function add(record, id, phases, runs) {
        let item = record.items.find((entry) => entry.id === id);
        if (!item) record.items.push(item = { id, phases: [] });
        item.phases = [...new Set([...item.phases, ...phases])];
        if (runs?.length) item.runs = mergeRuns(item.runs, runs);
        return item;
    }

    return {
        read,
        forItem(record, item) {
            return mergeRuns(
                record.pending.find((entry) => entry.slug === (item.isNew ? null : item.slug))?.runs,
                !item.isNew ? record.items.find((entry) => entry.id === item.id)?.runs : [],
            );
        },
        async rememberResults(inst, itemId, results) {
            return update(inst, (record) => {
                const item = record.items.find((entry) => entry.id === itemId);
                for (const result of results) {
                    const run = item?.runs?.find((entry) => entry.runId === result.runId && entry.completed);
                    if (run) run.result = { label: result.label, artifact: result.artifact, sequence: run.sequence };
                }
            });
        },
        async complete(inst, runId, result) {
            let accepted = false;
            await update(inst, (record) => {
                for (const entry of [...record.items, ...record.pending]) {
                    const run = entry.runs?.find((run) => run.runId === runId);
                    if (run && (!run.completed || run.response !== result.response || run.error !== result.error)) {
                        Object.assign(run, { completed: true, response: result.response, error: result.error });
                        if (run.reporting) {
                            run.reporting.settledId = result.error === null ? run.reporting.resultId : null;
                        }
                        accepted = true;
                    }
                }
            });
            return accepted;
        },
        async report(inst, runId, resultId) {
            let accepted = false;
            await update(inst, (record) => {
                const run = [...record.items, ...record.pending].flatMap((entry) => entry.runs ?? [])
                    .find((entry) => entry.runId === runId);
                if (!run || !run.reporting || run.reporting.instanceId !== inst.instanceId
                    || run.reporting.instanceToken !== inst.reportingToken) {
                    throw new Error("Unknown or stale phase reporting run");
                }
                if (!run.reporting.allowed.includes(resultId)) throw new Error("Result ID is not allowed for this phase");
                if (run.reporting.resultId && run.reporting.resultId !== resultId) {
                    throw new Error("Conflicting result for this phase run");
                }
                if (run.completed && run.reporting.settledId !== resultId) {
                    throw new Error("Phase run has already completed");
                }
                run.reporting.resultId = resultId;
                accepted = true;
            });
            return { ok: accepted, phaseRunId: runId, resultId };
        },
        async bindDispatch(inst, runId, messageId, sessionId) {
            if (typeof messageId !== "string" || !messageId) {
                throw new Error("Phase dispatch did not return a message ID");
            }
            await update(inst, (record) => {
                const run = [...record.items, ...record.pending].flatMap((entry) => entry.runs ?? [])
                    .find((entry) => entry.runId === runId && entry.reporting);
                if (!run || run.messageId) throw new Error("Phase reporting run cannot be bound to dispatch");
                run.messageId = messageId;
                run.sessionId = sessionId;
            });
        },
        async abortDispatch(inst, runId, undo) {
            await update(inst, (record) => {
                const collection = undo.pending ? record.pending : record.items;
                const target = collection.find((entry) =>
                    (undo.pending ? entry.slug : entry.id) === undo.key);
                if (!target?.runs?.some((run) => run.runId === runId)) {
                    throw new Error("Phase reporting run changed before dispatch rollback");
                }
                target.runs = target.runs.filter((run) => run.runId !== runId);
                if (undo.previous) target.runs.push(undo.previous);
                if (!target.runs.length) delete target.runs;
                if (!undo.hadPhase) target.phases = target.phases.filter((phase) => phase !== undo.phase);
                if (!target.phases.length) collection.splice(collection.indexOf(target), 1);
                if (undo.restoreBinding && record.binding === undo.boundSlug) {
                    record.binding = undo.binding;
                }
            });
        },
        async mark(inst, item, phase, { slug = null, baseline = {}, run = null, reporting = null } = {}) {
            let undo;
            await update(inst, (record) => {
                const pending = item.isNew;
                const key = pending ? slug : item.id;
                const existing = pending ? record.pending.find((entry) => entry.slug === slug)
                    : record.items.find((entry) => entry.id === item.id);
                undo = {
                    pending, key, phase, binding: record.binding,
                    restoreBinding: !pending && Boolean(pipeline.runtime?.itemRoot)
                        && pipeline.runtime?.multiInstance !== true,
                    boundSlug: item.slug,
                    hadPhase: existing?.phases.includes(phase) ?? false,
                    previous: existing?.runs?.find((entry) => entry.phase === phase) ?? null,
                };
                let target;
                if (item.isNew) {
                    let pending = record.pending.find((entry) => entry.slug === slug);
                    if (!pending) record.pending.push(pending = { slug, baseline, phases: [] });
                    pending.phases = [...new Set([...pending.phases, phase])];
                    target = pending;
                } else {
                    target = add(record, item.id, [phase]);
                    if (pipeline.runtime?.itemRoot && !pipeline.runtime?.multiInstance) record.binding = item.slug;
                }
                if (run) {
                    record.sequence = (record.sequence ?? 0) + 1;
                    const result = target.runs?.find((entry) => entry.phase === phase)?.result;
                    target.runs = mergeRuns(target.runs, [{ ...run, phase, sequence: record.sequence,
                        startedAt: Date.now(),
                        completed: false, response: null, error: null,
                        ...(reporting ? { reporting: { ...reporting, resultId: null, settledId: null } } : {}),
                        ...(result ? { result } : {}) }]);
                }
            });
            return undo;
        },
        async reconcile(inst, discovered) {
            let error = null;
            const record = await update(inst, (record) => {
                const named = new Set([...record.items.map((item) => item.id), ...record.pending.map((entry) => entry.slug).filter(Boolean)]);
                for (const pending of [...record.pending]) {
                    const candidates = discovered.filter((item) => pending.slug ? item.slug === pending.slug
                        : !named.has(item.slug) && (!Object.hasOwn(pending.baseline, item.slug)
                            || (!pipeline.runtime?.multiInstance && item.lastActivity > pending.baseline[item.slug])));
                    if (candidates.length > 1) {
                        error = "Multiple workflow folders appeared after dispatch. The canvas cannot assign the phase run to a workflow.";
                    } else if (candidates.length === 1) {
                        add(record, candidates[0].id, pending.phases, pending.runs);
                        if (!pipeline.runtime?.multiInstance) record.binding = candidates[0].slug;
                        record.pending = record.pending.filter((entry) => entry !== pending);
                    }
                }
            });
            return { record, error };
        },
        async forget(inst, id) {
            return update(inst, (record) => {
                record.items = record.items.filter((item) => item.id !== id);
                record.pending = record.pending.filter((entry) => entry.slug !== id);
                if (record.binding === id) record.binding = null;
            });
        },
    };
}
