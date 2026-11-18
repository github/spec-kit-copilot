import { commandId } from "../artifact-evidence.mjs";
import { effectivePipelinePhases } from "../pipeline/effective-phases.mjs";
import { snapshot } from "./snapshot.mjs";
import { sessionAdapter } from "./instances.mjs";
import { buildArtifactInferencePrompt as defaultBuildPrompt } from "./artifact-inference-prompt.mjs";
import { startBackgroundInference } from "./background-inference.mjs";
import {
    beginOutputInference,
    createOutputInferenceWorker,
    failOutputInference,
    unassignedOutputRequests,
} from "./output-inference.mjs";

function scheduleWorkers(inst, inference) {
    if (inst.outputInference !== inference || inference.status !== "updating"
        || inference.workers.size > 0) return;
    const requests = unassignedOutputRequests(inference);
    if (!requests.length) return;
    const { worker, endpoint } = createOutputInferenceWorker(inst, inference, requests);
    const isCurrent = () => inst.outputInference === inference
        && inference.workers.get(worker.id) === worker;
    void Promise.resolve().then(() => inference.buildPrompt({
        workspacePath: inst.workspacePath,
        commands: requests,
        endpoint: endpoint.toString(),
    })).then((prompt) => inference.startWorker(inst, { prompt },
        inference.session, isCurrent, worker.id)).catch((error) => {
        failOutputInference(inst, inference, worker.id,
            `Output inference dispatch failed: ${error.message}`);
    });
}

export async function ensurePipelineOutputInference(inst, {
    getSnapshot = snapshot,
    session = sessionAdapter(),
    buildPrompt = defaultBuildPrompt,
    startWorker = (target, request, workerSession, isCurrent, workerId) =>
        startBackgroundInference(target, request, workerSession, isCurrent, workerId),
} = {}) {
    const current = await getSnapshot(inst);
    const pipelineCommands = new Set(effectivePipelinePhases(current)
        .map(({ id }) => commandId(id)));
    const requests = (current?.artifactInferenceRequests ?? [])
        .filter(({ commandId: id }) => pipelineCommands.has(commandId(id)));
    if (!requests.length) return { queued: false, requests: [] };
    const inference = beginOutputInference(inst, requests);
    if (!inference) return { queued: false, requests: [] };
    inference.session = session;
    inference.buildPrompt = buildPrompt;
    inference.startWorker = startWorker;
    inference.schedule = () => scheduleWorkers(inst, inference);
    scheduleWorkers(inst, inference);
    return { queued: true, requests, inference };
}

// Resolves once the given inference run is no longer updating. The run's own
// timeout marks it incomplete, so this wait is bounded.
export async function waitForOutputInference(inst, inference, { intervalMs = 250, requests } = {}) {
    const scoped = requests && new Map(requests.map((request) =>
        [commandId(request.commandId), request.fingerprint]));
    while (inference && inst.outputInference === inference && inference.status === "updating"
        && (!scoped || [...inference.pending].some(([id, request]) =>
            scoped.get(id) === request.fingerprint))) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
}

export function scheduleOutputInference(inst, inference = inst.outputInference) {
    if (inference?.schedule) scheduleWorkers(inst, inference);
}
