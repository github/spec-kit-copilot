import * as fs from "node:fs/promises";
import path from "node:path";
import { ArtifactReadError, inspectArtifact, validateArtifactPath } from "./artifact-read.mjs";

const INSPECTION_LIMIT = 10_000;

async function* directoryEntries(workspacePath, relativeDirectory) {
    validateArtifactPath(`${relativeDirectory}/review-sentinel.md`);
    const root = await fs.realpath(workspacePath);
    let directory = root;
    for (const part of relativeDirectory.split("/")) {
        directory = path.join(directory, part);
        const stat = await fs.lstat(directory);
        if (!stat.isDirectory() || stat.isSymbolicLink()) return;
        const canonical = await fs.realpath(directory);
        if (path.relative(root, canonical).startsWith("..") || path.isAbsolute(path.relative(root, canonical))) return;
    }
    const handle = await fs.opendir(directory);
    for await (const entry of handle) yield entry;
}

export async function scanArtifactCandidates({ workspacePath, roots = [], explicit = [], entries = directoryEntries }) {
    if (typeof workspacePath !== "string" || !path.isAbsolute(workspacePath)) throw new ArtifactReadError("workspace_unavailable");
    const candidates = new Map();
    let inspectedCount = 0;
    let limitReached = false;
    for (const candidate of explicit) {
        if (inspectedCount >= INSPECTION_LIMIT) { limitReached = true; break; }
        inspectedCount++;
        try {
            validateArtifactPath(candidate.relativePath);
            if (candidate.optional) await inspectArtifact(workspacePath, candidate.relativePath);
            candidates.set(candidate.relativePath, { ...candidate, availability: "expected" });
        } catch (error) {
            if (candidate.optional && ["artifact_unavailable", "unsupported_artifact"].includes(error.code)) continue;
            throw error;
        }
    }
    const pending = [...new Set(roots)].sort();
    const visited = new Set();
    while (pending.length && !limitReached) {
        const directory = pending.shift();
        if (visited.has(directory)) continue;
        visited.add(directory);
        try {
            for await (const entry of entries(workspacePath, directory)) {
                if (inspectedCount >= INSPECTION_LIMIT) { limitReached = true; break; }
                inspectedCount++;
                if (entry.isSymbolicLink() || entry.name.toLowerCase() === ".git") continue;
                const relativePath = `${directory}/${entry.name}`;
                if (entry.isDirectory()) {
                    try { validateArtifactPath(`${relativePath}/review-sentinel.md`); }
                    catch { continue; }
                    if (pending.length < INSPECTION_LIMIT) pending.push(relativePath);
                } else if (entry.isFile()) {
                    try { validateArtifactPath(relativePath); }
                    catch { continue; }
                    if (!candidates.has(relativePath)) candidates.set(relativePath, {
                        relativePath, label: entry.name, role: "supporting", availability: "available",
                    });
                }
            }
        } catch (error) {
            if (!["ENOENT", "ENOTDIR"].includes(error.code)) throw new ArtifactReadError("read_failed");
        }
    }
    return { candidates: [...candidates.values()], inspectedCount, limitReached };
}

export function deriveWizardArtifacts(snapshot, primary) {
    const candidates = new Map(primary ? [[primary.relativePath, primary]] : []);
    const roots = [];
    if (snapshot.slug && /^[a-z0-9][a-z0-9-]*$/i.test(snapshot.slug)) roots.push(`specs/${snapshot.slug}`);
    const add = (relativePath, metadata = {}) => {
        if (typeof relativePath !== "string") return;
        relativePath = relativePath.replaceAll("\\", "/");
        if (candidates.has(relativePath)) return;
        try { validateArtifactPath(relativePath); }
        catch { return; }
        candidates.set(relativePath, { relativePath, label: path.posix.basename(relativePath), role: "supporting", ...metadata });
    };
    for (const [stage, phase] of Object.entries(snapshot.phases ?? {})) {
        add(phase.artifactPath, { owningStage: stage, owningCommand: `speckit.${stage}` });
    }
    for (const command of snapshot.commands ?? []) {
        add(command.artifactPath, { owningStage: command.id, owningCommand: command.commandName });
    }
    add(".specify/memory/constitution.md", { owningStage: "constitution", optional: true });
    for (const artifact of snapshot.composition?.artifacts ?? []) {
        const winner = (artifact.stack ?? []).find((layer) => layer.active === true);
        if (winner?.sourcePath) add(winner.sourcePath, { role: "command", optional: true });
        if (artifact.kind === "command") {
            const name = String(artifact.id).replace(/^commands\//, "");
            if (/^speckit\.[a-z0-9.-]+$/i.test(name)) {
                add(`.github/skills/${name.replace(/^speckit\./, "speckit-")}/SKILL.md`, { role: "command", owningCommand: name, optional: true });
            }
        } else if (artifact.kind === "template" && !winner?.sourcePath) {
            const name = String(artifact.id ?? "").replace(/^templates\//, "").replace(/\.md$/, "");
            if (name) add(`.specify/templates/${name}.md`, { role: "command", optional: true });
        }
    }
    return { candidates: [...candidates.values()], roots };
}
