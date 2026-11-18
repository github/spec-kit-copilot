import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { HANDOFF_LIMIT, validateHandoff, validateHandoffId } from "./contracts/wizard-handoff.mjs";

export {
    HANDOFF_LIMIT, CONSTITUTION_OUTPUT, fixedConstitutionOutputs, validateConfirmedOutputs,
    validatePhaseOutputs, validateHandoffId, fingerprint, validateHandoff,
} from "./contracts/wizard-handoff.mjs";

export async function readHandoff(workspacePath, handoffId, openFile = open, expectedHash = null) {
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
        if (expectedHash && createHash("sha256").update(bytes.subarray(0, length)).digest("hex")
            !== expectedHash) throw new Error("Designer handoff bytes changed; stop and relaunch.");
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
