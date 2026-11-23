const { validateStockTextAdapter, validateGeneratedControl, validatePlacedControl,
    validatePageRenderer } = await import(
    `/contracts/external-generated-controls.mjs${new URL(import.meta.url).search}`);
const { validateDialogAdapter, validateDialogInstance, validateDialogDecision,
    validateButtonAdapter, validateButtonInstance } = await import(
    `/contracts/external-dialog-button.mjs${new URL(import.meta.url).search}`);
import { createArtifactReview } from "./artifact-review.js";
import { captureViewerReturn, mountArtifactViewerShell } from "./artifact-viewer-shell.js";
import { createReviewClarifications } from "./review-clarifications.js";
import { closeWizardModal } from "./answer-dialog.js";
const { mountPageAssets, createStockImageRenderer } = await import(
    `./page-assets.mjs${new URL(import.meta.url).search}`);
const { validatePhaseAdapter, validatePhaseMount, validatePhaseState,
    validateWorkflowPageState, validateWorkflowPageDefinition, validateWorkflowAdapter,
    validateWorkflowMount, workflowItemName } = await import(
    `/contracts/external-host-adapter.mjs${new URL(import.meta.url).search}`);
const itemName = workflowItemName(document.getElementById("workflow-surface")?.dataset.workflowItemName);
const slugHint = `${itemName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "workflow"}-1`;
const token = new URL(location.href).searchParams.get("token");
const imageRegistration = document.getElementById("stock-image-registration");
const renderStockImage = createStockImageRenderer(imageRegistration, token);
const textRegistration = document.getElementById("stock-text-registration");
const renderedStock = new WeakSet();
function mountStockPresentation() {
    for (const root of document.querySelectorAll("[data-stock-image]")) {
        if (renderedStock.has(root)) continue;
        renderedStock.add(root);
        void renderStockImage(root, { id: root.dataset.stockImage, label: root.dataset.imageAlt },
            { file: root.dataset.imageFile }, root.dataset.imageAlt, root.dataset.imageClass);
    }
    if (!textRegistration) return;
    for (const root of document.querySelectorAll("[data-stock-text]")) {
        if (renderedStock.has(root)) continue;
        renderedStock.add(root);
        void (async () => {
            try {
                const { mount, controlId, valueContract } = await import(
                    `${textRegistration.dataset.module}?token=${encodeURIComponent(token)}`);
                validateStockTextAdapter(controlId, valueContract, mount);
                const field = { id: root.dataset.fieldId, label: root.dataset.textLabel };
                const value = root.textContent;
                await mount({ root, field, value,
                    context: { slot: root.dataset.stockText, className: "" } });
            } catch (error) {
                root.setAttribute("role", "alert");
                root.textContent = `Generated text could not render: ${error.message}`;
            }
        })();
    }
}
mountStockPresentation();
async function mountGeneratedControl(root) {
    const field = { id: root.dataset.controlId, label: root.dataset.fieldLabel };
    try {
        const { mount, controlId, valueContract } = await import(`${root.dataset.module}?token=${encodeURIComponent(
            new URL(import.meta.url).searchParams.get("token"))}`);
        validateGeneratedControl(mount, controlId, valueContract, root);
        await mount({ root, field, value: JSON.parse(root.dataset.value),
            values: model?.controlValues?.[field.id] ?? {},
            readValues: () => ({ ...(model?.controlValues?.[field.id] ?? {}) }) });
    } catch (error) {
        root.setAttribute("role", "alert");
        root.textContent = `Generated control could not render: ${error.message}`;
    }
}
const $ = (id) => document.getElementById(id);
const dialogContracts = $("generated-dialog-contracts");
const dialogs = JSON.parse(dialogContracts?.dataset.dialogs ?? "[]");
const phaseDialogs = JSON.parse(dialogContracts?.dataset.phaseDialogs ?? "[]");
const buttons = JSON.parse(dialogContracts?.dataset.buttons ?? "[]");
const buttonControls = JSON.parse(dialogContracts?.dataset.buttonControls ?? "[]");
const dialogCache = new Map();
let buttonMounts = [], setupBusy = false, activeSetupPlan = null, dialogPending = false;

async function showGeneratedDialog(name, context = {}) {
    if (dialogPending) throw new Error("A generated dialog is already open");
    dialogPending = true;
    try {
        const registration = dialogs.find((item) => item.id === name);
        if (!registration) throw new Error(`Unregistered generated dialog: ${name}`);
        let entry = dialogCache.get(name);
        if (!entry) {
            const response = await fetch(`/dialogs/${name}.json?token=${encodeURIComponent(token)}`);
            if (!response.ok) throw new Error(`Could not load generated dialog ${name} (${response.status})`);
            const definition = await response.json();
            const module = await import(`/dialogs/${registration.adapter}.mjs?token=${encodeURIComponent(token)}`);
            validateDialogAdapter(definition, name, registration, module);
            entry = { definition, mount: module.mount };
            dialogCache.set(name, entry);
        }
        const root = $("generated-dialog-root");
        if (root.childElementCount) throw new Error("A generated dialog is already open");
        try {
            const instance = await entry.mount({ root, definition: entry.definition,
                context, onDecision: () => {} });
            validateDialogInstance(instance, name);
            try {
                const result = await instance.result;
                validateDialogDecision(result);
                return result === "confirmed";
            } finally {
                instance.dispose();
            }
        } finally {
            root.replaceChildren();
        }
    } finally {
        dialogPending = false;
    }
}

async function confirmGeneratedPhase(selected) {
    requireModel();
    const selectedWorkflow = model.selected;
    const binding = phaseDialogs.find((item) =>
        item.phase === `speckit.${selected?.id?.replace(/^speckit\./, "")}`);
    if (!binding) return true;
    const confirmed = await showGeneratedDialog(binding.dialog, {
        phase: { id: selected.id, label: selected.label },
    });
    if (confirmed && model.selected !== selectedWorkflow) {
        throw new Error("Selected workflow or phase changed. Select the phase and retry.");
    }
    return confirmed;
}

async function mountGeneratedButtons() {
    if (!buttons.length) return;
    for (const definition of [...buttons].sort((a, b) => a.order - b.order)) {
        const control = buttonControls.find((item) => item.id === definition.control);
        if (!control) throw new Error(`Missing button control: ${definition.control}`);
        const module = await import(`/buttons/${control.adapter}.mjs?token=${encodeURIComponent(token)}`);
        validateButtonAdapter(module, control);
        const root = definition.page === "setup" ? $("setup-actions")
            : document.querySelector(`[data-workflow-slot="${definition.slot}"]`);
        if (!root) throw new Error(`Missing generated button slot: ${definition.slot}`);
        const mountRoot = document.createElement("span");
        root.append(mountRoot);
        const activate = async () => {
            try {
                if (definition.control === "project.setup-button") {
                    if (setupBusy) return;
                    setupBusy = true;
                    try { await api("/api/setup/start", {}); await refresh(); }
                    finally {
                        setupBusy = false;
                        const button = $("setup-actions").querySelector("button");
                        if (button) button.disabled = ["initializing", "installing"]
                            .includes(model?.setup?.stage);
                    }
                } else if (definition.control === "dialog.trigger") {
                    if (await showGeneratedDialog(definition.dialog)) {
                        message(`${definition.label} confirmed.`, "canvas-message");
                    }
                } else throw new Error("Unknown generated button action");
            } catch (error) {
                message(error.message, definition.page === "setup" ? "setup-status" : "canvas-message", true);
            }
        };
        const instance = await module.mount({ root: mountRoot, definition,
            ...(definition.control === "project.setup-button" ? { onSetup: activate } : { onTrigger: activate }) });
        validateButtonInstance(instance);
        buttonMounts.push(instance);
    }
}

function renderSetup() {
    const setup = model?.setup;
    const visible = model?.showSetup && !setup?.ready;
    $("setup-surface").hidden = !visible;
    if (!visible) { activeSetupPlan = null; return; }
    const status = $("setup-status");
    status.textContent = setup.error ?? ({
        initializing: "Initializing Specify in Copilot skills mode. Check chat for progress.",
        "awaiting-confirmation": "Review the complete package batch before installation.",
        installing: "Installing confirmed packages. Check chat for progress.",
        failed: "Setup failed. Check chat, then retry.",
        cancelled: "Installation cancelled. No additional packages were installed. Select setup to try again.",
    }[setup.stage] ?? "");
    status.hidden = !status.textContent;
    status.classList.toggle("workflow-error", Boolean(setup.error));
    const button = $("setup-actions").querySelector("button");
    if (button) button.disabled = setupBusy || ["initializing", "installing"].includes(setup.stage);
    confirmSetup(setup);
}
function confirmSetup(setup) {
    if (setup.stage === "awaiting-confirmation" && setup.planId
        && activeSetupPlan !== setup.planId) {
        activeSetupPlan = setup.planId;
        const setupButton = buttons.find((item) => item.id === "generated-setup-button");
        if (!setupButton) throw new Error("The setup button registration is missing");
        void (async () => {
            try {
                const approved = await showGeneratedDialog(setupButton.dialog, {
                    pendingPackages: setup.pending.map((entry) => ({
                        name: `${entry.kind.slice(0, -1)}: ${entry.id}`,
                        version: entry.version,
                        source: entry.source === "local" ? entry.path
                            : `${entry.source}: ${entry.downloadUrl ?? entry.catalogId}`,
                        community: entry.source !== "default",
                    })),
                });
                await api("/api/setup/confirm", { planId: setup.planId, confirmed: approved });
                await refresh();
            } catch (error) {
                message(`Setup confirmation failed: ${error.message}`, "setup-status", true);
            } finally { activeSetupPlan = null; }
        })();
    }
}
const workflowIdentity = $("workflow-identity");
let phaseControl;
let workflowPage;
const drafts = new Map();
const failedValueDrafts = new Map();
const failedPatches = new Map();
let model, current = 0, sending = false, saving = Promise.resolve(), refreshSequence = 0;
let workflowCreation = Promise.resolve();
let viewer = null, timer, constitutionTimer, constitutionDraft, saveFailure = null,
    pendingValueSaves = 0, workflowQuery = "", previousBadgeRows, slugTouched = false;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const reservedSlug = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const selectedPending = () => model?.items.some((entry) => entry.id === model.selected && entry.pending);
const hasSelectedWorkflow = () => model?.items.some((entry) => entry.id === model.selected);
function slugError() {
    const value = model?.slug ?? "";
    if (!value) return "";
    if (value.length > 100 || !slugPattern.test(value) || reservedSlug.test(value)) {
        return "Use lowercase letters, numbers, and single hyphens; avoid reserved folder names.";
    }
    return "";
}
const THEME_STORAGE_KEY = "speckit-generated-canvas.theme";
const placements = JSON.parse($("generated-field-placements")?.dataset.placements ?? "[]");
const phaseBadgeSlots = JSON.parse($("workflow-pipeline")?.dataset.badgeSlots ?? "[]");
const mountedFields = new Map();
const pendingFieldDrafts = new Map();
let pageSelection = 0, mountedPage = "workflow", renderedPageValues = null;

function placementValue(placement) {
    const field = model?.valueFields?.find((entry) => entry.id === placement.field);
    return {
        field: { id: placement.field, label: field?.label ?? placement.label ?? placement.field },
        value: pendingFieldDrafts.get(placement.field)?.value
            ?? failedValueDrafts.get(placement.field)?.value ?? field?.value ?? placement.value,
        schema: field?.schema ?? placement.schema,
        editable: Boolean(field ? field.editable : placement.editable),
    };
}

function disposeFieldMounts(page) {
    for (const [id, mounted] of mountedFields) {
        if (mounted.page !== page) continue;
        mountedFields.delete(id);
        mounted.disposed = true;
        try { mounted.instance?.dispose?.(); }
        catch (error) { message(`Generated control could not be disposed: ${error.message}`, "canvas-message", true); }
        mounted.root.remove();
    }
}

function declaredFieldTargets(root, page, selector, slotProperty) {
    const targets = new Map();
    const needed = new Set(placements.filter((entry) => entry.page === page).map((entry) => entry.slot));
    for (const target of root.querySelectorAll(selector)) {
        const slot = target.dataset[slotProperty];
        if (!needed.has(slot)) continue;
        if (targets.has(slot)) throw new Error(`Duplicate generated field slot ${slot} on ${page}`);
        targets.set(slot, target);
    }
    for (const slot of needed) {
        if (!targets.has(slot)) throw new Error(`Generated page did not render field slot ${slot} on ${page}`);
    }
    return targets;
}

async function mountField(placement, root) {
    const mounted = { page: placement.page, root, placement, instance: null, disposed: false };
    mountedFields.set(placement.id, mounted);
    const state = placementValue(placement);
    mounted.lastValue = JSON.stringify(state.value);
    const onChange = state.editable ? (value) => saveFieldValue(placement.field, value)
        .catch((error) => message(`Value could not be saved: ${error.message} Your edit remains in this panel.`,
            "canvas-message", true)) : undefined;
    try {
        if (placement.control === "stock.image") {
            if (placement.asset) {
                await renderStockImage(root, state.field, placement.asset, state.field.label, "generated-image");
            } else root.replaceChildren();
        } else if (placement.control === "stock.text" || placement.control === "stock.checkbox") {
            const input = state.editable ? document.createElement("input") : null;
            if (input) {
                input.type = placement.control === "stock.checkbox" ? "checkbox" : "text";
                input.className = "phase-input-control";
                input.setAttribute("aria-label", state.field.label);
                if (state.schema?.maxLength && input.type === "text") input.maxLength = state.schema.maxLength;
                input.addEventListener("change", () => onChange(input.type === "checkbox" ? input.checked : input.value));
                root.replaceChildren(input);
            } else {
                root.replaceChildren();
                if (placement.control === "stock.checkbox") {
                    const indicator = document.createElement("input");
                    indicator.type = "checkbox";
                    indicator.disabled = true;
                    indicator.setAttribute("aria-label", state.field.label);
                    root.append(indicator);
                }
            }
            mounted.instance = { update: ({ value }) => {
                if (input) {
                    if (document.activeElement === input || failedValueDrafts.has(placement.field)) return;
                    if (input.type === "checkbox") input.checked = Boolean(value);
                    else input.value = value ?? "";
                } else if (placement.control === "stock.checkbox") root.querySelector("input").checked = Boolean(value);
                else root.textContent = value == null ? "" : String(value);
            } };
            mounted.instance.update(state);
        } else {
            if (!placement.adapter || !/^[a-z][a-z0-9-]{0,79}$/.test(placement.adapter)) {
                throw new Error(`Missing generated adapter for ${placement.field}`);
            }
            const { mount, controlId, valueContract } = await import(
                `/controls/${placement.adapter}.mjs?token=${encodeURIComponent(token)}`);
            if (mounted.disposed) return;
            validatePlacedControl(mount, controlId, valueContract, placement, state);
            const values = () => ({ ...(model?.controlValues?.[placement.field] ?? {}) });
            mounted.instance = await mount({ root, field: state.field, value: state.value,
                values: values(), readValues: values, editable: state.editable,
                ...(onChange ? { onChange } : {}) });
            if (mounted.disposed) mounted.instance?.dispose?.();
        }
    } catch (error) {
        if (mounted.disposed) return;
        root.setAttribute("role", "alert");
        root.textContent = `Generated control could not render: ${error.message}`;
    }
}

async function syncFieldMounts(page, root, selector, slotProperty) {
    const targets = declaredFieldTargets(root, page, selector, slotProperty);
    const entries = placements.filter((entry) => entry.page === page);
    const seen = new Set();
    for (const entry of entries) {
        if (seen.has(entry.id)) throw new Error(`Duplicate generated field placement ${entry.id}`);
        seen.add(entry.id);
    }
    const ordered = entries.map((entry, index) => ({ entry, index }))
        .sort((a, b) => a.entry.order - b.entry.order || a.index - b.index);
    for (const { entry } of ordered) {
        const existing = mountedFields.get(entry.id);
        if (existing && existing.root.isConnected) {
            const state = placementValue(entry);
            if (!existing.root.contains(document.activeElement)) {
                if (typeof existing.instance?.update === "function") {
                    try { await existing.instance.update({ field: state.field, value: state.value, values: {
                        ...(model?.controlValues?.[entry.field] ?? {}) },
                        readValues: () => ({ ...(model?.controlValues?.[entry.field] ?? {}) }),
                        editable: state.editable });
                        existing.lastValue = JSON.stringify(state.value);
                    }
                    catch (error) {
                        existing.root.setAttribute("role", "alert");
                        existing.root.textContent = `Generated control could not update: ${error.message}`;
                    }
                } else if (entry.control !== "stock.image" && existing.lastValue !== JSON.stringify(state.value)) {
                    existing.disposed = true;
                    try { existing.instance?.dispose?.(); }
                    catch (error) { message(`Generated control could not be disposed: ${error.message}`, "canvas-message", true); }
                    existing.root.replaceChildren();
                    await mountField(entry, existing.root);
                }
            }
            continue;
        }
        if (existing) {
            existing.disposed = true;
            try { existing.instance?.dispose?.(); }
            catch (error) { message(`Generated control could not be disposed: ${error.message}`, "canvas-message", true); }
        }
        const target = targets.get(entry.slot);
        const mountPoint = document.createElement("div");
        mountPoint.dataset.fieldPlacement = entry.id;
        target.append(mountPoint);
        await mountField(entry, mountPoint);
    }
}

function wireGeneratedPages() {
    const root = $("generated-page");
    if (!root) return;
    const buttons = [...document.querySelectorAll("[data-canvas-page]")];
    for (const button of buttons) button.addEventListener("click", async () => {
        const currentSelection = ++pageSelection;
        const id = button.dataset.canvasPage;
        const workflow = id === "workflow";
        if (mountedPage !== id || !workflow) disposeFieldMounts(mountedPage);
        mountedPage = id;
        const introLogo = document.querySelector('[data-stock-image="workflow.intro"]');
        if (introLogo) introLogo.hidden = !workflow;
        root.hidden = workflow;
        message("", "generated-page-error");
        root.replaceChildren();
        renderedPageValues = null;
        root.classList.remove("workflow-error");
        $("workflow-content").hidden = !workflow;
        for (const candidate of buttons) {
            if (candidate === button) candidate.setAttribute("aria-current", "page");
            else candidate.removeAttribute("aria-current");
        }
        if (workflow) {
            try { await syncFieldMounts("workflow", $("workflow-content") ?? document,
                "[data-workflow-slot]", "workflowSlot"); }
            catch (error) { message(`Generated workflow could not render: ${error.message}`, "canvas-message", true); }
            return;
        }
        const registration = [...document.querySelectorAll("[data-generated-renderer]")]
            .find((item) => item.dataset.generatedRenderer === id);
        try {
            if (!registration) throw new Error(`Missing generated page ${id}`);
            const { renderPage } = await import(`${registration.dataset.module}?token=${encodeURIComponent(token)}`);
            if (currentSelection !== pageSelection) return;
            validatePageRenderer(renderPage, id);
            const content = document.createElement("div");
            await renderPage({ root: content, canvas: { id: root.dataset.canvasId,
                displayName: root.dataset.canvasTitle },
                values: { ...JSON.parse(registration.dataset.values), ...(model?.pageValues?.[id] ?? {}) } });
            if (currentSelection !== pageSelection) return;
            await mountPageAssets(content, JSON.parse(registration.dataset.assetSlots),
                JSON.parse(registration.dataset.assets),
                (target, asset) => renderStockImage(target,
                    { id: asset.id, label: asset.label }, asset, asset.label, "generated-image"));
            if (currentSelection !== pageSelection) return;
            root.replaceChildren(content);
            await syncFieldMounts(id, content, "[data-field-slot]", "fieldSlot");
            if (currentSelection !== pageSelection) return;
            renderedPageValues = JSON.stringify(model?.pageValues?.[id] ?? {});
        } catch (error) {
            if (currentSelection !== pageSelection) return;
            root.textContent = `Generated page could not render: ${error.message}`;
            root.classList.add("workflow-error");
        }
    });
}

function currentTheme() {
    const explicit = document.documentElement.getAttribute("data-theme");
    if (explicit === "dark" || explicit === "light") return explicit;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    const button = $("theme-toggle");
    button.textContent = theme === "dark" ? "☾" : "☀";
    button.setAttribute("aria-label", theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
    button.setAttribute("title", button.getAttribute("aria-label"));
}

function wireThemeToggle() {
    let stored = null;
    try { stored = localStorage.getItem(THEME_STORAGE_KEY); } catch { /* storage may be unavailable */ }
    applyTheme(stored === "dark" || stored === "light" ? stored : currentTheme());
    $("theme-toggle").addEventListener("click", () => {
        const next = currentTheme() === "dark" ? "light" : "dark";
        applyTheme(next);
        try { localStorage.setItem(THEME_STORAGE_KEY, next); } catch { /* storage may be unavailable */ }
    });
}

function setConnectionStatus(status) {
    const pill = $("connection-status");
    pill.className = status === "live" ? "conn conn-live" : "conn conn-lost";
    pill.textContent = status === "live" ? "Live" : "Disconnected";
}

function message(text, id = "canvas-message", error = false) {
    if (id === "canvas-message") {
        if (!error) return;
        id = mountedPage === "workflow" ? "workflow-action-error" : "generated-page-error";
    }
    const notice = $(id) ?? $("workflow-action-error") ?? $("canvas-fatal-error");
    notice.textContent = text;
    notice.hidden = !text;
    notice.setAttribute("role", error ? "alert" : "status");
    notice.classList.toggle("workflow-error", error);
}
function displayValue(value) {
    return typeof value === "object" ? JSON.stringify(value) : String(value);
}
function renderValues() {
    const container = $("canvas-value-list");
    if (!container || !model) return;
    $("canvas-value-errors").textContent = Object.values(model.valueErrors).join(" ");
    $("canvas-values").hidden = !model.valueFields.length && !Object.keys(model.valueErrors).length;
    const active = document.activeElement;
    const editing = active?.closest?.("[data-edit-value]");
    const draft = editing && {
        id: editing.dataset.editValue,
        values: [...editing.querySelectorAll("input, select")].map((input) =>
            ({ property: input.dataset.property, value: input.value, checked: input.checked })),
        property: active.dataset.property,
        selectionStart: active instanceof HTMLInputElement && active.type === "text"
            ? active.selectionStart : null,
        selectionEnd: active instanceof HTMLInputElement && active.type === "text"
            ? active.selectionEnd : null,
    };
    container.replaceChildren();
    const groups = new Map();
    for (const field of model.valueFields) {
        const groupId = field.section?.id ?? "";
        let group = groups.get(groupId);
        if (!group) {
            group = document.createElement("div");
            if (field.section) {
                const heading = document.createElement("h3");
                heading.textContent = field.section.title;
                group.append(heading);
            }
            groups.set(groupId, group);
            container.append(group);
        }
        const row = document.createElement("div");
        row.className = "field";
        const label = document.createElement("label");
        label.className = "field-label";
        label.textContent = field.label;
        row.append(label);
        if (!field.editable) {
            const output = document.createElement("div");
            output.dataset.fieldId = field.id;
            output.textContent = displayValue(field.value);
            row.append(output);
        } else {
            const editor = document.createElement("div");
            editor.dataset.editValue = field.id;
            const retained = failedValueDrafts.get(field.id);
            const value = retained ? retained.value : field.value;
            if (field.schema.type === "boolean") {
                const input = document.createElement("input");
                input.type = "checkbox";
                input.checked = value;
                input.id = `value-${field.id}`;
                label.htmlFor = input.id;
                editor.append(input);
            } else if (field.schema.type === "object") {
                for (const [key, options] of Object.entries(field.schema.properties)) {
                    const property = document.createElement("label");
                    property.textContent = key;
                    const select = document.createElement("select");
                    select.className = "phase-input-control";
                    select.dataset.property = key;
                    select.setAttribute("aria-label", `${field.label}: ${key}`);
                    for (const option of options) {
                        const item = document.createElement("option");
                        item.value = option;
                        item.textContent = option;
                        select.append(item);
                    }
                    select.value = value[key];
                    property.append(select);
                    editor.append(property);
                }
            } else {
                const input = document.createElement("input");
                input.type = "text";
                input.className = "phase-input-control";
                input.maxLength = field.schema.maxLength;
                input.value = value;
                input.id = `value-${field.id}`;
                label.htmlFor = input.id;
                editor.append(input);
            }
            row.append(editor);
        }
        group.append(row);
    }
    if (draft) {
        const editor = [...container.querySelectorAll("[data-edit-value]")]
            .find((entry) => entry.dataset.editValue === draft.id);
        if (editor) {
            const inputs = [...editor.querySelectorAll("input, select")];
            for (const [index, input] of inputs.entries()) {
                const retained = draft.values[index];
                if (!retained || retained.property !== input.dataset.property) continue;
                if (input.type === "checkbox") input.checked = retained.checked;
                else input.value = retained.value;
            }
            const focused = inputs.find((input) => input.dataset.property === draft.property) ?? inputs[0];
            focused?.focus({ preventScroll: true });
            if (focused instanceof HTMLInputElement && focused.type === "text"
                && draft.selectionStart !== null && draft.selectionEnd !== null) {
                focused.setSelectionRange(draft.selectionStart, draft.selectionEnd);
            }
        }
    }
}
function editValue(element) {
    const row = element.closest("[data-edit-value]");
    if (!row || !model) return;
    const field = model.valueFields.find((entry) => entry.id === row.dataset.editValue && entry.editable);
    if (!field) return;
    let value;
    if (field.schema.type === "boolean") value = row.querySelector("input").checked;
    else if (field.schema.type === "object") {
        value = Object.fromEntries([...row.querySelectorAll("[data-property]")]
            .map((input) => [input.dataset.property, input.value]));
    } else value = row.querySelector("input").value;
    return saveFieldValue(field.id, value);
}
function saveFieldValue(id, value) {
    const field = model?.valueFields.find((entry) => entry.id === id && entry.editable);
    if (!field) return Promise.reject(new Error(`Field ${id} is not editable.`));
    const draft = { value };
    pendingFieldDrafts.set(id, draft);
    const pageRoot = mountedPage === "workflow"
        ? $("workflow-content") ?? document : $("generated-page")?.firstElementChild;
    if (pageRoot && placements.some((entry) => entry.page === mountedPage && entry.field === id)) {
        void syncFieldMounts(mountedPage, pageRoot,
            mountedPage === "workflow" ? "[data-workflow-slot]" : "[data-field-slot]",
            mountedPage === "workflow" ? "workflowSlot" : "fieldSlot")
            .catch((error) => message(`Generated field could not update: ${error.message}`, "canvas-message", true));
    }
    if (timer) { clearTimeout(timer); timer = null; saveInputs(); }
    pendingValueSaves++;
    saving = saving.catch(() => {}).then(async () => {
        if (saveFailure) throw saveFailure;
        const result = await retryRevision("/api/values", { id: field.id, value });
        model.revision = result.revision;
        failedValueDrafts.delete(field.id);
        if (pendingFieldDrafts.get(id) === draft) pendingFieldDrafts.delete(id);
    }).catch((error) => {
        failedValueDrafts.set(field.id, { value, error });
        if (pendingFieldDrafts.get(id) === draft) pendingFieldDrafts.delete(id);
        throw error;
    }).finally(() => { pendingValueSaves--; });
    saving.catch(() => {});
    return saving.then(() => refresh());
}
async function api(path, input, options = {}) {
    const response = await fetch(path, {
        headers: { "x-canvas-token": token, ...(input === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(input === undefined ? {} : { method: "POST", body: JSON.stringify(input) }),
        ...options,
    });
    const result = await response.json();
    if (!response.ok) {
        const error = new Error(result.error ?? `Request failed (${response.status}).`);
        error.status = response.status;
        error.code = result.code;
        throw error;
    }
    return result;
}
async function retryRevision(path, input, shouldRetry = () => true) {
    try {
        return await api(path, { ...input, revision: model.revision });
    } catch (error) {
        if (error.status !== 409 || error.code !== "STALE_REVISION") throw error;
        await refreshCurrent();
        if (!shouldRetry()) return null;
        try {
            return await api(path, { ...input, revision: model.revision });
        } catch (retryError) {
            if (retryError.status === 409 && retryError.code === "STALE_REVISION") {
                await refreshCurrent();
                if (!shouldRetry()) return null;
                throw new Error("Canvas state is still changing. Try this action again.");
            }
            throw retryError;
        }
    }
}
const workflowPhases = () => model?.phases.filter((phase) => !phase.project) ?? [];
const phase = () => workflowPhases()[current];
const creationPhase = () => workflowPhases().find((step) => step.output?.includes("<slug>")) ?? workflowPhases()[0];
const constitution = () => model?.phases.find((entry) => entry.project);
const draftKey = (step, item = model.selected) => JSON.stringify([step.project ? "project" : item, step.id]);
function remember(step, value) {
    const key = draftKey(step);
    drafts.set(key, value);
    return { item: step.project ? "project" : model.selected, phase: step.id, value };
}
function persist(patch) {
    const parts = [];
    if (Object.hasOwn(patch, "selected") || Object.hasOwn(patch, "name") || Object.hasOwn(patch, "slug")) {
        parts.push([`identity:${patch.selected ?? model.selected}`, {
            ...(Object.hasOwn(patch, "selected") ? { selected: patch.selected } : {}),
            ...(Object.hasOwn(patch, "name") ? { name: patch.name } : {}),
            ...(Object.hasOwn(patch, "slug") ? { slug: patch.slug } : {}),
        }]);
    }
    if (patch.draft) parts.push([`draft:${JSON.stringify([patch.draft.item, patch.draft.phase])}`,
        { draft: patch.draft }]);
    saving = saving.catch(() => {}).then(async () => {
        const saved = await retryRevision("/api/state", patch);
        model.revision = saved.revision;
        for (const [key] of parts) failedPatches.delete(key);
        if (!failedPatches.size) saveFailure = null;
    }).catch((error) => {
        for (const [key, value] of parts) failedPatches.set(key, value);
        saveFailure = error;
        message(`Inputs could not be saved: ${error.message} Your draft is retained in this panel.`, "workflow-action-error", true);
        throw error;
    });
    // Input events have no awaiter; keep rejection observable via feedback and flush().
    saving.catch(() => {});
    return saving;
}
function queueInput() {
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; saveInputs(); }, 400);
}
function saveInputs() {
    if (!model) return;
    const selected = phase();
    const patch = selectedPending()
        ? { name: model.name ?? "", ...(model.userProvidesSlug ? { slug: model.slug } : {}) } : {};
    if (selected) patch.draft = { item: model.selected, phase: selected.id, value: drafts.get(draftKey(selected)) ?? model.drafts[draftKey(selected)] ?? "" };
    return persist(patch);
}
function saveConstitutionDraft() {
    const draft = constitutionDraft;
    if (draft) {
        const pending = persist({ draft });
        pending.then(() => {
            if (constitutionDraft === draft) constitutionDraft = null;
        }, () => {});
        return pending;
    }
}
async function flush() {
    if (timer) { clearTimeout(timer); timer = null; saveInputs(); }
    if (constitutionTimer) {
        clearTimeout(constitutionTimer);
        constitutionTimer = null;
        saveConstitutionDraft();
    }
    await saving;
    if (saveFailure) throw saveFailure;
    if (failedValueDrafts.size) throw failedValueDrafts.values().next().value.error;
}
function phaseState(pendingLabel = () => null) {
    const phases = workflowPhases();
    const selected = phase();
    const status = selected ? model?.statuses[selected.id] : null;
    const item = model?.items.find((entry) => entry.id === model.selected);
    const pending = Boolean(item?.pending || model?.selected === "__new__");
    const slug = pending && !model?.userProvidesSlug ? "" : item?.slug ?? (pending ? model.slug : "");
    const resolveOutput = (output) => slug && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
        && (!pending || !slugError())
        ? output?.replace("<slug>", slug) : output;
    const output = selected
        ? (pending && selected.output
            ? resolveOutput(selected.output) : status?.output ?? resolveOutput(selected.output)) : null;
    return { phases: phases.map(({ id, label, description, output, outputs }) =>
        ({ id, label, description, output, outputs })),
        statuses: model?.statuses ?? {}, autopilot: model?.autopilot ?? null,
        badgeSlots: phaseBadgeSlots,
        badgeModels: (model?.badges?.selected ?? []).filter((badge) =>
            badge.showIn.includes("phase-card") || badge.targets?.length),
        current: selected ? current : -1, workflow: pending ? "__new__" : model?.selected ?? "__new__",
        status: status && output !== status.output
            ? { ...status, artifactAvailability: "unknown", artifactError: null } : status,
        draft: selected ? drafts.get(draftKey(selected)) ?? model.drafts[draftKey(selected)] ?? "" : "",
        output: output ?? null, outputLinks: selected
            ? (selected.outputs ?? []).map((template) => ({
                template, label: resolveOutput(template),
            })) : [],
        slugEditable: Boolean(model?.userProvidesSlug),
        setupPending: Boolean(model?.showSetup && !model?.setup?.ready),
        blocked: model?.showSetup && !model?.setup?.ready ? "Available after setup"
            : !model?.items.length ? "Choose + New to start."
            : !model?.constitutionReady ? "Create a constitution before running a workflow."
                : pending && model?.userProvidesSlug ? slugError() : null,
        sending: Boolean(selected && sending && sending.phase === selected.id
            && sending.item === model.selected),
        runLabel: selected ? pendingLabel(selected) : null };
}
function pendingLabel(step) {
    const item = step.project ? "project" : model.selected;
    if (sending && sending.phase === step.id && sending.item === item) return "Running";
    const status = model.statuses[step.id]?.status;
    return status === "Request sent" || status === "Running" ? "Running" : null;
}
function renderStatus() {
    if (workflowPage) {
        workflowPage.update(validateWorkflowPageState({ model: structuredClone(model),
            phaseState: phaseState(pendingLabel),
            pendingLabel, sending, setupBusy, inputPending: Boolean(timer),
            slugTouched, slugError: slugError(),
            valueDrafts: Object.fromEntries([...failedValueDrafts, ...pendingFieldDrafts]
                .map(([id, draft]) => [id, draft.value])) }));
        return;
    }
    function artifactAction(buttonId, noticeId, status) {
        const button = $(buttonId), notice = $(noticeId);
        if (button) button.hidden = status?.artifactAvailability !== "available";
        if (notice) {
            notice.textContent = status?.artifactError ?? (status?.artifactAvailability === "available" ? ""
                : status?.output ? `${status.output} is not available yet. Run the phase, then refresh to check again.`
                : "No artifact is available for this phase yet. Run the phase, then refresh to check again.");
            notice.hidden = !notice.textContent;
        }
    }
    phaseControl?.update(validatePhaseState(phaseState(pendingLabel)));
    const setupPending = model.showSetup && !model.setup?.ready;
    const idle = !hasSelectedWorkflow();
    $("workflow-pipeline").querySelectorAll("[data-phase-index]").forEach((button) => {
        button.disabled = idle;
    });
    const mobilePhaseSelect = $("mobile-phase-select");
    if (mobilePhaseSelect) mobilePhaseSelect.disabled = idle;
    if (constitution()) {
        const projectPhase = constitution();
        if (model.badges?.project !== undefined && !Array.isArray(model.badges.project)) {
            throw new Error("Invalid project badge results");
        }
        const projectBadges = model.badges?.project ?? [];
        const forTarget = (output) => projectBadges.filter((badge) => badge.targets
            ? badge.targets.some((target) => target.phase === projectPhase.id && target.output === output)
            : output === null && badge.showIn.includes("phase-card") && badge.phase === projectPhase.id);
        $("constitution-badges")?.replaceChildren(badgeList(forTarget(null), true));
        $("constitution-output-badges")?.replaceChildren(badgeList(
            forTarget(projectPhase.output), true));
        const status = model.statuses[projectPhase.id];
        artifactAction("view-constitution", "constitution-artifact-status", status);
        const available = status?.artifactAvailability === "available";
        const statusText = available ? "" : status?.artifactAvailability === "error"
            ? "Unavailable" : status?.status === "Not run" ? "Needed before starting"
                : status?.status ?? "Checking...";
        const card = $("constitution-card");
        card.classList.toggle("constitution-ready", available);
        $("constitution-status").textContent = statusText;
        $("constitution-status").hidden = !statusText;
        $("run-constitution").textContent = pendingLabel(constitution()) ?? (available ? "Update" : "Create constitution");
        $("send-constitution").textContent = pendingLabel(constitution()) ?? (available ? "Update constitution" : "Create constitution");
        $("run-constitution").disabled = setupPending;
        $("run-constitution").title = setupPending ? "Available after setup" : "";
        $("send-constitution").disabled = setupPending;
        $("constitution-dialog-title").textContent = available ? "Update constitution" : "Create constitution";
        $("constitution-args-label").textContent = available ? "Guidance (optional)" : "Project principles";
        $("constitution-args").required = !available;
    }
    const input = $("workflow-slug");
    if (input && selectedPending() && model.userProvidesSlug) {
        const error = slugTouched && input.value.trim() ? slugError() : "";
        $("workflow-slug-error").textContent = error;
        $("workflow-slug-error").hidden = !error;
        input.setAttribute("aria-invalid", String(Boolean(error)));
    }
    renderName();
    renderSlug();
}
function renderPhase() {
    renderStatus();
}
function renderSlug() {
    const input = $("workflow-slug");
    if (!input) return;
    input.closest(".field").hidden = !model.userProvidesSlug;
    const first = creationPhase();
    const status = model.items.find((entry) => entry.id === model.selected)?.status;
    input.readOnly = !selectedPending()
        || Boolean(status && !["Not started", "Failed"].includes(status))
        || Boolean(sending && sending.phase === first?.id)
        || ["Request sent", "Running"].includes(model.statuses[first?.id]?.status);
    input.placeholder = input.readOnly ? "Automatically assigned" : slugHint;
    if (document.activeElement !== input && !timer) {
        input.value = selectedPending() ? model.slug
            : model.items.find((entry) => entry.id === model.selected)?.slug ?? "";
    }
}
function renderName() {
    const input = $("workflow-name");
    if (!input) return;
    const first = creationPhase();
    const status = model.items.find((entry) => entry.id === model.selected)?.status;
    input.readOnly = !selectedPending()
        || Boolean(status && !["Not started", "Failed"].includes(status))
        || Boolean(sending && sending.phase === first?.id)
        || ["Request sent", "Running"].includes(model.statuses[first?.id]?.status);
    if (document.activeElement !== input && !timer) {
        input.value = selectedPending() ? model.name ?? ""
            : model.items.find((entry) => entry.id === model.selected)?.label ?? "";
    }
}
function renderCollection() {
    if (model.items.length <= 8) workflowQuery = "";
    $("workflow-count").textContent = `(${model.items.length})`;
    $("new-workflow").disabled = !workflowPhases().length;
    $("workflow-constitution-note").hidden = model.constitutionReady || !model.items.length;
    $("workflow-pipeline").hidden = !workflowPhases().length;
    $("workflow-pipeline").classList.toggle("workflow-pipeline-idle", !hasSelectedWorkflow());
    const list = $("workflow-rows");
    const scroll = $("workflow-list").scrollTop;
    const badgeRows = JSON.stringify(model.badges?.items ?? {});
    const matches = list.children.length === model.items.length
        && model.items.every((entry, index) => list.children[index].dataset.workflowId === entry.id)
        && previousBadgeRows === badgeRows;
    previousBadgeRows = badgeRows;
    if (!matches) list.replaceChildren(...model.items.map((entry) => {
        const item = document.createElement("div");
        item.className = "instance-row";
        item.setAttribute("role", "listitem");
        item.dataset.workflowId = entry.id;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "instance-select";
        button.dataset.workflowId = entry.id;
        const identity = document.createElement("span");
        identity.className = "instance-select-main";
        const name = document.createElement("strong");
        identity.append(name);
        identity.append(document.createElement("code"));
        button.append(identity);
        const badges = (model.badges?.items?.[entry.id] ?? []).filter((badge) =>
            badge.showIn.includes("workflow-list"));
        if (badges.length && list.dataset.badgeSlot) {
            const slot = badgeList(badges);
            slot.dataset.badgeSlot = list.dataset.badgeSlot;
            button.append(slot);
        }
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "instance-delete";
        remove.dataset.deleteWorkflowId = entry.id;
        item.append(button, remove);
        return item;
    }));
    for (const [index, entry] of model.items.entries()) {
        const row = list.children[index];
        const active = entry.id === model.selected;
        row.classList.toggle("active", active);
        row.classList.toggle("pending", Boolean(entry.pending));
        row.dataset.search = `${entry.label} ${entry.slug}`.toLowerCase();
        const select = row.querySelector(".instance-select");
        if (active) select.setAttribute("aria-current", "true");
        else select.removeAttribute("aria-current");
        const name = select.querySelector("strong");
        name.textContent = entry.label;
        name.title = entry.label;
        const slug = select.querySelector("code");
        slug.textContent = entry.slug;
        slug.hidden = entry.slug === entry.label;
        let badge = select.querySelector(".phase-notice");
        if (entry.pending && !badge) {
            badge = document.createElement("span");
            badge.className = "phase-notice";
            select.append(badge);
        }
        if (badge) {
            badge.textContent = entry.status === "Completed" ? "" : entry.status ?? "Not started";
            badge.hidden = !entry.pending || entry.status === "Completed";
        }
        if (entry.pending) select.title = entry.workflowRecoveryMessage ?? "";
        let recovery = select.querySelector(".recovery-note");
        if (entry.pending && entry.workflowRecoveryMessage && !recovery) {
            recovery = document.createElement("span");
            recovery.className = "recovery-note";
            select.append(recovery);
        }
        if (recovery) { recovery.textContent = entry.workflowRecoveryMessage ?? ""; recovery.hidden = !entry.workflowRecoveryMessage; }
        const remove = row.querySelector(".instance-delete");
        remove.hidden = entry.id === "__new__" || entry.pending && entry.hasWorkflowRunHistory
            && !["Completed", "Failed", "Run output unconfirmed"].includes(entry.status);
        remove.textContent = entry.pending ? entry.hasWorkflowRunHistory ? "Discard pending row" : "Remove" : "Delete";
        remove.setAttribute("aria-label", `${remove.textContent} ${entry.label}`);
    }
    const editor = workflowIdentity;
    const selectedRow = [...list.children].find((row) => row.dataset.workflowId === model.selected);
    editor.hidden = !selectedPending();
    if (selectedPending() && editor.parentElement !== selectedRow) selectedRow.append(editor);
    const summary = $("workflow-badge-summary");
    if (summary) {
        const badges = model.badges?.summary ?? [];
        summary.replaceChildren(...(badges.length ? [badgeList(badges)] : []));
        summary.hidden = !badges.length;
    }
    const diagnostics = $("workflow-badge-diagnostics");
    if (diagnostics) {
        diagnostics.textContent = model.badges?.diagnostics?.join(" ") ?? "";
        diagnostics.hidden = !diagnostics.textContent;
    }
    $("workflow-empty").hidden = Boolean(model.items.length);
    $("workflow-empty").textContent = workflowPhases().length
        ? "No items yet." : "No workflow phases are configured.";
    $("workflow-list").scrollTop = scroll;
    $("workflow-search-field").hidden = model.items.length <= 8;
    $("workflow-search").value = workflowQuery;
    filterWorkflowList();
}
function readableBadgeForeground(hex) {
    const rgb = [1, 3, 5].map((index) => {
        const channel = parseInt(hex.slice(index, index + 2), 16) / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    const luminance = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    return (luminance + 0.05) / (0.005605 + 0.05) >= 1.05 / (luminance + 0.05)
        ? "#111" : "#fff";
}
function badgeList(badges, phaseText = false) {
    const group = document.createElement("span");
    group.className = "canvas-badges";
    const brackets = new Map();
    for (const badge of badges) {
        const label = document.createElement("span");
        label.className = "canvas-badge";
        label.dataset.color = badge.color;
        if (/^#[0-9a-fA-F]{6}$/.test(badge.color)) {
            label.style.backgroundColor = badge.color;
            label.style.color = readableBadgeForeground(badge.color);
        }
        label.textContent = phaseText ? badge.phaseText ?? badge.text : badge.text;
        // Phase cards omit category brackets.
        const key = !phaseText && badge.category?.toLowerCase();
        if (key && !brackets.has(key)) {
            const bracket = document.createElement("span");
            bracket.className = "canvas-badge-category";
            bracket.setAttribute("role", "group");
            bracket.setAttribute("aria-label", badge.category);
            const name = document.createElement("span");
            name.className = "canvas-badge-category-label";
            name.textContent = badge.category;
            bracket.append(name);
            brackets.set(key, group.appendChild(bracket));
        }
        (key ? brackets.get(key) : group).append(label);
    }
    return group;
}
function filterWorkflowList() {
    const query = workflowQuery.trim().toLowerCase();
    const rows = [...$("workflow-rows").children];
    let shown = 0;
    for (const row of rows) {
        row.hidden = !row.dataset.search.includes(query);
        if (!row.hidden) shown++;
    }
    const notice = $("workflow-list-status");
    const missing = model.selected !== "__new__" && !model.items.some((entry) => entry.id === model.selected);
    notice.textContent = missing ? "Selected item is unavailable. Choose another or start a new one."
        : query ? `${shown} of ${rows.length} items match.` : "";
    notice.hidden = !notice.textContent;
}
async function refresh(reconcile = false) {
    const sequence = ++refreshSequence;
    const next = await api(reconcile ? "/api/refresh" : "/api/state", reconcile ? {} : undefined);
    if (sequence !== refreshSequence) return false;
    const previous = model;
    model = next;
    if (!workflowPage) renderSetup();
    if (!previous) current = Math.max(0, workflowPhases().findIndex((step) => step.id === model.phase));
    // Do not replace live input text during events or background refresh.
    if (previous && (timer || saveFailure)) {
        if (model.selected === previous.selected) {
            model.slug = previous.slug;
            model.name = previous.name;
            const entry = model.items.find((item) => item.id === model.selected && item.pending);
            if (entry) { entry.slug = model.slug; entry.label = model.name?.trim() || model.slug || `Unstarted ${itemName}`; }
        }
    }
    const project = constitution();
    if (project && !model.statuses[project.id]?.error
        && $("constitution-message")?.classList.contains("workflow-error")) {
        message("", "constitution-message");
    }
    if (!workflowPage) renderCollection();
    if (!workflowPage) renderValues();
    renderPhase();
    if (mountedPage === "workflow") {
        try { await syncFieldMounts("workflow", $("workflow-content") ?? document,
            "[data-workflow-slot]", "workflowSlot"); }
        catch (error) { message(`Generated workflow could not render: ${error.message}`, "canvas-message", true); }
    } else {
        const root = $("generated-page");
        const page = mountedPage;
        if (root && renderedPageValues !== JSON.stringify(model?.pageValues?.[page] ?? {})
            && !root.contains(document.activeElement) && !failedValueDrafts.size) {
            document.querySelectorAll("[data-canvas-page]").forEach((button) => {
                if (button.dataset.canvasPage === page) button.click();
            });
        } else if (root?.firstElementChild) {
            try { await syncFieldMounts(page, root.firstElementChild, "[data-field-slot]", "fieldSlot"); }
            catch (error) {
                root.textContent = `Generated page could not render: ${error.message}`;
                root.classList.add("workflow-error");
                disposeFieldMounts(page);
            }
        }
    }
    return sequence === refreshSequence;
}
let currentRefresh;
let stateNotificationVersion = 0;
function refreshCurrent() {
    if (!currentRefresh) {
        currentRefresh = (async () => {
            while (true) {
                const version = stateNotificationVersion;
                if (await refresh() && version === stateNotificationVersion) break;
            }
        })().finally(() => { currentRefresh = null; });
    }
    return currentRefresh;
}
async function selectPhase(index) {
    if (index < 0 || index >= workflowPhases().length) return;
    await flush();
    await persist({ phase: workflowPhases()[index].id });
    current = index;
    renderPhase();
}
async function selectFeature(value) {
    await flush();
    await persist({ selected: value });
    await refresh();
}
async function waitForWorkflowCreation() {
    while (true) {
        const pending = workflowCreation;
        await pending;
        if (pending === workflowCreation) return;
    }
}
async function createWorkflow(initial = false) {
    const operation = workflowCreation.catch(() => {}).then(async () => {
        await flush();
        if (initial && model.items.length) return;
        const created = await retryRevision("/api/workflow/new", {},
            initial ? () => !model.items.length : undefined);
        if (!created) return;
        message("", "workflow-action-error");
        workflowQuery = "";
        slugTouched = false;
        current = 0;
        await refresh();
    });
    workflowCreation = operation;
    try { return await operation; }
    finally {
        if (workflowCreation === operation) workflowCreation = Promise.resolve();
    }
}
async function deleteFeature(itemId) {
    const item = model.items.find((entry) => entry.id === itemId);
    if (!item) throw new Error("This workflow is no longer available. Refresh and try again.");
    if (item.pending) {
        if (item.hasWorkflowRunHistory && !window.confirm(
            `Discard pending row ${item.label}? This removes its draft and run history only. No workflow directory will be deleted.`
        )) return;
        await flush();
        await retryRevision("/api/workflow/pending/remove", { itemId,
            ...(item.hasWorkflowRunHistory ? { confirmation: "discard" } : {}) });
        await refresh();
        message(`Removed ${item.label}. No directory was created.`);
        return;
    }
    const dialog = $("delete-workflow-dialog");
    $("delete-workflow-name").textContent = item.label;
    $("delete-workflow-directory").textContent = item.id;
    dialog.returnValue = "";
    dialog.showModal();
    $("cancel-delete-workflow").focus();
    const listeners = new AbortController();
    const confirmed = await new Promise((resolve) => {
        $("confirm-delete-workflow").addEventListener("click", () => dialog.close("delete"), { signal: listeners.signal });
        $("cancel-delete-workflow").addEventListener("click", () => dialog.close("cancel"), { signal: listeners.signal });
        dialog.addEventListener("close", () => {
            listeners.abort();
            resolve(dialog.returnValue === "delete");
        }, { once: true });
    });
    if (!confirmed) return;
    await flush();
    await retryRevision("/api/workflow/delete", { itemId, confirmation: item.slug });
    await refresh();
    message(`Deleted ${item.label} and its directory.`);
}
async function send(step, value, target = "phase-action-error") {
    const requestedItem = step.project ? "project" : model.selected;
    if (!step.project) await waitForWorkflowCreation();
    if (!step.project && model.selected !== requestedItem) {
        const key = JSON.stringify([model.selected, step.id]);
        value = drafts.get(key) ?? model.drafts[key] ?? "";
    }
    if (step.project && !model.constitutionReady && !value.trim()) {
        message("Enter project principles before creating the constitution.", target, true);
        $("constitution-args")?.focus();
        return;
    }
    if (!step.project && !model.constitutionReady) {
        message("Create a constitution before starting a workflow.", target, true);
        return;
    }
    if (!step.project && selectedPending() && model.userProvidesSlug && slugError()) {
        message(slugError(), target, true);
        $("workflow-slug")?.focus();
        return;
    }
    if (sending) { message("This request is being sent. Check chat before trying again.", target); return; }
    const previous = model.statuses[step.id];
    if ((previous?.artifactAvailability === "available"
        || ["Completed", "Failed"].includes(previous?.status))
        && !window.confirm("Rerun will overwrite the artifact, with valid content preserved. Proceed?")) return;
    const itemId = step.project ? null : model.selected;
    sending = { phase: step.id, item: itemId ?? "project" };
    renderStatus();
    let accepted = false;
    let runSignal;
    try {
        await flush();
        if (!step.project && model.selected !== itemId) {
            throw new Error("Selected workflow changed before the run was sent. Select the phase and retry.");
        }
        runSignal = AbortSignal.timeout(30_000);
        await api("/api/run", { phase: step.id, args: value,
            ...(!step.project ? { itemId,
                ...(selectedPending() && model.name?.trim() ? { name: model.name.trim() } : {}),
                ...(selectedPending() && model.userProvidesSlug && model.slug ? { slug: model.slug } : {}) } : {}) },
        { signal: runSignal });
        accepted = true;
        if (step.project) {
            $("constitution-dialog")?.close();
            $("run-constitution")?.focus({ preventScroll: true });
        }
        message("", target);
        await refresh();
    } catch (error) {
        message(accepted ? `Request sent, but status could not be refreshed. Check chat before rerunning. ${error.message}`
            : runSignal?.aborted ? "Run request timed out. It may have been sent; check chat before trying again."
                : error.message,
            accepted && step.project ? "workflow-action-error" : target, true);
    }
    finally {
        sending = false; renderStatus();
    }
}
let viewerConnected = true;
let viewerGeneration = 0;
const clarificationReview = createReviewClarifications({
    getRoot: () => $("phase-artifact-viewer"), getReview: () => viewer,
    isReady: () => model?.setup?.ready !== false,
    closeViewer: closeArtifact,
    async submit(review) {
        const result = await api("/api/review/submit", review);
        if (!result?.ok) throw new Error("Submission failed");
    },
});
let restoreArtifactReturn;
async function closeArtifact() {
    if (clarificationReview.reviewSubmissionPending()) {
        clarificationReview.renderReviewDraftBanner("Applying clarification rerun. Wait for it to finish before closing.");
        return false;
    }
    clarificationReview.discardReviewDrafts();
    closeWizardModal();
    viewer?.close({ restore: false });
    viewer = null;
    const generation = ++viewerGeneration;
    const root = $("phase-artifact-viewer");
    root.hidden = true;
    root.replaceChildren();
    root.onkeydown = null;
    document.body.classList.remove("artifact-review-open");
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (generation === viewerGeneration && root.hidden) {
        restoreArtifactReturn?.();
        restoreArtifactReturn = null;
    }
    return true;
}
window.addEventListener("pagehide", () => viewer?.close({ force: true, restore: false }));
async function openArtifact(step, output) {
    if (!step) throw new Error("Wait for the canvas to connect, then try again.");
    const itemId = step.project ? "project" : model.selected;
    const source = { phase: step.id, itemId, ...(output === undefined ? {} : { output }) };
    const trigger = document.activeElement;
    const generation = ++viewerGeneration;
    let artifact;
    try { artifact = await api(`/api/artifact?${new URLSearchParams(source)}`); }
    catch (error) {
        if (error.status === 404) {
            if (generation === viewerGeneration) await api("/api/reveal", source);
            return;
        }
        // The shared reader has its own file limit and presentation for large files.
        if (error.status !== 413) throw error;
    }
    if (generation !== viewerGeneration) return;
    if (clarificationReview.reviewSubmissionPending()) {
        clarificationReview.renderReviewDraftBanner("Applying clarification rerun. Wait for it to finish before switching.");
        return false;
    }
    clarificationReview.discardReviewDrafts();
    viewer?.close({ restore: false });
    restoreArtifactReturn ??= captureViewerReturn(trigger);
    const root = $("phase-artifact-viewer");
    const shell = mountArtifactViewerShell(root, { label: step.label, path: artifact?.path ?? "", returnLabel: "Canvas", onReturn: closeArtifact });
    const review = createArtifactReview({
        container: shell.body, scrollElement: shell.body, readerId: `generated-review-${generation}`,
        headers: { "x-canvas-token": token }, onReturn: closeArtifact,
        getClarifications: clarificationReview.boundReviewClarifications,
        onClarification: clarificationReview.openReviewedClarification,
        canNavigate: () => !clarificationReview.reviewSubmissionPending(),
        onDocument: ({ artifact }) => {
            shell.setTitle(artifact.label, artifact.relativePath);
            clarificationReview.renderReviewDraftBanner();
        },
    });
    viewer = review;
    await review.open({ stage: step.id, feature: itemId, source: output });
    if (viewer === review) {
        review.setConnected(viewerConnected);
        clarificationReview.renderReviewDraftBanner();
    }
}
document.addEventListener("input", (event) => {
    if (!model) return;
    if (workflowPage) return;
    if (event.target.id === "workflow-name") {
        model.name = event.target.value;
        const entry = model.items.find((item) => item.id === model.selected && item.pending);
        if (entry) {
            entry.label = model.name?.trim() || entry.slug || `Unstarted ${itemName}`;
            const row = [...$("workflow-rows").children].find((item) => item.dataset.workflowId === entry.id);
            row.querySelector("strong").textContent = entry.label;
            row.querySelector("strong").title = entry.label;
            row.querySelector("code").hidden = entry.slug === entry.label;
            row.querySelector(".instance-delete").setAttribute("aria-label", `Remove ${entry.label}`);
            row.dataset.search = `${entry.label} ${entry.slug}`.toLowerCase();
        }
        queueInput();
    }
    if (event.target.id === "workflow-slug") {
        model.slug = event.target.value;
        const entry = model.items.find((item) => item.id === model.selected && item.pending);
        if (entry) {
            entry.slug = model.slug;
            entry.label = model.name?.trim() || entry.slug || `Unstarted ${itemName}`;
            const row = [...$("workflow-rows").children].find((item) => item.dataset.workflowId === entry.id);
            row.querySelector("strong").textContent = entry.label;
            row.querySelector("strong").title = entry.label;
            row.querySelector("code").textContent = entry.slug;
            row.querySelector("code").hidden = entry.slug === entry.label;
            row.querySelector(".instance-delete").setAttribute("aria-label", `Remove ${entry.label}`);
            row.dataset.search = `${entry.label} ${entry.slug}`.toLowerCase();
        }
        queueInput(); renderStatus();
    }
    if (event.target.id === "constitution-args") {
        constitutionDraft = remember(constitution(), event.target.value);
        clearTimeout(constitutionTimer);
        constitutionTimer = setTimeout(() => { constitutionTimer = null; saveConstitutionDraft(); }, 400);
    }
});
document.addEventListener("focusout", (event) => {
    if (workflowPage) return;
    if (event.target.id === "workflow-slug" && selectedPending()
        && event.target.value.trim()) {
        slugTouched = true;
        renderStatus();
    }
});
document.addEventListener("change", (event) => {
    if (workflowPage) return;
    if (event.target.closest?.("[data-edit-value]")) {
        editValue(event.target).catch((error) =>
            message(`Value could not be saved: ${error.message} Your edit remains in this panel.`, "canvas-value-errors", true));
    }
});
$("workflow-search")?.addEventListener("input", (event) => {
    if (workflowPage) return;
    workflowQuery = event.target.value;
    if (model) filterWorkflowList();
});
function requireModel() {
    if (!model) throw new Error("The canvas is connecting. Use Refresh to try again.");
}
document.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    (async () => {
        if (button.id === "theme-toggle") {
            return;
        }
        if (button.id === "cancel-constitution") { $("constitution-dialog").close(); return; }
        if (button.id === "refresh-state") {
            // Fetch the current revision first; retry locally retained drafts explicitly.
            await saving.catch(() => {});
            await refresh(true);
            if (saveFailure) {
                if (failedPatches.size) {
                    let selectionRetried = false;
                    for (const patch of [...failedPatches.values()]) {
                        await persist(patch);
                        if (Object.hasOwn(patch, "selected")) selectionRetried = true;
                        if (patch.draft === constitutionDraft) constitutionDraft = null;
                    }
                    if (selectionRetried) await refresh();
                } else if (constitutionDraft) await saveConstitutionDraft();
                else await saveInputs();
            }
            if (saveFailure) throw saveFailure;
            message("", "workflow-action-error");
            return;
        }
        requireModel();
        if (workflowPage) return;
        if (button.dataset.deleteWorkflowId) { await deleteFeature(button.dataset.deleteWorkflowId); return; }
        if (button.dataset.workflowId) { await selectFeature(button.dataset.workflowId); return; }
        if (button.id === "new-workflow") {
            await createWorkflow();
            $("workflow-name")?.focus();
        }
        else if (button.id === "view-constitution") {
            try { await openArtifact(constitution()); }
            catch (error) { message(error.message, "workflow-action-error", true); }
        }
        else if (button.id === "run-constitution") {
            const key = draftKey(constitution());
            $("constitution-args").value = drafts.get(key) ?? model.drafts[key] ?? "";
            $("constitution-dialog").showModal();
            $("constitution-args").focus();
        } else if (button.id === "send-constitution") await send(constitution(), $("constitution-args").value, "constitution-message");
    })().catch((error) => message(error.message, "workflow-action-error", true));
});
const pipelineRoot = $("workflow-pipeline");
const workflowRoot = $("workflow-content") ?? $("workflow-surface");
try {
    const adapter = await import(`${pipelineRoot.dataset.module}?token=${encodeURIComponent(token)}`);
    const mount = validatePhaseAdapter(adapter);
    const { controlId } = adapter;
    const initialPhases = JSON.parse(pipelineRoot.dataset.phases);
    const mountPhase = (root, initialState) => {
        validatePhaseState(initialState);
        phaseControl = mount({ root,
        definition: { id: controlId, viewLabels: JSON.parse(pipelineRoot.dataset.viewLabels) },
        state: initialState,
        actions: {
            select: (index) => { requireModel(); return selectPhase(index); },
            run: (value) => { requireModel(); return send(phase(), value); },
            view: (output) => { requireModel(); return openArtifact(phase(), output); },
            runAt: async (index) => {
                requireModel();
                const step = workflowPhases()[index];
                if (!step) throw new Error("This step is no longer configured.");
                return send(step, drafts.get(draftKey(step)) ?? model.drafts[draftKey(step)] ?? "");
            },
            viewAt: (index, output) => {
                requireModel();
                return openArtifact(workflowPhases()[index], output);
            },
            startManagedRun: async () => {
                requireModel();
                await flush();
                await api("/api/autopilot/start", { itemId: model.selected });
                await refresh();
            },
            stopManagedRun: async () => {
                requireModel();
                await api("/api/autopilot/stop", {});
                await refresh();
            },
            confirmRun: confirmGeneratedPhase,
            reveal: async () => {
                requireModel();
                await flush();
                await api("/api/reveal", { phase: phase().id, itemId: model.selected });
                message("", "phase-action-error");
            },
            draft: (value) => {
                if (model) { remember(phase(), value); queueInput(); }
            },
            error: (error) => message(error.message, "phase-action-error", true),
        } });
        return validatePhaseMount(phaseControl);
    };
    const initialState = {
        phases: initialPhases, current: initialPhases.length ? 0 : -1,
        workflow: "__new__", status: null, draft: "",
        output: initialPhases[0]?.output ?? null, outputLinks: [],
        badgeSlots: phaseBadgeSlots, badgeModels: [],
        slugEditable: false, sending: false, statuses: {}, autopilot: null,
        setupPending: false,
    };
    if (workflowRoot.dataset.pageModule) {
        const pageModule = await import(`${workflowRoot.dataset.pageModule}?token=${encodeURIComponent(token)}`);
        validateWorkflowAdapter(pageModule);
        workflowPage = await pageModule.mount({
            root: workflowRoot, definition: validateWorkflowPageDefinition(
                JSON.parse(workflowRoot.dataset.pageDefinition)),
            state: validateWorkflowPageState({ model: null, phaseState: initialState }),
            actions: {
                selectWorkflow: (id) => { requireModel(); return selectFeature(id); },
                createWorkflow: async () => {
                    requireModel();
                    await createWorkflow();
                },
                deleteWorkflow: (id) => { requireModel(); return deleteFeature(id); },
                selectPhase: (index) => { requireModel(); return selectPhase(index); },
                run: (index, value) => {
                    requireModel();
                    const step = workflowPhases()[index];
                    if (!step) throw new Error("This phase is no longer configured");
                    return send(step, value);
                },
                view: (index, output) => {
                    requireModel();
                    return openArtifact(workflowPhases()[index], output);
                },
                saveDraft: (index, value) => {
                    requireModel();
                    const step = workflowPhases()[index];
                    if (!step) throw new Error("This phase is no longer configured");
                    remember(step, value); queueInput();
                },
                runConstitution: (value) => {
                    requireModel();
                    return send(constitution(), value, "constitution-message");
                },
                viewConstitution: () => { requireModel(); return openArtifact(constitution()); },
                constitutionDraft: () => {
                    requireModel();
                    const step = constitution();
                    if (!step) throw new Error("Constitution is not configured");
                    const key = draftKey(step);
                    return drafts.get(key) ?? model.drafts[key] ?? "";
                },
                saveValue: (id, value) => { requireModel(); return saveFieldValue(id, value); },
                setIdentity: (field, value) => {
                    requireModel();
                    if (field !== "name" && field !== "slug") throw new Error("Unknown workflow identity field");
                    model[field] = value;
                    const entry = model.items.find((item) => item.id === model.selected && item.pending);
                    if (entry) {
                        entry.slug = model.slug;
                        entry.label = model.name?.trim() || entry.slug || `Unstarted ${itemName}`;
                    }
                    queueInput();
                    renderStatus();
                },
                setConstitutionDraft: (value) => {
                    requireModel();
                    const step = constitution();
                    if (!step) throw new Error("Constitution is not configured");
                    constitutionDraft = remember(step, value);
                    clearTimeout(constitutionTimer);
                    constitutionTimer = setTimeout(() => {
                        constitutionTimer = null;
                        saveConstitutionDraft();
                    }, 400);
                },
                touchSlug: () => {
                    requireModel();
                    if (selectedPending()) { slugTouched = true; renderStatus(); }
                },
                confirmSetup, clearSetupPlan: () => { activeSetupPlan = null; },
                mountPhase,
                showDialog: showGeneratedDialog,
                error: (error) => message(error.message, "workflow-action-error", true),
            },
        });
        validateWorkflowMount(workflowPage);
        mountStockPresentation();
    } else mountPhase(pipelineRoot, initialState);
} catch (error) {
    message(`Pipeline could not render: ${error.message}`, "canvas-fatal-error", true);
    throw error;
}
wireThemeToggle();
wireGeneratedPages();
await mountGeneratedButtons().catch((error) => {
    message(`Generated buttons could not render: ${error.message}`, "canvas-message", true);
    throw error;
});
const events = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
events.onopen = () => { viewerConnected = true; viewer?.setConnected(true); setConnectionStatus("live"); };
events.onmessage = () => {
    if (!timer && !constitutionTimer) {
        stateNotificationVersion++;
        saving.catch(() => {}).then(() => refreshCurrent())
            .catch((error) => message(error.message, "canvas-message", true));
    }
    if (viewer) void viewer.refresh();
};
events.onerror = () => {
    viewerConnected = false;
    viewer?.setConnected(false);
    setConnectionStatus("lost");
    message("Connection interrupted. Drafts are retained; use Refresh if reconnection fails.");
};
window.addEventListener("beforeunload", (event) => {
    if (timer || constitutionTimer || saveFailure || pendingValueSaves || failedValueDrafts.size) {
        event.preventDefault();
        event.returnValue = "";
    }
});
window.addEventListener("pagehide", () => {
    events.close();
    if (workflowPage) workflowPage.dispose();
    else phaseControl?.dispose();
    buttonMounts.forEach((instance) => instance.dispose());
    disposeFieldMounts(mountedPage);
});
await refreshCurrent().then(async () => {
    if (!model.items.length && workflowPhases().length) await createWorkflow(true);
}).catch((error) => message(error.message, "canvas-message", true));
for (const root of document.querySelectorAll("[data-control-id]")) {
    void mountGeneratedControl(root);
}
