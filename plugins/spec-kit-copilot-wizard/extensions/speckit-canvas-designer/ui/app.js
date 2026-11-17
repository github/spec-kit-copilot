const token = new URL(location.href).searchParams.get("token");
const { GENERATION_PENDING, GENERATION_EXISTS } = await import(
    `/ui/generation-state.js?token=${encodeURIComponent(token)}`);
const { validateCanvasId, validateOutputStatusResponse, validateRevealResponse,
    validateOpenResponse, validateGenerateResponse, validateOutputError } = await import(
    `/ui/generated-output-state.js?token=${encodeURIComponent(token)}`);
let mountIdentity, declareMarkdownOutput, mountBadges, adapterContract;
const root = document.getElementById("settings-page");
const tabs = document.querySelector(".tabs");
const errorBox = document.getElementById("page-error");
const saveButton = document.getElementById("save-settings");
const messageBox = document.getElementById("action-message");
const generationNote = document.getElementById("generation-note");
const generationError = document.getElementById("generation-error");
const compositionError = document.getElementById("composition-error");
const messageSlots = [errorBox, generationNote, generationError, compositionError, messageBox];
function setMessage(slot, text) {
    slot.textContent = text;
    const visible = messageSlots.find((item) => item.textContent);
    for (const item of messageSlots) item.hidden = item !== visible;
}
let model, currentPage, draft, draftOutputs, draftBadges, saving = false;
let badgeView;
const generate = document.getElementById("generate-canvas");
const openGenerated = document.getElementById("open-generated-canvas");
let generating = false;
let requestedCanvasId = null;
let requestedRequestId = null;
let pendingReplacement = null;
let opening = false;
let requestedAt = 0;
let openingRequested = false;
let outputStatus = "absent";
let outputIdentity = "";
let outputRequestId = null;
let outputCheck = 0;
const generationGuidance = "Opening requested. Check the child-session chat. If you want to keep using Designer in this session, reopen it after the canvas opens.";
function updateOpenStatus() {
    const status = document.getElementById("open-status");
    if (status) status.textContent = opening || openingRequested ? generationGuidance
        : pendingReplacement
            ? "Regeneration requested. Wait for the new canvas files before opening. If regeneration fails, reopen Designer to use the existing canvas."
        : outputIdentity === draft?.["canvas.id"] && outputStatus === "ready"
            ? "Ready to open. Opening will disconnect Designer. If you want to keep using Designer in this session, reopen it after the canvas opens."
            : "Generate the canvas first.";
}
const activeUploads = new Set();
const required = ["canvas.id", "canvas.displayName"];
const scalarAdapters = new Map();
const badgeInputAdapters = new Map();
const mounted = new Map();
const pageViews = new Map();
const themeKey = "speckit-designer.theme";
const colorPreference = window.matchMedia?.("(prefers-color-scheme: dark)");
let selectedTheme = null;

function currentTheme() {
    const explicit = document.documentElement.getAttribute("data-theme");
    if (explicit === "dark" || explicit === "light") return explicit;
    return colorPreference?.matches ? "dark" : "light";
}

function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    const button = document.getElementById("theme-toggle");
    button.textContent = theme === "dark" ? "☾" : "☀";
    button.setAttribute("aria-label", theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
    button.title = button.getAttribute("aria-label");
}

try { selectedTheme = localStorage.getItem(themeKey); } catch { /* storage may be unavailable */ }
if (selectedTheme !== "dark" && selectedTheme !== "light") selectedTheme = null;
applyTheme(selectedTheme ?? (colorPreference?.matches ? "dark" : "light"));
colorPreference?.addEventListener?.("change", (event) => {
    if (!selectedTheme) applyTheme(event.matches ? "dark" : "light");
});
document.getElementById("theme-toggle").addEventListener("click", () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    selectedTheme = next;
    applyTheme(next);
    try { localStorage.setItem(themeKey, next); } catch { /* storage may be unavailable */ }
});

function outputPathsReady() {
    return Object.values(draftOutputs ?? {}).every((entry) =>
        entry.outputs.every((path) => path.endsWith(".md")));
}

function outputPath(id) {
    return `.github/extensions/${id || "<canvas-id>"}/`;
}

function updateOutputDisplay() {
    const id = draft?.["canvas.id"] ?? "";
    const ready = outputIdentity === id && outputStatus === "ready";
    const target = document.getElementById("output-target");
    if (target) target.textContent = outputPath(id);
    const projectCopy = document.getElementById("share-project-copy");
    if (projectCopy) projectCopy.hidden = !ready || !!pendingReplacement;
    const team = document.getElementById("share-project-path");
    if (team) team.textContent = ready && !pendingReplacement ? outputPath(id) : "";
    const shareNote = document.getElementById("share-target-note");
    if (shareNote) {
        shareNote.hidden = ready && !pendingReplacement;
        shareNote.textContent = shareNote.hidden ? "" : pendingReplacement
            ? "Wait for regeneration to finish before sharing this canvas."
            : "Generate and verify the current Canvas ID before sharing it.";
    }
    const status = document.getElementById("generation-status");
    if (status) status.textContent = pendingReplacement?.canvasId === id
        ? "Regenerating canvas files. Check the child-session chat for progress or errors."
        : ready ? "Canvas files created."
        : requestedCanvasId === id && requestedRequestId
        ? Date.now() - requestedAt < 120000 ? "Creating canvas files."
            : "Canvas creation is taking longer than expected. Check the child-session chat for progress or errors."
        : outputIdentity === id && outputStatus === "foreign"
            ? "An unrelated canvas folder already exists at this location."
            : outputIdentity === id && outputStatus === "incomplete"
                ? "Canvas files are incomplete. Inspect the target folder before trying again."
                : requestedCanvasId === id ? "Creating canvas files." : "Not generated";
}

async function refreshOutputStatus(id = requestedCanvasId ?? draft?.["canvas.id"]) {
    const check = ++outputCheck;
    try { validateCanvasId(id); } catch {
        outputIdentity = "";
        outputStatus = "absent";
        updateOutputDisplay();
        updateGenerate();
        return { status: "absent", requestId: null };
    }
    const response = await fetch(`/api/output-status?token=${encodeURIComponent(token)}&canvasId=${encodeURIComponent(id)}`,
        { signal: AbortSignal.timeout(5000) });
    const result = await response.json();
    if (!response.ok) throw new Error(validateOutputError(result).error);
    const validated = validateOutputStatusResponse(result, id);
    if (check !== outputCheck) return validated;
    outputIdentity = id;
    outputStatus = validated.status;
    outputRequestId = validated.requestId ?? null;
    if (pendingReplacement?.canvasId === id && validated.status === "ready"
        && pendingReplacement.requestId === validated.requestId) pendingReplacement = null;
    updateOutputDisplay();
    updateGenerate();
    return validated;
}

function updateGenerate() {
    const setup = model?.pages.find((page) => page.page === "designer-essentials");
    const failed = model?.pages.find((page) => page.error);
    const missingIdentity = model && !failed && (!setup || setup.enabled === false
        || !required.every((field) => setup.fields?.some((item) => item.id === field)));
    const reason = model?.preview ? "" : model?.generationError
        ? model.generationError
        : failed
        ? `Cannot generate: ${failed.page} could not load. ${failed.error.reason}`
        : model?.generationBlockers?.length
            ? `Cannot generate: ${model.generationBlockers.join("; ")}`
        : missingIdentity ? "Cannot generate: Essentials must contain Canvas ID and Title."
            : "";
    const expectedState = reason === GENERATION_PENDING;
    if (!requestedCanvasId && !generating && !connectionError)
        setMessage(generationNote, expectedState ? reason : "");
    setMessage(generationError, expectedState ? "" : reason);
    generate.textContent = generating ? "Submitting..." : outputIdentity === (draft?.["canvas.id"] ?? "")
        && outputStatus === "ready"
        ? "Regenerate canvas" : "Generate canvas";
    generate.disabled = model?.preview || saving || activeUploads.size > 0 || generating
        || opening || openingRequested
        || !outputPathsReady()
        || !model?.handoffId
        || !model.generationAvailable || !setup || !!failed || setup.enabled === false
        || missingIdentity || !!model?.generationBlockers?.length;
    openGenerated.disabled = model?.preview || !model?.handoffId || opening || openingRequested
        || !!pendingReplacement
        || generating || outputIdentity !== draft?.["canvas.id"] || outputStatus !== "ready";
    updateOpenStatus();
    updateOutputDisplay();
}

function confirmReplacement(id) {
    const dialog = document.getElementById("replace-canvas");
    document.getElementById("replace-canvas-description").textContent =
        `Replace all files in ${outputPath(id)}? This removes any manual edits in the generated folder.`;
    dialog.returnValue = "";
    dialog.showModal();
    return new Promise((resolve) => dialog.addEventListener("close",
        () => resolve(dialog.returnValue === "replace"), { once: true }));
}

function confirmProviders(providers) {
    const dialog = document.getElementById("provider-approval");
    const list = document.getElementById("provider-approval-list");
    list.replaceChildren();
    for (const { name, sourceId, hash } of providers) {
        list.append(element("dt", name), element("dd", `Source: ${sourceId}`),
            element("dd", `SHA-256: ${hash}`));
    }
    dialog.returnValue = "";
    dialog.showModal();
    return new Promise((resolve) => dialog.addEventListener("close",
        () => resolve(dialog.returnValue === "approve"), { once: true }));
}

generate.addEventListener("click", async () => {
    if (model?.preview || generate.disabled || !checkReady()) return;
    const providers = model.templates.filter((item) => item.kind === "generated.computed-value-provider")
        .map(({ name, sourceId, hash }) => ({ name, sourceId, hash }));
    generating = true;
    updateSave();
    setMessage(messageBox, "");
    showError("");
    try {
        const submittedId = draft["canvas.id"];
        const checked = await refreshOutputStatus(submittedId);
        if (checked.status === "foreign" || checked.status === "incomplete") {
            throw new Error("Cannot replace this canvas folder. Inspect the target folder first.");
        }
        const replaceExisting = checked.status === "ready";
        const priorRequestId = replaceExisting ? checked.requestId : null;
        if (replaceExisting && !await confirmReplacement(submittedId)) return;
        if (providers.length && !await confirmProviders(providers)) return;
        const values = structuredClone(draft);
        const outputs = structuredClone(draftOutputs);
        const badges = structuredClone(draftBadges);
        let saved;
        try {
            saved = await persistSettings({ values, outputs, badges });
        } catch (error) {
            throw new Error(`Could not save settings: ${error.message}`, { cause: error });
        }
        model = saved;
        const response = await fetch(`/api/generate?token=${encodeURIComponent(token)}`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ modelRevision: saved.revision,
                settingsRevision: saved.settingsRevision, values, outputs,
                badges: saved.badges,
                ...(replaceExisting ? { replaceExisting: true, replaceRequestId: priorRequestId } : {}),
                ...(providers.length ? { approvedProviders: providers } : {}) }),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(validateOutputError(body).error);
        const result = validateGenerateResponse(body, submittedId);
        if (result.warnings?.length) {
            setMessage(messageBox, `Warning: ${result.warnings.join(" ")}`);
        }
        requestedCanvasId = submittedId;
        requestedRequestId = result.requestId;
        if (replaceExisting) pendingReplacement = { canvasId: submittedId, requestId: result.requestId };
        requestedAt = Date.now();
        updateOutputDisplay();
    } catch (error) {
        showFieldError(error.message);
    } finally {
        generating = false;
        updateSave();
        await checkConnection(true);
    }
});

openGenerated.addEventListener("click", async () => {
    if (openGenerated.disabled || model?.preview || !model?.handoffId || openingRequested) return;
    const id = draft?.["canvas.id"];
    opening = true;
    updateGenerate();
    showError("");
    try {
        await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
        const response = await fetch(`/api/open-generated?token=${encodeURIComponent(token)}`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ canvasId: id }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(validateOutputError(result).error);
        validateOpenResponse(result, id);
        openingRequested = true;
    } catch (error) {
        openingRequested = false;
        showError(error.message);
    } finally {
        opening = false;
        updateGenerate();
    }
});

function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
}

function showError(message) {
    setMessage(errorBox, message);
    if (message) errorBox.focus();
}

function showFieldError(message) {
    showError(message);
    let id;
    const page = model.pages.find((entry) => entry.fields?.some((field) => {
        const labelAndId = `${field.label} (${field.id})`;
        if (!message.startsWith(labelAndId) && !message.startsWith(`Invalid ${labelAndId}`)
            && !message.startsWith(`Missing Designer adapter for ${labelAndId}`)) return false;
        id = field.id;
        return true;
    }));
    if (!page) return;
    if (page.page !== currentPage) renderPage(page.page, id);
    const focus = () => {
        const mount = [...root.querySelectorAll("[data-field-id]")]
            .find((item) => item.dataset.fieldId === id);
        if (mount) {
            mount.nextElementSibling.hidden = false;
            mount.parentElement.focus();
        }
    };
    if (saving || generating) queueMicrotask(focus);
    else focus();
}

function checkReady() {
    for (const page of model.pages) {
        if (page.page !== currentPage && !pageViews.has(page.page)) continue;
        for (const field of page.fields ?? []) {
            const handle = mounted.get(field.id);
            try {
                if (typeof handle?.isReady !== "function" || handle.isReady() !== true) {
                    showFieldError(`${field.label} (${field.id}) is still processing or needs attention.`);
                    return false;
                }
            } catch (error) {
                showFieldError(`${field.label} (${field.id}) readiness failed: ${error.message}`);
                return false;
            }
        }
    }
    return true;
}

function updateSave() {
    const noChanges = model?.persisted
        && JSON.stringify(draft) === JSON.stringify(model.values)
        && JSON.stringify(draftOutputs) === JSON.stringify(model.outputs)
        && JSON.stringify(draftBadges) === JSON.stringify(model.badges);
    saveButton.disabled = model?.preview || saving || generating
        || activeUploads.size > 0 || !model
        || !model.pages.length || noChanges || !outputPathsReady();
    document.getElementById("save-help").title = noChanges ? "No changes to save" : "";
    if (noChanges) saveButton.setAttribute("aria-description", "No changes to save");
    else saveButton.removeAttribute("aria-description");
    saveButton.textContent = saving ? "Saving..." : "Save";
    saveButton.setAttribute("aria-busy", String(saving));
    root.inert = saving || generating || activeUploads.size > 0;
    for (const tab of tabs.children) tab.disabled = saving || generating
        || activeUploads.size > 0;
    updateGenerate();
}

async function persistSettings({ values, outputs, badges }) {
    const response = await fetch(`/api/save?token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelRevision: model.revision,
            revision: model.settingsRevision, values, outputs, badges }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? `Designer save failed (${response.status})`);
    return result;
}

saveButton.addEventListener("click", async () => {
    if (model?.preview || saving || generating || !model || !checkReady()) return;
    saving = true;
    setMessage(messageBox, "");
    showError("");
    updateSave();
    try {
        model = await persistSettings({ values: draft, outputs: draftOutputs, badges: draftBadges });
        setMessage(messageBox, "Settings saved.");
    } catch (error) {
        showError(`Could not save settings: ${error.message}`);
    } finally {
        saving = false;
        updateSave();
    }
});

function renderPage(pageId, invalidFieldId) {
    if (pageId === "designer-generate") {
        if (currentPage && root.childNodes.length) pageViews.set(currentPage, [...root.childNodes]);
        currentPage = pageId;
        for (const tab of tabs.children) {
            const active = tab.dataset.page === pageId;
            tab.setAttribute("aria-selected", String(active));
            tab.tabIndex = active ? 0 : -1;
        }
        root.setAttribute("aria-labelledby", `page-tab-${pageId}`);
        const content = element("div", undefined, "generate-page");
        const intro = element("div", undefined, "generate-intro");
        intro.append(element("h1", "Create and open your canvas"),
            element("p", "Create the canvas from your saved settings, then open it here.", "muted"));
        const generateStep = element("section", undefined, "generate-step");
        generateStep.setAttribute("aria-labelledby", "generate-step-title");
        const generateTitle = element("h2", "Generate");
        generateTitle.id = "generate-step-title";
        generateTitle.prepend(element("span", "1", "step-index"));
        generateTitle.firstChild.setAttribute("aria-hidden", "true");
        generateStep.append(generateTitle, element("p", "Canvas ID", "setting-label"),
            element("p", draft?.["canvas.id"] ?? "", "generation-canvas-id"),
            element("p", "Target folder", "setting-label"));
        const target = element("code");
        target.id = "output-target";
        const folderLink = element("a");
        folderLink.id = "open-output-folder";
        folderLink.href = "#";
        folderLink.append(target);
        folderLink.addEventListener("click", async (event) => {
            event.preventDefault();
            const id = draft?.["canvas.id"];
            try {
                const response = await fetch(`/api/reveal-output?token=${encodeURIComponent(token)}`, {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ canvasId: id }),
                });
                const result = await response.json();
                if (!response.ok) throw new Error(validateOutputError(result).error);
                validateRevealResponse(result, id);
            } catch (error) { showError(error.message); }
        });
        const folder = element("p", undefined, "generation-target");
        folder.append(folderLink);
        const state = element("p");
        state.id = "generation-status";
        state.setAttribute("role", "status");
        generateStep.append(folder, element("p", "Status", "setting-label"), state, generate);
        const openStep = element("section", undefined, "generate-step");
        openStep.setAttribute("aria-labelledby", "open-step-title");
        const openTitle = element("h2", "Open");
        openTitle.id = "open-step-title";
        openTitle.prepend(element("span", "2", "step-index"));
        openTitle.firstChild.setAttribute("aria-hidden", "true");
        openGenerated.classList.add("primary");
        const openStatus = element("p");
        openStatus.id = "open-status";
        openStatus.setAttribute("role", "status");
        openStep.append(openTitle,
            element("p", "Open your generated canvas in this session."),
            element("p", "Status", "setting-label"), openStatus,
            openGenerated);
        const share = element("section", undefined, "generate-step generate-share");
        share.setAttribute("aria-labelledby", "generate-share-title");
        const shareTitle = element("h2", "Share");
        shareTitle.id = "generate-share-title";
        shareTitle.prepend(element("span", "3", "step-index"));
        shareTitle.firstChild.setAttribute("aria-hidden", "true");
        share.append(shareTitle,
            element("p", "Choose how you want to make this canvas available:"),
            element("h3", "Team project extension"));
        const projectCopy = element("p");
        projectCopy.id = "share-project-copy";
        const sharePath = element("code");
        sharePath.id = "share-project-path";
        projectCopy.append("Once generated, commit ", sharePath, " to your repository.");
        const shareNote = element("p");
        shareNote.id = "share-target-note";
        share.append(projectCopy,
            shareNote,
            element("p", "Teammates will get the canvas when they use that repository."),
            element("h3", "Personal extension"),
            element("p", "Copy the canvas to ~/.copilot/extensions/ to use it on this machine without committing it to the repository."),
            element("h3", "Package as a plugin"));
        const plugin = element("p");
        const pluginLink = element("a", "About GitHub Copilot plugins");
        pluginLink.href = "https://docs.github.com/en/copilot/concepts/agents/about-plugins";
        pluginLink.rel = "noopener noreferrer";
        pluginLink.target = "_blank";
        plugin.append("For a separately installable, versioned distribution, see ", pluginLink, ".");
        share.append(plugin);
        content.append(intro, generateStep, openStep, share);
        generate.hidden = false;
        openGenerated.hidden = false;
        root.replaceChildren(content);
        updateOpenStatus();
        root.setAttribute("aria-busy", "false");
        updateGenerate();
        return true;
    }
    const page = model.pages.find((entry) => entry.page === pageId);
    if (!page) throw new Error("Unknown Designer page");
    generate.hidden = true;
    openGenerated.hidden = true;
    const renderRevision = model.revision;
    if (currentPage && root.childNodes.length) {
        pageViews.set(currentPage, [...root.childNodes]);
    }
    currentPage = pageId;
    for (const tab of tabs.children) {
        const active = tab.dataset.page === pageId;
        tab.setAttribute("aria-selected", String(active));
        tab.tabIndex = active ? 0 : -1;
    }
    root.setAttribute("aria-labelledby", `page-tab-${pageId}`);
    if (pageViews.has(pageId)) {
        root.replaceChildren(...pageViews.get(pageId));
        if (page.fixedControl === "designer.badges") badgeView.updateOutputs(draftOutputs);
        if (invalidFieldId) {
            const mount = [...root.querySelectorAll("[data-field-id]")]
                .find((item) => item.dataset.fieldId === invalidFieldId);
            if (mount) {
                mount.nextElementSibling.hidden = false;
                mount.parentElement.focus();
            }
        }
        root.setAttribute("aria-busy", "false");
        return true;
    }
    if (page.error) {
        const { name, path, reason } = page.error;
        const details = element("div", undefined, "page-diagnostic");
        details.append(element("h1", `Could not load ${name}`),
            element("p", "This settings page could not be loaded. Ask your agent to inspect the template and resolve the issue."),
            element("p", `Template: ${name}`), element("p", `Resolved path: ${path}`),
            element("p", `Reason: ${reason}`));
        root.replaceChildren(details);
        root.setAttribute("aria-busy", "false");
        return true;
    }
    if (page.fixedControl === "designer.badges") {
        badgeView = mountBadges({ root, page, phases: model.phases, outputs: draftOutputs,
            badgeTypes: model.badgeTypes ?? [], badgeRules: model.badgeRules ?? [],
            draftBadges, onChange: updateSave,
            onValidateImport: model.preview ? undefined : async ({ config, badges, outputs, signal }) => {
                const importModel = model;
                const contract = await import(
                    `/ui/badge-import-contract.js?token=${encodeURIComponent(token)}`);
                const assertCurrent = () => {
                    if (model !== importModel || model.revision !== renderRevision || saving || generating) {
                        throw new Error("Designer settings changed or are being saved. Select the file again after saving or generation finishes.");
                    }
                };
                assertCurrent();
                const input = contract.validateBadgeImportRequest({ schemaVersion: 1,
                    modelRevision: renderRevision, config, badges, outputs });
                const response = await fetch(`/api/validate-badge-import?token=${encodeURIComponent(token)}`, {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(input),
                    signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
                });
                const result = await response.json();
                if (!response.ok) throw new Error(contract.validateBadgeImportError(result).error);
                assertCurrent();
                return contract.validateBadgeImportResponse(result, [...badges, ...config.badges.instances]);
            },
            onDeclareFile(phase, path) {
                const next = declareMarkdownOutput(draftOutputs, model.phases, phase, path);
                updateSave();
                return next;
            },
            controlMount({ root: mount, rule, inputs, phases, outputs, onChange, onDeclareFile,
                selectionRoot, placements }) {
                const binding = model.badgeInputControls?.find((item) => item.rule === rule.id);
                if (!binding) throw new Error(`Missing Designer badge input control for ${rule.id}`);
                const adapter = badgeInputAdapters.get(binding.adapter);
                if (adapter instanceof Error) throw adapter;
                if (!adapter) throw new Error(`Missing Designer badge input adapter ${binding.adapter}`);
                return adapterContract.mountBadgeInputAdapter(adapter, binding,
                    { root: mount, rule, inputs, phases, outputs, onChange, onDeclareFile,
                        selectionRoot, placements });
            } });
        root.setAttribute("aria-busy", "false");
        return true;
    }
    root.replaceChildren(element("h1", page.title), element("p", page.description ?? "", "muted"));
    const form = element("form");
    form.noValidate = true;
    form.addEventListener("submit", (event) => {
        event.preventDefault();
        saveButton.click();
    });
    if (!page.fields.length) form.append(element("p", "This template defines no fields.", "settings-note"));
    root.append(form);
    const identity = page.fixedControl === "designer.identity"
        ? page.fields.filter((field) => ["canvas.id", "canvas.displayName"].includes(field.id)) : [];
    if (identity.length) {
        const handles = mountIdentity({ root: form, fields: identity, values: draft,
            invalidFieldId, onChange(id, value) {
                draft[id] = value;
                setMessage(messageBox, "");
                showError("");
                updateSave();
                if (id === "canvas.id") {
                    void checkOutputStatus(value);
                }
            } });
        for (const [id, handle] of handles) mounted.set(id, handle);
    }
    for (const field of page.fields.filter((item) => !identity.some((fixed) => fixed.id === item.id))) {
        const rules = model.constraints[field.id];
        const image = rules.type === "image";
        const object = rules.type === "object";
        const wrapper = element("div", undefined, `settings-field${image ? " settings-image"
            : rules.type === "boolean" ? " settings-checkbox" : ""}`);
        wrapper.tabIndex = -1;
        wrapper.setAttribute("role", "group");
        wrapper.setAttribute("aria-label", field.label);
        if (object) wrapper.append(element("p", field.label));
        const mount = element("div");
        if (object) mount.setAttribute("aria-label", field.label);
        mount.dataset.fieldId = field.id;
        wrapper.append(mount);
        const fieldError = element("p", `Invalid ${field.label} (${field.id}).`, "settings-field-error");
        fieldError.id = `setting-error-${field.id}`;
        fieldError.setAttribute("role", "alert");
        fieldError.hidden = field.id !== invalidFieldId;
        wrapper.setAttribute("aria-describedby", fieldError.id);
        wrapper.append(fieldError);
        form.append(wrapper);
        if (field.id === invalidFieldId) wrapper.focus();
        const control = field.control ?? (rules.type === "boolean" ? "stock.checkbox" : "stock.text");
        const adapter = model.adapters[control];
        if (!adapter) {
            mount.setAttribute("role", "alert");
            mount.textContent = `Could not load ${field.label}: missing Designer adapter`;
            continue;
        }
        const isRetained = () => mount.isConnected
            || pageViews.get(pageId)?.some((node) => node.contains(mount));
        const mountAdapter = (module) => {
                if (model.revision !== renderRevision) return;
                const expected = model.controls.find((item) => item.id === control)?.value;
                adapterContract.validateAdapterModule(module, control, expected, image, object);
                if (!isRetained()) return;
                const handle = module.mount({ root: mount, field, value: draft[field.id],
                    ...(image ? { context: { setBusy(busy) {
                            if (busy) activeUploads.add(field.id);
                            else activeUploads.delete(field.id);
                            updateSave();
                        } } } : {}),
                    onChange(value) {
                            if (model.revision !== renderRevision || !isRetained()) return;
                        adapterContract.validateAdapterChange(value, rules, field.id);
                        draft[field.id] = value;
                        fieldError.hidden = true;
                        setMessage(messageBox, "");
                        showError("");
                        updateSave();
                        updateGenerate();
                    } });
                adapterContract.validateAdapterHandle(handle);
                mounted.set(field.id, handle);
        };
        const showAdapterError = (error) => {
            if (model.revision !== renderRevision) return;
            mount.replaceChildren();
            mount.setAttribute("role", "alert");
            mount.textContent = `Could not load ${field.label}: ${error.message}`;
        };
        if (rules.type === "string" || rules.type === "boolean") {
            try {
                const loaded = scalarAdapters.get(control);
                if (loaded instanceof Error) throw loaded;
                if (!loaded) throw new Error("Missing Designer adapter");
                Promise.resolve(mountAdapter(loaded)).catch(showAdapterError);
            } catch (error) {
                showAdapterError(error);
            }
        } else {
            import(`/adapters/${adapter}.mjs?token=${encodeURIComponent(token)}`)
                .then(mountAdapter).catch(showAdapterError);
        }
    }
    root.setAttribute("aria-busy", "false");
    return true;
}

tabs.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-page]");
    if (tab && tab.dataset.page !== currentPage) renderPage(tab.dataset.page);
});
tabs.addEventListener("keydown", (event) => {
    const buttons = [...tabs.children];
    const index = buttons.indexOf(document.activeElement);
    if (index < 0) return;
    let next;
    if (event.key === "ArrowRight") next = (index + 1) % buttons.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + buttons.length) % buttons.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = buttons.length - 1;
    else return;
    event.preventDefault();
    if (buttons[next].dataset.page !== currentPage) {
        renderPage(buttons[next].dataset.page);
        buttons[next].focus();
    }
});

function applyState(next) {
    if (!Array.isArray(next.pages)) throw new Error("Designer returned invalid settings pages");
    const changed = !model || next.revision !== model.revision;
    if (changed) {
        model = next;
        pageViews.clear();
        mounted.clear();
        badgeView?.dispose?.();
        badgeView = undefined;
        root.replaceChildren();
        document.getElementById("preview-banner").hidden = !model.preview;
        document.getElementById("save-help").hidden = !!model.preview;
        generate.hidden = true;
        openGenerated.hidden = true;
        draft = structuredClone(model.values);
        draftOutputs = structuredClone(model.outputs ?? Object.fromEntries(
            (model.phases ?? []).map((id) => [id, { outputs: [], view: null }])));
        draftBadges = structuredClone(model.badges ?? []);
        tabs.replaceChildren();
        setMessage(compositionError, (model.compositionErrors ?? []).join("; "));
        for (const page of model.pages) {
            const tab = element("button", page.error ? `${page.title} (error)` : page.title,
                `tab${page.error ? " tab-error" : ""}`);
            tab.type = "button";
            tab.dataset.page = page.page;
            tab.id = `page-tab-${page.page}`;
            tab.setAttribute("role", "tab");
            tab.setAttribute("aria-controls", "settings-page");
            tabs.append(tab);
        }
        if (!model.preview) {
            const tab = element("button", "Generate", "tab");
            tab.type = "button";
            tab.dataset.page = "designer-generate";
            tab.id = "page-tab-designer-generate";
            tab.setAttribute("role", "tab");
            tab.setAttribute("aria-controls", "settings-page");
            tabs.append(tab);
        }
        const selected = model.pages.find((page) => page.page === currentPage)
            ?? model.pages.find((page) => page.page === "designer-essentials")
            ?? model.pages[0];
        if (selected) renderPage(selected.page);
        else if (model.pages.length && !model.preview) renderPage("designer-generate");
        else {
            currentPage = null;
            root.setAttribute("aria-busy", "false");
            root.replaceChildren(element("h1", "No Designer pages registered"),
                element("p", "This preset composition contains no settings pages."));
        }
        updateSave();
        updateGenerate();
    }
}

const status = document.getElementById("conn-status");
let connectionError = "";
let outputStatusError = "";
let healthChecks = 0;
let connectionCheck = 0;
function connectionStatus(state) {
    status.className = `conn conn-${state}`;
    status.textContent = state === "live" ? "Live" : state === "connecting" ? "Connecting" : "Disconnected";
}
async function checkOutputStatus(id) {
    const check = outputCheck + 1;
    try {
        await refreshOutputStatus(id);
        if (check !== outputCheck) return;
        if (outputStatusError && errorBox.textContent === outputStatusError)
            setMessage(errorBox, "");
        outputStatusError = "";
    } catch (error) {
        if (check !== outputCheck) return;
        if (!errorBox.textContent || errorBox.textContent === outputStatusError)
            setMessage(errorBox, error.message);
        outputStatusError = error.message;
    }
}
async function checkConnection(forceAvailability = false) {
    const checkId = ++connectionCheck;
    try {
        const refreshAvailability = model && (forceAvailability || ++healthChecks % 6 === 0);
        const response = await fetch(
            `${refreshAvailability ? "/api/state" : "/ui/styles.css"}?token=${encodeURIComponent(token)}`,
            { signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw new Error(`Designer connection check failed (${response.status})`);
        if (model) {
            if (refreshAvailability) {
                const latest = await response.json();
                if (checkId !== connectionCheck) return;
                if (typeof latest?.generationAvailable !== "boolean"
                    || (latest.generationError !== null && typeof latest.generationError !== "string")) {
                    throw new Error("Designer connection check returned invalid generation state");
                }
                model.generationAvailable = latest.generationAvailable;
                model.generationError = latest.generationError;
                updateGenerate();
            }
            if (checkId !== connectionCheck) return;
            connectionStatus("live");
            if (connectionError && generationNote.textContent === connectionError)
                setMessage(generationNote, "");
            connectionError = "";
            if (requestedCanvasId || currentPage === "designer-generate")
                await checkOutputStatus(draft?.["canvas.id"]);
        }
    } catch (error) {
        if (checkId !== connectionCheck) return;
        connectionStatus("lost");
        if (openingRequested) {
            return;
        }
        const next = `Designer connection interrupted: ${error.message}. Unsaved edits remain in this panel. If it does not reconnect, restart Designer (close this panel and open Designer again); copy any unsaved edits first.`;
        if (generationNote.textContent !== next || generationNote.hidden)
            setMessage(generationNote, next);
        connectionError = next;
    }
}
const connectionTimer = setInterval(() => { void checkConnection(); }, 10000);
window.addEventListener("pagehide", () => clearInterval(connectionTimer));
try {
    [{ mountIdentity }, { declareMarkdownOutput }, { mountBadges },
        adapterContract] = await Promise.all([
        import(`/ui/identity-control.js?token=${encodeURIComponent(token)}`),
        import(`/ui/output-evidence.js?token=${encodeURIComponent(token)}`),
        import(`/ui/badges-control.js?token=${encodeURIComponent(token)}`),
        import(`/ui/external-control-adapter-contract.js?token=${encodeURIComponent(token)}`),
    ]);
    const response = await fetch(`/api/state?token=${encodeURIComponent(token)}`);
    if (!response.ok) throw new Error(`Designer settings request failed (${response.status})`);
    const initial = await response.json();
    await Promise.all(["stock.text", "stock.checkbox"].filter((id) => initial.adapters?.[id])
        .map(async (id) => {
            try {
                scalarAdapters.set(id, await import(
                    `/adapters/${initial.adapters[id]}.mjs?token=${encodeURIComponent(token)}`));
            } catch (error) {
                scalarAdapters.set(id, error);
            }
        }));
    await Promise.all([...new Set((initial.badgeInputControls ?? [])
        .map((item) => item.adapter))].map(async (name) => {
        try {
            badgeInputAdapters.set(name, await import(
                `/adapters/${name}.mjs?token=${encodeURIComponent(token)}`));
        } catch (error) {
            badgeInputAdapters.set(name, error);
        }
    }));
    applyState(initial);
    connectionStatus("live");
    if (!initial.preview) await checkOutputStatus(draft?.["canvas.id"]);
} catch (error) {
    root.setAttribute("aria-busy", "false");
    root.replaceChildren(element("h1", "Settings unavailable"));
    connectionStatus("lost");
    showError(error.message);
}
