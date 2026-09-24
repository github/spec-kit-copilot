// speckit-generated-workflow-template v1
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { readFile, readdir, lstat, realpath } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { joinSession, createCanvas } from "@github/copilot-sdk/extension";
import { createWorkflowAdapter } from "./runtime/workflow-adapter.mjs";
import { createAmendmentRuntime } from "./amendment-runtime.mjs";
import { createArtifactReviewer } from "./artifact-review.mjs";
import { createPhaseRunStore, currentPhaseSummary, milestoneTags } from "./runtime/phase-runs.mjs";
import { phaseResult, reportInstructions } from "./runtime/phase-results.mjs";
import { phaseResponse } from "./phase-response.mjs";
import { commandViews } from "./ui/command-views.mjs";
import { validateWorkflowSlug } from "./ui/workflow-slug.mjs";
import { visibleMarkers } from "./ui/clarifications.mjs";
import { constitutionGate, inspectConstitution } from "./project-artifacts.mjs";
import {
    deleteWorkspaceDirectory,
    revealWorkspaceDirectory,
    resolveWorkspaceDirectory,
    resolveWorkflowPath,
    validateWorkflowPaths,
    resolveDeclaredArtifact,
    readWorkflowArtifact,
} from "./runtime/workspace-files.mjs";
import {
    buildSetupPrompt,
    inspectSetup,
    setupContractFingerprint,
} from "./setup-runtime.mjs";
import {
    acceptInstallationApproval,
    approvalComponents,
    missingInstallSources,
    readInstallationApproval,
    requiresInstallationApproval,
} from "./approval-runtime.mjs";

const here = dirname(fileURLToPath(import.meta.url));
function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    for (const entry of Object.values(value)) deepFreeze(entry);
    return Object.freeze(value);
}

const pipeline = deepFreeze(JSON.parse(await readFile(join(here, "pipeline.json"), "utf8")));
validateWorkflowPaths(pipeline);
const commands = commandViews(pipeline);
const adapter = createWorkflowAdapter(JSON.parse(await readFile(join(here, "workflow-config.json"), "utf8")), pipeline);
const experience = deepFreeze(JSON.parse(await readFile(join(here, "canvas-experience.json"), "utf8")));
const installationMode = experience.categories?.["canvas-onboarding"]?.installationMode;
if (!["external", "prompt", "automatic"].includes(installationMode)) {
    throw new Error("Invalid captured installation mode");
}
const runtimeSetup = deepFreeze({ ...pipeline.setup, installationMode });
const phaseResults = new Map(pipeline.pipeline.steps.map((step) =>
    [step.instanceKey, phaseResult(experience, step.commandName)]));
const hasPhaseReports = [...phaseResults.values()].some((result) => result?.source.kind === "phase-report");
const instances = new Map();
const instanceAliases = new Map();
const automaticSetupDispatches = new Map();
const workspaceSetupReadiness = new Map();
const phaseRuns = createPhaseRunStore({ extensionId: __EXTENSION_ID_JSON__, pipeline, phaseResults });
const workflowSlugReservations = new Map();
const approvedSetupDispatches = new Map();
const skillsReloads = new Map();
const INIT_WARNING = "Initializing this destination with specify init --here --force --integration copilot --integration-options=\"--skills\" --script py --ignore-agent-tools may replace existing project files. Review changes before confirming.";
const BODY_CAP = 256 * 1024;
const TYPES = {
    ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8", ".mjs": "application/javascript; charset=utf-8",
    ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg", ".webp": "image/webp",
};
let session;
const inspectFoundation = (inst, options = {}) => inspectSetup({
    cwd: inst.cwd, setup: runtimeSetup,
    reloadAvailable: typeof session?.rpc?.skills?.reload === "function", ...options,
});
let agentBusy = true;
let responseRevision = 0;
const responseScans = new Map();
const responseFailures = new Set();
const statusDiagnostics = new Set();
function statusDiagnostic(category, scope = {}) {
    const key = JSON.stringify([category, scope]);
    if (statusDiagnostics.has(key)) return;
    if (statusDiagnostics.size >= 256) statusDiagnostics.delete(statusDiagnostics.values().next().value);
    statusDiagnostics.add(key);
    console.error(`[workflow-status] ${key}`);
}
const undetermined = () => ({ state: "reviewed", statusId: "not-determined", label: "Not determined" });
const reviewConfig = adapter.artifactReview();
const trackPhaseRuns = Boolean(reviewConfig) || adapter.clarificationTag || hasPhaseReports;
const artifactReviewer = createArtifactReviewer({
    config: reviewConfig,
    onDiagnostic: statusDiagnostic,
    dispatch: (input) => session.send(input),
    readCurrent: async (inst, itemId, phase) => {
        const item = (await listItems(inst)).find((candidate) => candidate.id === itemId);
        const step = commands.workflow.find((entry) => entry.instanceKey === phase);
        if (!item || !step) return null;
        const run = phaseRuns.forItem(await phaseRuns.read(inst), item).find((entry) => entry.phase === phase);
        if (!run) return null;
        return { ...run, ...await phaseArtifact(inst, item, step) };
    },
});
const amendArtifact = createAmendmentRuntime({
    pipeline,
    items: listItems,
    dispatch: (input) => session.send(input),
    gate: async (inst) => {
        const blocked = await executionGate(inst);
        if (blocked) return blocked;
        const setup = await executionSetupStatus(inst);
        return setup.ready ? null : {
            ok: false, code: "setup_required",
            error: "Setup and session skills must be ready before applying answers. Complete setup, then retry; nothing was queued.",
        };
    },
});

function approvalContext(inst) {
    return { cwd: inst.cwd, extensionId: __EXTENSION_ID_JSON__, identity: inst.identity, setup: runtimeSetup };
}

function executionKey(inst) {
    return `${inst.cwd}:${inst.identity}:${setupContractFingerprint(runtimeSetup)}`;
}

function requiresInitializationConfirmation(inst, disk) {
    const init = disk.checks.find((entry) => entry.id === "spec-kit-init");
    return !init?.ready && (!inst.initializationApproved
        || inst.initializationEvidence !== init.stamp);
}

function initializationStatus(inst, disk) {
    const init = disk.checks.find((entry) => entry.id === "spec-kit-init");
    if (init?.ready) return null;
    const approved = !requiresInitializationConfirmation(inst, disk);
    return {
        required: true, approved,
        state: approved ? "verifying" : (inst.initializationDeferred ? "deferred" : "pending"),
        message: INIT_WARNING,
        ...(!approved ? { challenge: inst.initializationChallenge } : {}),
    };
}

async function installationApproval(inst, disk) {
    try {
        let components;
        if (requiresInstallationApproval(runtimeSetup)) {
            const observed = disk ?? await inspectFoundation(inst);
            components = approvalComponents(runtimeSetup).map((entry) => ({
                ...entry,
                installed: observed.contributions.find((candidate) => candidate.kind === entry.kind && candidate.id === entry.id)?.installed === true,
            }));
            if (observed.contributionsInstalled) {
                return {
                    required: false, approved: true, installationApproved: false,
                    state: "already-installed", components,
                };
            }
            const unverified = observed.contributions.filter((entry) => entry.installationState === "unverified");
            if (unverified.length) {
                throw new Error(`Cannot verify required components in this project. ${unverified.map((entry) => entry.message).join(" ")}`);
            }
        }
        const approval = await readInstallationApproval(approvalContext(inst));
        return {
            ...approval,
            ...(approval.required ? { copy: experience.categories["canvas-onboarding"].approvalCopy } : {}),
            installationApproved: approval.required && approval.approved,
            ...(components ? { components } : {}),
            state: approval.approved ? "approved" : (inst.approvalDeferred ? "deferred" : "pending"),
            ...(approval.required ? { challenge: inst.approvalChallenge } : {}),
        };
    } catch (error) {
        return {
            required: true, approved: false, state: "error",
            error: `Cannot verify installation approval: ${error.message}`,
            components: approvalComponents(runtimeSetup),
        };
    }
}

async function executionGate(inst, reveal = true, disk) {
    disk ??= await inspectFoundation(inst);
    if (requiresInitializationConfirmation(inst, disk)) {
        inst.pendingRuns.clear();
        inst.setupSnapshot = null;
        if (reveal) inst.broadcast?.();
        return {
            ok: false, queued: false, code: "initialization_confirmation_required",
            error: INIT_WARNING,
        };
    }
    const missingFoundation = disk.checks.find((entry) =>
        ["specify-cli", "copilot-plugin", "skills-reload"].includes(entry.id) && !entry.ready);
    if (missingFoundation) {
        inst.pendingRuns.clear();
        return { ok: false, queued: false, code: "foundation_unavailable", error: missingFoundation.message };
    }
    const mismatched = disk.contributions.filter((entry) =>
        entry.installationState === "unverified"
        || (entry.installed && !entry.identityReady));
    if (mismatched.length) {
        inst.pendingRuns.clear();
        return {
            ok: false, queued: false, code: "setup_provenance_mismatch",
            error: `Required package provenance could not be verified: ${mismatched.map((entry) => entry.message).join("; ")}`,
        };
    }
    const unavailable = missingInstallSources(runtimeSetup, disk.contributions);
    if (unavailable.length) {
        inst.pendingRuns.clear();
        return {
            ok: false, queued: false, code: "setup_source_unavailable",
            error: `Missing packages have no captured portable HTTPS source: ${unavailable.map((entry) => `${entry.kind} ${entry.id}`).join(", ")}. Supply matching packages externally.`,
        };
    }
    if (installationMode === "external") {
        const missing = disk.contributions.filter((entry) => !entry.ready);
        if (missing.length) {
            inst.pendingRuns.clear();
            return {
                ok: false, queued: false, code: "external_setup_required",
                error: `Externally managed components require administrator setup: ${missing.map((entry) => `${entry.kind} ${entry.id}: ${entry.message}`).join("; ")}`,
            };
        }
    }
    const approval = await installationApproval(inst, disk);
    if (approval.approved) return null;
    inst.awaitingInstallation = true;
    inst.pendingRuns.clear();
    inst.skillsReload = null;
    inst.setupSnapshot = null;
    workspaceSetupReadiness.delete(executionKey(inst));
    if (reveal) {
        inst.approvalDeferred = false;
        inst.broadcast?.();
    }
    return {
        ok: false, queued: false, approvalRequired: true,
        code: approval.error ? "installation_approval_error" : "installation_approval_required",
        error: approval.error ?? "Review installation and approve the required components before running this canvas.",
    };
}

function sameExecutionScope(left, right) {
    return left.cwd === right.cwd && left.identity === right.identity;
}

function instanceFor(instanceId) {
    let resolvedId = instanceId;
    const seen = new Set();
    while (instanceAliases.has(resolvedId) && !seen.has(resolvedId)) {
        seen.add(resolvedId);
        resolvedId = instanceAliases.get(resolvedId);
    }
    return instances.get(resolvedId);
}

function inside(root, child) {
    const rel = relative(root, child);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function tokenMatches(provided, expected) {
    if (typeof provided !== "string" || typeof expected !== "string") return false;
    const left = Buffer.from(provided);
    const right = Buffer.from(expected);
    return left.length === right.length && timingSafeEqual(left, right);
}

async function body(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > BODY_CAP) throw new Error("body too large");
        chunks.push(chunk);
    }
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

function send(res, status, value, type = "application/json; charset=utf-8") {
    res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
    res.end(type.startsWith("application/json") ? JSON.stringify(value) : value);
}

async function artifactPath(step, item, inst) {
    return resolveDeclaredArtifact(inst.cwd, step?.artifact?.pathTemplate, item?.slug, pipeline);
}

async function phaseArtifact(inst, item, step, scanClarifications = true) {
    let artifact = null;
    try {
        artifact = await artifactPath(step, item, inst);
        if (!artifact) return { artifact: null, content: null, clarificationCount: null, artifactError: null };
        const { content, mtimeMs } = await readWorkflowArtifact(inst.cwd, artifact, pipeline, { metadata: true });
        return { artifact, content, mtimeMs, clarificationCount: content.trim() ? (adapter.clarificationTag && scanClarifications ? visibleMarkers(content).length : 0) : null,
            artifactError: content.trim() ? null : "Artifact is empty or still being written." };
    } catch (error) {
        if (error.code === "ENOENT") return { artifact: null, content: null, clarificationCount: null, artifactError: null };
        return { artifact, content: null, clarificationCount: null,
            artifactError: "Could not read the artifact safely. Automatic refresh will retry." };
    }
}

async function captureResponses(inst) {
    const record = await phaseRuns.read(inst);
    const pending = [...record.items, ...record.pending].flatMap((entry) => entry.runs ?? [])
        .filter((run) => responseScans.get(run.runId) !== responseRevision);
    if (!pending.length) return;
    let events = null;
    if ((reviewConfig || hasPhaseReports) && pending.some((run) => run.messageId && run.sessionId && run.sessionId === session.sessionId)) {
        try { events = await session.getEvents(); }
        catch { statusDiagnostic("response-history-unavailable"); }
    }
    for (const run of pending) {
        const scope = { runId: run.runId, phase: run.phase };
        responseScans.set(run.runId, responseRevision);
        let response = run.response;
        let outcome = null;
        try {
            if (run.messageId && run.sessionId === session.sessionId && events) {
                const captured = phaseResponse(events, run.messageId);
                if (captured?.error) statusDiagnostic("response-unavailable", scope);
                if (captured) {
                    response = captured.response;
                    outcome = captured.success;
                }
            } else if (reviewConfig && !response) {
                statusDiagnostic("response-unavailable", scope);
            }
        } catch {
            statusDiagnostic("response-capture-failed", scope);
        }
        try {
            if (run.reporting && outcome === null) {
                statusDiagnostic("phase-outcome-unavailable", scope);
                continue;
            }
            const error = run.reporting && outcome === false ? "Phase did not complete successfully." : null;
            await phaseRuns.complete(inst, run.runId, { response, error });
            if (run.reporting && !error && !run.reporting.resultId) statusDiagnostic("phase-result-missing", scope);
            responseFailures.delete(run.runId);
        } catch {
            responseFailures.add(run.runId);
            statusDiagnostic("response-save-failed", scope);
        }
    }
}

function newItem() {
    return { id: "__new__", slug: null, label: "New", isNew: true };
}

function bindingKey(inst) {
    return `${inst.cwd}:${__EXTENSION_ID_JSON__}`;
}

function slugReservationKey(inst, slug) {
    return `${bindingKey(inst)}:${slug}`;
}

async function discoveredItems(inst) {
    const rootTemplate = pipeline.runtime?.itemRoot;
    if (!rootTemplate) return [];
    const marker = rootTemplate.indexOf("<slug>");
    const parentRel = rootTemplate.slice(0, marker).replace(/[\\/]$/, "");
    const parent = resolve(inst.cwd, parentRel);
    if (!inside(inst.cwd, parent)) throw new Error("item root escapes workspace");
    let entries = [];
    try {
        const realParent = await resolveWorkspaceDirectory(inst.cwd, parentRel);
        entries = await readdir(realParent, { withFileTypes: true });
    } catch (error) {
        if (error.code === "ENOENT") return [];
        throw error;
    }
    const directories = entries
        .filter((entry) => {
            const { slug, error } = validateWorkflowSlug(entry.name);
            return entry.isDirectory() && !entry.isSymbolicLink() && entry.name === slug && !error;
        });
    return Promise.all(directories.map(async (entry) => {
        const stat = await lstat(join(parent, entry.name));
        return {
            id: entry.name,
            slug: entry.name,
            label: entry.name,
            lastActivity: stat.mtimeMs,
        };
    }));
}

async function defaultItems(inst) {
    if (commands.constitution && !commands.workflow.length) return [];
    const rootTemplate = pipeline.runtime?.itemRoot;
    if (!rootTemplate) return [{ id: "project", slug: null, label: "Project" }];
    const discovered = await discoveredItems(inst);
    const { record, error } = await phaseRuns.reconcile(inst, discovered);
    inst.runBinding = error ? { state: "error", error }
        : record.binding ? { state: "bound", slug: record.binding }
            : { state: record.pending.length ? "pending" : "unbound" };
    if (pipeline.runtime?.multiInstance === true) {
        const pendingItems = record.pending.filter((entry) => entry.slug).map((entry) => ({
            id: entry.slug, slug: entry.slug, label: entry.slug, pendingFolder: true,
        }));
        return [...discovered, ...pendingItems, newItem()];
    }
    if (record.binding) {
        const item = discovered.find((entry) => entry.slug === record.binding);
        return [item ?? { id: record.binding, slug: record.binding, label: record.binding }];
    }
    return [newItem()];
}

async function listItems(inst) {
    return adapter.listItems({ defaults: () => defaultItems(inst) });
}

async function setupStatus(inst, { refresh = false, disk } = {}) {
    // Ready UI snapshots are read-only. Execution and explicit setup actions recheck disk.
    // Unresolved setup keeps observing out-of-band installations and agent repairs.
    if (!refresh && (inst.setupSnapshot?.ready
        || (inst.setupSnapshot?.diskReady && inst.setupSnapshot.reload?.ok === false))) return inst.setupSnapshot;
    disk ??= await inspectFoundation(inst);
    const initialization = initializationStatus(inst, disk);
    if (initialization && !initialization.approved) {
        return inst.setupSnapshot = {
            ready: false, diskReady: false, state: "initialization-required",
            message: initialization.message, checks: disk.checks,
            diskFingerprint: disk.diskFingerprint, reload: null, initialization,
        };
    }
    const unavailable = missingInstallSources(runtimeSetup, disk.contributions);
    if (unavailable.length) {
        return inst.setupSnapshot = {
            ready: false, diskReady: false, state: "failed",
            message: `Missing packages have no captured portable HTTPS source: ${unavailable.map((entry) => `${entry.kind} ${entry.id}`).join(", ")}. Supply matching packages externally.`,
            checks: disk.checks, diskFingerprint: disk.diskFingerprint, reload: null,
        };
    }
    const approval = await installationApproval(inst, disk);
    if (!approval.approved) {
        inst.awaitingInstallation = true;
        return inst.setupSnapshot = {
            ready: false, state: approval.error ? "failed" : "approval-required",
            message: approval.error ?? "Required installation has not been approved",
            checks: [], reload: null, approval,
        };
    }
    if (!disk.diskReady) {
        inst.skillsReload = null;
        workspaceSetupReadiness.delete(executionKey(inst));
    }
    const reloadReady = inst.skillsReload?.ok === true
        && inst.skillsReload.fingerprint === disk.diskFingerprint;
    const ready = disk.diskReady && reloadReady;
    const dispatchState = inst.setupDispatch?.state ?? null;
    const state = ready
        ? "ready"
        : (dispatchState === "failed" ? "failed" : (dispatchState && dispatchState !== "ready" ? dispatchState : "required"));
    const missing = disk.checks.filter((entry) => !entry.ready).map((entry) => entry.message);
    const reloadCheck = {
        id: "session-skills",
        ready: reloadReady,
        message: reloadReady
            ? "Required skills are available to the current Copilot session."
            : "The current Copilot session must reload the generated workflow skills.",
    };
    return inst.setupSnapshot = {
        ready,
        diskReady: disk.diskReady,
        state,
        message: ready
            ? null
            : (state === "failed"
                ? inst.setupDispatch.error
                : (missing[0] ?? reloadCheck.message)),
        checks: [...disk.checks, reloadCheck],
        diskFingerprint: disk.diskFingerprint,
        reload: inst.skillsReload ?? null,
        ...(approval.required ? { approval } : {}),
        ...(initialization ? { initialization } : {}),
    };
}

async function executionSetupStatus(inst) {
    let status = await setupStatus(inst, { refresh: true });
    if (status.diskReady && !status.ready) {
        await reloadSessionSkills(inst);
        status = await setupStatus(inst, { refresh: true });
    }
    return status;
}

async function snapshot(inst, allowReview = false) {
    const setup = await setupStatus(inst);
    if (trackPhaseRuns && (allowReview || hasPhaseReports) && !agentBusy) await captureResponses(inst);
    const items = await listItems(inst);
    for (const id of inst.clarificationCounts.keys()) {
        if (!items.some((item) => item.id === id)) inst.clarificationCounts.delete(id);
    }
    const runs = await phaseRuns.read(inst);
    for (const item of items) {
        item.phases = {};
        let itemRuns = phaseRuns.forItem(runs, item);
        const deferClarifications = itemRuns.some((run) => !run.completed);
        const clarificationCounts = inst.clarificationCounts.get(item.id) ?? {};
        const phaseEvidence = {}, results = [];
        item.latestPhase = itemRuns.reduce((latest, run) => !latest || latest.sequence < run.sequence ? run : latest, null)?.phase ?? null;
        for (const step of commands.workflow) {
            const evidence = await phaseArtifact(inst, item, step, !deferClarifications);
            if (adapter.clarificationTag) {
                if (deferClarifications) evidence.clarificationCount = clarificationCounts[step.instanceKey] ?? (evidence.artifact ? 0 : null);
                else clarificationCounts[step.instanceKey] = evidence.clarificationCount;
            }
            phaseEvidence[step.instanceKey] = evidence;
            const { artifact, clarificationCount, artifactError } = evidence;
            const run = itemRuns.find((entry) => entry.phase === step.instanceKey);
            item.phases[step.instanceKey] = {
                hasRun: (runs.pending.find((entry) => entry.slug === (item.isNew ? null : item.slug))?.phases
                    ?.includes(step.instanceKey) === true)
                    || (!item.isNew && runs.items.find((entry) => entry.id === item.id)?.phases.includes(step.instanceKey) === true),
                artifact,
                clarificationCount,
                ...(artifactError ? { artifactError } : {}),
            };
            const configuredResult = phaseResults.get(step.instanceKey);
            if (configuredResult && run?.reporting?.settledId) {
                const value = configuredResult.values.find((entry) => entry.id === run.reporting.settledId);
                if (value) item.phases[step.instanceKey].result = {
                    id: value.id, label: value.label, tone: value.tone, summary: configuredResult.summary,
                };
            }
            if (reviewConfig) {
                let review;
                try {
                    review = run?.error || responseFailures.has(run?.runId) ? undetermined()
                        : await artifactReviewer.observe(inst, {
                            ...evidence, phase: step.instanceKey, runId: run?.runId ?? null,
                            completed: run?.completed === true, response: run?.response ?? null,
                            itemId: item.id,
                            canDispatch: allowReview && setup.ready && !agentBusy,
                        });
                } catch {
                    statusDiagnostic("review-unavailable", { itemId: item.id, phase: step.instanceKey });
                    review = run ? undetermined() : null;
                }
                if (review) item.phases[step.instanceKey].review = review;
                if (run?.completed && review?.state === "reviewed") {
                    const index = reviewConfig.labels.findIndex((_label, index) => review.statusId === `result-${index + 1}`);
                    const label = index >= 0 && !review.error ? reviewConfig.labels[index] : null;
                    const resultArtifact = Number.isFinite(evidence.mtimeMs) ? artifact : run.result?.artifact ?? null;
                    if (run.result?.sequence !== run.sequence || run.result?.label !== label || run.result?.artifact !== resultArtifact) {
                        results.push({ runId: run.runId, label, artifact: resultArtifact });
                    }
                }
            }
        }
        if (adapter.clarificationTag) inst.clarificationCounts.set(item.id, clarificationCounts);
        const summary = currentPhaseSummary(commands.workflow, phaseEvidence, itemRuns, phaseResults, {
            showProgress: experience.categories["canvas-results"].progress.enabled,
        });
        for (const step of commands.workflow) {
            const phase = item.phases[step.instanceKey];
            const current = summary.phases[step.instanceKey];
            phase.status = current.status;
            if (current.result) phase.result = current.result;
            else delete phase.result;
        }
        item.results = summary.results;
        item.progress = summary.progress ?? null;
        item.unresolvedClarifications = summary.clarificationCount;
        if (reviewConfig && !item.isNew) {
            try {
                if (results.length) itemRuns = phaseRuns.forItem(await phaseRuns.rememberResults(inst, item.id, results), item);
                item.resultTags = milestoneTags(commands.workflow, phaseEvidence, itemRuns, reviewConfig.labels);
            } catch {
                statusDiagnostic("milestone-reporting-unavailable", { itemId: item.id });
                item.resultTags = [];
            }
        }
    }
    const binding = inst.runBinding?.state === "error" ? inst.runBinding
        : pipeline.runtime?.multiInstance === true ? null
            : (inst.runBinding ?? { state: pipeline.runtime?.itemRoot ? "unbound" : "bound", slug: null });
    const phaseInputs = Object.fromEntries(pipeline.pipeline.steps.map((phase) => [phase.instanceKey, adapter.phaseInput(phase)]));
    const constitution = commands.constitution ? await inspectConstitution(inst.cwd, pipeline) : null;
    return {
        clarificationScope: createHash("sha256").update(JSON.stringify([inst.cwd, inst.identity])).digest("hex"),
        pipeline, phaseInputs, items, selectedItemId: items[0]?.id ?? null, instance: binding, setup,
        clarificationTag: adapter.clarificationTag,
        artifactReview: reviewConfig ? {
            labels: reviewConfig.labels,
        } : null,
        ...(constitution ? { projectArtifacts: { constitution } } : {}),
    };
}

async function runPhase(inst, input) {
    if (Object.keys(input ?? {}).some((key) => !["phase", "itemId", "args", "slug"].includes(key))) {
        throw new Error("Invalid run input");
    }
    const step = pipeline.pipeline.steps.find((entry) => entry.instanceKey === input?.phase);
    if (!step) throw new Error("invalid phase");
    const isConstitution = step === commands.constitution;
    if (isConstitution && (input?.itemId != null || input?.slug != null)) {
        throw new Error("Constitution is project-scoped; omit itemId and slug.");
    }
    const validation = validateWorkflowSlug(input?.slug);
    if (validation.error) {
        return { ok: false, queued: false, code: "invalid_workflow_slug", error: validation.error };
    }
    let requestedSlug = pipeline.runtime?.userProvidesSlug === true ? validation.slug : "";
    const blocked = await executionGate(inst);
    if (blocked) return blocked;
    const setup = await executionSetupStatus(inst);
    if (!setup.ready) {
        if (setup.diskReady) return { ok: false, queued: false, code: "skills_reload_failed", error: setup.message };
        const key = `${input?.itemId ?? ""}:${step.instanceKey}`;
        inst.pendingRuns.set(key, {
            phase: step.instanceKey,
            ...(!isConstitution ? { itemId: input?.itemId ?? null } : {}),
            args: String(input?.args ?? ""),
            ...(!isConstitution && pipeline.runtime?.userProvidesSlug === true ? { slug: requestedSlug } : {}),
        });
        if (setup.state === "failed") {
            void setupWorkflow(inst);
        } else if (setup.state === "required") {
            void setupWorkflow(inst, "", {
                automatic: true,
                readinessFingerprint: setup.diskFingerprint,
            });
        }
        return { ok: true, queued: true, phase: step.instanceKey };
    }
    const prerequisite = commands.constitution ? await constitutionGate(inst.cwd, pipeline, step) : null;
    if (prerequisite) {
        inst.broadcast?.();
        return prerequisite;
    }
    if (isConstitution) {
        const args = adapter.buildPhaseArguments({ phase: step, userInput: String(input?.args ?? "") }).trim();
        const result = phaseResults.get(step.instanceKey);
        const reporting = result?.source.kind === "phase-report"
            ? { instanceId: inst.instanceId, instanceToken: inst.reportingToken,
                allowed: result.values.map((value) => value.id) } : null;
        const runId = randomUUID();
        let undo;
        let dispatched = false;
        try {
            if (reporting) undo = await phaseRuns.mark(
                inst, { id: "project", isNew: false, slug: null }, step.instanceKey, {
                    run: { runId, messageId: "", sessionId: session.sessionId ?? "" }, reporting,
                },
            );
            if (reporting) agentBusy = true;
            const messageId = await session.send({ prompt: `${step.invocation}${args ? ` ${args}` : ""}`
                + (reporting ? reportInstructions(inst.instanceId, runId, result) : "") });
            dispatched = true;
            if (reporting) {
                await phaseRuns.bindDispatch(inst, runId, messageId ?? "", session.sessionId ?? "");
                responseRevision++;
            }
        } catch (error) {
            if (dispatched) {
                const message = "The command was sent, but its reporting run could not be bound. Check .speckit-canvas/phase-runs before rerunning.";
                await session.log(message, { level: "error" });
                return { ok: false, dispatched: true, error: message };
            }
            if (undo) await phaseRuns.abortDispatch(inst, runId, undo);
            throw error;
        }
        inst.broadcast?.();
        return { ok: true, phase: step.instanceKey, invocation: step.invocation };
    }
    const items = await listItems(inst);
    const runs = await phaseRuns.read(inst);
    const staleSingleNew = pipeline.runtime?.multiInstance !== true && input?.itemId === "__new__"
        && Boolean(runs.binding);
    if (input?.itemId != null && !items.some((entry) => entry.id === input.itemId) && !staleSingleNew) throw new Error("unknown workflow item");
    let item = items.find((entry) => entry.id === input?.itemId) ?? items[0] ?? null;
    if (inst.runBinding?.state === "error") throw new Error(inst.runBinding.error);
    let reservedNow = false;
    let reservationKey = null;
    if (pipeline.runtime?.itemRoot && item?.isNew && pipeline.runtime?.userProvidesSlug === true) {
        const discovered = await discoveredItems(inst);
        if (
            inst.pendingWorkflowSlug
            && discovered.some((entry) => entry.slug === inst.pendingWorkflowSlug)
            && requestedSlug !== inst.pendingWorkflowSlug
        ) {
            inst.pendingWorkflowSlug = null;
        }
        if (inst.pendingWorkflowSlug) {
            if (requestedSlug && requestedSlug !== inst.pendingWorkflowSlug) {
                throw new Error(`this workflow slug is already set to ${inst.pendingWorkflowSlug}`);
            }
            requestedSlug = inst.pendingWorkflowSlug;
        } else if (requestedSlug) {
            if (discovered.some((entry) => entry.slug === requestedSlug)) {
                throw new Error(`workflow slug ${requestedSlug} already exists in this workspace`);
            }
            reservationKey = slugReservationKey(inst, requestedSlug);
            const owner = workflowSlugReservations.get(reservationKey);
            if (owner && owner !== inst.instanceId) {
                throw new Error(`workflow slug ${requestedSlug} is already in use in this workspace`);
            }
            workflowSlugReservations.set(reservationKey, inst.instanceId);
            inst.pendingWorkflowSlug = requestedSlug;
            reservedNow = !owner;
        }
    } else if (requestedSlug && item?.slug && requestedSlug !== item.slug) {
        throw new Error("a workflow slug cannot be changed after it is set");
    }
    if (pipeline.runtime?.multiInstance !== true && pipeline.runtime?.itemRoot) {
        if (runs.binding) {
            if (requestedSlug && requestedSlug !== runs.binding) throw new Error("this workflow is already bound to another slug");
            if (pipeline.runtime?.userProvidesSlug === true) requestedSlug = runs.binding;
            item = { ...item, id: runs.binding, slug: runs.binding, isNew: false };
        } else if (requestedSlug) {
            item = { id: requestedSlug, slug: requestedSlug, label: requestedSlug, isNew: false };
        }
    }
    if (
        pipeline.runtime?.multiInstance === true
        && pipeline.runtime?.userProvidesSlug === true
        && !item?.isNew
        && item?.slug
    ) {
        requestedSlug = item.slug;
    }
    const args = adapter.buildPhaseArguments({ phase: step, userInput: String(input?.args ?? "") });
    const promptArgs = [
        requestedSlug ? `slug=${requestedSlug}` : (item?.slug ?? ""),
        args.trim(),
    ].filter(Boolean).join(" ");
    const baseline = item?.isNew
        ? Object.fromEntries((await discoveredItems(inst)).map((entry) => [entry.slug, entry.lastActivity])) : {};
    const runId = randomUUID();
    const configuredResult = phaseResults.get(step.instanceKey);
    const reporting = configuredResult?.source.kind === "phase-report"
        ? { instanceId: inst.instanceId, instanceToken: inst.reportingToken,
            allowed: configuredResult.values.map((value) => value.id) } : null;
    let messageId;
    let dispatched = false;
    let undo;
    try {
        if (reporting) undo = await phaseRuns.mark(inst, item, step.instanceKey, {
            slug: requestedSlug || null, baseline,
            run: { runId, messageId: "", sessionId: session.sessionId ?? "" }, reporting,
        });
        if (trackPhaseRuns) agentBusy = true;
        messageId = await session.send({ prompt: `${step.invocation}${promptArgs ? ` ${promptArgs}` : ""}`
            + (reporting ? reportInstructions(inst.instanceId, runId, configuredResult) : "") });
        dispatched = true;
        if (reporting) {
            await phaseRuns.bindDispatch(inst, runId, messageId ?? "", session.sessionId ?? "");
            responseRevision++;
        }
    } catch (error) {
        if (dispatched) {
            const message = "The command was sent, but its reporting run could not be bound. Check .speckit-canvas/phase-runs before rerunning.";
            await session.log(message, { level: "error" });
            return { ok: false, dispatched: true, error: message };
        }
        if (undo) await phaseRuns.abortDispatch(inst, runId, undo);
        if (reservedNow && reservationKey) workflowSlugReservations.delete(reservationKey);
        if (reservedNow) inst.pendingWorkflowSlug = null;
        throw error;
    }
    try {
        if (!reporting) await phaseRuns.mark(inst, item, step.instanceKey, { slug: requestedSlug || null, baseline,
            run: trackPhaseRuns ? { runId, messageId: messageId ?? "", sessionId: session.sessionId ?? "" } : null });
    } catch {
        const error = "The command was sent, but its run state could not be saved. Check .speckit-canvas/phase-runs before rerunning.";
        await session.log(error, { level: "error" });
        return { ok: false, dispatched: true, error };
    }
    inst.broadcast();
    return { ok: true, phase: step.instanceKey, invocation: step.invocation, hasRun: true,
        itemId: item.isNew ? requestedSlug || item.id : item.id };
}

async function deleteWorkflow(inst, input) {
    if (pipeline.runtime?.multiInstance !== true || !pipeline.runtime?.itemRoot) {
        throw new Error("workflow deletion is available only in multi-workflow canvases");
    }
    const { slug, error } = validateWorkflowSlug(input?.slug);
    if (!slug || error) throw new Error("invalid workflow slug");
    const item = (await discoveredItems(inst)).find((entry) => entry.slug === slug);
    if (!item && !(await phaseRuns.read(inst)).pending.some((entry) => entry.slug === slug)) throw new Error("workflow does not exist");
    if (item) {
        const relativeDirectory = pipeline.runtime.itemRoot.replaceAll("<slug>", slug);
        await deleteWorkspaceDirectory(inst.cwd, relativeDirectory, pipeline);
    }
    await phaseRuns.forget(inst, slug);
    inst.clarificationCounts.delete(slug);
    if (inst.pendingWorkflowSlug === slug) inst.pendingWorkflowSlug = null;
    workflowSlugReservations.delete(slugReservationKey(inst, slug));
    inst.broadcast();
    return { ok: true, slug };
}

async function drainPendingRuns(inst) {
    if (await executionGate(inst)) return;
    const pending = [...inst.pendingRuns.values()];
    inst.pendingRuns.clear();
    for (const input of pending) await runPhase(inst, input);
}

async function setupWorkflow(inst, guidance = "", { automatic = false, readinessFingerprint = null } = {}) {
    const blocked = await executionGate(inst);
    if (blocked) return blocked;
    const status = await setupStatus(inst, { refresh: true });
    if (status.diskReady) {
        return status.ready ? { ok: true, skipped: true, reason: "setup already matches" } : reloadSessionSkills(inst);
    }
    const approval = await installationApproval(inst);
    if (!approval.approved) return executionGate(inst);
    const approvalEnabled = requiresInstallationApproval(runtimeSetup);
    const approvedKey = executionKey(inst);
    const shared = approvedSetupDispatches.get(approvedKey);
    if (approvalEnabled && shared && ["dispatching", "verifying"].includes(shared.state)) {
        inst.setupDispatch = shared;
        return { ok: true, skipped: true, reason: "approved setup already dispatched" };
    }
    const contractFingerprint = setupContractFingerprint(runtimeSetup);
    const dispatchKey = `${inst.cwd}:${inst.identity}:${contractFingerprint}:${readinessFingerprint ?? "manual"}`;
    const previous = automaticSetupDispatches.get(dispatchKey);
    if (automatic && previous && instances.has(previous.ownerInstanceId)) {
        inst.setupDispatch = previous.status;
        return { ok: true, skipped: true, reason: "automatic setup already dispatched" };
    }
    inst.autoSetupFingerprint = contractFingerprint;
    inst.setupDispatch = { state: "dispatching", error: null, at: new Date().toISOString() };
    inst.setupSnapshot = null;
    if (approvalEnabled) approvedSetupDispatches.set(approvedKey, inst.setupDispatch);
    if (automatic) {
        automaticSetupDispatches.set(dispatchKey, {
            ownerInstanceId: inst.instanceId,
            status: inst.setupDispatch,
        });
    }
    inst.broadcast?.();
    try {
        const prompt = buildSetupPrompt({
            setup: runtimeSetup,
            instanceId: inst.instanceId,
            guidance,
            installationApproved: approval.installationApproved === true,
            initializationApproved: inst.initializationApproved === true,
        });
        await session.send({ prompt });
        if (inst.setupDispatch?.state === "dispatching") {
            Object.assign(inst.setupDispatch, { state: "verifying", error: null, at: new Date().toISOString() });
            if (automatic) {
                automaticSetupDispatches.set(dispatchKey, {
                    ownerInstanceId: inst.instanceId,
                    status: inst.setupDispatch,
                });
            }
        }
        inst.broadcast?.();
        return { ok: true };
    } catch (error) {
        Object.assign(inst.setupDispatch, {
            state: "failed",
            error: `Setup could not be started: ${error.message}`,
            at: new Date().toISOString(),
        });
        for (const candidate of instances.values()) {
            if (sameExecutionScope(candidate, inst)) {
                candidate.setupDispatch = inst.setupDispatch;
                candidate.broadcast?.();
            }
        }
        if (automatic) {
            automaticSetupDispatches.set(dispatchKey, {
                ownerInstanceId: inst.instanceId,
                status: inst.setupDispatch,
            });
        }
        inst.broadcast?.();
        return { ok: false, error: inst.setupDispatch.error };
    }
}

async function reloadSessionSkills(inst) {
    const key = executionKey(inst);
    if (skillsReloads.has(key)) return skillsReloads.get(key);
    const pending = (async () => {
        const blocked = await executionGate(inst);
        return blocked ?? performSkillsReload(inst);
    })();
    skillsReloads.set(key, pending);
    try { return await pending; }
    finally {
        skillsReloads.delete(key);
        approvedSetupDispatches.delete(key);
    }
}

async function performSkillsReload(inst) {
    const at = new Date().toISOString();
    if (!session?.rpc?.skills?.reload) {
        const result = {
            ok: false,
            errors: 1,
            warnings: 0,
            at,
            unavailable: true,
            error: "session.rpc.skills.reload not available in this SDK version",
        };
        for (const candidate of instances.values()) {
            if (sameExecutionScope(candidate, inst)) {
                candidate.skillsReload = result;
                candidate.setupSnapshot = null;
                candidate.setupDispatch = { state: "failed", error: result.error, at };
                candidate.broadcast?.();
            }
        }
        workspaceSetupReadiness.delete(executionKey(inst));
        return result;
    }
    try {
        const disk = await inspectFoundation(inst, { refresh: true });
        const blocked = await executionGate(inst, true, disk);
        if (blocked) return blocked;
        const diagnostics = await session.rpc.skills.reload();
        const verified = await inspectFoundation(inst);
        const errors = Array.isArray(diagnostics?.errors) ? diagnostics.errors.length : 0;
        const warnings = Array.isArray(diagnostics?.warnings) ? diagnostics.warnings.length : 0;
        const stable = disk.diskFingerprint === verified.diskFingerprint;
        const ok = disk.diskReady && verified.diskReady && stable && errors === 0;
        const result = {
            ok,
            errors: errors + (verified.diskReady && stable ? 0 : 1),
            warnings,
            at,
            fingerprint: verified.diskFingerprint,
            ...(!verified.diskReady ? { error: verified.checks.filter((check) => !check.ready).map((check) => check.message).join(" ") }
                : !stable ? { error: "Setup changed while skills were reloading. Retry the skill reload." } : {}),
        };
        const matchingInstances = [];
        for (const candidate of instances.values()) {
            if (sameExecutionScope(candidate, inst) && !await executionGate(candidate, false, verified)) matchingInstances.push(candidate);
        }
        for (const candidate of matchingInstances) {
            candidate.skillsReload = result;
            candidate.setupSnapshot = null;
        }
        if (ok) {
            for (const candidate of matchingInstances) {
                candidate.setupDispatch = { state: "ready", error: null, at };
                await setupStatus(candidate, { refresh: true, disk: verified });
                candidate.broadcast?.();
                if (candidate.pendingRuns.size) void drainPendingRuns(candidate);
            }
            const prefix = `${inst.cwd}:${inst.identity}:${setupContractFingerprint(runtimeSetup)}:`;
            for (const key of automaticSetupDispatches.keys()) {
                if (key.startsWith(prefix)) automaticSetupDispatches.delete(key);
            }
            workspaceSetupReadiness.set(executionKey(inst), {
                diskFingerprint: verified.diskFingerprint,
                skillsReload: result,
            });
        } else {
            workspaceSetupReadiness.delete(executionKey(inst));
            for (const candidate of matchingInstances) {
                candidate.setupDispatch = { state: "failed", error: result.error ?? "skill reload reported errors", at };
                candidate.broadcast?.();
            }
        }
        return result;
    } catch {
        const result = {
            ok: false,
            errors: 1,
            warnings: 0,
            at,
            error: "Session skills could not be reloaded. Retry the skill reload.",
        };
        for (const candidate of instances.values()) {
            if (sameExecutionScope(candidate, inst)) {
                candidate.skillsReload = result;
                candidate.setupSnapshot = null;
                candidate.setupDispatch = { state: "failed", error: result.error, at };
                candidate.broadcast?.();
            }
        }
        workspaceSetupReadiness.delete(executionKey(inst));
        return result;
    }
}

async function beginSetup(inst, waitForDispatch = false) {
    const disk = await inspectFoundation(inst);
    if (await executionGate(inst, false, disk)) return;
    inst.awaitingInstallation = false;
    const cached = workspaceSetupReadiness.get(executionKey(inst));
    if (cached?.diskFingerprint === disk.diskFingerprint && cached.skillsReload?.ok === true) {
        inst.skillsReload = cached.skillsReload;
        inst.setupDispatch = { state: "ready", error: null, at: cached.skillsReload.at };
        await setupStatus(inst, { refresh: true, disk });
        if (inst.pendingRuns.size) void drainPendingRuns(inst);
    } else if (disk.diskReady) {
        const pending = reloadSessionSkills(inst);
        if (waitForDispatch) await pending;
    } else {
        const pending = setupWorkflow(inst, "", { automatic: true, readinessFingerprint: disk.diskFingerprint });
        if (waitForDispatch) await pending;
    }
}

async function approvalRequest(inst, input) {
    if (installationMode !== "prompt" || !requiresInstallationApproval(runtimeSetup)) {
        throw new Error("Installation review is unavailable for this policy");
    }
    if (!["accept", "defer", "review"].includes(input?.action)
        || Object.keys(input).some((key) => !["action", "fingerprint", "challenge"].includes(key))) {
        throw new Error("Invalid installation review request");
    }
    if (input.fingerprint !== setupContractFingerprint(runtimeSetup)
        || !tokenMatches(input.challenge, inst.approvalChallenge)) {
        throw new Error("Installation review is stale; refresh and review installation again");
    }
    if (input.action === "accept") {
        const observed = await inspectFoundation(inst, { refresh: true });
        if (missingInstallSources(runtimeSetup, observed.contributions).length
            || observed.contributions.some((entry) => entry.installationState === "unverified"
                || (entry.installed && !entry.identityReady))) {
            throw new Error("Required package source or provenance changed; refresh installation review");
        }
        await acceptInstallationApproval(approvalContext(inst), input.fingerprint);
        for (const candidate of instances.values()) {
            if (sameExecutionScope(candidate, inst)) {
                candidate.approvalDeferred = false;
                candidate.broadcast?.();
            }
        }
        await beginSetup(inst, true);
    } else {
        inst.approvalDeferred = input.action === "defer";
        inst.broadcast?.();
    }
    return { ok: true, setup: await setupStatus(inst, { refresh: true }) };
}

async function initializationRequest(inst, input) {
    if (!["accept", "defer"].includes(input?.action)
        || Object.keys(input).some((key) => !["action", "challenge"].includes(key))
        || !tokenMatches(input.challenge, inst.initializationChallenge)) {
        throw new Error("Invalid or stale destination initialization confirmation");
    }
    const disk = await inspectFoundation(inst, { refresh: true });
    const init = disk.checks.find((entry) => entry.id === "spec-kit-init");
    if (init?.ready) throw new Error("Destination initialization changed; refresh setup status");
    inst.initializationChallenge = randomBytes(24).toString("hex");
    inst.initializationApproved = input.action === "accept";
    inst.initializationDeferred = input.action === "defer";
    inst.initializationEvidence = init?.stamp ?? null;
    inst.setupSnapshot = null;
    inst.broadcast?.();
    if (inst.initializationApproved) await beginSetup(inst, true);
    return { ok: true, setup: await setupStatus(inst, { refresh: true }) };
}

async function startHttp(inst) {
    inst.token = randomBytes(24).toString("hex");
    inst.clients = new Set();
    inst.broadcast = () => {
        for (const client of inst.clients) {
            try { client.write(`data: ${JSON.stringify({ type: "refresh" })}\n\n`); } catch {}
        }
    };
    const ui = join(here, "ui");
    inst.server = createServer(async (req, res) => {
        try {
            const url = new URL(req.url, "http://127.0.0.1");
            const host = req.headers.host ?? "";
            if (!/^127\.0\.0\.1:\d+$/.test(host)) return send(res, 403, { error: "invalid host" });
            const origin = req.headers.origin;
            if (origin && origin !== `http://${host}`) return send(res, 403, { error: "invalid origin" });
            const token = url.searchParams.get("token") || String(req.headers.cookie ?? "").match(/(?:^|;\s*)canvas_token=([^;]+)/)?.[1];
            if (!tokenMatches(token, inst.token)) return send(res, 401, { error: "unauthorized" });
            if (req.method === "GET" && url.pathname === "/") {
                res.setHeader("Set-Cookie", `canvas_token=${inst.token}; Path=/; HttpOnly; SameSite=Strict`);
                return send(res, 200, await readFile(join(ui, "index.html")), "text/html; charset=utf-8");
            }
            if (req.method === "GET" && url.pathname.startsWith("/ui/")) {
                const file = resolve(ui, url.pathname.slice(4));
                if (!inside(ui, file)) return send(res, 403, { error: "forbidden" });
                return send(res, 200, await readFile(file), TYPES[extname(file)] ?? "application/octet-stream");
            }
            if (req.method === "GET" && url.pathname === "/theme/logo") {
                const logo = experience.categories["canvas-theme"].brand.logo;
                if (logo.mode !== "asset") return send(res, 404, { error: "logo unavailable" });
                const root = join(here, "theme");
                const file = resolve(root, logo.path);
                if (!inside(root, file) || !inside(root, await realpath(file))
                    || !(await lstat(file)).isFile() || (await lstat(file)).isSymbolicLink()) {
                    return send(res, 403, { error: "unsafe logo file" });
                }
                res.setHeader("X-Content-Type-Options", "nosniff");
                return send(res, 200, await readFile(file), TYPES[extname(file)]);
            }
            if (req.method === "GET" && url.pathname === "/api/state") return send(res, 200, await snapshot(inst));
            if (req.method === "GET" && url.pathname === "/api/events") {
                res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
                res.write("data: {\"type\":\"connected\"}\n\n");
                inst.clients.add(res);
                req.on("close", () => inst.clients.delete(res));
                return;
            }
            if (req.method === "POST" && url.pathname === "/api/run") {
                const result = await runPhase(inst, await body(req));
                return send(res, result.code === "invalid_workflow_slug" ? 400 : 202, result);
            }
            if (req.method === "POST" && url.pathname === "/api/artifact/amend") {
                const result = await amendArtifact(inst, await body(req));
                return send(res, 200, result);
            }
            if (req.method === "POST" && url.pathname === "/api/installation-approval") {
                return send(res, 200, await approvalRequest(inst, await body(req)));
            }
            if (req.method === "POST" && url.pathname === "/api/init-confirmation") {
                return send(res, 200, await initializationRequest(inst, await body(req)));
            }
            if (req.method === "POST" && url.pathname === "/api/setup") {
                const input = await body(req);
                if (Object.keys(input).some((key) => key !== "guidance")) throw new Error("Invalid setup input");
                return send(res, 202, await setupWorkflow(inst, String(input?.guidance ?? "")));
            }
            if (req.method === "POST" && url.pathname === "/api/reveal") {
                const input = await body(req);
                const path = typeof input?.path === "string" ? input.path : "";
                const revealed = await revealWorkspaceDirectory(inst.cwd, path, { pipeline });
                return send(res, 200, { ok: true, path: revealed });
            }
            if (req.method === "POST" && url.pathname === "/api/workflow/delete") {
                return send(res, 200, await deleteWorkflow(inst, await body(req)));
            }
            if (req.method === "GET" && url.pathname === "/api/artifact") {
                const rel = url.searchParams.get("path");
                if (!rel || isAbsolute(rel)) return send(res, 400, { error: "invalid artifact path" });
                return send(res, 200, { path: rel, content: await readWorkflowArtifact(inst.cwd, rel, pipeline) });
            }
            return send(res, 404, { error: "not found" });
        } catch (error) {
            // Never serialize caught exceptions: filesystem and SDK errors can contain private details.
            if (error?.code === "PHASE_RUN_STATE") {
                return send(res, 400, { error: "Cannot read phase run state. Check .speckit-canvas/phase-runs and reopen the canvas." });
            }
            if (error?.code === "ARTIFACT_UNAVAILABLE") {
                return send(res, 413, { error: "Artifact is unavailable or exceeds the 512 KiB limit." });
            }
            return send(res, 400, { error: "invalid request or unavailable workflow resource" });
        }
    });
    await new Promise((resolveListen, reject) => {
        inst.server.once("error", reject);
        inst.server.listen(0, "127.0.0.1", resolveListen);
    });
    const port = inst.server.address().port;
    inst.url = `http://127.0.0.1:${port}/?token=${inst.token}`;
    let previous = "";
    inst.poller = setInterval(async () => {
        if (inst.polling) return;
        inst.polling = true;
        try {
            const state = await snapshot(inst, true);
            if ((inst.awaitingInstallation && !state.setup.approval?.required)
                || (state.setup.diskReady && !state.setup.reload)) {
                await beginSetup(inst);
            }
            const current = JSON.stringify(state);
            if (previous && current !== previous) inst.broadcast();
            previous = current;
        } catch {
            inst.setupDispatch = { state: "failed", error: "Canvas state could not be refreshed. Check the workspace and retry.", at: new Date().toISOString() };
            inst.broadcast?.();
        } finally { inst.polling = false; }
    }, 1000);
    inst.poller.unref?.();
}

const actions = [
    ...(reviewConfig ? [{
        name: "report_artifact_review",
        description: "Report a fixed status ID for a pending read-only phase-result review.",
        inputSchema: {
            type: "object", required: ["requestId", "statusId"], additionalProperties: false,
            properties: { requestId: { type: "string" },
                statusId: { type: "string", enum: [...reviewConfig.labels.map((_label, index) => `result-${index + 1}`), "not-determined"] } },
        },
        handler: async (ctx) => {
            const inst = instanceFor(ctx.instanceId);
            const result = await artifactReviewer.report(inst, ctx.input);
            for (const other of instances.values()) if (sameExecutionScope(other, inst)) other.broadcast?.();
            return result;
        },
    }] : []),
    ...(hasPhaseReports ? [{
        name: "report_phase_result",
        description: "Report an allowed result from the original configured phase turn.",
        inputSchema: {
            type: "object", required: ["phaseRunId", "resultId"], additionalProperties: false,
            properties: { phaseRunId: { type: "string" }, resultId: { type: "string" } },
        },
        handler: async (ctx) => {
            const inst = instanceFor(ctx.instanceId);
            const result = await phaseRuns.report(inst, ctx.input.phaseRunId, ctx.input.resultId);
            inst.broadcast?.();
            return result;
        },
    }] : []),
    {
        name: "list_items",
        description: "List workflow items and their available artifacts.",
        inputSchema: { type: "object", additionalProperties: false },
        handler: async (ctx) => {
            const state = await snapshot(instanceFor(ctx.instanceId));
            return { ok: true, items: state.items, setup: state.setup, ...(state.projectArtifacts ? { projectArtifacts: state.projectArtifacts } : {}) };
        },
    },
    {
        name: "setup_workflow",
        description: "Ask Copilot to set up the skills and extensions required by this workflow.",
        inputSchema: { type: "object", properties: { guidance: { type: "string" } }, additionalProperties: false },
        handler: async (ctx) => {
            return setupWorkflow(instanceFor(ctx.instanceId), ctx.input?.guidance ?? "");
        },
    },
    {
        name: "reloadSessionSkills",
        description: "Reload Copilot's in-memory skill registry for this generated workflow.",
        inputSchema: { type: "object", additionalProperties: false },
        handler: async (ctx) => reloadSessionSkills(instanceFor(ctx.instanceId)),
    },
    {
        name: "run_phase",
        description: "Run one blueprint-declared workflow phase.",
        inputSchema: {
            type: "object",
            required: ["phase"],
            properties: {
                phase: { type: "string", enum: pipeline.pipeline.steps.map((step) => step.instanceKey) },
                itemId: { type: ["string", "null"] },
                args: { type: "string" },
                slug: { type: "string" },
            },
            additionalProperties: false,
        },
        handler: async (ctx) => runPhase(instanceFor(ctx.instanceId), ctx.input),
    },
    {
        name: "delete_workflow",
        description: "Permanently delete one workflow directory and its artifacts.",
        inputSchema: {
            type: "object",
            required: ["slug"],
            properties: { slug: { type: "string" } },
            additionalProperties: false,
        },
        handler: async (ctx) => deleteWorkflow(instanceFor(ctx.instanceId), ctx.input),
    },
];

async function open(ctx) {
    if (!ctx.input?.cwd || !isAbsolute(ctx.input.cwd)) throw new Error("open requires an absolute workspace cwd");
    const cwd = resolve(ctx.input.cwd);
    const existing = instances.get(ctx.instanceId);
    if (existing) {
        if (existing.cwd !== cwd) throw new Error("canvas instance is already open for another workspace");
        if (existing.identity !== `${ctx.extensionId ?? __EXTENSION_ID_JSON__}:${ctx.canvasId ?? __EXTENSION_ID_JSON__}`) {
            throw new Error("canvas instance is already open for another canvas");
        }
        return { title: __DISPLAY_NAME_JSON__, url: existing.url };
    }
    const inst = {
        instanceId: ctx.instanceId,
        reportingToken: randomUUID(),
        identity: `${ctx.extensionId ?? __EXTENSION_ID_JSON__}:${ctx.canvasId ?? __EXTENSION_ID_JSON__}`,
        cwd,
        approvalDeferred: false,
        awaitingInstallation: false,
        approvalChallenge: randomBytes(24).toString("hex"),
        initializationChallenge: randomBytes(24).toString("hex"),
        initializationApproved: false,
        initializationDeferred: false,
        initializationEvidence: null,
        autoSetupFingerprint: null,
        setupDispatch: null,
        setupSnapshot: null,
        skillsReload: null,
        pendingRuns: new Map(),
        clarificationCounts: new Map(),
        pendingWorkflowSlug: null,
    };
    instances.set(ctx.instanceId, inst);
    try {
        await startHttp(inst);
    } catch (error) {
        instances.delete(ctx.instanceId);
        throw error;
    }
    await beginSetup(inst).catch(() => {
        inst.setupDispatch = { state: "failed", error: "Setup could not be initialized. Check the workspace and retry setup.", at: new Date().toISOString() };
        inst.broadcast?.();
    });
    return { title: __DISPLAY_NAME_JSON__, url: inst.url };
}

async function onClose(ctx) {
    const inst = instances.get(ctx.instanceId);
    if (!inst) return;
    for (const client of inst.clients) try { client.end(); } catch {}
    if (inst.poller) clearInterval(inst.poller);
    if (inst.server) await new Promise((resolveClose) => inst.server.close(resolveClose));
    instances.delete(ctx.instanceId);
    const replacement = [...instances.values()].find((candidate) => sameExecutionScope(candidate, inst));
    if (reviewConfig) {
        if (replacement) instanceAliases.set(ctx.instanceId, replacement.instanceId);
        else artifactReviewer.close(inst);
    }
    for (const [key, entry] of automaticSetupDispatches.entries()) {
        if (entry.ownerInstanceId !== ctx.instanceId) continue;
        if (replacement) {
            entry.ownerInstanceId = replacement.instanceId;
            replacement.setupDispatch = entry.status;
            instanceAliases.set(ctx.instanceId, replacement.instanceId);
        } else {
            automaticSetupDispatches.delete(key);
        }
    }
    if (!replacement) {
        approvedSetupDispatches.delete(executionKey(inst));
        for (const [alias, target] of instanceAliases.entries()) {
            if (alias === ctx.instanceId || target === ctx.instanceId) instanceAliases.delete(alias);
        }
    }
}

session = await joinSession({
    canvases: [createCanvas({
        id: __EXTENSION_ID_JSON__,
        displayName: __DISPLAY_NAME_JSON__,
        description: __DESCRIPTION_JSON__,
        inputSchema: { type: "object", required: ["cwd"], properties: { cwd: { type: "string" } }, additionalProperties: false },
        actions,
        open,
        onClose,
    })],
});
if (trackPhaseRuns) {
    session.on("user.message", () => { agentBusy = true; responseRevision++; });
    session.on("tool.execution_start", () => { agentBusy = true; responseRevision++; });
    session.on("session.idle", () => { agentBusy = false; responseRevision++; });
}
await session.log(`${__EXTENSION_ID_JSON__} canvas ready`, { level: "info", ephemeral: true });
