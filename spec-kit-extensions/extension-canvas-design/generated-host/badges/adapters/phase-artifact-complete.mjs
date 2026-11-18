export const contractVersion = 1;

export async function evaluate({ ruleId, inputs, evidence }) {
    if (ruleId !== "phase-artifact-complete") {
        throw new Error(`Unsupported phase artifact badge rule: ${ruleId}`);
    }
    let previous;
    for (const descriptor of [...inputs.prerequisites, inputs.target]) {
        const file = await evidence.readArtifact(descriptor);
        if (file.state === "unknown") {
            return { match: false, diagnostics: [file.diagnostic] };
        }
        if (file.state === "missing") return { match: false };
        if (!Number.isFinite(file.mtimeMs)) {
            return { match: false, diagnostics: ["Output modification time is unavailable."] };
        }
        if (previous !== undefined && file.mtimeMs < previous) return { match: false };
        previous = file.mtimeMs;
    }
    return { match: true };
}
