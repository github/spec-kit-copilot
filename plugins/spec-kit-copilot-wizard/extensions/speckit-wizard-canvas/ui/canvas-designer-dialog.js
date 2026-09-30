import { escapeHtml } from "./client.js";
import { state, TOKEN } from "./state.js";
import { openCommunityInstallModal } from "./modals.js";
import { effectivePipelinePhases, stripCommandsPrefix } from "../pipeline/effective-phases.mjs";

const KINDS = [["presets", "Presets"], ["extensions", "Extensions"], ["bundles", "Bundles"]];
const DESIGN_EXTENSION = "canvas-design";
let confirming = false;
let selections = null;
let bundleMembers = new Map();
let restoreFocus = null;
let inspecting = 0;
let errorMessage = "";
let processing = false;
let pendingInspections = new Set();

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
        try {
            const body = JSON.parse(text);
            detail = body.error ?? text;
        } catch { /* plain response */ }
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
    const source = state.snapshot?.catalog?.designerSource;
    submit.disabled = Boolean(processing || confirming || inspecting || !ready || source?.available !== true);
    submit.setAttribute("aria-busy", String(processing));
    root.querySelectorAll("[data-designer-kind], [data-designer-tab], .wizard-modal-close, .wizard-modal-cancel")
        .forEach((element) => {
            element.disabled = processing || confirming || pendingInspections.has(element)
                || element.dataset.bundleOwned === "true";
        });
    const error = root.querySelector(".designer-error");
    error.textContent = errorMessage || (!ready ? "Wait for the catalog to load before launching."
        : source?.available !== true ? source?.error ?? "Canvas Design source is unavailable." : "");
    error.hidden = !error.textContent;
}

export function canvasDesignEntries(snapshot, kind) {
    const items = snapshot?.catalog?.[kind];
    return (Array.isArray(items) ? items : []).filter((item) =>
        item?.id && !(kind === "extensions" && item.id === DESIGN_EXTENSION)
        && (["community", "copilot"].includes(item.source)
            || (kind === "bundles" && item.source === "default"))
        && Array.isArray(item.tags) && item.tags.includes("canvas-design"));
}

export function freshCanvasDesignerSelections() {
    return { presets: [], extensions: [{ id: DESIGN_EXTENSION, source: "copilot", approved: true }],
        bundles: [] };
}

export function currentCanvasDesignerSelections() {
    if (!selections) return null;
    const result = structuredClone(selections);
    for (const { members } of bundleMembers.values()) {
        for (const { kind, id, source } of members) {
            if (!result[kind].some((item) => item.id === id && item.source === source)) {
                result[kind].push({ id, source, approved: true });
            }
        }
    }
    return result;
}

function closeDialog() {
    if (processing) return;
    document.getElementById("wizard-modal-root")?.replaceChildren();
    selections = null;
    bundleMembers = new Map();
    errorMessage = "";
    pendingInspections = new Set();
    inspecting = 0;
    if (restoreFocus?.isConnected) restoreFocus.focus();
    restoreFocus = null;
}

function renderChoices(snapshot, kind, label) {
    const items = canvasDesignEntries(snapshot, kind);
    return `<fieldset class="designer-group" id="designer-panel-${kind}" data-designer-panel="${kind}" role="tabpanel" aria-labelledby="designer-tab-${kind}" ${kind !== "presets" ? "hidden" : ""}>
        ${kind === "extensions" ? `<label class="designer-choice">
            <input type="checkbox" checked disabled aria-label="Canvas Design (required)">
            <span class="designer-choice-text"><strong>Canvas Design</strong><small>${DESIGN_EXTENSION}${snapshot?.catalog?.designerSource?.extension?.version ? ` · v${escapeHtml(snapshot.catalog.designerSource.extension.version)}` : ""} · required by Canvas Designer</small></span>
            <span class="badge source designer-source-tag">Required</span>
        </label>` : ""}
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
                || !!names.length;
            input.dataset.bundleOwned = String(names.length > 0);
            input.disabled = confirming || names.length > 0;
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
    errorMessage = "";
    pendingInspections = new Set();
    root.innerHTML = `<div class="wizard-modal-backdrop designer-backdrop">
        <section class="wizard-modal generation-modal designer-modal" role="dialog" aria-modal="true" aria-labelledby="designer-title" aria-describedby="designer-description">
            <header class="wizard-modal-head"><h3 id="designer-title">Canvas designer setup</h3><button type="button" class="wizard-modal-close" aria-label="Close">✕</button></header>
            <div class="wizard-modal-body">
                <p class="wizard-modal-desc" id="designer-description">Select presets, extensions, or bundles for the canvas designer. Your selections and the required Canvas Design extension will be installed in a separate session before the designer opens. The wizard's configuration stays unchanged.</p>
                <p class="wizard-modal-desc">Choose from the available catalogs. Bundle members are included and cannot be unchecked while their bundle is selected.</p>
                <p class="designer-error" role="alert" hidden></p>
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
        if (confirming || processing || input.disabled) return;
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
            input.focus();
        }
        if (kind === "bundles") {
            const key = `${item.source}:${item.id}`;
            if (input.checked) {
                const restoreInputFocus = document.activeElement === input;
                inspecting += 1;
                pendingInspections.add(input);
                updateLaunch(root);
                input.disabled = true;
                try {
                    const members = await inspectBundle(item);
                    if (selections !== dialogSelections) return;
                    bundleMembers.set(key, { bundle: item, members: members.flatMap((member) => {
                        const match = canvasDesignEntries(snapshot, member.kind).find((candidate) =>
                            candidate.id === member.id && candidate.source === item.source);
                        return match ? [{ ...member, source: match.source }] : [];
                    }) });
                } catch (err) {
                    if (selections !== dialogSelections) return;
                    input.checked = false;
                    errorMessage = `Could not inspect ${item.name ?? item.id}: ${err.message}`;
                    updateLaunch(root);
                    return;
                } finally {
                    pendingInspections.delete(input);
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
    const sendLaunch = async (checked) => {
        if (processing) return;
        const dialogSelections = selections;
        processing = true;
        errorMessage = "";
        updateLaunch(root);
        let accepted = false;
        try {
            await submitDesignerLaunch(snapshot, checked, fetch);
            if (selections !== dialogSelections) return;
            accepted = true;
        } catch (error) {
            if (selections !== dialogSelections) return;
            errorMessage = error.message;
        } finally {
            processing = false;
            if (selections === dialogSelections) {
                if (accepted) closeDialog();
                else updateLaunch(root);
            }
        }
    };
    root.querySelector(".designer-submit").addEventListener("click", () => {
        if (processing || confirming || inspecting) return;
        return sendLaunch(currentCanvasDesignerSelections());
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
