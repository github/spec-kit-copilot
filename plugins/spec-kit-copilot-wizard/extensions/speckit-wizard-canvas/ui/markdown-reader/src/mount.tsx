import { createRoot } from "react-dom/client";
import { MarkdownReader } from "./MarkdownReader/MarkdownReader.tsx";
import type { MountedReader, ReaderOptions, ReaderState } from "./types.ts";

const mounts = new WeakMap<HTMLElement, MountedReader>();
const readerIds = new Set<string>();
const readerStates = new Set<ReaderState>(["idle", "loading", "ready", "changed", "missing", "deleted", "unsupported", "empty", "no-heading", "error"]);

function validate(element: HTMLElement, options: ReaderOptions) {
    if (!element?.isConnected || !element.ownerDocument) throw new Error("Reader container must be connected.");
    if (!options || !/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(options.readerId)) throw new Error("Invalid readerId.");
    if (!options.scrollElement?.isConnected || !options.scrollElement.contains(element)) throw new Error("Reader scroll container must be connected and contain the mount.");
    if (!readerStates.has(options.state)) throw new Error("Invalid reader state.");
    if (!["connected", "disconnected"].includes(options.connectionState)) throw new Error("Invalid connection state.");
    if (["ready", "no-heading"].includes(options.state) && !options.document) throw new Error("Ready reader requires an artifact document.");
    if (options.document && ["idle", "loading", "missing", "deleted", "unsupported", "error"].includes(options.state)) throw new Error("Invalid document for reader state.");
    if (options.state === "empty" && options.document?.content.trim()) throw new Error("Empty state requires empty content.");
    if (!Array.isArray(options.artifacts)) throw new Error("Invalid artifact list.");
    for (const callback of [options.onSelectArtifact, options.onNavigateReference, options.onNavigateHistory, options.onReturnToWorkflow]) {
        if (typeof callback !== "function") throw new Error("Invalid reader callback.");
    }
    if (options.document) {
        if (options.document.artifact.id !== options.selectedArtifactId) throw new Error("Selected artifact does not match document.");
        if (!options.artifacts.some((artifact) => artifact.id === options.selectedArtifactId && artifact.relativePath === options.document?.artifact.relativePath)) throw new Error("Document is not in the current artifact list.");
        if (!/^sha256:[0-9a-f]{64}$/.test(options.document.revision)) throw new Error("Invalid document revision.");
        if (options.document.sourceKind !== "working-tree" || typeof options.document.content !== "string") throw new Error("Invalid artifact source.");
        if (!Number.isInteger(options.document.byteSize) || options.document.byteSize < 0 || options.document.byteSize > 5_242_880) throw new Error("Invalid artifact byte size.");
    }
}

export function mountMarkdownReader(element: HTMLElement, options: ReaderOptions): MountedReader {
    validate(element, options);
    if (mounts.has(element)) throw new Error("Reader already mounted in this container.");
    if (readerIds.has(options.readerId)) throw new Error("ReaderId is already mounted.");
    const readerId = options.readerId;
    const root = createRoot(element, { identifierPrefix: `${readerId}-` });
    let unmounted = false;
    let generation = 0;
    const handle: MountedReader = {
        update(next) {
            if (unmounted) throw new Error("Cannot update an unmounted reader.");
            validate(element, next);
            if (next.readerId !== readerId) throw new Error("readerId cannot change during update.");
            const currentGeneration = ++generation;
            root.render(<MarkdownReader options={{ ...next, onRendered: (event) => {
                if (!unmounted && generation === currentGeneration) next.onRendered?.(event);
            } }} />);
        },
        unmount() {
            if (unmounted) return;
            unmounted = true;
            generation++;
            root.unmount();
            mounts.delete(element);
            readerIds.delete(readerId);
        },
    };
    mounts.set(element, handle);
    readerIds.add(readerId);
    handle.update(options);
    return handle;
}
