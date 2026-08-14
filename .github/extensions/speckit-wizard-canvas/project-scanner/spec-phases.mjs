// speckit-wizard — core spec-kit phase hydration.
//
// Extracted from scanner.mjs. These two functions read filesystem truth
// (`.github/skills/` + `specs/<slug>/*.md`) into the phases state object.
// The scanner orchestrator merges what these return with state.json.

import { join, relative } from "node:path";
import { toPortable } from "./fs-helpers.mjs";
import { looksLikeUnfilledTemplate } from "./fs-helpers.mjs";

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
            // Same rule as constitution: file existence alone is not
            // enough — the spec-kit templates are copied into specs/<slug>/
            // with placeholder tokens like [FEATURE NAME]. Only flip to
            // done once those have been filled in; and downgrade a stale
            // stored `done` if the file has reverted to a template shape.
            const unfilled = await looksLikeUnfilledTemplate(p, deps);
            if (unfilled) {
                if (phases[phaseId].status === "done") phases[phaseId].status = "empty";
            } else if (phases[phaseId].status === "empty") {
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
    // Checklists directory presence.
    const checklistsDir = join(specDir, "checklists");
    if (await deps.pathExists(checklistsDir)) {
        phases.checklist = {
            ...phases.checklist,
            artifactPath: toPortable(relative(cwd, checklistsDir)),
        };
        if (phases.checklist.status === "empty") phases.checklist.status = "done";
    }
}
