import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, realpath, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { HANDOFF_LIMIT, readHandoff, validateHandoff, validateHandoffId } from "./handoff.mjs";
import { assertDiagnosticSize, BootstrapError, bootstrapSessionContext, DIAGNOSTIC_LIMIT,
    validateLaunchReference } from "./contracts/bootstrap.mjs";
import { INFERENCE_INPUT_LIMIT, INFERENCE_RESULT_LIMIT, mergeInferenceOutputs,
    validateInferenceInput, validateInferenceSubmission } from "./contracts/output-inference.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function directories(root, id, create = false) {
    validateHandoffId(id);
    const canonical = await realpath(root);
    if (canonical !== root) throw new Error("Designer artifact root is not canonical");
    const snapshots = [];
    let path = root;
    for (const segment of ["", "speckit-canvas-designer", "handoffs", id]) {
        if (segment) {
            await unchanged(snapshots);
            path = join(path, segment);
            if (create) {
                try { await mkdir(path); }
                catch (error) { if (error.code !== "EEXIST") throw error; }
            }
        }
        const stat = await lstat(path);
        if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(path) !== path) {
            throw new Error("Designer artifacts escape the session-state root");
        }
        snapshots.push({ path, stat });
    }
    await unchanged(snapshots);
    return snapshots;
}

async function unchanged(snapshots) {
    for (const { path, stat } of snapshots) {
        const current = await lstat(path);
        if (!current.isDirectory() || current.isSymbolicLink()
            || current.dev !== stat.dev || current.ino !== stat.ino
            || await realpath(path) !== path) {
            throw new Error("Designer artifact directory changed");
        }
    }
}

async function readBytes(root, id, name, limit, openFile = open) {
    const snapshots = await directories(root, id);
    const path = join(snapshots.at(-1).path, name);
    const file = await openFile(path, constants.O_RDONLY
        | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    try {
        const [stat, current] = await Promise.all([file.stat(), lstat(path)]);
        if (!stat.isFile() || !current.isFile() || current.isSymbolicLink()
            || stat.dev !== current.dev || stat.ino !== current.ino || stat.size > limit) {
            throw new Error("Invalid or oversized Designer artifact");
        }
        const bytes = Buffer.alloc(limit + 1);
        let length = 0;
        while (length < bytes.length) {
            const { bytesRead } = await file.read(bytes, length, bytes.length - length, null);
            if (!bytesRead) break;
            length += bytesRead;
        }
        if (length > limit) throw new Error("Oversized Designer artifact");
        await unchanged(snapshots);
        const after = await lstat(path);
        if (!after.isFile() || after.isSymbolicLink() || after.dev !== stat.dev || after.ino !== stat.ino
            || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) {
            throw new Error("Designer artifact changed while reading");
        }
        return bytes.subarray(0, length);
    } finally {
        await file.close();
    }
}

async function writeBytes(root, id, name, bytes, replace = false, limit = HANDOFF_LIMIT) {
    if (bytes.length > limit) throw new Error("Oversized Designer artifact");
    const snapshots = await directories(root, id, true);
    const folder = snapshots.at(-1).path;
    const path = join(folder, name);
    const temporary = join(folder, `.bootstrap-${randomUUID()}.tmp`);
    const file = await open(temporary, "wx", 0o600);
    try {
        await file.writeFile(bytes);
        await file.sync();
        await unchanged(snapshots);
        if (replace) {
            try {
                const current = await lstat(path);
                if (!current.isFile() || current.isSymbolicLink()) throw new Error("Invalid Designer diagnostic destination");
            } catch (error) {
                if (error.code !== "ENOENT") throw error;
            }
            await rename(temporary, path);
        } else {
            try { await link(temporary, path); }
            catch (error) {
                if (error.code !== "EEXIST") throw error;
                const current = await readBytes(root, id, name, limit);
                if (!current.equals(bytes)) throw new Error("Designer handoff already exists with different bytes");
            }
        }
        await unchanged(snapshots);
        return path;
    } finally {
        await file.close();
        await rm(temporary, { force: true });
    }
}

function parse(bytes) {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

export async function stageDesignerHandoff(session, handoff, inferenceInput) {
    const context = await bootstrapSessionContext(session);
    validateHandoff(handoff, handoff.handoffId);
    const bytes = Buffer.from(JSON.stringify(handoff), "utf8");
    if (bytes.length > HANDOFF_LIMIT) throw new Error("Designer handoff exceeds 64KB");
    const reference = validateLaunchReference({ sourceSessionId: context.sessionId,
        sourceRoot: await realpath(context.root), handoffId: handoff.handoffId,
        sha256: hash(bytes) });
    if (handoff.schemaVersion === 2) {
        validateInferenceInput(inferenceInput, handoff);
        const input = Buffer.from(JSON.stringify(inferenceInput), "utf8");
        if (inferenceInput.workspacePath !== context.project
            || hash(input) !== handoff.workflow.pendingOutputs.inputHash) {
            throw new Error("Designer inference inputs do not match the frozen launch");
        }
        await writeBytes(reference.sourceRoot, reference.handoffId, "inference-input.json",
            input, false, INFERENCE_INPUT_LIMIT);
    } else if (inferenceInput !== undefined) {
        throw new Error("Complete Designer handoffs cannot contain pending inference inputs");
    }
    await writeBytes(reference.sourceRoot, reference.handoffId, "handoff.json", bytes);
    return reference;
}

export async function transferDesignerHandoff(reference, context, openFile = open) {
    validateLaunchReference(reference);
    if (reference.sourceSessionId === context.sessionId
        || reference.sourceRoot === context.root || context.root === context.project) {
        throw new BootstrapError("designer_child_required", "Designer setup must run in the app-native child session, not the Wizard.");
    }
    const bytes = await readBytes(reference.sourceRoot, reference.handoffId, "handoff.json", HANDOFF_LIMIT, openFile);
    if (hash(bytes) !== reference.sha256) {
        throw new Error("Designer handoff bytes changed; stop and relaunch.");
    }
    const handoff = validateHandoff(parse(bytes), reference.handoffId);
    if (handoff.schemaVersion === 2) {
        const input = await readBytes(reference.sourceRoot, reference.handoffId,
            "inference-input.json", INFERENCE_INPUT_LIMIT, openFile);
        if (hash(input) !== handoff.workflow.pendingOutputs.inputHash) {
            throw new Error("Designer inference inputs changed; stop and relaunch.");
        }
        validateInferenceInput(parse(input), handoff);
        await writeBytes(context.root, reference.handoffId, "inference-input.json",
            input, false, INFERENCE_INPUT_LIMIT);
    }
    await writeBytes(context.root, reference.handoffId, "handoff.json", bytes);
}

export async function readInferenceInput(root, handoff) {
    if (handoff.schemaVersion !== 2) throw new Error("Designer launch has no pending inference");
    const bytes = await readBytes(root, handoff.handoffId, "inference-input.json", INFERENCE_INPUT_LIMIT);
    if (hash(bytes) !== handoff.workflow.pendingOutputs.inputHash) {
        throw new Error("Designer inference inputs changed; stop and relaunch.");
    }
    return validateInferenceInput(parse(bytes), handoff);
}

export async function assertInferenceSourcesCurrent(input) {
    if (await realpath(input.workspacePath) !== input.workspacePath) {
        throw new Error("Designer inference source workspace changed; stop and relaunch.");
    }
    const { effectiveSource } = await import("../speckit-wizard-canvas/artifact-evidence.mjs");
    for (const request of input.commands) {
        const source = await effectiveSource(input.workspacePath, request.commandId);
        if (!source || source.skillPath !== request.skillPath
            || source.fingerprint !== request.fingerprint || source.skillText !== request.text
            || JSON.stringify(source.sources) !== JSON.stringify(request.sources)) {
            throw new Error(`Installed skill changed or is unavailable for ${request.commandId}`);
        }
    }
}

async function validateInferenceResult(result, handoff) {
    if (!result || typeof result !== "object" || Array.isArray(result)
        || Object.keys(result).sort().join() !== "entries,handoffId,inputHash,schemaVersion,sourceFingerprint"
        || result.schemaVersion !== 1 || result.handoffId !== handoff.handoffId
        || result.sourceFingerprint !== handoff.sourceFingerprint
        || result.inputHash !== handoff.workflow.pendingOutputs.inputHash) {
        throw new Error("Designer inference result does not match the frozen launch");
    }
    return validateInferenceSubmission({ entries: result.entries }, handoff);
}

export async function readInferenceResult(root, handoff, { optional = false } = {}) {
    let bytes;
    try { bytes = await readBytes(root, handoff.handoffId, "inference-result.json", INFERENCE_RESULT_LIMIT); }
    catch (error) {
        if (error.code !== "ENOENT") throw error;
        if (optional) return null;
        throw new Error("Designer output inference is pending; complete it before opening Designer.", { cause: error });
    }
    const submission = await validateInferenceResult(parse(bytes), handoff);
    return { submission, hash: hash(bytes) };
}

export async function writeInferenceResult(root, handoff, submission) {
    const validated = await validateInferenceSubmission(submission, handoff);
    await mergeInferenceOutputs(handoff, validated);
    const result = { schemaVersion: 1, handoffId: handoff.handoffId,
        sourceFingerprint: handoff.sourceFingerprint,
        inputHash: handoff.workflow.pendingOutputs.inputHash, entries: validated.entries };
    const bytes = Buffer.from(JSON.stringify(result), "utf8");
    await writeBytes(root, handoff.handoffId, "inference-result.json",
        bytes, false, INFERENCE_RESULT_LIMIT);
    return readInferenceResult(root, handoff);
}

export async function readResolvedHandoff(root, id, expectedHash) {
    const handoff = await readHandoff(root, id, undefined, expectedHash);
    if (handoff.schemaVersion === 1) return handoff;
    const canonical = await realpath(root);
    await readInferenceInput(canonical, handoff);
    const result = await readInferenceResult(canonical, handoff);
    return { ...handoff, resolvedOutputEvidence: await mergeInferenceOutputs(handoff, result.submission),
        outputResultHash: result.hash };
}

export async function readBootstrapRecord(root, id) {
    try { return parse(await readBytes(root, id, "bootstrap.json", DIAGNOSTIC_LIMIT)); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

export function bootstrapDiagnosticPath(root, id) {
    validateHandoffId(id);
    return join(root, "speckit-canvas-designer", "handoffs", id, "bootstrap.json");
}

export async function writeBootstrapRecord(root, id, record) {
    assertDiagnosticSize(record);
    const bytes = Buffer.from(JSON.stringify(record), "utf8");
    if (bytes.length > DIAGNOSTIC_LIMIT) throw new Error("Designer bootstrap diagnostics exceed 16 MiB");
    return writeBytes(root, id, "bootstrap.json", bytes, true, DIAGNOSTIC_LIMIT);
}

export async function requireSetupRecord(root, id, hash) {
    const record = parse(await readBytes(root, id, "setup-record.json", 16384));
    if (record?.schemaVersion !== 1 || record.handoffId !== id || record.handoffHash !== hash) {
        throw new BootstrapError("designer_install_required", "Designer setup record does not match this launch; invoke install first.");
    }
}
