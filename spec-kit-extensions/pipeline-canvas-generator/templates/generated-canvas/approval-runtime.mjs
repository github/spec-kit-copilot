// Local UX consent only; this does not replace platform permissions.
import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setupContractFingerprint } from "./setup-runtime.mjs";

const CAP = 16 * 1024;
const writes = new Map();

export function requiresInstallationApproval(setup) {
    if (setup?.installationMode !== undefined) {
        if (!["external", "prompt", "automatic"].includes(setup.installationMode)) {
            throw new Error("Unsupported installation mode");
        }
        return setup.installationMode === "prompt"
            && Boolean(setup.presets?.length || setup.extensions?.length);
    }
    if (setup?.requireInstallationApproval !== undefined && typeof setup.requireInstallationApproval !== "boolean") {
        throw new Error("requireInstallationApproval must be a boolean");
    }
    return setup?.requireInstallationApproval === true
        && Boolean(setup.presets?.length || setup.extensions?.length);
}

export function approvalComponents(setup) {
    return ["preset", "extension"].flatMap((kind) =>
        (setup?.[`${kind}s`] ?? []).map((entry) => ({ ...entry, kind })));
}

export function missingInstallSources(setup, observed) {
    if (!["prompt", "automatic"].includes(setup.installationMode)) return [];
    return observed.filter((entry) => entry.installationState === "missing").filter((entry) => {
        const dependency = setup[`${entry.kind}s`]?.find((item) => item.id === entry.id);
        const address = dependency?.installedSource?.url ?? dependency?.source?.url;
        try {
            const url = new URL(address);
            return url.protocol !== "https:" || Boolean(url.username || url.password);
        } catch {
            return true;
        }
    });
}

async function location({ cwd, extensionId }, create = false) {
    if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(extensionId)) throw new Error("Unsafe approval extension id");
    const workspace = await realpath(resolve(cwd));
    let directory = workspace;
    for (const segment of [".speckit-canvas", "canvas-approvals"]) {
        directory = join(directory, segment);
        if (create) await mkdir(directory).catch((error) => { if (error.code !== "EEXIST") throw error; });
        try {
            const stat = await lstat(directory);
            if (stat.isSymbolicLink() || !stat.isDirectory() || await realpath(directory) !== directory) {
                throw new Error("Unsafe approval metadata directory");
            }
        } catch (error) {
            if (!create && error.code === "ENOENT") return { workspace, missing: true };
            throw error;
        }
    }
    return { workspace, file: join(directory, `${extensionId}.json`), directory };
}

async function recordAt(file) {
    let handle;
    try {
        const stat = await lstat(file);
        if (stat.isSymbolicLink() || !stat.isFile() || stat.size > CAP) throw new Error("Unsafe or oversized approval record");
        handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        const current = await handle.stat();
        if (!current.isFile() || current.size > CAP || current.ino !== stat.ino || current.dev !== stat.dev) {
            throw new Error("Approval record changed during read");
        }
        const bytes = Buffer.alloc(CAP + 1);
        const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
        if (bytesRead > CAP) throw new Error("Oversized approval record");
        const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, bytesRead)));
        if (value?.version !== 1 || typeof value.workspace !== "string" || typeof value.identity !== "string"
            || !/^[a-f0-9]{64}$/.test(value.fingerprint ?? "") || typeof value.approvedAt !== "string"
            || !Number.isFinite(Date.parse(value.approvedAt))
            || Object.keys(value).sort().join() !== "approvedAt,fingerprint,identity,version,workspace") {
            throw new Error("Malformed approval record");
        }
        return value;
    } catch (error) {
        if (error.code === "ENOENT") return null;
        throw new Error(`Cannot read installation approval: ${error.message}`);
    } finally {
        await handle?.close();
    }
}

export async function readInstallationApproval(context) {
    if (!requiresInstallationApproval(context.setup)) return { required: false, approved: true };
    const fingerprint = setupContractFingerprint(context.setup);
    const { workspace, file, missing } = await location(context);
    const record = missing ? null : await recordAt(file);
    return {
        required: true,
        approved: Boolean(record && record.workspace === workspace && record.identity === context.identity
            && record.fingerprint === fingerprint),
        fingerprint,
        components: approvalComponents(context.setup),
    };
}

export async function acceptInstallationApproval(context, fingerprint) {
    if (!requiresInstallationApproval(context.setup) || fingerprint !== setupContractFingerprint(context.setup)) {
        throw new Error("Installation contract changed; review installation again");
    }
    const key = `${resolve(context.cwd)}:${context.extensionId}`;
    const previous = writes.get(key) ?? Promise.resolve();
    const pending = previous.catch(() => {}).then(async () => {
        const { workspace, file, directory } = await location(context, true);
        const existing = await recordAt(file);
        // Two panels may accept together while setup is reading the same record.
        // Avoid replacing identical consent (which can fail on Windows while open).
        if (existing?.workspace === workspace && existing.identity === context.identity
            && existing.fingerprint === fingerprint) return readInstallationApproval(context);
        const temporary = join(directory, `.${context.extensionId}-${randomBytes(12).toString("hex")}.pending`);
        let handle;
        try {
            handle = await open(temporary, "wx", 0o600);
            await handle.writeFile(JSON.stringify({
                version: 1, workspace, identity: context.identity, fingerprint, approvedAt: new Date().toISOString(),
            }), "utf8");
            await handle.sync();
            await handle.close();
            handle = null;
            await location(context);
            await recordAt(file);
            await rename(temporary, file);
        } finally {
            await handle?.close();
            await unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; });
        }
        return readInstallationApproval(context);
    });
    writes.set(key, pending);
    try { return await pending; }
    finally { if (writes.get(key) === pending) writes.delete(key); }
}
