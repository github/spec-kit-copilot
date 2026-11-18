import { normalizeInferredEvidence, validateCandidates, validatePrimaryIndex } from "../artifact-evidence.mjs";

export function validateAgentArtifactEvidence(evidence, fingerprint) {
    const candidates = validateCandidates(evidence.candidates, { inference: true });
    if (!candidates.length) throw new Error("Inference must report a result");
    const primaryIndex = validatePrimaryIndex(evidence.primaryIndex, candidates);
    if (primaryIndex === undefined) throw new Error("Inference must select a primary file or null");
    if (candidates.some(({ kind }) => kind === "none")
        && candidates.some(({ kind }) => kind === "file" || kind === "folder")) {
        throw new Error("No-file evidence cannot include file outputs");
    }
    return { fingerprint, ...normalizeInferredEvidence(candidates, primaryIndex) };
}

export function normalizeAgentArtifactEntry(entry, outputEvidence) {
    const writesTo = typeof entry?.writesTo === "string" ? entry.writesTo.trim() : "";
    const description = typeof entry?.description === "string" ? entry.description.trim() : "";
    const argsHint = typeof entry?.argsHint === "string" ? entry.argsHint.trim() : "";
    const argsWhenEmpty = typeof entry?.argsWhenEmpty === "string" ? entry.argsWhenEmpty.trim() : "";
    if (!writesTo && !description && !argsHint && !argsWhenEmpty && !outputEvidence) return null;
    return {
        ...(outputEvidence ? { outputEvidence } : {}),
        ...(writesTo ? { writesTo } : {}),
        ...(description ? { description } : {}),
        ...(argsHint ? { argsHint } : {}),
        ...(argsWhenEmpty ? { argsWhenEmpty } : {}),
        source: typeof entry?.source === "string" ? entry.source : "llm",
        ...(typeof entry?.skillPath === "string" ? { skillPath: entry.skillPath } : {}),
        ...(typeof entry?.skillHash === "string" ? { skillHash: entry.skillHash } : {}),
    };
}
