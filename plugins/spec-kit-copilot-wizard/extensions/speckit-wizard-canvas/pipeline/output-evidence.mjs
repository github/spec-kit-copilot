export function primaryCandidate(record) {
    const candidates = record?.candidates ?? [];
    if (record?.primaryIndex === null) return null;
    if (Number.isInteger(record?.primaryIndex)) {
        const candidate = candidates[record.primaryIndex];
        return candidate?.kind === "file" ? candidate : null;
    }
    const files = candidates.filter((candidate) => candidate.kind === "file" && candidate.source !== "inference");
    return files.length === 1 ? files[0] : null;
}

export function resolveOutputPath(candidate, specsDir, namedRoot = null) {
    if (!candidate?.path) return null;
    if (candidate.root) return namedRoot ? `${namedRoot}/${candidate.path}` : null;
    if (candidate.relativeTo === "feature") return specsDir ? `${specsDir}/${candidate.path}` : null;
    if (candidate.path.includes("<slug>")) {
        return specsDir && candidate.path.startsWith("specs/<slug>/")
            ? `${specsDir}/${candidate.path.slice("specs/<slug>/".length)}` : null;
    }
    return candidate.path;
}

export function displayOutputPath(candidate, specsDir, namedRoot = null) {
    return resolveOutputPath(candidate, specsDir, namedRoot)
        ?? (candidate.root ? `${candidate.root.path ?? candidate.root.name}/${candidate.path}`
            : candidate.relativeTo === "feature" ? `FEATURE_DIR/${candidate.path}` : candidate.path);
}
