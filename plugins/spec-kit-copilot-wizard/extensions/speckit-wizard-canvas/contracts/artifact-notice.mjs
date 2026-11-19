export function artifactSetNotice() {
    return { kind: "artifact-set" };
}

export function readArtifactNotice(notice) {
    if (notice === undefined) return null;
    if (!notice || typeof notice !== "object" || Array.isArray(notice) ||
        notice.kind !== "artifact-set" || Object.keys(notice).length !== 1) {
        throw new TypeError("Invalid artifact review notice.");
    }
    return notice;
}
