import { createHash } from "node:crypto";
import type { ReaderOptions } from "../src/types.ts";

export function readerOptions(content: string, readerId = "reader-fixture"): ReaderOptions {
    const artifact = { id: "artifact_fixture", relativePath: "specs/001-fixture/spec.md", label: "Specification", role: "primary" as const, availability: "available" as const };
    return {
        readerId, state: "ready", connectionState: "connected", selectedArtifactId: artifact.id,
        scrollElement: {} as HTMLElement, artifacts: [artifact], navigationEnabled: true,
        document: { artifact, content, revision: `sha256:${createHash("sha256").update(content).digest("hex")}`,
            byteSize: Buffer.byteLength(content), modifiedAt: "2026-09-13T00:00:00.000Z", sourceKind: "working-tree" },
        onSelectArtifact() {}, onNavigateReference() {}, onNavigateHistory() {}, onReturnToWorkflow() {},
    };
}
