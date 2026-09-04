// Consolidated phase-card renderer + Environment card + stepper.

import { escapeHtml, dispatchKind } from "./client.js";
import {
    state,
    PHASE_ORDER,
    commands,
    displayCommand,
    bareCommandId,
    parentDirOf,
} from "./state.js";
import {
    canonicalLabel,
    canonicalSpine,
    isCanonical,
    isCanonicalOptional,
} from "../pipeline/canonical.mjs";
import {
    resolvePipelineEntry,
    pipelineIsEdited,
    pipelineItems,
    dispatchPipeline,
    hooksForCommand,
    resolveExtensionArtifact,
    renderMoreCommandsPanel,
    getPhaseDraft,
    setPhaseDraft,
    getPhaseLastSubmitted,
    setPhaseLastSubmitted,
    getPendingClarifications,
    queueClarification,
    clearClarifications,
    markPhaseRunning,
    isPhaseRunning,
} from "./phase-runtime.js";
import { isSetupComplete, renderSetupBody, collectSetupValues, runInit, runReload, installCatalogPreset, performEnvProbe } from "./setup.js";
import { wireInfoPopover } from "./composition.js";
import { renderPhaseCustomizations } from "./phase-contributors.js";
import { popoverConfirm } from "./modals.js";

// -------- Section: render/env.js --------

let __envPostJson = async () => { throw new Error("env: postJson not injected"); };

export function setEnvDeps({ postJson } = {}) {
    if (postJson) __envPostJson = postJson;
}

// Wire the setup rows on the Environment card. Handles the "reveal" links
// (open in file explorer), the setup-action buttons (init / reload /
// reinstall-defaults), and the info popover for the reload row.
function wireEnvironmentCard(el) {
    el.querySelectorAll("a[data-reveal-sub]").forEach((a) => {
        a.addEventListener("click", async (ev) => {
            ev.preventDefault();
            const sub = a.dataset.revealSub ?? "";
            try {
                await __envPostJson("/api/reveal", { sub });
            } catch (_err) { /* ignore */ }
        });
    });
    el.querySelectorAll("button[data-setup-action]").forEach((btn) => {
        btn.addEventListener("click", async () => {
            const action = btn.dataset.setupAction;
            if (action === "init") {
                const values = collectSetupValues();
                await runInit(values);
            } else if (action === "reload") {
                await runReload();
            } else if (action === "probe-env") {
                await performEnvProbe(btn.dataset.probeSource);
            } else if (action === "reinstall-defaults") {
                installCatalogPreset({
                    presetId: "copilot-sub-agents",
                    name: "copilot-sub-agents",
                    downloadUrl: "https://github.com/github/spec-kit-copilot/releases/download/copilot-sub-agents-v1.0.0/copilot-sub-agents.zip",
                });
            }
        });
    });
    wireInfoPopover("reload-skills-info-btn", "reload-skills-info-popover");
}

export function renderEnvironmentCard() {
    const el = document.getElementById("environment-card");
    if (!el || !state.snapshot) return;
    const p = state.snapshot.phases?.setup ?? {
        id: "setup",
        name: "Environment",
        tagline: "Get this project ready for Spec-Driven Development.",
        status: "pending",
        special: "setup",
    };
    el.innerHTML = `
        <header>
            <h2>Environment</h2>
            <p class="tagline">${escapeHtml(p.tagline || "Get this project ready for Spec-Driven Development.")}</p>
        </header>
        ${renderSetupBody(p)}
    `;
    wireEnvironmentCard(el);
}


// -------- Section: render/stepper.js --------

let __stepperRenderPhaseCard = () => {};

export function setStepperDeps({ renderPhaseCard }) {
    if (typeof renderPhaseCard === "function") __stepperRenderPhaseCard = renderPhaseCard;
}

export function renderStepper() {
    const el = document.getElementById("stepper");
    if (!el || !state.snapshot) return;
    el.innerHTML = "";
    const gp = commands();
    const items = pipelineItems();
    const edited = pipelineIsEdited();
    const lookup = new Map(commands().map((p) => [p.id, p]));

    let visible;
    if (items.length) {
        // Iterate pipeline (user or inferred) so numbering + × removal match
        // the effective execution order. Duplicates render as separate steps.
        visible = items.map((it) => {
            const p = lookup.get(it.id);
            if (!p) {
                // Not in commands(). Three sub-cases:
                //  1. Canonical id (e.g. `checklist`) not customized by the
                //     active preset — synthesize a normal-looking card badged
                //     `core`. This is NOT a MISSING state; core provides the
                //     command at runtime.
                //  2. Extension-provided id (e.g. `commands/speckit.companion.status`)
                //     — resolve from composition and render with an extension
                //     origin chip. These commands aren't in the scanner's
                //     flat command list because that comes from the preset
                //     registry, not the extension namespace.
                //  3. Non-canonical id whose contributing preset was
                //     uninstalled after the user added it — a true orphan.
                //     Render with `unknown` pill + inline remove affordance.
                const resolved = resolvePipelineEntry(it.id, state.snapshot);
                if (resolved.kind === "core") {
                    return { id: it.id, orphan: false, synthesized: true, p: resolved.phase };
                }
                if (resolved.kind === "extension") {
                    return { id: it.id, orphan: false, extension: resolved.ext, p: resolved.phase };
                }
                return { id: it.id, orphan: true, p: { id: it.id, name: it.id, status: "empty", optional: false, locked: true } };
            }
            return { id: it.id, orphan: false, p: {
                id: p.id,
                name: p.shortLabel || p.title || p.id,
                status: p.status,
                // Canonical ids get their optional flag from the wizard's own
                // list — the scanner's `optional` flag reflects preset metadata
                // and doesn't know about our canonical spine.
                optional: isCanonical(it.id) ? isCanonicalOptional(it.id) : p.optional,
                locked: p.locked,
                commandName: p.commandName,
                source: p.source,
            }};
        });
    } else if (edited) {
        // User cleared the pipeline — render an inline hint.
        el.innerHTML = `<li class="stepper-empty muted">Pipeline is empty — click <strong>+ Add</strong> on any command below to build one, or use <em>Reset to default</em> above.</li>`;
        return;
    } else if (gp.length) {
        visible = gp.map((p) => ({ id: p.id, orphan: false, p: {
            id: p.id,
            name: p.shortLabel || p.title || p.id,
            status: p.status,
            optional: isCanonical(p.id) ? isCanonicalOptional(p.id) : p.optional,
            locked: p.locked,
            commandName: p.commandName,
            source: p.source,
        }}));
    } else {
        visible = PHASE_ORDER.map((id) => ({ id, orphan: false, p: state.snapshot.phases[id] })).filter((x) => x.p);
    }

    if (!isSetupComplete()) {
        visible = visible.map((entry) => ({
            ...entry,
            p: { ...entry.p, locked: true },
        }));
    }
    let priorRequiredBlocking = false;
    visible = visible.map((entry) => {
        const locked = entry.p.locked || priorRequiredBlocking;
        if (!entry.p.optional && (isPhaseRunning(entry.p.commandName) || entry.p.status !== "done")) {
            priorRequiredBlocking = true;
        }
        return locked ? { ...entry, p: { ...entry.p, locked: true } } : entry;
    });
    visible.forEach(({ id, orphan, synthesized, extension, p }, idx) => {
        if (idx > 0) {
            const sep = document.createElement("li");
            sep.className = "step-sep";
            sep.setAttribute("aria-hidden", "true");
            el.appendChild(sep);
        }
        const li = document.createElement("li");
        li.className = "step";
        if (id === state.currentPhase && !orphan) li.classList.add("active");
        if (p.locked) li.classList.add("locked");
        if (p.optional) li.classList.add("is-optional");
        if (orphan) li.classList.add("orphan");
        if (synthesized) li.classList.add("is-canonical-fallback");
        if (extension) li.classList.add("is-extension");
        li.dataset.phase = id;
        li.dataset.pipelineIndex = idx;
        const optionalTag = p.optional ? `<span class="step-optional-inline"> (optional)</span>` : "";
        // True orphan: id neither canonical nor in commands(). Reachable
        // only via stale saved state after a contributing preset was
        // uninstalled. Show unknown pill + let × clean it up.
        const orphanTag = orphan ? `<span class="step-orphan-pill" title="Not provided by any installed preset or by core. Its preset may have been uninstalled.">unknown</span>` : "";
        // Extension/preset source pills were previously rendered here to
        // annotate each chip with the extension or preset name that owns
        // the command. Those name-badges made the pipeline visualization
        // noisy and duplicated information already available in the phase
        // card and Composition tab. The chip now shows just the phase name
        // + status; source attribution lives in the phase card details.
        const extensionTag = "";
        const presetTag = "";
        // Track whether a preset customization is active — still needed
        // downstream so the "core" pill stays mutually exclusive.
        let presetActive = false;
        if (!orphan && !synthesized && !extension && p.commandName) {
            const arts = state.snapshot?.composition?.artifacts ?? [];
            const art = arts.find((a) => a.id === `commands/${p.commandName}`) ?? arts.find((a) => a.id === id);
            const active = (art?.stack ?? []).find((l) => l.active);
            const presetName = active?.layer === "preset" ? (active.presetName || active.presetId) : null;
            const fallbackPreset = (!active && p.source && p.source !== "core") ? p.source : null;
            if (presetName || fallbackPreset) presetActive = true;
        }
        // Core pill removed from pipeline chips — "Core" is the implicit
        // baseline for canonical phases; showing it added noise without
        // teaching anything new. Preset/Extension pills still surface
        // for non-core-authored steps.
        const canonicalTag = "";

        // Partition hooks into before / after so we can insert them as
        // dedicated chip tiles in execution order:
        //   [before_X hooks] → real step → [after_X hooks]
        // Hook chips are read-only (no × remove, no click nav) — the runtime
        // dispatches them; they can't be added/removed manually.
        const phaseHooks = (!orphan)
            ? hooksForCommand(p.commandName || id)
            : [];
        const beforeHooks = phaseHooks.filter((h) => String(h.phase || "").startsWith("before"));
        const afterHooks = phaseHooks.filter((h) => !String(h.phase || "").startsWith("before"));

        const appendHookStep = (hook) => {
            const sep2 = document.createElement("li");
            sep2.className = "step-sep step-sep-hook";
            sep2.setAttribute("aria-hidden", "true");
            el.appendChild(sep2);
            const hookLi = document.createElement("li");
            hookLi.className = "step step-hook";
            // Show the lifecycle trigger in the pipeline so the placement is
            // clear even when multiple extensions provide the same hook.
            const phaseText = String(hook.phase || "");
            const displayName = phaseText
                ? phaseText
                : hook.targetCommand || "hook";
            const extLabel = hook.extensionName || hook.extensionId || "extension";
            const isOptional = !!hook.optional;
            const reqLabel = isOptional ? "Optional" : "Required";
            // Keep the Required/Optional detail in the tooltip only.
            // The chip itself is omitted from the pipeline visualization —
            // multiple hooks per phase make per-chip modifiers too noisy.
            hookLi.title = `${extLabel} — auto-runs ${phaseText.startsWith("before") ? "before" : "after"} /${p.commandName || id} (${reqLabel})\nCannot be added or removed manually.`;
            hookLi.innerHTML = `
                <span class="step-hook-marker" aria-hidden="true">🪝</span>
                <span class="step-label">
                    <span class="step-name">${escapeHtml(displayName)}</span>
                    <span class="step-hook-pill">Hook auto-run</span>
                </span>
            `;
            el.appendChild(hookLi);
        };

        // Render before-hooks, then the real step, then after-hooks.
        for (const h of beforeHooks) appendHookStep(h);

        li.innerHTML = `
            <span class="step-index">${idx + 1}</span>
            <span class="step-label">
                <span class="step-name">${escapeHtml(p.name)}${optionalTag}</span>
                ${canonicalTag}${presetTag}${extensionTag}${orphanTag}
            </span>
            <button type="button" class="step-remove" data-action="pipeline-remove" data-index="${idx}" aria-label="Remove ${escapeHtml(p.name)} from pipeline" title="Remove from pipeline">×</button>
        `;
        li.addEventListener("click", (ev) => {
            if (ev.target?.closest?.('[data-action="pipeline-remove"]')) return;
            if (p.locked || orphan) return;
            state.currentPhase = id;
            __stepperRenderPhaseCard();
            renderStepper();
        });
        const removeBtn = li.querySelector('[data-action="pipeline-remove"]');
        removeBtn?.addEventListener("click", async (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            const label = p.name || id;
            const ok = await popoverConfirm(removeBtn, `Remove "${label}"?`, { confirmLabel: "Remove" });
            if (!ok) return;
            // Pass the render-time index so the server removes the exact
            // instance clicked when duplicates of the same command id exist.
            await dispatchPipeline("remove", { id, index: idx });
        });
        el.appendChild(li);
        for (const h of afterHooks) appendHookStep(h);
    });
}


// -------- Section: render/phase-card.js --------

let __renderGraphPhaseCard = () => {};

export function setPhaseCardDeps({ renderGraphPhaseCard }) {
    if (typeof renderGraphPhaseCard === "function") __renderGraphPhaseCard = renderGraphPhaseCard;
}

export function synthesizeCanonicalPhase(id) {
    // Minimal phase entry for a canonical id that no installed preset provides.
    // Core will run `/speckit.<id>` at invocation time. Renders normally in the
    // phase card (Run phase button, textarea) — no MISSING semantics.
    return {
        id,
        commandName: `speckit.${id}`,
        title: canonicalLabel(id),
        shortLabel: canonicalLabel(id),
        helpText: "",
        status: "empty",
        optional: isCanonicalOptional(id),
        locked: false,
        source: "core",
        artifact: null,
        artifactPath: null,
    };
}

export function renderPhaseCard() {
    const el = document.getElementById("phase-card");
    if (!el || !state.snapshot) return;
    const all = commands();
    if (all.length) {
        // The phase card is now strictly a projection of the pipeline: only
        // commands that are currently in the pipeline can be viewed here.
        // The "Commands" panel below is just a picker — clicking a card there
        // does NOT navigate; only + Add works.
        const items = pipelineItems();
        if (!items.length) {
            el.innerHTML = `<div class="empty phase-empty">
                <p><strong>No commands in the pipeline.</strong></p>
                <p class="muted">Click <strong>+ Add</strong> on any command below, or <em>Reset to default</em> above, to start building the pipeline.</p>
            </div>`;
            renderMoreCommandsPanel();
            return;
        }
        const inPipeline = new Set(items.map((it) => it.id));
        const lookup = new Map(all.map((x) => [x.id, x]));
        // Resolver: prefer commands() entry; fall back to the shared
        // pipeline-entry resolver (canonical synth OR extension artifact)
        // when the id isn't in the flat command list. Returns null only for
        // true orphans.
        const resolvePhase = (id) => {
            if (!inPipeline.has(id)) return null;
            const found = lookup.get(id);
            if (found) return found;
            const resolved = resolvePipelineEntry(id, state.snapshot);
            if (resolved.kind === "core" || resolved.kind === "extension") return resolved.phase;
            return null;
        };
        const setupLocked = !isSetupComplete();
        let p = resolvePhase(state.currentPhase);
        if (!p) {
            // Current phase isn't resolvable — snap to the first pipeline
            // entry that resolves (commands() hit OR canonical synth).
            for (const it of items) {
                const cand = resolvePhase(it.id);
                if (cand) { p = cand; break; }
            }
            if (p) state.currentPhase = p.id;
        }
        if (!p) {
            el.innerHTML = `<div class="empty phase-empty">
                <p><strong>Pipeline references unknown commands.</strong></p>
                <p class="muted">All entries are orphaned. Remove them with × in the stepper above, or install a preset that provides them.</p>
            </div>`;
            renderMoreCommandsPanel();
            return;
        }
        let priorRequiredBlocking = false;
        for (const it of items) {
            if (it.id === p.id) break;
            const prior = resolvePhase(it.id);
            if (!prior?.optional && (isPhaseRunning(prior?.commandName) || prior?.status !== "done")) {
                priorRequiredBlocking = true;
                break;
            }
        }
        __renderGraphPhaseCard(el, (setupLocked || priorRequiredBlocking) ? { ...p, locked: true } : p);
        renderMoreCommandsPanel();
        return;
    }
    // Snapshot arrived without any graph phases — nothing renderable yet.
    el.innerHTML = `<div class="empty phase-empty">
        <p><strong>No phases available.</strong></p>
        <p class="muted">Install a preset or wait for the pipeline snapshot to arrive.</p>
    </div>`;
    renderMoreCommandsPanel();
}

// Compute the "Suggested next" handoff list for a command tile.
// Precedence:
//   1. `p.handoffs` from the parsed markdown frontmatter (core + preset).
//   2. Canonical spine fallback (only for canonical ids) — the next spine
//      command if the current one is not the terminus.
// Preset commands with no declared handoffs return [] → row hidden.
export function computeSuggestedNext(p) {
    const declared = Array.isArray(p?.handoffs) ? p.handoffs : [];
    if (declared.length) return declared;
    if (!isCanonical(p?.id)) return [];
    const spine = canonicalSpine();
    const idx = spine.indexOf(p.id);
    if (idx < 0 || idx >= spine.length - 1) return [];
    const nextId = spine[idx + 1];
    return [{ agent: `speckit.${nextId}`, label: "", prompt: "" }];
}

export function renderCommandCardHintsHtml(p) {
    // Only Suggested next is surfaced — it comes from the command's own
    // `handoffs:` frontmatter (declared by the skill). Requires/Produces
    // hint rows have been removed: they were sourced from a hardcoded
    // canonical map, and hardcoded content shouldn't drive UI.
    const chip = (t) => `<code class="mc-hint-chip">${escapeHtml(t)}</code>`;
    const suggested = computeSuggestedNext(p);
    const suggestedChips = suggested.slice(0, 4).map((h) => {
        // Prefer the command name (`agent:`) as the chip label; the human
        // `label:` / `prompt:` become the tooltip.
        const cmd = h.agent ? h.agent.replace(/^speckit\./, "") : "";
        const chipLabel = cmd ? `/${cmd}` : (h.label || "");
        const title = h.label || h.prompt || h.agent || "";
        if (!chipLabel) return "";
        return `<span class="mc-hint-chip mc-hint-suggested" title="${escapeHtml(title)}">${escapeHtml(chipLabel)}</span>`;
    }).filter(Boolean).join("");
    const nextRow = suggestedChips
        ? `<div class="mc-hint-row"><span class="mc-hint-label">Suggested next</span>${suggestedChips}</div>`
        : "";
    if (!nextRow) return "";
    return `<div class="mc-hints">${nextRow}</div>`;
}


// -------- Section: render/graph-phase-card.js --------

let __postJson = async () => { throw new Error("graph-phase-card: postJson not injected"); };
let __openArtifactViewer = () => {};
let __openCommandViewer = () => {};
let __renderPhaseCard = () => {};
let __renderStepper = () => {};

export function setGraphPhaseCardDeps({
    postJson,
    openArtifactViewer,
    openCommandViewer,
    renderPhaseCard,
    renderStepper,
} = {}) {
    if (postJson) __postJson = postJson;
    if (openArtifactViewer) __openArtifactViewer = openArtifactViewer;
    if (openCommandViewer) __openCommandViewer = openCommandViewer;
    if (renderPhaseCard) __renderPhaseCard = renderPhaseCard;
    if (renderStepper) __renderStepper = renderStepper;
}
export function renderGraphPhaseCard(el, p) {
    const optionalBadge = p.optional ? `<span class="badge optional">optional</span>` : "";
    const lockedBadge = p.locked ? `<span class="badge locked">locked</span>` : "";
    const statusBadge = "";
    // Artifact link both displays and links to the parent folder of the
    // expected writes-to path. Users get one predictable interaction:
    // "click writes-to → land in the folder that holds (or should hold)
    // the artifact." From there they can inspect the real file, spot a
    // near-miss filename, or open a sibling.
    let artifact;
    if (p.artifactPath || p.folderPath) {
        // If we only know the folder, use it. Otherwise derive it from
        // the artifact path.
        const parentFolder = p.artifactPath
            ? parentDirOf(p.artifactPath)
            : p.folderPath;
        const displayPath = `${parentFolder}/`;
        const titleAttr = `title="Open ${escapeHtml(parentFolder)}/ in file explorer"`;
        artifact = `<button type="button" class="phase-artifact-link" data-phase-action="browse-folder" data-folder-path="${escapeHtml(parentFolder)}" ${titleAttr}><code>${escapeHtml(displayPath)}</code></button>`;
    } else if (p.artifact) {
        artifact = `<code class="muted">${escapeHtml(p.artifact)}</code>`;
    } else {
        artifact = "<em>no artifact</em>";
    }

    const cached = getPhaseDraft(p.commandName);

    const disabledAttr = p.locked ? "disabled" : "";
    const isDone = p.status === "done";
    const canViewArtifact = isDone && !!p.artifactPath;

    // Status-driven action row:
    //  - done      → View artifact + Run again (the phase has actually been
    //                run, and there's something meaningful on disk to view)
    //  - otherwise → Run phase only. Even if an artifact file exists on disk
    //                (e.g., a scaffolded template from `specify init`, or a
    //                sibling phase's shared file), View is hidden until this
    //                phase's own run marks it done.
    let actionRow;
    const running = state.phaseRunning.has(p.commandName);
    const runningLabel = `<span class="btn-spinner" aria-hidden="true"></span> Running…`;
    const runningDisabled = running ? "disabled" : "";
    // Pipeline nav data — used by the phase-actions row (Back / Continue)
    // and the header Remove icon. Nav walks the current pipeline (hooks
    // live off-strip), so index math is 1-based over `pipelineItems()`.
    const pip = pipelineItems();
    const pipIdx = pip.findIndex((it) => it.id === p.id);
    const inPipeline = pipIdx >= 0;
    const prevPhase = inPipeline && pipIdx > 0 ? pip[pipIdx - 1] : null;
    const nextPhase = inPipeline && pipIdx >= 0 && pipIdx < pip.length - 1 ? pip[pipIdx + 1] : null;
    const backDisabled = !prevPhase ? "disabled" : "";
    const continueDisabled = !nextPhase ? "disabled" : "";
    const backBtn = `<button type="button" class="btn btn-secondary phase-nav-back" data-phase-action="nav-back" ${backDisabled} title="${prevPhase ? `Go to ${escapeHtml(prevPhase.id)}` : "No previous phase"}">◀ Back</button>`;
    const continueBtn = `<button type="button" class="btn btn-secondary phase-nav-continue" data-phase-action="nav-continue" ${continueDisabled} title="${nextPhase ? `Go to ${escapeHtml(nextPhase.id)}` : "No next phase"}">Continue ▶</button>`;

    // Rebuild action row: Back on the left, primary/secondary actions in
    // the middle, Continue on the right. This mirrors classic wizard
    // conventions (◀ back / act / next ▶) so users don't need prose to
    // learn navigation. `phase-actions-center` holds whichever action
    // pair is relevant to the current phase state.
    let centerActions;
    if (isDone) {
        centerActions = `
              ${canViewArtifact ? `<button type="button" class="btn btn-primary" data-phase-action="view" ${disabledAttr}${running ? " disabled" : ""}>View artifact</button>` : ""}
              <button type="button" class="btn btn-primary" data-phase-action="redo" ${disabledAttr}${runningDisabled}>${running ? runningLabel : "Rerun phase"}</button>`;
    } else {
        centerActions = `
              <button type="submit" class="btn btn-primary" ${disabledAttr}${runningDisabled}>${running ? runningLabel : "Run phase"}</button>`;
    }
    actionRow = `<div class="phase-actions phase-actions-nav">
        <div class="phase-actions-left">${backBtn}</div>
        <div class="phase-actions-center">${centerActions}</div>
        <div class="phase-actions-right">${continueBtn}</div>
    </div>`;

    const PHASE_INPUT_PLACEHOLDERS = {
        constitution: {
            overlayHtml: `<span class="phase-input-overlay-primary">Enter your project's governing principles and development guidelines that will guide all subsequent development.</span> <em class="phase-input-overlay-hint">If left empty, a new constitution will be drafted from your repo context (README, docs) for review; otherwise, an existing constitution will be changed.</em>`,
        },
        specify: {
            overlayHtml: `<span class="phase-input-overlay-primary">Describe what you want to build — focus on the what and why, not the tech stack.</span> <em class="phase-input-overlay-hint">A description is required.</em>`,
        },
        clarify: {
            overlayHtml: `<span class="phase-input-overlay-primary">Provide areas of concern to focus clarification pass.</span> <em class="phase-input-overlay-hint">If left empty, the full spec will be scanned across categories of impact areas (scope, data model, UX, integration, etc.).</em>`,
        },
        plan: {
            overlayHtml: `<span class="phase-input-overlay-primary">Provide your tech stack and architecture choices.</span> <em class="phase-input-overlay-hint">If left empty, the plan will be derived from the spec.md and constitution.md alone, marking missing technical decisions as needing clarification.</em>`,
        },
        tasks: {
            overlayHtml: `<span class="phase-input-overlay-primary">Add guidance for task generation like groupings, priorities, and areas to emphasize.</span> <em class="phase-input-overlay-hint">If left empty, a full, dependency-ordered tasks.md will be generated directly from plan.md and spec.md (with constitution.md as governing constraints).</em>`,
        },
        implement: {
            overlayHtml: `<span class="phase-input-overlay-primary">Add guidance for the implementation.</span> <em class="phase-input-overlay-hint">If left empty, all tasks in tasks.md will be implemented in dependency order, updating progress markers as each completes.</em>`,
        },
        analyze: {
            overlayHtml: `<span class="phase-input-overlay-primary">Add a specific concern for analysis to focus on.</span> <em class="phase-input-overlay-hint">If left empty, a full consistency and quality analysis will be performed across spec.md, plan.md, and tasks.md (with constitution.md as governing authority).</em>`,
        },
        taskstoissues: {
            overlayHtml: `<span class="phase-input-overlay-primary">Add issue-creation guidance like labels, milestone, and assignees.</span> <em class="phase-input-overlay-hint">If left empty, one GitHub issue per task will be created in tasks.md on the current repo's git remote.</em>`,
        },
    };
    const DEFAULT_PHASE_OVERLAY = {
        overlayHtml: `<span class="phase-input-overlay-primary">Provide guidance to focus or scope this phase.</span> <em class="phase-input-overlay-hint">If left empty, the phase will run with default behavior using the existing artifacts.</em>`,
    };
    // For extension-provided phases, the LLM inference pass may have
    // captured argsHint (primary "what to type") and argsWhenEmpty
    // (italic "what happens if empty") from the skill body. When at
    // least one of those is present, build the overlay from them so
    // the user gets phase-specific guidance instead of the generic
    // default. Hardcoded PHASE_INPUT_PLACEHOLDERS still wins for core
    // phases (matches PHASE_TAGLINE_OVERRIDES precedence).
    let inferredOverlay = null;
    if (p.argsHint || p.argsWhenEmpty) {
        const primary = p.argsHint
            ? `<span class="phase-input-overlay-primary">${escapeHtml(p.argsHint)}</span>`
            : "";
        const hint = p.argsWhenEmpty
            ? `<em class="phase-input-overlay-hint">${escapeHtml(p.argsWhenEmpty)}</em>`
            : "";
        const joiner = primary && hint ? " " : "";
        inferredOverlay = { overlayHtml: `${primary}${joiner}${hint}` };
    }
    const phaseInputSpec = PHASE_INPUT_PLACEHOLDERS[p.id] ?? inferredOverlay ?? DEFAULT_PHASE_OVERLAY;
    const phasePlaceholder = typeof phaseInputSpec === "string" ? phaseInputSpec : (phaseInputSpec.placeholder ?? "");
    const phaseHint = typeof phaseInputSpec === "object" ? (phaseInputSpec.hint ?? "") : "";
    const overlayHtml = typeof phaseInputSpec === "object" ? (phaseInputSpec.overlayHtml ?? "") : "";
    const hintBlock = phaseHint
        ? `<small class="phase-input-hint"><em>${escapeHtml(phaseHint)}</em></small>`
        : "";
    // When overlayHtml is present, use a faux-placeholder overlay that
    // supports mixed formatting (roman + italic). Overlay hides on focus
    // or when the textarea has content — see wireGraphPhaseCard.
    const inputBlock = overlayHtml
        ? `<label>
              Command input
              <div class="phase-input-wrap">
                  <div class="phase-input-overlay" aria-hidden="true">${overlayHtml}</div>
                  <textarea name="args" ${disabledAttr} data-has-overlay="1"></textarea>
              </div>
              ${hintBlock}
           </label>`
        : `<label>
              Command input
              <textarea name="args" ${disabledAttr}${phasePlaceholder ? ` placeholder="${escapeHtml(phasePlaceholder)}"` : ""}></textarea>
              ${hintBlock}
           </label>`;

    // Source + strategy come from the composition resolution stack when
    // available — used by renderPhaseCustomizations below.
    const PHASE_TAGLINE_OVERRIDES = {
        constitution: "Establish the project's guiding principles.",
        specify: "Describe what to build and why.",
        clarify: "Resolve unanswered questions in the spec.",
        plan: "Choose the tech stack and approach.",
        tasks: "Break the plan into actionable work items.",
        analyze: "Check the spec, plan, and tasks for consistency.",
        implement: "Execute the tasks to build the feature.",
        taskstoissues: "Convert generated task lists into GitHub issues for tracking and execution.",
    };
    const phaseTagline = PHASE_TAGLINE_OVERRIDES[p.id] ?? p.description ?? (p.title || p.helpText || "");

    // Remove-from-pipeline button lives in the card header — labeled so
    // its purpose is unambiguous, and danger-tinted so it reads as
    // destructive without being alarming. Only shown when the phase is
    // actually in the pipeline and isn't locked.
    const removeIcon = (inPipeline && !p.locked)
        ? `<button type="button" class="btn btn-danger-ghost phase-remove-btn" data-phase-action="nav-remove" title="Remove this phase from the pipeline">Remove from pipeline</button>`
        : "";

    // Origin pill teaches the layering model in the phase card header,
    // mirroring the More Commands cards:
    //  - canonical + no preset override wins  → "Core"
    //  - canonical + preset override wins     → "Core • Customized"
    //  - extension-provided command           → "Extension"
    //  - non-canonical preset-added command   → no pill (Preset group already conveys that)
    const bareIdForPill = bareCommandId(p.id);
    const compArtsForPill = state.snapshot?.composition?.artifacts ?? [];
    const commandArtForPill = compArtsForPill.find((a) => a.id === `commands/${p.commandName}` && a.kind === "command");
    const activeLayerForPill = (commandArtForPill?.stack ?? []).find((l) => l.active) || null;
    let originPillHeader = "";
    if (activeLayerForPill?.layer === "extension") {
        originPillHeader = `<span class="comp-artifact-origin origin-extension mc-origin-pill" title="Extension-provided command">Extension</span>`;
    }
    // Core pill is intentionally omitted on phase pages — canonical
    // phases are core by definition; the pill added noise. The Available
    // Commands view still renders "Core" / "Core • Customized" for
    // discoverability.

    el.innerHTML = `
        <header>
            <h2>${escapeHtml(isCanonical(p.id) ? canonicalLabel(p.id) : (p.shortLabel || p.title || p.id))} ${originPillHeader} ${statusBadge} ${optionalBadge} ${lockedBadge}<span class="phase-header-spacer"></span>${removeIcon}</h2>
            <p class="tagline">${escapeHtml(phaseTagline)}</p>
        </header>
        ${renderPhaseCustomizations(p, artifact)}
        <form class="phase-form graph-phase-form" data-command="${escapeHtml(p.commandName)}">
            ${inputBlock}
            ${actionRow}
        </form>
    `;

    const ta = el.querySelector("textarea[name='args']");
    if (ta) ta.value = cached;

    wireGraphPhaseCard(el, p);
}

export function wireGraphPhaseCard(el, p) {
    // Wire the "About active artifacts" info popover injected by
    // renderPhaseCustomizations. Ids are phase-scoped so multiple
    // phase cards on the page don't collide.
    const phaseKey = (p.commandName || p.id || "phase").replace(/[^A-Za-z0-9._-]/g, "-");
    wireInfoPopover(`phase-active-info-btn-${phaseKey}`, `phase-active-info-popover-${phaseKey}`);
    const form = el.querySelector("form.graph-phase-form");
    const textarea = form?.querySelector("textarea[name='args']");
    const submitBtn = form?.querySelector("button[type='submit']");
    // Faux-placeholder overlay (rich HTML with roman + italic mixing).
    // Show while textarea is empty AND not focused; hide otherwise.
    const overlay = form?.querySelector(".phase-input-overlay");
    const syncOverlay = () => {
        if (!overlay || !textarea) return;
        const hasValue = (textarea.value || "").length > 0;
        const isFocused = document.activeElement === textarea;
        overlay.classList.toggle("is-hidden", hasValue || isFocused);
    };
    if (overlay && textarea) {
        textarea.addEventListener("focus", syncOverlay);
        textarea.addEventListener("blur", syncOverlay);
        // Clicking anywhere on the overlay should hand focus to the textarea.
        overlay.addEventListener("mousedown", (ev) => {
            ev.preventDefault();
            textarea.focus();
        });
        syncOverlay();
    }
    textarea?.addEventListener("input", () => {
        setPhaseDraft(p.commandName, textarea.value);
        syncOverlay();
    });
    form?.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!submitBtn || submitBtn.disabled) return;
        const args = textarea?.value ?? "";
        setPhaseLastSubmitted(p.commandName, args);
        markPhaseRunning(p.commandName);
        try {
            await __postJson("/api/phase/submit", { commandName: p.commandName, args });
        } catch (err) {
            console.error(`dispatch failed: ${err?.message ?? err}`);
            clearPhaseRunning(p.commandName);
        }
    });

    // Post-run actions: View artifact + Run again
    const viewBtn = el.querySelector('[data-phase-action="view"]');
    viewBtn?.addEventListener("click", () => __openArtifactViewer(p));
    // Writes-to path in the phase-facts row: opens the parent folder in
    // the OS file explorer (via /api/reveal). One predictable behavior
    // regardless of whether the file exists — user always lands in the
    // real folder on disk.
    const browseLink = el.querySelector('[data-phase-action="browse-folder"]');
    browseLink?.addEventListener("click", async () => {
        const folder = browseLink.getAttribute("data-folder-path");
        if (!folder) return;
        try {
            await __postJson("/api/reveal", { sub: folder });
        } catch (err) {
            console.error(`reveal failed: ${err?.message ?? err}`);
        }
    });
    // Customization row targets — reveal the assembled source file (template,
    // command, script, etc.) in the command viewer.
    el.querySelectorAll("a[data-reveal-path]").forEach((a) => {
        a.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            const sub = a.dataset.revealPath;
            if (!sub) return;
            const title = a.textContent?.trim() || sub;
            __openCommandViewer(sub, title);
        });
    });
    // Chain disclosure toggles — expand/collapse the contributing layer
    // stack for a given artifact row. Per-artifact state lives in
    // `state.expandedArtifactChains`; we just re-render the phase card
    // after flipping the set.
    el.querySelectorAll("button.phase-cust-chain-toggle").forEach((btn) => {
        btn.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            const key = btn.dataset.chainKey;
            if (!key) return;
            if (state.expandedArtifactChains.has(key)) {
                state.expandedArtifactChains.delete(key);
            } else {
                state.expandedArtifactChains.add(key);
            }
            renderGraphPhaseCard(el, p);
        });
    });
    const redoBtn = el.querySelector('[data-phase-action="redo"]');
    redoBtn?.addEventListener("click", async () => {
        const ok = await popoverConfirm(
            redoBtn,
            "Rerun will overwrite the artifact, with valid content preserved. Proceed?",
            { confirmLabel: "Yes", cancelLabel: "No" }
        );
        if (!ok) return;
        // Prefer the currently visible draft; fall back to the last-submitted
        // args so a re-run without new input still ships something meaningful.
        const draft = textarea?.value?.trim() ? textarea.value : "";
        const args = draft || getPhaseLastSubmitted(p.commandName) || "";
        setPhaseLastSubmitted(p.commandName, args);
        markPhaseRunning(p.commandName);
        try {
            await __postJson("/api/phase/submit", { commandName: p.commandName, args });
        } catch (err) {
            console.error(`dispatch failed: ${err?.message ?? err}`);
            clearPhaseRunning(p.commandName);
        }
    });

    // Phase-nav strip (Back / Continue / Remove): navigate + remove without
    // needing the stepper or hover affordances.
    const navBackBtn = el.querySelector('[data-phase-action="nav-back"]');
    const navContinueBtn = el.querySelector('[data-phase-action="nav-continue"]');
    const navRemoveBtn = el.querySelector('[data-phase-action="nav-remove"]');
    const navGoTo = (id) => {
        if (!id) return;
        state.currentPhase = id;
        __renderPhaseCard();
        __renderStepper();
    };
    navBackBtn?.addEventListener("click", () => {
        const pip = pipelineItems();
        const idx = pip.findIndex((it) => it.id === p.id);
        if (idx > 0) navGoTo(pip[idx - 1].id);
    });
    navContinueBtn?.addEventListener("click", () => {
        const pip = pipelineItems();
        const idx = pip.findIndex((it) => it.id === p.id);
        if (idx >= 0 && idx < pip.length - 1) navGoTo(pip[idx + 1].id);
    });
    navRemoveBtn?.addEventListener("click", async () => {
        const pip = pipelineItems();
        const idx = pip.findIndex((it) => it.id === p.id);
        if (idx < 0) return;
        const label = p.shortLabel || p.name || p.id;
        const ok = await popoverConfirm(navRemoveBtn, `Remove "${label}" from pipeline?`, { confirmLabel: "Remove" });
        if (!ok) return;
        // After removal, advance selection to the next phase in the pipeline
        // (or the previous one if this was the tail) so the user isn't left
        // staring at an empty card.
        const successor = pip[idx + 1]?.id ?? pip[idx - 1]?.id;
        await dispatchPipeline("remove", { id: p.id, index: idx });
        if (successor) {
            state.currentPhase = successor;
            __renderPhaseCard();
            __renderStepper();
        }
    });

}
