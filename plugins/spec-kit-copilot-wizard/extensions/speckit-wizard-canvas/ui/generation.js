// Wizard Generate controls for capturing a pipeline and requesting a standalone canvas.
import { state, bareCommandId, capitalize } from "./state.js";
import { effectivePipelinePhases, stripCommandsPrefix } from "../pipeline/effective-phases.mjs";

let __postJson = async () => undefined;
let __render = () => {};
let preflightTimer = null;
let dialogVersion = 0;
let preflightVersion = 0;

function resultInputs(root) {
    return [...root.querySelectorAll("[data-result-label]")];
}

function resultLabels(root) {
    return resultInputs(root).map((input) => input.value.trim()).filter(Boolean);
}

function renderResultInputs(root, values, onChange) {
    const list = root.querySelector("#generation-result-list");
    if (!list) return;
    list.innerHTML = values.map((value, index) => `
        <div class="generation-result-row">
            <label class="wizard-modal-field" for="generation-result-${index}">
                <span class="wizard-modal-field-label">Tag ${index + 1}</span>
                <input id="generation-result-${index}" data-result-label class="wizard-modal-input" maxlength="60"
                    value="${escapeHtml(value)}" placeholder="e.g. ${["Implemented", "Partially implemented", "Not implemented"][index] ?? "Deferred"}"
                    aria-describedby="generation-results-help generation-results-examples generation-messages" />
            </label>
            <button type="button" class="btn btn-secondary btn-sm" data-remove-result="${index}" aria-label="Remove tag ${index + 1}">Remove</button>
        </div>`).join("");
    for (const input of resultInputs(root)) input.addEventListener("input", onChange);
    for (const button of root.querySelectorAll("[data-remove-result]")) {
        button.addEventListener("click", () => {
            const next = resultInputs(root).map((input) => input.value);
            const index = Number(button.dataset.removeResult);
            next.splice(index, 1);
            renderResultInputs(root, next, onChange);
            onChange();
            (resultInputs(root)[Math.min(index, next.length - 1)] ?? root.querySelector("#generation-add-result"))?.focus();
        });
    }
    renderResultSettings(root, root._generationPreflight);
}

function renderResultSettings(root, result) {
    const invalid = result?.errors?.some((error) => error.field === "resultLabels");
    const inputs = resultInputs(root);
    for (const input of inputs) {
        input.setAttribute("aria-invalid", invalid ? "true" : "false");
    }
    const add = root.querySelector("#generation-add-result");
    if (add) add.disabled = inputs.length >= 5;
}

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => (
        { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]
    ));
}

export function setGenerationDeps({ postJson, render } = {}) {
    if (typeof postJson === "function") __postJson = postJson;
    if (typeof render === "function") __render = render;
}

function commandForPipelineId(id, snapshot = state.snapshot) {
    const normalized = stripCommandsPrefix(id);
    return (snapshot?.commands ?? []).find((command) => (
        stripCommandsPrefix(command.id) === normalized
        || stripCommandsPrefix(command.commandName) === normalized
    )) ?? null;
}

function workflowProvider(snapshot = state.snapshot) {
    const providers = new Map();
    const artifacts = snapshot?.composition?.artifacts ?? [];
    const contributionMeta = new Map([
        ...(snapshot?.composition?.presets ?? []).map((entry) => [`preset:${entry.id}`, entry]),
        ...(snapshot?.composition?.extensions ?? []).map((entry) => [`extension:${entry.id}`, entry]),
    ]);
    effectivePipelinePhases(snapshot).forEach((entry, index) => {
        const normalized = stripCommandsPrefix(entry.id);
        const artifact = artifacts.find((candidate) => stripCommandsPrefix(candidate?.id) === normalized);
        const active = artifact?.stack?.find((layer) => layer?.active && (layer.layer === "preset" || layer.layer === "extension"));
        const command = commandForPipelineId(entry.id, snapshot);
        const fallback = String(command?.source ?? "").match(/^(preset|extension):(.+)$/);
        const kind = active?.layer ?? fallback?.[1] ?? null;
        const id = active?.presetId ?? active?.extensionId ?? fallback?.[2] ?? null;
        if (!kind || !id) return;
        const key = `${kind}:${id}`;
        const meta = contributionMeta.get(key);
        const candidate = providers.get(key) ?? {
            kind,
            id,
            name: active?.presetName ?? active?.extensionName ?? meta?.name ?? id,
            priority: Number(active?.priority ?? meta?.priority ?? 0),
            count: 0,
            firstIndex: index,
        };
        candidate.count += 1;
        providers.set(key, candidate);
    });
    return [...providers.values()].sort((left, right) => (
        right.priority - left.priority
        || right.count - left.count
        || left.firstIndex - right.firstIndex
    ))[0] ?? null;
}

function slugify(value) {
    return String(value ?? "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 63);
}

export function defaultGenerationMetadata(snapshot = state.snapshot) {
    const items = effectivePipelinePhases(snapshot);
    const provider = workflowProvider(snapshot);
    const labels = items.map((entry) => {
        const command = commandForPipelineId(entry.id, snapshot);
        const fallback = bareCommandId(entry.id).split(".").pop();
        return command?.shortLabel || command?.title || capitalize(fallback);
    }).filter(Boolean);
    const extensionId = slugify(provider ? `${provider.id}-workflow` : "spec-kit-workflow");
    const providerName = provider?.name
        ? provider.name.split(/[-_]/).map(capitalize).join(" ")
        : null;
    const displayName = providerName ? `${providerName} Workflow` : "Spec Kit Workflow";
    const sequence = labels.join(" → ");
    return {
        extensionId,
        displayName,
        workflowListName: "Workflows",
        userProvidesSlug: false,
        requireInstallationApproval: false,
        resultLabels: [],
        description: sequence
            ? `Visual workflow for ${sequence}.`
            : "Visual Spec Kit workflow.",
    };
}

export function generationAvailability(snapshot = state.snapshot) {
    const items = effectivePipelinePhases(snapshot);
    if (!items.length) return { enabled: false, reason: "Add at least one command to the pipeline before generating." };
    const setup = snapshot?.setup ?? {};
    const env = snapshot?.environment ?? {};
    const setupReady = (setup.pluginInstalled || env.pluginInstalled)
        && (setup.cliInstalled || env.cliInstalled)
        && setup.projectInitialized
        && setup.skillsReloaded;
    if (!setupReady) return { enabled: false, reason: "Complete Setup and reload skills before generating." };
    return { enabled: true, reason: "" };
}

export function generationStatus(snapshot = state.snapshot) {
    return snapshot?.generation ?? null;
}

function renderMessages(container, result) {
    if (!container) return;
    const errors = Array.isArray(result?.errors) ? result.errors : [];
    const warnings = Array.isArray(result?.warnings) ? result.warnings : [];
    container.innerHTML = [
        ...errors.map((message) => `<div class="generation-message generation-error">${escapeHtml(message?.message ?? message)}</div>`),
        ...warnings.map((message) => `<div class="generation-message generation-warning">${escapeHtml(message?.message ?? message)}</div>`),
    ].join("");
}

async function runPreflight(root) {
    const version = ++preflightVersion;
    const dialog = dialogVersion;
    const extensionId = root.querySelector("#generation-extension-id")?.value.trim() ?? "";
    const displayName = root.querySelector("#generation-display-name")?.value.trim() ?? "";
    const description = root.querySelector("#generation-description")?.value.trim() ?? "";
    const workflowListName = root.querySelector("#generation-workflow-list-name")?.value.trim() ?? "";
    const userProvidesSlug = root.querySelector("#generation-user-provides-slug")?.checked === true;
    const requireInstallationApproval = root.querySelector("#generation-require-installation-approval")?.checked === true;
    const target = root.querySelector("#generation-target");
    let result;
    try {
        result = await __postJson("/api/generation/preflight", { extensionId, displayName, description, workflowListName, userProvidesSlug, requireInstallationApproval, resultLabels: resultLabels(root) });
    } catch {
        result = { ok: false, errors: ["Could not check generation settings. Try Generate again."] };
    }
    if (version !== preflightVersion || dialog !== dialogVersion) return null;
    root._generationPreflight = result;
    renderMessages(root.querySelector("#generation-messages"), result);
    renderResultSettings(root, result);
    if (target) target.value = result?.target?.relativeDirectory || `.github/extensions/${extensionId || "…"}/`;
    return result;
}

function schedulePreflight(root) {
    clearTimeout(preflightTimer);
    preflightTimer = setTimeout(() => runPreflight(root), 180);
}

function renderOverwriteConfirmation(root) {
    const preflight = root._generationPreflight;
    root.querySelector(".wizard-modal-body").innerHTML = `
        <p class="wizard-modal-desc">
            <strong>${escapeHtml(preflight?.target?.relativeDirectory ?? "The target extension")}</strong>
            already exists. Generating will replace its contents. Changes made directly to that generated
            canvas will not be preserved.
        </p>
        <div class="generation-message generation-warning">This action cannot be merged or undone by the Wizard.</div>
    `;
    const submit = root.querySelector("#generation-submit");
    if (submit) {
        submit.textContent = "Overwrite and generate";
        submit.classList.remove("btn-primary");
        submit.classList.add("btn-danger");
        submit.dataset.overwrite = "true";
    }
}

async function submitGeneration(root) {
    if (root._generationSubmitting) return;
    root._generationSubmitting = true;
    const dialog = dialogVersion;
    clearTimeout(preflightTimer);
    try {
        const confirmedOverwrite = root.querySelector("#generation-submit")?.dataset.overwrite === "true";
        const preflight = confirmedOverwrite ? root._generationPreflight : await runPreflight(root);
        if (dialog !== dialogVersion || preflight?.ok !== true || preflight?.errors?.length) return;
        if (preflight?.targetExists && !confirmedOverwrite) {
            renderOverwriteConfirmation(root);
            return;
        }
        const metadata = root._generationMetadata;
        const submit = root.querySelector("#generation-submit");
        if (submit) submit.textContent = "Generating…";
        const result = await __postJson("/api/generation/start", {
            ...metadata,
            overwrite: submit?.dataset.overwrite === "true",
        });
        if (!result?.requestId) {
            if (dialog === dialogVersion) {
                renderMessages(root.querySelector("#generation-messages"), { errors: ["Generation did not start. Check the settings and try again."] });
            }
            return;
        }
        if (dialog === dialogVersion) closeGenerationDialog();
        if (state.snapshot) {
            state.snapshot.generation = result.generation ?? {
                requestId: result.requestId, state: "queued", target: result.target,
            };
        }
        __render();
    } catch {
        if (dialog === dialogVersion) {
            renderMessages(root.querySelector("#generation-messages"), { errors: ["Could not start generation. Try again."] });
        }
    } finally {
        if (dialog === dialogVersion) {
            root._generationSubmitting = false;
            const submit = root.querySelector("#generation-submit");
            if (submit) submit.textContent = submit.dataset.overwrite === "true" ? "Overwrite and generate" : "Generate";
        }
    }
}

export function closeGenerationDialog() {
    dialogVersion++;
    clearTimeout(preflightTimer);
    const root = document.getElementById("wizard-modal-root");
    if (root) root.innerHTML = "";
}

export function openGenerationDialog() {
    const availability = generationAvailability();
    if (!availability.enabled) return;
    const root = document.getElementById("wizard-modal-root");
    if (!root) return;
    dialogVersion++;
    root._generationSubmitting = false;
    root._generationPreflight = null;
    const metadata = defaultGenerationMetadata();
    root.innerHTML = `
        <div class="wizard-modal-backdrop" role="presentation">
            <section class="wizard-modal generation-modal" role="dialog" aria-modal="true" aria-labelledby="generation-title">
                <header class="wizard-modal-head">
                    <h3 id="generation-title">Generate canvas</h3>
                    <button class="wizard-modal-close" type="button" aria-label="Close">✕</button>
                </header>
                <div class="wizard-modal-body">
                    <label class="wizard-modal-field" for="generation-target">
                        <span class="wizard-modal-field-label" id="generation-target-label">Target</span>
                        <span class="wizard-modal-desc" id="generation-target-help">Folder where the canvas app is created. Set by Extension ID.</span>
                        <input id="generation-target" class="wizard-modal-input" value=".github/extensions/${escapeHtml(metadata.extensionId)}/" aria-labelledby="generation-target-label" aria-describedby="generation-target-help" readonly />
                    </label>
                    <label class="wizard-modal-field" for="generation-extension-id">
                        <span class="wizard-modal-field-label" id="generation-extension-id-label">Extension ID</span>
                        <span class="wizard-modal-desc" id="generation-extension-id-help">Technical ID and folder name, not a display label. Use lowercase letters, numbers, and hyphens.</span>
                        <input id="generation-extension-id" class="wizard-modal-input" value="${escapeHtml(metadata.extensionId)}" aria-labelledby="generation-extension-id-label" aria-describedby="generation-extension-id-help" />
                    </label>
                    <label class="wizard-modal-field" for="generation-display-name">
                        <span class="wizard-modal-field-label" id="generation-display-name-label">Name</span>
                        <span class="wizard-modal-desc" id="generation-display-name-help">Text displayed as the canvas title.</span>
                        <input id="generation-display-name" class="wizard-modal-input" value="${escapeHtml(metadata.displayName)}" aria-labelledby="generation-display-name-label" aria-describedby="generation-display-name-help" />
                    </label>
                    <label class="wizard-modal-field" for="generation-workflow-list-name">
                        <span class="wizard-modal-field-label" id="generation-workflow-list-name-label">Workflow header</span>
                        <span class="wizard-modal-desc" id="generation-workflow-list-name-help">Text displayed as the workflow collection heading, such as Assessments or Bugs.</span>
                        <input id="generation-workflow-list-name" class="wizard-modal-input" value="${escapeHtml(metadata.workflowListName)}" maxlength="80" aria-labelledby="generation-workflow-list-name-label" aria-describedby="generation-workflow-list-name-help" />
                    </label>
                    <label class="wizard-modal-field" for="generation-description">
                        <span class="wizard-modal-field-label" id="generation-description-label">Description</span>
                        <span class="wizard-modal-desc" id="generation-description-help">Text displayed beneath the workflow collection heading, before the folder link.</span>
                        <textarea id="generation-description" class="wizard-modal-textarea generation-description" aria-labelledby="generation-description-label" aria-describedby="generation-description-help">${escapeHtml(metadata.description)}</textarea>
                    </label>
                    <div class="generation-results" role="group" aria-labelledby="generation-results-title" aria-describedby="generation-results-help">
                        <h4 id="generation-results-title" class="wizard-modal-field-label">Phase result tags <span class="muted">(optional)</span></h4>
                        <p class="wizard-modal-desc" id="generation-results-help">Define tags to categorize phase results, such as Go, Kill, or Needs clarification. The canvas automatically applies a matching tag based on the phase's response and created Markdown artifacts. If no clear match is found, it shows Not determined.</p>
                        <p class="wizard-modal-desc" id="generation-results-examples">Add up to 5 custom tags of 1-3 words. Needs clarification is built in.</p>
                        <div id="generation-result-list"></div>
                        <div><button type="button" id="generation-add-result" class="btn btn-secondary btn-sm">+ Add tag</button></div>
                    </div>
                    <label class="wizard-modal-check">
                        <input id="generation-user-provides-slug" type="checkbox" />
                        <span>
                            <strong class="wizard-modal-field-label">Allow custom slug</strong>
                            <small>Lets users specify the slug used as the directory name for generated artifacts. Otherwise, Spec Kit chooses a default or Copilot may ask the user in the chat session.</small>
                        </span>
                    </label>
                    <label class="wizard-modal-check">
                        <input id="generation-require-installation-approval" type="checkbox" aria-labelledby="generation-approval-label" aria-describedby="generation-approval-help" />
                        <span>
                            <strong id="generation-approval-label" class="wizard-modal-field-label">Require installation approval</strong>
                            <small id="generation-approval-help">Ask users to approve all included presets and extensions before installation. Otherwise, the app automatically installs missing components without asking for installation approval.</small>
                        </span>
                    </label>
                    <div id="generation-messages" aria-live="polite"></div>
                </div>
                <footer class="wizard-modal-foot">
                    <button class="btn btn-secondary btn-sm wizard-modal-cancel" type="button">Cancel</button>
                    <button id="generation-submit" class="btn btn-primary btn-sm" type="button">Generate</button>
                </footer>
            </section>
        </div>`;
    root._generationMetadata = metadata;
    root.querySelector(".wizard-modal-close")?.addEventListener("click", closeGenerationDialog);
    root.querySelector(".wizard-modal-cancel")?.addEventListener("click", closeGenerationDialog);
    root.querySelector(".wizard-modal-backdrop")?.addEventListener("click", (event) => {
        if (event.target === event.currentTarget) closeGenerationDialog();
    });
    const syncMetadata = () => {
        preflightVersion++;
        root._generationMetadata = {
            extensionId: root.querySelector("#generation-extension-id")?.value.trim() ?? "",
            displayName: root.querySelector("#generation-display-name")?.value.trim() ?? "",
            description: root.querySelector("#generation-description")?.value.trim() ?? "",
            workflowListName: root.querySelector("#generation-workflow-list-name")?.value.trim() ?? "",
            userProvidesSlug: root.querySelector("#generation-user-provides-slug")?.checked === true,
            requireInstallationApproval: root.querySelector("#generation-require-installation-approval")?.checked === true,
            resultLabels: resultLabels(root),
        };
        schedulePreflight(root);
    };
    for (const input of root.querySelectorAll("input:not([readonly]), textarea")) input.addEventListener("input", syncMetadata);
    renderResultInputs(root, [""], syncMetadata);
    root.querySelector("#generation-add-result")?.addEventListener("click", () => {
        const values = resultInputs(root).map((input) => input.value);
        if (values.length >= 5) return;
        renderResultInputs(root, [...values, ""], syncMetadata);
        syncMetadata();
        resultInputs(root).at(-1)?.focus();
    });
    root.querySelector("#generation-submit")?.addEventListener("click", () => submitGeneration(root));
    runPreflight(root);
}
