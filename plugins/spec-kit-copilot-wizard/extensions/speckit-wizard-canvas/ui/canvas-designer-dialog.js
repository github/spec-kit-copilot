import { escapeHtml } from "./client.js";
import { state, TOKEN } from "./state.js";
import { openCommunityInstallModal } from "./modals.js";

const KINDS = [["presets", "Presets"], ["extensions", "Extensions"], ["bundles", "Bundles"]];
let confirming = false;
let selections = null;
let bundleMembers = new Map();
let deselectedMembers = new Set();
let restoreFocus = null;

export function canvasDesignEntries(snapshot, kind) {
    const items = snapshot?.catalog?.[kind];
    return (Array.isArray(items) ? items : []).filter((item) =>
        item?.id && ["community", "copilot"].includes(item.source)
        && Array.isArray(item.tags) && item.tags.includes("canvas-design"));
}

export function freshCanvasDesignerSelections() {
    return { presets: [], extensions: [], bundles: [] };
}

export function currentCanvasDesignerSelections() {
    if (!selections) return null;
    const result = structuredClone(selections);
    for (const { members } of bundleMembers.values()) {
        for (const { kind, id, source } of members) {
            if (!deselectedMembers.has(`${kind}:${source}:${id}`)
                && !result[kind].some((item) => item.id === id && item.source === source)) {
                result[kind].push({ id, source, approved: true });
            }
        }
    }
    return result;
}

function closeDialog() {
    document.getElementById("wizard-modal-root")?.replaceChildren();
    selections = null;
    bundleMembers = new Map();
    deselectedMembers = new Set();
    if (restoreFocus?.isConnected) restoreFocus.focus();
    restoreFocus = null;
}

function renderChoices(snapshot, kind, label) {
    const items = canvasDesignEntries(snapshot, kind);
    return `<fieldset class="designer-group" data-designer-panel="${kind}" role="tabpanel" aria-label="${label}" ${kind !== "presets" ? "hidden" : ""}>
        ${items.length ? items.map((item, index) => `<label class="designer-choice">
            <input type="checkbox" data-designer-kind="${kind}" data-designer-index="${index}">
            <span class="designer-choice-text"><strong>${escapeHtml(item.name ?? item.id)}</strong><small>${escapeHtml(item.id)}${item.version ? ` · v${escapeHtml(item.version)}` : ""}</small><small class="designer-included-by" hidden></small></span>
            <span class="badge source designer-source-tag">${escapeHtml((item.source ?? "default").replace(/^./, (c) => c.toUpperCase()))}</span>
        </label>`).join("") : `<p class="wizard-modal-desc">No ${label.toLowerCase()} available in the Copilot or Community catalogs.</p>`}
    </fieldset>`;
}

function includedBy(kind, id, source) {
    return [...bundleMembers.values()]
        .filter(({ members }) => members.some((member) =>
            member.kind === kind && member.id === id && member.source === source))
        .map(({ bundle }) => bundle.name ?? bundle.id);
}

function refreshBundleChoices(root, snapshot) {
    for (const kind of ["presets", "extensions"]) {
        const catalog = canvasDesignEntries(snapshot, kind);
        root.querySelectorAll(`[data-designer-kind="${kind}"]`).forEach((input) => {
            const item = catalog[Number(input.dataset.designerIndex)];
            const names = includedBy(kind, item.id, item.source);
            const note = input.parentElement.querySelector(".designer-included-by");
            note.textContent = names.length ? `Included by bundle: ${names.join(", ")}` : "";
            note.hidden = !names.length;
            input.title = note.textContent;
            input.checked = selections[kind].some((entry) =>
                entry.id === item.id && entry.source === item.source)
                || (!!names.length && !deselectedMembers.has(`${kind}:${item.source}:${item.id}`));
        });
    }
}

async function inspectBundle(item) {
    const params = new URLSearchParams({ id: item.id, source: item.source, token: TOKEN });
    const response = await fetch(`/api/designer/bundle-members?${params}`);
    if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error ?? `Bundle inspection failed (${response.status}).`);
    }
    const { members } = await response.json();
    if (!Array.isArray(members)) throw new Error("Bundle inspection returned no member list.");
    return members;
}

export function openCanvasDesignerDialog() {
    if (document.querySelector(".designer-modal")) return;
    const snapshot = state.snapshot;
    const root = document.getElementById("wizard-modal-root");
    if (!root) return;
    restoreFocus = document.activeElement;
    selections = freshCanvasDesignerSelections();
    bundleMembers = new Map();
    deselectedMembers = new Set();
    root.innerHTML = `<div class="wizard-modal-backdrop designer-backdrop">
        <section class="wizard-modal generation-modal designer-modal" role="dialog" aria-modal="true" aria-labelledby="designer-title" aria-describedby="designer-description">
            <header class="wizard-modal-head"><h3 id="designer-title">Canvas designer setup</h3><button type="button" class="wizard-modal-close" aria-label="Close">✕</button></header>
            <div class="wizard-modal-body">
                <p class="wizard-modal-desc" id="designer-description">Select presets, extensions, or bundles to customize the canvas designer's settings and generation behavior. Your selections will be installed in a separate designer session, leaving the wizard's configuration unchanged.</p>
                <p class="wizard-modal-desc">Choose from the Copilot and Community catalogs.</p>
                <p class="designer-error" role="alert" hidden></p>
                <nav class="subtabs designer-tabs" role="tablist" aria-label="Design customization type">
                    ${KINDS.map(([kind, label]) => `<button type="button" class="subtab${kind === "presets" ? " is-active" : ""}" role="tab" aria-selected="${kind === "presets"}" data-designer-tab="${kind}">${label}</button>`).join("")}
                </nav>
                ${KINDS.map(([kind, label]) => renderChoices(snapshot, kind, label)).join("")}
            </div>
            <footer class="wizard-modal-foot"><button type="button" class="btn btn-secondary wizard-modal-cancel">Cancel</button><span title="Launching a Canvas designer session is not available yet."><button type="button" class="btn btn-primary designer-submit" disabled aria-label="Launch designer (not available yet)">Launch designer</button></span></footer>
        </section></div>`;
    const dialog = root.querySelector(".designer-modal");
    root.querySelector(".wizard-modal-close").addEventListener("click", closeDialog);
    root.querySelector(".wizard-modal-cancel").addEventListener("click", closeDialog);
    root.querySelector(".designer-backdrop").addEventListener("click", (event) => {
        if (event.target === event.currentTarget) closeDialog();
    });
    root.querySelectorAll("[data-designer-tab]").forEach((tab) => tab.addEventListener("click", () => {
        root.querySelectorAll("[data-designer-tab]").forEach((entry) => {
            const active = entry === tab;
            entry.classList.toggle("is-active", active);
            entry.setAttribute("aria-selected", String(active));
        });
        root.querySelectorAll("[data-designer-panel]").forEach((panel) => {
            panel.hidden = panel.dataset.designerPanel !== tab.dataset.designerTab;
        });
    }));
    root.querySelectorAll("[data-designer-kind]").forEach((input) => input.addEventListener("change", async () => {
        if (confirming || input.disabled) return;
        const dialogSelections = selections;
        const kind = input.dataset.designerKind;
        const item = canvasDesignEntries(snapshot, kind)[Number(input.dataset.designerIndex)];
        if (!item) return;
        const error = root.querySelector(".designer-error");
        error.hidden = true;
        error.textContent = "";
        if (input.checked && (item.installAllowed === false || item.source === "community")) {
            confirming = true;
            let approved;
            try {
                approved = await new Promise((resolve) => openCommunityInstallModal({
                    displayName: item.name ?? item.id,
                    kind: kind.slice(0, -1),
                    designerSession: true,
                    onConfirm: () => resolve(true),
                    onCancel: () => resolve(false),
                }));
            } finally {
                confirming = false;
            }
            if (selections !== dialogSelections) return;
            if (!approved) { input.checked = false; input.focus(); return; }
        }
        if (kind === "bundles") {
            const key = `${item.source}:${item.id}`;
            if (input.checked) {
                input.disabled = true;
                try {
                    const members = await inspectBundle(item);
                    if (selections !== dialogSelections) return;
                    bundleMembers.set(key, { bundle: item, members: members.flatMap((member) => {
                        const match = canvasDesignEntries(snapshot, member.kind).find((candidate) =>
                            candidate.id === member.id && candidate.source === item.source)
                            ?? canvasDesignEntries(snapshot, member.kind).find((candidate) =>
                                candidate.id === member.id);
                        return match ? [{ ...member, source: match.source }] : [];
                    }) });
                    for (const member of bundleMembers.get(key).members) {
                        deselectedMembers.delete(`${member.kind}:${member.source}:${member.id}`);
                    }
                } catch (err) {
                    if (selections !== dialogSelections) return;
                    input.checked = false;
                    error.textContent = `Could not inspect ${item.name ?? item.id}: ${err.message}`;
                    error.hidden = false;
                    input.focus();
                    return;
                } finally {
                    input.disabled = false;
                }
            } else {
                bundleMembers.delete(key);
            }
        } else {
            const key = `${kind}:${item.source}:${item.id}`;
            if (input.checked) deselectedMembers.delete(key);
            else if (includedBy(kind, item.id, item.source).length) deselectedMembers.add(key);
        }
        selections[kind] = selections[kind].filter((entry) =>
            entry.id !== item.id || entry.source !== item.source);
        if (input.checked) selections[kind].push({
            id: item.id, source: item.source, approved: true,
        });
        if (kind === "bundles") refreshBundleChoices(root, snapshot);
    }));
    dialog.addEventListener("keydown", (event) => {
        if (event.key === "Escape") { event.preventDefault(); closeDialog(); }
        if (event.key !== "Tab") return;
        const focusable = [...dialog.querySelectorAll("button:not([disabled]), input:not([disabled])")];
        if (!focusable.length) return;
        if (event.shiftKey && document.activeElement === focusable[0]) {
            event.preventDefault(); focusable.at(-1).focus();
        } else if (!event.shiftKey && document.activeElement === focusable.at(-1)) {
            event.preventDefault(); focusable[0].focus();
        }
    });
    root.querySelector(".wizard-modal-close").focus();
}
