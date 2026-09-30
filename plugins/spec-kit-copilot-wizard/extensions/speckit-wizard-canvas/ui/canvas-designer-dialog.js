import { escapeHtml } from "./client.js";
import { state, TOKEN } from "./state.js";
import { openCommunityInstallModal } from "./modals.js";
import { effectivePipelinePhases, stripCommandsPrefix } from "../pipeline/effective-phases.mjs";

const KINDS = [["presets", "Presets"], ["extensions", "Extensions"], ["bundles", "Bundles"]];
let confirming = false;
let selections = null;
let bundleMembers = new Map();
let deselectedMembers = new Set();
let restoreFocus = null;
let inspecting = 0;
let errorMessage = "";
let queuedCount = 0;

function phaseIds(snapshot) {
    return [...new Set(effectivePipelinePhases(snapshot).map((phase) =>
        stripCommandsPrefix(phase.id)))];
}

export async function submitDesignerLaunch(snapshot, checked, fetcher = fetch) {
    let response;
    try {
        response = await fetcher(`/api/designer/launch?token=${encodeURIComponent(TOKEN)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Canvas-Token": TOKEN },
            body: JSON.stringify({
                selections: checked,
                catalogFingerprint: snapshot.catalog.designerFingerprint,
                expectedPhases: phaseIds(snapshot),
            }),
        });
    } catch (error) {
        throw new Error(`Could not reach the Wizard: ${error.message}`);
    }
    if (!response?.ok) {
        const text = await response?.text();
        let detail = text;
        try { detail = JSON.parse(text).error ?? text; } catch { /* plain response */ }
        throw new Error(`Designer launch failed (${response?.status ?? "unknown"}): ${detail || "Try again."}`);
    }
    const result = await response.json();
    if (result?.queued !== true) throw new Error("Wizard did not queue the Designer session.");
    return result;
}

function updateLaunch(root) {
    const submit = root.querySelector(".designer-submit");
    if (!submit) return;
    const ready = ["presets", "extensions", "bundles"].every((kind) =>
        Array.isArray(state.snapshot?.catalog?.[kind]))
        && typeof state.snapshot.catalog.designerFingerprint === "string";
    submit.disabled = Boolean(confirming || inspecting || !ready);
    const error = root.querySelector(".designer-error");
    error.textContent = errorMessage || (!ready ? "Wait for the catalog to load before launching." : "");
    error.hidden = !error.textContent;
    const status = root.querySelector(".designer-status");
    status.textContent = queuedCount
        ? `${queuedCount} Designer ${queuedCount === 1 ? "launch" : "launches"} queued. You can launch another or close this dialog.`
        : "";
    status.hidden = !status.textContent;
}

export function canvasDesignEntries(snapshot, kind) {
    const items = snapshot?.catalog?.[kind];
    return (Array.isArray(items) ? items : []).filter((item) =>
        item?.id && (["community", "copilot"].includes(item.source)
            || (kind === "bundles" && item.source === "default"))
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
    errorMessage = "";
    queuedCount = 0;
    inspecting = 0;
    if (restoreFocus?.isConnected) restoreFocus.focus();
    restoreFocus = null;
}

function renderChoices(snapshot, kind, label) {
    const items = canvasDesignEntries(snapshot, kind);
    return `<fieldset class="designer-group" id="designer-panel-${kind}" data-designer-panel="${kind}" role="tabpanel" aria-labelledby="designer-tab-${kind}" ${kind !== "presets" ? "hidden" : ""}>
        ${items.length ? items.map((item, index) => `<label class="designer-choice">
            <input type="checkbox" data-designer-kind="${kind}" data-designer-index="${index}">
            <span class="designer-choice-text"><strong>${escapeHtml(item.name ?? item.id)}</strong><small>${escapeHtml(item.id)}${item.version ? ` · v${escapeHtml(item.version)}` : ""}</small><small class="designer-included-by" hidden></small></span>
            <span class="badge source designer-source-tag">${escapeHtml((item.source ?? "default").replace(/^./, (c) => c.toUpperCase()))}</span>
        </label>`).join("") : `<p class="wizard-modal-desc">No ${label.toLowerCase()} tagged canvas-design are available.</p>`}
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
    errorMessage = "";
    queuedCount = 0;
    root.innerHTML = `<div class="wizard-modal-backdrop designer-backdrop">
        <section class="wizard-modal generation-modal designer-modal" role="dialog" aria-modal="true" aria-labelledby="designer-title" aria-describedby="designer-description">
            <header class="wizard-modal-head"><h3 id="designer-title">Canvas designer setup</h3><button type="button" class="wizard-modal-close" aria-label="Close">✕</button></header>
            <div class="wizard-modal-body">
                <p class="wizard-modal-desc" id="designer-description">Select presets, extensions, or bundles for the canvas designer. Your selections are passed to a separate session for future installation; nothing is installed yet, and the wizard's configuration stays unchanged.</p>
                <p class="wizard-modal-desc">Choose from the available catalogs.</p>
                <p class="designer-error" role="alert" hidden></p>
                <p class="designer-status" role="status" hidden></p>
                <nav class="subtabs designer-tabs" role="tablist" aria-label="Design customization type">
                    ${KINDS.map(([kind, label]) => `<button type="button" id="designer-tab-${kind}" class="subtab${kind === "presets" ? " is-active" : ""}" role="tab" aria-selected="${kind === "presets"}" aria-controls="designer-panel-${kind}" tabindex="${kind === "presets" ? "0" : "-1"}" data-designer-tab="${kind}">${label}</button>`).join("")}
                </nav>
                ${KINDS.map(([kind, label]) => renderChoices(snapshot, kind, label)).join("")}
            </div>
            <footer class="wizard-modal-foot"><button type="button" class="btn btn-secondary wizard-modal-cancel">Cancel</button><button type="button" class="btn btn-primary designer-submit">Launch designer</button></footer>
        </section></div>`;
    const dialog = root.querySelector(".designer-modal");
    root.querySelector(".wizard-modal-close").addEventListener("click", closeDialog);
    root.querySelector(".wizard-modal-cancel").addEventListener("click", closeDialog);
    root.querySelector(".designer-backdrop").addEventListener("click", (event) => {
        if (event.target === event.currentTarget) closeDialog();
    });
    const tabs = [...root.querySelectorAll("[data-designer-tab]")];
    const activateTab = (tab) => {
        tabs.forEach((entry) => {
            const active = entry === tab;
            entry.classList.toggle("is-active", active);
            entry.setAttribute("aria-selected", String(active));
            entry.setAttribute("tabindex", active ? "0" : "-1");
        });
        root.querySelectorAll("[data-designer-panel]").forEach((panel) => {
            panel.hidden = panel.dataset.designerPanel !== tab.dataset.designerTab;
        });
    };
    tabs.forEach((tab, index) => {
        tab.addEventListener("click", () => activateTab(tab));
        tab.addEventListener("keydown", (event) => {
            let target;
            if (event.key === "ArrowRight") target = (index + 1) % tabs.length;
            else if (event.key === "ArrowLeft") target = (index - 1 + tabs.length) % tabs.length;
            else if (event.key === "Home") target = 0;
            else if (event.key === "End") target = tabs.length - 1;
            else return;
            event.preventDefault();
            activateTab(tabs[target]);
            tabs[target].focus();
        });
    });
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
            updateLaunch(root);
            const backdrop = root.querySelector(".designer-backdrop");
            const restoreBackdrop = () => {
                backdrop.removeAttribute("aria-hidden");
                backdrop.inert = false;
            };
            let approved;
            try {
                approved = await new Promise((resolve) => openCommunityInstallModal({
                    displayName: item.name ?? item.id,
                    kind: kind.slice(0, -1),
                    designerSession: true,
                    afterFocus: () => {
                        backdrop.inert = true;
                        backdrop.setAttribute("aria-hidden", "true");
                    },
                    beforeRestoreFocus: restoreBackdrop,
                    onConfirm: () => resolve(true),
                    onCancel: () => resolve(false),
                }));
            } finally {
                restoreBackdrop();
                confirming = false;
                updateLaunch(root);
            }
            if (selections !== dialogSelections) return;
            if (!approved) { input.checked = false; input.focus(); return; }
        }
        if (kind === "bundles") {
            const key = `${item.source}:${item.id}`;
            if (input.checked) {
                inspecting += 1;
                updateLaunch(root);
                const restoreInputFocus = document.activeElement === input;
                input.disabled = true;
                try {
                    const members = await inspectBundle(item);
                    if (selections !== dialogSelections) return;
                    bundleMembers.set(key, { bundle: item, members: members.flatMap((member) => {
                        const match = canvasDesignEntries(snapshot, member.kind).find((candidate) =>
                            candidate.id === member.id && candidate.source === item.source);
                        return match ? [{ ...member, source: match.source }] : [];
                    }) });
                    for (const member of bundleMembers.get(key).members) {
                        deselectedMembers.delete(`${member.kind}:${member.source}:${member.id}`);
                    }
                } catch (err) {
                    if (selections !== dialogSelections) return;
                    input.checked = false;
                    errorMessage = `Could not inspect ${item.name ?? item.id}: ${err.message}`;
                    updateLaunch(root);
                    return;
                } finally {
                    input.disabled = false;
                    if (selections === dialogSelections) {
                        inspecting -= 1;
                        updateLaunch(root);
                    }
                    if (restoreInputFocus && input.isConnected
                        && (document.activeElement === document.body || document.activeElement === input)) {
                        input.focus();
                    }
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
        errorMessage = "";
        updateLaunch(root);
    }));
    root.querySelector(".designer-submit").addEventListener("click", async () => {
        if (confirming || inspecting) return;
        const dialogSelections = selections;
        const checked = currentCanvasDesignerSelections();
        errorMessage = "";
        updateLaunch(root);
        try {
            await submitDesignerLaunch(snapshot, checked);
            if (selections !== dialogSelections) return;
            queuedCount += 1;
            updateLaunch(root);
        } catch (error) {
            if (selections !== dialogSelections) return;
            errorMessage = error.message;
            updateLaunch(root);
        }
    });
    updateLaunch(root);
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
