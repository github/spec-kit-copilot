import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { join } from "node:path";
import { outputTarget, validateCanvasId } from "../ui/generated-output-state.js";

export { validateCanvasId };

export function validateOutputAction(input, { replace = false } = {}) {
    const keys = replace && input?.replaceExisting === true
        ? ["canvasId", "replaceExisting"] : ["canvasId"];
    if (!input || typeof input !== "object" || Array.isArray(input)
        || Object.keys(input).sort().join() !== keys.sort().join()) {
        throw new Error("Invalid generated canvas action");
    }
    validateCanvasId(input.canvasId);
    return input;
}

const METADATA_LIMIT = 1024 * 1024;

export async function readGeneratedJson(parent, name, openFile = open, expectedParent = null) {
    const path = join(parent, name);
    const before = await lstat(parent);
    if (!before.isDirectory() || (expectedParent
        && (before.dev !== expectedParent.dev || before.ino !== expectedParent.ino))) {
        throw new Error("Generated canvas metadata parent changed during read");
    }
    let file;
    try {
        file = await openFile(path, constants.O_RDONLY
            | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    }
    catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
    }
    try {
        const [opened, atPath, actualParent, parentStat] = await Promise.all([
            file.stat(), lstat(path), realpath(parent), lstat(parent),
        ]);
        if (actualParent !== parent || !parentStat.isDirectory()
            || before.dev !== parentStat.dev || before.ino !== parentStat.ino || !opened.isFile()
            || !atPath.isFile() || atPath.isSymbolicLink()
            || opened.dev !== atPath.dev || opened.ino !== atPath.ino) {
            throw new Error("Generated canvas metadata changed during read");
        }
        if (opened.size > METADATA_LIMIT) return null;
        const bytes = Buffer.alloc(METADATA_LIMIT + 1);
        let length = 0;
        while (length < bytes.length) {
            const { bytesRead } = await file.read(bytes, length, bytes.length - length, length);
            if (!bytesRead) break;
            length += bytesRead;
        }
        if (length > METADATA_LIMIT) return null;
        return JSON.parse(bytes.toString("utf8", 0, length));
    } finally {
        await file.close();
    }
}

export async function generatedOutput(project, id, handoffId, readJson = readGeneratedJson) {
    validateCanvasId(id);
    const root = await realpath(project);
    const parent = join(root, ".github", "extensions");
    const target = join(parent, id);
    try {
        if (await realpath(parent) !== parent) {
            throw new Error("Generated extension parent escapes the checkout");
        }
    } catch (error) {
        if (error.code === "ENOENT") return { status: "absent", target: outputTarget(id) };
        throw error;
    }
    let folder;
    try { folder = await lstat(target); }
    catch (error) {
        if (error.code === "ENOENT") return { status: "absent", target: outputTarget(id) };
        throw error;
    }
    const result = { status: "foreign", target: outputTarget(id) };
    if (!folder.isDirectory() || await realpath(target) !== target) return result;
    try {
        const config = await readJson(target, "canvas-config.json", open, folder);
        const provenance = await readJson(target, "settings-provenance.json", open, folder);
        if (config?.canvas?.id !== id || !provenance || typeof provenance !== "object"
            || Array.isArray(provenance)
            || Object.keys(provenance).sort().join() !== "handoffId,requestId,sourceFingerprint"
            || provenance.handoffId !== handoffId
            || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(provenance.requestId)
            || !/^[a-f0-9]{64}$/.test(provenance.sourceFingerprint)) return result;
        const entry = await lstat(join(target, "extension.mjs"));
        const current = await lstat(target);
        if (!current.isDirectory() || current.isSymbolicLink()
            || current.dev !== folder.dev || current.ino !== folder.ino
            || await realpath(target) !== target) return result;
        return entry.isFile() ? { ...result, status: "ready", requestId: provenance.requestId }
            : { ...result, status: "incomplete" };
    } catch (error) {
        if (error.code === "ENOENT") return { ...result, status: "incomplete" };
        if (error instanceof SyntaxError || error.code === "ELOOP"
            || ["Generated canvas metadata parent changed during read",
                "Generated canvas metadata changed during read"].includes(error.message)) return result;
        throw error;
    }
}
