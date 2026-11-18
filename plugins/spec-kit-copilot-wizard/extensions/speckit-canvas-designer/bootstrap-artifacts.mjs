import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, realpath, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { HANDOFF_LIMIT, validateHandoff, validateHandoffId } from "./handoff.mjs";
import { assertDiagnosticSize, BootstrapError, bootstrapSessionContext, DIAGNOSTIC_LIMIT,
    validateLaunchReference } from "./contracts/bootstrap.mjs";

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

async function writeBytes(root, id, name, bytes, replace = false) {
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
                const current = await readBytes(root, id, name, HANDOFF_LIMIT);
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

export async function stageDesignerHandoff(session, handoff) {
    const context = await bootstrapSessionContext(session);
    validateHandoff(handoff, handoff.handoffId);
    const bytes = Buffer.from(JSON.stringify(handoff), "utf8");
    if (bytes.length > HANDOFF_LIMIT) throw new Error("Designer handoff exceeds 64KB");
    const reference = validateLaunchReference({ sourceSessionId: context.sessionId,
        sourceRoot: await realpath(context.root), handoffId: handoff.handoffId,
        sha256: createHash("sha256").update(bytes).digest("hex") });
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
    if (createHash("sha256").update(bytes).digest("hex") !== reference.sha256) {
        throw new Error("Designer handoff bytes changed; stop and relaunch.");
    }
    validateHandoff(parse(bytes), reference.handoffId);
    await writeBytes(context.root, reference.handoffId, "handoff.json", bytes);
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
    return writeBytes(root, id, "bootstrap.json", bytes, true);
}

export async function requireSetupRecord(root, id, hash) {
    const record = parse(await readBytes(root, id, "setup-record.json", 16384));
    if (record?.schemaVersion !== 1 || record.handoffId !== id || record.handoffHash !== hash) {
        throw new BootstrapError("designer_install_required", "Designer setup record does not match this launch; invoke install first.");
    }
}
