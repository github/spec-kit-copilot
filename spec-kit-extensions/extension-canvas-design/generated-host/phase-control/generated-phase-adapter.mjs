const escapeHtml = (value) => String(value).replace(/[&<>"']/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

export const controlId = "workflow-phases";
export const contractVersion = 1;
export const capabilities = ["workflow.badges.v1", "workflow.badges.targets.v1"];

function readableBadgeForeground(hex) {
    const rgb = [1, 3, 5].map((index) => {
        const channel = parseInt(hex.slice(index, index + 2), 16) / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    const luminance = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    return (luminance + 0.05) / (0.005605 + 0.05) >= 1.05 / (luminance + 0.05)
        ? "#111" : "#fff";
}

function badgeMarkup(badges) {
    return badges.map((badge) => `<span class="canvas-badge" data-color="${escapeHtml(badge.color)}" ${
        /^#[0-9a-fA-F]{6}$/.test(badge.color)
            ? `style="background-color:${badge.color};color:${readableBadgeForeground(badge.color)}"` : ""
    }>${escapeHtml(badge.phaseText ?? badge.text)}</span>`).join("");
}

export function badgesForTarget(badges, phase, output = null) {
    return badges.filter((badge) => badge.targets
        ? badge.targets.some((target) => target.phase === phase && target.output === output)
        : output === null && (!badge.phase || badge.phase === phase));
}

function card(phase, slots) {
    const legacyDescriptions = {
        constitution: "Establish the project's guiding principles.",
        specify: "Describe what to build and why.",
        clarify: "Resolve unanswered questions in the spec.",
        plan: "Choose the tech stack and approach.",
        tasks: "Break the plan into actionable work items.",
        analyze: "Check the spec, plan, and tasks for consistency.",
        implement: "Execute the tasks to build the feature.",
    };
    const description = phase.description
        ?? legacyDescriptions[phase.id.replace(/^speckit\./, "")];
    return `<header class="workflow-header">
        <div class="workflow-header-main"><div class="phase-heading"><h2>${escapeHtml(phase.label)}</h2><span class="phase-notice">Not run</span></div>
        ${slots.has("phase.card") ? '<div id="phase-badges" data-phase-badge-slot="phase.card" class="canvas-badges" aria-label="Phase badges"></div>' : ""}
        ${description ? `<p class="tagline">${escapeHtml(description)}</p>` : ""}</div>
    </header>
    <dl class="phase-facts"><dt>Output(s)</dt><dd><span id="phase-output-default" class="phase-output-label">DEFAULT:</span> <button class="phase-artifact-link" id="browse-output-folder" type="button" title="Open the viewer target's folder"><code></code></button>${slots.has("phase.output") ? '<span id="phase-view-badges" data-phase-badge-slot="phase.output" class="canvas-badges"></span>' : ""}<span id="phase-output-prompt" class="muted" hidden>Choose an artifact folder name to preview the output path.</span><button id="phase-output-toggle" class="phase-output-toggle" type="button" aria-controls="phase-other-outputs" aria-expanded="false" hidden></button><div id="phase-other-outputs" class="phase-output-list" aria-label="Additional phase outputs" hidden></div></dd></dl>
    <p id="phase-artifact-status" class="muted" role="status"></p>
    <label class="field" for="phase-args">
        <span class="field-label" id="phase-input-label">Phase input</span>
        <span class="visually-hidden" id="phase-input-help">Add details or direction for this phase.</span>
        <textarea class="phase-input-control" id="phase-args" aria-labelledby="phase-input-label" aria-describedby="phase-input-help" placeholder="Add details or direction for this phase."></textarea>
    </label>
    <div id="phase-message" class="muted" role="status"></div>
    <p id="phase-action-error" class="workflow-error" role="alert" hidden></p>
    <footer class="phase-actions phase-actions-nav">
        <div class="phase-actions-left"><button class="btn btn-secondary" id="previous-phase" type="button">&#9664; Back</button></div>
        <div class="phase-actions-center">
            <button class="btn btn-primary" id="run-phase" type="button" aria-describedby="phase-message">Run phase</button>
            <button class="btn btn-secondary" id="view-artifact" type="button" aria-describedby="phase-artifact-status" hidden>View output</button>
        </div>
        <div class="phase-actions-right"><button class="btn btn-secondary" id="next-phase" type="button">Continue &#9654;</button></div>
    </footer>`;
}

export function mount({ root, definition, state, actions }) {
    if (!root || typeof root.replaceChildren !== "function" || !actions
        || definition?.id !== controlId || !definition.viewLabels
        || typeof definition.viewLabels !== "object" || Array.isArray(definition.viewLabels)
        || ["select", "draft", "run", "view", "reveal", "error"].some((key) =>
            typeof actions[key] !== "function")) throw new Error("Invalid phase control context");
    const listeners = new AbortController();
    let currentState;
    let previousKey;
    let outputsExpanded = false;
    let additionalCount = 0;
    const $ = (selector) => root.querySelector(selector);
    function update(next) {
        if (!next || !Array.isArray(next.phases) || !Number.isInteger(next.current)
            || next.current < -1 || next.current >= next.phases.length
            || typeof next.draft !== "string" || !Array.isArray(next.outputLinks)
            || (next.badgeSlots !== undefined && (!Array.isArray(next.badgeSlots)
                || next.badgeSlots.some((slot) => !["phase.card", "phase.output"].includes(slot?.id))))
            || (next.badgeModels !== undefined && !Array.isArray(next.badgeModels))) {
            throw new Error("Invalid phase control state");
        }
        const badgeSlots = new Set((next.badgeSlots ?? []).map((slot) => slot.id));
        const key = JSON.stringify([next.workflow, next.current, [...badgeSlots].sort()]);
        const changed = !currentState || previousKey !== key
            || currentState.phases.length !== next.phases.length;
        if (changed) outputsExpanded = false;
        currentState = next;
        previousKey = key;
        if (changed) {
            root.innerHTML = `<nav id="phase-navigation" class="phase-navigation" aria-label="Workflow phases">
                ${next.phases.length ? `<div class="phase-mobile-nav"><label class="visually-hidden" for="mobile-phase-select">Jump to phase</label><select id="mobile-phase-select" class="phase-input-control">${next.phases.map((phase, index) =>
                    `<option value="${index}">Phase ${index + 1} of ${next.phases.length}: ${escapeHtml(phase.label)}</option>`).join("")}</select><span id="mobile-next-phase" class="muted"></span></div>` : ""}
                ${next.phases.length ? `<ol class="stepper">${next.phases.map((phase, index) => `
                    ${index > 0 ? '<li class="step-sep" aria-hidden="true"></li>' : ""}
                    <li><button class="step" type="button" data-phase-index="${index}" data-phase-label="${escapeHtml(phase.label)}" aria-label="Phase ${index + 1} of ${next.phases.length}: ${escapeHtml(phase.label)}">
                        <span class="step-order" aria-hidden="true">${index + 1}</span>
                        <span class="step-label"><span class="step-name">${escapeHtml(phase.label)}</span></span>
                    </button></li>`).join("")}</ol>` : ""}</nav>
                <section id="phase-card" class="phase-card" aria-label="Selected phase">${next.current >= 0
                    ? card(next.phases[next.current], badgeSlots) : '<div class="workflow-empty">No workflow phases are configured.</div>'}</section>`;
        }
        if (next.current < 0) return;
        const phase = next.phases[next.current];
        const status = next.status;
        const steps = [...root.querySelectorAll("[data-phase-index]")];
        for (const [index, button] of steps.entries()) {
            button.classList.toggle("active", index === next.current);
            if (index === next.current) button.setAttribute("aria-current", "step");
            else button.removeAttribute("aria-current");
        }
        const mobile = $("#mobile-phase-select");
        if (mobile) {
            mobile.value = String(next.current);
            $("#mobile-next-phase").textContent = next.current + 1 < steps.length
                ? `Next: ${next.phases[next.current + 1].label}` : "Final phase";
        }
        const back = $("#previous-phase"), forward = $("#next-phase");
        back.disabled = next.current === 0;
        forward.disabled = next.current === steps.length - 1;
        back.textContent = next.current ? `◀ ${next.phases[next.current - 1].label}` : "◀ Back";
        forward.textContent = next.current + 1 < steps.length
            ? `Next: ${next.phases[next.current + 1].label} ▶` : "Complete";
        const input = $("#phase-args");
        if (changed || document.activeElement !== input) input.value = next.draft;
        input.readOnly = Boolean(next.setupPending);
        const phaseNotice = $(".phase-notice");
        phaseNotice.textContent = status?.status === "Completed" ? "" : status?.status ?? "Not run";
        phaseNotice.hidden = status?.status === "Completed";
        if (badgeSlots.has("phase.card")) {
            $("#phase-badges").innerHTML = badgeMarkup(badgesForTarget(next.badgeModels ?? [], phase.id));
        }
        const output = next.output ?? "No file output";
        const browse = $("#browse-output-folder");
        browse.querySelector("code").textContent = output;
        const needsSlug = next.workflow === "__new__" && next.output?.includes("<slug>");
        $("#phase-output-default").hidden = !next.output || needsSlug;
        $("#phase-output-prompt").hidden = !needsSlug;
        $("#phase-output-prompt").textContent = next.slugEditable
            ? "Choose an artifact folder name to preview the output path."
            : "Run the phase to resolve the output path.";
        browse.hidden = needsSlug;
        if (badgeSlots.has("phase.output")) {
            const viewBadges = $("#phase-view-badges");
            viewBadges.innerHTML = badgeMarkup(!needsSlug && phase.output
                ? badgesForTarget(next.badgeModels ?? [], phase.id, phase.output) : []);
            viewBadges.hidden = needsSlug;
        }
        const unresolved = Boolean(next.output?.includes("<slug>"));
        browse.disabled = unresolved;
        browse.title = unresolved
            ? (next.slugEditable ? "Enter an artifact folder name (slug) to resolve this path"
                : "Run the phase to resolve this path")
            : next.output ? `Open ${output.slice(0, output.lastIndexOf("/")) || "."} in file explorer`
                : "Open the project folder in file explorer";
        const artifact = $("#phase-artifact-status");
        const available = next.output === status?.output && status?.artifactAvailability === "available";
        $("#view-artifact").hidden = next.workflow === "__new__";
        $("#view-artifact").textContent = Object.hasOwn(definition.viewLabels, phase.id)
            ? definition.viewLabels[phase.id] : "View output";
        artifact.textContent = next.workflow === "__new__" || available ? "" : (status?.artifactError
            ?? (next.output ? `${next.output} is not available yet. Run the phase, then refresh to check again.`
                : "No artifact is available for this phase yet. Run the phase, then refresh to check again."));
        artifact.hidden = !artifact.textContent;
        const others = $("#phase-other-outputs");
        others.replaceChildren();
        const additional = needsSlug ? [] : next.outputLinks.filter(({ template, label }) =>
            template !== phase.output && label !== next.output);
        additionalCount = additional.length;
        for (const output of additional) {
            const row = document.createElement("div");
            row.className = "phase-output-row";
            const button = document.createElement("button");
            button.type = "button";
            button.className = "phase-artifact-link";
            button.dataset.output = output.template;
            const path = document.createElement("code");
            path.textContent = output.label;
            button.append(path);
            row.append(button);
            const badges = badgeSlots.has("phase.output")
                ? badgesForTarget(next.badgeModels ?? [], phase.id, output.template) : [];
            if (badges.length) {
                const marks = document.createElement("span");
                marks.className = "canvas-badges";
                marks.dataset.phaseBadgeSlot = "phase.output";
                marks.innerHTML = badgeMarkup(badges);
                row.append(marks);
            }
            others.append(row);
        }
        const toggle = $("#phase-output-toggle");
        toggle.hidden = !additional.length;
        toggle.textContent = outputsExpanded ? "− hide outputs" : `▸ +${additional.length} more`;
        toggle.setAttribute("aria-expanded", String(outputsExpanded));
        others.hidden = !additional.length || !outputsExpanded;
        $("#run-phase").textContent = next.runLabel
            ?? (status?.status && status.status !== "Not run" ? "Run again" : "Run phase");
        $("#run-phase").disabled = Boolean(next.blocked);
        $("#run-phase").title = next.blocked ?? "";
        const notice = $("#phase-message");
        notice.textContent = [status?.error, next.setupPending ? "Available after setup" : ""]
            .filter(Boolean).join(" — ");
        notice.classList.toggle("workflow-error", Boolean(status?.error));
    }
    root.addEventListener("click", (event) => {
        const button = event.target.closest("button");
        if (!button || !root.contains(button)) return;
        const index = Number(button.dataset.phaseIndex);
        const destination = button.hasAttribute("data-phase-index") ? index
            : button.id === "previous-phase" ? currentState.current - 1
                : button.id === "next-phase" ? currentState.current + 1 : null;
        let action;
        try {
            if (destination !== null) {
                action = Promise.resolve(actions.select(destination)).then(() => {
                    if (button.id === "previous-phase" || button.id === "next-phase") {
                        root.querySelector(`#${button.id}`)?.focus({ preventScroll: true });
                    }
                });
            } else if (button.id === "run-phase") {
                const input = $("#phase-args").value;
                const phase = currentState.phases[currentState.current];
                const workflow = currentState.workflow;
                const index = currentState.current;
                action = typeof actions.confirmRun === "function"
                    ? Promise.resolve(actions.confirmRun(phase)).then((confirmed) => {
                        if (confirmed !== true) return;
                        if (currentState.workflow !== workflow || currentState.current !== index
                            || currentState.phases[index]?.id !== phase.id) {
                            throw new Error("Selected workflow or phase changed. Select the phase and retry.");
                        }
                        return actions.run(input);
                    })
                    : actions.run(input);
            }
            else if (button.id === "view-artifact") action = actions.view();
            else if (button.id === "phase-output-toggle") {
                outputsExpanded = !outputsExpanded;
                button.textContent = outputsExpanded ? "− hide outputs" : `▸ +${additionalCount} more`;
                button.setAttribute("aria-expanded", String(outputsExpanded));
                $("#phase-other-outputs").hidden = !outputsExpanded;
            }
            else if (button.hasAttribute("data-output")) action = actions.view(button.dataset.output);
            else if (button.id === "browse-output-folder") action = actions.reveal();
            if (action) Promise.resolve(action).catch(actions.error);
        } catch (error) { actions.error(error); }
    }, { signal: listeners.signal });
    root.addEventListener("change", (event) => {
        if (event.target.id === "mobile-phase-select") {
            Promise.resolve(actions.select(Number(event.target.value))).then(() =>
                $("#mobile-phase-select")?.focus({ preventScroll: true }))
                .catch((error) => { event.target.value = String(currentState.current); actions.error(error); });
        }
    }, { signal: listeners.signal });
    root.addEventListener("input", (event) => {
        if (event.target.id === "phase-args") actions.draft(event.target.value);
    }, { signal: listeners.signal });
    update(state);
    return { update, dispose: () => listeners.abort() };
}
