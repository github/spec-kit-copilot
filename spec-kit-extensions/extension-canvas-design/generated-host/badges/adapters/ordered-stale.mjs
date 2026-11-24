export const contractVersion = 1;

export async function evaluate({ ruleId, inputs, evidence }) {
    if (ruleId !== "artifact-stale") {
        throw new Error(`Unsupported ordered stale badge rule: ${ruleId}`);
    }
    const chain = [...inputs.prerequisites, inputs.artifact];
    const files = await Promise.all(chain.map((descriptor) => evidence.readArtifact(descriptor)));
    const unknown = files.find((file) => file.state === "unknown");
    if (unknown) return { match: false, diagnostics: [unknown.diagnostic] };
    if (files.some((file) => file.state !== "missing" && !Number.isFinite(file.mtimeMs))) {
        return { match: false, diagnostics: ["Output modification time is unavailable."] };
    }
    if (files.at(-1).state === "missing") return { match: false };
    if (files.slice(0, -1).some((file) => file.state === "missing")) return { match: true };
    return { match: files.some((file, index) => index > 0
        && file.mtimeMs < files[index - 1].mtimeMs) };
}
