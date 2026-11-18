import { lstat, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isWindowsDeviceName } from "../generated-scaffold/files.mjs";
import { readBoundedSessionFile } from "./generate.mjs";
import { REQUEST_LIMIT, validateGenerationRequestIntegrity } from "./contracts/generation-request.mjs";

const reserved = new Set(["speckit-canvas-designer", "speckit-wizard", "speckit-canvas-generator"]);

function fail(message) {
    throw new Error(`Generated canvas registration: ${message}`);
}

function field(text, label) {
    return text.match(new RegExp(`^\\s*${label}:\\s*(.*?)\\s*$`, "mi"))?.[1];
}

function expected(checkout, canvasId, requestId) {
    if (typeof checkout !== "string" || !isAbsolute(checkout)
        || typeof canvasId !== "string"
        || !/^[a-z0-9][a-z0-9-]{0,99}$/.test(canvasId)
        || reserved.has(canvasId) || isWindowsDeviceName(canvasId)
        || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(requestId)) {
        fail("invalid checkout, canvas ID or request ID.");
    }
    return { extensionId: `project:${canvasId}`, canvasId,
        instanceId: `generated-${requestId}`,
        entry: resolve(checkout, ".github", "extensions", canvasId, "extension.mjs") };
}

function samePath(actual, target) {
    if (typeof actual !== "string" || !isAbsolute(actual)) return false;
    const left = normalize(actual);
    const right = normalize(target);
    return process.platform === "win32"
        ? left.toLowerCase() === right.toLowerCase() : left === right;
}

async function directory(path) {
    let stat;
    try { stat = await lstat(path); }
    catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
    }
    if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(path) !== path) {
        fail(`unsafe directory: ${path}`);
    }
    return stat;
}

async function unchanged(path, before) {
    const after = await directory(path);
    if (!after || after.dev !== before.dev || after.ino !== before.ino) {
        fail(`directory changed during discovery: ${path}`);
    }
}

async function metadata(parent, name, limit) {
    return JSON.parse(await readBoundedSessionFile(parent, name, limit,
        `Generated canvas ${name}`));
}

async function candidate(target, canvasId, handoffId, requestId, fingerprint) {
    const folder = await directory(target);
    if (!folder) fail(`generated canvas is missing: ${target}`);
    const provenance = await metadata(target, "settings-provenance.json", 1024 * 1024);
    if (!provenance || typeof provenance !== "object" || Array.isArray(provenance)
        || Object.keys(provenance).sort().join() !== "handoffId,requestId,sourceFingerprint"
        || provenance.handoffId !== handoffId || provenance.requestId !== requestId
        || !/^[a-f0-9]{64}$/.test(provenance.sourceFingerprint)
        || (fingerprint && provenance.sourceFingerprint !== fingerprint)) {
        fail(`provenance does not match the generation request: ${target}`);
    }
    const config = await metadata(target, "canvas-config.json", 1024 * 1024);
    if (config?.canvas?.id !== canvasId) fail(`canvas configuration does not match: ${target}`);
    const entry = await lstat(join(target, "extension.mjs"));
    if (!entry.isFile() || entry.isSymbolicLink()) fail(`unsafe generated entry point: ${target}`);
    await unchanged(target, folder);
    return { canvasId, target: `.github/extensions/${canvasId}/`, requestId };
}

export async function resolveGeneratedTarget(checkout, workspace, handoffId, requestId) {
    if (!isAbsolute(checkout) || !isAbsolute(workspace)
        || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(handoffId)
        || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(requestId)) {
        fail("invalid checkout, workspace, handoff ID or request ID.");
    }
    const project = resolve(checkout);
    const projectStat = await directory(project);
    if (!projectStat) fail(`checkout is missing: ${project}`);
    const parent = join(project, ".github", "extensions");
    for (const path of [join(project, ".github"), parent]) {
        if (!await directory(path)) fail(`generated extension directory is missing: ${path}`);
    }
    const parentStat = await directory(parent);
    const sessionRoot = resolve(workspace);
    let requestParent = sessionRoot;
    let requestPresent = true;
    for (const part of ["speckit-canvas-designer", "handoffs", handoffId,
        "generations", requestId]) {
        if (requestPresent) requestPresent = !!await directory(requestParent);
        requestParent = join(requestParent, part);
    }
    if (requestPresent) requestPresent = !!await directory(requestParent);
    let request = null;
    let requestFound = false;
    if (requestPresent) {
        let file;
        try { file = await lstat(join(requestParent, "request.json")); }
        catch (error) {
            if (error.code !== "ENOENT") throw error;
        }
        if (file) {
            request = await metadata(requestParent, "request.json", REQUEST_LIMIT);
            requestFound = true;
        }
    }
    if (requestFound) {
        if (!request || typeof request !== "object" || Array.isArray(request)) {
            fail("invalid frozen generation request.");
        }
        validateGenerationRequestIntegrity(request, handoffId, requestId);
        const canvasId = request.values?.["canvas.id"];
        expected(project, canvasId, requestId);
        if (request.project !== project
            || request.target !== `.github/extensions/${canvasId}/`
            || !/^[a-f0-9]{64}$/.test(request.sourceFingerprint)) {
            fail("frozen generation request does not match this checkout.");
        }
        const result = await candidate(join(parent, canvasId), canvasId,
            handoffId, requestId, request.sourceFingerprint);
        await unchanged(parent, parentStat);
        await unchanged(project, projectStat);
        return result;
    }
    const matches = [];
    for (const entry of await readdir(parent, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
        const canvasId = entry.name;
        try { expected(project, canvasId, requestId); }
        catch { continue; }
        const target = join(parent, canvasId);
        if (!await directory(target)) continue;
        let provenance;
        try { provenance = await metadata(target, "settings-provenance.json", 1024 * 1024); }
        catch (error) {
            if (error.code === "ENOENT") continue;
            throw error;
        }
        if (!provenance || typeof provenance !== "object" || Array.isArray(provenance)
            || Object.keys(provenance).sort().join() !== "handoffId,requestId,sourceFingerprint"
            || typeof provenance.handoffId !== "string"
            || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(provenance.handoffId)
            || typeof provenance.requestId !== "string"
            || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(provenance.requestId)
            || !/^[a-f0-9]{64}$/.test(provenance.sourceFingerprint)) {
            fail(`invalid generated provenance: ${target}`);
        }
        if (provenance.handoffId === handoffId && provenance.requestId === requestId) {
            matches.push(canvasId);
        }
    }
    if (matches.length !== 1) fail(`expected one matching generated canvas, found ${matches.length}.`);
    const result = await candidate(join(parent, matches[0]), matches[0], handoffId, requestId);
    await unchanged(parent, parentStat);
    await unchanged(project, projectStat);
    return result;
}

export function validateGeneratedProvider(list, inspect, checkout, canvasId, requestId) {
    const wanted = expected(checkout, canvasId, requestId);
    if (typeof list !== "string" || typeof inspect !== "string") {
        fail("list and inspect must contain the unmodified extension-management results.");
    }
    const entries = list.split(/^•\s*/m).slice(1);
    const registered = entries.filter((entry) => field(entry, "ID") === wanted.extensionId);
    if (registered.length !== 1 || field(registered[0], "Source") !== "project"
        || !samePath(field(registered[0], "Path"), wanted.entry)) {
        fail("the project provider is missing, ambiguous, or not from the generated entry point.");
    }
    if (field(inspect, "ID") !== wanted.extensionId
        || field(inspect, "Source") !== "project"
        || !samePath(field(inspect, "Path"), wanted.entry)
        || !["running", "ready"].includes(field(inspect, "Status"))) {
        fail("inspection does not show the running generated project provider.");
    }
    return wanted;
}

function identity(result, kind) {
    if (!result || typeof result !== "object" || Array.isArray(result)) {
        fail(`${kind} must supply the tool's explicit canvas and extension IDs.`);
    }
    return result;
}

export function validateGeneratedCanvas(result, checkout, canvasId, requestId) {
    const wanted = expected(checkout, canvasId, requestId);
    const found = identity(result, "canvas capabilities");
    if (found.canvasId !== wanted.canvasId || found.extensionId !== wanted.extensionId) {
        fail("canvas capabilities belong to a different canvas or provider.");
    }
    return wanted;
}

export function validateGeneratedOpen(result, checkout, canvasId, requestId) {
    const wanted = validateGeneratedCanvas(result, checkout, canvasId, requestId);
    if (result.instanceId !== wanted.instanceId) {
        fail("opened instance does not match the generation request.");
    }
    return wanted;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const [stage, checkout, canvasId, requestId, extra] = process.argv.slice(2);
        if (!["target", "provider", "canvas", "open"].includes(stage)) {
            fail("usage: validate-generated-open.mjs <target|provider|canvas|open> <checkout> <canvas-id|workspace> <request-id|handoff-id> [request-id] (JSON on stdin for provider/canvas/open).");
        }
        let wanted;
        if (stage === "target") {
            wanted = await resolveGeneratedTarget(checkout, canvasId, requestId, extra);
        } else {
            let json = "";
            for await (const chunk of process.stdin) json += chunk;
            const input = JSON.parse(json);
            wanted = stage === "provider"
                ? validateGeneratedProvider(input.list, input.inspect, checkout, canvasId, requestId)
                : stage === "canvas"
                    ? validateGeneratedCanvas(input.capabilities, checkout, canvasId, requestId)
                    : validateGeneratedOpen(input.opened, checkout, canvasId, requestId);
        }
        console.log(JSON.stringify(wanted));
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
