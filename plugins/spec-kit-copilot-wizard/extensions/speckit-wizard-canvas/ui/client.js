// Consolidated client + net stack: HTTP helpers, SSE dispatch, snapshot messaging.
// Also owns the tiny renderCwd DOM helper so every module can import it
// without pulling app.js (which would create a circular init).

import {
    state,
    TOKEN,
    currentFilter,
    currentExtensionFilter,
    currentBundleFilter,
} from "./state.js";
// The message router touches every renderer. Everything below is imported
// lazily-safe (used only inside handleServerMessage bodies at SSE-event
// time, not at module load) so the circular edges between client.js and
// the render layer resolve cleanly.
import {
    renderStepper,
    renderPhaseCard,
    renderEnvironmentCard,
} from "./phase-card.js";
import {
    renderComposition,
    updateCompositionRefreshButton,
} from "./composition.js";
import {
    renderCatalog,
    renderExtensionCatalog,
    renderBundleCatalog,
} from "./catalog.js";
import {
    observePhaseProgress,
    renderPipelineBanner,
    maybeRequestArtifactInference,
} from "./phase-runtime.js";

// -------- Section: client.mjs --------

// Shared browser transport for the wizard UI.
//
// This module deliberately knows nothing about the wizard's state shape or
// renderers. The caller owns error display and server-message handling.

export function createClient({
    token,
    onError = () => {},
    onMessage = () => {},
    onConnectionChange = () => {},
} = {}) {
    const headers = {
        "Content-Type": "application/json",
        "X-Canvas-Token": token ?? "",
    };

    async function postJson(path, body) {
        try {
            const res = await fetch(`${path}?token=${encodeURIComponent(token ?? "")}`, {
                method: "POST",
                headers,
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                const text = await res.text().catch(() => "");
                throw new Error(`${res.status} ${text}`);
            }
            return await res.json().catch(() => ({}));
        } catch (err) {
            onError(path, err);
            return undefined;
        }
    }

    function connectSse() {
        let attempt = 0;
        let current = null;
        let closed = false;

        function open() {
            if (closed) return null;
            const es = new EventSource(`/api/events?token=${encodeURIComponent(token ?? "")}`);
            es.onopen = () => {
                attempt = 0;
                onConnectionChange("live");
            };
            es.onerror = () => {
                onConnectionChange("reconnecting");
                // Browser EventSource retries transient failures on its own,
                // but when the server drops the connection permanently (e.g.
                // token rejected, process restarted) the readyState settles
                // on CLOSED and no further retries happen. Force a fresh
                // EventSource in that case with exponential backoff.
                if (es.readyState === EventSource.CLOSED) {
                    try { es.close(); } catch { /* ignore */ }
                    const delay = Math.min(30000, 1000 * Math.pow(2, attempt++));
                    setTimeout(() => {
                        if (!closed) current = open();
                    }, delay);
                }
            };
            es.onmessage = (event) => {
                try {
                    onMessage(JSON.parse(event.data));
                } catch {
                    // Ignore malformed events; the next state event repairs the UI.
                }
            };
            return es;
        }

        current = open();
        return {
            close() {
                closed = true;
                try { current?.close(); } catch { /* ignore */ }
            },
        };
    }

    return Object.freeze({ headers, postJson, connectSse });
}

export function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => (
        { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]
    ));
}

// safeExternalHref returns an escaped URL suitable for an <a href="..."> attribute,
// or "" if the scheme is anything other than http/https/mailto. Blocks
// `javascript:`, `data:`, `vbscript:`, etc. from third-party catalog manifests
// (repository/homepage fields) whose values reach the DOM.
export function safeExternalHref(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return "";
    if (!/^(https?:|mailto:)/i.test(raw)) return "";
    return escapeHtml(raw);
}

// -------- Section: render helpers (renderCwd) --------

export function renderCwd() {
    const el = document.getElementById("comp-cwd");
    if (!el) return;
    el.textContent = state.snapshot?.workspacePath ?? "this project";
}


// -------- Section: net/dispatch.js --------

let __postJson = null;

export function setPostJson(fn) {
    __postJson = fn;
}

export async function dispatchKind(kind, payload) {
    return __postJson("/api/prompt", { kind, payload });
}

// -------- Snapshot waiter: await an agent-driven state transition --------
//
// dispatchKind() only awaits the /api/prompt HTTP POST — it returns as soon
// as the prompt is queued, NOT when the agent turn completes. That is a
// problem for multi-step flows like `runInit` where step N+1
// (skills.reload) depends on step N (setup.init) having actually finished
// writing files and updating state.json.
//
// waitForSnapshot(predicate, opts) registers a predicate that is evaluated
// on every subsequent "state" broadcast. It resolves with the first
// snapshot that satisfies the predicate, or rejects with a timeout error
// after opts.timeoutMs (default 5 min).
export function waitForSnapshot(predicate, { timeoutMs = 5 * 60 * 1000 } = {}) {
    // Fast path: current snapshot already satisfies.
    try {
        if (predicate(state.snapshot)) return Promise.resolve(state.snapshot);
    } catch (_e) { /* predicate errors treated as "not yet" */ }
    return new Promise((resolve, reject) => {
        const entry = { predicate, resolve, reject, timer: null };
        entry.timer = setTimeout(() => {
            const idx = state.snapshotWaiters.indexOf(entry);
            if (idx >= 0) state.snapshotWaiters.splice(idx, 1);
            reject(new Error(`waitForSnapshot: timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        state.snapshotWaiters.push(entry);
    });
}

export function resolveSnapshotWaiters() {
    if (!state.snapshotWaiters.length) return;
    const snap = state.snapshot;
    const stillWaiting = [];
    for (const entry of state.snapshotWaiters) {
        let hit = false;
        try { hit = !!entry.predicate(snap); } catch (_e) { hit = false; }
        if (hit) {
            clearTimeout(entry.timer);
            entry.resolve(snap);
        } else {
            stillWaiting.push(entry);
        }
    }
    state.snapshotWaiters = stillWaiting;
}


// -------- Section: net/messages.js --------

let __render = () => {};
let __refreshState = async () => {};

export function setMessagesDeps({ render, refreshState } = {}) {
    if (typeof render === "function") __render = render;
    if (typeof refreshState === "function") __refreshState = refreshState;
}
export function handleServerMessage(msg) {
    switch (msg.type) {
        case "state":
            // A reconnect or legacy broadcaster can emit a state envelope
            // without a usable snapshot. Never replace a valid UI state with
            // undefined; the next valid broadcast or refresh will repair it.
            if (!msg.data || typeof msg.data !== "object") break;
            state.snapshot = msg.data;
            // Preserve local navigation. The user's active phase is a UI
            // concern; a state broadcast triggered by an artifact write
            // (or any background refresh) must not yank them back to
            // whatever currentPhase happens to be persisted on disk.
            // __refreshState() sets currentPhase on initial load; clicks
            // in the stepper set it explicitly. Only adopt the server's
            // value here when we don't have one yet.
            if (!state.currentPhase) {
                state.currentPhase = msg.data.currentPhase || null;
            }
            observePhaseProgress();
            maybeRequestArtifactInference();
            resolveSnapshotWaiters();
            __render();
            break;
        case "invalidate":
            // Server-side data (e.g. artifact-targets cache) changed
            // outside the normal state flow — pull a fresh snapshot so
            // the phase cards reflect it. Fire-and-forget: refreshState
            // handles its own errors.
            __refreshState();
            break;
        case "composition":
            if (state.snapshot) {
                state.snapshot.composition = {
                    presets: msg.presets ?? [],
                    extensions: msg.extensions ?? [],
                    artifacts: msg.artifacts ?? [],
                    refreshedAt: msg.refreshedAt ?? null,
                };
                // Preserve the LLM-inferred pipeline so pipelineItems()
                // renders the extension/preset flow instead of falling back
                // to the canonical spine. Same silent-drop bug as the
                // server-side snapshot overlay used to have.
                if (msg.inferredPipeline && typeof msg.inferredPipeline === "object") {
                    state.snapshot.composition.inferredPipeline = msg.inferredPipeline;
                }
                // Per-phase execution reports (populated by
                // `showExecutionReport`, broadcast on the same "composition"
                // SSE channel). The full map arrives with every broadcast —
                // replace, don't merge, so deletions propagate.
                if (msg.executionReports && typeof msg.executionReports === "object") {
                    state.snapshot.composition.executionReports = msg.executionReports;
                } else if (Object.prototype.hasOwnProperty.call(msg, "executionReports")) {
                    // Explicit null/undefined in the payload → clear.
                    delete state.snapshot.composition.executionReports;
                }
            }
            state.compositionRequested = false;
            updateCompositionRefreshButton();
            renderComposition();
            // The pipeline stepper and active phase card read from
            // composition.inferredPipeline via pipelineItems(); refresh
            // them here so the visualization updates as soon as the
            // composition broadcast lands, without waiting on the
            // follow-up state broadcast.
            renderStepper();
            renderPhaseCard();
            renderPipelineBanner();
            break;
        case "preset-catalog":
            if (state.snapshot) {
                const prev = state.snapshot.catalog ?? {};
                state.snapshot.catalog = { ...prev, presets: msg.items };
            }
            // Clear pending markers only for presets whose broadcast state
            // matches the expected post-action state. This preserves pending
            // spinners on other still-in-flight installs/removes when the
            // user queues multiple actions.
            {
                if (state.pendingPresetActions && Object.keys(state.pendingPresetActions).length) {
                    for (const [pid, kind] of Object.entries(state.pendingPresetActions)) {
                        const p = (msg.items ?? []).find((x) => (x.id ?? x.name) === pid);
                        if (!p) continue;
                        if ((kind === "install" && p.active) || (kind === "remove" && !p.active)) {
                            delete state.pendingPresetActions[pid];
                        }
                    }
                }
                renderCatalog(state.snapshot, currentFilter());
                // Setup row 5 (defaultPresetsInstalled) is derived from the
                // catalog snapshot, so refresh the environment card and let
                // runInstallDefaults()'s waitForSnapshot predicate resolve.
                renderEnvironmentCard();
                resolveSnapshotWaiters();
                // Intentionally do NOT auto-dispatch `setup.reloadSkills` here.
                // The fast composition assembler re-runs automatically when
                // the catalog re-fetches, so preset install/remove flows to
                // the Composition tab without extra work. The user clicks
                // "Refresh now" in the Composition tab to fire
                // `composition.refresh` (whose Wave D handles skill-reload
                // verification and flips `setup.skillsReloaded`).
            }
            break;
        case "extension-catalog":
            if (state.snapshot) {
                const prev = state.snapshot.catalog ?? {};
                state.snapshot.catalog = { ...prev, extensions: msg.items };
            }
            {
                if (state.pendingExtensionActions && Object.keys(state.pendingExtensionActions).length) {
                    for (const [eid, kind] of Object.entries(state.pendingExtensionActions)) {
                        const e = (msg.items ?? []).find((x) => (x.id ?? x.name) === eid);
                        if (!e) continue;
                        if ((kind === "install" && e.active) || (kind === "remove" && !e.active)) {
                            delete state.pendingExtensionActions[eid];
                        }
                    }
                }
                renderExtensionCatalog(state.snapshot, currentExtensionFilter());
                // Extension install/remove/swap changes the composition layer
                // stack. Do NOT auto-fire `setup.reloadSkills` here;
                // the user clicks Refresh in the Composition tab to trigger
                // `composition.refresh` which handles skill-reload
                // verification as its Wave D final step.
            }
            break;
        case "bundle-catalog":
            if (state.snapshot) {
                const prev = state.snapshot.catalog ?? {};
                state.snapshot.catalog = { ...prev, bundles: msg.items };
            }
            {
                if (state.pendingBundleActions && Object.keys(state.pendingBundleActions).length) {
                    for (const [bid, kind] of Object.entries(state.pendingBundleActions)) {
                        const b = (msg.items ?? []).find((x) => (x.id ?? x.name) === bid);
                        if (!b) continue;
                        if ((kind === "install" && b.active) || (kind === "remove" && !b.active)) {
                            delete state.pendingBundleActions[bid];
                        }
                    }
                }
                renderBundleCatalog(state.snapshot, currentBundleFilter());
            }
            break;
        default:
            break;
    }
}

