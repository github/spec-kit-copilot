// Constrain standalone artifact reads and workflow paths to the selected workspace.
import { spawn } from "node:child_process";
import { lstat, open, readdir, realpath, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute, relative, resolve, posix } from "node:path";
import { commandViews } from "./ui/command-views.mjs";

function inside(root, child) {
    const rel = relative(root, child);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function workflowPath(value, { template = false } = {}) {
    if (typeof value !== "string" || !value || value !== value.trim()) throw new Error("invalid workflow path");
    const path = value.replaceAll("\\", "/");
    const parts = path.split("/");
    if (parts.some((part, index) => !part || part === "." || part === ".."
        || (!(template && (part === "<slug>" || (part === "<name>.md" && index === parts.length - 1))) && /[<>:"|?*\x00-\x1f]/.test(part))
        || /[. ]$/.test(part)
        || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))
        || (!template && parts.includes("<slug>"))) {
        throw new Error("invalid workflow path");
    }
    if (parts.filter((part) => part === "<slug>").length > 1) throw new Error("invalid workflow slug template");
    return path;
}

export function validateWorkflowPaths(pipeline) {
    const { constitution } = commandViews(pipeline);
    if (constitution) {
        try {
            workflowPath(constitution.artifact.pathTemplate);
        } catch (error) {
            throw new Error(`Unsupported Constitution contract: declare a safe project-relative Markdown artifact (${error.message}).`);
        }
    }
    const artifacts = (pipeline.pipeline?.steps ?? [])
        .map((step) => step.artifact?.pathTemplate)
        .filter((path) => path != null)
        .map((path) => workflowPath(path, { template: true }));
    const root = pipeline.runtime?.itemRoot;
    if (root != null) {
        const path = workflowPath(root, { template: true });
        const parts = path.split("/");
        if (parts.length < 2 || parts.at(-1) !== "<slug>"
            || parts[0] === "<slug>"
            || /^(?:\.git|\.github|node_modules|\.speckit-wizard)(?:\/|$)/i.test(path)
            || /^\.specify\/(?:<slug>|extensions|presets|templates|memory)(?:\/|$)/i.test(path)
            || !artifacts.some((artifact) => artifact.startsWith(`${path}/`))
            || artifacts.some((artifact) => artifact.includes("<slug>") && !artifact.startsWith(`${path}/`))) {
            throw new Error("item root must be a dedicated slug-scoped workflow directory containing declared artifacts");
        }
    } else if (artifacts.some((artifact) => artifact.includes("<slug>"))) {
        throw new Error("slug-scoped artifacts require an item root");
    }
    return artifacts;
}

function matchesTemplate(path, template) {
    const actual = path.split("/");
    const expected = template.split("/");
    return actual.length === expected.length && expected.every((part, index) => (
        part === "<slug>" ? SLUG.test(actual[index])
            : part === "<name>.md" ? /^[a-z0-9][a-z0-9._-]*\.md$/i.test(actual[index])
                : part === actual[index]
    ));
}

export async function resolveDeclaredArtifact(workspacePath, template, slug, pipeline) {
    if (!template) return null;
    const normalized = workflowPath(template, { template: true });
    if (normalized.includes("<slug>") && !slug) return null;
    if (slug != null && !SLUG.test(slug)) throw new Error("invalid workflow slug");
    const path = normalized.replaceAll("<slug>", slug ?? "");
    if (posix.basename(path) !== "<name>.md") return path;
    const parent = posix.dirname(path);
    let directory;
    try {
        directory = await resolveWorkflowPath(workspacePath, parent, pipeline, "reveal");
    } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
    }
    const candidates = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (!entry.isFile() || !matchesTemplate(entry.name, "<name>.md")) continue;
        const relativePath = posix.join(parent, entry.name);
        const full = await resolveWorkflowPath(workspacePath, relativePath, pipeline, "artifact");
        candidates.push({ path: relativePath, mtime: (await lstat(full)).mtimeMs });
    }
    candidates.sort((left, right) => right.mtime - left.mtime || left.path.localeCompare(right.path));
    return candidates[0]?.path ?? null;
}

export function authorizeWorkflowPath(pipeline, relativePath, operation) {
    const artifacts = validateWorkflowPaths(pipeline);
    if (operation === "reveal" && relativePath === "." && artifacts.some((artifact) => posix.dirname(artifact) === ".")) return ".";
    const path = workflowPath(relativePath);
    let allowed = [];
    if (operation === "artifact") allowed = artifacts;
    else if (operation === "reveal") {
        allowed = artifacts.map((artifact) => posix.dirname(artifact)).filter((dir) => dir !== ".");
        if (pipeline.runtime?.multiInstance === true && pipeline.runtime?.itemRoot) {
            allowed.push(posix.dirname(workflowPath(pipeline.runtime.itemRoot, { template: true })));
        }
    }
    else if (operation === "delete" && pipeline.runtime?.multiInstance === true && pipeline.runtime?.itemRoot) {
        allowed = [workflowPath(pipeline.runtime.itemRoot, { template: true })];
    }
    if (!allowed.some((template) => matchesTemplate(path, template))) {
        throw new Error(`${operation} path is outside the declared workflow scope`);
    }
    return path;
}

export async function resolveWorkflowPath(workspacePath, relativePath, pipeline, operation) {
    const path = authorizeWorkflowPath(pipeline, relativePath, operation);
    if (path === ".") return realpath(resolve(workspacePath));
    return resolveRegularPath(workspacePath, path, operation === "artifact" ? "file" : "directory");
}

export const ARTIFACT_CAP = 512 * 1024;

export async function readWorkflowArtifact(workspacePath, relativePath, pipeline) {
    const file = await resolveWorkflowPath(workspacePath, relativePath, pipeline, "artifact");
    const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
        const before = await handle.stat();
        if (!before.isFile() || before.size > ARTIFACT_CAP) {
            throw Object.assign(new Error("Artifact is unavailable or exceeds the 512 KiB limit."), { code: "ARTIFACT_UNAVAILABLE" });
        }
        const buffer = Buffer.alloc(ARTIFACT_CAP + 1);
        let size = 0;
        while (size < buffer.length) {
            const { bytesRead } = await handle.read(buffer, size, buffer.length - size, size);
            if (!bytesRead) break;
            size += bytesRead;
        }
        if (size > ARTIFACT_CAP) throw Object.assign(new Error("Artifact exceeds the 512 KiB limit."), { code: "ARTIFACT_UNAVAILABLE" });
        const verified = await resolveWorkflowPath(workspacePath, relativePath, pipeline, "artifact");
        const after = await lstat(verified);
        if (before.ino !== after.ino || before.dev !== after.dev || before.size !== size
            || before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
            throw new Error("Artifact changed while reading; refresh and try again.");
        }
        return new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, size));
    } finally {
        await handle.close();
    }
}

async function resolveRegularPath(workspacePath, path, kind) {
    const workspace = await realpath(resolve(workspacePath));
    let target = workspace;
    // Reject links at every component, including junctions into a sibling workflow.
    for (const part of path.split("/")) {
        target = resolve(target, part);
        const entry = await lstat(target);
        if (entry.isSymbolicLink()) throw new Error("workflow path contains a symbolic link");
    }
    const entry = await lstat(target);
    if (kind === "directory" ? !entry.isDirectory() : !entry.isFile()) throw new Error(`workflow ${kind} is unavailable`);
    const realTarget = await realpath(target);
    if (!inside(workspace, realTarget) || relative(target, realTarget) !== "") throw new Error("workflow path resolves outside its authorized location");
    return realTarget;
}

export async function resolveWorkspaceDirectory(workspacePath, relativePath) {
    if (typeof relativePath !== "string" || !relativePath.trim() || isAbsolute(relativePath)) {
        throw new Error("invalid workspace folder");
    }
    const workspace = resolve(workspacePath);
    const target = resolve(workspace, relativePath);
    if (!inside(workspace, target)) throw new Error("folder is outside workspace");
    return resolveRegularPath(workspace, workflowPath(relativePath), "directory");
}

export async function revealWorkspaceDirectory(workspacePath, relativePath, {
    pipeline,
    platform = process.platform,
    spawnImpl = spawn,
} = {}) {
    const target = await resolveWorkflowPath(workspacePath, relativePath, pipeline, "reveal");
    const [command, args] = platform === "win32"
        ? ["explorer.exe", [target]]
        : platform === "darwin"
            ? ["open", [target]]
            : ["xdg-open", [target]];
    await new Promise((resolveSpawn, reject) => {
        const child = spawnImpl(command, args, { detached: true, stdio: "ignore" });
        child.once("error", reject);
        child.once("spawn", () => { child.unref(); resolveSpawn(); });
    });
    return target;
}

export async function deleteWorkspaceDirectory(workspacePath, relativePath, pipeline) {
    const target = await resolveWorkflowPath(workspacePath, relativePath, pipeline, "delete");
    await rm(target, { recursive: true, force: false });
    return target;
}
