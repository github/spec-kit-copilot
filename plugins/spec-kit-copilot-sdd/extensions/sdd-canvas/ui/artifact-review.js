const REVIEW_OUTCOMES = new Set(["invalid_request", "forbidden", "invalid_context", "artifact_unavailable", "changed_source",
    "artifact_too_large", "unsupported_artifact", "invalid_encoding", "read_failed", "workspace_unavailable"]);

function reviewError(code) {
    const error = new Error("Artifact review request failed.");
    error.code = REVIEW_OUTCOMES.has(code) ? code : "read_failed";
    error.stack = `${error.name}: ${error.message}`;
    return error;
}

export function createArtifactReview({
    container, scrollElement, readerId, fetch: request, mount: suppliedMount,
    headers = {}, onReturn, onDocument, getClarifications, onClarification, canNavigate,
}) {
    const document = container.ownerDocument;
    const window = document.defaultView;
    const fetchContent = request ?? window.fetch.bind(window);
    let mounted;
    let controller;
    let generation = 0;
    let returnTarget;
    let returnScroll;
    let activeContext;
    let contextSelection;
    let currentDocument;
    let artifacts = [];
    let history = [];
    let historyIndex = -1;
    let currentFragment = "";
    let pendingRestore;
    let selectedArtifactId;
    let baseState = "idle";
    let connectionState = "connected";
    let refreshing = false;
    let refreshAgain = false;
    let renewContextQueued = false;

    function urlFor(route, parameters = {}) {
        const url = new URL(route, document.location.href);
        const host = new URL(document.location.href);
        for (const key of ["token", "cap"]) {
            if (host.searchParams.has(key)) url.searchParams.set(key, host.searchParams.get(key));
        }
        for (const [key, value] of Object.entries(parameters)) {
            if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
        }
        return url.href;
    }

    async function json(route, parameters, signal, body) {
        try {
            const response = await fetchContent(urlFor(route, parameters), {
                signal, headers: body ? { ...headers, "Content-Type": "application/json" } : headers,
                ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
            });
            const payload = await response.json();
            if (!response.ok || !payload.ok) throw reviewError(payload?.error?.code);
            return payload.data;
        } catch (error) { throw reviewError(error?.code); }
    }

    async function loadMount() {
        if (suppliedMount) return suppliedMount;
        if (!document.querySelector("link[data-artifact-reader-css]")) {
            const stylesheet = document.createElement("link");
            stylesheet.rel = "stylesheet";
            stylesheet.href = urlFor("/ui/vendor/markdown-reader/markdown-reader.css");
            stylesheet.dataset.artifactReaderCss = "true";
            document.head.append(stylesheet);
        }
        const module = await import(urlFor("/ui/vendor/markdown-reader/markdown-reader.js"));
        return module.mountMarkdownReader;
    }

    function rememberReturn() {
        if (returnTarget) return;
        returnTarget = document.activeElement;
        returnScroll = new Map([[scrollElement, { top: scrollElement.scrollTop, left: scrollElement.scrollLeft }]]);
        for (let element = returnTarget?.parentElement; element; element = element.parentElement) {
            if (!returnScroll.has(element)) returnScroll.set(element, { top: element.scrollTop, left: element.scrollLeft });
        }
    }

    function optionsFor(content) {
        const renderGeneration = generation;
        const neighbors = folderNeighbors();
        const navigationAvailable = baseState !== "loading" && canNavigate?.() !== false;
        return {
            readerId, state: baseState, connectionState,
            document: content ?? undefined, artifacts, selectedArtifactId, scrollElement,
            clarifications: content ? getClarifications?.(content, activeContext) ?? content.clarifications ?? [] : [],
            onClarification,
            navigationEnabled: true,
            canNavigateBack: navigationAvailable && Boolean(neighbors.back),
            canNavigateForward: navigationAvailable && Boolean(neighbors.forward),
            fragment: currentFragment || undefined,
            onSelectArtifact: (artifactId) => selectArtifact(artifactId),
            onNavigateReference: (target) => navigateReference(target),
            onNavigateHistory: (direction) => navigateSibling(direction),
            onReturnToWorkflow: () => { if (onReturn) onReturn(); else close(); },
            onRefresh: () => refresh({ renewContext: true }),
            onRendered: (event) => {
                if (renderGeneration !== generation || event.artifactId !== selectedArtifactId || event.revision !== currentDocument?.revision) return;
                if (["ready", "no-heading", "empty"].includes(baseState)) {
                    baseState = event.state;
                    container.dataset.reviewState = baseState;
                }
                if (pendingRestore) {
                    if (!currentFragment) scrollElement.scrollTop = pendingRestore.offset;
                    pendingRestore = null;
                }
            },
        };
    }

    async function showState(state, requestGeneration, content = null) {
        if (requestGeneration !== generation) return false;
        baseState = state;
        currentDocument = content;
        container.dataset.reviewState = state;
        if (activeContext) container.dataset.reviewContext = activeContext.contextId;
        try {
            const options = optionsFor(content);
            if (mounted) mounted.update(options);
            else {
                const mount = await loadMount();
                if (requestGeneration !== generation || !container.isConnected) return false;
                container.replaceChildren();
                mounted = mount(container, options);
            }
            return true;
        } catch {
            if (requestGeneration !== generation || !container.isConnected) return false;
            try { mounted?.unmount(); } catch {}
            mounted = null;
            baseState = "error";
            currentDocument = null;
            container.dataset.reviewState = "error";
            const message = document.createElement("p");
            message.setAttribute("role", "status");
            message.textContent = "The artifact could not be read. Try refreshing it.";
            container.replaceChildren(message);
            return false;
        }
    }

    function failureState(error, wasAvailable = false) {
        if (error.code === "artifact_unavailable") return wasAvailable ? "deleted" : "missing";
        if (["unsupported_artifact", "forbidden"].includes(error.code)) return "unsupported";
        if (error.code === "changed_source") return "changed";
        return "error";
    }

    async function allArtifacts(context, signal, requestGeneration) {
        const first = await json("/api/review/artifacts", { context: context.contextId }, signal);
        const items = first.items;
        let cursor = first.nextCursor;
        while (cursor) {
            if (requestGeneration !== generation) return null;
            const page = await json("/api/review/artifacts", { context: context.contextId, cursor }, signal);
            items.push(...page.items);
            cursor = page.nextCursor;
        }
        return requestGeneration === generation ? items : null;
    }

    function savePosition() {
        const entry = history[historyIndex];
        if (entry && currentDocument?.revision === entry.revision) {
            entry.scrollOffset = scrollElement.scrollTop;
            entry.logicalFragment = currentFragment;
        }
    }

    async function present(content, requestGeneration, { targetIndex, fragment = "" } = {}) {
        if (requestGeneration !== generation) return false;
        const previous = targetIndex !== undefined ? history[targetIndex] : null;
        const restore = previous?.revision === content.revision;
        currentDocument = content;
        selectedArtifactId = content.artifact.id;
        baseState = content.content.trim() ? "ready" : "empty";
        currentFragment = fragment || (restore ? previous.logicalFragment : "");
        pendingRestore = { offset: restore ? previous.scrollOffset : 0 };
        if (targetIndex !== undefined) {
            historyIndex = targetIndex;
            if (!restore) history[historyIndex] = { artifactId: content.artifact.id, revision: content.revision, scrollOffset: 0, logicalFragment: fragment };
        } else if (history[historyIndex]?.artifactId !== content.artifact.id || history[historyIndex]?.revision !== content.revision) {
            history = history.slice(0, historyIndex + 1);
            history.push({ artifactId: content.artifact.id, revision: content.revision, scrollOffset: 0, logicalFragment: fragment });
            if (history.length > 50) history.shift();
            historyIndex = history.length - 1;
        }
        mounted?.unmount();
        mounted = null;
        container.replaceChildren();
        container.dataset.reviewContext = activeContext.contextId;
        container.dataset.reviewState = baseState;
        if (await onDocument?.(content) === true) return true;
        const mount = await loadMount();
        if (requestGeneration !== generation || !container.isConnected) return false;
        mounted = mount(container, optionsFor(content));
        return true;
    }

    async function selectArtifact(artifactId, options = {}) {
        if (canNavigate?.() === false) return false;
        if (!activeContext || !artifacts.some((artifact) => artifact.id === artifactId && artifact.availability === "available")) return false;
        savePosition();
        const requestGeneration = ++generation;
        controller?.abort();
        controller = new AbortController();
        const context = activeContext;
        selectedArtifactId = artifactId;
        currentFragment = options.fragment ?? "";
        await showState("loading", requestGeneration);
        if (requestGeneration !== generation) return false;
        try {
            const content = await json("/api/review/content", { context: context.contextId, artifactId }, controller.signal);
            return await present(content, requestGeneration, options);
        } catch (error) {
            await showState(failureState(error, true), requestGeneration);
            return false;
        }
    }

    async function refresh({ renewContext = false } = {}) {
        if (canNavigate?.() === false) return false;
        if (!activeContext || !selectedArtifactId || baseState === "loading") return false;
        if (refreshing) { refreshAgain = true; renewContextQueued ||= renewContext; return false; }
        refreshing = true;
        savePosition();
        const context = activeContext;
        const artifactId = selectedArtifactId;
        const previousDocument = currentDocument;
        const priorArtifact = artifacts.find((artifact) => artifact.id === artifactId);
        const requestGeneration = ++generation;
        controller?.abort();
        controller = new AbortController();
        const signal = controller.signal;
        try {
            const nextArtifacts = await allArtifacts(context, signal, requestGeneration);
            if (!nextArtifacts || requestGeneration !== generation) return false;
            if (priorArtifact?.role === "reference" && !nextArtifacts.some((artifact) => artifact.id === artifactId)) nextArtifacts.push(priorArtifact);
            artifacts = nextArtifacts;
            const selected = artifacts.find((artifact) => artifact.id === artifactId);
            if (!selected || selected.availability !== "available") {
                return showState(previousDocument || priorArtifact?.availability === "available" ? "deleted" : "missing", requestGeneration);
            }
            let content;
            try {
                content = await json("/api/review/content", { context: context.contextId, artifactId, expectedRevision: previousDocument?.revision }, signal);
            } catch (error) {
                if (error.code !== "changed_source") throw error;
                await showState("changed", requestGeneration, previousDocument);
                if (requestGeneration !== generation) return false;
                const frame = window.requestAnimationFrame?.bind(window);
                if (frame) await new Promise((resolve) => frame(() => frame(resolve)));
                if (requestGeneration !== generation) return false;
                content = await json("/api/review/content", { context: context.contextId, artifactId }, signal);
            }
            if (requestGeneration !== generation) return false;
            if (previousDocument?.revision === content.revision && mounted) {
                currentDocument = content;
                container.dataset.reviewState = baseState;
                mounted.update(optionsFor(content));
                return true;
            }
            return await present(content, requestGeneration, { targetIndex: historyIndex >= 0 ? historyIndex : undefined, fragment: currentFragment });
        } catch (error) {
            if (error.code === "invalid_context" && renewContext && requestGeneration === generation && contextSelection) {
                return await review.open(contextSelection, { relativePath: priorArtifact?.relativePath, fragment: currentFragment });
            }
            await showState(failureState(error, Boolean(previousDocument)), requestGeneration,
                error.code === "changed_source" ? previousDocument : null);
            return false;
        } finally {
            refreshing = false;
            if (refreshAgain) {
                const retry = { renewContext: renewContextQueued };
                refreshAgain = false;
                renewContextQueued = false;
                if (activeContext === context) void refresh(retry);
            }
        }
    }

    function setConnected(connected) {
        connectionState = connected ? "connected" : "disconnected";
        mounted?.update(optionsFor(currentDocument));
    }

    function folderNeighbors() {
        const selected = artifacts.find((artifact) => artifact.id === selectedArtifactId);
        if (!selected) return {};
        const directory = selected.relativePath.slice(0, selected.relativePath.lastIndexOf("/") + 1);
        const siblings = artifacts.filter((artifact) => artifact.availability === "available" &&
            /\.(?:md|markdown)$/i.test(artifact.relativePath) &&
            artifact.relativePath.slice(0, artifact.relativePath.lastIndexOf("/") + 1) === directory)
            .sort((left, right) => left.relativePath.localeCompare(right.relativePath, "en", { numeric: true, sensitivity: "base" }) ||
                left.relativePath.localeCompare(right.relativePath, "en"));
        const index = siblings.findIndex((artifact) => artifact.id === selectedArtifactId);
        return index < 0 ? {} : { back: siblings[index - 1], forward: siblings[index + 1] };
    }

    function navigateSibling(direction) {
        if (baseState === "loading" || !["back", "forward"].includes(direction)) return false;
        const artifact = folderNeighbors()[direction];
        if (!artifact) return false;
        const targetIndex = history.findLastIndex((entry) => entry.artifactId === artifact.id);
        return selectArtifact(artifact.id, targetIndex < 0 ? {} : { targetIndex });
    }

    function navigateHistory(direction) {
        const targetIndex = historyIndex + (direction === "back" ? -1 : direction === "forward" ? 1 : 0);
        if (targetIndex < 0 || targetIndex >= history.length || targetIndex === historyIndex) return false;
        return selectArtifact(history[targetIndex].artifactId, { targetIndex });
    }

    async function navigateReference(target) {
        if (canNavigate?.() === false) return false;
        if (!activeContext || !currentDocument) return false;
        const requestGeneration = generation;
        try {
            const resolved = await json("/api/review/resolve-link", {}, controller?.signal, {
                contextId: activeContext.contextId, sourceArtifactId: currentDocument.artifact.id,
                expectedRevision: currentDocument.revision, target,
            });
            if (requestGeneration !== generation) return false;
            if (resolved.kind === "fragment") {
                currentFragment = resolved.fragment;
                mounted?.update(optionsFor(currentDocument));
            } else if (resolved.kind === "artifact") {
                const index = artifacts.findIndex((artifact) => artifact.id === resolved.artifact.id);
                if (index < 0) artifacts.push(resolved.artifact);
                else artifacts[index] = resolved.artifact;
                return selectArtifact(resolved.artifact.id, { fragment: resolved.fragment });
            } else if (resolved.kind === "external" && resolved.requiresUserAction) {
                window.open(resolved.url, "_blank", "noopener,noreferrer");
            }
            return resolved.kind !== "inert";
        } catch { return false; }
    }

    function close({ restore = true } = {}) {
        if (canNavigate?.() === false) return false;
        generation++;
        controller?.abort();
        controller = null;
        mounted?.unmount();
        mounted = null;
        activeContext = null;
        contextSelection = null;
        currentDocument = null;
        artifacts = [];
        history = [];
        historyIndex = -1;
        currentFragment = "";
        pendingRestore = null;
        selectedArtifactId = undefined;
        baseState = "idle";
        refreshAgain = false;
        renewContextQueued = false;
        container.replaceChildren();
        delete container.dataset.reviewContext;
        delete container.dataset.reviewState;
        if (restore) {
            if (returnTarget?.isConnected) returnTarget.focus({ preventScroll: true });
            for (const [element, offset] of returnScroll ?? []) {
                if (element.isConnected) { element.scrollTop = offset.top; element.scrollLeft = offset.left; }
            }
        }
        returnTarget = null;
        returnScroll = null;
    }

    const review = {
        async open(selection, recovery = {}) {
            if (canNavigate?.() === false) return false;
            rememberReturn();
            contextSelection = { ...selection };
            const requestGeneration = ++generation;
            controller?.abort();
            controller = new AbortController();
            const signal = controller.signal;
            mounted?.unmount();
            mounted = null;
            activeContext = null;
            currentDocument = null;
            artifacts = [];
            history = [];
            historyIndex = -1;
            selectedArtifactId = undefined;
            currentFragment = "";
            pendingRestore = null;
            baseState = "loading";
            delete container.dataset.reviewContext;
            container.textContent = "Loading artifact...";
            container.dataset.reviewState = "loading";
            try {
                const context = await json("/api/review/context", selection, signal);
                if (requestGeneration !== generation) return false;
                activeContext = context;
                selectedArtifactId = context.primaryArtifactId;
                artifacts = context.items;
                let cursor = context.nextCursor;
                while (cursor) {
                    const page = await json("/api/review/artifacts", { context: context.contextId, cursor }, signal);
                    if (requestGeneration !== generation) return false;
                    artifacts.push(...page.items);
                    cursor = page.nextCursor;
                }
                if (recovery.relativePath) {
                    selectedArtifactId = artifacts.find((artifact) => artifact.relativePath === recovery.relativePath)?.id;
                    if (!selectedArtifactId) return showState("missing", requestGeneration);
                }
                const content = await json("/api/review/content", { context: context.contextId, artifactId: selectedArtifactId }, signal);
                return await present(content, requestGeneration, { fragment: recovery.fragment });
            } catch (error) {
                if (requestGeneration !== generation || signal.aborted) return false;
                await showState(failureState(error), requestGeneration);
                return false;
            }
        },
        close,
        selectArtifact,
        navigateHistory,
        navigateReference,
        refresh,
        setConnected,
        updateControls() { mounted?.update(optionsFor(currentDocument)); },
        async validateClarifications(answers, commandName) {
            if (!activeContext || !currentDocument) throw reviewError("invalid_context");
            return json("/api/review/validate-clarifications", {}, controller?.signal, {
                contextId: activeContext.contextId, artifactId: currentDocument.artifact.id,
                expectedRevision: currentDocument.revision, answers, commandName,
            });
        },
        get history() { return history.map((entry) => ({ ...entry })); },
        get document() { return currentDocument; },
        get context() { return activeContext; },
    };
    return review;
}
