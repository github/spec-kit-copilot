// speckit-generated-workflow-template v1
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { readFile, readdir, lstat } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { joinSession, createCanvas } from "@github/copilot-sdk/extension";
import { createWorkflowAdapter } from "./workflow-adapter.mjs";
import { commandViews } from "./ui/command-views.mjs";
import { constitutionGate, inspectConstitution } from "./project-artifacts.mjs";
import {
    deleteWorkspaceDirectory,
    revealWorkspaceDirectory,
    resolveWorkspaceDirectory,
    resolveWorkflowPath,
    validateWorkflowPaths,
    resolveDeclaredArtifact,
    readWorkflowArtifact,
} from "./workspace-files.mjs";
import {
    buildSetupPrompt,
    inspectSetup,
    setupContractFingerprint,
} from "./setup-runtime.mjs";
import {
    acceptInstallationApproval,
    approvalComponents,
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
const instances = new Map();
const instanceAliases = new Map();
const automaticSetupDispatches = new Map();
const workspaceSetupReadiness = new Map();
const singleInstanceBindings = new Map();
const workflowSlugReservations = new Map();
const approvedSetupDispatches = new Map();
const approvedReloads = new Map();
const BODY_CAP = 256 * 1024;
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".mjs": "application/javascript; charset=utf-8" };
let session;

function approvalContext(inst) {
    return { cwd: inst.cwd, extensionId: __EXTENSION_ID_JSON__, identity: inst.identity, setup: pipeline.setup };
}

function executionKey(inst) {
    return `${inst.cwd}:${inst.identity}:${setupContractFingerprint(pipeline.setup)}`;
}

async function installationApproval(inst) {
    try {
        let components;
        if (requiresInstallationApproval(pipeline.setup)) {
            const observed = await inspectSetup({ cwd: inst.cwd, setup: pipeline.setup });
            components = approvalComponents(pipeline.setup).map((entry) => ({
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
            installationApproved: approval.required && approval.approved,
            ...(components ? { components } : {}),
            state: approval.approved ? "approved" : (inst.approvalDeferred ? "deferred" : "pending"),
            ...(approval.required ? { challenge: inst.approvalChallenge } : {}),
        };
    } catch (error) {
        return {
            required: true, approved: false, state: "error", error: error.message,
            components: approvalComponents(pipeline.setup),
        };
    }
}

async function executionGate(inst, reveal = true) {
    const approval = await installationApproval(inst);
    if (approval.approved) return null;
    inst.awaitingInstallation = true;
    inst.pendingRuns.clear();
    inst.skillsReload = null;
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

function requiresContributionReconciliation() {
    return (pipeline.setup?.presets?.length ?? 0) > 0
        || (pipeline.setup?.extensions?.length ?? 0) > 0;
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
        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.name));
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
    if (pipeline.runtime?.multiInstance === true) return [...discovered, newItem()];

    const key = bindingKey(inst);
    const binding = singleInstanceBindings.get(key);
    if (binding?.state === "bound") {
        const item = discovered.find((entry) => entry.slug === binding.slug);
        return [item ?? { id: binding.slug, slug: binding.slug, label: binding.slug }];
    }
    if (binding?.state === "pending") {
        const candidates = discovered.filter((entry) => (
            binding.baseline[entry.slug] == null
            || entry.lastActivity > binding.baseline[entry.slug]
        ));
        if (candidates.length === 1) {
            singleInstanceBindings.set(key, { state: "bound", slug: candidates[0].slug });
            return [candidates[0]];
        }
        if (candidates.length > 1) {
            singleInstanceBindings.set(key, {
                state: "error",
                error: "Spec Kit created multiple workflow directories, so the canvas could not determine which slug to reuse.",
            });
        }
    }
    return [newItem()];
}

async function listItems(inst) {
    return adapter.listItems({ defaults: () => defaultItems(inst) });
}

async function setupStatus(inst) {
    const approval = await installationApproval(inst);
    if (!approval.approved) {
        inst.awaitingInstallation = true;
        return {
            ready: false, state: approval.error ? "failed" : "approval-required",
            message: approval.error ?? "Required installation has not been approved",
            checks: [], reload: null, approval,
        };
    }
    const disk = await inspectSetup({ cwd: inst.cwd, setup: pipeline.setup });
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
    return {
        ready,
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
    };
}

async function snapshot(inst) {
    const items = await listItems(inst);
    for (const item of items) {
        item.phases = {};
        for (const step of commands.workflow) {
            const path = await artifactPath(step, item, inst);
            let exists = false;
            if (path) {
                try {
                    await resolveWorkflowPath(inst.cwd, path, pipeline, "artifact");
                    exists = true;
                } catch (error) {
                    if (error.code !== "ENOENT") throw error;
                }
            }
            item.phases[step.instanceKey] = {
                artifact: exists ? path : null,
            };
        }
    }
    const binding = pipeline.runtime?.multiInstance === true
        ? null
        : (singleInstanceBindings.get(bindingKey(inst)) ?? { state: pipeline.runtime?.itemRoot ? "unbound" : "bound", slug: null });
    const phaseInputs = Object.fromEntries(pipeline.pipeline.steps.map((phase) => [phase.instanceKey, adapter.phaseInput(phase)]));
    const constitution = commands.constitution ? await inspectConstitution(inst.cwd, pipeline) : null;
    return {
        pipeline, phaseInputs, items, selectedItemId: items[0]?.id ?? null, instance: binding, setup: await setupStatus(inst),
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
    const blocked = await executionGate(inst);
    if (blocked) return blocked;
    const setup = await setupStatus(inst);
    if (!setup.ready) {
        const key = `${input?.itemId ?? ""}:${step.instanceKey}`;
        inst.pendingRuns.set(key, {
            phase: step.instanceKey,
            ...(!isConstitution ? { itemId: input?.itemId ?? null } : {}),
            args: String(input?.args ?? ""),
            ...(!isConstitution && pipeline.runtime?.userProvidesSlug === true ? { slug: String(input?.slug ?? "") } : {}),
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
        await session.send({ prompt: `${step.invocation}${args ? ` ${args}` : ""}` });
        inst.broadcast?.();
        return { ok: true, phase: step.instanceKey, invocation: step.invocation };
    }
    const items = await listItems(inst);
    const staleSingleNew = pipeline.runtime?.multiInstance !== true && input?.itemId === "__new__"
        && singleInstanceBindings.get(bindingKey(inst))?.state === "bound";
    if (input?.itemId != null && !items.some((entry) => entry.id === input.itemId) && !staleSingleNew) throw new Error("unknown workflow item");
    let item = items.find((entry) => entry.id === input?.itemId) ?? items[0] ?? null;
    let requestedSlug = pipeline.runtime?.userProvidesSlug === true ? String(input?.slug ?? "").trim() : "";
    if (requestedSlug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(requestedSlug)) {
        throw new Error("slug must contain lowercase letters, numbers, and single hyphens");
    }
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
    let bindAfterSend = null;
    if (pipeline.runtime?.multiInstance !== true && pipeline.runtime?.itemRoot) {
        const key = bindingKey(inst);
        const binding = singleInstanceBindings.get(key);
        if (binding?.state === "error") throw new Error(binding.error);
        if (binding?.state === "bound") {
            if (requestedSlug && requestedSlug !== binding.slug) throw new Error("this workflow is already bound to another slug");
            if (pipeline.runtime?.userProvidesSlug === true) requestedSlug = binding.slug;
            item = { ...item, id: binding.slug, slug: binding.slug, isNew: false };
        } else if (requestedSlug) {
            item = { id: requestedSlug, slug: requestedSlug, label: requestedSlug, isNew: false };
            bindAfterSend = requestedSlug;
        } else if (item?.isNew) {
            const baseline = Object.fromEntries((await discoveredItems(inst)).map((entry) => [entry.slug, entry.lastActivity]));
            singleInstanceBindings.set(key, { state: "pending", baseline });
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
    try {
        await session.send({ prompt: `${step.invocation}${promptArgs ? ` ${promptArgs}` : ""}` });
    } catch (error) {
        if (reservedNow && reservationKey) workflowSlugReservations.delete(reservationKey);
        if (reservedNow) inst.pendingWorkflowSlug = null;
        throw error;
    }
    if (bindAfterSend) singleInstanceBindings.set(bindingKey(inst), { state: "bound", slug: bindAfterSend });
    inst.broadcast();
    return { ok: true, phase: step.instanceKey, invocation: step.invocation };
}

async function deleteWorkflow(inst, input) {
    if (pipeline.runtime?.multiInstance !== true || !pipeline.runtime?.itemRoot) {
        throw new Error("workflow deletion is available only in multi-workflow canvases");
    }
    const slug = String(input?.slug ?? "").trim();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error("invalid workflow slug");
    const item = (await discoveredItems(inst)).find((entry) => entry.slug === slug);
    if (!item) throw new Error("workflow does not exist");
    const relativeDirectory = pipeline.runtime.itemRoot.replaceAll("<slug>", slug);
    await deleteWorkspaceDirectory(inst.cwd, relativeDirectory, pipeline);
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
    const approval = await installationApproval(inst);
    if (!approval.approved) return executionGate(inst);
    const approvalEnabled = requiresInstallationApproval(pipeline.setup);
    const approvedKey = executionKey(inst);
    const shared = approvedSetupDispatches.get(approvedKey);
    if (approvalEnabled && shared && ["dispatching", "verifying"].includes(shared.state)) {
        inst.setupDispatch = shared;
        return { ok: true, skipped: true, reason: "approved setup already dispatched" };
    }
    const contractFingerprint = setupContractFingerprint(pipeline.setup);
    const dispatchKey = `${inst.cwd}:${inst.identity}:${contractFingerprint}:${readinessFingerprint ?? "manual"}`;
    const previous = automaticSetupDispatches.get(dispatchKey);
    if (automatic && previous && instances.has(previous.ownerInstanceId)) {
        inst.setupDispatch = previous.status;
        return { ok: true, skipped: true, reason: "automatic setup already dispatched" };
    }
    inst.autoSetupFingerprint = contractFingerprint;
    inst.setupDispatch = { state: "dispatching", error: null, at: new Date().toISOString() };
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
            setup: pipeline.setup,
            instanceId: inst.instanceId,
            guidance,
            installationApproved: approval.installationApproved === true,
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
            error: error?.message ?? String(error),
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
    const blocked = await executionGate(inst);
    if (blocked) return blocked;
    if (!requiresInstallationApproval(pipeline.setup)) return performSkillsReload(inst);
    const key = executionKey(inst);
    if (approvedReloads.has(key)) return approvedReloads.get(key);
    const pending = performSkillsReload(inst);
    approvedReloads.set(key, pending);
    try { return await pending; }
    finally {
        approvedReloads.delete(key);
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
                candidate.setupDispatch = { state: "failed", error: result.error, at };
                candidate.broadcast?.();
            }
        }
        return result;
    }
    try {
        const disk = await inspectSetup({ cwd: inst.cwd, setup: pipeline.setup, refresh: true });
        const blocked = await executionGate(inst);
        if (blocked) return blocked;
        const diagnostics = await session.rpc.skills.reload();
        const errors = Array.isArray(diagnostics?.errors) ? diagnostics.errors.length : 0;
        const warnings = Array.isArray(diagnostics?.warnings) ? diagnostics.warnings.length : 0;
        const ok = disk.diskReady && errors === 0;
        const result = {
            ok,
            errors: errors + (disk.diskReady ? 0 : 1),
            warnings,
            at,
            fingerprint: disk.diskFingerprint,
            ...(!disk.diskReady ? { error: disk.checks.filter((check) => !check.ready).map((check) => check.message).join(" ") } : {}),
        };
        const matchingInstances = [];
        for (const candidate of instances.values()) {
            if (sameExecutionScope(candidate, inst) && !await executionGate(candidate, false)) matchingInstances.push(candidate);
        }
        for (const candidate of matchingInstances) {
            candidate.skillsReload = result;
        }
        if (ok) {
            for (const candidate of matchingInstances) {
                candidate.setupDispatch = { state: "ready", error: null, at };
                candidate.broadcast?.();
                if (candidate.pendingRuns.size) void drainPendingRuns(candidate);
            }
            const prefix = `${inst.cwd}:${inst.identity}:${setupContractFingerprint(pipeline.setup)}:`;
            for (const key of automaticSetupDispatches.keys()) {
                if (key.startsWith(prefix)) automaticSetupDispatches.delete(key);
            }
            workspaceSetupReadiness.set(executionKey(inst), {
                diskFingerprint: disk.diskFingerprint,
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
    } catch (error) {
        const result = {
            ok: false,
            errors: 1,
            warnings: 0,
            at,
            error: error?.message ?? String(error),
        };
        for (const candidate of instances.values()) {
            if (sameExecutionScope(candidate, inst)) {
                candidate.skillsReload = result;
                candidate.setupDispatch = { state: "failed", error: result.error, at };
                candidate.broadcast?.();
            }
        }
        workspaceSetupReadiness.delete(executionKey(inst));
        return result;
    }
}

async function beginSetup(inst, waitForDispatch = false) {
    if (await executionGate(inst, false)) return;
    inst.awaitingInstallation = false;
    const disk = await inspectSetup({ cwd: inst.cwd, setup: pipeline.setup });
    if (await executionGate(inst, false)) return;
    const cached = workspaceSetupReadiness.get(executionKey(inst));
    if (cached?.diskFingerprint === disk.diskFingerprint && cached.skillsReload?.ok === true) {
        inst.skillsReload = cached.skillsReload;
        inst.setupDispatch = { state: "ready", error: null, at: cached.skillsReload.at };
    } else if (disk.diskReady && (requiresInstallationApproval(pipeline.setup) || !requiresContributionReconciliation())) {
        const pending = reloadSessionSkills(inst);
        if (waitForDispatch) await pending;
    } else {
        const pending = setupWorkflow(inst, "", { automatic: true, readinessFingerprint: disk.diskFingerprint });
        if (waitForDispatch) await pending;
    }
}

async function approvalRequest(inst, input) {
    if (!["accept", "defer", "review"].includes(input?.action)
        || Object.keys(input).some((key) => !["action", "fingerprint", "challenge"].includes(key))) {
        throw new Error("Invalid installation review request");
    }
    if (input.fingerprint !== setupContractFingerprint(pipeline.setup)
        || !tokenMatches(input.challenge, inst.approvalChallenge)) {
        throw new Error("Installation review is stale; refresh and review installation again");
    }
    if (input.action === "accept") {
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
    return { ok: true, setup: await setupStatus(inst) };
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
            if (req.method === "GET" && url.pathname === "/api/state") return send(res, 200, await snapshot(inst));
            if (req.method === "GET" && url.pathname === "/api/events") {
                res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
                res.write("data: {\"type\":\"connected\"}\n\n");
                inst.clients.add(res);
                req.on("close", () => inst.clients.delete(res));
                return;
            }
            if (req.method === "POST" && url.pathname === "/api/run") return send(res, 202, await runPhase(inst, await body(req)));
            if (req.method === "POST" && url.pathname === "/api/installation-approval") {
                return send(res, 200, await approvalRequest(inst, await body(req)));
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
            return send(res, error.code === "ARTIFACT_UNAVAILABLE" ? 413 : 400, { error: error?.message ?? String(error) });
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
        try {
            const state = await snapshot(inst);
            if (inst.awaitingInstallation && !state.setup.approval?.required) {
                await beginSetup(inst);
            }
            const current = JSON.stringify(state);
            if (previous && current !== previous) inst.broadcast();
            previous = current;
        } catch (error) {
            inst.setupDispatch = { state: "failed", error: error.message, at: new Date().toISOString() };
            inst.broadcast?.();
        }
    }, 1000);
    inst.poller.unref?.();
}

const actions = [
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
        identity: `${ctx.extensionId ?? __EXTENSION_ID_JSON__}:${ctx.canvasId ?? __EXTENSION_ID_JSON__}`,
        cwd,
        approvalDeferred: false,
        awaitingInstallation: false,
        approvalChallenge: randomBytes(24).toString("hex"),
        autoSetupFingerprint: null,
        setupDispatch: null,
        skillsReload: null,
        pendingRuns: new Map(),
        pendingWorkflowSlug: null,
    };
    instances.set(ctx.instanceId, inst);
    await startHttp(inst);
    await beginSetup(inst).catch((error) => {
        inst.setupDispatch = { state: "failed", error: error.message, at: new Date().toISOString() };
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
await session.log(`${__EXTENSION_ID_JSON__} canvas ready`, { level: "info", ephemeral: true });
