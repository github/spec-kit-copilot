import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, readdir, rename, unlink } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { effectivePipelinePhases, stripCommandsPrefix } from "./pipeline/effective-phases.mjs";
import { parseCommandFile } from "./composition/preset-loader.mjs";
import { CORE_OUTPUTS } from "./pipeline/canonical.mjs";
import { PHASE_ORDER } from "./canvas-runtime/wizard-phases.mjs";
import { activeChainForArtifact } from "./pipeline/active-artifacts.mjs";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const SOURCE_LIMIT = 512 * 1024;
export const commandId = (id) => stripCommandsPrefix(
    typeof id === "string" ? id.replace(/^command:/, "") : id);
const validId = (id) => typeof id === "string" && /^[\w.-]{1,100}$/.test(id);

export function artifactPath(value, kind = "file") {
    if (typeof value !== "string" || value.length > 1000) return null;
    const path = value.replaceAll("\\", "/");
    if (kind === "folder" && !path) return "";
    const parts = (kind === "folder" ? path.replace(/\/$/, "") : path).split("/");
    if ((kind === "file" && !path.endsWith(".md"))
        || parts.some((part) => !part || part === "." || part === ".." || /[. ]$/.test(part)
            || (part !== "<slug>" && /[<>:"|?*\x00-\x1f\x7f]/.test(part))
            || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(part))
        || parts.filter((part) => part === "<slug>").length > 1 || parts[0] === "<slug>"
        || [".git", ".github", "node_modules", ".speckit-wizard"].includes(parts[0].toLowerCase())
        || /^\.specify\/(extensions|presets|templates)\//i.test(path)) return null;
    return kind === "folder" ? `${parts.join("/")}/` : path;
}

export function pathEvidence(path, source) {
    if (typeof path !== "string") return null;
    const portable = path.replaceAll("\\", "/");
    const variableFile = portable.endsWith("/<name>.md");
    const kind = portable.endsWith("/") || variableFile ? "folder" : "file";
    const safe = artifactPath(variableFile ? portable.slice(0, -9) : portable, kind);
    return safe === null ? null : { kind, path: safe, source, effect: "unknown" };
}

export function validateCandidates(value, { inference = false } = {}) {
    if (!Array.isArray(value) || value.length > 12) throw new Error("Invalid artifact evidence candidates");
    return value.map((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)
            || Object.keys(item).some((key) => !["kind", "path", "relativeTo", "root", "source", "effect", "evidence", "contributors"].includes(key))
            || !["file", "folder", "none", "unknown"].includes(item.kind)
            || !["manual", "declaration", "inference", "core", "observed"].includes(item.source)
            || (inference && item.source !== "inference")
            || !["creates", "updates", "unknown"].includes(item.effect)) throw new Error("Invalid artifact evidence candidate");
        const result = { kind: item.kind, source: item.source, effect: item.effect };
        if (["file", "folder"].includes(item.kind)) {
            result.path = artifactPath(item.path, item.kind);
            if (result.path === null) throw new Error("Unsafe artifact evidence path");
        } else if (item.path != null) throw new Error("Non-file evidence cannot declare a path");
        if (item.relativeTo !== undefined) {
            if (item.relativeTo !== "feature" || !result.path || item.source !== "inference"
                || result.path.includes("<slug>") || item.root !== undefined) throw new Error("Invalid feature-relative artifact evidence");
            result.relativeTo = "feature";
        }
        if (item.root !== undefined) {
            const root = item.root;
            if (!result.path || item.source !== "inference" || item.relativeTo !== undefined
                || result.path.includes("<slug>") || !root || typeof root !== "object" || Array.isArray(root)
                || Object.keys(root).some((key) => !["name", "path"].includes(key))
                || typeof root.name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(root.name)) {
                throw new Error("Invalid named output root");
            }
            const path = root.path === undefined ? null : artifactPath(root.path, "folder");
            if (root.path !== undefined && (!path || path.split("/").filter((part) => part === "<slug>").length > 1)) {
                throw new Error("Unsafe named output root path");
            }
            result.root = { name: root.name, ...(path ? { path: path.slice(0, -1) } : {}) };
        }
        if (item.evidence !== undefined) {
            if (typeof item.evidence !== "string" || !item.evidence.trim() || item.evidence.length > 500
                || /[\x00-\x1f\x7f]/.test(item.evidence)) throw new Error("Invalid artifact supporting evidence");
            result.evidence = item.evidence;
        }
        if (inference && !result.evidence) throw new Error("Artifact inference requires supporting evidence");
        if (item.contributors !== undefined) {
            if (!["file", "folder"].includes(item.kind) || !Array.isArray(item.contributors)
                || item.contributors.length < 1 || item.contributors.length > 6
                || item.contributors.some((contributor) => !contributor
                    || typeof contributor !== "object" || Array.isArray(contributor)
                    || Object.keys(contributor).some((key) => !["layer", "id"].includes(key))
                    || !["core", "preset", "extension"].includes(contributor.layer)
                    || (contributor.id !== undefined && (contributor.layer === "core"
                        || !validId(contributor.id))))) throw new Error("Invalid contributors");
            result.contributors = item.contributors.map(({ layer, id }) => ({ layer, ...(id ? { id } : {}) }));
            if (new Set(result.contributors.map(({ layer, id }) => `${layer}:${id ?? ""}`)).size !== result.contributors.length) {
                throw new Error("Duplicate contributors");
            }
        }
        return result;
    });
}

export function validatePrimaryIndex(value, candidates) {
    if (value === undefined || value === null) return value;
    if (!Number.isInteger(value) || value < 0 || candidates[value]?.kind !== "file") {
        throw new Error("Artifact primary must reference a file candidate");
    }
    return value;
}

export function normalizeInferredEvidence(candidates, primaryIndex) {
    const unique = [], indexes = new Map();
    let selected = primaryIndex;
    for (const [index, candidate] of candidates.entries()) {
        const key = ["file", "folder"].includes(candidate.kind)
            ? `${candidate.kind}:${candidate.root?.name ?? candidate.relativeTo ?? "repo"}:${candidate.root?.path ?? ""}:${candidate.path}` : null;
        if (key === null || !indexes.has(key)) {
            if (key !== null) indexes.set(key, unique.length);
            if (index === primaryIndex) selected = unique.length;
            unique.push(candidate);
        } else {
            const target = indexes.get(key);
            unique[target] = { ...unique[target],
                effect: unique[target].effect === candidate.effect ? candidate.effect : "unknown",
                ...(candidate.contributors || unique[target].contributors ? {
                    contributors: [...new Map([...(unique[target].contributors ?? []),
                        ...(candidate.contributors ?? [])].map((item) =>
                        [`${item.layer}:${item.id ?? ""}`, item])).values()],
                } : {}) };
            if (index === primaryIndex) selected = target;
        }
    }
    return { candidates: unique, primaryIndex: selected };
}

async function readBounded(path, { invalid, oversized, linked = invalid, openFile = open }) {
    let file;
    try {
        file = await openFile(path, constants.O_RDONLY
            | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    } catch (error) {
        if (error.code === "ELOOP") throw new Error(linked, { cause: error });
        throw error;
    }
    try {
        const [stat, pathStat, parent] = await Promise.all([
            file.stat(), lstat(path), realpath(dirname(path)),
        ]);
        if (resolve(parent) !== resolve(dirname(path))
            || !stat.isFile() || !pathStat.isFile() || pathStat.isSymbolicLink()
            || stat.dev !== pathStat.dev || stat.ino !== pathStat.ino
            || stat.size > SOURCE_LIMIT) throw new Error(invalid);
        const bytes = Buffer.alloc(SOURCE_LIMIT + 1);
        let length = 0;
        while (length < bytes.length) {
            const { bytesRead } = await file.read(bytes, length, bytes.length - length, length);
            if (!bytesRead) break;
            length += bytesRead;
        }
        if (length > SOURCE_LIMIT) throw new Error(oversized);
        return bytes.toString("utf8", 0, length);
    } finally {
        await file.close();
    }
}

async function sourceFile(cwd, path, openFile = open) {
    if (typeof path !== "string" || !/^(?:\.github\/skills\/|\.specify\/scripts\/)/.test(path)
        || path.split("/").some((part) => !part || part === "." || part === "..")
        || /[\\<>:"|?*\x00-\x1f\x7f]/.test(path)) throw new Error("Unsafe artifact evidence source");
    const root = await realpath(cwd);
    let current = root;
    for (const part of path.split("/")) {
        current = join(current, part);
        try {
            const stat = await lstat(current);
            if (stat.isSymbolicLink()) throw new Error("Linked artifact evidence source");
        } catch (error) {
            if (error.code === "ENOENT") return null;
            throw error;
        }
    }
    const actual = await realpath(current);
    if (resolve(actual) !== resolve(current) || relative(root, actual).startsWith("..")) {
        throw new Error("Artifact evidence source escapes checkout");
    }
    const text = await readBounded(actual, { invalid: "Invalid artifact evidence source",
        oversized: "Oversized artifact evidence source", linked: "Linked artifact evidence source", openFile });
    return { path, text, sha256: digest(text) };
}

export async function effectiveSource(cwd, id, openFile = open) {
    if (!validId(id)) throw new Error("Invalid evidence command ID");
    const full = id.startsWith("speckit.") ? id : `speckit.${id}`;
    const skillPath = `.github/skills/${full.replaceAll(".", "-")}/SKILL.md`;
    const skill = await sourceFile(cwd, skillPath, openFile);
    if (!skill) return null;
    const paths = new Set(skill.text.match(/\.specify\/scripts\/[\w./-]+\.(?:ps1|sh|py)\b/g) ?? []);
    for (const path of [...paths]) {
        if (path.endsWith(".ps1")) paths.add(`${dirname(path).replaceAll("\\", "/")}/common.ps1`);
        if (path.endsWith(".sh")) paths.add(`${dirname(path).replaceAll("\\", "/")}/common.sh`);
    }
    if (paths.size > 24) throw new Error("Too many script dependencies");
    const files = [skill];
    for (const path of [...paths].sort()) {
        files.push(await sourceFile(cwd, path, openFile) ?? { path, sha256: null });
    }
    const sources = files.map(({ path, sha256 }) => ({ path, sha256 }));
    return { skillPath, skillText: skill.text, sources,
        fingerprint: digest(JSON.stringify({ version: 1, sources })) };
}

export async function readEvidenceCache(cwd, openFile = open) {
    const root = await realpath(cwd);
    const directory = join(root, ".speckit-wizard");
    const path = join(directory, "artifact-targets.json");
    try {
        const parent = await lstat(directory);
        if (!parent.isDirectory() || parent.isSymbolicLink()
            || resolve(await realpath(directory)) !== resolve(directory)) throw new Error("Linked artifact cache directory");
        const text = await readBounded(path, { invalid: "Unsafe artifact cache",
            oversized: "Unsafe artifact cache", openFile });
        const cache = JSON.parse(text);
        if (!cache || !cache.entries || typeof cache.entries !== "object" || Array.isArray(cache.entries)) {
            throw new Error("Invalid artifact cache");
        }
        return cache;
    } catch (error) {
        if (error.code === "ENOENT") return { version: 1, entries: {} };
        throw error;
    }
}

// Owned callers supply a synchronous commitFile(temp, target); ordinary
// scanner writes retain the asynchronous atomic rename.
export async function writeEvidenceCache(cwd, payload, renameFile = rename, commitFile) {
    const root = await realpath(cwd);
    const directory = join(root, ".speckit-wizard");
    await mkdir(directory, { recursive: true });
    const initial = await lstat(directory);
    const sameDirectory = async () => {
        const current = await lstat(directory);
        return current.isDirectory() && !current.isSymbolicLink()
            && current.dev === initial.dev && current.ino === initial.ino
            && resolve(await realpath(directory)) === resolve(directory);
    };
    if (!await sameDirectory()) throw new Error("Unsafe artifact cache directory");
    const temp = join(directory, `.artifact-targets.${randomUUID()}.tmp`);
    const target = join(directory, "artifact-targets.json");
    let opened;
    try {
        const file = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
            | (constants.O_NOFOLLOW ?? 0), 0o600);
        try {
            opened = await file.stat();
            await file.writeFile(payload, "utf8");
        } finally {
            await file.close();
        }
        const current = await lstat(temp);
        if (!await sameDirectory() || !opened.isFile() || !current.isFile() || current.isSymbolicLink()
            || opened.dev !== current.dev || opened.ino !== current.ino) {
            throw new Error("Unsafe artifact cache temporary file");
        }
        if (commitFile) commitFile(temp, target);
        else await renameFile(temp, target);
    } catch (error) {
        if (opened) {
            try {
                if (await sameDirectory()) {
                    const current = await lstat(temp);
                    if (current.isFile() && !current.isSymbolicLink()
                        && opened.dev === current.dev && opened.ino === current.ino) await unlink(temp);
                }
            } catch (cleanupError) {
                if (cleanupError.code !== "ENOENT") {
                    console.warn(`Artifact cache temporary cleanup failed: ${cleanupError.message}`);
                }
            }
        }
        throw error;
    }
}

async function coreManifest(cwd, name) {
    try {
        const directory = join(await realpath(cwd), ".specify", "integrations");
        const actual = await realpath(directory);
        if (resolve(actual) !== resolve(directory)) throw new Error("Linked integration manifest directory");
        const text = await readBounded(join(directory, `${name}.manifest.json`), {
            invalid: "Invalid integration manifest", oversized: "Oversized integration manifest",
        });
        const manifest = JSON.parse(text);
        if (manifest.integration !== name || !manifest.files || typeof manifest.files !== "object"
            || Array.isArray(manifest.files)) throw new Error("Invalid integration manifest");
        return manifest.files;
    } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
    }
}

export async function collectArtifactEvidence(cwd, snapshot, openFile = open) {
    const evidence = {}, requests = [], warnings = [];
    let incomplete = false;
    let cache;
    try { cache = await readEvidenceCache(cwd); }
    catch (error) { warnings.push(error.message); cache = { entries: {} }; }
    let coreSkills, coreScripts;
    try {
        [coreSkills, coreScripts] = await Promise.all([
            coreManifest(cwd, "copilot"), coreManifest(cwd, "speckit"),
        ]);
    } catch (error) { warnings.push(`Core provenance: ${error.message}`); }
    const pipelineIds = new Set(effectivePipelinePhases(snapshot).map(({ id }) => commandId(id)));
    const ids = new Set(pipelineIds);
    for (const id of PHASE_ORDER) {
        if (id !== "setup") ids.add(id);
    }
    for (const command of snapshot.commands ?? []) ids.add(commandId(command.id));
    const extensions = await readdir(join(cwd, ".specify", "extensions"), { withFileTypes: true })
        .catch((error) => error.code === "ENOENT" ? [] : Promise.reject(error));
    for (const extension of extensions) {
        if (!extension.isDirectory() || !validId(extension.name)) continue;
        const files = await readdir(join(cwd, ".specify", "extensions", extension.name, "commands"),
            { withFileTypes: true }).catch((error) => error.code === "ENOENT" ? [] : Promise.reject(error));
        for (const file of files) {
            if (file.isFile() && file.name.endsWith(".md")) ids.add(commandId(file.name.slice(0, -3)));
        }
    }
    for (const id of ids) {
        if (!validId(id)) continue;
        const candidates = [];
        try {
            const source = await effectiveSource(cwd, id, openFile);
            const parsed = source ? await parseCommandFile(source.skillText, warnings, "effective", id) : null;
            const declaration = parsed ? pathEvidence(parsed.artifact, "declaration") : null;
            if (declaration) candidates.push(declaration);
            const cached = Object.entries(cache.entries).find(([key]) => commandId(key) === id)?.[1];
            const legacy = ["manual", "author"].includes(cached?.source)
                ? pathEvidence(cached.writesTo, cached.source === "manual" ? "manual" : "declaration") : null;
            if (legacy && !candidates.some((item) => item.path === legacy.path)) candidates.push(legacy);
            const current = source && cached?.outputEvidence?.fingerprint === source.fingerprint;
            const artifact = snapshot.composition?.artifacts?.find((item) =>
                item.kind === "command" && commandId(item.id) === id);
            const chain = activeChainForArtifact(artifact);
            const core = source && Object.hasOwn(CORE_OUTPUTS, id)
                && chain.length === 1 && chain[0].layer === "core"
                && (!parsed?.source || ["core", "builtin", `templates/commands/${id}.md`].includes(parsed.source))
                && coreSkills?.[source.skillPath] === source.sources[0].sha256
                && source.sources.slice(1).every((helper) => {
                    if (!helper.sha256 || coreScripts?.[helper.path] !== helper.sha256) return false;
                    const name = helper.path.split("/").at(-1).replace(/\.(?:ps1|sh|py)$/, "");
                    const script = snapshot.composition?.artifacts?.find((item) =>
                        item.kind === "script" && item.id.replace(/^scripts\//, "") === name);
                    return !activeChainForArtifact(script).some((layer) => layer.layer !== "core");
                });
            if (core && !candidates.length) {
                const defaults = CORE_OUTPUTS[id].map((path) => pathEvidence(path, "core"));
                const primaryIndex = defaults.findIndex((candidate) => candidate.kind === "file");
                evidence[id] = {
                    fingerprint: source.fingerprint,
                    candidates: defaults.length ? defaults : [{ kind: "none", source: "core", effect: "unknown" }],
                    primaryIndex: primaryIndex < 0 ? null : primaryIndex,
                };
                continue;
            }
            if (!current && !candidates.length) {
                for (const path of CORE_OUTPUTS[id] ?? []) {
                    const candidate = pathEvidence(path, "core");
                    if (candidate) candidates.push(candidate);
                }
            }
            if (current) {
                const inferred = normalizeInferredEvidence(
                    validateCandidates(cached.outputEvidence.candidates, { inference: true }),
                    validatePrimaryIndex(cached.outputEvidence.primaryIndex, cached.outputEvidence.candidates));
                const hasExplicitPath = candidates.some(({ kind, source }) =>
                    ["file", "folder"].includes(kind) && ["declaration", "manual"].includes(source));
                for (const candidate of inferred.candidates) {
                    if (hasExplicitPath && candidate.kind === "none") continue;
                    if (!candidates.some((item) => item.path && item.path === candidate.path
                        && item.relativeTo === candidate.relativeTo && item.root?.name === candidate.root?.name
                        && item.root?.path === candidate.root?.path)) {
                        candidates.push(candidate);
                    }
                }
            } else if (source) {
                requests.push({ commandId: id.startsWith("speckit.") ? id : `speckit.${id}`,
                    skillPath: source.skillPath, fingerprint: source.fingerprint, sources: source.sources });
            }
            let primaryIndex = current ? cached.outputEvidence.primaryIndex : undefined;
            if (current && Number.isInteger(primaryIndex)) {
                const target = cached.outputEvidence.candidates[primaryIndex];
                primaryIndex = candidates.findIndex((candidate) => candidate.kind === "file"
                    && candidate.path === target?.path && candidate.relativeTo === target?.relativeTo
                    && candidate.root?.name === target?.root?.name && candidate.root?.path === target?.root?.path);
                if (primaryIndex < 0) primaryIndex = null;
            }
            if (current && candidates.some((candidate) => candidate.source === "manual" && candidate.kind === "file")) {
                primaryIndex = candidates.findIndex((candidate) => candidate.source === "manual" && candidate.kind === "file");
            }
            if (primaryIndex === null && declaration?.kind === "file") {
                primaryIndex = candidates.indexOf(declaration);
            }
            evidence[id] = { candidates, ...(source ? { fingerprint: source.fingerprint } : {}),
                ...(current ? { primaryIndex } : {}) };
        } catch (error) {
            warnings.push(`${id}: ${error.message}`);
            evidence[id] = { candidates };
            if (pipelineIds.has(id)) incomplete = true;
        }
    }
    return { evidence, requests, warnings, incomplete };
}
