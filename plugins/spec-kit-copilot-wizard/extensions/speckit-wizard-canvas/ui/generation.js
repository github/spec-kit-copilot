// Wizard Generate controls for capturing a pipeline and requesting a standalone canvas.
import { state, TOKEN, capitalize } from "./state.js";
import { canvasDesignSections, openCommunityInstallModal } from "./modals.js";
import { sendDesignMutation } from "./design-filter.js";
import { effectivePipelinePhases, stripCommandsPrefix } from "../pipeline/effective-phases.mjs";

let __postJson = async () => undefined;
let __render = () => {};
let preflightTimer = null;
let dialogVersion = 0;
let preflightVersion = 0;
let designRefresh = null;
let outcomePoll = null;
let currentGeneration = null;

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
    const provider = workflowProvider(snapshot);
    const extensionId = slugify(provider ? `${provider.id}-workflow` : "spec-kit-workflow");
    const providerName = provider?.name
        ? provider.name.split(/[-_]/).map(capitalize).join(" ")
        : null;
    const displayName = providerName ? `${providerName} Workflow` : "Spec Kit Workflow";
    return {
        extensionId,
        displayName,
        requireInstallationApproval: false,
    };
}

export function generationAvailability(snapshot = state.snapshot) {
    const items = effectivePipelinePhases(snapshot);
    if (!items.length) return { enabled: false, reason: "Add at least one command to the pipeline before generating." };
    if (snapshot?.generatorStatus?.ready !== true) {
        return { enabled: false, reason: snapshot?.generatorStatus?.message || "Check Canvas generator in Environment." };
    }
    return { enabled: true, reason: "" };
}

export function generationStatus(snapshot = state.snapshot) {
    return currentGeneration ?? snapshot?.generation ?? null;
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
    const target = root.querySelector("#generation-target");
    const errors = [];
    if (!/^[a-z0-9][a-z0-9-]*$/.test(extensionId) || extensionId.length > 80) {
        errors.push({ field: "extensionId", message: "Use a lowercase canvas ID of at most 80 characters." });
    }
    if (!displayName || displayName.length > 120) errors.push({ field: "displayName", message: "Enter a name of at most 120 characters." });
    let result = { ok: false, errors, target: { relativeDirectory: `.github/extensions/${extensionId || "…"}/` } };
    if (!errors.length) {
        try {
            const response = await fetch(`/api/generation/target?token=${encodeURIComponent(TOKEN)}&canvasId=${encodeURIComponent(extensionId)}`);
            const inspected = await response.json();
            if (!response.ok) throw new Error(inspected.error || `Status ${response.status}`);
            result = { ok: true, errors: [], targetExists: inspected.exists,
                target: { relativeDirectory: `.github/extensions/${extensionId}/`, absolutePath: inspected.target } };
        } catch (error) {
            result.errors = [{ message: `Cannot inspect canvas target: ${error.message}` }];
        }
    }
    if (version !== preflightVersion || dialog !== dialogVersion) return null;
    root._generationPreflight = result;
    renderMessages(root.querySelector("#generation-messages"), result);
    if (target) target.value = result?.target?.relativeDirectory || `.github/extensions/${extensionId || "…"}/`;
    const submit = root.querySelector("#generation-submit");
    if (submit) submit.disabled = !result.ok || !generationAvailability().enabled || root._designPending === true;
    return result;
}

function schedulePreflight(root) {
    clearTimeout(preflightTimer);
    preflightTimer = setTimeout(() => runPreflight(root), 180);
}

function renderOverwriteConfirmation(root) {
    const preflight = root._generationPreflight;
    clearInterval(designRefresh);
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

function mountDesignPicker(root) {
    const search = root.querySelector("#generation-design-search");
    const list = root.querySelector("#generation-design-items");
    const status = root.querySelector("#generation-design-status");
    const pending = new Map();
    const errors = new Map();
    const render = () => {
        if (!list?.isConnected) return;
        list.replaceChildren();
        const snapshot = state.snapshot;
        const catalogErrors = Object.values(snapshot?.catalogSourceErrors ?? {}).flat();
        if (catalogErrors.length && !pending.size && !errors.size) {
            status.textContent = `Catalog unavailable: ${catalogErrors.join("; ")}`;
        }
        for (const [title, kind, entries] of canvasDesignSections(snapshot, search.value)) {
            const section = document.createElement("section");
            section.className = "generation-design-section";
            const heading = document.createElement("h5");
            heading.textContent = title;
            section.append(heading);
            if (!entries.length) {
                const empty = document.createElement("p");
                empty.textContent = "No matching design packages.";
                section.append(empty);
            }
            for (const entry of entries) {
                const id = entry.id ?? entry.name;
                const key = `${kind}:${id}`;
                if (pending.has(key) && (entry.active === pending.get(key) || entry.designError)) {
                    pending.delete(key);
                    status.textContent = entry.designError || `${entry.name ?? id} ${entry.active ? "added" : "removed"}.`;
                }
                const row = document.createElement("div");
                row.className = "catalog-card generation-design-row";
                const label = document.createElement("span");
                label.textContent = `${entry.name ?? id} (${errors.get(key) || entry.designError || (entry.active ? "Added" : "Available")})`;
                const button = document.createElement("button");
                button.type = "button";
                button.className = "btn btn-secondary btn-sm";
                button.textContent = pending.has(key) ? "Working…" : entry.active ? "Remove" : "Add";
                button.disabled = pending.has(key) || !entry.design;
                button.addEventListener("click", () => {
                    const apply = async () => {
                        errors.delete(key);
                        pending.set(key, !entry.active);
                        status.textContent = `${entry.active ? "Removing" : "Adding"} ${entry.name ?? id}…`;
                        render();
                        try {
                            await sendDesignMutation(kind, entry, (action, payload) =>
                                __postJson("/api/prompt", { kind: action, payload }, { throwOnError: true }));
                        } catch (error) {
                            pending.delete(key);
                            errors.set(key, error.message);
                            status.textContent = error.message;
                            render();
                        }
                    };
                    if (!entry.active && entry.installAllowed === false) {
                        openCommunityInstallModal({ displayName: entry.name ?? id, kind, onConfirm: apply });
                    } else void apply();
                });
                row.append(label, button);
                section.append(row);
            }
            list.append(section);
        }
        root._designPending = pending.size > 0;
        const submit = root.querySelector("#generation-submit");
        if (submit && submit.dataset.overwrite !== "true") {
            submit.disabled = root._designPending || root._generationPreflight?.ok !== true;
        }
    };
    search.addEventListener("input", render);
    clearInterval(designRefresh);
    designRefresh = setInterval(render, 1000);
    render();
}

async function submitGeneration(root) {
    if (root._generationSubmitting) return;
    root._generationSubmitting = true;
    const dialog = dialogVersion;
    clearTimeout(preflightTimer);
    try {
        const confirmedOverwrite = root.querySelector("#generation-submit")?.dataset.overwrite === "true";
        if (root._designPending) throw new Error("Wait for Canvas Design changes to finish before generating.");
        const preflight = confirmedOverwrite ? root._generationPreflight : await runPreflight(root);
        if (dialog !== dialogVersion || preflight?.ok !== true || preflight?.errors?.length) return;
        if (preflight?.targetExists && !confirmedOverwrite) {
            renderOverwriteConfirmation(root);
            return;
        }
        const metadata = root._generationMetadata;
        const submit = root.querySelector("#generation-submit");
        if (submit) submit.textContent = "Generating…";
        const phases = effectivePipelinePhases(state.snapshot).map(({ id }) => {
            const name = stripCommandsPrefix(id);
            return name.startsWith("speckit.") ? name : `speckit.${name}`;
        });
        const result = await __postJson("/api/generation", {
            phases, canvasId: metadata.extensionId, displayName: metadata.displayName,
            settings: { requireInstallationApproval: metadata.requireInstallationApproval },
            ...(confirmedOverwrite ? { overwrite: true, confirmedTarget: preflight.target.absolutePath } : {}),
        }, { throwOnError: true });
        if (result?.queued !== true) throw new Error("Generator did not queue a request.");
        if (dialog === dialogVersion) closeGenerationDialog();
        currentGeneration = { status: "queued", target: result.target };
        __render();
        clearInterval(outcomePoll);
        outcomePoll = setInterval(async () => {
            try {
                const response = await fetch(`/api/generation/result?token=${encodeURIComponent(TOKEN)}`);
                const outcome = await response.json();
                if (!response.ok) throw new Error(outcome.error || `Status ${response.status}`);
                if (outcome.status === "queued") return;
                clearInterval(outcomePoll);
                outcomePoll = null;
                currentGeneration = {
                    status: outcome.status, target: result.target,
                    message: outcome.result?.details || outcome.error || "",
                };
                __render();
            } catch (error) {
                clearInterval(outcomePoll);
                outcomePoll = null;
                currentGeneration = { status: "failed", message: error.message };
                __render();
            }
        }, 2000);
    } catch (error) {
        if (dialog === dialogVersion) {
            renderMessages(root.querySelector("#generation-messages"), { errors: [error.message] });
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
    clearInterval(designRefresh);
    designRefresh = null;
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
                    <label class="wizard-modal-check">
                        <input id="generation-require-installation-approval" type="checkbox" aria-labelledby="generation-approval-label" aria-describedby="generation-approval-help" />
                        <span>
                            <strong id="generation-approval-label" class="wizard-modal-field-label">Require installation approval</strong>
                            <small id="generation-approval-help">Ask users to approve included presets and extensions before installation. Otherwise, missing components install automatically unless Canvas Design requires external installation.</small>
                        </span>
                    </label>
                    <section class="generation-design" aria-label="Canvas Design">
                        <h4>Canvas Design</h4>
                        <p class="wizard-modal-desc">Choose presentation packages. Add and Remove take effect immediately; Cancel does not undo them.</p>
                        <p class="wizard-modal-desc">Canvas generator: Added (Required)</p>
                        <label class="wizard-modal-field" for="generation-design-search">
                            <span class="wizard-modal-field-label">Search Canvas Design</span>
                            <input id="generation-design-search" class="wizard-modal-input" type="search" placeholder="Search presets, extensions, bundles" />
                        </label>
                        <div id="generation-design-items"></div>
                        <p id="generation-design-status" class="generation-design-status" role="status"></p>
                    </section>
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
            requireInstallationApproval: root.querySelector("#generation-require-installation-approval")?.checked === true,
        };
        schedulePreflight(root);
    };
    for (const input of root.querySelectorAll("input:not([readonly]):not(#generation-design-search)")) {
        input.addEventListener("input", syncMetadata);
    }
    mountDesignPicker(root);
    root.querySelector("#generation-submit")?.addEventListener("click", () => submitGeneration(root));
    runPreflight(root);
}
