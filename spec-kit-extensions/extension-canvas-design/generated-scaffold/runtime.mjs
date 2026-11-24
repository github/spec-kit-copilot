import { providerEvaluationScript, validateProviderSerializedResult } from
    "./contracts/external-value-provider.mjs";
import { createHash, randomUUID } from "node:crypto";
import { ArtifactReadError } from "./review/artifact-read.mjs";
import { createArtifactReviewService } from "./review/artifact-review.mjs";
import { scanArtifactCandidates } from "./review/artifact-discovery.mjs";
import { formatReviewAnswers, validateReviewSubmission } from "./review/review-submission.mjs";
import { lstat, realpath, readdir } from "node:fs/promises";
import { posix } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { createContext, runInContext } from "node:vm";
import { UserError, confined, readBounded, readBoundedBytes, directories, atomicJson, safePath, slugPattern,
    deleteConfinedDirectory } from "./files.mjs";
import { phaseContract, valueContract, validateValue } from "./contract.mjs";
import { phaseInteractions, phaseResponse, phaseTurnState } from "./phase-response.mjs";
import { createSetup } from "./setup.mjs";
import { freshState, validateWorkflowState, validatePendingRemoval, pendingId, newItem } from "./contracts/workflow-state.mjs";
import { workflowItemName } from "./contracts/external-host-adapter.mjs";
import { evaluateBadges, verifyBadgeModules } from "./badge-runtime.mjs";

function staleRevision(message) {
    const error = new UserError(message, 409);
    error.code = "STALE_REVISION";
    return error;
}

export async function existingOutputFolder(root, path) {
    let candidate = path === "." ? "." : safePath(path);
    while (candidate !== ".") {
        try {
            const folder = await confined(root, candidate);
            if (!(await lstat(folder)).isDirectory()) throw new UserError("The output path is not a folder.");
            return folder;
        } catch (error) {
            if (error.code !== "ENOENT") throw error;
            candidate = posix.dirname(candidate);
        }
    }
    return realpath(root);
}

const PROVIDER_REFRESH_LIMIT_MS = 3000;
const PROVIDER_EVALUATION_LIMIT_MS = 300;
const PROVIDER_REFRESH_ERROR = "Value provider refresh time limit exceeded. Refresh to retry.";

if (!isMainThread && workerData?.canvasValueProvider) {
    try {
        const { source, workflow } = workerData.canvasValueProvider;
        const context = createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
        const serialized = runInContext(
            providerEvaluationScript(source, workflow),
            context, { timeout: PROVIDER_EVALUATION_LIMIT_MS });
        validateProviderSerializedResult(serialized);
        parentPort.postMessage({ value: JSON.parse(serialized) });
    } catch (error) {
        parentPort.postMessage({ error: error.message });
    }
}

async function evaluateProvider(module, hash, workflow, deadline) {
    if (performance.now() >= deadline) throw new UserError(PROVIDER_REFRESH_ERROR);
    const bytes = await readBoundedBytes(fileURLToPath(new URL(".", import.meta.url)),
        `providers/${module}.mjs`, 32 * 1024);
    if (createHash("sha256").update(bytes).digest("hex") !== hash) {
        throw new UserError(`Packaged provider ${module} changed; restore the generated canvas files.`);
    }
    const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const remaining = Math.ceil(deadline - performance.now());
    if (remaining < PROVIDER_EVALUATION_LIMIT_MS) throw new UserError(PROVIDER_REFRESH_ERROR);
    return new Promise((resolve, reject) => {
        const worker = new Worker(new URL(import.meta.url), {
            workerData: { canvasValueProvider: { source, workflow } },
            execArgv: [],
            resourceLimits: { maxOldGenerationSizeMb: 48, maxYoungGenerationSizeMb: 16 },
        });
        let finished = false;
        // The VM bounds execution; do not terminate it at the shared refresh deadline.
        const timer = setTimeout(() => finish(performance.now() >= deadline
            ? new UserError(PROVIDER_REFRESH_ERROR) : new Error("Provider exceeded its execution limit")), 2000);
        async function finish(error, value, stopWorker = true) {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            if (stopWorker) {
                try { await worker.terminate(); }
                catch (cause) {
                    reject(new Error("Value provider worker could not stop.", { cause }));
                    return;
                }
            }
            if (error) reject(error);
            else if (performance.now() >= deadline) reject(new UserError(PROVIDER_REFRESH_ERROR));
            else resolve(value);
        }
        worker.once("message", (result) => finish(result.error ? new Error(result.error) : null,
            result.value, false));
        worker.once("error", (error) => finish(error));
        worker.once("exit", (code) => finish(new Error(`Provider exited before returning a value (${code}).`),
            undefined, false));
    });
}

export async function createRuntime({ config, cwd, workspace, session, notify = () => {} }) {
    const itemName = workflowItemName(config.canvas?.workflowItemName);
    if (config.badges?.instances?.length) await verifyBadgeModules(config.badges);
    const phases = phaseContract(config);
    const valueFields = valueContract(config);
    const setup = createSetup({ config, cwd, session, phases, notify,
        approvedSources: () => state.approvedUrlSources ?? [],
        saveApprovedSources: (receipts) => update((next) => {
            next.approvedUrlSources = [...new Set([...(next.approvedUrlSources ?? []), ...receipts])]
                .slice(-80);
        }) });
    const key = createHash("sha256").update(JSON.stringify([cwd, config.canvas.id])).digest("hex");
    const statePath = `generated-canvases/${key}/state.json`;
    let state;
    try {
        state = JSON.parse(await readBounded(workspace, statePath, 2 * 1024 * 1024));
        validateWorkflowState(state, phases, valueFields);
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
        state = freshState();
    }
    let writes = Promise.resolve();
    let badgeRevision = 0;
    let badgeCache;
    function invalidateBadges() {
        badgeRevision++;
        badgeCache = undefined;
    }
    let dispatching = false;
    const requiresRecovery = (run) => run.sessionId === session.sessionId && !run.autopilotId
        && run.status !== "Failed" && (run.status !== "Completed"
            || newItem(run.item) && !run.artifact && !run.confirmedSlug);
    const recoveryRuns = new Set(state.runs.filter(requiresRecovery).map((run) => run.runId));
    let idleAfterRestart = false;
    let recoverOnOpen = recoveryRuns.size > 0;
    let deleting = false;
    let closed = false;
    const liveRuns = new Set();
    // Recovered turn evidence controls display, not report authorization.
    const recoveredActiveRuns = new Set();
    const busy = { value: false };
    const subscriptions = [];
    const observedMessages = new Set();
    function pendingRunStatus(run) {
        if (!run) return "Not started";
        const active = recoveryRuns.has(run.runId)
            ? recoveredActiveRuns.has(run.runId) : liveRuns.has(run.runId);
        return !active && !["Completed", "Failed", "Run output unconfirmed"].includes(run.status)
            ? "Unconfirmed" : run.status;
    }
    function runActivity(run, events) {
        if (recoveryRuns.has(run.runId) && idleAfterRestart && !busy.value) return "ended";
        if (idleAfterRestart && busy.value) return "active";
        if (!run.messageId) return run.status === "Failed" ? "ended" : "unknown";
        const turn = phaseTurnState(events, run.messageId);
        if (turn.active) return "active";
        if (turn.ended || phaseResponse(events, run.messageId)?.success !== undefined) return "ended";
        return busy.value ? "active" : "unknown";
    }
    // Deletion follows current correlated evidence, not display/recovery status.
    function canDeleteAttempt(run, events) {
        const terminal = ["Completed", "Failed"].includes(run.status);
        if (run.sessionId !== session.sessionId) return terminal;
        const owned = run.messageId ? phaseInteractions(events, run.messageId) : new Set();
        let interaction, currentInteraction, turn, turnInteraction, activity;
        let toolsSeen = false, hasTools = false, completed = false;
        for (const event of events) {
            const data = event.data ?? {};
            if (event.agentId || data.parentToolCallId) continue;
            if (event.type === "user.message") {
                currentInteraction = undefined;
                if (run.messageId && data.messageId === run.messageId) {
                    interaction = typeof data.interactionId === "string" ? data.interactionId : undefined;
                    turn = undefined;
                    activity = interaction ? undefined : "unknown";
                    toolsSeen = false;
                }
            }
            if (event.type === "assistant.turn_start") {
                currentInteraction = data.interactionId;
                if (interaction && owned.has(currentInteraction)) {
                    turn = typeof data.turnId === "string" ? data.turnId : undefined;
                    turnInteraction = currentInteraction;
                    activity = turn ? "active" : "unknown";
                    hasTools = false;
                    completed = false;
                }
            }
            if (!interaction || !turn) continue;
            if (data.turnId === turn && (event.type === "tool.execution_start"
                || event.type === "assistant.message" && data.interactionId === turnInteraction
                    && data.toolRequests?.length)) {
                toolsSeen = true;
                hasTools = true;
                completed = false;
                activity = "active";
            }
            if (event.type === "assistant.message" && data.interactionId === turnInteraction
                && data.turnId === turn && !hasTools
                && !["analysis", "commentary", "thinking"].includes(data.phase)
                && typeof data.content === "string" && data.content.trim()) completed = true;
            if (event.type === "session.task_complete" && typeof data.success === "boolean"
                && (!data.interactionId || data.interactionId === turnInteraction)
                && (!data.turnId || data.turnId === turn)
                && (data.interactionId === turnInteraction || data.turnId === turn
                    || currentInteraction === turnInteraction)) {
                completed = true;
                if (activity !== "active") activity = "ended";
            }
            if (event.type === "assistant.turn_end" && data.turnId === turn) {
                activity = completed || !toolsSeen ? "ended" : "unknown";
            }
        }
        if (activity === "active") return false;
        if (activity === "ended") return true;
        if (liveRuns.has(run.runId ?? run.id)
            && !["Completed", "Failed", "Run output unconfirmed"].includes(run.status)) return false;
        const automation = state.autopilot;
        const stopped = run.status === "Paused" || run.autopilotId && (run.stoppedAt
            || automation?.id === run.autopilotId && ["Paused", "Completed"].includes(automation.status)
                && !liveRuns.has(automation.id));
        return Boolean(stopped) || activity === undefined && terminal;
    }
    const workflowSteps = phases.filter((step) => !step.project);
    let autopilotDispatching = false;
    const diagnostic = async (message) => {
        try { await session.log(message, { level: "warning" }); }
        catch (error) {
            console.warn(`Generated canvas diagnostic logging failed: ${error?.message ?? error}. ${message}`);
        }
    };
    const cleanupDiagnostic = async (message) => {
        try { await diagnostic(message); } catch { /* Cleanup reporting must not mask the original failure. */ }
    };
    async function restoreMode(automation, log = diagnostic) {
        if (!automation?.previousMode || automation.previousMode === "autopilot") return;
        if (await session.rpc.mode.get() !== "autopilot") return;
        const result = await session.rpc.mode.set({ mode: automation.previousMode, expectedMode: "autopilot" });
        if (result.modeApplied === false) await log("Copilot session mode changed; Autopilot did not restore the previous mode.");
    }
    const update = (fn, uiChange = false, announce = true, badgesChanged = false) => {
        const pending = writes.then(async () => {
            const next = structuredClone(state);
            if (await fn(next) === false) return;
            if (uiChange) next.revision++;
            if (Buffer.byteLength(JSON.stringify(next)) > 2 * 1024 * 1024) throw new UserError("Canvas state is full. Preserve its state file before clearing old runs.", 413);
            await atomicJson(workspace, statePath, next);
            const previousRuns = new Map(state.runs.map((run) => [run.runId, run]));
            const terminalChanged = next.runs.some((run) =>
                ["Completed", "Failed", "Run output unconfirmed"].includes(run.status)
                && (previousRuns.get(run.runId)?.status !== run.status
                    || previousRuns.get(run.runId)?.completedAt !== run.completedAt));
            state = next;
            if (badgesChanged || terminalChanged) invalidateBadges();
            if (announce) notify();
        });
        writes = pending.catch(() => {});
        return pending;
    };
    if (state.autopilot && ["Request sent", "Running", "Finishing"].includes(state.autopilot.status)) {
        await update((next) => {
            next.autopilot.status = "Blocked";
            next.autopilot.error = "Autopilot was interrupted. Check chat and outputs before resuming.";
            for (const run of next.runs.filter((run) => run.autopilotId === next.autopilot.id
                && run.status === "Running")) {
                run.status = "Unconfirmed";
                run.error = "This step was interrupted before verification. Check its output before retrying.";
            }
        }, false, false);
    }
    const phaseFor = (id) => {
        const step = phases.find((phase) => phase.id === id);
        if (!step) throw new UserError("Select a configured phase.");
        return step;
    };
    function validSlug(value) {
        if (typeof value !== "string" || !value || value.length > 100 || !slugPattern.test(value)) return false;
        try { safePath(value); return true; } catch (error) {
            if (error instanceof UserError) return false;
            throw error;
        }
    }
    async function hasConstitution() {
        const step = phases.find((phase) => phase.project);
        if (!step) return true;
        const output = await outputPath(step, "project");
        if (!output) return false;
        try {
            if (!(await lstat(await confined(cwd, output))).isFile()) {
                throw new UserError("The constitution is not a regular file.");
            }
            return true;
        } catch (error) {
            if (error.code === "ENOENT") return false;
            throw error;
        }
    }
    async function requireConstitution() {
        if (!(await hasConstitution())) {
            throw new UserError("Create a constitution before starting a workflow.");
        }
    }
    function outputRoot(path) {
        const normalized = typeof path === "string" ? path.replaceAll("\\", "/") : "";
        return normalized.includes("/<slug>/") ? normalized.split("/<slug>/")[0] : null;
    }
    const legacyRoots = ["specs"], inferredRoots = new Set();
    for (const step of phases) {
        if (step.project) continue;
        const phaseRoots = step.outputs.map(outputRoot).filter(Boolean);
        if (!step.configuredArtifacts) {
            legacyRoots.push(...phaseRoots);
            continue;
        }
        const legacyRoot = outputRoot(config.phaseOutputs?.[step.id]?.outputPath);
        if (phaseRoots.includes(legacyRoot)) legacyRoots.push(legacyRoot);
        else for (const root of phaseRoots) inferredRoots.add(root);
    }
    const roots = [...new Set([...legacyRoots, ...(inferredRoots.size === 1 ? inferredRoots : [])])];
    function requireDiscoveryRoots() {
        if (inferredRoots.size > 1) {
            throw new UserError(`Cannot determine workflow discovery root: confirmed outputs reference multiple roots (${[...inferredRoots].sort().join(", ")}).`, 409);
        }
    }
    async function compareDirectories(before, inventory) {
        if (!Array.isArray(before) || new Set(before).size !== before.length
            || before.some((id) => typeof id !== "string"
                || !roots.some((root) => id.startsWith(`${root}/`)
                    && slugPattern.test(id.slice(root.length + 1))))) {
            throw new UserError("The app cannot reliably check whether this run created a workflow folder. Check the project files before abandoning this workflow.", 409);
        }
        const current = await (inventory ?? inspectDirectories());
        for (const root of current.missingRoots) {
            if (before.some((id) => id.startsWith(`${root}/`))) {
                throw new UserError("A folder used to store workflows is missing. Check the project files before abandoning this workflow.", 409);
            }
        }
        if (before.some((id) => !current.ids.includes(id))) {
            throw new UserError("A workflow folder that existed before this run is missing. Check the project files.", 409);
        }
        const prior = new Set(before);
        return current.ids.filter((id) => !prior.has(id));
    }
    async function inspectDirectories() {
        requireDiscoveryRoots();
        const ids = [], missingRoots = [];
        for (const root of roots) {
            const path = safePath(root);
            let folder;
            try { folder = await confined(cwd, path); }
            catch (error) {
                if (error.code !== "ENOENT") throw error;
                missingRoots.push(root);
                continue;
            }
            const original = await lstat(folder);
            if (!original.isDirectory()) throw new UserError("Workflow root is not a directory.", 409);
            const entries = await readdir(folder, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
                const id = `${root}/${entry.name}`;
                if (entry.isSymbolicLink() || !slugPattern.test(entry.name)) {
                    throw new UserError(`Workflow root contains an unsafe directory entry: ${id}`, 409);
                }
                const target = await confined(cwd, id);
                const first = await lstat(target);
                if (!first.isDirectory()) throw new UserError("Workflow directory changed during inspection.", 409);
                ids.push(id);
                const second = await lstat(await confined(cwd, id));
                if (first.dev !== second.dev || first.ino !== second.ino) {
                    throw new UserError("Workflow directory changed during inspection.", 409);
                }
            }
            const current = await lstat(await confined(cwd, path));
            if (original.dev !== current.dev || original.ino !== current.ino
                || original.mtimeMs !== current.mtimeMs) {
                throw new UserError("Workflow root changed during inspection. Refresh and retry.", 409);
            }
        }
        return { ids, missingRoots };
    }
    async function items(view = state) {
        requireDiscoveryRoots();
        const found = [];
        for (const root of roots) {
            if (root.includes("<") || root.startsWith(".git")) continue;
            for (const slug of await directories(cwd, root)) {
                const id = `${root}/${slug}`;
                found.push({ id, slug, label: view.names?.[id] || slug });
            }
        }
        return found;
    }
    const pendingFor = (id, view = state) => view.pendingWorkflows?.find((entry) => entry.id === id);
    function runFor(step, item, view = state) {
        return view.runs.findLast((run) => run.phase === step.id && run.item === (step.project ? "project" : item));
    }
    function reportedArtifactFor(step, item, view = state) {
        return view.runs.findLast((run) => run.phase === step.id &&
            run.item === (step.project ? "project" : item) && run.artifact);
    }
    function authorizeReport(step, path, item) {
        safePath(path);
        if (!path.endsWith(".md")) throw new UserError("Reported artifact must be Markdown.");
        if (step.configuredArtifacts && step.outputs.some((output) =>
            output.replace("<slug>", item.split("/").at(-1)) === path)) {
            return;
        }
        if (step.project || (step.output && !step.output.includes("<"))) {
            if (path !== step.output) throw new UserError("Constitution report does not match its declared output.");
        } else {
            if (!roots.some((root) => item.startsWith(`${root}/`)) || !path.startsWith(`${item}/`)) throw new UserError("Reported artifact is outside this workflow.");
            if (step.output) {
                const expected = step.output.replace("<slug>", item.split("/").at(-1));
                if (expected.endsWith("<name>.md")) {
                    if (posix.dirname(path) !== posix.dirname(expected)) throw new UserError("Reported artifact differs from the declared phase output.");
                } else if (path !== expected && phases.some((other) => other.id !== step.id
                    && other.outputs.some((output) => output.replace("<slug>", item.split("/").at(-1)) === path))) {
                    throw new UserError("Reported artifact belongs to another declared phase output.");
                }
            }
        }
    }
    async function outputPath(step, item, view = state, entries, directory = false) {
        const run = reportedArtifactFor(step, item, view);
        if (!step.configuredArtifacts && run?.artifact) {
            authorizeReport(step, run.artifact, run.item);
            return directory ? posix.dirname(run.artifact) : run.artifact;
        }
        if (!step.output) return null;
        let path = step.output;
        if (path.includes("<slug>")) {
            const selected = (entries ?? await items(view)).find((entry) => entry.id === item);
            const draftSlug = item === "__new__" ? view.slug : pendingFor(item, view)?.slug;
            const slug = validSlug(selected?.slug) ? selected.slug
                : selected ? null : config.userProvidesSlug && validSlug(draftSlug) ? draftSlug : null;
            if (!slug) return null;
            path = path.replace("<slug>", slug);
            if (selected && !newItem(item) && !step.configuredArtifacts && !path.startsWith(`${selected.id}/`)) {
                throw new UserError("This phase output belongs to a different workflow.");
            }
        }
        if (directory) return posix.dirname(safePath(path, true));
        if (path.endsWith("<name>.md")) {
            const parent = posix.dirname(path);
            try {
                const entries = await readdir(await confined(cwd, parent), { withFileTypes: true });
                const candidates = [];
                for (const entry of entries) {
                    if (!entry.isFile() || !/^[a-z0-9][a-z0-9._-]*\.md$/i.test(entry.name)) continue;
                    const path = `${parent}/${entry.name}`;
                    candidates.push({ path, mtime: (await lstat(await confined(cwd, path))).mtimeMs });
                }
                candidates.sort((left, right) => right.mtime - left.mtime || left.path.localeCompare(right.path));
                if (!candidates.length) throw new UserError("No artifact is available yet. Run the phase, then refresh.", 404);
                path = candidates[0].path;
            } catch (error) { if (error.code === "ENOENT") return null; throw error; }
        }
        return safePath(path);
    }
    async function artifactPath(input) {
        const step = phaseFor(input.phase);
        if (input.output !== undefined && !step.outputs.includes(input.output)) {
            throw new UserError("This output is not declared for the selected phase.", 403);
        }
        const path = input.output === undefined
            ? await outputPath(step, input.itemId)
            : await outputPath({ ...step, output: input.output, configuredArtifacts: true },
                input.itemId);
        if (!path) throw new UserError(step.output
            ? "No artifact is available yet. Run the phase or select an existing workflow to view its artifact."
            : "No artifact is available for this phase yet. Run the phase, then refresh to check again.", 404);
        return path;
    }
    async function artifact(input) {
        const path = await artifactPath(input);
        try {
            const content = await readBounded(cwd, path);
            return { path, content, message: content.trim() ? null : "Artifact is empty or still being written. Refresh to try again." };
        } catch (error) {
            if (error.code === "ENOENT") throw new UserError("Could not load the artifact. It may not have been created yet. Run the phase or check its output path.", 404);
            throw error;
        }
    }
    function createReview(instanceId) {
        const service = createArtifactReviewService({
            canvasId: "generated-workflow", instanceId, workspacePath: cwd,
            async getScope({ stage, feature, source }) {
                const step = phases.find((phase) => phase.id === stage);
                if (!step || (step.project ? feature !== "project" : !(await items()).some(({ id }) => id === feature))) return null;
                let relativePath;
                try { relativePath = await artifactPath({ phase: stage, itemId: feature, output: source }); }
                catch (error) {
                    if (error instanceof UserError) return null;
                    throw error;
                }
                const describe = (relativePath, phase, role = "supporting", output) => ({
                    relativePath, label: output === undefined || output === phase.output ? phase.label : posix.basename(relativePath), role,
                    owningStage: phase.id, owningCommand: phase.command,
                });
                const primary = describe(relativePath, step, "primary", source);
                const candidates = new Map([[relativePath, primary]]);
                for (const phase of phases.filter((entry) => entry.project === step.project)) {
                    const outputs = [...new Set([undefined, ...phase.outputs])];
                    for (const output of outputs) {
                        try {
                            const path = await artifactPath({ phase: phase.id, itemId: feature, output });
                            if (!candidates.has(path)) candidates.set(path, describe(path, phase, "supporting", output));
                        } catch (error) { if (!(error instanceof UserError)) throw error; }
                    }
                    for (const path of runFor(phase, feature)?.artifacts ?? []) {
                        try {
                            authorizeReport(phase, path, feature);
                            if (!candidates.has(path)) candidates.set(path, describe(path, phase));
                        } catch (error) { if (!(error instanceof UserError)) throw error; }
                    }
                }
                return {
                    scopeType: step.project ? "project" : "feature",
                    scopeKey: createHash("sha256").update(JSON.stringify([instanceId, stage, feature, relativePath])).digest("hex"),
                    primary, originStage: stage, originCommand: step.command,
                    roots: step.project ? [] : [feature], candidates: [...candidates.values()],
                };
            },
            discoverCandidates: ({ roots, candidates }, { maxInspect } = {}) =>
                scanArtifactCandidates({ workspacePath: cwd, roots, explicit: candidates, maxInspect }),
        });
        return {
            ...service,
            async submit(input) {
                const { commandName, ...review } = input;
                const { feature } = await service.selectionFor(review.contextId);
                const { artifact } = await service.content(review.contextId, review.artifactId, { expectedRevision: review.expectedRevision });
                const phase = phases.find(({ id }) => id === artifact.owningStage);
                if (!phase || phase.command !== commandName || Boolean(phase.project) !== (feature === "project")) {
                    throw new ArtifactReadError("invalid_request");
                }
                const validate = () => validateReviewSubmission(service, review, commandName);
                const answers = await validate();
                const last = runFor(phase, feature)?.args;
                const suffix = formatReviewAnswers(answers);
                const args = last ? `${last}\n\n${suffix}` : suffix;
                return run({ phase: phase.id, ...(phase.project ? {} : { itemId: feature }), args }, instanceId, validate);
            },
        };
    }
    async function snapshot() {
        if (recoverOnOpen) {
            recoverOnOpen = false;
            try { await capture(); }
            catch (error) { recoverOnOpen = true; throw error; }
        }
        const view = structuredClone(state);
        const revision = badgeRevision;
        const entries = await items(view);
        const item = view.selected;
        const selectedWorkflow = newItem(item) ? null : entries.find((entry) => entry.id === item);
        const visibleValues = [], pageValues = Object.create(null), valueErrors = {};
        const providerDeadline = performance.now() + PROVIDER_REFRESH_LIMIT_MS;
        let reportedDeadline = false;
        for (const field of valueFields) {
            if (field.source.kind === "computed" && !selectedWorkflow) continue;
            let value;
            try {
                if (field.source.kind === "computed") {
                    value = await evaluateProvider(field.source.module, field.source.hash, {
                        id: selectedWorkflow.id, slug: selectedWorkflow.slug,
                        label: selectedWorkflow.label,
                    }, providerDeadline);
                } else if (field.presentation === "stock.editable") {
                    value = Object.hasOwn(view.values ?? {}, field.id) ? view.values[field.id] : field.source.value;
                } else value = field.source.value;
                value = validateValue(field.schema, value, field.id);
            } catch (error) {
                const contractError = field.source.kind === "computed"
                    && (error.message === "provideValue must be a function"
                        || error.message === "Async providers are not supported");
                valueErrors[field.id] = error instanceof UserError || contractError
                    ? error.message : `Value ${field.label} could not be evaluated or failed validation.`;
                if (error.message !== PROVIDER_REFRESH_ERROR || !reportedDeadline) {
                    await diagnostic(`Generated canvas value ${field.id} failed: ${error.message}`);
                }
                if (error.message === PROVIDER_REFRESH_ERROR) reportedDeadline = true;
                continue;
            }
            const entry = { id: field.id, label: field.label, schema: field.schema, value,
                editable: field.presentation === "stock.editable",
                ...(field.provenance ? { provenance: field.provenance } : {}),
                ...(field.section ? { section: field.section } : {}) };
            if (field.presentation !== "processing-only") visibleValues.push(entry);
            for (const page of config.generatedPages ?? []) {
                if (page.values?.includes(field.id)) (pageValues[page.id] ??= {})[field.id] = value;
            }
        }
        const statuses = {};
        for (const step of phases) {
            const run = runFor(step, item, view);
            let output = null, artifactError = null, artifactAvailability = "unknown";
            try {
                output = await outputPath(step, item, view, entries);
                if (output) {
                    const info = await lstat(await confined(cwd, output));
                    if (!info.isFile()) throw new UserError("The artifact path is not a regular file.");
                    artifactAvailability = "available";
                }
            }
            catch (error) {
                artifactAvailability = error.code === "ENOENT" || error.status === 404 ? "missing" : "error";
                if (artifactAvailability === "error") {
                    artifactError = error instanceof UserError ? error.message : "Could not check the artifact safely. Refresh to retry.";
                    await diagnostic(`Generated canvas artifact availability failed: ${artifactError}`);
                }
            }
            const status = run ? newItem(item) ? pendingRunStatus(run) : run.status : "Not run";
            statuses[step.id] = { status, output, artifactAvailability, artifactError,
                error: run?.error ?? null };
        }
        const automation = view.autopilot
            ? { ...view.autopilot, message: view.autopilot.error
                ?? `${view.autopilot.status}: step ${Math.min(view.autopilot.current + 1, workflowSteps.length)} of ${workflowSteps.length}` }
            : null;
        if (automation && ["Request sent", "Running", "Finishing"].includes(automation.status)
            && (automation.sessionId !== session.sessionId || !liveRuns.has(automation.id))) {
            automation.status = "Blocked";
            automation.message = "Autopilot outcome is unconfirmed. Check chat before resuming.";
        }
        let badges;
        if (config.badges?.instances?.length) {
            let evaluation = badgeCache?.revision === revision ? badgeCache.result : undefined;
            if (!evaluation) {
                evaluation = evaluateBadges(config.badges, {
                    cwd, workflows: entries.map(({ id }) => id), phases,
                    outputPath: async ({ phase, output }, workflow, options = {}) => {
                        const step = phaseFor(phase);
                        return outputPath(output === undefined ? step : {
                            ...step, output, configuredArtifacts: true,
                        }, step.project ? "project" : workflow, view, entries, options.directory === true);
                    },
                    runFor: (step, workflow) => runFor(step, workflow, view),
                    log: (message) => { void diagnostic(message); },
                });
                if (badgeRevision === revision) badgeCache = { revision, result: evaluation };
            }
            badges = structuredClone(await evaluation);
        }
        if (badges) badges.selected = badges.items[item] ?? [];
        const project = phases.find((phase) => phase.project);
        let recoveryInventory;
        const pending = await Promise.all((view.pendingWorkflows ?? []).map(async ({ id, name, slug }) => {
            const runs = view.runs.filter((entry) => entry.item === id);
            const run = runs.at(-1);
            let recovery = run?.error ?? null;
            const discovered = new Set(), errors = new Set();
            for (const attempt of runs) {
                if (!["Completed", "Failed", "Run output unconfirmed"].includes(attempt.status)) continue;
                try {
                    recoveryInventory ??= inspectDirectories();
                    for (const path of await compareDirectories(attempt.before, recoveryInventory)) discovered.add(path);
                } catch (error) {
                    if (!(error instanceof UserError)) throw error;
                    errors.add(error.message);
                }
            }
            const findings = [
                ...(discovered.size ? [`New workflow directory: ${[...discovered].join(", ")}. Select it in the workflow list to inspect it.`] : []),
                ...errors,
            ];
            if (findings.length) recovery = findings.join(" ");
            if (id === item && run && recovery) statuses[run.phase].error = recovery;
            return { id, slug: config.userProvidesSlug ? slug : "",
                label: name.trim() || `Unstarted ${itemName}`, pending: true,
                status: pendingRunStatus(run),
                hasWorkflowRunHistory: Boolean(run), workflowRecoveryMessage: recovery };
        }));
        const creationOrder = new Map();
        view.runs.forEach((run, index) => {
            if (!newItem(run.item) && !run.before.includes(run.item)) {
                creationOrder.set(run.item, index);
            }
        });
        const listed = entries.toSorted((left, right) =>
            (creationOrder.get(right.id) ?? -1) - (creationOrder.get(left.id) ?? -1));
        return { ...view, userProvidesSlug: config.userProvidesSlug,
            constitutionReady: !project || statuses[project.id].artifactAvailability === "available",
            autopilot: automation, showSetup: config.showSetup === true,
            selected: item, runs: undefined, tagMatches: undefined, values: undefined,
            name: pendingFor(item, view)?.name ?? view.name,
            slug: config.userProvidesSlug ? pendingFor(item, view)?.slug ?? view.slug : "",
            phases, items: [...pending.toReversed(), ...listed],
            statuses, valueFields: visibleValues, pageValues, valueErrors,
            ...(badges ? { badges } : {}),
            setup: config.runtimeSetup !== undefined || config.showSetup ? await setup.status()
                : { stage: "legacy", ready: true, pending: [], planId: null, error: null } };
    }
    async function saveValue(input) {
        if (!input || Object.keys(input).sort().join() !== "id,revision,value"
            || typeof input.id !== "string" || !Number.isSafeInteger(input.revision)) {
            throw new UserError("Invalid value update.");
        }
        const field = valueFields.find((entry) => entry.id === input.id && entry.presentation === "stock.editable");
        if (!field) throw new UserError("This value is not editable.");
        const value = validateValue(field.schema, input.value, field.id);
        await update((next) => {
            if (input.revision !== next.revision) throw staleRevision("Canvas state changed in another panel. Refresh before saving.");
            (next.values ??= {})[field.id] = value;
        }, true);
        return { revision: state.revision };
    }
    async function save(input) {
        if (deleting) throw new UserError("A workflow is being deleted. Refresh and try again.", 409);
        if (!input || Object.keys(input).some((key) => !["revision", "selected", "phase", "slug", "name", "draft"].includes(key))) throw new UserError("Invalid canvas state update.");
        if (input.selected !== undefined && input.selected !== "__new__"
            && !pendingFor(input.selected) && !(await items()).some((item) => item.id === input.selected)) {
            throw new UserError("That workflow is no longer available. Refresh the workflow list.");
        }
        if (input.phase !== undefined) phaseFor(input.phase);
        if (input.slug !== undefined && (typeof input.slug !== "string" || input.slug.length > 100)) throw new UserError("Artifact folder name (slug) is too long.");
        if (input.slug !== undefined && !config.userProvidesSlug) throw new UserError("Custom workflow slugs are disabled for this canvas.");
        if (input.name !== undefined && (typeof input.name !== "string" || input.name.length > 120
            || /[\x00-\x1f\x7f]/.test(input.name))) throw new UserError(`${itemName} name must be text of at most 120 characters.`);
        if (input.name !== undefined && !newItem(input.selected ?? state.selected)) {
            throw new UserError("Only a new workflow can be given a display name.");
        }
        if (input.slug !== undefined && !newItem(input.selected ?? state.selected)) {
            throw new UserError("Only a new workflow can change its artifact folder name.");
        }
        if (input.draft && (typeof input.draft.value !== "string" || input.draft.value.length > 32000
            || typeof input.draft.item !== "string"
            || (!newItem(input.draft.item) && input.draft.item !== "project"
                && !(await items()).some((item) => item.id === input.draft.item))
            || (pendingId(input.draft.item) && !pendingFor(input.draft.item)))) throw new UserError("Invalid phase draft.");
        if (input.draft) phaseFor(input.draft.phase);
        await update((next) => {
            if (input.revision !== next.revision) throw staleRevision("Canvas state changed in another panel. Refresh before saving.");
            for (const key of ["selected", "phase"]) if (input[key] !== undefined) next[key] = input[key];
            for (const key of ["slug", "name"]) {
                if (input[key] === undefined) continue;
                const pending = pendingFor(next.selected, next);
                if (pending) pending[key] = input[key];
                else next[key] = input[key];
            }
            if (input.draft) next.drafts[JSON.stringify([input.draft.item, input.draft.phase])] = input.draft.value;
        }, true, Object.keys(input).some((key) => !["revision", "selected"].includes(key)));
        return { revision: state.revision };
    }
    async function createPending(input) {
        if (!input || Object.keys(input).sort().join() !== "revision"
            || !Number.isSafeInteger(input.revision)) throw new UserError("Invalid new workflow request.");
        const existing = await items();
        let id;
        await update((next) => {
            if (input.revision !== next.revision) throw staleRevision("Canvas state changed in another panel. Refresh before creating a workflow.");
            const drafts = next.pendingWorkflows ??= [];
            if (drafts.length >= 100) throw new UserError("Too many unstarted workflows. Remove one before adding another.");
            let number = next.workflowSerial ?? 0;
            let slug;
            do {
                if (number >= Number.MAX_SAFE_INTEGER) throw new UserError("Workflow numbering has reached its limit.");
                number++;
                slug = `workflow-${number}`;
            } while (existing.some((entry) => entry.slug === slug || new RegExp(`^\\d+-${slug}$`).test(entry.slug))
                || drafts.some((entry) => entry.slug === slug));
            next.workflowSerial = number;
            id = `__new__:${number}`;
            drafts.push({ id, name: `${itemName} ${number}`, slug: "" });
            next.selected = id;
            next.phase = workflowSteps[0]?.id ?? next.phase;
        }, true);
        return { revision: state.revision, id };
    }
    async function removePending(input) {
        validatePendingRemoval(input);
        await update(async (next) => {
            if (input.revision !== next.revision) throw staleRevision("Canvas state changed in another panel. Refresh before removing this workflow.");
            const index = (next.pendingWorkflows ?? []).findIndex((entry) => entry.id === input.itemId);
            if (index < 0) throw new UserError("This unstarted workflow no longer exists.");
            const runs = next.runs.filter((run) => run.item === input.itemId);
            if (runs.length && input.confirmation !== "discard") {
                throw new UserError("Confirm Discard pending row before removing its run history.", 409);
            }
            if (!runs.length && input.confirmation !== undefined) {
                throw new UserError("This row has no run to discard.", 409);
            }
            const events = runs.length ? await session.getEvents() : [];
            for (const run of runs) {
                if (runActivity(run, events) !== "ended") {
                    throw new UserError("The agent turn has not ended. Check chat before discarding.", 409);
                }
                const discovered = await compareDirectories(run.before);
                if (discovered.length) throw new UserError(
                    `A workflow directory appeared: ${discovered.join(", ")}. Inspect it in the workflow list before discarding.`, 409);
            }
            for (const run of runs) {
                if ((await compareDirectories(run.before)).length) {
                    throw new UserError("A workflow directory appeared during the discard check. Inspect the workflow list.", 409);
                }
            }
            const existing = await items();
            if (next.autopilot?.item === input.itemId
                && (["Request sent", "Running", "Finishing"].includes(next.autopilot.status)
                    || (next.autopilot.status === "Blocked" && liveRuns.has(next.autopilot.id)))) {
                throw new UserError("Stop Autopilot before removing this workflow.");
            }
            next.pendingWorkflows.splice(index, 1);
            next.runs = next.runs.filter((run) => run.item !== input.itemId);
            for (const key of Object.keys(next.drafts)) {
                if (key.startsWith(`[${JSON.stringify(input.itemId)},`)) delete next.drafts[key];
            }
            if (next.selected === input.itemId) next.selected =
                next.pendingWorkflows.at(-1)?.id ?? existing[0]?.id ?? "__new__";
        }, true);
        return { revision: state.revision };
    }
    async function skill(step) {
        let source;
        try { source = await readBounded(cwd, `.github/skills/${step.skill}/SKILL.md`); }
        catch (error) {
            if (error.code === "ENOENT") throw new UserError(`Installed skill ${step.skill} is unavailable. Check this checkout's Spec Kit setup; nothing was sent.`);
            throw error;
        }
        const name = source.match(/^name:\s*["']?([a-z0-9-]+)["']?\s*$/m)?.[1];
        if (name !== step.skill) throw new UserError(`Installed skill name does not match ${step.skill}. Nothing was sent.`);
        if (!session.rpc?.skills?.reload) throw new UserError("Session skill reload is unavailable. Reload skills in Copilot before retrying.");
        const result = await session.rpc.skills.reload();
        if (result?.errors?.length) throw new UserError("Session skills could not reload. Check Copilot's skill diagnostics and retry.");
    }
    async function enabledAutopilot() {
        if (!config.workflowPage.managedRun) {
            throw new UserError("This phase control does not provide Autopilot.");
        }
        const module = config.workflowPage.adapter;
        const bytes = await readBoundedBytes(fileURLToPath(new URL(".", import.meta.url)),
            `pages/${module}.mjs`, 128 * 1024);
        if (createHash("sha256").update(bytes).digest("hex") !== config.workflowPage.hash) {
            throw new UserError("Packaged phase control changed; restore the generated canvas files.");
        }
    }
    async function startAutopilot(input, instanceId) {
        if (!input || Object.keys(input).some((key) => !["itemId"].includes(key))
            || typeof input.itemId !== "string") throw new UserError("Select a workflow for Autopilot.");
        if ((config.runtimeSetup !== undefined || config.showSetup) && !(await setup.status({ fresh: true })).ready) {
            throw new UserError("Project setup is not ready. Select Set up project, review any pending installs, and retry Autopilot.", 409);
        }
        if (dispatching || autopilotDispatching || deleting) throw new UserError("A workflow request is being sent. Retry after it finishes.", 409);
        if (state.autopilot && ["Request sent", "Running", "Finishing"].includes(state.autopilot.status)
            && liveRuns.has(state.autopilot.id)) throw new UserError("Autopilot is already running. Stop it before retrying.", 409);
        autopilotDispatching = true;
        let id, sent = false, previousMode, modeChanged = false;
        try {
            await enabledAutopilot();
            if (!workflowSteps.length) throw new UserError("No workflow steps are configured.");
            const boundStep = workflowSteps.find((step) =>
                config.phaseDialogs?.some((binding) => binding.phase === step.command));
            if (boundStep) {
                throw new UserError(`Autopilot cannot run ${boundStep.label} because it requires confirmation. Run the phases manually instead.`, 409);
            }
            const entries = await items();
            if (!newItem(input.itemId) && !entries.some((entry) => entry.id === input.itemId)
                || pendingId(input.itemId) && !pendingFor(input.itemId)) {
                throw new UserError("The selected workflow no longer exists. Refresh before starting.");
            }
            if (newItem(input.itemId) && !workflowSteps[0].first
                && workflowSteps.some((step) => step.first)) {
                throw new UserError("Select an existing workflow before starting Autopilot.");
            }
            await requireConstitution();
            const draft = pendingFor(input.itemId);
            const requestedSlug = newItem(input.itemId) && config.userProvidesSlug
                ? draft?.slug ?? state.slug : "";
            if (requestedSlug && !validSlug(requestedSlug)) {
                throw new UserError("Use an artifact folder name (slug) with lowercase letters, numbers, and single hyphens, not a reserved filename.");
            }
            for (const step of workflowSteps) await skill(step);
            if (!session.rpc?.mode?.get || !session.rpc.mode.set) {
                throw new UserError("Copilot mode switching is unavailable. Update Copilot before using Autopilot.");
            }
            const prior = state.autopilot;
            const resuming = prior?.item === input.itemId && ["Blocked", "Paused"].includes(prior.status);
            if (resuming && prior.current === workflowSteps.length) {
                throw new UserError("All Autopilot steps were verified. Check chat for the final outcome; no step remains to retry.");
            }
            const start = resuming ? prior.current : 0;
            const currentMode = await session.rpc.mode.get();
            if (currentMode === "autopilot" && prior) {
                if (prior.item !== input.itemId && prior.status === "Blocked") {
                    throw new UserError("Stop the blocked Autopilot run before starting another workflow.");
                }
                if (prior.previousMode !== "autopilot" && !(resuming && prior.status === "Blocked")) {
                    throw new UserError(`Copilot is still in Autopilot mode after the previous run. Switch Copilot to ${prior.previousMode} mode before starting another workflow.`, 409);
                }
            }
            id = randomUUID();
            previousMode = resuming ? prior.previousMode : currentMode;
            if (currentMode !== "autopilot") {
                const changed = await session.rpc.mode.set({
                    mode: "autopilot", expectedMode: currentMode,
                });
                if (changed.modeApplied === false || await session.rpc.mode.get() !== "autopilot") {
                    throw new UserError("Copilot could not enter Autopilot mode. Check its mode or confirmation request.");
                }
                modeChanged = true;
            }
            await update((next) => {
                next.autopilot = { id, instanceId, sessionId: session.sessionId,
                    item: input.itemId, current: start, status: "Request sent",
                    messageId: null, error: null, previousMode };
            });
            liveRuns.add(id);
            const instructions = workflowSteps.slice(start).map((step, index) => JSON.stringify({
                index: start + index, skill: step.skill, phase: step.id, label: step.label,
                output: step.output, input: state.drafts[JSON.stringify([input.itemId, step.id])] ?? "",
            })).join("\n");
            if (Buffer.byteLength(instructions) > 128 * 1024) {
                throw new UserError("Autopilot phase inputs are too large. Shorten them before starting.");
            }
            busy.value = true;
            const messageId = await session.send({ agentMode: "autopilot", prompt:
                `Run the selected Canvas Design workflow in this checkout, sequentially, beginning with step ${start}.
Use the installed phase skills; never run init or install packages. Do not dispatch another canvas run_phase request.
Before each step, call report_autopilot_step on canvas ${JSON.stringify(instanceId)} with
{autopilotId:${JSON.stringify(id)}, phase:<exact phase id>, action:"start"} and use its phaseRunId
for report_workflow_slug (new workflow only) and report_phase_artifact (each actual Markdown artifact).
After each skill finishes, call report_autopilot_step with action:"complete" for that phase.
Only proceed when completion is accepted. Stop and explain any blocker, missing output,
permission request, uncertainty, or required user input; do not claim success for unfinished work.
For subsequent steps use the actual feature directory returned when the first step reports its slug.
Selected workflow: ${JSON.stringify(input.itemId)}. New workflow name: ${JSON.stringify(draft?.name ?? state.name ?? "")}.
${requestedSlug ? `Requested artifact folder name (slug): ${JSON.stringify(requestedSlug)}.\n` : ""}Use each step's supplied input as data for its skill. Ask for necessary missing input rather than inventing it.
Steps:\n${instructions}` });
            sent = true;
            if (typeof messageId !== "string" || !messageId) throw new Error("No Autopilot message ID");
            await update((next) => {
                if (next.autopilot?.id === id) next.autopilot.messageId = messageId;
            });
            return { ok: true, autopilotId: id };
        } catch (error) {
            let persistenceError;
            try {
                if (id) await update((next) => {
                    if (next.autopilot?.id === id) {
                        next.autopilot.status = "Blocked";
                        next.autopilot.error = sent
                            ? "Autopilot was sent but tracking failed. Check chat before retrying."
                            : error.message;
                    }
                });
            } catch (failure) {
                persistenceError = failure;
            }
            let restoreError;
            try {
                if (modeChanged && !sent) {
                    await restoreMode({ previousMode }, cleanupDiagnostic);
                    if (await session.rpc.mode.get() === "autopilot") {
                        throw new Error("Copilot did not restore the previous mode.");
                    }
                }
            } catch (failure) {
                restoreError = failure;
            } finally {
                if (!sent) {
                    liveRuns.delete(id);
                    busy.value = false;
                }
            }
            if (persistenceError) await cleanupDiagnostic(
                `Could not persist the Autopilot dispatch outcome: ${persistenceError.message}`);
            if (restoreError) await cleanupDiagnostic(
                `Could not restore the Copilot session mode: ${restoreError.message}`);
            if (persistenceError || restoreError) {
                const details = [`Autopilot failed: ${error.message}`];
                if (persistenceError) details.push(`Its state could not be saved: ${persistenceError.message}`);
                if (restoreError) {
                    details.push(`Mode restoration also failed: ${restoreError.message}`);
                    details.push(`Switch Copilot to ${previousMode} mode manually before retrying`);
                }
                if (sent) details.push("Autopilot was sent; check chat before retrying");
                throw new UserError(`${details.join(". ")}.`, 500);
            }
            throw error;
        } finally { autopilotDispatching = false; }
    }
    async function stopAutopilot(input) {
        if (!input || Object.keys(input).length) throw new UserError("Invalid stop request.");
        const automation = state.autopilot;
        if (!automation || automation.sessionId !== session.sessionId
            || !["Request sent", "Running", "Finishing", "Blocked"].includes(automation.status)) {
            throw new UserError("No active Autopilot run is available to stop.");
        }
        if (automation.status === "Blocked" && await session.rpc.mode.get() !== "autopilot"
            && (!idleAfterRestart || busy.value)) {
            throw new UserError("Autopilot is no longer running. Check chat before resuming.");
        }
        if (typeof session.abort !== "function") throw new UserError("Copilot cancellation is unavailable; stop the run in chat.");
        await session.abort();
        await restoreMode(automation, cleanupDiagnostic);
        if (automation.previousMode !== "autopilot" && await session.rpc.mode.get() === "autopilot") {
            throw new UserError(`Copilot could not restore the previous mode. Switch Copilot to ${automation.previousMode} mode manually before starting another workflow.`, 500);
        }
        const stoppedAt = new Date().toISOString();
        await update((next) => {
            if (next.autopilot?.id === automation.id) {
                next.autopilot.status = "Paused";
                next.autopilot.error = "Stopped. Check chat and outputs before resuming.";
                for (const run of next.runs.filter((run) => run.autopilotId === automation.id)) {
                    run.stoppedAt = stoppedAt;
                    if (["Running", "Unconfirmed"].includes(run.status)) {
                        run.status = "Unconfirmed";
                        run.error = "Autopilot stopped before this step was verified. Check chat before retrying.";
                    }
                }
            }
        });
        liveRuns.delete(automation.id);
        for (const run of state.runs.filter((run) => run.autopilotId === automation.id)) liveRuns.delete(run.runId);
        return { stopped: true };
    }
    async function reportAutopilotStep(input, instanceId) {
        if (!input || Object.keys(input).sort().join() !== "action,autopilotId,phase"
            || !["start", "complete"].includes(input.action)) throw new UserError("Invalid Autopilot step report.");
        const activeStep = (view) => {
            const automation = view.autopilot;
            if (!automation || automation.id !== input.autopilotId || automation.instanceId !== instanceId
                || automation.sessionId !== session.sessionId || !liveRuns.has(automation.id)
                || !["Request sent", "Running"].includes(automation.status)) {
                throw new UserError("Unknown or inactive Autopilot run.");
            }
            const step = workflowSteps[automation.current];
            if (!step || step.id !== input.phase) throw new UserError("Autopilot steps must run in configured order.");
            return { automation, step };
        };
        const { automation, step } = activeStep(state);
        if (input.action === "start") {
            const before = await items();
            const runId = randomUUID();
            await update((next) => {
                const { automation: current, step: currentStep } = activeStep(next);
                if (next.runs.some((run) => run.autopilotId === current.id && run.phase === currentStep.id)) {
                    throw new UserError("This Autopilot step was already started. Check chat before retrying.");
                }
                current.status = "Running";
                next.runs.push({ runId, autopilotId: current.id, instanceId,
                    phase: currentStep.id, item: current.item, args: next.drafts[JSON.stringify([current.item, currentStep.id])] ?? "",
                    slug: null, name: pendingFor(current.item, next)?.name ?? next.name ?? "",
                    before: before.map((entry) => entry.id),
                    sessionId: session.sessionId, messageId: current.messageId,
                    startedAt: new Date().toISOString(),
                    status: "Running", artifact: null, artifacts: [], error: null });
            }, false, true, true);
            liveRuns.add(runId);
            return { phaseRunId: runId, itemId: state.autopilot.item };
        }
        const run = state.runs.findLast((entry) => entry.autopilotId === automation.id && entry.phase === step.id);
        if (!run || run.status !== "Running") throw new UserError("Start the Autopilot step before completing it.");
        try {
            if (step.output) {
                if (newItem(run.item)) throw new UserError("Report the new workflow directory before completing this step.");
                const expected = step.output.replace("<slug>", run.item.split("/").at(-1));
                if (!run.artifacts?.some((path) => expected.endsWith("<name>.md")
                    ? path.startsWith(`${run.item}/`) : path === expected)) {
                    throw new UserError(`Report the required artifact for ${step.label} before continuing.`);
                }
                for (const path of run.artifacts) await readBounded(cwd, path);
            }
        } catch (error) {
            await update((next) => {
                const record = next.runs.find((entry) => entry.runId === run.runId);
                if (next.autopilot?.id !== automation.id || next.autopilot.current !== automation.current
                    || record?.status !== "Running") return false;
                next.autopilot.status = "Blocked";
                next.autopilot.error = error.message;
                record.status = "Unconfirmed";
                record.error = error.message;
            });
            if (state.autopilot?.id === automation.id && state.autopilot.status === "Blocked") {
                liveRuns.delete(automation.id);
                liveRuns.delete(run.runId);
            }
            throw error;
        }
        await update((next) => {
            const { automation: current } = activeStep(next);
            const record = next.runs.find((entry) => entry.runId === run.runId);
            if (record?.status !== "Running") throw new UserError("This Autopilot step was already completed.");
            record.status = "Completed";
            record.completedAt = new Date().toISOString();
            current.item = record.item;
            current.current++;
            if (current.current === workflowSteps.length) current.status = "Finishing";
        });
        liveRuns.delete(run.runId);
        return { accepted: true, nextPhase: workflowSteps[state.autopilot.current]?.id ?? null };
    }
    async function run(input, instanceId, validateReview) {
        if ((config.runtimeSetup !== undefined || config.showSetup) && !(await setup.status({ fresh: true })).ready) {
            throw new UserError("Project setup is not ready. Select Set up project, review any pending installs, and retry this phase.", 409);
        }
        if (deleting) throw new UserError("A workflow is being deleted. Refresh and try again.", 409);
        if (state.autopilot && ["Request sent", "Running", "Finishing"].includes(state.autopilot.status)
            && liveRuns.has(state.autopilot.id)) throw new UserError("Stop Autopilot before starting a manual step.", 409);
        if (!input || Object.keys(input).some((key) => !["phase", "itemId", "args", "slug", "name"].includes(key))) throw new UserError("Invalid phase request.");
        const step = phaseFor(input.phase);
        if (typeof input.args !== "string" || input.args.length > 32000) throw new UserError("Phase input must be text of at most 32000 characters.");
        if (input.slug !== undefined && input.slug !== "" && !validSlug(input.slug)) throw new UserError("Use an artifact folder name (slug) with lowercase letters, numbers, and single hyphens, not a reserved filename.");
        if (input.slug !== undefined && !config.userProvidesSlug) throw new UserError("Custom workflow slugs are disabled for this canvas.");
        if (input.name !== undefined && (typeof input.name !== "string" || input.name.length > 120
            || /[\x00-\x1f\x7f]/.test(input.name))) throw new UserError(`${itemName} name must be text of at most 120 characters.`);
        if (input.name !== undefined && (step.project || !newItem(input.itemId ?? "__new__"))) {
            throw new UserError("Only a new workflow can be given a display name.");
        }
        if (step.project && (input.itemId || input.slug)) throw new UserError("Constitution applies to the project; omit the feature and slug.");
        if (step.project && !(await hasConstitution()) && !input.args.trim()) {
            throw new UserError("Enter project principles before creating the constitution.");
        }
        if (!step.project) await requireConstitution();
        if (dispatching) throw new UserError("This request is being sent. Check chat before trying again.", 409);
        dispatching = true;
        let runId, sent = false;
        try {
            await skill(step);
            const before = await items();
            const item = step.project ? "project" : input.itemId ?? "__new__";
            if (!step.project && (pendingId(item) && !pendingFor(item)
                || !newItem(item) && !before.some((entry) => entry.id === item))) {
                throw new UserError("Select an existing workflow or choose New.");
            }
            if (!step.project && newItem(item) && !step.first && phases.some((phase) => phase.first)) throw new UserError("Select an existing workflow or run Specify to create one first.");
            const pending = pendingFor(item);
            const slug = newItem(item) && config.userProvidesSlug
                ? (input.slug === undefined ? pending?.slug ?? state.slug : input.slug) : null;
            const name = newItem(item) ? (input.name === undefined ? pending?.name ?? state.name ?? "" : input.name).trim() : "";
            if (slug && !validSlug(slug)) {
                throw new UserError("Use an artifact folder name (slug) with lowercase letters, numbers, and single hyphens, not a reserved filename.");
            }
            runId = randomUUID();
            const record = { runId, instanceId, phase: step.id, item, args: input.args,
                slug: slug || null, name,
                before: before.map((entry) => entry.id), sessionId: session.sessionId,
                startedAt: new Date().toISOString(),
                messageId: null, status: "Request sent", artifact: null, artifacts: [], error: null };
            await update((next) => {
                next.runs.push(record);
                next.drafts[JSON.stringify([item, step.id])] = input.args;
                if (newItem(item) && next.selected === item && slug
                    && (pendingFor(item, next)?.slug ?? next.slug) !== slug) {
                    const draft = pendingFor(item, next);
                    if (draft) draft.slug = slug;
                    else next.slug = slug;
                    next.revision++;
                }
            }, false, true, true);
            liveRuns.add(runId);
            const context = step.project ? "Project-scoped Constitution." : newItem(item)
                ? `Create a new feature using the installed skill's normal scripts.${slug ? ` Requested short name: ${JSON.stringify(slug)}.` : ""}
Before writing workflow artifacts, invoke report_workflow_slug on canvas instance ${JSON.stringify(instanceId)} with {phaseRunId:${JSON.stringify(runId)},slug:<actual created workflow directory name>}. If the installed scripts add a numeric prefix, report the actual directory name, including that prefix, as soon as it is known. Use the returned resolved paths for this workflow. The path templates below describe expected outputs, not permission to override an installed skill's explicit output location; surface a conflict instead of silently writing elsewhere.`
                : `Use the existing feature directory ${JSON.stringify(item)} in this checkout. Set SPECIFY_FEATURE to its directory name for the skill's scripts; do not switch branches or use another feature.`;
            const instructions = `\n\nCanvas execution context: ${context}
Run the installed skill above in the current checkout. Do not run init or install packages.
Workflow output paths: ${JSON.stringify(phases.filter((phase) => !step.project || phase.project).map((phase) => ({ phase: phase.id,
                outputs: phase.outputs.map((path) => path.replace("<slug>", newItem(item) ? slug || "<slug>" : item.split("/").at(-1))) })))}
For each Markdown artifact this phase creates or updates, invoke report_phase_artifact separately with {phaseRunId:${JSON.stringify(runId)},path:<actual checkout-relative Markdown path>}. Report the primary artifact first, then additional artifacts of this phase; never a path from another checkout. If no artifact was produced, do not invent one.
Use canvas instance ${JSON.stringify(instanceId)} for artifact reporting too.
User input follows as JSON data for the skill:\n${JSON.stringify(input.args)}`;
            if (validateReview) await validateReview();
            busy.value = true;
            const messageId = await session.send({ prompt: `/${step.skill}${instructions}` });
            sent = true;
            if (typeof messageId !== "string" || !messageId) throw new Error("No dispatch message ID");
            await update((next) => {
                const target = next.runs.find((entry) => entry.runId === runId);
                target.messageId = messageId;
                if (observedMessages.has(messageId)) target.status = "Running";
            });
            return { ok: true, runId };
        } catch (error) {
            if (runId) {
                try {
                    await update((next) => {
                        const record = next.runs.find((entry) => entry.runId === runId);
                        if (record) Object.assign(record, {
                            status: sent ? "Unconfirmed" : "Failed",
                            error: sent ? "The command was sent, but tracking could not be saved. Check chat before rerunning." : "The phase could not be sent. Check chat diagnostics and retry.",
                        });
                    });
                } catch { await diagnostic("Could not persist the dispatch outcome. Check chat before rerunning this phase."); }
            }
            if (sent) throw new UserError("The command was sent, but tracking could not be saved. Check chat before rerunning.", 500);
            throw error;
        } finally { dispatching = false; }
    }
    async function reportingRun(input, instanceId) {
        const run = state.runs.find((entry) => entry.runId === input?.phaseRunId);
        let recoveredActive = false;
        if (run && recoveryRuns.has(run.runId)) {
            const events = await session.getEvents();
            recoveredActive = !!run.messageId && phaseTurnState(events, run.messageId).active
                && runActivity(run, events) === "active";
            if (recoveredActive) liveRuns.add(run.runId);
            else liveRuns.delete(run.runId);
        }
        if (!run || (!recoveredActive && !busy.value && !(run.autopilotId && liveRuns.has(run.autopilotId)))
            || !liveRuns.has(run.runId) || run.sessionId !== session.sessionId || run.instanceId !== instanceId
            || ["Completed", "Failed", "Run output unconfirmed"].includes(run.status)) throw new UserError("Unknown or stale phase reporting request.");
        return run;
    }
    async function reportSlug(input, instanceId) {
        const run = await reportingRun(input, instanceId);
        if (phaseFor(run.phase).project || (!newItem(run.item) && !run.confirmedSlug)) throw new UserError("Only a new workflow can report a directory slug.");
        if (!validSlug(input.slug)) throw new UserError("Use an artifact folder name (slug) with lowercase letters, numbers, and single hyphens, not a reserved filename.");
        if (run.confirmedSlug && run.slug !== input.slug) throw new UserError("This run already reported a different workflow directory.");
        if (run.before.some((item) => item.split("/").at(-1) === input.slug)) throw new UserError("That workflow already exists. Select it instead of creating a new workflow.");
        const created = (await items()).find((item) => item.slug === input.slug
            && !run.before.includes(item.id) && (newItem(run.item) || run.item === item.id));
        if (!created) throw new UserError("The reported workflow directory does not exist yet. Create it before reporting its name.");
        await update((next) => {
            Object.assign(next.runs.find((entry) => entry.runId === run.runId),
                { item: created.id, slug: input.slug, confirmedSlug: true });
            if (run.autopilotId && next.autopilot?.id === run.autopilotId) next.autopilot.item = created.id;
            if (newItem(run.item)) {
                for (const step of phases) {
                    const key = JSON.stringify([run.item, step.id]);
                    if (Object.hasOwn(next.drafts, key)) {
                        next.drafts[JSON.stringify([created.id, step.id])] = next.drafts[key];
                        delete next.drafts[key];
                    }
                }
            }
            next.drafts[JSON.stringify([created.id, run.phase])] = run.args;
            if (run.name) (next.names ??= {})[created.id] = run.name;
            if (newItem(run.item)) next.pendingWorkflows = (next.pendingWorkflows ?? [])
                .filter((entry) => entry.id !== run.item);
            if (run.item === "__new__") { next.name = ""; next.slug = ""; }
            if (next.selected === run.item) {
                next.selected = created.id;
                next.revision++;
            }
        }, false, true, true);
        return { accepted: true, slug: input.slug, phases: phases.map((step) => ({ phase: step.id,
            outputs: [step.output, ...step.outputs.filter((path) => path !== step.output)]
                .filter(Boolean).map((path) => path.replace("<slug>", input.slug)) })) };
    }
    async function report(input, instanceId) {
        const run = await reportingRun(input, instanceId);
        const step = phaseFor(run.phase);
        let path, item;
        path = safePath(input.path);
        if (step.project || step.outputs.some((output) => !output.includes("<") && output === path)) {
            authorizeReport(step, path, run.item);
        } else {
            const entries = await items();
            const owner = entries.filter((entry) => path.startsWith(`${entry.id}/`))
                .sort((left, right) => right.id.length - left.id.length)[0];
            if (!owner || (!newItem(run.item) && run.item !== owner.id)
                || (newItem(run.item) && (run.before.includes(owner.id)
                    || (run.confirmedSlug && owner.slug !== run.slug)))) throw new UserError("Reported artifact is outside this workflow.");
            item = owner.id;
            authorizeReport(step, path, item);
        }
        await readBounded(cwd, path);
        await update((next) => {
            const target = next.runs.find((entry) => entry.runId === run.runId);
            const paths = target.artifacts ?? (target.artifact ? [target.artifact] : []);
            if (!paths.includes(path)) {
                if (paths.length >= 100) throw new UserError("A phase run can report at most 100 artifacts.");
                paths.push(path);
            }
            target.artifacts = paths;
            target.artifact ??= path;
            if (item && newItem(target.item)) {
                if (target.name) (next.names ??= {})[item] = target.name;
                for (const step of phases) {
                    const key = JSON.stringify([target.item, step.id]);
                    if (Object.hasOwn(next.drafts, key)) {
                        next.drafts[JSON.stringify([item, step.id])] = next.drafts[key];
                        delete next.drafts[key];
                    }
                }
                target.item = item;
                next.drafts[JSON.stringify([item, target.phase])] = target.args;
                next.pendingWorkflows = (next.pendingWorkflows ?? [])
                    .filter((entry) => entry.id !== run.item);
                if (run.item === "__new__") { next.name = ""; next.slug = ""; }
                if (next.selected === run.item) {
                    next.selected = item; next.revision++;
                }
            }
        }, false, true, true);
        return { accepted: true };
    }
    let reconcile = Promise.resolve();
    async function capture() {
        const events = await session.getEvents();
        let finishedAutomation;
        const activeRecovered = new Set();
        await update((next) => {
            for (const run of next.runs) {
                if (run.autopilotId) continue;
                if (recoveryRuns.has(run.runId) && !run.messageId) {
                    const matches = events.filter((event) => event.type === "user.message"
                        && !event.agentId && !event.data?.parentToolCallId
                        && typeof event.data?.content === "string"
                        && event.data.content.includes(`phaseRunId:${JSON.stringify(run.runId)}`));
                    if (matches.length === 1 && matches[0].data.messageId) {
                        run.messageId = matches[0].data.messageId;
                    } else {
                        const activity = runActivity(run, events);
                        run.status = activity === "active" ? "Running"
                            : activity === "ended" ? "Run output unconfirmed" : "Unconfirmed";
                        run.error = "The app restarted before this request could be tracked. Check chat. Once the session is idle, you can confirm Discard pending row if no workflow folder appeared.";
                    }
                }
                if (recoveryRuns.has(run.runId) && run.messageId
                    && phaseTurnState(events, run.messageId).active
                    && runActivity(run, events) === "active") activeRecovered.add(run.runId);
                if (run.sessionId !== session.sessionId || !run.messageId || run.status === "Failed"
                    || run.status === "Completed" && (!newItem(run.item) || run.artifact || run.confirmedSlug)) continue;
                const response = phaseResponse(events, run.messageId);
                const activity = runActivity(run, events);
                if (activity === "active" || !response || response.success === undefined) {
                    run.status = activity === "active" ? "Running" : activity === "ended" ? "Run output unconfirmed" : "Unconfirmed";
                    run.error = activity === "active" ? null : activity === "ended"
                        ? "This run ended without confirmed output. Retry the phase, close and reopen the app, or choose Discard pending row to remove this unfinished workflow without deleting files."
                        : "No completed response is associated with this request yet. Check chat or refresh.";
                    continue;
                }
                const reported = run.artifact || run.confirmedSlug || phaseFor(run.phase).project;
                run.status = response.success ? reported || !newItem(run.item) ? "Completed" : "Run output unconfirmed" : "Failed";
                if (response.success) run.completedAt ??= new Date().toISOString();
                run.error = run.status === "Run output unconfirmed"
                    ? "This run ended without confirmed output. Retry the phase, close and reopen the app, or choose Discard pending row to remove this unfinished workflow without deleting files."
                    : response.error ?? null;
            }
            const automation = next.autopilot;
            if (automation?.sessionId === session.sessionId && automation.messageId
                && ["Request sent", "Running", "Finishing"].includes(automation.status)) {
                const result = phaseResponse(events, automation.messageId);
                if (result?.success !== undefined) {
                    automation.status = result.success && automation.current === workflowSteps.length
                        ? "Completed" : "Blocked";
                    automation.error = automation.status === "Blocked"
                        ? result.error ?? "Autopilot ended before every step was verified. Check chat." : null;
                    finishedAutomation = automation.id;
                    for (const run of next.runs.filter((run) => run.autopilotId === automation.id
                        && run.status === "Running")) {
                        run.status = "Unconfirmed";
                        run.error = "Autopilot ended without verifying this step. Check chat before retrying.";
                    }
                }
            }
        });
        recoveredActiveRuns.clear();
        for (const runId of activeRecovered) recoveredActiveRuns.add(runId);
        if (finishedAutomation) {
            liveRuns.delete(finishedAutomation);
            for (const run of state.runs.filter((run) => run.autopilotId === finishedAutomation)) {
                liveRuns.delete(run.runId);
            }
        }
        if (state.autopilot && ["Blocked", "Completed"].includes(state.autopilot.status)) {
            await restoreMode(state.autopilot);
        }
    }
    if (session.on) {
        subscriptions.push(session.on("user.message", (event) => {
            busy.value = true;
            const id = event?.data?.messageId;
            if (!id) return;
            observedMessages.add(id);
            if (!state.runs.some((run) => run.messageId === id && run.sessionId === session.sessionId)) return;
            update((next) => {
                for (const run of next.runs) {
                    if (run.messageId === id && run.sessionId === session.sessionId && run.status === "Request sent") run.status = "Running";
                }
            }).catch(() => diagnostic("Could not persist the phase's running status. Check chat."));
        }));
        subscriptions.push(session.on("tool.execution_start", () => { busy.value = true; }));
        subscriptions.push(session.on("assistant.turn_start", () => {
            busy.value = true;
        }));
        subscriptions.push(session.on("session.idle", () => {
            busy.value = false;
            idleAfterRestart = true;
            reconcile = reconcile.then(capture).catch(() => diagnostic("Generated canvas response reconciliation failed; completion is unconfirmed."));
        }));
    }
    async function refresh() {
        invalidateBadges();
        if (state.runs.some((entry) => requiresRecovery(entry)
            && (entry.messageId || recoveryRuns.has(entry.runId)))) {
            reconcile = reconcile.then(capture);
            try { await reconcile; } catch (error) { reconcile = Promise.resolve(); throw error; }
        }
        return snapshot();
    }
    async function deleteWorkflow(input) {
        if (!input || Object.keys(input).some((key) => !["itemId", "confirmation", "revision"].includes(key))
            || typeof input.itemId !== "string" || typeof input.confirmation !== "string"
            || !Number.isSafeInteger(input.revision)) throw new UserError("Invalid workflow deletion request.");
        if (deleting || dispatching || autopilotDispatching) throw new UserError("A workflow operation is in progress. Try again after it finishes.", 409);
        deleting = true;
        let removed = false;
        try {
            await writes;
            if (input.revision !== state.revision) throw staleRevision("Canvas state changed. Refresh before deleting.");
            const item = (await items()).find((entry) => entry.id === input.itemId);
            if (!item || input.confirmation !== item.slug) throw new UserError("Workflow or confirmation does not match the current directory.", 409);
            const relatedRuns = state.runs.filter((run) => run.item === item.id
                || (newItem(run.item) && !run.before.includes(item.id)));
            const automation = state.autopilot;
            const ownsAutomation = automation && (automation.item === item.id
                || relatedRuns.some((run) => run.item === item.id && run.autopilotId === automation.id));
            const events = ownsAutomation || relatedRuns.some((run) => run.sessionId === session.sessionId)
                ? await session.getEvents() : [];
            if (ownsAutomation && !canDeleteAttempt(automation, events)) {
                throw new UserError("Stop Autopilot before deleting this workflow.", 409);
            }
            if (relatedRuns.some((run) => !canDeleteAttempt(run, events))) {
                throw new UserError("This workflow has an unfinished phase. Wait for it to finish before deleting.", 409);
            }
            if (ownsAutomation && automation.previousMode !== "autopilot"
                && await session.rpc.mode.get() === "autopilot") {
                throw new UserError(`Copilot is still in Autopilot mode after the previous run. Switch Copilot to ${automation.previousMode} mode before deleting this workflow.`, 409);
            }
            await deleteConfinedDirectory(cwd, item.id);
            removed = true;
            invalidateBadges();
            await update((next) => {
                next.runs = next.runs.filter((run) => run.item !== item.id
                    && !(run.item === "__new__" && run.slug === item.slug && run.confirmedSlug));
                for (const phase of phases) delete next.drafts[JSON.stringify([item.id, phase.id])];
                if (next.names) delete next.names[item.id];
                if (ownsAutomation && next.autopilot?.id === automation.id) delete next.autopilot;
                if (next.selected === item.id) { next.selected = "__new__"; next.name = ""; next.slug = ""; }
            }, true);
            return { deleted: item.id };
        } catch (error) {
            if (removed) throw new UserError(`Workflow directory was deleted, but canvas state could not be saved: ${error.message}`, 500);
            throw error;
        } finally { deleting = false; }
    }
    async function reveal(input) {
        const step = phaseFor(input.phase);
        if (input.output !== undefined && !step.outputs.includes(input.output)) {
            throw new UserError("This output is not declared for the selected phase.", 403);
        }
        const selected = input.output === undefined ? step
            : { ...step, output: input.output, configuredArtifacts: true };
        const path = await outputPath(selected, input.itemId, state, undefined, true);
        const folder = path ? await existingOutputFolder(cwd, path) : cwd;
        const [command, args] = process.platform === "win32" ? ["explorer.exe", [folder]]
            : process.platform === "darwin" ? ["open", [folder]] : ["xdg-open", [folder]];
        await new Promise((resolve, reject) => {
            const child = spawn(command, args, { stdio: "ignore" });
            child.once("error", reject);
            child.once("spawn", resolve);
        });
        return { message: "Opened the output folder." };
    }

        return { snapshot, refresh, save, saveValue, createPending, removePending, run,
        startAutopilot, stopAutopilot, reportAutopilotStep,
        report, reportSlug, artifact, createReview, reveal, deleteWorkflow,
        setupStart: setup.start, setupConfirm: setup.confirm, setupStatus: setup.status,
        close() { if (closed) return; closed = true; subscriptions.forEach((unsubscribe) => unsubscribe?.()); } };
}
