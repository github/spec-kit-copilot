// Inspect project-wide artifacts and build Constitution prerequisite prompts.
import { createHash } from "node:crypto";
import { commandViews } from "./ui/command-views.mjs";
import { readWorkflowArtifact } from "./workspace-files.mjs";

export async function inspectConstitution(cwd, blueprint) {
    const { constitution } = commandViews(blueprint);
    if (!constitution) return null;
    const path = constitution.artifact.pathTemplate;
    try {
        const content = await readWorkflowArtifact(cwd, path, blueprint);
        const state = !content.trim() ? "empty" : /\[[A-Z0-9_]+\]/.test(content) ? "template" : "ready";
        return {
            state, ready: state === "ready", path, viewable: Boolean(content.trim()),
            fingerprint: createHash("sha256").update(content).digest("hex"),
        };
    } catch (error) {
        if (error.code === "ENOENT") return { state: "missing", ready: false, path, viewable: false };
        return {
            state: "error", ready: false, path, viewable: false,
            error: `Cannot verify Constitution: ${error.message} Restore a readable, regular project artifact and refresh.`,
        };
    }
}

export async function constitutionGate(cwd, blueprint, step) {
    const { constitution } = commandViews(blueprint);
    if (!constitution || step.instanceKey === constitution.instanceKey) return null;
    const status = await inspectConstitution(cwd, blueprint);
    if (status.ready) return null;
    return {
        ok: false, queued: false, code: "constitution_required",
        error: status.error ?? "Define the project principles in the Constitution card before running workflow phases.",
    };
}
