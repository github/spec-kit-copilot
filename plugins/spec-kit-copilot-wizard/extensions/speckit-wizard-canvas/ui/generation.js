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
const DESIGN_DOCUMENTS = [
    ["canvas-presentation", "Canvas presentation"],
    ["phase-outputs", "Phase outputs"],
    ["canvas-results", "Canvas results"],
    ["canvas-interactions", "Canvas interactions"],
    ["canvas-setup", "Canvas setup"],
];

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
    const extensionId = slugify(provider ? `${provider.id}-workflow` : "spec-kit-workflow");
    const providerName = provider?.name
        ? provider.name.split(/[-_]/).map(capitalize).join(" ")
        : null;
    const labels = items.map(({ id }) => {
        const command = commandForPipelineId(id, snapshot);
        const fallback = stripCommandsPrefix(id).split(".").pop();
        return command?.shortLabel || command?.title || capitalize(fallback);
    }).filter(Boolean);
    const canonicalSdd = items.map(({ id }) => stripCommandsPrefix(id)).join(",") === [
        "constitution", "specify", "clarify", "plan", "tasks", "analyze", "checklist", "implement",
    ].join(",");
    const displayName = canonicalSdd
        ? "Spec-Driven Development"
        : providerName ? `${providerName} Workflow` : "Spec Kit Workflow";
    const sequence = labels.join(" → ");
    return {
        extensionId,
        displayName,
        workflowListName: canonicalSdd ? "Features" : "Workflows",
        description: sequence ? `Visual workflow for ${sequence}.` : "Visual Spec Kit workflow.",
    };
}

function normalizedJson(value) {
    if (Array.isArray(value)) return value.map(normalizedJson);
    if (value !== null && typeof value === "object") {
        return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalizedJson(value[key])]));
    }
    return value;
}

function strictJsonParse(raw) {
    const parsed = JSON.parse(raw);
    const stack = [];
    for (let index = 0; index < raw.length; index++) {
        const character = raw[index];
        if (character === '"') {
            const start = index;
            for (index++; index < raw.length; index++) {
                if (raw[index] === "\\") { index++; continue; }
                if (raw[index] === '"') break;
            }
            const frame = stack.at(-1);
            if (frame?.keys && frame.expectKey) {
                const key = JSON.parse(raw.slice(start, index + 1));
                if (frame.keys.has(key)) throw new Error(`Duplicate JSON key: ${key}`);
                frame.keys.add(key);
                frame.expectKey = false;
            }
        } else if (character === "{") stack.push({ keys: new Set(), expectKey: true });
        else if (character === "[") stack.push({ keys: null });
        else if (character === "}" || character === "]") stack.pop();
        else if (character === "," && stack.at(-1)?.keys) stack.at(-1).expectKey = true;
    }
    return parsed;
}

export function changedGenerationDocuments(documents, drafts, validated = {}) {
    const changed = {};
    for (const [category] of DESIGN_DOCUMENTS) {
        if (!Object.hasOwn(documents, category)) throw new Error(`Missing ${category} generator baseline.`);
        const parsed = validated[category]?.raw === drafts[category]
            ? validated[category].document : strictJsonParse(drafts[category]);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error(`${category} must be a JSON object.`);
        }

        if (JSON.stringify(normalizedJson(parsed)) !== JSON.stringify(normalizedJson(documents[category]))) {
            changed[category] = drafts[category];
        }
    }
    return changed;
}

export async function validateGenerationDocument(name, json, request = fetch) {
    const response = await request(`/api/generation/validate?token=${encodeURIComponent(TOKEN)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, json }),
    });
    const result = await response.json();
    if (!response.ok || result.valid !== true || !result.document
        || typeof result.document !== "object" || Array.isArray(result.document)) {
        throw new Error(result.error || `Could not validate ${name} (status ${response.status}).`);
    }
    return result.document;
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
    const workflowListName = root.querySelector("#generation-workflow-list-name")?.value.trim() ?? "";
    const description = root.querySelector("#generation-description")?.value.trim() ?? "";
    const target = root.querySelector("#generation-target");
    const errors = [];
    if (!/^[a-z0-9][a-z0-9-]*$/.test(extensionId) || extensionId.length > 80) {
        errors.push({ field: "extensionId", message: "Use a lowercase canvas ID of at most 80 characters." });
    }
    if (!displayName || displayName.length > 120) errors.push({ field: "displayName", message: "Enter a name of at most 120 characters." });
    if (!workflowListName || workflowListName.length > 80) errors.push({ field: "workflowListName", message: "Enter a workflow header of at most 80 characters." });
    if (!description || description.length > 240) errors.push({ field: "description", message: "Enter a description of at most 240 characters." });
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
    updateGenerationActions(root);
    return result;
}

function updateGenerationActions(root) {
    const next = root.querySelector("#generation-next");
    if (next) next.disabled = root._generationPreflight?.ok !== true;
    const submit = root.querySelector("#generation-submit");
    if (submit) submit.disabled = root._generationPreflight?.ok !== true
        || !generationAvailability().enabled || root._designPending === true
        || root._configurationStatus !== "ready" || root._documentError === true;
}

function schedulePreflight(root) {
    clearTimeout(preflightTimer);
    preflightTimer = setTimeout(() => runPreflight(root), 180);
}

function renderOverwriteConfirmation(root) {
    const preflight = root._generationPreflight;
    clearInterval(designRefresh);
    root.querySelector("#generation-back").hidden = true;
    root.querySelector(".wizard-modal-body").innerHTML = `
        <p class="wizard-modal-desc">
            <strong>${escapeHtml(preflight?.target?.relativeDirectory ?? "The target extension")}</strong>
            already exists. Generating will replace its contents. Changes made directly to that generated
            canvas will not be preserved.
        </p>
        <div class="generation-message generation-warning">This action cannot be merged or undone by the Wizard.</div>
        <div id="generation-messages" aria-live="polite"></div>
    `;
    const submit = root.querySelector("#generation-submit");
    if (submit) {
        submit.textContent = "Overwrite and generate";
        submit.classList.remove("btn-primary");
        submit.classList.add("btn-danger");
        submit.dataset.overwrite = "true";
    }
}

function winnerName(winner) {
        if (!winner || typeof winner !== "object") return String(winner || "");
        if (winner.kind && winner.id) return `${winner.kind} ${winner.id}`;
        return winner.name || winner.displayName || winner.presetName || winner.extensionName
            || winner.id || winner.presetId || winner.extensionId || "an active design package";
    }

    function renderDocumentSummary(root) {
        const summary = root.querySelector("#generation-document-summary");
        if (!summary || root._configurationStatus !== "ready") return;
        const changed = [];
        const invalid = new Set();
        for (const [category, label] of DESIGN_DOCUMENTS) {
            const validation = root._validatedDocuments[category];
            if (validation?.raw === root._documentDrafts[category] && validation.status === "valid") {
                const parsed = validation.document;
                if (JSON.stringify(normalizedJson(parsed)) !== JSON.stringify(normalizedJson(root._baselineDocuments[category]))) {
                    changed.push([category, label]);
                }
            } else {
                invalid.add(category);
            }
        }
        root._documentError = invalid.size > 0;
        const warnings = changed.flatMap(([category, label]) => {
            const winner = root._designWinners?.[category];
            return winner ? [`${label}: your one-off JSON will be recorded in the request and receipt, but ${winnerName(winner)} is the active winning customer design package for this document and overrides it.`] : [];
        });
        summary.innerHTML = `
            <p class="wizard-modal-field-label">Document sources</p>
            <ul class="generation-document-sources">${DESIGN_DOCUMENTS.map(([category, label]) => {
                const validation = root._validatedDocuments[category];
                const source = invalid.has(category) ? validation?.status === "pending"
                    ? "Validating against generator schema…" : "Invalid document — fix before generating"
                    : root._designWinners?.[category]
                    ? `${winnerName(root._designWinners[category])} (active customer package)`
                    : changed.some(([key]) => key === category) ? "one-off JSON" : "generator baseline";
                return `<li><strong>${escapeHtml(label)}:</strong> ${escapeHtml(source)}</li>`;
            }).join("")}</ul>
            ${warnings.map((warning) => `<p class="generation-message generation-warning">${escapeHtml(warning)}</p>`).join("")}`;
        updateGenerationActions(root);
    }

    function renderDocumentEditor(root) {
        const key = root._selectedDocument;
        const editor = root.querySelector("#generation-document-json");
        if (!editor || !key || root._configurationStatus !== "ready") return;
        editor.value = root._documentDrafts[key];
        editor.setAttribute("aria-label", `${DESIGN_DOCUMENTS.find(([category]) => category === key)?.[1]} JSON`);
        root.querySelector("#generation-document-label").textContent = `${DESIGN_DOCUMENTS.find(([category]) => category === key)?.[1]} · JSON`;
        for (const button of root.querySelectorAll("[data-document]")) {
            button.setAttribute("aria-pressed", String(button.dataset.document === key));
        }
        showDocumentValidation(root);
    }

    function showDocumentValidation(root) {
        const editor = root.querySelector("#generation-document-json");
        const message = root.querySelector("#generation-document-error");
        if (!editor || !message || root._configurationStatus !== "ready") return;
        const validation = root._validatedDocuments[root._selectedDocument];
        message.textContent = validation?.status === "pending"
            ? "Checking this document against the generator schema…"
            : validation?.error ? `${root._selectedDocument}: ${validation.error}` : "";
        editor.setAttribute("aria-invalid", String(validation?.status === "error"));
    }

    async function validateDocumentDraft(root, category) {
        const raw = root._documentDrafts[category];
        const version = dialogVersion;
        const sequence = root._validationVersions[category] = (root._validationVersions[category] ?? 0) + 1;
        const current = root._validatedDocuments[category];
        if (current?.raw === raw && current.status === "valid") return current;
        let parsed;
        try {
            parsed = strictJsonParse(raw);
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Expected a JSON object.");
        } catch (error) {
            root._validatedDocuments[category] = { raw, status: "error", error: `Invalid JSON: ${error.message}` };
            if (root._selectedDocument === category) showDocumentValidation(root);
            renderDocumentSummary(root);
            return root._validatedDocuments[category];
        }
        if (JSON.stringify(normalizedJson(parsed)) === JSON.stringify(normalizedJson(root._baselineDocuments[category]))) {
            root._validatedDocuments[category] = { raw, status: "valid", document: root._baselineDocuments[category] };
            if (root._selectedDocument === category) showDocumentValidation(root);
            renderDocumentSummary(root);
            return root._validatedDocuments[category];
        }
        root._validatedDocuments[category] = { raw, status: "pending" };
        if (root._selectedDocument === category) showDocumentValidation(root);
        renderDocumentSummary(root);
        try {
            const document = await validateGenerationDocument(category, raw);
            if (version === dialogVersion && root._validationVersions[category] === sequence && root._documentDrafts[category] === raw) {
                root._validatedDocuments[category] = { raw, status: "valid", document };
            }
        } catch (error) {
            if (version === dialogVersion && root._validationVersions[category] === sequence && root._documentDrafts[category] === raw) {
                root._validatedDocuments[category] = { raw, status: "error", error: error.message };
            }
        }
        if (version === dialogVersion && root._validationVersions[category] === sequence && root._documentDrafts[category] === raw) {
            if (root._selectedDocument === category) showDocumentValidation(root);
            renderDocumentSummary(root);
        }
        return root._validatedDocuments[category];
    }

    function validateDocumentEditor(root) {
        const editor = root.querySelector("#generation-document-json");
        const category = root._selectedDocument;
        root._documentDrafts[category] = editor.value;
        root._validationVersions[category] = (root._validationVersions[category] ?? 0) + 1;
        root._validatedDocuments[category] = { raw: editor.value, status: "pending" };
        showDocumentValidation(root);
        renderDocumentSummary(root);
        clearTimeout(root._documentValidationTimer);
        root._documentValidationTimer = setTimeout(() => void validateDocumentDraft(root, category), 350);
    }

    async function loadGenerationConfiguration(root) {
        const dialog = dialogVersion;
        root._configurationStatus = "loading";
        updateGenerationActions(root);
        const status = root.querySelector("#generation-configuration-status");
        if (status) status.textContent = "Loading generator baseline…";
        try {
            const response = await fetch(`/api/generation/configuration?token=${encodeURIComponent(TOKEN)}`);
            const configuration = await response.json();
            if (!response.ok) throw new Error(configuration.error || `Status ${response.status}`);
            if (!configuration.documents || DESIGN_DOCUMENTS.some(([key]) => (
                !configuration.documents[key] || typeof configuration.documents[key] !== "object"
                || Array.isArray(configuration.documents[key])
            ))) throw new Error("The generator did not provide all five design documents.");
            if (dialog !== dialogVersion) return;
            root._baselineDocuments = configuration.documents;
            root._designWinners = configuration.winners ?? {};
            root._documentDrafts = Object.fromEntries(DESIGN_DOCUMENTS.map(([key]) => [
                key, JSON.stringify(configuration.documents[key], null, 2),
            ]));
            root._validationVersions = {};
            root._validatedDocuments = Object.fromEntries(DESIGN_DOCUMENTS.map(([key]) => [
                key, { raw: root._documentDrafts[key], status: "valid", document: configuration.documents[key] },
            ]));
            root._configurationStatus = "ready";
            status.textContent = "Edit one document at a time. All documents changed from the generator baseline are submitted; active customer packages can override them.";
            root.querySelector("#generation-document-controls").hidden = false;
            renderDocumentEditor(root);
        } catch (error) {
            if (dialog !== dialogVersion) return;
            root._configurationStatus = "error";
            status.textContent = `Could not load generator baseline: ${error.message}`;
            root.querySelector("#generation-configuration-retry").hidden = false;
            updateGenerationActions(root);
        }
    }

    function mountDocumentEditor(root) {
        const buttons = root.querySelector("#generation-document-choices");
        for (const [key, label] of DESIGN_DOCUMENTS) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "btn btn-secondary btn-sm";
            button.dataset.document = key;
            button.textContent = label;
            button.addEventListener("click", () => {
                const previous = root._selectedDocument;
                root._documentDrafts[previous] = root.querySelector("#generation-document-json").value;
                clearTimeout(root._documentValidationTimer);
                if (root._validatedDocuments[previous]?.status === "pending") void validateDocumentDraft(root, previous);
                root._selectedDocument = key;
                renderDocumentEditor(root);
            });
            buttons.append(button);
        }
        root.querySelector("#generation-document-json").addEventListener("input", () => validateDocumentEditor(root));
        const find = root.querySelector("#generation-document-search");
        const findNext = () => {
            const editor = root.querySelector("#generation-document-json");
            const needle = find.value;
            if (!needle) return;
            const value = editor.value.toLocaleLowerCase();
            const term = needle.toLocaleLowerCase();
            let position = value.indexOf(term, editor.selectionEnd);
            if (position < 0) position = value.indexOf(term);
            const status = root.querySelector("#generation-document-search-status");
            if (position < 0) {
                status.textContent = "No match in this document.";
            } else {
                editor.focus();
                editor.setSelectionRange(position, position + needle.length);
                status.textContent = `Match at line ${editor.value.slice(0, position).split("\n").length}.`;
            }
        };
        root.querySelector("#generation-document-find").addEventListener("click", findNext);
        find.addEventListener("keydown", (event) => {
            if (event.key === "Enter") { event.preventDefault(); findNext(); }
        });
        root.querySelector("#generation-configuration-retry").addEventListener("click", (event) => {
            event.currentTarget.hidden = true;
            loadGenerationConfiguration(root);
        });
        loadGenerationConfiguration(root);
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
                    void refreshDesignWinners(root);
                }
                const row = document.createElement("div");
                row.className = "catalog-card generation-design-row";
                const label = document.createElement("span");
                label.textContent = `${entry.name ?? id} (${errors.get(key) || entry.designError || (entry.active ? "Added" : "Available")})`;
                const button = document.createElement("button");
                button.type = "button";
                button.className = "btn btn-secondary btn-sm";
                button.textContent = pending.has(key) ? "Working…" : entry.active ? "Remove" : "Add";
                button.disabled = root._generationSubmitting || pending.has(key) || !entry.design;
                button.addEventListener("click", () => {
                    if (root._generationSubmitting) return;
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
        updateGenerationActions(root);
    };
    search.addEventListener("input", render);
    clearInterval(designRefresh);
    designRefresh = setInterval(render, 1000);
    render();
}

async function refreshDesignWinners(root, required = false) {
    const dialog = dialogVersion;
    const refresh = root._winnerRefreshVersion = (root._winnerRefreshVersion ?? 0) + 1;
    try {
        const response = await fetch(`/api/generation/configuration?token=${encodeURIComponent(TOKEN)}`);
        const configuration = await response.json();
        if (!response.ok) throw new Error(configuration.error || `Status ${response.status}`);
        if (dialog !== dialogVersion || refresh !== root._winnerRefreshVersion || root._configurationStatus !== "ready") return;
        root._designWinners = configuration.winners ?? {};
        renderDocumentSummary(root);
    } catch (error) {
        if (required) throw new Error(`Cannot verify active Canvas Design packages: ${error.message}`);
        // A transient background refresh failure should not discard locally edited JSON.
    }
}

async function submitGeneration(root) {
    if (root._generationSubmitting) return;
    root._generationSubmitting = true;
    const dialog = dialogVersion;
    clearTimeout(preflightTimer);
    try {
        const confirmedOverwrite = root.querySelector("#generation-submit")?.dataset.overwrite === "true";
        if (root._designPending) throw new Error("Wait for Canvas Design changes to finish before generating.");
        if (root._configurationStatus !== "ready") throw new Error("Wait for the generator baseline to load.");
        clearTimeout(root._documentValidationTimer);
        await Promise.all(DESIGN_DOCUMENTS.map(([category]) => validateDocumentDraft(root, category)));
        if (dialog !== dialogVersion) return;
        const invalid = DESIGN_DOCUMENTS.filter(([category]) => root._validatedDocuments[category]?.status !== "valid");
        if (invalid.length) throw new Error(`Fix ${invalid.map(([category]) => category).join(", ")} before generating.`);
        await refreshDesignWinners(root, true);
        if (dialog !== dialogVersion) return;
        const inlineDocuments = changedGenerationDocuments(
            root._baselineDocuments, root._documentDrafts, root._validatedDocuments,
        );
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
            phases,
            configuration: {
                canvas: {
                    id: metadata.extensionId,
                    displayName: metadata.displayName,
                    workflowListName: metadata.workflowListName,
                    description: metadata.description,
                },
            },
            inlineDocuments,
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
    if (root) clearTimeout(root._documentValidationTimer);
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
    root._configurationStatus = "loading";
    root._selectedDocument = DESIGN_DOCUMENTS[0][0];
    const metadata = defaultGenerationMetadata();
    root.innerHTML = `
        <div class="wizard-modal-backdrop" role="presentation">
            <section class="wizard-modal generation-modal" role="dialog" aria-modal="true" aria-labelledby="generation-title">
                <header class="wizard-modal-head">
                    <h3 id="generation-title">Generate canvas</h3>
                    <button class="wizard-modal-close" type="button" aria-label="Close">✕</button>
                </header>
                <nav class="generation-steps" aria-label="Generation steps">
                    <span id="generation-step-details" aria-current="step">1 · Details</span>
                    <span id="generation-step-design">2 · Canvas Design</span>
                </nav>
                <div class="wizard-modal-body">
                    <div id="generation-details" class="generation-step">
                    <label class="wizard-modal-field" for="generation-target">
                        <span class="wizard-modal-field-label" id="generation-target-label">Derived target</span>
                        <span class="wizard-modal-desc" id="generation-target-help">Folder where the canvas app is created. Set by Extension ID.</span>
                        <input id="generation-target" class="wizard-modal-input" value=".github/extensions/${escapeHtml(metadata.extensionId)}/" aria-labelledby="generation-target-label" aria-describedby="generation-target-help" readonly />
                    </label>
                    <label class="wizard-modal-field" for="generation-extension-id">
                        <span class="wizard-modal-field-label" id="generation-extension-id-label">Canvas ID</span>
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
                        <textarea id="generation-description" class="wizard-modal-textarea generation-description" maxlength="240" aria-labelledby="generation-description-label" aria-describedby="generation-description-help">${escapeHtml(metadata.description)}</textarea>
                    </label>
                    </div>
                    <div id="generation-design-step" class="generation-step" hidden>
                    <section class="generation-design" aria-label="Canvas Design">
                        <h4>Canvas Design</h4>
                        <p class="wizard-modal-desc">Choose existing design packages. Add and Remove take effect immediately; Cancel does not undo them.</p>
                        <p class="wizard-modal-desc">Canvas generator: Added (Required)</p>
                        <label class="wizard-modal-field" for="generation-design-search">
                            <span class="wizard-modal-field-label">Search Canvas Design</span>
                            <input id="generation-design-search" class="wizard-modal-input" type="search" placeholder="Search presets, extensions, bundles" />
                        </label>
                        <div id="generation-design-items" role="region" aria-label="Design packages" tabindex="0"></div>
                        <p id="generation-design-status" class="generation-design-status" role="status"></p>
                    </section>
                    <section class="generation-documents" aria-label="Optional JSON design documents">
                        <h4>Optional JSON design documents</h4>
                        <p class="wizard-modal-desc">Start from the generator baseline, not a customer preset. Select one document to edit; changes stay here until Generate.</p>
                        <p id="generation-configuration-status" class="wizard-modal-desc" role="status"></p>
                        <button id="generation-configuration-retry" class="btn btn-secondary btn-sm" type="button" hidden>Retry loading baseline</button>
                        <div id="generation-document-controls" hidden>
                            <div id="generation-document-choices" class="generation-document-choices" role="group" aria-label="Design document"></div>
                            <label class="wizard-modal-field" for="generation-document-json">
                                <span id="generation-document-label" class="wizard-modal-field-label"></span>
                                <textarea id="generation-document-json" class="wizard-modal-textarea generation-json" spellcheck="false" aria-describedby="generation-document-error"></textarea>
                            </label>
                            <p id="generation-document-error" class="wizard-modal-error" role="alert"></p>
                            <div class="generation-document-find">
                                <label class="wizard-modal-field" for="generation-document-search"><span class="wizard-modal-field-label">Find in document</span>
                                    <input id="generation-document-search" class="wizard-modal-input" type="search" placeholder="Find command or JSON key" />
                                </label>
                                <button id="generation-document-find" class="btn btn-secondary btn-sm" type="button">Find next</button>
                            </div>
                            <p id="generation-document-search-status" class="wizard-modal-desc" role="status"></p>
                            <div id="generation-document-summary" class="generation-document-summary" aria-live="polite"></div>
                        </div>
                    </section>
                    </div>
                    <div id="generation-messages" aria-live="polite"></div>
                </div>
                <footer class="wizard-modal-foot">
                    <button class="btn btn-secondary btn-sm wizard-modal-cancel" type="button">Cancel</button>
                    <button id="generation-back" class="btn btn-secondary btn-sm" type="button" hidden>Back</button>
                    <button id="generation-next" class="btn btn-primary btn-sm" type="button">Next: Canvas Design</button>
                    <button id="generation-submit" class="btn btn-primary btn-sm" type="button" hidden>Generate</button>
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
            workflowListName: root.querySelector("#generation-workflow-list-name")?.value.trim() ?? "",
            description: root.querySelector("#generation-description")?.value.trim() ?? "",
        };
        schedulePreflight(root);
    };
    for (const input of root.querySelectorAll("#generation-details input:not([readonly]), #generation-details textarea")) {
        input.addEventListener("input", syncMetadata);
    }
    const showStep = (step) => {
        const details = step === "details";
        root.querySelector("#generation-details").hidden = !details;
        root.querySelector("#generation-design-step").hidden = details;
        root.querySelector("#generation-back").hidden = details;
        root.querySelector("#generation-next").hidden = !details;
        root.querySelector("#generation-submit").hidden = details;
        root.querySelector("#generation-step-details")[details ? "setAttribute" : "removeAttribute"]("aria-current", "step");
        root.querySelector("#generation-step-design")[details ? "removeAttribute" : "setAttribute"]("aria-current", "step");
        root.querySelector(".wizard-modal-body").scrollTop = 0;
    };
    root.querySelector("#generation-next").addEventListener("click", async () => {
        clearTimeout(preflightTimer);
        if ((await runPreflight(root))?.ok) showStep("design");
    });
    root.querySelector("#generation-back").addEventListener("click", () => showStep("details"));
    mountDesignPicker(root);
    mountDocumentEditor(root);
    root.querySelector("#generation-submit")?.addEventListener("click", () => submitGeneration(root));
    runPreflight(root);
}
