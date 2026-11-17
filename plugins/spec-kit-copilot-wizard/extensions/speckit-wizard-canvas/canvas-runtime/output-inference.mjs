import { commandId } from "../artifact-evidence.mjs";
import { randomUUID } from "node:crypto";
import { cancelBackgroundInference, releaseBackgroundInference } from "./background-inference.mjs";

const REQUEST_TIMEOUT_MS = 10 * 60 * 1000;

function isCurrentInference(inst, inference) {
    return !!inference && inst.outputInference === inference;
}

function finishIfIdle(inst, inference) {
    if (inference.pending.size || inference.workers.size) return;
    clearTimeout(inference.timer);
    inference.timer = null;
    inference.status = inference.failures.size ? "incomplete" : "complete";
    if (inference.status === "complete") {
        if (inst.outputInference === inference) inst.outputInference = null;
        if (inst.outputInferenceOwner === inference) inst.outputInferenceOwner = null;
    }
}

function notify(inst, reason) {
    inst.broadcast({ type: "invalidate", reason });
}

export function beginOutputInference(inst, requests) {
    if (!requests.length) return null;
    if (!inst.url || !inst.token) throw new Error("Artifact inference endpoint unavailable");
    let inference = inst.outputInference;
    if (!inference) {
        inference = {
            id: randomUUID(),
            status: "updating",
            total: 0,
            pending: new Map(),
            failures: new Map(),
            workers: new Map(),
        };
        inst.outputInference = inference;
        inst.outputInferenceOwner = inference;
    }
    if (!inference.timer) {
        inference.timer = setTimeout(() => {
            failOutputInference(inst, inference, undefined, "output inference timed out");
        }, REQUEST_TIMEOUT_MS);
        inference.timer.unref?.();
    }
    for (const request of requests) {
        const id = commandId(request.commandId);
        const previous = inference.pending.get(id);
        if (previous?.fingerprint === request.fingerprint) continue;
        inference.pending.set(id, request);
        inference.failures.delete(id);
        inference.total += 1;
    }
    inference.status = "updating";
    notify(inst, "output inference started");
    return inference;
}

export function createOutputInferenceWorker(inst, inference, requests) {
    if (!isCurrentInference(inst, inference) || inference.status !== "updating") {
        throw new Error("Output inference superseded by newer work");
    }
    const id = randomUUID();
    const worker = { id, requests: new Map(requests.map((request) =>
        [commandId(request.commandId), request])) };
    inference.workers.set(id, worker);
    const endpoint = new URL("/api/artifact-targets", inst.url);
    endpoint.searchParams.set("token", inst.token);
    endpoint.searchParams.set("runId", id);
    return { worker, endpoint };
}

export function findOutputInferenceWorker(inst, runId) {
    const inference = inst.outputInference;
    const worker = inference?.workers.get(runId);
    return worker ? { inference, worker } : null;
}

export function unassignedOutputRequests(inference) {
    const assigned = new Set();
    for (const worker of inference.workers.values()) {
        for (const [id, request] of worker.requests) {
            assigned.add(`${id}\0${request.fingerprint}`);
        }
    }
    return [...inference.pending].filter(([id, request]) =>
        !assigned.has(`${id}\0${request.fingerprint}`)).map(([, request]) => request);
}

export function finishOutputInference(inst, inference, workerId, commands) {
    if (!isCurrentInference(inst, inference)) return false;
    const worker = inference.workers.get(workerId);
    if (!worker) return false;
    const completed = new Set(commands.map(commandId));
    for (const [id, request] of worker.requests) {
        if (completed.has(id) && inference.pending.get(id)?.fingerprint === request.fingerprint) {
            inference.pending.delete(id);
            inference.failures.delete(id);
        } else if (inference.pending.get(id)?.fingerprint === request.fingerprint) {
            inference.pending.delete(id);
            inference.failures.set(id, { fingerprint: request.fingerprint, reason: "output inference returned no result" });
        }
    }
    inference.workers.delete(workerId);
    releaseBackgroundInference(inst, workerId);
    finishIfIdle(inst, inference);
    notify(inst, "artifact-targets updated");
    if (inference.status === "updating") void inference.schedule?.();
    return true;
}

export function failOutputInference(inst, inference, workerId, reason = "output inference failed") {
    if (!isCurrentInference(inst, inference)) return;
    if (workerId !== undefined) {
        const worker = inference.workers.get(workerId);
        if (!worker) return;
        inference.workers.delete(workerId);
        cancelBackgroundInference(inst, workerId);
        for (const [id, request] of worker.requests) {
            if (inference.pending.get(id)?.fingerprint !== request.fingerprint) continue;
            inference.pending.delete(id);
            inference.failures.set(id, { fingerprint: request.fingerprint, reason });
        }
    } else {
        for (const [id, request] of inference.pending) {
            inference.failures.set(id, { fingerprint: request.fingerprint, reason });
        }
        inference.pending.clear();
        cancelBackgroundInference(inst);
        inference.workers.clear();
    }
    finishIfIdle(inst, inference);
    notify(inst, reason);
    if (inference.status === "updating") void inference.schedule?.();
}

export function outputInferenceStatus(inst, evidence = {}) {
    const status = {};
    const inference = inst.outputInference;
    for (const [id, request] of inference?.pending ?? []) {
        if (evidence[id]?.fingerprint === request.fingerprint) status[id] = "updating";
    }
    for (const [id, failure] of inference?.failures ?? []) {
        if (evidence[id]?.fingerprint === failure.fingerprint && !status[id]) status[id] = "incomplete";
    }
    return status;
}

export function outputInferenceProgress(inst, requests = null) {
    const inference = inst.outputInference;
    if (!inference) return null;
    const scope = requests && new Map(requests.map((request) =>
        [commandId(request.commandId), request.fingerprint]));
    const matches = (id, fingerprint) => !scope
        ? true : scope.get(id) === fingerprint;
    const pending = [...inference.pending].filter(([id, request]) =>
        matches(id, request.fingerprint)).length;
    const failed = [...inference.failures].filter(([id, failure]) =>
        matches(id, failure.fingerprint)).length;
    const status = pending ? "updating" : failed ? "incomplete" : null;
    return status ? { status, total: pending + failed, remaining: pending } : null;
}
