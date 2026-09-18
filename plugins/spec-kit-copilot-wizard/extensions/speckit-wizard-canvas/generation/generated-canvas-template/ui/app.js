import { renderMarkdown } from "./markdown.mjs";
import { commandViews } from "./command-views.mjs";
import { createClarificationQueue } from "./clarifications.mjs";
import { validateWorkflowSlug } from "./workflow-slug.mjs";

const RUN_ACK_MS = 15 * 1000;
const state = {
    snapshot: null,
    current: 0,
    runningPhase: null,
    runTimer: null,
    submitted: new Set(),
    selectedItemId: null,
    workflowSlugDraft: "",
    newWorkflowDraftId: 0,
    workflowQuery: "",
    installationSources: new Set(),
    phaseDrafts: new Map(),
    constitutionDraft: "",
    lastSubmitted: new Map(),
    artifactView: null,
};
const clarifications = createClarificationQueue(globalThis.localStorage);
const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

async function json(url, options) {
    const response = await fetch(url, options);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
    return body;
}

function selectedItem() {
    return state.snapshot?.items?.find((item) => item.id === state.selectedItemId) ?? state.snapshot?.items?.[0] ?? null;
}

function phaseRunKey(step, item = selectedItem()) {
    const itemKey = item?.isNew ? `${item.id}#${state.newWorkflowDraftId}` : (item?.id ?? "");
    return `${itemKey}:${step.instanceKey}`;
}

function resetNewWorkflowDraft() {
    if (state.runTimer) clearTimeout(state.runTimer);
    state.runTimer = null;
    state.runningPhase = null;
    state.newWorkflowDraftId += 1;
    state.workflowSlugDraft = "";
    for (const key of state.submitted) {
        if (key.startsWith("__new__#")) state.submitted.delete(key);
    }
}

function resolvedOutputPath(step, item = selectedItem()) {
    const artifact = item?.phases?.[step.instanceKey]?.artifact;
    if (artifact) return artifact;
    const template = step.artifact?.pathTemplate;
    if (!template) return null;
    const slug = item?.slug || (item?.isNew ? state.workflowSlugDraft.trim() : "");
    return slug ? template.replaceAll("<slug>", slug) : template;
}

function parentFolder(path) {
    const normalized = String(path ?? "").replaceAll("\\", "/");
    const separator = normalized.lastIndexOf("/");
    return separator > 0 ? normalized.slice(0, separator) : ".";
}

function updateWritesTo(step, item = selectedItem()) {
    const button = $("browse-output-folder");
    if (!button) return;
    const outputPath = resolvedOutputPath(step, item);
    const unresolved = !outputPath || outputPath.includes("<slug>");
    button.disabled = unresolved;
    button.dataset.folderPath = unresolved ? "" : parentFolder(outputPath);
    button.title = unresolved ? "Enter a workflow slug to resolve this path" : `Open ${button.dataset.folderPath} in file explorer`;
    button.innerHTML = `<code>${esc(outputPath || "Transient phase")}</code>`;
}

function renderItemPicker() {
    const picker = $("item-picker");
    if (state.snapshot?.pipeline?.runtime?.multiInstance === true) {
        picker.hidden = true;
        picker.innerHTML = "";
        return;
    }
    const items = state.snapshot?.items ?? [];
    picker.hidden = true;
    picker.innerHTML = "";
}

function renderInstanceCollection() {
    const collection = $("instance-collection");
    if (state.snapshot?.pipeline?.runtime?.multiInstance !== true) {
        collection.hidden = true;
        collection.innerHTML = "";
        return;
    }
    const items = (state.snapshot?.items ?? [])
        .filter((item) => !item.isNew)
        .sort((left, right) => (right.lastActivity ?? 0) - (left.lastActivity ?? 0));
    collection.hidden = false;
    collection.innerHTML = `
        <div class="instance-collection-head">
            <h2>${esc(state.snapshot?.pipeline?.metadata?.workflowListName ?? "Workflows")} <span class="muted">(${items.length})</span></h2>
            <button class="btn btn-secondary" id="new-workflow" type="button">+ New</button>
        </div>
        ${items.length > 8 ? `<label class="workflow-search"><span class="visually-hidden">Search</span><input id="workflow-search" type="search" value="${esc(state.workflowQuery)}" placeholder="Search…" /></label>` : ""}
        ${items.length ? `<div class="instance-list">${items.map((item) => {
            const activity = item.lastActivity ? new Date(item.lastActivity).toLocaleDateString() : "";
            return `<div class="instance-row ${item.id === selectedItem()?.id ? "active" : ""}" data-workflow-search="${esc(`${item.label} ${item.slug}`.toLowerCase())}">
                <button class="instance-select" type="button" data-instance="${esc(item.id)}">
                    <strong>${esc(item.label)}</strong>
                    <span class="muted">${esc(activity)}</span>
                </button>
                <button class="instance-delete" type="button" data-delete-workflow="${esc(item.slug)}" aria-label="Delete ${esc(item.label)}">Delete</button>
            </div>`;
        }).join("")}</div>` : '<div class="workflow-empty"><strong>Nothing here yet.</strong><span>Select New to get started.</span></div>'}`;
    $("workflow-search")?.addEventListener("input", (event) => {
        state.workflowQuery = event.target.value;
        const query = state.workflowQuery.trim().toLowerCase();
        for (const row of collection.querySelectorAll("[data-workflow-search]")) {
            row.hidden = query && !row.dataset.workflowSearch.includes(query);
        }
    });
    $("new-workflow")?.addEventListener("click", () => {
        const item = state.snapshot?.items?.find((entry) => entry.isNew);
        if (!item) return;
        resetNewWorkflowDraft();
        state.selectedItemId = item.id;
        state.current = 0;
        render();
    });
    collection.addEventListener("click", async (event) => {
        const deleteButton = event.target.closest?.("[data-delete-workflow]");
        if (deleteButton) {
            const item = items.find((entry) => entry.slug === deleteButton.dataset.deleteWorkflow);
            if (item) await requestWorkflowDeletion(item);
            return;
        }
        const selectButton = event.target.closest?.("[data-instance]");
        if (!selectButton) return;
        state.selectedItemId = selectButton.dataset.instance;
        state.current = 0;
        state.workflowSlugDraft = "";
        render();
    });
}

function phaseInputGuidance(step) {
    return state.snapshot?.phaseInputs?.[step.instanceKey]
        ?? { label: "Phase input", helper: "Add details or direction for this phase.", optional: false };
}

function workflowSteps() {
    return commandViews(state.snapshot?.pipeline).workflow;
}

function constitutionBlocked() {
    return Boolean(commandViews(state.snapshot?.pipeline).constitution
        && state.snapshot?.projectArtifacts?.constitution?.ready !== true);
}

function renderConstitution() {
    const panel = $("constitution-card");
    const { constitution } = commandViews(state.snapshot?.pipeline);
    panel.hidden = !constitution;
    if (!constitution) { panel.innerHTML = ""; return; }
    const status = state.snapshot?.projectArtifacts?.constitution;
    const label = { missing: "Not created", empty: "Not created", template: "Template", ready: "Ready", error: "Unavailable" }[status?.state] ?? "Unavailable";
    const message = status?.error ?? (status?.ready
        ? "Project principles apply to every workflow."
        : "Define the project principles before running workflow phases.");
    panel.innerHTML = `<div class="constitution-summary"><h2>Constitution <span class="muted">${esc(label)}</span></h2><p id="constitution-prerequisite" ${status?.state === "error" ? 'role="alert"' : 'role="status"'}>${esc(message)}</p></div>
        <div class="constitution-actions"><button class="btn btn-secondary" id="view-constitution" type="button" ${status?.viewable ? "" : "disabled"}>View</button><button class="btn btn-secondary" id="run-constitution" type="button">Create / update</button></div>`;
    $("view-constitution")?.addEventListener("click", () => openArtifact(status.path, constitution));
    $("run-constitution")?.addEventListener("click", () => openConstitutionDialog(constitution));
}

function openConstitutionDialog(step) {
    const root = $("modal-root");
    const guidance = phaseInputGuidance(step);
    root.innerHTML = `<div class="wizard-modal-backdrop"><section class="wizard-modal constitution-dialog" role="dialog" aria-modal="true" aria-labelledby="constitution-title" aria-describedby="constitution-description">
        <header class="wizard-modal-head"><h3 id="constitution-title">Run Constitution</h3></header>
        <div class="wizard-modal-body"><p id="constitution-description">Create or update the project constitution — the principles that govern every feature.</p>
        <label class="field" for="constitution-guidance"><span class="field-label">Guidance</span><span class="visually-hidden" id="constitution-guidance-help">${esc(guidance.helper)}</span><textarea class="phase-input-control" id="constitution-guidance" aria-describedby="constitution-guidance-help" placeholder="${esc(guidance.helper)}"></textarea></label><p id="constitution-dialog-message" role="status"></p></div>
        <footer class="wizard-modal-foot"><button class="btn btn-secondary" id="cancel-constitution" type="button">Cancel</button><button class="btn btn-primary" id="confirm-constitution" type="button">Run</button></footer>
        </section></div>`;
    const input = $("constitution-guidance");
    input.value = state.constitutionDraft;
    input.focus?.();
    input.addEventListener("input", () => { state.constitutionDraft = input.value; });
    const close = () => {
        state.constitutionDraft = input.value;
        root.innerHTML = "";
        root.onkeydown = null;
        $("run-constitution")?.focus?.();
    };
    $("cancel-constitution").addEventListener("click", close);
    root.onkeydown = (event) => {
        if (event.key === "Escape") { event.preventDefault(); close(); }
        if (event.key === "Tab") {
            const controls = [input, $("cancel-constitution"), $("confirm-constitution")].filter((element) => !element.disabled);
            if (event.shiftKey && document.activeElement === controls[0]) {
                event.preventDefault(); controls.at(-1).focus?.();
            } else if (!event.shiftKey && document.activeElement === controls.at(-1)) {
                event.preventDefault(); controls[0].focus?.();
            }
        }
    };
    $("confirm-constitution").addEventListener("click", async () => {
        const button = $("confirm-constitution");
        button.disabled = true;
        state.constitutionDraft = input.value;
        try {
            const result = await json("/api/run", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ phase: step.instanceKey, args: input.value }),
            });
            if (result.ok === false) throw new Error(result.error || "Constitution could not run.");
            state.lastSubmitted.set(`project:${step.instanceKey}`, input.value);
            close();
            await refresh();
        } catch (error) {
            $("constitution-dialog-message").textContent = error.message;
            button.disabled = false;
        }
    });
}

function renderPhaseNavigation() {
    const steps = workflowSteps();
    const navigation = $("phase-navigation");
    if (!steps.length) {
        navigation.innerHTML = "";
        return;
    }
    navigation.innerHTML = `<ol class="stepper" aria-label="Workflow phases">${steps.map((step, index) => `
        ${index > 0 ? '<li class="step-sep" aria-hidden="true"></li>' : ""}
        <li><button class="step ${index === state.current ? "active" : ""}" type="button" data-phase-index="${index}" ${index === state.current ? 'aria-current="step"' : ""} aria-label="Phase ${index + 1} of ${steps.length}: ${esc(step.label)}">
            <span class="step-order">${index + 1}</span>
            <span class="step-label"><span class="step-name">${esc(step.label)}</span></span>
        </button></li>`).join("")}</ol>`;
    navigation.querySelectorAll("[data-phase-index]").forEach((button) => {
        button.addEventListener("click", () => {
            state.current = Number(button.dataset.phaseIndex);
            render();
        });
    });
    navigation.querySelector('[aria-current="step"]')?.scrollIntoView?.({ block: "nearest", inline: "center" });
}

function renderCurrentWorkflow() {
    const container = $("current-workflow");
    const item = selectedItem();
    if (!item) {
        container.innerHTML = "";
        return;
    }
    container.innerHTML = `<div>${item.isNew ? "" : '<span class="muted">Current selection</span>'}<h2>${esc(item.isNew ? "New" : item.label)}</h2></div>`;
}

function slugPhaseIndex(steps) {
    if (state.snapshot?.pipeline?.runtime?.userProvidesSlug !== true) return -1;
    return steps.findIndex((step) => step.artifact?.pathTemplate?.includes("<slug>"));
}

function renderPhaseCard() {
    const steps = workflowSteps();
    const step = steps[state.current];
    const item = selectedItem();
    if (!step) {
        $("phase-card").innerHTML = commandViews(state.snapshot?.pipeline).constitution
            ? "" : '<div class="workflow-empty">No workflow phases are configured.</div>';
        return;
    }
    const runKey = phaseRunKey(step, item);
    const running = state.runningPhase === runKey;
    const submitted = state.submitted.has(runKey);
    const artifact = item?.phases?.[step.instanceKey]?.artifact ?? null;
    const completed = Boolean(artifact);
    const inputGuidance = phaseInputGuidance(step);
    const outputPath = resolvedOutputPath(step, item);
    const outputUnresolved = !outputPath || outputPath.includes("<slug>");
    const showsSlug = state.current === slugPhaseIndex(steps);
    const slugLocked = !item?.isNew || running || submitted;
    const slugValue = item?.slug || state.workflowSlugDraft.trim();
    const slugControl = showsSlug
        ? `<label class="field" for="workflow-slug"><span class="field-label" id="workflow-slug-label">Workflow slug${slugLocked ? "" : ' <span class="muted">(optional)</span>'}</span><span class="muted" id="workflow-slug-help">Names the folder where this workflow’s artifacts are saved.${slugLocked ? "" : " Leave blank to let Spec Kit choose a name."}</span><input class="phase-input-control" id="workflow-slug" type="text" aria-labelledby="workflow-slug-label" aria-describedby="workflow-slug-help" value="${esc(slugLocked ? slugValue : state.workflowSlugDraft)}" placeholder="${slugLocked ? "Automatically assigned" : "your-slug"}" ${slugLocked ? "readonly" : ""} /></label>`
        : "";
    const backDisabled = state.current === 0;
    const continueDisabled = state.current >= steps.length - 1;
    $("phase-card").innerHTML = `
        <header class="workflow-header">
            <div class="workflow-header-main"><h2>${esc(step.label)}</h2><p class="tagline">${esc(step.description)}</p></div>
        </header>
        <dl class="phase-facts">
            <dt>Writes to</dt><dd><button class="phase-artifact-link" id="browse-output-folder" type="button" data-folder-path="${esc(outputUnresolved ? "" : parentFolder(outputPath))}" ${outputUnresolved ? "disabled" : ""} title="${esc(outputUnresolved ? "Enter a workflow slug to resolve this path" : `Open ${parentFolder(outputPath)} in file explorer`)}"><code>${esc(outputPath || "Transient phase")}</code></button></dd>
        </dl>
        <label class="field" for="phase-args">
            <span class="field-label" id="phase-input-label">${esc(inputGuidance.label)}${inputGuidance.optional ? ' <span class="muted">(optional)</span>' : ""}</span>
            <span class="visually-hidden" id="phase-input-help">${esc(inputGuidance.helper)}</span>
            <textarea class="phase-input-control" id="phase-args" aria-labelledby="phase-input-label" aria-describedby="phase-input-help" placeholder="${esc(inputGuidance.helper)}"></textarea>
        </label>
        ${slugControl}
        <div id="phase-message"></div>
        <footer class="phase-actions phase-actions-nav">
            <div class="phase-actions-left"><button class="btn btn-secondary" id="previous-phase" type="button" ${backDisabled ? "disabled" : ""}>◀ Back</button></div>
            <div class="phase-actions-center">
                <button class="btn btn-primary" id="run-phase" type="button" ${running || constitutionBlocked() ? "disabled" : ""} ${constitutionBlocked() ? 'aria-describedby="constitution-prerequisite" title="Define the project Constitution before running workflow phases."' : ""}>${running ? '<span class="btn-spinner" aria-hidden="true"></span> Running…' : (completed || submitted ? "Run again" : "Run phase")}</button>
                ${artifact ? '<button class="btn btn-secondary" id="view-artifact" type="button">View artifact</button>' : ""}
            </div>
            <div class="phase-actions-right"><button class="btn btn-secondary" id="next-phase" type="button" ${continueDisabled ? "disabled" : ""}>Continue ▶</button></div>
        </footer>`;
    $("phase-args").value = state.phaseDrafts.get(runKey) ?? "";
    $("phase-args").addEventListener("input", (event) => state.phaseDrafts.set(runKey, event.target.value));
    $("workflow-slug")?.addEventListener("input", (event) => {
        if (slugLocked) return;
        $("workflow-slug").setCustomValidity("");
        state.workflowSlugDraft = event.target.value;
        updateWritesTo(step, item);
    });
    $("run-phase")?.addEventListener("click", () => runPhase(step, completed));
    $("view-artifact")?.addEventListener("click", () => openArtifact(artifact, step, item));
    $("browse-output-folder")?.addEventListener("click", revealOutputFolder);
    $("previous-phase")?.addEventListener("click", () => {
        if (state.current > 0) {
            state.current -= 1;
            render();
        }
    });
    $("next-phase")?.addEventListener("click", () => {
        if (state.current < steps.length - 1) {
            state.current += 1;
            render();
        }
    });
}

async function runPhase(step, completed) {
    const runKey = phaseRunKey(step);
    if (state.runningPhase === runKey) return;
    const item = selectedItem();
    const usesSlugDraft = state.current === slugPhaseIndex(workflowSteps()) && item?.isNew;
    const validation = validateWorkflowSlug(usesSlugDraft ? state.workflowSlugDraft : "");
    if (usesSlugDraft) {
        const control = $("workflow-slug");
        control.setCustomValidity(validation.error);
        if (validation.error) {
            control.reportValidity();
            return;
        }
    }
    if (state.snapshot?.setup?.approval?.required && !state.snapshot.setup.approval.approved) {
        await reviewInstallation("review");
        return;
    }
    if ((completed || state.submitted.has(runKey)) && !await confirmRerun(step)) return;
    const args = $("phase-args")?.value ?? "";
    state.phaseDrafts.set(runKey, args);
    const slug = usesSlugDraft ? validation.slug : null;
    if (state.runTimer) clearTimeout(state.runTimer);
    state.runningPhase = runKey;
    renderPhaseCard();
    try {
        const result = await json("/api/run", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                phase: step.instanceKey,
                itemId: item?.id ?? null,
                args,
                ...(slug !== null
                    ? { slug }
                    : {}),
            }),
        });
        if (result.approvalRequired) {
            state.runningPhase = null;
            state.snapshot.setup = (await json("/api/state")).setup;
            renderInstallationApproval();
            renderPhaseCard();
            $("phase-args").value = args;
            return;
        }
        if (result.code === "constitution_required") {
            state.runningPhase = null;
            await refresh();
            return;
        }
        if (result.ok === false) throw new Error(result.error || "Workflow could not run.");
        state.lastSubmitted.set(runKey, args);
        if (phaseRunKey(step) !== runKey) {
            if (state.runningPhase === runKey) state.runningPhase = null;
            return;
        }

        state.submitted.add(runKey);
        state.runTimer = setTimeout(() => {
            if (state.runningPhase === runKey) state.runningPhase = null;
            state.runTimer = null;
            renderPhaseCard();
        }, RUN_ACK_MS);
        state.runTimer.unref?.();
    } catch (error) {
        state.runningPhase = null;
        renderPhaseCard();
        $("phase-message").innerHTML = `<div class="workflow-error">${esc(error.message)}</div>`;
    }
}

function confirmRerun(step, projectScoped = false) {
    return new Promise((resolve) => {
        const root = $("modal-root");
        root.innerHTML = `<div class="wizard-modal-backdrop"><section class="wizard-modal" role="dialog" aria-modal="true" aria-labelledby="rerun-title">
            <header class="wizard-modal-head"><h3 id="rerun-title">Run ${esc(step.label)} again?</h3></header>
            <div class="wizard-modal-body"><p>${projectScoped ? "Existing project Constitution content may be replaced." : "Existing output may be replaced and completed downstream phases will be marked stale."}</p></div>
            <footer class="wizard-modal-foot"><button class="btn btn-secondary" data-answer="cancel" type="button">Cancel</button><button class="btn btn-primary" data-answer="confirm" type="button">Run again</button></footer>
        </section></div>`;
        const cancel = root.querySelector('[data-answer="cancel"]');
        const confirm = root.querySelector('[data-answer="confirm"]');
        const finish = (value) => { root.innerHTML = ""; root.onkeydown = null; resolve(value); };
        cancel.addEventListener("click", () => finish(false));
        confirm.addEventListener("click", () => finish(true));
        cancel.focus?.();
        root.onkeydown = (event) => {
            if (event.key === "Escape") { event.preventDefault(); finish(false); }
            if (event.key === "Tab") {
                if (event.shiftKey && document.activeElement === cancel) { event.preventDefault(); confirm.focus?.(); }
                else if (!event.shiftKey && document.activeElement === confirm) { event.preventDefault(); cancel.focus?.(); }
            }
        };
    });
}

function confirmWorkflowDeletion(item) {
    return new Promise((resolve) => {
        const root = $("modal-root");
        root.innerHTML = `<div class="wizard-modal-backdrop"><section class="wizard-modal" role="dialog" aria-modal="true" aria-labelledby="delete-workflow-title">
            <header class="wizard-modal-head"><h3 id="delete-workflow-title">Delete “${esc(item.label)}”?</h3></header>
            <div class="wizard-modal-body"><p>This permanently deletes the selected item's directory and all of its artifacts from the workspace.</p></div>
            <footer class="wizard-modal-foot"><button class="btn btn-secondary" id="cancel-delete-workflow" type="button">Cancel</button><button class="btn btn-danger" id="confirm-delete-workflow" type="button">Delete</button></footer>
        </section></div>`;
        const finish = (value) => {
            root.innerHTML = "";
            resolve(value);
        };
        $("cancel-delete-workflow").addEventListener("click", () => finish(false));
        $("confirm-delete-workflow").addEventListener("click", () => finish(true));
    });
}

async function requestWorkflowDeletion(item) {
    if (!item?.slug || !await confirmWorkflowDeletion(item)) return;
    try {
        await json("/api/workflow/delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ slug: item.slug }),
        });
        if (state.selectedItemId === item.id) state.selectedItemId = null;
        await refresh();
    } catch (error) {
        $("phase-message").innerHTML = `<div class="workflow-error">${esc(error.message)}</div>`;
    }
}

async function revealOutputFolder(event) {
    const folderPath = event?.currentTarget?.dataset?.folderPath
        || $("browse-output-folder")?.dataset?.folderPath;
    if (!folderPath) return;
    try {
        await json("/api/reveal", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: folderPath }),
        });
    } catch (error) {
        $("phase-message").innerHTML = `<div class="workflow-error">${esc(error.message)}</div>`;
    }
}

async function openArtifact(path, step, item = selectedItem()) {
    const projectScoped = step === commandViews(state.snapshot?.pipeline).constitution;
    const context = Object.freeze({
        scope: state.snapshot?.clarificationScope,
        phase: step.instanceKey,
        artifact: path,
        ...(!projectScoped ? { itemId: item?.id ?? null } : {}),
    });
    const view = {
        context, step, projectScoped, marks: [],
        runKey: projectScoped ? `project:${step.instanceKey}` : phaseRunKey(step, item),
    };
    state.artifactView = view;
    try {
        const result = await json(`/api/artifact?path=${encodeURIComponent(path)}`);
        if (state.artifactView !== view) return;
        $("artifact-viewer").innerHTML = `<header class="artifact-viewer-header"><button class="btn btn-secondary" id="close-artifact" type="button">Back</button><strong>${esc(path)}</strong></header><div class="artifact-viewer-clarify-banner" id="clarification-banner" hidden></div><div class="artifact-viewer-body"><div class="artifact-viewer-md">${renderMarkdown(result.content, { clarifications: view.marks })}</div></div>`;
        $("artifact-viewer").hidden = false;
        $("close-artifact").addEventListener("click", () => {
            state.artifactView = null;
            $("artifact-viewer").hidden = true;
        });
        $("artifact-viewer").querySelectorAll("[data-clarify-idx]").forEach((button) => {
            button.addEventListener("click", () => openClarification(view, view.marks[Number(button.dataset.clarifyIdx)].question, button));
        });
        refreshClarifications(view);
    } catch (error) {
        if (state.artifactView === view) globalThis.alert(error.message);
    }
}

function refreshClarifications(view, message = "") {
    if (state.artifactView !== view) return;
    const answers = clarifications.list(view.context);
    const pending = clarifications.isPending(view.context) || state.runningPhase === view.runKey;
    $("artifact-viewer").querySelectorAll("[data-clarify-idx]").forEach((button) => {
        const answer = answers.find((entry) => entry.question === view.marks[Number(button.dataset.clarifyIdx)].question);
        button.textContent = answer ? "Answered ✓" : "Clarify";
        button.title = answer?.answer ?? "";
    });
    const banner = $("clarification-banner");
    banner.hidden = !answers.length && !message;
    banner.innerHTML = `<span role="status">${esc(message || `${answers.length} clarification${answers.length === 1 ? "" : "s"} queued. Answers stay here until you apply them.`)}</span>${answers.length ? `<button class="btn btn-primary btn-sm" id="apply-clarifications" type="button" ${pending ? "disabled" : ""}>${pending ? "Applying…" : "Apply and Rerun"}</button>` : ""}`;
    $("apply-clarifications")?.addEventListener("click", () => applyClarifications(view));
}

function openClarification(view, question, trigger) {
    const root = $("modal-root");
    root.innerHTML = `<div class="wizard-modal-backdrop"><section class="wizard-modal constitution-dialog" role="dialog" aria-modal="true" aria-labelledby="clarification-title">
        <header class="wizard-modal-head"><h3 id="clarification-title">Resolve clarification</h3></header>
        <div class="wizard-modal-body"><p id="clarification-question">${esc(question)}</p>
        <label class="field" for="clarification-answer"><span class="field-label">Answer</span><textarea class="phase-input-control" id="clarification-answer" aria-describedby="clarification-question"></textarea></label><p class="muted">Queue your answer, then choose Apply and Rerun when ready.</p></div>
        <footer class="wizard-modal-foot"><button class="btn btn-secondary" id="cancel-clarification" type="button">Cancel</button><button class="btn btn-primary" id="queue-clarification" type="button">Queue answer</button></footer>
        </section></div>`;
    const input = $("clarification-answer");
    const queue = $("queue-clarification");
    input.value = clarifications.list(view.context).find((entry) => entry.question === question)?.answer ?? "";
    const update = () => { queue.disabled = !input.value.trim(); };
    input.addEventListener("input", update);
    update();
    input.focus?.();
    const close = () => {
        root.innerHTML = "";
        root.onkeydown = null;
        if (state.artifactView === view) trigger.focus?.();
    };
    $("cancel-clarification").addEventListener("click", close);
    root.onkeydown = (event) => {
        if (event.key === "Escape") { event.preventDefault(); close(); }
        if (event.key === "Tab") {
            const controls = [input, $("cancel-clarification"), queue].filter((element) => !element.disabled);
            if (event.shiftKey && document.activeElement === controls[0]) {
                event.preventDefault(); controls.at(-1).focus?.();
            } else if (!event.shiftKey && document.activeElement === controls.at(-1)) {
                event.preventDefault(); controls[0].focus?.();
            }
        }
    };
    queue.addEventListener("click", () => {
        if (!input.value.trim()) return;
        clarifications.queue(view.context, question, input.value.trim());
        close();
        refreshClarifications(view);
    });
}

async function applyClarifications(view) {
    if (state.runningPhase === view.runKey || clarifications.isPending(view.context)) return;
    try {
        const submission = clarifications.flush(view.context, {
            confirm: () => confirmRerun(view.step, view.projectScoped),
            baseArgs: state.lastSubmitted.get(view.runKey),
            dispatch: (input) => json("/api/run", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify(input),
            }),
        });
        refreshClarifications(view);
        const outcome = await submission;
        if (!outcome.accepted) {
            if (outcome.result?.approvalRequired || outcome.result?.code === "constitution_required") await refresh();
            refreshClarifications(view, outcome.cancelled ? "" : "Could not submit the clarification rerun. Your queued answers were preserved.");
            return;
        }
        state.submitted.add(view.runKey);
        if (!outcome.result.queued) state.lastSubmitted.set(view.runKey, outcome.args);
        state.runningPhase = view.runKey;
        if (state.runTimer) clearTimeout(state.runTimer);
        state.runTimer = setTimeout(() => {
            if (state.runningPhase === view.runKey) state.runningPhase = null;
            state.runTimer = null;
            renderPhaseCard();
            if (state.artifactView) refreshClarifications(state.artifactView);
        }, RUN_ACK_MS);
        state.runTimer.unref?.();
        renderPhaseCard();
        refreshClarifications(view, outcome.result.queued ? "Clarification rerun queued for setup. Answers retained as a draft." : "Clarification rerun submitted.");
    } catch (error) {
        refreshClarifications(view, `${error.message} Your queued answers were preserved.`);
    }
}

function render() {
    renderInstallationApproval();
    renderConstitution();
    renderInstanceCollection();
    renderItemPicker();
    renderCurrentWorkflow();
    renderPhaseNavigation();
    renderPhaseCard();
    const constitutionOnly = Boolean(commandViews(state.snapshot?.pipeline).constitution && !workflowSteps().length);
    for (const id of ["current-workflow", "phase-navigation", "phase-card"]) $(id).hidden = constitutionOnly;
}

function sourceLink(source) {
    try {
        const url = new URL(source?.url);
        return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
    } catch { return null; }
}

function renderInstallationApproval() {
    const panel = $("installation-approval");
    const setup = state.snapshot?.setup;
    const approval = setup?.approval;
    panel.hidden = !approval?.required || (approval.approved && setup.ready);
    if (panel.hidden) { panel.innerHTML = ""; return; }
    if (approval.error) {
        panel.innerHTML = `<h2>Installation approval unavailable</h2><p role="alert">${esc(approval.error)}</p><button class="btn btn-secondary" id="approval-refresh" type="button">Review installation</button>`;
        $("approval-refresh")?.addEventListener("click", () => reviewInstallation("refresh"));
        return;
    }
    if (approval.approved) {
        panel.innerHTML = setup.state === "failed"
            ? `<h2>Installation needs attention</h2><p role="alert">${esc(setup.message)}</p><button class="btn btn-secondary" id="approval-retry" type="button">Retry setup</button>`
            : '<h2>Installing required components</h2><p role="status">Waiting for setup verification and current-session skills to be ready.</p>';
        $("approval-retry")?.addEventListener("click", () => reviewInstallation("retry"));
        return;
    }
    if (approval.state === "deferred") {
        panel.innerHTML = '<div class="installation-deferred"><div><h2>Required installation has not been approved</h2><p>This canvas cannot run phases until its required presets and extensions are installed.</p></div><button class="btn btn-secondary" id="approval-review" type="button">Review installation</button></div>';
        $("approval-review")?.addEventListener("click", () => reviewInstallation("review"));
        return;
    }
    panel.innerHTML = `<div class="installation-heading"><h2>Install required components to use this canvas</h2>
        <p class="installation-intro"><strong>These components are required to use ${esc(state.snapshot?.pipeline?.metadata?.displayName || "this canvas")}.</strong> Review their sources, then approve installation.</p></div>
        <ul class="installation-components" aria-label="Required presets and extensions">${(approval.components ?? []).map((entry) => {
            const url = sourceLink(entry.source);
            const sourceKey = `${entry.kind}:${entry.id}`;
            const kind = entry.kind === "preset" ? "Preset" : "Extension";
            return `<li class="installation-component">
                <div class="installation-component-main">
                    <div class="installation-component-name"><strong>${esc(entry.name || entry.id)}</strong><span class="installation-tag">${kind}</span>${entry.source?.name === "community" ? '<span class="installation-tag">Community</span>' : ""}</div>
                    ${entry.name && entry.name !== entry.id ? `<p class="muted"><code>${esc(entry.id)}</code></p>` : ""}
                </div>
                ${url ? `<details class="installation-source" data-source-key="${esc(sourceKey)}"${state.installationSources.has(sourceKey) ? " open" : ""}><summary>View source<span class="visually-hidden"> for ${esc(entry.name || entry.id)}</span></summary><div class="installation-source-info"><span class="muted">${esc(entry.source.name || "Recorded source")}${entry.version ? ` · ${esc(entry.version)}` : ""}</span><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a></div></details>` : '<span class="installation-source-unavailable muted">Reviewable source unavailable</span>'}
            </li>`;
        }).join("")}</ul>
        <div class="installation-actions"><button class="btn btn-primary" id="approval-accept" type="button">Approve and install</button><button class="btn btn-secondary" id="approval-defer" type="button">Not now</button></div>`;
    panel.querySelectorAll("[data-source-key]").forEach((details) => {
        details.addEventListener("toggle", () => {
            if (details.open) state.installationSources.add(details.dataset.sourceKey);
            else state.installationSources.delete(details.dataset.sourceKey);
        });
    });
    $("approval-accept")?.addEventListener("click", () => reviewInstallation("accept"));
    $("approval-defer")?.addEventListener("click", () => reviewInstallation("defer"));
}

async function refreshApproval() {
    state.snapshot.setup = (await json("/api/state")).setup;
    renderInstallationApproval();
}

async function reviewInstallation(action) {
    const approval = state.snapshot?.setup?.approval;
    const panel = $("installation-approval");
    for (const button of panel.querySelectorAll("button")) button.disabled = true;
    try {
        if (action === "refresh") {
            await refreshApproval();
            return;
        }
        const result = await json(action === "retry" ? "/api/setup" : "/api/installation-approval", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(action === "retry" ? {} : {
                action, fingerprint: approval?.fingerprint, challenge: approval?.challenge,
            }),
        });
        if (result.ok === false && !result.approvalRequired) throw new Error(result.error || "Setup failed.");
        await refreshApproval();
    } catch (error) {
        renderInstallationApproval();
        panel.insertAdjacentHTML("beforeend", `<p role="alert">${esc(error.message)}</p>`);
    }
}

async function refresh() {
    const phaseDraft = $("phase-args")?.value;
    const previousIds = new Set((state.snapshot?.items ?? []).filter((item) => !item.isNew).map((item) => item.id));
    const previousSelection = state.selectedItemId;
    state.snapshot = await json("/api/state");
    if (state.snapshot?.pipeline?.runtime?.multiInstance === true && previousSelection === "__new__") {
        const created = (state.snapshot.items ?? []).filter((item) => !item.isNew && !previousIds.has(item.id));
        if (created.length === 1) {
            state.selectedItemId = created[0].id;
            state.workflowSlugDraft = "";
        }
    }
    if (!state.snapshot.items?.some((item) => item.id === state.selectedItemId)) {
        state.selectedItemId = state.snapshot.selectedItemId ?? state.snapshot.items?.[0]?.id ?? null;
    }
    const setup = $("setup-message");
    const failed = !state.snapshot.setup?.approval?.required && state.snapshot.setup?.ready === false && state.snapshot.setup?.state === "failed";
    setup.hidden = !failed;
    if (failed) {
        setup.innerHTML = `${esc(state.snapshot.setup?.message ?? "Workflow setup failed.")} <button class="btn btn-secondary" id="retry-setup" type="button">Retry setup</button>`;
    } else {
        setup.innerHTML = "";
    }
    $("retry-setup")?.addEventListener("click", async () => {
        await json("/api/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    });
    const instanceError = state.snapshot?.instance?.state === "error" ? state.snapshot.instance.error : null;
    if (instanceError) {
        setup.hidden = false;
        setup.innerHTML = esc(instanceError);
    }
    render();
    if (phaseDraft !== undefined && previousSelection === state.selectedItemId && $("phase-args")) $("phase-args").value = phaseDraft;
}

$("theme-toggle").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("speckit-workflow-theme", next);
});
const savedTheme = localStorage.getItem("speckit-workflow-theme");
if (savedTheme) document.documentElement.dataset.theme = savedTheme;

const events = new EventSource("/api/events");
events.onopen = () => { $("connection").className = "conn conn-live"; $("connection").textContent = "live"; };
events.onerror = () => { $("connection").className = "conn conn-lost"; $("connection").textContent = "reconnecting…"; };
events.onmessage = () => refresh().catch(() => {});
refresh().catch((error) => {
    $("phase-card").innerHTML = `<div class="workflow-error">${esc(error.message)}</div>`;
});
