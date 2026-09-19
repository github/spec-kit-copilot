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

export const GENERATED_CANVASES_DIR = ".speckit-wizard/generated-canvases";
const REQUEST_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const realFs = { mkdir, lstat, readFile, readdir, realpath, rename, stat, writeFile };
const here = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_VERSION = 28;
const TEMPLATE_FILES = [
    ["generated-canvas-template/extension.mjs", "template/extension.mjs"],
    ["generated-canvas-template/setup-runtime.mjs", "template/setup-runtime.mjs"],
    ["generated-canvas-template/approval-runtime.mjs", "template/approval-runtime.mjs"],
    ["generated-canvas-template/amendment-runtime.mjs", "template/amendment-runtime.mjs"],
    ["generated-canvas-template/artifact-review.mjs", "template/artifact-review.mjs"],
    ["generated-canvas-template/phase-runs.mjs", "template/phase-runs.mjs"],
    ["generated-canvas-template/phase-response.mjs", "template/phase-response.mjs"],
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
    "artifact-review.mjs",
    "phase-runs.mjs",
    "phase-response.mjs",
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
