export function validateBadgeEvaluator(evaluator) {
    if (evaluator.contractVersion !== 1 || typeof evaluator.evaluate !== "function")
        throw new Error("Incompatible badge evaluator");
}

export function badgeEvidence(data) {
    return {
        readArtifact: async ({ phase, output }) =>
            data.files[JSON.stringify([phase, output])] ?? {
                state: "unknown", diagnostic: "Artifact was not declared for badge evaluation.",
            },
        getRun: async (phase) => data.runs[phase] ?? null,
        countMarkdownFiles: async ({ phase, output }) =>
            data.directories[JSON.stringify([phase, output])] ?? {
                state: "unknown", diagnostic: "Badge directory was not declared for evaluation.",
            },
    };
}

export function validateBadgeEvaluatorResult(result) {
    if (!result || typeof result.match !== "boolean"
        || (result.values !== undefined && (typeof result.values !== "object" || !result.values
            || Array.isArray(result.values)))
        || (result.summaryCount !== undefined && (!Number.isSafeInteger(result.summaryCount)
            || result.summaryCount < 0 || result.summaryCount > 1_000_000))
        || (result.selection !== undefined && (typeof result.selection !== "string"
            || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(result.selection)))
        || (result.diagnostics !== undefined && (!Array.isArray(result.diagnostics)
            || result.diagnostics.some((text) => typeof text !== "string"))))
        throw new Error("Invalid badge evaluator result");
    if (JSON.stringify(result).length > 8192) throw new Error("Badge evaluator result exceeds limit");
}
