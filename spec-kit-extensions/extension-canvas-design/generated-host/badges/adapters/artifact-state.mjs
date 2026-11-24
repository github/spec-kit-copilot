export const contractVersion = 1;

export async function evaluate({ ruleId, inputs, evidence }) {
    if (ruleId !== "artifact-current") {
        throw new Error(`Unsupported artifact-state badge rule: ${ruleId}`);
    }
    const file = await evidence.readArtifact(inputs.artifact);
    if (file.state === "unknown") {
        return { match: false, diagnostics: [file.diagnostic] };
    }
    if (file.state === "missing") return { match: false };
    const run = await evidence.getRun(inputs.artifact.phase);
    const since = run?.startedAt ?? run?.completedAt;
    if (!since) return { match: true };
    const current = file.mtimeMs >= new Date(since).getTime();
    return { match: current };
}
