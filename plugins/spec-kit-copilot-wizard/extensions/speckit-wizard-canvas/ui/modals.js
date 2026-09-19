// Consolidated modal + markdown stack. All UI overlays live here.

import { state, TOKEN } from "./state.js";
import { escapeHtml, safeExternalHref } from "./client.js";
import { renderMarkdown } from "../shared-workflow-ui/markdown.mjs";
export { renderMarkdown } from "../shared-workflow-ui/markdown.mjs";
import { clarificationKey, createClarificationQueue, wizardClarificationScope } from "../shared-workflow-ui/clarifications.mjs";
import { observationMessage, refreshDraftControls, selectedDrafts } from "../shared-workflow-ui/clarification-controls.mjs";

// -------- Section: modals/confirm.js --------

// Small anchored confirm popover — appears right next to the trigger button,
// no backdrop, no dimming. Click outside or Escape dismisses.
export function popoverConfirm(anchorEl, message, { confirmLabel = "Remove", cancelLabel = "Cancel" } = {}) {
    return new Promise((resolve) => {
        // Close any existing popover so only one is open at a time.
        document.querySelectorAll(".confirm-popover").forEach((n) => n.remove());
        const pop = document.createElement("div");
        pop.className = "confirm-popover";
        pop.setAttribute("role", "dialog");
        pop.innerHTML = `
            <span class="confirm-popover-msg"></span>
            <button type="button" class="btn btn-ghost btn-xs confirm-popover-cancel">${escapeHtml(cancelLabel)}</button>
            <button type="button" class="btn btn-primary btn-xs confirm-popover-ok">${escapeHtml(confirmLabel)}</button>
            <span class="confirm-popover-arrow"></span>
        `;
        pop.querySelector(".confirm-popover-msg").textContent = message;
        document.body.appendChild(pop);
        // Position below the anchor; flip above if not enough room.
        const r = anchorEl.getBoundingClientRect();
        const pr = pop.getBoundingClientRect();
        const margin = 6;
        let top = r.bottom + margin;
        let flip = false;
        if (top + pr.height > window.innerHeight - 8) {
            top = r.top - pr.height - margin;
            flip = true;
        }
        let left = r.left + r.width / 2 - pr.width / 2;
        left = Math.max(8, Math.min(left, window.innerWidth - pr.width - 8));
        pop.style.top = `${Math.round(top + window.scrollY)}px`;
        pop.style.left = `${Math.round(left + window.scrollX)}px`;
        if (flip) pop.classList.add("above");
        const finish = (ok) => {
            document.removeEventListener("keydown", onKey, true);
            document.removeEventListener("mousedown", onOutside, true);
            pop.remove();
            resolve(ok);
        };
        const onKey = (ev) => {
            if (ev.key === "Escape") { ev.preventDefault(); finish(false); }
            else if (ev.key === "Enter") { ev.preventDefault(); finish(true); }
        };
        const onOutside = (ev) => {
            if (pop.contains(ev.target) || ev.target === anchorEl) return;
            finish(false);
        };
        pop.querySelector(".confirm-popover-cancel").addEventListener("click", () => finish(false));
        pop.querySelector(".confirm-popover-ok").addEventListener("click", () => finish(true));
        document.addEventListener("keydown", onKey, true);
        // Defer outside listener so the click that opened us doesn't dismiss.
        setTimeout(() => document.addEventListener("mousedown", onOutside, true), 0);
        pop.querySelector(".confirm-popover-ok").focus();
    });
}

// Sandboxed extension iframes commonly block window.confirm/alert, so use a
// lightweight in-DOM modal instead. Returns a Promise<boolean>.
export function confirmModal(message, { confirmLabel = "Remove", cancelLabel = "Cancel", danger = true } = {}) {
    return new Promise((resolve) => {
        const overlay = document.createElement("div");
        overlay.className = "modal-overlay";
        overlay.setAttribute("role", "dialog");
        overlay.setAttribute("aria-modal", "true");
        overlay.innerHTML = `
            <div class="modal-card" role="document">
                <p class="modal-message"></p>
                <div class="modal-actions">
                    <button type="button" class="btn btn-ghost modal-cancel">${escapeHtml(cancelLabel)}</button>
                    <button type="button" class="btn ${danger ? "btn-danger" : "btn-primary"} modal-confirm">${escapeHtml(confirmLabel)}</button>
                </div>
            </div>`;
        overlay.querySelector(".modal-message").textContent = message;
        const finish = (ok) => {
            document.removeEventListener("keydown", onKey);
            overlay.remove();
            resolve(ok);
        };
        const onKey = (ev) => {
            if (ev.key === "Escape") { ev.preventDefault(); finish(false); }
            else if (ev.key === "Enter") { ev.preventDefault(); finish(true); }
        };
        overlay.querySelector(".modal-cancel").addEventListener("click", () => finish(false));
        overlay.querySelector(".modal-confirm").addEventListener("click", () => finish(true));
        overlay.addEventListener("click", (ev) => { if (ev.target === overlay) finish(false); });
        document.addEventListener("keydown", onKey);
        document.body.appendChild(overlay);
        overlay.querySelector(".modal-confirm").focus();
    });
}


// -------- Section: modals/community-install.js --------

// community-install.js — confirm-before-install modal for third-party
// (non-GitHub) presets and extensions. Falls back to window.confirm if
// the HTML shell for the modal isn't present in the DOM.

export function openCommunityInstallModal({ displayName, onConfirm, kind }) {
    const kindWord = kind === "extension" ? "extension" : "preset";
    const learnHref = kind === "extension"
        ? "https://github.com/github/spec-kit/blob/main/extensions/README.md"
        : "https://github.com/github/spec-kit/blob/main/presets/README.md";
    const modal = document.getElementById("community-install-modal");
    if (!modal) {
        if (window.confirm(`Install community ${kindWord} "${displayName}"?\n\nCommunity ${kindWord}s are contributed by third parties and are not reviewed, audited, or endorsed by GitHub. Install only if you trust the source.`)) {
            onConfirm();
        }
        return;
    }
    const titleEl = modal.querySelector("#cim-title");
    const nameEl = modal.querySelector("#cim-preset-name");
    const kindWordEl = modal.querySelector("#cim-kind-word");
    const learnLink = modal.querySelector("#cim-learn-link");
    const okBtn = modal.querySelector("#cim-confirm");
    const cancelBtns = modal.querySelectorAll("[data-modal-close]");
    if (titleEl) titleEl.textContent = `Install community ${kindWord}?`;
    if (nameEl) nameEl.textContent = displayName;
    if (kindWordEl) kindWordEl.textContent = `${kindWord}s`;
    if (learnLink) learnLink.href = learnHref;
    modal.hidden = false;
    const close = () => { modal.hidden = true; };
    const confirm = () => { close(); onConfirm(); };
    // Reset listeners by cloning the confirm button.
    const newOk = okBtn.cloneNode(true);
    okBtn.replaceWith(newOk);
    newOk.addEventListener("click", confirm, { once: true });
    cancelBtns.forEach((b) => {
        const nb = b.cloneNode(true);
        b.replaceWith(nb);
        nb.addEventListener("click", close, { once: true });
    });
    const escHandler = (e) => {
        if (e.key === "Escape") { close(); document.removeEventListener("keydown", escHandler); }
    };
    document.addEventListener("keydown", escHandler);
}


// -------- Section: modals/wizard-modal.js --------

// Module-scoped singleton so closeWizardModal() from anywhere shuts the
// current modal — same behavior as the original app.js-level `let`.
let __wizardModalCloser = null;

export function closeWizardModal() {
    if (typeof __wizardModalCloser === "function") {
        try { __wizardModalCloser(); } catch { /* ignore */ }
    }
    __wizardModalCloser = null;
}

export function openWizardModal(opts) {
    closeWizardModal();
    const root = document.getElementById("wizard-modal-root");
    if (!root) return;

    const {
        title, description = "", questionBox = "", textareaLabel = "Input",
        placeholder = "", initialValue = "", required = false,
        cancelLabel = "Cancel", confirmLabel, extraButtons = [], onConfirm,
    } = opts || {};

    const backdrop = document.createElement("div");
    backdrop.className = "wizard-modal-backdrop";
    backdrop.innerHTML = `
        <div class="wizard-modal" role="dialog" aria-modal="true" aria-labelledby="wm-title">
            <header class="wizard-modal-head">
                <h3 id="wm-title">${escapeHtml(title || "")}</h3>
                <button class="btn-icon wizard-modal-close" aria-label="Close">✕</button>
            </header>
            <div class="wizard-modal-body">
                ${description ? `<p class="wizard-modal-desc">${escapeHtml(description)}</p>` : ""}
                ${questionBox ? `<div class="wizard-modal-question">${escapeHtml(questionBox)}</div>` : ""}
                <label class="wizard-modal-field">
                    <span class="wizard-modal-field-label">${escapeHtml(textareaLabel)}</span>
                    <textarea class="wizard-modal-textarea" placeholder="${escapeHtml(placeholder)}"></textarea>
                </label>
            </div>
            <footer class="wizard-modal-foot">
                <button class="btn btn-secondary btn-sm wizard-modal-cancel">${escapeHtml(cancelLabel)}</button>
                <span class="wizard-modal-extras"></span>
                <button class="btn btn-primary btn-sm wizard-modal-confirm">${escapeHtml(confirmLabel || "Confirm")}</button>
            </footer>
        </div>
    `;
    root.appendChild(backdrop);

    const ta = backdrop.querySelector(".wizard-modal-textarea");
    const confirmBtn = backdrop.querySelector(".wizard-modal-confirm");
    const cancelBtn = backdrop.querySelector(".wizard-modal-cancel");
    const closeBtn = backdrop.querySelector(".wizard-modal-close");
    const extrasHost = backdrop.querySelector(".wizard-modal-extras");

    if (ta) {
        ta.value = initialValue;
        setTimeout(() => ta.focus(), 0);
    }

    // Extra buttons between Cancel and Confirm.
    for (const btn of extraButtons) {
        const b = document.createElement("button");
        b.className = btn.className || "btn btn-ghost btn-sm";
        b.type = "button";
        b.textContent = btn.label || "";
        b.addEventListener("click", () => btn.onClick?.(close));
        extrasHost.appendChild(b);
    }

    const syncConfirmDisabled = () => {
        if (!required) return;
        confirmBtn.disabled = !ta?.value.trim();
    };
    syncConfirmDisabled();
    ta?.addEventListener("input", syncConfirmDisabled);

    let closed = false;
    const close = () => {
        if (closed) return;
        closed = true;
        document.removeEventListener("keydown", onKey);
        backdrop.remove();
        if (__wizardModalCloser === close) __wizardModalCloser = null;
    };
    const onKey = (e) => {
        if (e.key === "Escape") { e.preventDefault(); close(); }
    };
    document.addEventListener("keydown", onKey);

    cancelBtn.addEventListener("click", close);
    closeBtn.addEventListener("click", close);
    backdrop.addEventListener("click", (e) => {
        if (e.target === backdrop) close();
    });
    confirmBtn.addEventListener("click", async () => {
        if (confirmBtn.disabled) return;
        const value = ta?.value ?? "";
        confirmBtn.disabled = true;
        try {
            await onConfirm?.(value, close);
        } finally {
            // If handler didn't close, re-enable so user can retry.
            if (!closed) confirmBtn.disabled = false;
        }
    });

    __wizardModalCloser = close;
}


// -------- Section: modals/viewers.js --------

let __postJson = async () => { throw new Error("viewers: postJson not injected"); };
let __HEADERS = {};

export function setViewersDeps({ postJson, HEADERS } = {}) {
    if (postJson) __postJson = postJson;
    if (HEADERS) __HEADERS = HEADERS;
}
let activeArtifactView = null;
const amendmentPolls = new Map();
export const clarificationDrafts = createClarificationQueue({
    getItem: (key) => globalThis.localStorage?.getItem(key),
    setItem: (key, value) => globalThis.localStorage?.setItem(key, value),
});
export function artifactContext(p) {
    return Object.freeze({
        scope: wizardClarificationScope(state.snapshot?.workspacePath),
        phase: p.commandName || `speckit.${p.id}`,
        artifact: p.artifactPath,
    });
}
export function flushClarifications(view) {
    return clarificationDrafts.flush(view.context, {
        content: view.content,
        markers: selectedDrafts(view, clarificationDrafts).map((entry) => entry.marker),
        dispatch: (input) => __postJson("/api/artifact/amend", { ...input, scope: view.context.scope }),
    });
}

function currentArtifactView(view) {
    return activeArtifactView && clarificationKey(activeArtifactView.context) === clarificationKey(view.context)
        ? activeArtifactView : view;
}

function refreshClarificationControls(view) {
    if (activeArtifactView !== view) return;
    refreshDraftControls(document.getElementById("phase-artifact-viewer"), view, clarificationDrafts, {
        apply: async () => {
            try {
                const request = flushClarifications(view);
                refreshClarificationControls(view);
                const outcome = await request;
                const current = currentArtifactView(view);
                current.message = outcome.accepted
                    ? "Submitted; waiting for an artifact update. Drafts remain editable."
                    : `${outcome.result?.error || "Could not submit the amendment."} Drafts retained.`;
                refreshClarificationControls(current);
                await refreshArtifactViewer(current);
                if (outcome.accepted) pollArtifactAmendment(current);
            } catch (error) {
                const current = currentArtifactView(view);
                current.message = `${error.message} Drafts retained; retry when ready.`;
                refreshClarificationControls(current);
            }
        },
    });
}

export async function refreshArtifactViewer(view = activeArtifactView) {
    if (!view || view.reading) return;
    if (view.context.scope !== wizardClarificationScope(state.snapshot?.workspacePath)) return;
    const token = clarificationDrafts.observationToken(view.context);
    view.reading = true;
    try {
        const url = `/api/artifact?p=${encodeURIComponent(view.context.artifact)}&scope=${encodeURIComponent(view.context.scope)}&token=${encodeURIComponent(TOKEN)}`;
        const res = await fetch(url, { headers: __HEADERS });
        if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => "")}`);
        const text = await res.text();
        if (view.context.scope !== wizardClarificationScope(state.snapshot?.workspacePath)) return;
        const observed = clarificationDrafts.observe(view.context, text, token);
        if (observed) view.message = observationMessage(observed);
        if (activeArtifactView !== view) return;
        const body = document.getElementById("phase-artifact-viewer").querySelector(".artifact-viewer-body");
        if (text.trim() && view.content !== text) {
            const scroll = body.scrollTop;
            view.content = text;
            view.marks = [];
            body.innerHTML = `<div class="artifact-viewer-md">${renderMarkdown(text, { clarifications: view.marks })}</div>`;
            body.scrollTop = scroll;
            body.querySelectorAll("[data-clarify-idx]").forEach((button) => {
                button.addEventListener("click", () => openClarifyModal(view, view.marks[Number(button.dataset.clarifyIdx)]));
            });
        }
        refreshClarificationControls(view);
    } catch (error) {
        view.message = `Could not refresh the artifact: ${error.message}. Drafts retained; automatic refresh will retry.`;
        refreshClarificationControls(view);
    } finally { view.reading = false; }
}

function pollArtifactAmendment(view) {
    const key = clarificationKey(view.context);
    if (activeArtifactView && clarificationKey(activeArtifactView.context) === key) view = activeArtifactView;
    clearTimeout(amendmentPolls.get(key));
    amendmentPolls.delete(key);
    if (!clarificationDrafts.isPending(view.context) || view.context.scope !== wizardClarificationScope(state.snapshot?.workspacePath)) return;
    const timer = setTimeout(async () => {
        await refreshArtifactViewer(view);
        pollArtifactAmendment(view);
    }, 2000);
    timer.unref?.();
    amendmentPolls.set(key, timer);
}

export async function openArtifactViewer(p) {
    const root = document.getElementById("phase-artifact-viewer");
    if (!root) return;
    const folder = p?.artifactPath?.endsWith("/") ? p.artifactPath : !p?.artifactPath ? p?.folderPath : null;
    if (folder) return openFolderBrowser(p, folder.replace(/\/$/, ""));
    if (!p?.artifactPath) return;

    const view = { context: artifactContext(p), content: null, marks: [], message: "" };
    activeArtifactView = view;
    root.hidden = false;
    root.innerHTML = `
        <div class="artifact-viewer-header">
            <button class="btn btn-ghost btn-sm artifact-viewer-back">← Wizard</button>
            <div class="artifact-viewer-title">
                <h2>${escapeHtml(p.shortLabel || p.title || p.id)}</h2>
                <code class="muted">${escapeHtml(p.artifactPath)}</code>
            </div>
        </div>
        <div class="artifact-viewer-clarify-banner" hidden></div>
        <div class="artifact-viewer-body">
            <p class="muted">Loading…</p>
        </div>
    `;
    root.querySelector(".artifact-viewer-back")?.addEventListener("click", closeArtifactViewer);

    await refreshArtifactViewer(view);
    pollArtifactAmendment(view);
}
export async function closeArtifactViewer() {
    const root = document.getElementById("phase-artifact-viewer");
    activeArtifactView = null;
    if (!root) return;
    root.hidden = true;
    root.innerHTML = "";
}

// Portable-path dirname: given a POSIX-style workspace-relative path like
// ".specify/assessments/foo/intake.md" return ".specify/assessments/foo".
// Returns "" when the input has no separator (top-level file).
// Folder browser overlay — fallback for when the inferred artifact filename
// is wrong. Lists .md files under a folder via /api/artifact-list, and each
// row opens that file in the artifact viewer. Reuses the same overlay so
// there's a single "Back to Wizard" affordance regardless of which mode.
export async function openFolderBrowser(p, folderPath) {
    activeArtifactView = null;
    const root = document.getElementById("phase-artifact-viewer");
    if (!root || !folderPath) return;
    root.hidden = false;
    root.innerHTML = `
        <div class="artifact-viewer-header">
            <button class="btn btn-ghost btn-sm artifact-viewer-back">← Wizard</button>
            <div class="artifact-viewer-title">
                <h2>${escapeHtml(p?.shortLabel || p?.title || p?.id || "Artifacts")}</h2>
                <code class="muted">${escapeHtml(folderPath)}/</code>
            </div>
        </div>
        <div class="artifact-viewer-body">
            <p class="muted">Loading folder…</p>
        </div>
    `;
    root.querySelector(".artifact-viewer-back")?.addEventListener("click", closeArtifactViewer);

    let payload = null;
    try {
        const url = `/api/artifact-list?p=${encodeURIComponent(folderPath)}&token=${encodeURIComponent(TOKEN)}`;
        const res = await fetch(url, { headers: __HEADERS });
        if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => "")}`);
        payload = await res.json();
    } catch (err) {
        const body = root.querySelector(".artifact-viewer-body");
        if (body) body.innerHTML = `<p class="wizard-modal-error">Failed to list folder: ${escapeHtml(String(err?.message ?? err))}</p>`;
        return;
    }

    const files = Array.isArray(payload?.files) ? payload.files : [];
    const body = root.querySelector(".artifact-viewer-body");
    if (!body) return;
    if (!files.length) {
        body.innerHTML = `<p class="muted">No <code>.md</code> files in this folder yet.</p>`;
        return;
    }
    const rows = files.map((f) => {
        const rel = `${folderPath}/${f.name}`;
        return `<li><button type="button" class="phase-artifact-link folder-file" data-rel="${escapeHtml(rel)}"><code>${escapeHtml(f.name)}</code></button></li>`;
    }).join("");
    body.innerHTML = `<ul class="folder-browser-list">${rows}</ul>`;
    body.querySelectorAll(".folder-file").forEach((btn) => {
        btn.addEventListener("click", () => {
            const rel = btn.getAttribute("data-rel");
            if (rel) openArtifactViewer({ ...p, artifactPath: rel });
        });
    });
}

// Command viewer overlay — reuses the artifact viewer's DOM/CSS to display
// a command markdown file inline with a Back-to-Wizard button.
export async function openCommandViewer(sourcePath, title) {
    const root = document.getElementById("phase-artifact-viewer");
    if (!root || !sourcePath) return;
    activeArtifactView = null;
    root.hidden = false;
    root.innerHTML = `
        <div class="artifact-viewer-header">
            <button class="btn btn-ghost btn-sm artifact-viewer-back">← Wizard</button>
            <div class="artifact-viewer-title">
                <h2>${escapeHtml(title || sourcePath)}</h2>
                <code class="muted">${escapeHtml(sourcePath)}</code>
            </div>
        </div>
        <div class="artifact-viewer-body">
            <p class="muted">Loading…</p>
        </div>
    `;
    root.querySelector(".artifact-viewer-back")?.addEventListener("click", closeArtifactViewer);
    // Fetch with a hard timeout so a hung request never leaves the viewer
    // stuck on "Loading…" — user can always click Back.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    try {
        const url = `/api/artifact?p=${encodeURIComponent(sourcePath)}&token=${encodeURIComponent(TOKEN)}`;
        const res = await fetch(url, { headers: __HEADERS, signal: controller.signal });
        if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => "")}`);
        const text = await res.text();
        const body = root.querySelector(".artifact-viewer-body");
        if (body) body.innerHTML = `<div class="artifact-viewer-md">${renderMarkdown(text)}</div>`;
    } catch (err) {
        const msg = err?.name === "AbortError" ? "request timed out after 10s" : String(err?.message ?? err);
        const body = root.querySelector(".artifact-viewer-body");
        if (body) body.innerHTML = `<p class="wizard-modal-error">Failed to load command: ${escapeHtml(msg)}</p>`;
    } finally {
        clearTimeout(timeoutId);
    }
}

// Catalog JSON viewer — fetches locally-cached preset catalog JSON by remote
// URL and renders it in the same overlay as a JSON code block.
export async function openCatalogViewer(remoteUrl, title) {
    const root = document.getElementById("phase-artifact-viewer");
    if (!root || !remoteUrl) return;
    activeArtifactView = null;
    root.hidden = false;
    root.innerHTML = `
        <div class="artifact-viewer-header">
            <button class="btn btn-ghost btn-sm artifact-viewer-back">← Wizard</button>
            <div class="artifact-viewer-title">
                <h2>${escapeHtml(title || "catalog")}</h2>
                <code class="muted">${escapeHtml(remoteUrl)}</code>
            </div>
        </div>
        <div class="artifact-viewer-body">
            <p class="muted">Loading…</p>
        </div>
    `;
    root.querySelector(".artifact-viewer-back")?.addEventListener("click", closeArtifactViewer);
    try {
        const url = `/api/catalog-cache?url=${encodeURIComponent(remoteUrl)}&token=${encodeURIComponent(TOKEN)}`;
        const res = await fetch(url, { headers: __HEADERS });
        if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => "")}`);
        const text = await res.text();
        // Pretty-print JSON for readability, fall back to raw text.
        let display = text;
        try { display = JSON.stringify(JSON.parse(text), null, 2); } catch { /* keep raw */ }
        const body = root.querySelector(".artifact-viewer-body");
        if (body) body.innerHTML = `<pre class="artifact-viewer-json"><code>${escapeHtml(display)}</code></pre>`;
    } catch (err) {
        const body = root.querySelector(".artifact-viewer-body");
        if (body) body.innerHTML = `<p class="wizard-modal-error">Failed to load catalog: ${escapeHtml(String(err?.message ?? err))}</p>`;
    }
}

// -----------------------------------------------------------------------
// Redo confirm modal (screenshot 2)
// -----------------------------------------------------------------------
export function openRedoModal(p, draftOverride) {
    // Thin shim for callers that still target the modal-style redo API.
    // The phase-card UI uses an anchored yes/no popover.
    void p; void draftOverride;
}

// -----------------------------------------------------------------------
// Resolve clarification modal (screenshot 4)
//
// Saving a draft never dispatches work or changes phase status.
// -----------------------------------------------------------------------
export function openClarifyModal(view, { question, marker }) {
    openWizardModal({
        title: "Resolve clarification",
        description: "Save a draft, then choose Apply answers to amend this artifact without rerunning the phase.",
        questionBox: question,
        textareaLabel: "Your answer",
        required: true,
        initialValue: clarificationDrafts.list(view.context).find((entry) => entry.marker === marker)?.answer ?? "",
        confirmLabel: "Save draft",
        onConfirm: async (value, close) => {
            const answer = String(value ?? "").trim();
            if (!answer) return;
            clarificationDrafts.queue(view.context, question, answer, marker);
            close();
            refreshClarificationControls(view);
        },
    });
}
