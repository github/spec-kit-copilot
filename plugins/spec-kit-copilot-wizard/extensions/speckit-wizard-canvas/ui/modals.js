// Consolidated modal + markdown stack. All UI overlays live here.

import { state, TOKEN } from "./state.js";
import { escapeHtml, safeExternalHref } from "./client.js";
import { parseClarifications } from "../pipeline/canonical.mjs";
import {
    clearClarifications,
    getPendingClarifications,
    getPhaseLastSubmitted,
    markPhaseRunning,
    queueClarification,
    setPhaseLastSubmitted,
} from "./phase-runtime.js";

// -------- Section: markdown.mjs --------

export function renderMarkdown(src, placeholders = []) {
    const raw = String(src ?? "")
        .replace(/\r\n/g, "\n")
        // Strip any remaining lone `\r` (e.g. CR-CR-LF files that leave a
        // trailing `\r` on each line after the CRLF pass). Lone CRs break
        // regex `$` anchors and cause the block-vs-paragraph loop to spin
        // forever on lines like `# heading\r`.
        .replace(/\r/g, "")
        // Strip HTML comments — SpecKit skills use these as invisible
        // provenance/version markers (e.g. `<!-- speckit:specify v1 -->`)
        // that shouldn't render.
        .replace(/<!--[\s\S]*?-->/g, "");
    const PH_RE = /\uE000(\d+)\uE001/g;

    const restorePlaceholders = (s) => s.replace(PH_RE, (_, i) => placeholders[Number(i)] ?? "");

    // Inline: code first (so nothing inside backticks gets further rewrites),
    // then bold, italic, links.
    const renderInline = (text) => {
        // Placeholders are preserved through inline rewrites — the token
        // itself never contains characters the rewrites care about.
        let out = escapeHtml(text);
        // Inline code
        out = out.replace(/`([^`\n]+)`/g, (_m, c) => `<code>${c}</code>`);
        // Bold: **x** or __x__
        out = out.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
        out = out.replace(/__([^_\n]+)__/g, "<strong>$1</strong>");
        // Italic: *x* or _x_  (avoid matching inside already-bolded strong tags)
        out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
        out = out.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, "$1<em>$2</em>");
        // Links [text](url)
        out = out.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_m, t, u) => {
            const safeUrl = /^(https?:|mailto:|#)/i.test(u) ? u : "#";
            return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${t}</a>`;
        });
        return restorePlaceholders(out);
    };

    const lines = raw.split("\n");
    const html = [];
    let i = 0;

    const flushList = (listType, items) => {
        if (!items.length) return;
        html.push(`<${listType}>${items.map((it) => `<li>${renderInline(it)}</li>`).join("")}</${listType}>`);
    };

    while (i < lines.length) {
        const line = lines[i];

        // Fenced code block
        if (/^```/.test(line)) {
            const lang = line.replace(/^```/, "").trim();
            i++;
            const buf = [];
            while (i < lines.length && !/^```/.test(lines[i])) {
                buf.push(lines[i]);
                i++;
            }
            if (i < lines.length) i++; // skip closing fence
            const cls = lang ? ` class="language-${escapeHtml(lang)}"` : "";
            html.push(`<pre><code${cls}>${restorePlaceholders(escapeHtml(buf.join("\n")))}</code></pre>`);
            continue;
        }

        // ATX heading
        const h = /^(#{1,6})\s+(.*)$/.exec(line);
        if (h) {
            const level = h[1].length;
            html.push(`<h${level}>${renderInline(h[2].trim())}</h${level}>`);
            i++;
            continue;
        }

        // Horizontal rule
        if (/^\s*(?:-{3,}|_{3,}|\*{3,})\s*$/.test(line)) {
            html.push("<hr />");
            i++;
            continue;
        }

        // Blockquote (grouped)
        if (/^>\s?/.test(line)) {
            const buf = [];
            while (i < lines.length && /^>\s?/.test(lines[i])) {
                buf.push(lines[i].replace(/^>\s?/, ""));
                i++;
            }
            html.push(`<blockquote>${renderInline(buf.join("\n"))}</blockquote>`);
            continue;
        }

        // Unordered list
        if (/^\s*[-*+]\s+/.test(line)) {
            const items = [];
            while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
                items.push(lines[i].replace(/^\s*[-*+]\s+/, ""));
                i++;
            }
            flushList("ul", items);
            continue;
        }

        // Ordered list
        if (/^\s*\d+\.\s+/.test(line)) {
            const items = [];
            while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
                items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
                i++;
            }
            flushList("ol", items);
            continue;
        }

        // Table: header | header | header  then --- | --- | ---  then rows
        if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-+:?(\s*\|\s*:?-+:?)+\|?\s*$/.test(lines[i + 1])) {
            const splitRow = (row) => row.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
            const header = splitRow(line);
            i += 2;
            const rows = [];
            while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
                rows.push(splitRow(lines[i]));
                i++;
            }
            html.push(
                `<table><thead><tr>${header.map((c) => `<th>${renderInline(c)}</th>`).join("")}</tr></thead>` +
                `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${renderInline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`
            );
            continue;
        }

        // Blank line -> paragraph break
        if (/^\s*$/.test(line)) {
            i++;
            continue;
        }

        // Paragraph: collapse contiguous non-blank, non-block lines.
        const buf = [];
        while (
            i < lines.length &&
            !/^\s*$/.test(lines[i]) &&
            !/^(#{1,6})\s+/.test(lines[i]) &&
            !/^```/.test(lines[i]) &&
            !/^\s*[-*+]\s+/.test(lines[i]) &&
            !/^\s*\d+\.\s+/.test(lines[i]) &&
            !/^>\s?/.test(lines[i]) &&
            !/^\s*(?:-{3,}|_{3,}|\*{3,})\s*$/.test(lines[i])
        ) {
            buf.push(lines[i]);
            i++;
        }
        html.push(`<p>${renderInline(buf.join("\n"))}</p>`);
    }

    return html.join("\n");
}


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
let activeArtifactPhase = null; // phase currently open in the viewer

export async function flushClarifications(p) {
    if (!p?.commandName) return false;
    const list = getPendingClarifications(p.commandName);
    if (!list.length) return false;
    const lastArgs = getPhaseLastSubmitted(p.commandName) || "";
    const suffix = list.map((c) => `Clarification — ${c.question}\nAnswer: ${c.answer}`).join("\n\n");
    const args = lastArgs ? `${lastArgs}\n\n${suffix}` : suffix;
    try {
        markPhaseRunning(p.commandName);
        const result = await __postJson("/api/phase/submit", { commandName: p.commandName, args });
        if (!result) throw new Error("phase submit did not return a queued response");
        setPhaseLastSubmitted(p.commandName, args);
        clearClarifications(p.commandName);
        return true;
    } catch (err) {
        console.error(`dispatch failed: ${err?.message ?? err}`);
        return false;
    }
}

export async function openArtifactViewer(p) {
    const root = document.getElementById("phase-artifact-viewer");
    if (!root) return;
    if (!p?.artifactPath) return;

    activeArtifactPhase = p;
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

    let text = "";
    try {
        const url = `/api/artifact?p=${encodeURIComponent(p.artifactPath)}&token=${encodeURIComponent(TOKEN)}`;
        const res = await fetch(url, { headers: __HEADERS });
        if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => "")}`);
        text = await res.text();
    } catch (err) {
        const body = root.querySelector(".artifact-viewer-body");
        if (body) body.innerHTML = `<p class="wizard-modal-error">Failed to load artifact: ${escapeHtml(String(err?.message ?? err))}</p>`;
        return;
    }

    const marks = parseClarifications(text);
    const placeholders = [];
    let processed = "";
    let cursor = 0;
    marks.forEach((m, idx) => {
        processed += text.slice(cursor, m.startIdx);
        const markerHtml =
            `<mark class="clarify-marker">${escapeHtml(text.slice(m.startIdx, m.endIdx))}</mark>` +
            ` <button type="button" class="clarify-pill" data-clarify-idx="${idx}">Clarify</button>`;
        placeholders.push(markerHtml);
        processed += `\uE000${idx}\uE001`;
        cursor = m.endIdx;
    });
    processed += text.slice(cursor);

    const rendered = renderMarkdown(processed, placeholders);

    const body = root.querySelector(".artifact-viewer-body");
    if (body) body.innerHTML = `<div class="artifact-viewer-md">${rendered}</div>`;

    const totalMarks = marks.length;
    const refreshPillState = (errorMessage = "") => {
        const answered = getPendingClarifications(p.commandName);
        body?.querySelectorAll(".clarify-pill").forEach((btn) => {
            const idx = Number(btn.getAttribute("data-clarify-idx"));
            const q = marks[idx]?.question ?? "";
            const match = answered.find((c) => c.question === q);
            if (match) {
                btn.textContent = "Answered ✓";
                btn.classList.add("clarify-pill-answered");
                btn.title = match.answer;
            } else {
                btn.textContent = "Clarify";
                btn.classList.remove("clarify-pill-answered");
                btn.removeAttribute("title");
            }
        });
        const banner = root.querySelector(".artifact-viewer-clarify-banner");
        const pending = getPendingClarifications(p.commandName).length;
        if (banner) {
            if (pending > 0) {
                banner.hidden = false;
                banner.innerHTML = `
                    <span>${pending} clarification${pending === 1 ? "" : "s"} queued
                    ${totalMarks > pending ? `— ${totalMarks - pending} remaining` : "— will apply on close"}.</span>
                    ${errorMessage ? `<p class="wizard-modal-error">${escapeHtml(errorMessage)}</p>` : ""}
                    <button type="button" class="btn btn-primary btn-sm" data-clarify-action="apply-now">Apply and Rerun</button>
                `;
                banner.querySelector('[data-clarify-action="apply-now"]')?.addEventListener("click", async () => {
                    const btn = banner.querySelector('[data-clarify-action="apply-now"]');
                    if (btn) {
                        btn.disabled = true;
                        btn.textContent = "Applying…";
                    }
                    const dispatched = await flushClarifications(p);
                    if (dispatched) closeArtifactViewer();
                    else refreshPillState("Could not submit the clarification rerun. Your queued answers were preserved.");
                });
            } else {
                banner.hidden = true;
                banner.innerHTML = "";
            }
        }
    };

    body?.querySelectorAll(".clarify-pill").forEach((btn) => {
        const idx = Number(btn.getAttribute("data-clarify-idx"));
        const question = marks[idx]?.question ?? "";
        btn.addEventListener("click", () => openClarifyModal(p, question, async () => {
            refreshPillState();
            const pending = getPendingClarifications(p.commandName).length;
            if (pending >= totalMarks && totalMarks > 0) {
                const dispatched = await flushClarifications(p);
                if (dispatched) closeArtifactViewer();
            }
        }));
    });

    refreshPillState();
}
export async function closeArtifactViewer() {
    const root = document.getElementById("phase-artifact-viewer");
    const p = activeArtifactPhase;
    activeArtifactPhase = null;
    if (p?.commandName) {
        // Back-to-Wizard discards any queued clarifications — the
        // "Apply and Rerun" banner button is the only way to commit
        // them. This prevents accidental reruns when the user just
        // wants to close the viewer.
        clearClarifications(p.commandName);
    }
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
        if (body) body.innerHTML = `<div class="artifact-viewer-md">${renderMarkdown(text, [])}</div>`;
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
    // Deprecated: the "Run again" flow now uses a small anchored yes/no
    // popover (see wireGraphPhaseCard). Kept as a thin shim for any
    // legacy caller, but no longer used by the phase-card UI.
    void p; void draftOverride;
}

// -----------------------------------------------------------------------
// Resolve clarification modal (screenshot 4)
//
// The modal is purely a Q&A capture: it does NOT dispatch a stage rerun.
// The caller (openArtifactViewer) queues the answer via
// queueClarification() and decides when to flush (either when all markers
// in the artifact are answered, or when the viewer closes with pending
// answers). Every artifact that shows Clarify pills uses this same path,
// so batching behavior is consistent across phases.
// -----------------------------------------------------------------------
export function openClarifyModal(p, question, onAnswered) {
    openWizardModal({
        title: "Resolve clarification",
        description: "Answer the question. Your answer is queued locally and applied to the stage when you either finish all clarifications or close this artifact.",
        questionBox: question,
        textareaLabel: "Your answer",
        required: true,
        confirmLabel: "Save answer",
        onConfirm: async (value, close) => {
            const answer = String(value ?? "").trim();
            if (!answer) return;
            queueClarification(p.commandName, question, answer);
            close();
            if (typeof onAnswered === "function") {
                try { await onAnswered(); } catch { /* logged elsewhere */ }
            }
        },
    });
}
