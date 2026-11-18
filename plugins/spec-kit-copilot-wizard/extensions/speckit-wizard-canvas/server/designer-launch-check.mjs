import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { HANDOFF_LIMIT, readHandoff, validateHandoffId } from "../../speckit-canvas-designer/handoff.mjs";
import { specifySpawnOptions } from "../env/specify-invocation.mjs";
import { readDesignerContract, validateLocalSource, verifyHostedWorkflowRegistrations } from "./designer-local-sources.mjs";
import designerCompatibility from "../../speckit-canvas-designer/external-designer-contract.json" with { type: "json" };

const exec = promisify(execFile);
const manifestName = { presets: "preset.yml", extensions: "extension.yml" };

function localEntries(handoff) {
    return Object.entries(manifestName).flatMap(([kind]) =>
        (handoff.localSelections?.[kind] ?? []).map((entry) => ({ ...entry, kind })));
}

export async function prepareHandoff(sessionRoot, handoffId, expectedHash) {
    validateHandoffId(handoffId);
    if (!/^[a-f0-9]{64}$/.test(expectedHash)) throw new Error("Invalid Designer handoff hash.");
    const root = await realpath(sessionRoot);
    const folder = join(root, "speckit-canvas-designer", "handoffs", handoffId);
    const actual = await realpath(folder);
    const rel = relative(root, actual);
    if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || actual !== folder) {
        throw new Error("Designer handoff escapes session artifacts");
    }
    const path = join(folder, "handoff.json");
    const file = await open(path, constants.O_RDWR
        | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    try {
        const [stat, pathStat, currentFolder] = await Promise.all([
            file.stat(), lstat(path), realpath(folder),
        ]);
        if (currentFolder !== folder || !stat.isFile() || !pathStat.isFile()
            || pathStat.isSymbolicLink() || stat.dev !== pathStat.dev || stat.ino !== pathStat.ino
            || stat.size > HANDOFF_LIMIT + 2) {
            throw new Error("Invalid Designer handoff file");
        }
        const buffer = Buffer.alloc(HANDOFF_LIMIT + 3);
        let length = 0;
        while (length < buffer.length) {
            const { bytesRead } = await file.read(buffer, length, buffer.length - length, length);
            if (!bytesRead) break;
            length += bytesRead;
        }
        const digest = (value) => createHash("sha256").update(value).digest("hex");
        if (length > HANDOFF_LIMIT + 2) throw new Error("Invalid Designer handoff file");
        const bytes = buffer.subarray(0, length);
        if (digest(bytes) !== expectedHash) {
            const suffixLength = bytes.subarray(-2).equals(Buffer.from("\r\n")) ? 2
                : bytes.at(-1) === 10 ? 1 : 0;
            if (!suffixLength || digest(bytes.subarray(0, -suffixLength)) !== expectedHash) {
                throw new Error("Designer handoff bytes changed; stop and relaunch.");
            }
            await file.truncate(bytes.length - suffixLength);
        }
    } finally {
        await file.close();
    }
    await readHandoff(root, handoffId, undefined, expectedHash);
    return { handoffPath: path };
}

export async function preflight(project, sessionRoot, handoffId, expectedHash, run = exec) {
    const child = await realpath(project);
    const root = await realpath(sessionRoot);
    if (child === root || !/^[a-f0-9]{64}$/.test(expectedHash)) {
        throw new Error("Invalid child checkout, session root, or handoff hash.");
    }
    const handoff = await readHandoff(root, handoffId, undefined, expectedHash);
    const path = join(root, "speckit-canvas-designer", "handoffs", handoffId, "handoff.json");
    const { stdout } = await run(process.platform === "win32" ? "specify.exe" : "specify",
        ["--version"], await specifySpawnOptions(child, { timeout: 10000, maxBuffer: 4096 }));
    const version = stdout.match(/\bspecify\s+(\d+)\.(\d+)\.(\d+)\b/);
    if (!version || Number(version[1]) < 1
        || (Number(version[1]) === 1 && Number(version[2]) === 0 && Number(version[3]) < 7)) {
        throw new Error("Designer launch requires Specify CLI >=1.0.7.");
    }
    const setup = join(child, ".specify");
    let initialized = false;
    try {
        initialized = (await lstat(setup)).isDirectory();
        if (!initialized) throw new Error(`Child setup is not a directory: ${setup}`);
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    const locals = [];
    for (const entry of localEntries(handoff)) {
        const checked = await validateLocalSource(entry.kind, entry.path);
        if (checked.id !== entry.id || checked.path !== entry.path) {
            throw new Error(`Approved local ${entry.kind} ${entry.id} changed path or manifest.`);
        }
        if (entry.kind === "extensions" && entry.id === "extension-canvas-design"
            && !designerCompatibility.supportedVersions.includes(await readDesignerContract(entry.path))) {
            throw new Error("Local Canvas Design contract is incompatible with this Designer.");
        }
        locals.push({ kind: entry.kind, id: entry.id, path: checked.path });
    }
    return { checkout: child, sessionRoot: root, handoffPath: path,
        initialized, specifyVersion: version[0], locals };
}

export async function verifyLocalInstall(project, handoff, kind, id, run = exec) {
    if (!manifestName[kind] || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(id)) {
        throw new Error("Invalid local package verification request.");
    }
    const entry = handoff.localSelections?.[kind]?.find((item) => item.id === id);
    if (!entry) throw new Error(`Local ${kind} ${id} was not approved in the handoff.`);
    const source = await validateLocalSource(kind, entry.path);
    if (source.path !== entry.path || source.id !== id) {
        throw new Error(`Approved local ${kind} ${id} has a different path or manifest id.`);
    }
    const child = await realpath(project);
    const installedPath = join(child, ".specify", kind, id);
    const installed = await validateLocalSource(kind, installedPath);
    const installedRel = relative(join(child, ".specify"), installedPath);
    if (installed.id !== id || installedRel.startsWith("..") || resolve(installedPath) !== installedPath
        || (installed.path !== installedPath && installed.path !== source.path)) {
        throw new Error(`Installed local ${kind} ${id} has an unexpected path or manifest id.`);
    }
    const { stdout } = await run(process.platform === "win32" ? "specify.exe" : "specify",
        [kind === "presets" ? "preset" : "extension", "list", "--json"],
        await specifySpawnOptions(child, { timeout: 10000, maxBuffer: 128 * 1024 }));
    const inventory = JSON.parse(stdout);
    const actual = inventory.find((item) => item.id === id);
    if (!actual || actual.source?.kind !== "local") {
        throw new Error(`Installed local ${kind} ${id} is missing or is not a local installation.`);
    }
    if (id === "extension-canvas-design"
        && (!designerCompatibility.supportedVersions.includes(await readDesignerContract(installedPath))
            || !designerCompatibility.supportedVersions.includes(await readDesignerContract(entry.path)))) {
        throw new Error("Installed local Canvas Design contract is incompatible with this Designer.");
    }
    return { kind, id, source: source.path, installed: installed.path };
}

export async function verifyHostedCanvasDesign(project, handoff, run = exec) {
    const base = handoff.canvasDesign;
    if (!base) throw new Error("Canvas Design handoff has no approved catalog entry.");
    const child = await realpath(project);
    const path = join(child, ".specify", "extensions", "extension-canvas-design");
    const installed = await validateLocalSource("extensions", path);
    if (installed.id !== "extension-canvas-design") {
        throw new Error("Installed Canvas Design ID differs from the approved catalog.");
    }
    const contract = await readDesignerContract(path);
    if (!designerCompatibility.supportedVersions.includes(contract)) {
        throw new Error(`Installed Canvas Design contract ${contract} is not supported by this Designer.`);
    }
    await verifyHostedWorkflowRegistrations(path);
    const { stdout } = await run(process.platform === "win32" ? "specify.exe" : "specify",
        ["extension", "list", "--json"],
        await specifySpawnOptions(child, { timeout: 10000, maxBuffer: 128 * 1024 }));
    const entry = JSON.parse(stdout).find((item) => item.id === installed.id);
    if (entry?.id !== installed.id || !["local", "catalog"].includes(entry.source?.kind)) {
        throw new Error("Installed Canvas Design source or ID differs from the approved handoff.");
    }
    if (entry.version !== installed.version) {
        throw new Error("Installed Canvas Design manifest and inventory versions disagree.");
    }
    return { id: installed.id, version: installed.version, designerContract: contract,
        warnings: installed.version === base.version ? [] :
            [`Canvas Design version drift: approved ${base.version}, installed ${installed.version}.`] };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const [, , mode, project, root, handoffId, ...rest] = process.argv;
        const result = mode === "prepare"
            ? await prepareHandoff(root, handoffId, rest[0])
            : mode === "preflight"
                ? await preflight(project, root, handoffId, rest[0])
            : mode === "verify-local"
                ? await verifyLocalInstall(project, await readHandoff(root, handoffId),
                    rest[0], rest[1])
                : mode === "verify-base"
                    ? await verifyHostedCanvasDesign(project, await readHandoff(root, handoffId))
                : (() => { throw new Error("Expected prepare, preflight, verify-local, or verify-base mode."); })();
        console.log(JSON.stringify(result));
    } catch (error) {
        console.error(`Designer launch verification failed: ${error.message}`);
        process.exitCode = 1;
    }
}
