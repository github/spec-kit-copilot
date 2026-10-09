export type ReaderState = "idle" | "loading" | "ready" | "changed" | "missing" | "deleted" | "unsupported" | "empty" | "no-heading" | "error";
export type DocumentRevision = string;

export interface ArtifactReference {
    id: string;
    relativePath: string;
    label: string;
    role: "primary" | "supporting" | "command" | "reference";
    owningStage?: string;
    owningCommand?: string;
    originArtifactId?: string;
    availability: "available" | "expected" | "deleted" | "unsupported";
}

export interface MarkdownDocument {
    artifact: ArtifactReference;
    revision: DocumentRevision;
    content: string;
    byteSize: number;
    modifiedAt: string;
    sourceKind: "working-tree";
}

export interface ClarificationDescriptor {
    id: string;
    artifactId: string;
    revision: DocumentRevision;
    commandName: string;
    questionId: string;
    section?: string;
    question: string;
    mode: "wizard-batched" | "sdd-immediate";
    answer?: string;
    status?: "queued" | "submitting" | "acknowledged" | "failed" | "stale";
    sourceStart?: number;
    sourceEnd?: number;
    index?: number;
}

export interface RenderedEvent {
    readerId: string;
    artifactId?: string;
    revision?: DocumentRevision;
    state: ReaderState;
    activeFragment?: string;
}

export interface ReaderOptions {
    readerId: string;
    state: ReaderState;
    connectionState: "connected" | "disconnected";
    document?: MarkdownDocument;
    artifacts: readonly ArtifactReference[];
    selectedArtifactId?: string;
    scrollElement: HTMLElement;
    fragment?: string;
    statusMessage?: string;
    navigationEnabled?: boolean;
    canNavigateBack?: boolean;
    canNavigateForward?: boolean;
    clarifications?: readonly ClarificationDescriptor[];
    onSelectArtifact(artifactId: string): void;
    onNavigateReference(target: string): void;
    onNavigateHistory(direction: "back" | "forward"): void;
    onReturnToWorkflow(): void;
    onRefresh?(): void;
    onClarification?(descriptorId: string, answer?: string): void;
    onRendered?(event: RenderedEvent): void;
}

export interface MountedReader {
    update(options: ReaderOptions): void;
    unmount(): void;
}
