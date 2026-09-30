import { createHash, timingSafeEqual } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { DESIGN_EXTENSION, validDesignSource } from "./source.mjs";

export const HANDOFF_LIMIT = 64 * 1024;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const PACKAGE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const KINDS = ["presets", "extensions", "bundles"];
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function safeUrl(value) {
    if (value === null) return true;
    if (typeof value !== "string" || value.length > 2048 || /[\s\x00-\x1f\x7f<>]/.test(value)) {
        return false;
    }
    try {
        const url = new URL(value);
        return url.protocol === "https:" && !!url.hostname && !url.username && !url.password;
    } catch { return false; }
}

export function validateHandoffId(id) {
    if (typeof id !== "string" || !ID.test(id)) throw new Error("Invalid Designer handoff ID");
    return id;
}

export function fingerprint(data) {
    return createHash("sha256").update(JSON.stringify(data)).digest("hex");
}

export function validateHandoff(handoff, id) {
    validateHandoffId(id);
    if (!record(handoff)
        || Object.keys(handoff).some((key) =>
            !["schemaVersion", "handoffId", "workflow", "selections", "requiredExtension", "sourceFingerprint"].includes(key))
        || handoff.schemaVersion !== 2 || handoff.handoffId !== id
        || !validDesignSource(handoff.requiredExtension)
        || !record(handoff.workflow)
        || Object.keys(handoff.workflow).some((key) => key !== "selectedPhases")
        || !Array.isArray(handoff.workflow.selectedPhases)
        || handoff.workflow.selectedPhases.length > 30
        || !handoff.workflow.selectedPhases.every((phase) => typeof phase === "string" && PACKAGE.test(phase))
        || !record(handoff.selections)
        || Object.keys(handoff.selections).some((kind) => !KINDS.includes(kind))
        || KINDS.some((kind) => !Array.isArray(handoff.selections[kind])
            || handoff.selections[kind].length > 40
            || new Set(handoff.selections[kind].map((item) =>
                `${item?.source}:${item?.id}`)).size !== handoff.selections[kind].length
            || !handoff.selections[kind].every((item) => record(item)
                && Object.keys(item).every((key) =>
                    ["id", "source", "approved", "version", "downloadUrl"].includes(key))
                && typeof item.id === "string" && PACKAGE.test(item.id)
                && typeof item.source === "string" && PACKAGE.test(item.source)
                && item.approved === true
                && (item.version === null || (typeof item.version === "string"
                    && /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/.test(item.version)))
                && safeUrl(item.downloadUrl)))
        || typeof handoff.sourceFingerprint !== "string"
        || !/^[a-f0-9]{64}$/.test(handoff.sourceFingerprint)
        || Buffer.byteLength(JSON.stringify(handoff)) > HANDOFF_LIMIT) {
        throw new Error("Invalid Designer handoff");
    }
    const required = handoff.selections.extensions.filter((item) => item.id === DESIGN_EXTENSION);
    if (required.length !== 1 || required[0].source !== "copilot"
        || required[0].version !== handoff.requiredExtension.version || required[0].downloadUrl !== null) {
        throw new Error("Missing or conflicting required Canvas Design selection");
    }
    for (const kind of KINDS) {
        if (new Set(handoff.selections[kind].map((item) => item.id)).size !== handoff.selections[kind].length) {
            throw new Error(`Conflicting Designer ${kind} sources`);
        }
    }
    const expected = Buffer.from(fingerprint({
        workflow: handoff.workflow, selections: handoff.selections, requiredExtension: handoff.requiredExtension,
    }), "hex");
    if (!timingSafeEqual(expected, Buffer.from(handoff.sourceFingerprint, "hex"))) {
        throw new Error("Designer handoff fingerprint mismatch");
    }
    return handoff;
}

export async function readHandoff(workspacePath, handoffId, openFile = open) {
    const id = validateHandoffId(handoffId);
    if (typeof workspacePath !== "string" || !workspacePath.trim()) {
        throw new Error("Designer session workspace is unavailable");
    }
    const root = await realpath(workspacePath);
    const folder = join(root, "speckit-canvas-designer", "handoffs", id);
    const actual = await realpath(folder);
    const rel = relative(root, actual);
    if (!rel || rel === ".." || rel.startsWith(`..${sep}`)
        || isAbsolute(rel) || actual !== folder) {
        throw new Error("Designer handoff escapes session artifacts");
    }
    const path = join(folder, "handoff.json");
    let file;
    try {
        file = await openFile(path, constants.O_RDONLY
            | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    } catch (error) {
        if (error.code === "ELOOP") throw new Error("Invalid Designer handoff file", { cause: error });
        throw error;
    }
    let text;
    try {
        const [stat, pathStat, currentFolder] = await Promise.all([
            file.stat(), lstat(path), realpath(folder),
        ]);
        if (currentFolder !== folder) throw new Error("Designer handoff escapes session artifacts");
        if (!stat.isFile() || !pathStat.isFile() || pathStat.isSymbolicLink()
            || stat.dev !== pathStat.dev || stat.ino !== pathStat.ino
            || stat.size > HANDOFF_LIMIT) {
            throw new Error("Invalid Designer handoff file");
        }
        const bytes = Buffer.alloc(HANDOFF_LIMIT + 1);
        let length = 0;
        while (length < bytes.length) {
            const { bytesRead } = await file.read(bytes, length, bytes.length - length, length);
            if (bytesRead === 0) break;
            length += bytesRead;
        }
        if (length > HANDOFF_LIMIT) throw new Error("Oversized Designer handoff");
        text = bytes.toString("utf8", 0, length);
    } finally {
        await file.close();
    }
    let handoff;
    try { handoff = JSON.parse(text); }
    catch { throw new Error("Malformed Designer handoff"); }
    return validateHandoff(handoff, id);
}

export function handoffDirectory(workspacePath, id) {
    validateHandoffId(id);
    if (typeof workspacePath !== "string" || !workspacePath.trim()) {
        throw new Error("Designer session workspace is unavailable");
    }
    return resolve(workspacePath, "speckit-canvas-designer", "handoffs", id);
}
