// Wizard Generate controls for capturing a pipeline and requesting a standalone canvas.
import { state, bareCommandId, capitalize } from "./state.js";
import { effectivePipelinePhases, stripCommandsPrefix } from "../pipeline/effective-phases.mjs";

let __postJson = async () => undefined;
let __render = () => {};
let preflightTimer = null;

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
    const extensionId = root.querySelector("#generation-extension-id")?.value.trim() ?? "";
    const displayName = root.querySelector("#generation-display-name")?.value.trim() ?? "";
    const description = root.querySelector("#generation-description")?.value.trim() ?? "";
    const workflowListName = root.querySelector("#generation-workflow-list-name")?.value.trim() ?? "";
    const userProvidesSlug = root.querySelector("#generation-user-provides-slug")?.checked === true;
    const requireInstallationApproval = root.querySelector("#generation-require-installation-approval")?.checked === true;
    const submit = root.querySelector("#generation-submit");
    const target = root.querySelector("#generation-target");
    if (submit) {
        submit.textContent = "Checking…";
    }
    const result = await __postJson("/api/generation/preflight", { extensionId, displayName, description, workflowListName, userProvidesSlug, requireInstallationApproval });
    root._generationPreflight = result;
    renderMessages(root.querySelector("#generation-messages"), result);
    if (target) target.value = result?.target?.relativeDirectory || `.github/extensions/${extensionId || "…"}/`;
    if (submit) {
        submit.textContent = result?.targetExists ? "Regenerate" : "Generate";
    }
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
    const confirmedOverwrite = root.querySelector("#generation-submit")?.dataset.overwrite === "true";
    const preflight = confirmedOverwrite ? root._generationPreflight : await runPreflight(root);
    if (preflight?.ok !== true || preflight?.errors?.length) return;
    if (preflight?.targetExists && !confirmedOverwrite) {
        renderOverwriteConfirmation(root);
        return;
    }
    const metadata = root._generationMetadata;
    const submit = root.querySelector("#generation-submit");
    if (submit) {
        submit.disabled = true;
        submit.textContent = "Queuing…";
    }
    const result = await __postJson("/api/generation/start", {
        ...metadata,
        overwrite: submit?.dataset.overwrite === "true",
    });
    if (!result) {
        if (submit) {
            submit.disabled = false;
            submit.textContent = "Try again";
        }
        return;
    }
    closeGenerationDialog();
    if (state.snapshot) {
        state.snapshot.generation = result.generation ?? {
            requestId: result.requestId,
            state: "queued",
            target: result.target,
        };
    }
    __render();
}

export function closeGenerationDialog() {
    clearTimeout(preflightTimer);
    const root = document.getElementById("wizard-modal-root");
    if (root) root.innerHTML = "";
}

export function openGenerationDialog() {
    const availability = generationAvailability();
    if (!availability.enabled) return;
    const root = document.getElementById("wizard-modal-root");
    if (!root) return;
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
                        <span class="wizard-modal-desc" id="generation-target-help">Canvas app folder in this workspace. Set by Extension ID.</span>
                        <input id="generation-target" class="wizard-modal-input" value=".github/extensions/${escapeHtml(metadata.extensionId)}/" aria-labelledby="generation-target-label" aria-describedby="generation-target-help" readonly />
                    </label>
                    <label class="wizard-modal-field" for="generation-extension-id">
                        <span class="wizard-modal-field-label" id="generation-extension-id-label">Extension ID</span>
                        <span class="wizard-modal-desc" id="generation-extension-id-help">Folder name and unique ID. Use lowercase letters, numbers, and hyphens.</span>
                        <input id="generation-extension-id" class="wizard-modal-input" value="${escapeHtml(metadata.extensionId)}" aria-labelledby="generation-extension-id-label" aria-describedby="generation-extension-id-help" />
                    </label>
                    <label class="wizard-modal-field" for="generation-display-name">
                        <span class="wizard-modal-field-label" id="generation-display-name-label">Canvas name</span>
                        <span class="wizard-modal-desc" id="generation-display-name-help">Name shown to users when they open the canvas.</span>
                        <input id="generation-display-name" class="wizard-modal-input" value="${escapeHtml(metadata.displayName)}" aria-labelledby="generation-display-name-label" aria-describedby="generation-display-name-help" />
                    </label>
                    <label class="wizard-modal-field" for="generation-workflow-list-name">
                        <span class="wizard-modal-field-label" id="generation-workflow-list-name-label">Canvas workflow header</span>
                        <span class="wizard-modal-desc" id="generation-workflow-list-name-help">Heading shown to users above the grouped workflows, such as Assessments or Bugs.</span>
                        <input id="generation-workflow-list-name" class="wizard-modal-input" value="${escapeHtml(metadata.workflowListName)}" maxlength="80" aria-labelledby="generation-workflow-list-name-label" aria-describedby="generation-workflow-list-name-help" />
                    </label>
                    <label class="wizard-modal-field" for="generation-description">
                        <span class="wizard-modal-field-label" id="generation-description-label">Description</span>
                        <span class="wizard-modal-desc" id="generation-description-help">Short summary of what the canvas does.</span>
                        <textarea id="generation-description" class="wizard-modal-textarea generation-description" aria-labelledby="generation-description-label" aria-describedby="generation-description-help">${escapeHtml(metadata.description)}</textarea>
                    </label>
                    <label class="wizard-modal-check">
                        <input id="generation-user-provides-slug" type="checkbox" />
                        <span>
                            <strong>Allow custom slug</strong>
                            <small>Lets users specify the slug used as the directory name for generated artifacts. Otherwise, Spec Kit chooses a default or Copilot may ask the user in the chat session.</small>
                        </span>
                    </label>
                    <label class="wizard-modal-check">
                        <input id="generation-require-installation-approval" type="checkbox" aria-labelledby="generation-approval-label" aria-describedby="generation-approval-help" />
                        <span>
                            <strong id="generation-approval-label">Require installation approval</strong>
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
        root._generationMetadata = {
            extensionId: root.querySelector("#generation-extension-id")?.value.trim() ?? "",
            displayName: root.querySelector("#generation-display-name")?.value.trim() ?? "",
            description: root.querySelector("#generation-description")?.value.trim() ?? "",
            workflowListName: root.querySelector("#generation-workflow-list-name")?.value.trim() ?? "",
            userProvidesSlug: root.querySelector("#generation-user-provides-slug")?.checked === true,
            requireInstallationApproval: root.querySelector("#generation-require-installation-approval")?.checked === true,
        };
        schedulePreflight(root);
    };
    for (const input of root.querySelectorAll("input:not([readonly]), textarea")) input.addEventListener("input", syncMetadata);
    root.querySelector("#generation-submit")?.addEventListener("click", () => submitGeneration(root));
    runPreflight(root);
}
