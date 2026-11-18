import { constants } from "node:fs";
import { lstat, open, opendir, realpath, readdir, mkdir, mkdtemp, rename, rm, rmdir, unlink } from "node:fs/promises";
import { resolve, relative, isAbsolute, dirname, join, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

export class UserError extends Error {
    constructor(message, status = 400) { super(message); this.status = status; }
}
export const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const isWindowsDeviceName = (name) =>
    /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name);
export function safePath(value, template = false) {
    if (typeof value !== "string" || !value || value.length > 2048) throw new UserError("Invalid artifact path.");
    const parts = value.replaceAll("\\", "/").split("/");
    if (parts.some((part) => !part || part === "." || part === ".."
        || (!(template && ["<slug>", "<name>.md"].includes(part)) && /[<>:"|?*\x00-\x1f]/.test(part))
        || /[. ]$/.test(part) || isWindowsDeviceName(part))) {
        throw new UserError("This path is outside the supported artifact locations.");
    }
    return parts.join("/");
}

export async function confined(root, path, { createDirectories = false } = {}) {
    root = await realpath(root);
    let target = root;
    for (const part of safePath(path).split("/")) {
        target = resolve(target, part);
        if (createDirectories) {
            try { await mkdir(target); } catch (error) { if (error.code !== "EEXIST") throw error; }
        }
        const info = await lstat(target);
        const actual = await realpath(target);
        const rel = relative(root, actual);
        if (info.isSymbolicLink() || rel.startsWith("..") || isAbsolute(rel) || relative(target, actual)) {
            throw new UserError("This path contains a link or leaves the current checkout.");
        }
    }
    return target;
}

async function readBoundedFile(root, path, cap) {
    const target = await confined(root, path);
    const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
        const before = await handle.stat();
        if (!before.isFile() || before.size > cap) throw new UserError("Artifact is unavailable or exceeds the 512 KiB limit.", 413);
        const buffer = Buffer.alloc(cap + 1);
        let size = 0;
        while (size < buffer.length) {
            const result = await handle.read(buffer, size, buffer.length - size, size);
            if (!result.bytesRead) break;
            size += result.bytesRead;
        }
        const after = await lstat(await confined(root, path));
        if (size > cap) throw new UserError("Artifact exceeds the supported size limit.", 413);
        if (before.ino !== after.ino || before.dev !== after.dev || before.mtimeMs !== after.mtimeMs
            || before.size !== after.size || before.size !== size) {
            throw new UserError("Artifact changed while reading. Refresh to try again.", 409);
        }
        return { bytes: buffer.subarray(0, size), mtimeMs: before.mtimeMs };
    } finally { await handle.close(); }
}

export async function readBoundedBytes(root, path, cap = 512 * 1024) {
    return (await readBoundedFile(root, path, cap)).bytes;
}

export async function readBounded(root, path, cap = 512 * 1024) {
    return new TextDecoder("utf-8", { fatal: true })
        .decode(await readBoundedBytes(root, path, cap));
}

export async function readBoundedWithMetadata(root, path, cap = 512 * 1024) {
    const { bytes, mtimeMs } = await readBoundedFile(root, path, cap);
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), mtimeMs };
}

export async function readRegularFileMetadata(root, path) {
    const target = await confined(root, path);
    const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
        const before = await handle.stat();
        if (!before.isFile()) throw new UserError("The selected output is not a regular file.");
        const after = await lstat(await confined(root, path));
        if (!after.isFile() || before.dev !== after.dev || before.ino !== after.ino
            || before.mtimeMs !== after.mtimeMs || before.size !== after.size) {
            throw new UserError("Artifact changed while reading. Refresh to try again.", 409);
        }
        return { mtimeMs: before.mtimeMs };
    } finally { await handle.close(); }
}

export async function directories(root, path) {
    try {
        const entries = await readdir(await confined(root, path), { withFileTypes: true });
        const result = [];
        for (const entry of entries) {
            if (entry.isDirectory() && !entry.isSymbolicLink() && slugPattern.test(entry.name)) {
                await confined(root, `${path}/${entry.name}`);
                result.push(entry.name);
            }

        }
        return result.sort();
    } catch (error) {
        if (error.code === "ENOENT") return [];
        throw error;
    }
}

export async function countMarkdownDirectory(root, path) {
    const parent = path === "." ? "." : safePath(path);
    const checkout = await realpath(root);
    let folder;
    try {
        folder = parent === "." ? checkout : await confined(checkout, parent);
    } catch (error) {
        if (error.code === "ENOENT") return 0;
        throw error;
    }
    const before = await lstat(folder);
    if (!before.isDirectory()) throw new UserError("The selected output folder is not a directory.");
    let seen = 0;
    let count = 0;
    for await (const entry of await opendir(folder)) {
        if (++seen > 1000) throw new UserError("The selected output folder exceeds the 1000-entry badge limit.");
        if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) count++;
    }
    const current = parent === "." ? await realpath(root) : await confined(root, parent);
    const after = await lstat(current);
    if (folder !== current || before.dev !== after.dev || before.ino !== after.ino
        || before.mtimeMs !== after.mtimeMs) {
        throw new UserError("The selected output folder changed while counting. Refresh to retry.", 409);
    }
    return count;
}

export async function deleteConfinedDirectory(root, path, move = rename) {
    const checkout = await realpath(root);
    const parentPath = dirname(safePath(path)).replaceAll("\\", "/");
    const parent = await confined(checkout, parentPath);
    const target = await confined(checkout, path);
    const parentBefore = await lstat(parent);
    const targetBefore = await lstat(target);
    if (!targetBefore.isDirectory()) throw new UserError("Workflow directory is unavailable.", 404);
    const same = (a, b) => a.dev === b.dev && a.ino === b.ino;
    let entries = 0;
    async function inspect(directory, depth) {
        if (depth > 16) throw new UserError("Workflow directory is too deep to delete safely.");
        for (const entry of await readdir(await confined(checkout, directory), { withFileTypes: true })) {
            if (++entries > 20000) throw new UserError("Workflow directory is too large to delete safely.");
            const child = `${directory}/${entry.name}`;
            if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) {
                throw new UserError("Workflow directory contains a link or unsupported file. Remove it manually before deleting.");
            }
            await confined(checkout, child);
            if (entry.isDirectory()) await inspect(child, depth + 1);
        }
    }
    async function checkParent() {
        const current = await confined(checkout, parentPath);
        if (current !== parent || !same(parentBefore, await lstat(current))) {
            throw new UserError("Workflow parent changed while deleting. Nothing was deleted.", 409);
        }
    }
    await inspect(path, 0);
    const staging = await mkdtemp(join(checkout, ".speckit-delete-"));
    const staged = join(staging, "workflow");
    let moved = false;
    try {
        await checkParent();
        if (!same(targetBefore, await lstat(await confined(checkout, path)))) {
            throw new UserError("Workflow directory changed while deleting. Nothing was deleted.", 409);
        }
        await move(target, staged);
        moved = true;
        await checkParent();
        if (!same(targetBefore, await lstat(await confined(checkout, `${basename(staging)}/workflow`)))) {
            throw new UserError("Workflow directory changed while deleting.", 409);
        }
        entries = 0;
        await inspect(`${basename(staging)}/workflow`, 0);
        await checkParent();
        if (!same(targetBefore, await lstat(await confined(checkout, `${basename(staging)}/workflow`)))) {
            throw new UserError("Workflow directory changed while deleting.", 409);
        }
        await rm(staged, { recursive: true });
        moved = false;
    } catch (error) {
        if (moved) {
            throw new UserError(`Deletion stopped; the moved directory is retained at ${staged} for recovery: ${error.message}`, 409);
        }
        throw error;
    } finally {
        if (!moved) await rmdir(staging);
    }
}

export async function atomicJson(root, path, data) {
    const directory = await confined(root, dirname(path).replaceAll("\\", "/"), { createDirectories: true });
    const target = join(directory, path.split("/").at(-1));
    try { await confined(root, path); } catch (error) { if (error.code !== "ENOENT") throw error; }
    const temporary = join(directory, `${randomUUID()}.tmp`);
    try {
        const handle = await open(temporary, "wx", 0o600);
        try { await handle.writeFile(JSON.stringify(data)); } finally { await handle.close(); }
        for (let attempt = 0; ; attempt++) {
            try { await rename(temporary, target); break; }
            catch (error) {
                // Windows can briefly lock the destination while another reader has it open.
                if (process.platform !== "win32" || !["EPERM", "EACCES", "EBUSY"].includes(error.code)
                    || attempt === 4) throw error;
                await delay(25 * (attempt + 1));
            }
        }
    } finally {
        try { await unlink(temporary); } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
}
