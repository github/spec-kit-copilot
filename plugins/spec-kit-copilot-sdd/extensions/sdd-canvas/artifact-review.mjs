import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { CONSTITUTION, STAGES, scanFeatures } from "./sdd.mjs";
import { ArtifactReadError } from "./vendor/artifact-read.mjs";
import { createArtifactReviewService } from "./vendor/artifact-review.mjs";
import { scanArtifactCandidates } from "./vendor/artifact-discovery.mjs";

export function sddPrimaryScope(state, selection, workspacePath) {
    if (!state?.projectRoot || resolve(state.projectRoot) !== resolve(workspacePath)) {
        throw new ArtifactReadError("workspace_unavailable");
    }
    const stage = selection.stage;
    let primary;
    let scopeType;
    if (stage === CONSTITUTION.key) {
        scopeType = "project";
        primary = { relativePath: CONSTITUTION.rel.join("/"), label: CONSTITUTION.label,
            role: "primary", owningStage: stage, owningCommand: CONSTITUTION.command };
    } else {
        const feature = selection.feature;
        if (typeof feature !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(feature) ||
            !state.features?.some((entry) => entry.slug === feature)) return null;
        const primaryStage = STAGES.find((entry) => entry.key === stage);
        if (!primaryStage) return null;
        scopeType = "feature";
        primary = { relativePath: `specs/${feature}/${primaryStage.file}`, label: primaryStage.label,
            role: "primary", owningStage: stage, owningCommand: primaryStage.command };
    }
    if (selection.source && selection.source !== primary.relativePath) return null;
    const scopeKey = createHash("sha256").update(JSON.stringify([scopeType, selection.feature ?? null, stage])).digest("hex");
    const candidates = [primary];
    const roots = [];
    if (scopeType === "feature") {
        roots.push(`specs/${selection.feature}`);
        for (const related of STAGES) {
            if (related.key === stage) continue;
            candidates.push({ relativePath: `specs/${selection.feature}/${related.file}`, label: related.file,
                role: "supporting", owningStage: related.key, owningCommand: related.command });
        }
        candidates.push({ relativePath: CONSTITUTION.rel.join("/"), label: "constitution.md",
            role: "supporting", owningStage: "constitution", optional: true });
    }
    return { scopeType, scopeKey, originStage: stage, originCommand: primary.owningCommand, primary, candidates, roots };
}

export function createSddReviewService({ workspacePath, instanceId, getState = () => scanFeatures(workspacePath) }) {
    return createArtifactReviewService({
        canvasId: "sdd-canvas", workspacePath, instanceId,
        getScope: async (selection) => sddPrimaryScope(await getState(), selection, workspacePath),
        discoverCandidates: (scope) => scanArtifactCandidates({ workspacePath, roots: scope.roots, explicit: scope.candidates }),
    });
}
