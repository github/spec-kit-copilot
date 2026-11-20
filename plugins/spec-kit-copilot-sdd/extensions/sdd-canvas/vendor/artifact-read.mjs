import { createHash } from "node:crypto";
import { constants } from "node:fs";
import * as filesystem from "node:fs/promises";
import path from "node:path";

export const MAX_ARTIFACT_BYTES = 5_242_880;
export const REVISION_PATTERN = /^sha256:[a-f0-9]{64}$/;

const OUTCOMES = {
    invalid_request: [400, "The review request is invalid.", false],
    forbidden: [403, "This review request is not authorized.", false],
    invalid_context: [404, "Review context is no longer available.", false],
    artifact_unavailable: [404, "This artifact is no longer available.", true],
    changed_source: [409, "The artifact changed. Refresh before continuing.", true],
    artifact_too_large: [413, "This artifact exceeds the 5 MiB limit.", false],
    unsupported_artifact: [415, "This artifact cannot be reviewed.", false],
    invalid_encoding: [422, "This artifact is not valid UTF-8 text.", false],
    read_failed: [500, "The artifact could not be read.", true],
    workspace_unavailable: [503, "The review workspace is unavailable.", true],
};

export class ArtifactReadError extends Error {
    constructor(code) {
        const outcome = OUTCOMES[code] ?? OUTCOMES.read_failed;
        super(outcome[1]);
        this.name = "ArtifactReadError";
        this.code = Object.hasOwn(OUTCOMES, code) ? code : "read_failed";
        this.status = outcome[0];
        this.retryable = outcome[2];
    }
}

export function validateArtifactPath(relativePath) {
    if (typeof relativePath !== "string" || !relativePath || relativePath.length > 2048 ||
        /[\x00-\x1f\x7f\\:<>"|?*]/.test(relativePath) || relativePath.startsWith("/") ||
        /%(?:0[0-9a-f]|1[0-9a-f]|2e|2f|3a|5c|7f|25)/i.test(relativePath)) {
        throw new ArtifactReadError("unsupported_artifact");
    }
    const parts = relativePath.split("/");
    if (parts.some((part) => !part || part === "." || part === ".." || /^\.git$/i.test(part) ||
        /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3]|conin\$|conout\$)$/i.test(part.split(".")[0].trimEnd()))) {
        throw new ArtifactReadError("unsupported_artifact");
    }
    const suffix = path.posix.extname(relativePath).toLowerCase();
    if (suffix !== ".md" && suffix !== ".markdown") throw new ArtifactReadError("unsupported_artifact");
    return { relativePath, suffix, parts };
}

function samePath(first, second) {
    return process.platform === "win32"
        ? first.toLowerCase() === second.toLowerCase()
        : first === second;
}

function contained(root, target) {
    const relative = path.relative(root, target);
    return relative && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

function sameFile(first, second) {
    return ["dev", "ino", "mode", "nlink", "size", "mtimeNs"].every((key) => first[key] === second[key]);
}

function mappedError(error) {
    if (error instanceof ArtifactReadError) return error;
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return new ArtifactReadError("artifact_unavailable");
    if (error?.code === "ELOOP") return new ArtifactReadError("unsupported_artifact");
    return new ArtifactReadError("read_failed");
}

async function validatedFile(workspacePath, relativePath, fs) {
    const validated = validateArtifactPath(relativePath);
    if (typeof workspacePath !== "string" || !path.isAbsolute(workspacePath)) {
        throw new ArtifactReadError("workspace_unavailable");
    }
    let root;
    try {
        const rootStat = await fs.lstat(workspacePath);
        if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("invalid root");
        root = await fs.realpath(workspacePath);
    } catch {
        throw new ArtifactReadError("workspace_unavailable");
    }
    const target = path.resolve(root, ...validated.parts);
    if (!contained(root, target)) throw new ArtifactReadError("unsupported_artifact");
    let current = root;
    let stat;
    for (const [index, part] of validated.parts.entries()) {
        current = path.join(current, part);
        stat = await fs.lstat(current, { bigint: true });
        if (stat.isSymbolicLink() || (index < validated.parts.length - 1 ? !stat.isDirectory() : !stat.isFile())) {
            throw new ArtifactReadError("unsupported_artifact");
        }
        const canonical = await fs.realpath(current);
        if (!contained(root, canonical) || !samePath(current, canonical)) {
            throw new ArtifactReadError("unsupported_artifact");
        }
    }
    return { root, target, stat, ...validated };
}

export async function inspectArtifact(workspacePath, relativePath, { fs = filesystem } = {}) {
    try {
        const file = await validatedFile(workspacePath, relativePath, fs);
        return {
            relativePath: file.relativePath,
            suffix: file.suffix,
            byteSize: Number(file.stat.size),
            modifiedAt: file.stat.mtime.toISOString(),
        };
    } catch (error) {
        throw mappedError(error);
    }
}

export async function readArtifact(workspacePath, relativePath, { expectedRevision, fs = filesystem } = {}) {
    if (expectedRevision !== undefined && !REVISION_PATTERN.test(expectedRevision)) {
        throw new ArtifactReadError("invalid_request");
    }
    let handle;
    try {
        const file = await validatedFile(workspacePath, relativePath, fs);
        if (file.stat.size > BigInt(MAX_ARTIFACT_BYTES)) throw new ArtifactReadError("artifact_too_large");
        handle = await fs.open(file.target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
        const before = await handle.stat({ bigint: true });
        if (!before.isFile() || !sameFile(file.stat, before)) throw new ArtifactReadError("changed_source");
        const buffer = Buffer.allocUnsafe(MAX_ARTIFACT_BYTES + 1);
        let byteSize = 0;
        while (byteSize <= MAX_ARTIFACT_BYTES) {
            const length = Math.min(65_536, buffer.length - byteSize);
            const { bytesRead } = await handle.read(buffer, byteSize, length, byteSize);
            if (bytesRead === 0) break;
            byteSize += bytesRead;
            if (byteSize > MAX_ARTIFACT_BYTES) throw new ArtifactReadError("artifact_too_large");
        }
        const after = await handle.stat({ bigint: true });
        let current;
        try {
            current = await validatedFile(workspacePath, relativePath, fs);
        } catch {
            throw new ArtifactReadError("changed_source");
        }
        if (!samePath(file.root, current.root) || !sameFile(before, after) || before.ctimeNs !== after.ctimeNs ||
            !sameFile(after, current.stat) || BigInt(byteSize) !== after.size) {
            throw new ArtifactReadError("changed_source");
        }
        const bytes = buffer.subarray(0, byteSize);
        const revision = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
        if (expectedRevision !== undefined && revision !== expectedRevision) throw new ArtifactReadError("changed_source");
        let content;
        try {
            content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        } catch {
            throw new ArtifactReadError("invalid_encoding");
        }
        if (content.includes("\0")) throw new ArtifactReadError("invalid_encoding");
        return { content, revision, byteSize, modifiedAt: after.mtime.toISOString(), sourceKind: "working-tree" };
    } catch (error) {
        throw mappedError(error);
    } finally {
        if (handle) {
            try { await handle.close(); }
            catch { throw new ArtifactReadError("read_failed"); }
        }
    }
}
