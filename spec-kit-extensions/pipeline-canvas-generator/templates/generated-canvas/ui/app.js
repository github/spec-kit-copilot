// Standalone workflow UI: setup, phase execution, artifact viewing, and clarifications.
import { renderMarkdown } from "./markdown.mjs";
import { commandViews } from "./command-views.mjs";
import { clarificationKey, createClarificationQueue } from "./clarifications.mjs";
import { observationMessage, refreshDraftControls, selectedDrafts } from "./clarification-controls.mjs";
import { validateWorkflowSlug } from "./workflow-slug.mjs";
import { installationDisclosure } from "./setup-view.mjs";

const presentation = __PRESENTATION_JSON__;
const category = (name) => presentation[name];
const contentCopy = (key, fallback) => category("canvas-content")?.copy?.[key] ?? fallback;
const state = {
    snapshot: null,
    current: 0,
    runningPhase: null,
    selectedItemId: null,
    workflowSlugDraft: "",
    newWorkflowDraftId: 0,
    workflowQuery: "",
    phaseDrafts: new Map(),
    constitutionDraft: "",
    lastSubmitted: new Map(),
    artifactView: null,
    amendmentPolls: new Map(),
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
    state.runningPhase = null;
    state.newWorkflowDraftId += 1;
    state.workflowSlugDraft = "";
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
    const statuses = new Map(items.map((item) => [item.id, workflowStatus(item)]));
    const clarificationCount = state.snapshot?.clarificationTag !== false
        ? items.filter((item) => workflowSteps().some((step) => item.phases?.[step.instanceKey]?.clarificationCount > 0)).length : null;
    const review = state.snapshot?.artifactReview;
    const resultCounts = (review?.labels ?? []).map((label) => ({
        label, count: items.filter((item) => item.resultTags?.includes(label)).length,
    }));
    const collectionPath = state.snapshot?.pipeline?.runtime?.itemRoot?.replaceAll("\\", "/").replace(/\/<slug>$/, "");
    collection.hidden = false;
    collection.innerHTML = `
        <div class="instance-collection-head">
            <h2>${esc(category("canvas-content")?.workflowListName ?? state.snapshot?.pipeline?.metadata?.workflowListName ?? "Workflows")} <span class="muted">(${items.length})</span></h2>
            <button class="btn btn-secondary" id="new-workflow" type="button">+ ${esc(contentCopy("new", "New"))}</button>
        </div>
        ${state.snapshot?.pipeline?.metadata?.description ? `<p class="collection-description muted">${esc(state.snapshot.pipeline.metadata.description)}</p>` : ""}
        ${collectionPath ? `<button type="button" class="phase-artifact-link collection-folder" id="browse-collection-folder" data-folder-path="${esc(collectionPath)}" title="Open ${esc(collectionPath)}/ in file explorer"><code>${esc(collectionPath)}/</code></button>` : ""}
        <div class="collection-summary" aria-label="Workflow counts">
            ${resultCounts.map(({ label, count }) => phaseNotice(`${label}: ${count}`, "Workflows with this tag in any current phase result, counted once per tag. Freshness is best-effort, not verified code correctness.")).join("")}
            ${clarificationCount !== null ? phaseNotice(`Clarification needed: ${clarificationCount}`, "Workflows with unresolved clarifications in any phase. This count overlaps the other counts.") : ""}
        </div>
        <div id="collection-message" role="status"></div>
        ${items.length > 8 ? `<label class="workflow-search"><span class="visually-hidden">Search</span><input id="workflow-search" type="search" value="${esc(state.workflowQuery)}" placeholder="Search…" /></label>` : ""}
        ${items.length ? `<div class="instance-list">${items.map((item) => {
            const activity = item.lastActivity ? new Date(item.lastActivity).toLocaleDateString() : "";
            return `<div class="instance-row ${item.id === selectedItem()?.id ? "active" : ""}" data-workflow-search="${esc(`${item.label} ${item.slug}`.toLowerCase())}">
                <button class="instance-select" type="button" data-instance="${esc(item.id)}">
                    <strong>${esc(item.label)}</strong>
                    <span class="muted">${esc(activity)}</span>
                    ${phaseFeedback(statuses.get(item.id))}
                </button>
                <button class="instance-delete" type="button" data-delete-workflow="${esc(item.slug)}" aria-label="Delete ${esc(item.label)}">Delete</button>
            </div>`;
        }).join("")}</div>` : '<p class="workflow-empty">Start your first workflow below.</p>'}`;
    $("browse-collection-folder")?.addEventListener("click", (event) => revealOutputFolder(event, "collection-message"));
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
    if (collection.dataset.bound) return;
    collection.dataset.bound = "true";
    collection.addEventListener("click", async (event) => {
        const deleteButton = event.target.closest?.("[data-delete-workflow]");
        if (deleteButton) {
            const item = state.snapshot?.items?.find((entry) => !entry.isNew && entry.slug === deleteButton.dataset.deleteWorkflow);
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
    const guidance = state.snapshot?.phaseInputs?.[step.instanceKey]
        ?? { label: "Phase input", helper: "Add details or direction for this phase.", optional: false };
    const custom = category("canvas-interactions")?.inputs?.phases?.[step.commandName];
    return custom ? { ...guidance, helper: custom } : guidance;
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

function phaseHasRun(step, item = selectedItem()) {
    return item?.phases?.[step.instanceKey]?.hasRun === true;
}

function phasePresentation(step, item = selectedItem()) {
    const phase = item?.phases?.[step.instanceKey];
    const run = phaseHasRun(step, item)
        ? { className: "phase-run", label: "Run requested; completion not verified", symbol: "✓", notice: "" }
        : { className: "", label: "Not run", symbol: "", notice: "" };
    if (state.snapshot?.clarificationTag !== false && phase?.clarificationCount > 0) {
        return { className: "needs-clarification", label: "Clarification needed", symbol: "!", notice: "Clarification needed" };
    }
    const review = phase?.review;
    const config = state.snapshot?.artifactReview;
    const artifactError = phase?.artifactError || (state.snapshot?.clarificationTag !== false && phase?.artifact
        && (!Number.isInteger(phase.clarificationCount) || phase.clarificationCount < 0) ? "Artifact status unavailable" : "");
    const index = config?.labels.findIndex((_label, index) => review?.statusId === `result-${index + 1}`) ?? -1;
    const statusId = review?.state === "reviewed" && !review.error && index >= 0 ? review.statusId : null;
    const notice = config
        ? statusId ? config.labels[index] : artifactError ? "Artifact unavailable" : ""
        : "";
    return { ...run,
        notice, statusId,
        error: artifactError };
}

function latestPhaseResult(item) {
    const step = workflowSteps().find((step) => step.instanceKey === item.latestPhase);
    return step ? phasePresentation(step, item) : { notice: "" };
}

function workflowStatus(item) {
    const steps = workflowSteps();
    const final = steps.at(-1);
    if (!final) return { notice: "" };
    if (!state.snapshot?.artifactReview) {
        const phases = steps.map((step) => phasePresentation(step, item));
        return { notice: phases.some((phase) => phase.notice === "Clarification needed") ? "Clarification needed" : "",
            error: phases.filter((phase) => phase.error).map((phase) => phase.error).join(" ") };
    }
    const clarification = steps.map((step) => phasePresentation(step, item))
        .find((phase) => phase.notice === "Clarification needed");
    if (clarification) return clarification;
    if (item.latestPhase) return latestPhaseResult(item);
    const next = steps.find((step) => !phaseHasRun(step, item));
    return { notice: next ? `Run ${next.label}` : "" };
}

function phaseNotice(text, detail = "") {
    return text ? `<span class="phase-notice"${detail ? ` title="${esc(detail)}" aria-label="${esc(`${text}: ${detail}`)}"` : ""}>${esc(text)}</span>` : "";
}

function phaseFeedback(presentation) {
    return phaseNotice(presentation.notice, presentation.error)
        + (presentation.error ? `<span class="workflow-error" role="status">${esc(presentation.error)}</span>` : "");
}

function renderPhaseNavigation() {
    const steps = workflowSteps();
    const navigation = $("phase-navigation");
    const progression = category("canvas-interactions")?.progression;
    if (!steps.length) {
        navigation.innerHTML = "";
        return;
    }
    navigation.innerHTML = `<ol class="stepper" aria-label="Workflow phases">${steps.map((step, index) => {
        const presentation = phasePresentation(step);
        const concealed = progression?.showFuturePhases === false && index > state.current
            || progression?.collapseCompletedPhases === true && index < state.current && phaseHasRun(step);
        return `
        ${index > 0 && !concealed ? '<li class="step-sep" aria-hidden="true"></li>' : ""}
        <li ${concealed ? "hidden" : ""}><button class="step ${presentation.className} ${index === state.current ? "active" : ""}" type="button" data-phase-index="${index}" ${index === state.current ? 'aria-current="step"' : ""} title="${esc(presentation.label)}" aria-label="Phase ${index + 1} of ${steps.length}: ${esc(step.label)} — ${esc(presentation.label)}">
            <span class="step-order" aria-hidden="true">${presentation.symbol || index + 1}</span>
            <span class="step-label"><span class="step-name">${esc(step.label)}</span></span>
        </button></li>`;
    }).join("")}</ol>`;
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
    container.innerHTML = `<div>${item.isNew ? "" : '<span class="muted">Current selection</span>'}<h2>${esc(item.isNew ? contentCopy("new", "New") : item.label)}</h2></div>`;
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
    const submitted = phaseHasRun(step, item);
    const inputGuidance = phaseInputGuidance(step);
    const outputPath = resolvedOutputPath(step, item);
    const outputUnresolved = !outputPath || outputPath.includes("<slug>");
    const showsSlug = state.current === slugPhaseIndex(steps);
    const slugLocked = !item?.isNew || running || submitted;
    const slugValue = item?.slug || state.workflowSlugDraft.trim();
    const onboarding = category("canvas-onboarding");
    const slugControl = showsSlug
        ? `<label class="field" for="workflow-slug"><span class="field-label" id="workflow-slug-label">${esc(onboarding?.workflowSlug?.label ?? "Workflow slug")}${slugLocked ? "" : ' <span class="muted">(optional)</span>'}</span><span class="muted" id="workflow-slug-help">${esc(onboarding?.workflowSlug?.helperText ?? `Names the folder where this workflow’s artifacts are saved.${slugLocked ? "" : " Leave blank to let Spec Kit choose a name."}`)}</span><input class="phase-input-control" id="workflow-slug" type="text" aria-labelledby="workflow-slug-label" aria-describedby="workflow-slug-help" value="${esc(slugLocked ? slugValue : state.workflowSlugDraft)}" placeholder="${slugLocked ? "Automatically assigned" : "your-slug"}" ${slugLocked ? "readonly" : ""} /></label>`
        : "";
    const backDisabled = state.current === 0;
    const continueDisabled = state.current >= steps.length - 1;
    $("phase-card").innerHTML = `
        <header class="workflow-header">
            <div class="workflow-header-main"><div class="phase-heading"><h2>${esc(step.label)}</h2>${phaseFeedback(phasePresentation(step))}</div>${category("canvas-layout")?.phases?.showDescriptions === false ? "" : `<p class="tagline">${esc(step.description)}</p>`}</div>
        </header>
        ${onboarding?.firstRunCopy && !submitted ? `<p class="tagline">${esc(onboarding.firstRunCopy)}</p>` : ""}
        <dl class="phase-facts" ${category("canvas-layout")?.artifacts?.showMetadata === false ? "hidden" : ""}>
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
                <button class="btn btn-primary" id="run-phase" type="button" ${running || constitutionBlocked() || (submitted && category("canvas-interactions")?.rerun?.enabled === false) ? "disabled" : ""} ${constitutionBlocked() ? 'aria-describedby="constitution-prerequisite" title="Define the project Constitution before running workflow phases."' : ""}>${running ? '<span class="btn-spinner" aria-hidden="true"></span> Sending…' : (submitted ? "Run again" : "Run phase")}</button>
                <button class="btn btn-secondary" id="view-artifact" type="button">${esc(contentCopy("viewArtifact", "View artifact"))}</button>
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
    $("run-phase")?.addEventListener("click", () => runPhase(step));
    $("view-artifact")?.addEventListener("click", () => openArtifact(resolvedOutputPath(step, item), step, item));
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

async function runPhase(step) {
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
    const interactions = category("canvas-interactions");
    if (phaseHasRun(step, item) && interactions?.rerun?.enabled === false) return;
    const confirmation = interactions?.phaseRunConfirmations?.[step.commandName];
    if (confirmation && !await confirmRerun(step, false, confirmation)) return;
    if (!confirmation && phaseHasRun(step, item) && !await confirmRerun(step)) return;
    const args = $("phase-args")?.value ?? "";
    state.phaseDrafts.set(runKey, args);
    const slug = usesSlugDraft ? validation.slug : null;
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
        if (interactions?.inputs?.retainAfterRun === false) state.phaseDrafts.delete(runKey);
        const followItem = phaseRunKey(step) === runKey ? result.itemId : null;
        if (state.runningPhase === runKey) state.runningPhase = null;
        await refresh(followItem);
        if (result.queued && phaseRunKey(step) === runKey) {
            $("phase-message").textContent = "Queued until setup is ready. This phase has not been sent yet.";
        }
        if (interactions?.inputs?.retainAfterRun === false && $("phase-args")) $("phase-args").value = "";
    } catch (error) {
        state.runningPhase = null;
        renderPhaseCard();
        $("phase-message").innerHTML = `<div class="workflow-error">${esc(error.message)}</div>`;
    }
}

function confirmRerun(step, projectScoped = false, message = null) {
    return new Promise((resolve) => {
        const root = $("modal-root");
        root.innerHTML = `<div class="wizard-modal-backdrop"><section class="wizard-modal" role="dialog" aria-modal="true" aria-labelledby="rerun-title">
            <header class="wizard-modal-head"><h3 id="rerun-title">Run ${esc(step.label)}${message ? "" : " again"}?</h3></header>
            <div class="wizard-modal-body"><p>${esc(message ?? (projectScoped ? "Existing project Constitution content may be replaced." : "Existing output may be replaced and completed downstream phases will be marked stale."))}</p></div>
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

async function revealOutputFolder(event, messageId = "phase-message") {
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
        $(messageId).innerHTML = `<div class="workflow-error">${esc(error.message)}</div>`;
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
        context, marks: [], content: null, message: "",
    };
    state.artifactView = view;
    $("artifact-viewer").innerHTML = `<div class="artifact-viewer-header"><button class="btn btn-ghost btn-sm artifact-viewer-back" id="close-artifact" type="button">← Workflow</button><div class="artifact-viewer-title"><h2>${esc(step.label)}</h2><code class="muted">${esc(path)}</code></div></div><div class="artifact-viewer-clarify-banner" id="clarification-banner" hidden></div><div class="artifact-viewer-body"><p class="muted">Loading…</p></div>`;
    $("artifact-viewer").hidden = false;
    $("close-artifact").addEventListener("click", () => {
        state.artifactView = null;
        $("artifact-viewer").hidden = true;
    });
    if (!path || path.includes("<slug>")) {
        $("artifact-viewer").querySelector(".artifact-viewer-body").innerHTML = `<p class="muted">${path
            ? "No artifact is available yet. Run the phase or select an existing workflow to view its artifact."
            : "This phase has no declared artifact to view."}</p>`;
        return;
    }
    await refreshArtifact(view);
    pollAmendment(view);
}

function renderArtifactContent(view, content) {
    if (state.artifactView !== view || view.content === content) return;
    const body = $("artifact-viewer").querySelector(".artifact-viewer-body");
    const scroll = body.scrollTop;
    view.content = content;
    view.marks = [];
    body.innerHTML = `<div class="artifact-viewer-md">${renderMarkdown(content, { clarifications: view.marks })}</div>`;
    body.scrollTop = scroll;
    $("artifact-viewer").querySelectorAll("[data-clarify-idx]").forEach((button) => {
        button.addEventListener("click", () => openClarification(view, view.marks[Number(button.dataset.clarifyIdx)], button));
    });
    refreshClarifications(view);
}

async function refreshArtifact(view) {
    if (!view.context.artifact || view.context.artifact.includes("<slug>")) return;
    if (view.reading) return view.reading;
    const token = clarifications.observationToken(view.context);
    view.reading = (async () => {
        try {
            const result = await json(`/api/artifact?path=${encodeURIComponent(view.context.artifact)}`);
            const observed = clarifications.observe(view.context, result.content, token);
            if (observed) view.message = observationMessage(observed);
            if (state.artifactView === view) {
                if (result.content.trim() || view.content === null) renderArtifactContent(view, result.content);
                refreshClarifications(view);
            }
        } catch (error) {
            if (state.artifactView === view) {
                if (view.content === null) {
                    $("artifact-viewer").querySelector(".artifact-viewer-body").innerHTML = `<p class="workflow-error" role="status">Could not load the artifact. It may not have been created yet. Run the phase or check its output path.</p><p class="muted">${esc(error.message)}</p>`;
                } else {
                    refreshClarifications(view, "Could not refresh the artifact. Answers retained; automatic refresh will retry.");
                }
            }
        } finally { view.reading = null; }
    })();
    return view.reading;
}

function pollAmendment(view) {
    const key = clarificationKey(view.context);
    if (state.artifactView && clarificationKey(state.artifactView.context) === key) view = state.artifactView;
    clearTimeout(state.amendmentPolls.get(key));
    state.amendmentPolls.delete(key);
    if (!clarifications.isPending(view.context)) return;
    const timer = setTimeout(async () => {
        state.amendmentPolls.delete(key);
        const currentView = state.artifactView;
        await refreshArtifact(currentView && clarificationKey(currentView.context) === clarificationKey(view.context) ? currentView : view);
        pollAmendment(view);
    }, 2000);
    timer.unref?.();
    state.amendmentPolls.set(key, timer);
}

function refreshClarifications(view, message = view.message) {
    if (state.artifactView !== view) return;
    view.message = message;
    refreshDraftControls($("artifact-viewer"), view, clarifications, {
        apply: () => applyClarifications(view),
    });
}

function openClarification(view, { question, marker }, trigger) {
    const root = $("modal-root");
    root.innerHTML = `<div class="wizard-modal-backdrop"><section class="wizard-modal constitution-dialog" role="dialog" aria-modal="true" aria-labelledby="clarification-title">
        <header class="wizard-modal-head"><h3 id="clarification-title">Resolve clarification</h3></header>
        <div class="wizard-modal-body"><p id="clarification-question">${esc(question)}</p>
        <label class="field" for="clarification-answer"><span class="field-label">Answer</span><textarea class="phase-input-control" id="clarification-answer" aria-describedby="clarification-question"></textarea></label><p class="muted">Save a draft, then choose Apply answers to amend this artifact without rerunning the phase.</p></div>
        <footer class="wizard-modal-foot"><button class="btn btn-secondary" id="cancel-clarification" type="button">Cancel</button><button class="btn btn-primary" id="queue-clarification" type="button">Save draft</button></footer>
        </section></div>`;
    const input = $("clarification-answer");
    const queue = $("queue-clarification");
    input.value = clarifications.list(view.context).find((entry) => entry.marker === marker)?.answer ?? "";
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
        clarifications.queue(view.context, question, input.value.trim(), marker);
        close();
        refreshClarifications(view, "");
    });
}

async function applyClarifications(view) {
    if (clarifications.isSending(view.context)) return;
    try {
        const submission = clarifications.flush(view.context, {
            content: view.content,
            markers: selectedDrafts(view, clarifications).map((entry) => entry.marker),
            dispatch: (input) => json("/api/artifact/amend", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify(input),
            }),
        });
        refreshClarifications(view);
        const outcome = await submission;
        view = currentArtifactView(view);
        if (!outcome.accepted) {
            if (outcome.result?.approvalRequired || outcome.result?.code === "setup_required") await refresh();
            if (outcome.result?.code === "stale_markers") await refreshArtifact(view);
            refreshClarifications(view, `${outcome.result?.error || "Could not submit the amendment."} Your queued answers were preserved.`);
            return;
        }
        refreshClarifications(view, "Submitted; waiting for an artifact update. Drafts remain editable.");
        const currentView = state.artifactView;
        await refreshArtifact(currentView && clarificationKey(currentView.context) === clarificationKey(view.context) ? currentView : view);
        pollAmendment(view);
    } catch (error) {
        view = currentArtifactView(view);
        refreshClarifications(view, `${error.message} Your queued answers were preserved.`);
    }
}

function currentArtifactView(view) {
    return state.artifactView && clarificationKey(state.artifactView.context) === clarificationKey(view.context)
        ? state.artifactView : view;
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
    $("current-workflow").hidden = constitutionOnly;
    for (const id of ["phase-navigation", "phase-card"]) $(id).hidden = constitutionOnly;
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
            ? `<h2>Installation needs attention</h2><p role="alert">${esc(setup.message)}</p>${category("canvas-onboarding")?.recoveryCopy ? `<p>${esc(category("canvas-onboarding").recoveryCopy)}</p>` : ""}<button class="btn btn-secondary" id="approval-retry" type="button">Retry setup</button>`
            : `<h2>Installing required components</h2><p role="status">${esc(category("canvas-onboarding")?.readinessCopy ?? "Waiting for setup verification and current-session skills to be ready.")}</p>`;
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
        ${installationDisclosure(approval.components, approval.copy)}
        <div class="installation-actions"><button class="btn btn-primary" id="approval-accept" type="button">Approve and install</button><button class="btn btn-secondary" id="approval-defer" type="button">Not now</button></div>`;
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

async function refresh(preferredItemId = null) {
    const phaseDraft = $("phase-args")?.value;
    const previousItem = selectedItem();
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
    if (preferredItemId && state.snapshot.items?.some((item) => item.id === preferredItemId)) {
        state.selectedItemId = preferredItemId;
    }
    if (previousItem?.isNew && selectedItem() && !selectedItem().isNew) {
        for (const step of workflowSteps()) {
            const previousKey = phaseRunKey(step, previousItem);
            const nextKey = phaseRunKey(step);
            if (state.phaseDrafts.has(previousKey)) state.phaseDrafts.set(nextKey, state.phaseDrafts.get(previousKey));
            if (state.lastSubmitted.has(previousKey)) state.lastSubmitted.set(nextKey, state.lastSubmitted.get(previousKey));
        }
    }
    const setup = $("setup-message");
    const initialization = state.snapshot.setup?.initialization;
    const awaitingInit = initialization?.required && !initialization.approved;
    const failed = !awaitingInit && !state.snapshot.setup?.approval?.required
        && state.snapshot.setup?.ready === false && state.snapshot.setup?.state === "failed";
    setup.hidden = !awaitingInit && !failed;
    if (awaitingInit) {
        setup.innerHTML = `<h2>Initialize this destination?</h2><p>${esc(initialization.message)}</p>
            <p>Nothing will be initialized unless you confirm this project.</p>
            <button class="btn btn-primary" id="confirm-init" type="button">Confirm initialization</button>
            <button class="btn btn-secondary" id="defer-init" type="button">Not now</button>`;
        for (const [id, action] of [["confirm-init", "accept"], ["defer-init", "defer"]]) {
            $(id).addEventListener("click", async () => {
                for (const button of setup.querySelectorAll("button")) button.disabled = true;
                try {
                    const result = await json("/api/init-confirmation", {
                        method: "POST", headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ action, challenge: initialization.challenge }),
                    });
                    state.snapshot.setup = result.setup;
                    await refresh();
                } catch (error) {
                    setup.insertAdjacentHTML("beforeend", `<p role="alert">${esc(error.message)}</p>`);
                    for (const button of setup.querySelectorAll("button")) button.disabled = false;
                }
            });
        }
    } else if (failed) {
        setup.innerHTML = `${esc(state.snapshot.setup?.message ?? "Workflow setup failed.")}${category("canvas-onboarding")?.recoveryCopy ? `<p>${esc(category("canvas-onboarding").recoveryCopy)}</p>` : ""} <button class="btn btn-secondary" id="retry-setup" type="button">Retry setup</button>`;
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
    if (state.artifactView) await refreshArtifact(state.artifactView);
}

$("theme-toggle").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("speckit-workflow-theme", next);
});
const savedTheme = localStorage.getItem("speckit-workflow-theme");
if (savedTheme) document.documentElement.dataset.theme = savedTheme;

{
    const theme = category("canvas-theme");
    if (theme) {
        const root = document.documentElement;
        const colors = {
            accent: "--accent-color", positive: "--success-color",
            attention: "--warn-color", critical: "--danger-color",
        };
        for (const [name, variable] of Object.entries(colors)) {
            if (theme.colors?.[name]) root.style.setProperty(variable, theme.colors[name]);
        }
        if (theme.colors?.accent) root.style.setProperty("--grad-primary", theme.colors.accent);
        if (theme.typography === "serif") root.style.setProperty("--font-sans", 'Georgia, "Times New Roman", serif');
        if (theme.typography === "sans") root.style.setProperty("--font-sans", '"Segoe UI Variable", "Segoe UI", Arial, sans-serif');
        if (theme.density === "compact") document.body.classList.add("canvas-compact");
        if (theme.shape === "square") root.style.setProperty("--radius-md", "0");
        if (theme.shape === "square") root.style.setProperty("--radius-sm", "0");
        if (theme.brand?.logo?.mode === "none") $("brand-mark").hidden = true;
        if (theme.brand?.logo?.mode === "asset") {
            const mark = $("brand-mark");
            mark.textContent = "";
            const image = document.createElement("img");
            image.src = "/theme/logo";
            image.alt = "";
            image.addEventListener("error", () => {
                $("setup-message").hidden = false;
                $("setup-message").textContent = "The canvas logo could not be loaded.";
            });
            mark.append(image);
        }
    }
}

const events = new EventSource("/api/events");
events.onopen = () => { $("connection").className = "conn conn-live"; $("connection").textContent = "live"; };
events.onerror = () => { $("connection").className = "conn conn-lost"; $("connection").textContent = "reconnecting…"; };
events.onmessage = () => refresh().catch((error) => {
    $("setup-message").hidden = false;
    $("setup-message").textContent = error.message;
});
refresh().catch((error) => {
    $("phase-card").innerHTML = `<div class="workflow-error">${esc(error.message)}</div>`;
});
