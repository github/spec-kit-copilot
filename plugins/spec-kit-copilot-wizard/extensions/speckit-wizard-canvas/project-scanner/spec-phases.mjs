// speckit-wizard — core spec-kit phase hydration.
//
// Extracted from scanner.mjs. These two functions read filesystem truth
// (`.github/skills/` + `specs/<slug>/*.md`) into the phases state object.
// The scanner orchestrator merges what these return with state.json.

import { isAbsolute, join, normalize, relative, resolve } from "node:path";
import { toPortable } from "./fs-helpers.mjs";

// List `.github/skills/speckit-*` subdirectories. Returns bare skill ids
// (e.g. "speckit-plan"). Empty array on any FS error — the UI treats an
// empty list as "not scaffolded".
export async function scanScaffoldedSkills(workspacePath, deps) {
    const skillsDir = join(workspacePath, ".github", "skills");
    try {
        if (!(await deps.pathExists(skillsDir))) return [];
        const entries = await deps.readdir(skillsDir, { withFileTypes: true });
        return entries
            .filter((e) => e.isDirectory() && /^speckit-/.test(e.name))
            .map((e) => e.name)
            .sort();
    } catch {
        return [];
    }
}

export async function hydrateSpecPhases({ cwd, specDir, phases, deps }) {
    const check = async (fileRel, phaseId) => {
        const p = join(specDir, fileRel);
        if (await deps.pathExists(p)) {
            const artifactRel = toPortable(relative(cwd, p));
            phases[phaseId] = {
                ...phases[phaseId],
                artifactPath: artifactRel,
            };
            if (phases[phaseId].status === "empty") {
                phases[phaseId].status = "done";
            }
        }
    };
    await Promise.all([
        check("spec.md", "specify"),
        check("plan.md", "plan"),
        check("tasks.md", "tasks"),
        check("analysis.md", "analyze"),
    ]);
    // Converge appends remediation work to tasks.md. Hydrate the concrete
    // artifact path from the same file without inferring Converge status from
    // Tasks file existence.
    const tasksPath = join(specDir, "tasks.md");
    if (await deps.pathExists(tasksPath)) {
        phases.converge = {
            ...phases.converge,
            artifactPath: toPortable(relative(cwd, tasksPath)),
        };
    }
    // Clarify enriches spec.md — it doesn't produce its own file. Point the
    // clarify phase's artifactPath at spec.md so the "View artifact" button
    // resolves. Status is preserved: clarify only becomes "done" when
    // state.json says so (see grounding rule); scanner never auto-flips it.
    const specPath = join(specDir, "spec.md");
    if (await deps.pathExists(specPath)) {
        phases.clarify = {
            ...phases.clarify,
            artifactPath: toPortable(relative(cwd, specPath)),
        };
    }
    const isChecklistFile = (name) => /\.md$/i.test(name);

    const resolveChecklistPath = (raw, checklistsDir) => {
        if (typeof raw !== "string" || !raw.trim()) return null;
        const rawTrimmed = raw.trim();
        const normalized = raw.trim().replace(/\\/g, "/");
        if (normalized.includes("<slug>")) return null;
        const kind = normalized.endsWith("/") ? "dir" : "file";
        let candidatePath;
        if (isAbsolute(rawTrimmed)) {
            candidatePath = rawTrimmed;
        } else if (normalized.includes("/")) {
            candidatePath = join(cwd, ...normalized.split("/").filter(Boolean));
        } else {
            candidatePath = join(checklistsDir, rawTrimmed);
        }
        const canonicalize = (p) => /^[\\/](?![\\/])/.test(p) ? normalize(p) : resolve(p);
        const resolvedChecklistsDir = canonicalize(checklistsDir);
        const resolvedCandidate = canonicalize(candidatePath);
        const rel = relative(resolvedChecklistsDir, resolvedCandidate);
        if (rel && (rel === ".." || rel.startsWith("../") || rel.startsWith("..\\") || isAbsolute(rel))) return null;
        return { kind, path: resolvedCandidate };
    };

    const newestChecklistFile = async (checklistsDir) => {
        const entries = await deps.readdir(checklistsDir, { withFileTypes: true }).catch(() => []);
        const files = [];
        for (const entry of entries) {
            if (!entry?.isFile?.() || !isChecklistFile(entry.name)) continue;
            const filePath = join(checklistsDir, entry.name);
            const st = await deps.stat(filePath).catch(() => null);
            files.push({ name: entry.name, path: filePath, mtimeMs: st?.mtimeMs ?? 0 });
        }
        files.sort((a, b) => (b.mtimeMs - a.mtimeMs) || a.name.localeCompare(b.name));
        return files[0]?.path ?? null;
    };

    const checklistArtifactPath = async (checklistsDir) => {
        const configuredSources = [
            phases.checklist?.formValues?.checklistFile,
            phases.checklist?.artifactPath,
        ];
        for (const configured of configuredSources) {
            if (typeof configured !== "string" || !configured.trim()) continue;
            const raw = configured.trim();
            const resolved = resolveChecklistPath(raw, checklistsDir);
            if (!resolved) continue;
            if (resolved.kind === "dir") {
                const newest = await newestChecklistFile(resolved.path);
                if (newest) return toPortable(relative(cwd, newest));
            } else if (isChecklistFile(resolved.path) && await deps.pathExists(resolved.path)) {
                return toPortable(relative(cwd, resolved.path));
            }
        }

        const newest = await newestChecklistFile(checklistsDir);
        if (newest) return toPortable(relative(cwd, newest));
        return toPortable(relative(cwd, checklistsDir));
    };

    // Checklist filenames are chosen by the agent at runtime and there may
    // be multiple files. A completed checklist phase with a folder target
    // resolves to the newest markdown file in that folder. Directory
    // presence alone does not mark the phase done because other phases can
    // also create checklist files.
    const checklistsDir = join(specDir, "checklists");
    const hasChecklistRun = phases.checklist?.status === "done";
    const hasConfiguredChecklist = typeof phases.checklist?.formValues?.checklistFile === "string"
        && !!phases.checklist.formValues.checklistFile.trim();
    if ((hasChecklistRun || hasConfiguredChecklist) && await deps.pathExists(checklistsDir)) {
        const artifactPath = await checklistArtifactPath(checklistsDir);
        if (artifactPath) {
            phases.checklist = {
                ...phases.checklist,
                artifactPath,
            };
        }
    }
}
