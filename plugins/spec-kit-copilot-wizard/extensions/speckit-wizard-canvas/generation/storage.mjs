// Persist generation requests and protected standalone template snapshots.
import {
    mkdir,
    lstat,
    readFile,
    readdir,
    realpath,
    rename,
    stat,
    writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateWorkflowConfig } from "./generated-canvas-template/workflow-adapter.mjs";
import { validateWorkflowPaths } from "./generated-canvas-template/workspace-files.mjs";
import { verifyMaterializedFiles } from "./materialize-template.mjs";

export const GENERATED_CANVASES_DIR = ".speckit-wizard/generated-canvases";
const REQUEST_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const realFs = { mkdir, lstat, readFile, readdir, realpath, rename, stat, writeFile };
const here = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_VERSION = 17;
const TEMPLATE_FILES = [
    ["generated-canvas-template/extension.mjs", "template/extension.mjs"],
    ["generated-canvas-template/setup-runtime.mjs", "template/setup-runtime.mjs"],
    ["generated-canvas-template/approval-runtime.mjs", "template/approval-runtime.mjs"],
    ["generated-canvas-template/amendment-runtime.mjs", "template/amendment-runtime.mjs"],
    ["generated-canvas-template/project-artifacts.mjs", "template/project-artifacts.mjs"],
    ["generated-canvas-template/README.md", "template/README.md"],
    ["generated-canvas-template/workflow-adapter.mjs", "template/workflow-adapter.mjs"],
    ["generated-canvas-template/workflow-config.json", "template/workflow-config.json"],
    ["generated-canvas-template/workspace-files.mjs", "template/workspace-files.mjs"],
    ["generated-canvas-template/ui/index.html", "template/ui/index.html"],
    ["generated-canvas-template/ui/app.js", "template/ui/app.js"],
    ["../shared-workflow-ui/markdown.mjs", "template/ui/markdown.mjs"],
    ["../shared-workflow-ui/clarifications.mjs", "template/ui/clarifications.mjs"],
    ["../shared-workflow-ui/clarification-controls.mjs", "template/ui/clarification-controls.mjs"],
    ["../shared-workflow-ui/amendment.mjs", "template/ui/amendment.mjs"],
    ["generated-canvas-template/ui/command-views.mjs", "template/ui/command-views.mjs"],
    ["generated-canvas-template/ui/workflow-slug.mjs", "template/ui/workflow-slug.mjs"],
    ["../shared-workflow-ui/workflow-theme.css", "template/ui/workflow-theme.css"],
    ["../shared-workflow-ui/artifact-viewer.css", "template/ui/artifact-viewer.css"],
    ["../shared-workflow-ui/stepper.mjs", "template/ui/stepper.mjs"],
    ["materialize-template.mjs", "materialize-template.mjs"],
];
const PROTECTED_TEMPLATE_FILES = new Set([
    "workflow-adapter.mjs",
    "setup-runtime.mjs",
    "approval-runtime.mjs",
    "amendment-runtime.mjs",
    "project-artifacts.mjs",
    "workspace-files.mjs",
    "ui/app.js",
    "ui/markdown.mjs",
    "ui/clarifications.mjs",
    "ui/clarification-controls.mjs",
    "ui/amendment.mjs",
    "ui/command-views.mjs",
    "ui/workflow-slug.mjs",
    "ui/workflow-theme.css",
    "ui/artifact-viewer.css",
    "ui/stepper.mjs",
]);

function digest(value) {
    return createHash("sha256").update(value).digest("hex");
}

async function snapshotTemplate(dir, fs) {
    const protectedFiles = [];
    for (const [sourceRel, outputRel] of TEMPLATE_FILES) {
        const payload = await readFile(join(here, ...sourceRel.split("/")));
        const output = join(dir, ...outputRel.split("/"));
        await fs.mkdir(dirname(output), { recursive: true });
        await fs.writeFile(output, payload);
        const generatedRel = outputRel.startsWith("template/") ? outputRel.slice("template/".length) : null;
        if (generatedRel && PROTECTED_TEMPLATE_FILES.has(generatedRel)) {
            protectedFiles.push({ path: generatedRel, sha256: digest(payload) });
        }
    }
    return {
        version: TEMPLATE_VERSION,
        snapshotDirectory: "template",
        materializer: "materialize-template.mjs",
        protectedFiles,
        templatedFiles: ["extension.mjs", "README.md", "ui/index.html"],
        adapterPath: "workflow-config.json",
    };
}

export function validRequestId(value) {
    return typeof value === "string" && REQUEST_ID_RE.test(value);
}

export function requestDirectory(workspacePath, requestId) {
    if (!validRequestId(requestId)) throw new Error("invalid generation request id");
    return join(workspacePath, GENERATED_CANVASES_DIR, requestId);
}

async function atomicJson(path, value, fs = realFs) {
    const payload = `${JSON.stringify(value, null, 2)}\n`;
    const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, payload, "utf8");
    await fs.rename(tmp, path);
}

export async function writeGenerationRequest(workspacePath, request, fs = realFs) {
    const dir = requestDirectory(workspacePath, request.requestId);
    await fs.mkdir(dir, { recursive: true });
    request.template = await snapshotTemplate(dir, fs);
    await atomicJson(join(dir, "request.json"), request, fs);
    return dir;
}

export async function writeGenerationResult(workspacePath, result, fs = realFs) {
    const dir = requestDirectory(workspacePath, result.requestId);
    await fs.mkdir(dir, { recursive: true });
    await atomicJson(join(dir, "result.json"), result, fs);
    return dir;
}

async function readJson(path, fs) {
    try {
        return JSON.parse(await fs.readFile(path, "utf8"));
    } catch {
        return null;
    }
}

export async function readGenerationRequest(workspacePath, requestId, fs = realFs) {
    return readJson(join(requestDirectory(workspacePath, requestId), "request.json"), fs);
}

async function requireRegularFile(path, fs, label) {
    const entry = await fs.lstat(path);
    if (entry.isSymbolicLink() || !entry.isFile()) throw new Error(`${label} is not a regular file`);
}

function validateSetupContract(blueprint) {
    const setup = blueprint?.setup;
    const steps = blueprint?.pipeline?.steps;
    if (blueprint?.schemaVersion !== 2 || !setup || !Array.isArray(steps)) {
        throw new Error("generated blueprint has no supported setup contract");
    }
    if (setup.integration?.id !== "copilot" || setup.integration?.skillsMode !== true) {
        throw new Error("generated setup contract must require Copilot skills mode");
    }
    if (setup.requireInstallationApproval !== undefined && typeof setup.requireInstallationApproval !== "boolean") {
        throw new Error("generated setup installation approval must be a boolean");
    }
    const expected = new Map();
    for (const step of steps) {
        if (!expected.has(step.skillName)) {
            expected.set(step.skillName, {
                name: step.skillName,
                invocation: step.invocation,
                commandName: step.commandName,
                provider: {
                    kind: step.source?.kind,
                    id: step.source?.id ?? null,
                },
            });
        }
    }
    const required = [...(setup.requiredSkills ?? [])].sort((a, b) => a.name.localeCompare(b.name));
    const expectedSkills = [...expected.values()].sort((a, b) => a.name.localeCompare(b.name));
    if (JSON.stringify(required) !== JSON.stringify(expectedSkills)) {
        throw new Error("generated setup requiredSkills do not match the selected pipeline");
    }
    for (const kind of ["preset", "extension"]) {
        const records = setup[`${kind}s`];
        if (!Array.isArray(records)) throw new Error(`generated setup ${kind}s must be an array`);
        const ids = new Set();
        for (const record of records) {
            if (record?.kind !== kind || !/^[a-z0-9][a-z0-9._-]*$/i.test(record.id ?? "")) {
                throw new Error(`generated setup contains an invalid ${kind}`);
            }
            if (ids.has(record.id)) throw new Error(`generated setup contains duplicate ${kind}: ${record.id}`);
            ids.add(record.id);
            if (record.source) {
                if (typeof record.source.name !== "string" || !/^https:\/\//i.test(record.source.url ?? "")) {
                    throw new Error(`generated setup contains an invalid ${kind} source`);
                }
            }
        }
    }
}

export async function validateGeneratedTemplate(request, fs = realFs) {
    const target = request?.target?.directory;
    if (!target || request?.template?.version !== TEMPLATE_VERSION) {
        throw new Error("generation request has no supported deterministic template");
    }
    for (const required of [
        "extension.mjs",
        "pipeline.json",
        "workflow-adapter.mjs",
        "workflow-config.json",
        "setup-runtime.mjs",
        "approval-runtime.mjs",
        "amendment-runtime.mjs",
        "project-artifacts.mjs",
        "workspace-files.mjs",
        "README.md",
        "ui/index.html",
        "ui/app.js",
        "ui/markdown.mjs",
        "ui/clarifications.mjs",
        "ui/clarification-controls.mjs",
        "ui/amendment.mjs",
        "ui/command-views.mjs",
        "ui/workflow-theme.css",
        "ui/artifact-viewer.css",
        "ui/stepper.mjs",
    ]) {
        try {
            await requireRegularFile(join(target, ...required.split("/")), fs, required);
        } catch {
            throw new Error(`generated extension is missing required template file: ${required}`);
        }
    }
    const requestDir = requestDirectory(request.workspacePath, request.requestId);
    const generatedPipeline = await verifyMaterializedFiles({
        requestFile: join(requestDir, "request.json"), targetDirectory: target, request,
    }, fs);
    validateSetupContract(generatedPipeline);
    validateWorkflowPaths(generatedPipeline);
    validateWorkflowConfig(JSON.parse(await fs.readFile(join(target, "workflow-config.json"), "utf8")), generatedPipeline);
    if (typeof generatedPipeline.runtime?.userProvidesSlug !== "boolean") {
        throw new Error("generated runtime must declare whether users can provide a slug");
    }
    if (typeof generatedPipeline.runtime?.multiInstance !== "boolean") {
        throw new Error("generated runtime must declare whether it supports multiple workflow instances");
    }
    if (generatedPipeline.runtime.multiInstance && !String(generatedPipeline.runtime.itemRoot ?? "").includes("<slug>")) {
        throw new Error("multi-instance generated runtime requires a slug-scoped item root");
    }
    const pipelineText = JSON.stringify(generatedPipeline);
    if (pipelineText.includes(request.workspacePath) || /token/i.test(pipelineText)) {
        throw new Error("generated pipeline.json contains workspace or token data");
    }
    const [extension, html] = await Promise.all([
        fs.readFile(join(target, "extension.mjs"), "utf8"),
        fs.readFile(join(target, "ui", "index.html"), "utf8"),
    ]);
    for (const requiredAction of ["list_items", "setup_workflow", "reloadSessionSkills", "run_phase"]) {
        if (!extension.includes(`name: "${requiredAction}"`)) throw new Error(`generated runtime is missing required action: ${requiredAction}`);
    }
    for (const forbidden of ["generate_canvas", "add_command", "remove_command", "clear_pipeline", "reset_pipeline", "reorder_phase"]) {
        if (extension.includes(forbidden) || html.includes(forbidden)) throw new Error(`generated extension contains forbidden capability: ${forbidden}`);
    }
    if (extension.includes("speckit-wizard-canvas") || extension.includes("../shared-workflow-ui")) {
        throw new Error("generated extension imports the live Wizard instead of its vendored template");
    }
    return true;
}

export async function recoverGenerationStatus(workspacePath, fs = realFs) {
    if (!workspacePath) return null;
    const root = join(workspacePath, GENERATED_CANVASES_DIR);
    let entries;
    try {
        entries = await fs.readdir(root, { withFileTypes: true });
    } catch {
        return null;
    }
    let latest = null;
    for (const entry of entries) {
        if (!entry?.isDirectory?.() || !validRequestId(entry.name)) continue;
        const dir = join(root, entry.name);
        const request = await readJson(join(dir, "request.json"), fs);
        if (!request) continue;
        const result = await readJson(join(dir, "result.json"), fs);
        const candidate = result
            ? {
                requestId: request.requestId,
                state: result.state,
                target: request.target?.relativeDirectory ?? null,
                message: result.message ?? null,
                error: result.error ?? null,
                completedAt: result.completedAt ?? null,
            }
            : {
                requestId: request.requestId,
                state: "generating",
                target: request.target?.relativeDirectory ?? null,
                startedAt: request.createdAt,
            };
        const stamp = result?.completedAt ?? request.createdAt ?? "";
        if (!latest || stamp > latest.stamp) latest = { stamp, value: candidate };
    }
    return latest?.value ?? null;
}

export const generationFs = realFs;
