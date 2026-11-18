import { dirname, join } from "node:path";
import { artifactPath } from "../artifact-evidence.mjs";
import { displayOutputPath, primaryCandidate, resolveOutputPath } from "../pipeline/output-evidence.mjs";
import { securePathWithin } from "../project-scanner/fs-helpers.mjs";
import { fsDeps } from "./instances.mjs";
import { outputInferenceProgress, outputInferenceStatus } from "./output-inference.mjs";
import { commandId } from "../artifact-evidence.mjs";
import { effectivePipelinePhases } from "../pipeline/effective-phases.mjs";

async function existing(cwd, path, kind) {
    if (!path || !artifactPath(path, kind)) return null;
    const safe = await securePathWithin(join(cwd, path), cwd, cwd, fsDeps);
    if (!safe) return null;
    const stat = await fsDeps.stat(safe).catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
    });
    return (kind === "file" ? stat?.isFile() : stat?.isDirectory()) ? path : null;
}

async function namedRoot(cwd, candidate, observed) {
    const pattern = candidate.root?.path;
    if (observed && observed.endsWith(`/${candidate.path}`)) {
        const root = observed.slice(0, -candidate.path.length - 1);
        const expression = pattern && new RegExp(`^${pattern.split("<slug>").map((piece) =>
            piece.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[a-z0-9-]+")}$`);
        if (artifactPath(root, "folder") && (!expression || expression.test(root))
            && await existing(cwd, root, "folder")) return root;
    }
    if (!pattern) return null;
    if (!pattern.includes("<slug>")) return pattern;
    const [prefix, suffix] = pattern.split("<slug>");
    const parent = prefix.replace(/\/$/, "");
    if (!await existing(cwd, parent, "folder")) return null;
    const dirs = (await fsDeps.readdir(join(cwd, parent), { withFileTypes: true }))
        .filter((item) => item.isDirectory() && /^[a-z0-9-]+$/.test(item.name));
    const matching = [], roots = [];
    for (const dir of dirs) {
        const root = `${prefix}${dir.name}${suffix}`;
        if (!await existing(cwd, root, "folder")) continue;
        roots.push(root);
        if (await existing(cwd, `${root}/${candidate.path}`, candidate.kind)) matching.push(root);
    }
    return matching.length === 1 ? matching[0]
        : !matching.length && roots.length === 1 ? roots[0] : null;
}

async function browseFolder(cwd, path) {
    const parts = path.split("/");
    const dynamic = parts.findIndex((part) => part.includes("<") || /^[A-Z][A-Z_]*$/.test(part));
    if (dynamic >= 0) parts.length = dynamic;
    else parts.pop();
    while (parts.length) {
        const folder = parts.join("/");
        if (await existing(cwd, folder, "folder")) return folder;
        parts.pop();
    }
    return "";
}

export async function outputAvailability(cwd, candidate, specsDir, observed = null) {
    if (!["file", "folder"].includes(candidate.kind)) return {};
    const root = candidate.root ? await namedRoot(cwd, candidate, observed) : null;
    const resolved = resolveOutputPath(candidate, specsDir, root);
    const browsePath = await browseFolder(cwd, resolved ?? displayOutputPath(candidate, specsDir));
    if (!resolved) {
        const match = !candidate.root && !candidate.relativeTo
            && candidate.path.match(/^(.+)\/<slug>\/(.+)$/);
        if (!match || !await existing(cwd, match[1], "folder")) return { browsePath };
        const dirs = (await fsDeps.readdir(join(cwd, match[1]), { withFileTypes: true }))
            .filter((item) => item.isDirectory() && /^[a-z0-9-]+$/.test(item.name));
        const found = [];
        for (const dir of dirs) {
            const path = `${match[1]}/${dir.name}/${match[2]}`;
            if (await existing(cwd, path, candidate.kind)) found.push(path);
        }
        if (found.length !== 1) return { browsePath };
        const path = found[0];
        const folderPath = candidate.kind === "folder" ? path.replace(/\/$/, "")
            : dirname(path).replaceAll("\\", "/");
        return { browsePath, folderPath,
            ...(candidate.kind === "file" ? { filePath: path } : {}) };
    }
    const filePath = candidate.kind === "file" ? await existing(cwd, resolved, "file") : null;
    const folder = candidate.kind === "folder" ? resolved.replace(/\/$/, "")
        : dirname(resolved).replaceAll("\\", "/");
    const folderPath = await existing(cwd, folder, "folder");
    return { browsePath, resolvedPath: resolved,
        ...(filePath ? { filePath } : {}),
        ...(folderPath ? { folderPath } : {}) };
}

export async function attachOutputEvidence(inst, scan, snap, outputs) {
    snap.artifactEvidence = outputs.evidence;
    snap.artifactInferenceRequests = outputs.requests;
    snap.artifactEvidenceIncomplete = outputs.incomplete;
    snap.warnings.push(...outputs.warnings);
    snap.refreshStatus = inst.refreshStatus?.status ?? "ready";
    snap.refreshId = inst.refreshStatus?.id ?? null;
    snap.compositionRefreshing = (inst.compositionRefreshCount ?? 0) > 0;
    snap.outputInferenceStatus = outputInferenceStatus(inst, outputs.evidence);
    const pipeline = new Set(effectivePipelinePhases(snap).map(({ id }) => commandId(id)));
    snap.outputInferenceProgress = outputInferenceProgress(inst,
        outputs.requests.filter((request) => pipeline.has(commandId(request.commandId))));
    snap.outputAvailability = {};
    for (const [id, record] of Object.entries(outputs.evidence)) {
        const primary = primaryCandidate(record);
        const observed = scan.reportedPhasePaths?.[id] ?? scan.reportedPhasePaths?.[`commands/${id}`];
        const candidates = await Promise.all(record.candidates.map((candidate) =>
            outputAvailability(inst.workspacePath, candidate, snap.specsDir, observed)));
        const index = primary ? record.candidates.indexOf(primary) : -1;
        snap.outputAvailability[id] = { candidates,
            folderPath: candidates[index]?.folderPath
                ?? (!primary ? candidates.find((candidate) => candidate.folderPath)?.folderPath : null) };
        const key = snap.phases[id] ? id : `commands/${id}`;
        const phase = snap.phases[key] ?? (snap.phases[key] = { status: "empty", artifactPath: null });
        const command = snap.commands?.find((item) => item.id === id || item.id === `speckit.${id}`
            || item.id === `commands/${id}`);
        const path = primary?.root ? candidates[index]?.filePath
            : primary && resolveOutputPath(primary, snap.specsDir);
        if (path && !path.includes("<slug>")) {
            if (phase) phase.artifactPath = path;
            if (command) command.artifactPath = path;
            if (!snap.phases[id]) {
                if (candidates[index]?.filePath) phase.status = "done";
                else if (phase.status === "done") phase.status = "empty";
            }
        } else if (primary?.root || record.primaryIndex === null) {
            if (phase) phase.artifactPath = null;
            if (command) command.artifactPath = null;
            if (!snap.phases[id] && phase.status === "done") phase.status = "empty";
        }
    }
}
