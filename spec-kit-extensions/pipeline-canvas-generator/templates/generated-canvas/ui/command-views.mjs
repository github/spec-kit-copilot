// Shared by the compiler, runtime and renderer; identities never depend on display order.
export function commandViews(blueprint) {
    const all = blueprint?.pipeline?.steps ?? [];
    const descriptor = blueprint?.projectArtifacts?.constitution;
    if (descriptor === undefined) return { all, constitution: null, workflow: all };
    if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)
        || Object.keys(descriptor).some((key) => !["instanceKey", "required"].includes(key))
        || descriptor.required !== true || typeof descriptor.instanceKey !== "string") {
        throw new Error("Unsupported Constitution contract: expected one required project artifact reference.");
    }
    const candidates = all.filter((step) => step.commandName === "speckit.constitution");
    const matches = all.filter((step) => step.instanceKey === descriptor.instanceKey);
    if (candidates.length !== 1 || matches.length !== 1 || candidates[0] !== matches[0]) {
        throw new Error("Select exactly one project Constitution command (speckit.constitution).");
    }
    const constitution = matches[0];
    const artifact = constitution.artifact;
    if (!artifact?.persistent || artifact.completionSignal !== "artifact"
        || typeof artifact.outputPath !== "string" || !/\.md$/i.test(artifact.outputPath)
        || /[<>]/.test(artifact.outputPath)) {
        throw new Error("Unsupported Constitution contract: declare a persistent, fixed project-level Markdown artifact, not a transient or slug-scoped output.");
    }
    return { all, constitution, workflow: all.filter((step) => step !== constitution) };
}
