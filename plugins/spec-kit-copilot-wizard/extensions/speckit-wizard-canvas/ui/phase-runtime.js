// Consolidated phase runtime: pipeline state, run-lock, resolver, inference, extension cards.

import { escapeHtml, dispatchKind } from "./client.js";
import {
    state,
    commands,
    orderedCompositionExtensions,
    orderedCompositionPresets,
    displayCommand,
    bareCommandId,
} from "./state.js";
import { popoverConfirm } from "./modals.js";
import { wireInfoPopover } from "./composition.js";
import {
    canonicalDescription,
    canonicalSpine,
    isCanonical,
    CANONICAL_UNSEEDED,
    canonicalLabel,
    isCanonicalOptional,
} from "../pipeline/canonical.mjs";
import { CANONICAL_BY_FULL } from "../pipeline/effective-phases.mjs";
import { resolveHooksForCommand } from "../pipeline/active-artifacts.mjs";
import { effectivePipelinePhases } from "../pipeline/effective-phases.mjs";

// -------- Section: phase/clarifications.js --------

// Pending-clarifications queue: per-phase answers waiting to flush.

const pendingClarifications = new Map(); // commandName -> [{ question, answer }, ...]

export function getPendingClarifications(commandName) {
    if (!pendingClarifications.has(commandName)) pendingClarifications.set(commandName, []);
    return pendingClarifications.get(commandName);
}

export function queueClarification(commandName, question, answer) {
    const list = getPendingClarifications(commandName);
    const existing = list.findIndex((c) => c.question === question);
    if (existing >= 0) list[existing] = { question, answer };
    else list.push({ question, answer });
}

export function clearClarifications(commandName) {
    pendingClarifications.set(commandName, []);
}


// -------- Section: phase/draft-cache.js --------

// Per-phase textarea cache. Two slots per phase: `draft` (in-progress
// textarea content) and `lastSubmitted` (last text actually run, used as
// the base for Run again / Clarify). Back-compat: earlier versions stored
// a bare string; readers coerce that into { draft, lastSubmitted: "" }.

const TEXTAREA_CACHE_KEY = "speckit-wizard.v2.textarea";

export function loadTextareaCache() {
    try {
        const raw = localStorage.getItem(TEXTAREA_CACHE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
}

export function saveTextareaCache(cache) {
    try { localStorage.setItem(TEXTAREA_CACHE_KEY, JSON.stringify(cache)); }
    catch { /* quota / private mode — ignore */ }
}

export function getPhaseSlot(cache, commandName) {
    const raw = cache[commandName];
    if (raw && typeof raw === "object") {
        return { draft: raw.draft ?? "", lastSubmitted: raw.lastSubmitted ?? "" };
    }
    if (typeof raw === "string") return { draft: raw, lastSubmitted: "" };
    return { draft: "", lastSubmitted: "" };
}

export function getPhaseDraft(commandName) {
    return getPhaseSlot(loadTextareaCache(), commandName).draft;
}

export function setPhaseDraft(commandName, value) {
    const cache = loadTextareaCache();
    const slot = getPhaseSlot(cache, commandName);
    slot.draft = String(value ?? "");
    cache[commandName] = slot;
    saveTextareaCache(cache);
}

export function getPhaseLastSubmitted(commandName) {
    return getPhaseSlot(loadTextareaCache(), commandName).lastSubmitted;
}

export function setPhaseLastSubmitted(commandName, value) {
    const cache = loadTextareaCache();
    const slot = getPhaseSlot(cache, commandName);
    slot.lastSubmitted = String(value ?? "");
    cache[commandName] = slot;
    saveTextareaCache(cache);
}


// -------- Section: phase/run-lock.js --------

export const PHASE_RUN_SAFETY_MS = 5 * 60 * 1000;
const _phaseRunTimers = new Map();
const _phaseRunStartedAt = new Map();
const _phaseRunBaselineLastRunAt = new Map();
const TERMINAL_PHASE_STATUSES = new Set(["done", "skipped", "error"]);

let __render = () => {};

export function setRunLockDeps({ render }) {
    if (typeof render === "function") __render = render;
}

function _phaseIdForCommand(commandName) {
    if (typeof commandName !== "string") return null;
    return commandName.startsWith("speckit.") ? commandName.slice("speckit.".length) : commandName;
}

export function markPhaseRunning(commandName) {
    if (!commandName) return;
    state.phaseRunning.add(commandName);
    _phaseRunStartedAt.set(commandName, Date.now());
    const phaseId = _phaseIdForCommand(commandName);
    const baselineLastRunAt = state.snapshot?.phases?.[phaseId]?.lastRunAt ?? null;
    _phaseRunBaselineLastRunAt.set(commandName, baselineLastRunAt);
    if (_phaseRunTimers.has(commandName)) {
        clearTimeout(_phaseRunTimers.get(commandName));
    }
    const t = setTimeout(() => clearPhaseRunning(commandName), PHASE_RUN_SAFETY_MS);
    _phaseRunTimers.set(commandName, t);
    __render();
}

export function clearPhaseRunning(commandName) {
    if (!commandName) return;
    state.phaseRunning.delete(commandName);
    _phaseRunStartedAt.delete(commandName);
    _phaseRunBaselineLastRunAt.delete(commandName);
    if (_phaseRunTimers.has(commandName)) {
        clearTimeout(_phaseRunTimers.get(commandName));
        _phaseRunTimers.delete(commandName);
    }
    __render();
}

// Called after each state snapshot lands. Clears `phaseRunning` on the
// first positive completion signal from EITHER of two consistent channels
// that every phase produces via setPhaseStatus:
//   1. `lastRunAt` advances past the click-time baseline, OR
//   2. phase status transitions to a terminal value (done/skipped/error).
export function observePhaseProgress() {
    if (!state.phaseRunning.size) return;
    for (const commandName of Array.from(state.phaseRunning)) {
        const phaseId = _phaseIdForCommand(commandName);
        const phase = state.snapshot?.phases?.[phaseId];
        const baselineLastRunAt = _phaseRunBaselineLastRunAt.get(commandName) ?? null;
        const currentLastRunAt = phase?.lastRunAt ?? null;
        const lastRunAtAdvanced = currentLastRunAt && currentLastRunAt !== baselineLastRunAt;
        const terminal = phase?.status && TERMINAL_PHASE_STATUSES.has(phase.status);
        if (lastRunAtAdvanced || terminal) {
            clearPhaseRunning(commandName);
        }
    }
}


// -------- Section: phase/resolver.js --------

// Resolve one pipeline id against the current snapshot.
//
// Returns one of three shapes:
//   { kind: "core",      id, phase }              — canonical (built-in) command
//   { kind: "extension", id, phase, ext, sourcePath, commandName }  — extension-provided command
//   { kind: "orphan",    id }                     — id references nothing the UI can render
//
// The `phase` object is a minimal shape both call sites (stepper +
// phase-card renderer) already know how to render: { id, name, status,
// optional, locked, commandName?, source? }. Callers that need more (e.g.
// snapshot.phases[id].formValues) should look up separately — the resolver
// only speaks the language of pipeline classification.
export function resolvePipelineEntry(id, snapshot) {
    if (typeof id !== "string") return { kind: "orphan", id };

    // Canonical branch — spec-kit's built-in phases. Even when no preset
    // customizes them we synthesize a phase-shaped object so the phase card
    // and stepper render a normal "Core" chip.
    if (isCanonical(id)) {
        // Read the scanner-hydrated status slice from snapshot.phases[id].
        // Without this, canonical phases synthesized here (i.e. not present
        // in commands() because the current composition doesn't
        // include them on its happy/more path) lose their real status and
        // artifactPath, so the phase card renders "no artifact" and hides
        // the View artifact button even after the phase has been run
        // (state.json has status:"done", artifactPath set). Mirrors the
        // extension branch below.
        const scanned = snapshot?.phases?.[id] ?? null;
        return {
            kind: "core",
            id,
            phase: {
                id,
                name: canonicalLabel(id),
                status: scanned?.status ?? "empty",
                optional: isCanonicalOptional(id),
                locked: false,
                // Required so the phase card's Run phase submit path can
                // POST { commandName, args } to /api/phase/submit. Without
                // this the form's data-command attribute is empty, the
                // /api/phase/submit call sends commandName=undefined and
                // the server silently rejects — Run phase button appears
                // to do nothing. Mirrors synthesizeCanonicalPhase() in
                // app.js which uses the same `speckit.<id>` convention.
                commandName: `speckit.${id}`,
                artifactPath: scanned?.artifactPath ?? null,
                lastRunAt: scanned?.lastRunAt ?? null,
                ...(scanned?.folderPath ? { folderPath: scanned.folderPath } : {}),
            },
        };
    }

    // Extension branch — pipeline entries of the form
    // "commands/speckit.<extId>.<cmd>". These aren't in the scanner's
    // commands() because that's derived from the preset
    // registry, not the extension namespace.
    const extResolved = resolveExtensionArtifactFromSnapshot(id, snapshot);
    if (extResolved) {
        // Look up the scanner-hydrated status slice (populated by
        // scanner.mjs :: hydrateExtensionArtifacts when a matching artifact
        // is found on disk). Both `artifactPath` and `status` come from
        // there so the phase card renders a live "Writes to" link the same
        // way core phases do.
        const scanned = snapshot?.phases?.[id] ?? null;
        return {
            kind: "extension",
            id,
            ext: extResolved.ext,
            sourcePath: extResolved.sourcePath,
            commandName: extResolved.commandName,
            phase: {
                id,
                name: extResolved.shortLabel,
                status: scanned?.status ?? "empty",
                optional: false,
                locked: false,
                commandName: extResolved.commandName,
                source: `extension:${extResolved.ext.id}`,
                artifactPath: scanned?.artifactPath ?? null,
                lastRunAt: scanned?.lastRunAt ?? null,
                // LLM-inferred metadata from artifact-targets.json cache
                // (via extension.inferArtifactTargets prompt). The phase
                // card reads these to render the tagline under the header
                // and the args-input placeholder overlay. Only forwarded
                // when the scanner slice has them.
                ...(scanned?.description ? { description: scanned.description } : {}),
                ...(scanned?.argsHint ? { argsHint: scanned.argsHint } : {}),
                ...(scanned?.argsWhenEmpty ? { argsWhenEmpty: scanned.argsWhenEmpty } : {}),
                // "Browse folder" fallback — set only when the inferred
                // artifact filename is wrong (file missing, folder present).
                ...(scanned?.folderPath ? { folderPath: scanned.folderPath } : {}),
            },
        };
    }

    return { kind: "orphan", id };
}

// Internal helper — same logic as app.js `resolveExtensionArtifact`, but
// pure-in-snapshot so the resolver has zero implicit globals. Once the
// stepper/phase-card port lands, the app.js copy can be removed.
function resolveExtensionArtifactFromSnapshot(pipelineId, snapshot) {
    if (typeof pipelineId !== "string") return null;
    // Accept both the composition-native `commands/speckit.<ext>.<cmd>`
    // form (as emitted by the LLM into inferredPipeline) AND the bare
    // `speckit.<ext>.<cmd>` form that pipelineItems() produces after
    // stripCommandsPrefix normalizes canonicals. Without this dual match,
    // an inferred standalone pipeline resolves to `orphan` and the phase
    // card renders "Pipeline references unknown commands" even though the
    // artifact is present in composition.artifacts.
    const artifactId = pipelineId.startsWith("commands/") ? pipelineId : `commands/${pipelineId}`;
    const arts = snapshot?.composition?.artifacts ?? [];
    const art = arts.find((a) => a.id === artifactId);
    // Accept both `command` and `hook` kinds — hook-bound artifacts still
    // resolve back to the original command name, so a stale pipeline entry
    // pointing at what's now a hook still renders sensibly.
    if (!art || (art.kind !== "command" && art.kind !== "hook")) return null;
    const active = (art.stack ?? []).find((l) => l.active);
    if (active?.layer !== "extension") return null;
    const exts = snapshot?.composition?.extensions ?? [];
    const ext = exts.find((e) => e.id === active.presetId) ?? {
        id: active.presetId,
        name: active.presetName || active.presetId,
        version: active.version || null,
    };
    const commandName = artifactId.slice("commands/".length);
    const prefix = `speckit.${ext.id}.`;
    const shortLabel = commandName.startsWith(prefix) ? commandName.slice(prefix.length) : commandName;
    return {
        ext,
        commandName,
        shortLabel,
        sourcePath: active.sourcePath || null,
        description: art.description || "",
    };
}


// -------- Section: phase/pipeline.js --------

let __postJson = async () => {};

export function setPipelineDeps({ postJson }) {
    if (typeof postJson === "function") __postJson = postJson;
}

/** True when the user has taken control of the pipeline (any array — even []). */
export function pipelineIsEdited() {
    return Array.isArray(state.snapshot?.pipeline);
}

/** Effective chip list: user-authored array if present, else inferred pipeline (LLM), else canonical spine. */
export function pipelineItems() {
    return effectivePipelinePhases(state.snapshot);
}

export async function dispatchPipeline(action, extra = {}) {
    try {
        await __postJson("/api/pipeline", { action, ...extra });
    } catch (err) {
        console.error(`pipeline ${action} failed: ${err?.message ?? err}`);
    }
}

/** Render the top-of-page pipeline toolbar: title, hint, Clear/Reset. */
export function renderPipelineBanner() {
    const el = document.getElementById("pipeline-banner");
    if (!el) return;
    const onPhasesTab = state.activeTab === "phases" || !state.activeTab;
    if (!onPhasesTab) { el.hidden = true; el.innerHTML = ""; return; }
    const items = pipelineItems();
    const edited = pipelineIsEdited();
    // Nothing to show when the inferred spine is empty AND user hasn't taken control.
    if (!items.length && !edited) {
        el.hidden = true; el.innerHTML = "";
        return;
    }
    el.hidden = false;
    // Previously a "Pipeline from <extension name>" hint rendered above
    // the chip strip when the inferred pipeline was extension-standalone.
    // Naming the source in the pipeline visualization was redundant with
    // Composition and cluttered the chip header, so it's suppressed.
    el.innerHTML = `
        <header class="panel-header">
            <div>
                <h2 class="comp-title">
                    Pipeline
                    <button type="button" class="comp-info-btn" id="pipeline-info-btn" aria-label="About phases" aria-expanded="false" aria-controls="pipeline-info-popover" title="About phases">i</button>
                </h2>
                <p class="comp-subtitle">Start from this suggested pipeline and shape it to your project by adding or removing commands below.</p>
                <div id="pipeline-info-popover" class="comp-info-popover" role="dialog" aria-label="About phases" hidden>
                    <p>
                        This pipeline walks you through a set of <strong>phases</strong> to turn a concept into working code with Spec Kit. Each phase runs a <strong>command</strong>, and the pipeline shows the suggested order based on the presets and extensions that you have installed.
                    </p>
                    <p>
                        Many commands build on artifacts from earlier phases. For example, <code>Plan</code> reads the <code>spec.md</code> produced by <code>Specify</code>, so it works best after <code>Specify</code> has run. Running phases in the suggested order makes sure each command has what it needs.
                    </p>
                    <p>
                        The pipeline is only a suggestion — you can add any command listed below, remove ones you don't need, and run phases in whatever order that suits your project.
                    </p>
                </div>
            </div>
            <div class="header-actions pipeline-actions">
                ${items.length ? `<button type="button" class="btn btn-ghost pipeline-clear" data-action="clear">Clear</button>` : ""}
                ${`<button type="button" class="btn btn-ghost pipeline-reset" data-action="reset"${edited ? "" : " disabled"}>Reset to default</button>`}
            </div>
        </header>
    `;
    wireInfoPopover("pipeline-info-btn", "pipeline-info-popover");
    const clearBtn = el.querySelector(".pipeline-clear");
    if (clearBtn) {
        clearBtn.addEventListener("click", async () => {
            const count = pipelineItems().length;
            const ok = await popoverConfirm(clearBtn, `Clear all ${count} step${count === 1 ? "" : "s"}?`, { confirmLabel: "Clear" });
            if (!ok) return;
            await dispatchPipeline("clear");
        });
    }
    el.querySelector(".pipeline-reset")?.addEventListener("click", async () => {
        await dispatchPipeline("reset");
    });
}


// -------- Section: phase/inference.js --------

let __TOKEN = "";

export function setInferenceDeps({ TOKEN }) {
    if (typeof TOKEN === "string") __TOKEN = TOKEN;
}

export function maybeRequestArtifactInference() {
    const snap = state.snapshot;
    if (!snap) return;
    // Wait until skills have loaded at least once — dispatching before that
    // produces a prompt the agent can't fulfill. Uses the persisted sticky
    // flag (not the transient live diagnostic) so a background reload
    // failure doesn't block inference for a session where skills already
    // loaded cleanly earlier.
    if (!snap.setup?.skillsReloaded) return;

    const artifacts = snap.composition?.artifacts ?? [];
    const phases = snap.phases ?? {};
    const candidates = [];
    for (const art of artifacts) {
        if (art.kind !== "command") continue;
        const stack = art.stack ?? [];
        const active = stack.find((l) => l.active) ?? stack[0];
        if (!active || active.layer !== "extension") continue;
        const skillPath = active.sourcePath;
        if (!skillPath) continue;
        const phaseKey = art.id; // "commands/<full-id>"
        // Already resolved via cache — skip. Gate on `description` (the
        // new anchor field) so old cache entries that only carry
        // `writesTo` re-trigger inference once, backfilling
        // description/argsHint/argsWhenEmpty. Session-scoped signature
        // dedupe below prevents loops when the LLM legitimately can't
        // extract a description from a given skill.
        if (phases[phaseKey]?.description) continue;
        candidates.push({ commandId: art.id.replace(/^commands\//, ""), skillPath });
    }
    if (!candidates.length) return;

    // Session-scoped dedupe: signature over the sorted skill paths so a
    // new install re-triggers, but repeat snapshots don't.
    const signature = candidates.map((c) => c.skillPath).sort().join("|");
    if (state.artifactInferenceSignature === signature) return;
    state.artifactInferenceSignature = signature;

    dispatchKind("extension.inferArtifactTargets", {
        origin: location.origin,
        token: __TOKEN,
        commands: candidates,
    }).catch((err) => {
        // Reset signature so a manual refresh can retry.
        state.artifactInferenceSignature = null;
        console.error(`artifact-target inference dispatch failed: ${err?.message ?? err}`);
    });
}


// -------- Section: phase/extension-card.js --------

let __openCommandViewer = () => {};
let __renderCommandCardHintsHtml = () => "";
let __synthesizeCanonicalPhase = (id) => ({ id });

export function setExtensionCardDeps({ openCommandViewer, renderCommandCardHintsHtml, synthesizeCanonicalPhase }) {
    if (typeof openCommandViewer === "function") __openCommandViewer = openCommandViewer;
    if (typeof renderCommandCardHintsHtml === "function") __renderCommandCardHintsHtml = renderCommandCardHintsHtml;
    if (typeof synthesizeCanonicalPhase === "function") __synthesizeCanonicalPhase = synthesizeCanonicalPhase;
}

export function hooksForCommand(commandName) {
    return resolveHooksForCommand(state.snapshot?.composition, commandName);
}

// Resolve an extension-provided command id (e.g. "commands/speckit.companion.status")
// against the composition catalog. Returns `{ ext, shortLabel, commandName, description }`
// when the id maps to an extension artifact whose winning stack layer is
// `extension`, else null. Used by the stepper to render extension-added
// pipeline steps that aren't in the scanner's flat command list.
export function resolveExtensionArtifact(pipelineId) {
    if (typeof pipelineId !== "string" || !pipelineId.startsWith("commands/")) return null;
    const arts = state.snapshot?.composition?.artifacts ?? [];
    const art = arts.find((a) => a.id === pipelineId);
    // Accept both `command` and `hook` kinds — hook-bound artifacts still
    // resolve back to the original command name, so a stale pipeline entry
    // pointing at what's now a hook still renders sensibly (the picker
    // prevents fresh adds via the kind filter above).
    if (!art || (art.kind !== "command" && art.kind !== "hook")) return null;
    const active = (art.stack ?? []).find((l) => l.active);
    if (active?.layer !== "extension") return null;
    const exts = orderedCompositionExtensions();
    const ext = exts.find((e) => e.id === active.presetId) ?? { id: active.presetId, name: active.presetName || active.presetId, version: active.version || null };
    const commandName = pipelineId.slice("commands/".length);
    // Human-facing short label: strip the "speckit.<ext-id>." prefix if present
    // so long namespaced ids collapse to a readable step name.
    const prefix = `speckit.${ext.id}.`;
    const shortLabel = commandName.startsWith(prefix) ? commandName.slice(prefix.length) : commandName;
    return {
        ext,
        commandName,
        shortLabel,
        description: art.description || "",
    };
}

// Card for an extension-provided command. When the command is also the
// target of one or more hook bindings (`hookBindings` passed in, either
// as a single binding object for back-compat or an array of bindings),
// the card gains the teal "is-hook-card" treatment, swaps the "+ Add"
// affordance for a passive "Hook auto-run" badge, and appends a
// "Triggered by" footer with ONE line per binding — so a command wired
// to multiple parent phases (e.g. `agent-context.update` firing after
// both /speckit-specify and /speckit-plan) shows every trigger, not
// just the last one seen.
export function renderExtensionCommandCard(artifact, ext, hookBindings = null) {
    const active = (artifact.stack ?? []).find((l) => l.active) || {};
    const fullName = (artifact.id || "").replace(/^commands\//, "");
    const extPrefix = `speckit.${ext?.id || ""}.`;
    const shortLabel = ext?.id && fullName.startsWith(extPrefix)
        ? fullName.slice(extPrefix.length)
        : fullName;
    const label = escapeHtml(shortLabel);
    const sourcePath = active.sourcePath || "";
    const labelEl = sourcePath
        ? `<a class="mc-label mc-label-link" href="#" data-reveal-path="${escapeHtml(sourcePath)}" title="View ${escapeHtml(sourcePath)}">${label}</a>`
        : `<span class="mc-label">${label}</span>`;
    const desc = artifact.description || "";
    const cmdLine = `<code>/${escapeHtml(displayCommand(fullName))}</code>`;

    // Normalize the argument: accept either a single binding (legacy
    // shape) or an array. Drop null/undefined and de-dupe by phase so a
    // registered+declared pair for the same event doesn't double-render.
    const bindings = Array.isArray(hookBindings)
        ? hookBindings.filter(Boolean)
        : hookBindings
            ? [hookBindings]
            : [];
    const seenPhases = new Set();
    const uniqueBindings = [];
    for (const b of bindings) {
        const key = String(b.phase || "");
        if (seenPhases.has(key)) continue;
        seenPhases.add(key);
        uniqueBindings.push(b);
    }
    const isHookTarget = uniqueBindings.length > 0;

    // Trailing head-slot: passive "Hook auto-run" pill for hook targets
    // (they can't be added to the pipeline — the runtime dispatches them),
    // "+ Add" for regular commands.
    const headSlot = isHookTarget
        ? `<span class="mc-auto-run" aria-label="Runs automatically — cannot be added to pipeline" title="Runs automatically when a parent phase completes">🪝 Hook auto-run</span>`
        : `<span class="mc-add" role="button" tabindex="0" data-action="pipeline-add" data-command-id="${escapeHtml(artifact.id)}" aria-label="Add ${label} to pipeline" title="Add to pipeline">+ Add</span>`;

    // Trigger footer: mirrors the "next suggested task" pattern on
    // phase cards — dashed top divider, small uppercase heading, then
    // one row per binding so users can see every parent phase that
    // dispatches this command.
    const triggerRows = uniqueBindings.map((hb) => {
        const phase = String(hb.phase || "");
        const m = phase.match(/^(?:before|after)[_-](.+)$/);
        const parentCmd = m ? `/speckit-${m[1].replace(/_/g, "-")}` : "";
        const when = /^before/.test(phase) ? "before" : "after";
        if (!parentCmd) {
            return `<div class="mc-hook-footer-body" title="Runs automatically on ${escapeHtml(phase)}">Auto-runs on <code>${escapeHtml(phase)}</code></div>`;
        }
        return `<div class="mc-hook-footer-body" title="Runs automatically ${when} ${escapeHtml(parentCmd)} — cannot be added to the pipeline manually">Auto-runs ${when} <code>${escapeHtml(parentCmd)}</code></div>`;
    }).join("");
    const triggerFooter = isHookTarget && triggerRows
        ? `<div class="mc-hook-footer">
                <div class="mc-hook-footer-heading">Triggered by</div>
                ${triggerRows}
            </div>`
        : "";

    const cardClass = `more-cmd-card static extension-cmd-card${isHookTarget ? " is-hook-card" : ""}`;
    const kindAttr = isHookTarget ? ` data-artifact-kind="hook"` : "";
    return `<div class="${cardClass}" data-command-id="${escapeHtml(artifact.id)}"${kindAttr}>
        <div class="mc-head">
            ${labelEl}
            ${headSlot}
        </div>
        <div class="mc-cmd">${cmdLine}</div>
        ${desc ? `<p class="mc-desc">${escapeHtml(desc)}</p>` : ""}
        ${triggerFooter}
    </div>`;
}

export function renderMoreCommandsPanel() {
    const el = document.getElementById("more-commands");
    if (!el) return;
    const all = commands();
    if (!(state.moreCollapsedSections instanceof Set)) state.moreCollapsedSections = new Set();

    // `originKind` = "preset" | "core"; when preset, `presetMeta` is the
    // record from composition (for the pill tooltip / display name).
    const renderCard = (p, originKind = "core", presetMeta = null) => {
        const locked = p.locked ? " locked" : "";
        // For canonical commands prefer the hardcoded action-oriented
        // description over whatever helpText/title was scanned upstream
        // so tiles read consistently with the Composition Commands tab.
        const canonicalDesc = isCanonical(p.id) ? canonicalDescription(p.id) : "";
        const desc = canonicalDesc || p.helpText || p.title || "";
        const hints = __renderCommandCardHintsHtml(p);
        const label = escapeHtml(p.shortLabel || p.id);
        const sourcePath = commandSourcePath(p);
        const labelEl = sourcePath
            ? `<a class="mc-label mc-label-link" href="#" data-reveal-path="${escapeHtml(sourcePath)}" title="View ${escapeHtml(sourcePath)}">${label}</a>`
            : `<span class="mc-label">${label}</span>`;
        // Origin pill teaches the layering model at a glance:
        //  - CORE group          → "Core"       (canonical, no override wins here)
        //  - Preset group        → "Core • Custom" when the underlying id is
        //                          a canonical Spec Kit command being customized
        //                          by the preset; no pill when the preset adds
        //                          a command that isn't canonical (the "Preset:"
        //                          group heading already conveys that).
        //  - Extension group     → renderExtensionCommandCard handles its own pills
        let originPill;
        if (originKind === "core") {
            originPill = `<span class="comp-artifact-origin origin-core mc-origin-pill" title="Core Spec Kit command">Core</span>`;
        } else if (originKind === "preset") {
            const bareId = bareCommandId(p.id);
            if (isCanonical(bareId)) {
                originPill = `<span class="comp-artifact-origin origin-core mc-origin-pill" title="Core Spec Kit command customized by this preset">Core • Customized</span>`;
            } else {
                originPill = "";
            }
        } else {
            originPill = "";
        }
        return `<div class="more-cmd-card static${locked}" data-phase-id="${escapeHtml(p.id)}">
            <div class="mc-head">
                <div class="mc-head-left">
                    ${labelEl}
                </div>
                <span class="mc-add" role="button" tabindex="0" data-action="pipeline-add" data-command-id="${escapeHtml(p.id)}" aria-label="Add ${label} to pipeline" title="Add to pipeline">+ Add</span>
            </div>
            ${originPill ? `<div class="mc-origin-row">${originPill}</div>` : ""}
            <div class="mc-cmd"><code>/${escapeHtml(displayCommand(p.commandName))}</code></div>
            ${desc ? `<p class="mc-desc">${escapeHtml(desc)}</p>` : ""}
            ${hints}
        </div>`;
    };

    // Group preset-provided commands by the *winning* composition layer
    // (not the seed source). p.source reflects the preset that originally
    // seeded the phase; when a higher-precedence preset overrides it, the
    // seed is stale. Look up the artifact in composition.artifacts and
    // group by the active layer's presetId so commands appear under the
    // preset that actually wins.
    const collator = new Intl.Collator(undefined, { sensitivity: "base" });
    const compArtifacts = state.snapshot?.composition?.artifacts ?? [];
    const winnerByCmdId = new Map();
    for (const a of compArtifacts) {
        if (a.kind !== "command") continue;
        const active = (a.stack ?? []).find((l) => l.active);
        if (!active) continue;
        // Strip the "commands/" prefix so keys match p.commandName / phase ids.
        const bare = String(a.id || "").replace(/^commands\//, "");
        winnerByCmdId.set(bare, active);
        // ALSO index by the bare canonical alias (`constitution`, `specify`,
        // …). commands() phase ids come from the server-side scanner as the
        // short form, so a lookup on `p.id` for a lean-customized canonical
        // would otherwise miss the `commands/speckit.constitution` winner
        // and the phase would still appear under CORE even though a preset
        // replaced it. Uses the same canonical map that stripCommandsPrefix
        // uses so the two aliases stay in sync.
        const canonicalAlias = CANONICAL_BY_FULL[bare];
        if (canonicalAlias) winnerByCmdId.set(canonicalAlias, active);
    }
    const winnerSourceForPhase = (p) => {
        const cmd = p.commandName || p.id;
        const w = winnerByCmdId.get(cmd);
        if (!w) return p.source || "core";
        if (w.layer === "preset") return `preset:${w.presetId}`;
        if (w.layer === "core") return "core";
        // Extensions have their own dedicated section further down.
        return p.source || "core";
    };
    const presetGroups = new Map();
    for (const p of all) {
        const key = winnerSourceForPhase(p);
        // Skip commands attributed to "core" here — canonicals have their
        // own dedicated group synthesized below.
        if (key === "core") continue;
        if (!presetGroups.has(key)) presetGroups.set(key, []);
        presetGroups.get(key).push(p);
    }
    // Precedence is owned by the Spec Kit CLI (`specify preset resolve`)
    // and passed through in composition.presets[] by the speckit-preset
    // skill. The UI does no ordering of its own — it iterates presets in
    // payload order. Presets absent from the payload (e.g. an unknown
    // seed source referencing an uninstalled preset) are appended after,
    // in Map insertion order, so nothing silently disappears.
    const compPresetList = orderedCompositionPresets();
    const presetById = new Map();
    for (const pr of compPresetList) if (pr?.id) presetById.set(pr.id, pr);
    const presetIdFromSource = (source) => {
        const s = String(source || "");
        return s.startsWith("preset:") ? s.slice("preset:".length).split(":")[0] : s;
    };
    const isSectionOpen = (key) => !(state.moreCollapsedSections instanceof Set) || !state.moreCollapsedSections.has(key);

    // Build per-preset section HTML. Iterate composition.presets[] FIRST
    // (payload order = CLI-derived precedence), then any leftover groups
    // that reference unknown presets. Sections are appended in the order
    // the CLI returns — no local sort, no tie-breaker.
    const presetIdToSourceKey = new Map();
    for (const source of presetGroups.keys()) {
        presetIdToSourceKey.set(presetIdFromSource(source), source);
    }
    const emitPresetSection = (source, items) => {
        items.sort((a, b) => collator.compare(a.shortLabel || a.id, b.shortLabel || b.id));
        const openAttr = isSectionOpen(`preset:${source}`) ? " open" : "";
        const presetId = presetIdFromSource(source);
        const meta = presetById.get(presetId);
        const cards = items.map((p) => renderCard(p, "preset", meta)).join("");
        const displayName = (meta?.name || presetId).toUpperCase();
        return `<details class="mc-group"${openAttr} data-mc-section="preset:${escapeHtml(source)}">
            <summary class="mc-group-title"><span class="mc-group-kind-label">Preset:</span> <span class="mc-group-title-text">${escapeHtml(displayName)}</span> <span class="mc-group-count">${items.length}</span></summary>
            <div class="more-commands-grid">${cards}</div>
        </details>`;
    };
    const presetSectionHtmlParts = [];
    const consumedSources = new Set();
    for (const pr of compPresetList) {
        const source = presetIdToSourceKey.get(pr.id);
        if (!source) continue;
        presetSectionHtmlParts.push(emitPresetSection(source, presetGroups.get(source)));
        consumedSources.add(source);
    }
    for (const [source, items] of presetGroups.entries()) {
        if (consumedSources.has(source)) continue;
        presetSectionHtmlParts.push(emitPresetSection(source, items));
    }

    // Ids customized by any preset — routed under the preset section
    // instead of CORE. Uses the composition winner (not seed source) so
    // an overridden command doesn't double-appear.
    //
    // Two sources feed this set:
    //  1. Every `commands()` entry whose winner isn't core — catches
    //     preset-only phases the scanner surfaced but that aren't in the
    //     canonical spine.
    //  2. Every canonical id whose winner map entry is layer=preset —
    //     catches lean-replaced canonicals like `constitution`/`specify`
    //     even if the scanner doesn't surface them as scanner-side phases.
    //     Without this second pass, replaced canonicals appear under BOTH
    //     the preset section AND CORE.
    const customizedIds = new Set(
        all
            .filter((p) => {
                const key = winnerSourceForPhase(p);
                return key && key !== "core";
            })
            .map((p) => p.id),
    );
    for (const canonicalId of [...canonicalSpine(), ...CANONICAL_UNSEEDED]) {
        const w = winnerByCmdId.get(canonicalId);
        if (w && w.layer !== "core") customizedIds.add(canonicalId);
    }

    // CORE group: canonical Spec Kit phases NOT customized by any preset.
    // Shown regardless of pipeline membership so users can always browse
    // the full Spec Kit surface. Synthesize minimal card shapes since these
    // often aren't in commands(). CANONICAL_UNSEEDED (e.g. converge) is
    // included too — canonical add-on-demand commands outside the default flow.
    const coreCandidates = [
        ...canonicalSpine().filter((id) => !customizedIds.has(id)),
        ...CANONICAL_UNSEEDED.filter((id) => !customizedIds.has(id)),
    ];
    const coreCards = coreCandidates
        .map((id) => __synthesizeCanonicalPhase(id))
        .sort((a, b) => collator.compare(a.shortLabel || a.id, b.shortLabel || b.id))
        .map((p) => renderCard(p, "core"))
        .join("");
    const coreOpen = isSectionOpen("core") ? " open" : "";
    const coreSection = `<details class="mc-group mc-group-core"${coreOpen} data-mc-section="core">
        <summary class="mc-group-title"><span class="mc-group-title-text">CORE</span> <span class="mc-group-count">${coreCandidates.length}</span></summary>
        ${coreCandidates.length
            ? `<div class="more-commands-grid">${coreCards}</div>`
            : `<p class="mc-group-hint muted">All Core Spec Kit commands are customized by installed presets.</p>`}
    </details>`;

    // Extension groups. Emitted in composition.extensions[] payload order
    // (CLI-derived precedence). No local sorting.
    const compExtensions = orderedCompositionExtensions();
    const compArtifactsAll = state.snapshot?.composition?.artifacts ?? [];
    const extensionSectionHtmlParts = compExtensions.map((ext) => {
        // Extension items in the More-Commands panel: only user-invokable
        // commands render as cards. Hook artifacts share the same id as
        // the command they dispatch — we merge their `hookBinding` onto
        // the matching command card (auto-run pill + Triggered-by footer)
        // instead of surfacing them as a second card.
        const rawItems = compArtifactsAll.filter((a) => {
            if (a.kind !== "command" && a.kind !== "hook") return false;
            const active = (a.stack ?? []).find((l) => l.active);
            return active?.layer === "extension"
                && (active.extensionId === ext.id || active.presetId === ext.id);
        });
        // A single extension command can be the target of MULTIPLE hook
        // bindings (e.g. `speckit.agent-context.update` fires from both
        // `after_specify` AND `after_plan`). Collect every binding per
        // target command id so the card can render every parent phase in
        // its "Triggered by" footer — not just the last one seen.
        const hookBindingsByCommandId = new Map();
        for (const a of rawItems) {
            if (a.kind !== "hook") continue;
            const bindings = Array.isArray(a.hookBindings) && a.hookBindings.length
                ? a.hookBindings
                : (a.hookBinding ? [a.hookBinding] : []);
            if (!bindings.length) continue;
            const list = hookBindingsByCommandId.get(a.id) || [];
            for (const b of bindings) list.push(b);
            hookBindingsByCommandId.set(a.id, list);
        }
        const items = rawItems.filter((a) => {
            if (a.kind === "command") return true;
            // Include hook artifacts too, so extensions whose only
            // user-visible entry point is a hook target (e.g.
            // `agent-context.update`, which the assembler excludes from
            // the command kind because it's declared under `hooks:`) still
            // get a card — rendered as a passive hook tile with an
            // "Auto-runs" indicator and no + Add affordance. Skip any
            // hook whose id is already covered by a command in rawItems
            // (defensive; the assembler prevents this collision today).
            if (a.kind !== "hook") return false;
            return !rawItems.some((c) => c.kind === "command" && c.id === a.id);
        });
        items.sort((a, b) => collator.compare(a.id, b.id));
        const cards = items.map((art) => renderExtensionCommandCard(art, ext, hookBindingsByCommandId.get(art.id) || null)).join("");
        const openAttr = isSectionOpen(`extension:${ext.id}`) ? " open" : "";
        const displayName = (ext.name || ext.id).toUpperCase();
        return `<details class="mc-group mc-group-extension"${openAttr} data-mc-section="extension:${escapeHtml(ext.id)}">
            <summary class="mc-group-title"><span class="mc-group-kind-label">Extension:</span> <span class="mc-group-title-text">${escapeHtml(displayName)}</span> <span class="mc-group-count">${items.length}</span></summary>
            ${items.length
                ? `<div class="more-commands-grid">${cards}</div>`
                : `<p class="mc-group-hint muted">This extension provides no commands.</p>`}
        </details>`;
    });

    // Concatenate in payload order. Presets before extensions (extensions
    // are additive-only in the composition model). No sort, no tie-break —
    // ordering is owned by the CLI and passed through by the skill.
    const layerGroupsHtml = presetSectionHtmlParts.join("") + extensionSectionHtmlParts.join("");

    // Nothing to hide the panel over — always show it so CORE re-add is
    // always accessible even on bare projects.
    el.hidden = false;

    el.innerHTML = `
        <div class="more-commands-header">
            <span class="mc-summary-title">Available commands</span>
        </div>
        ${layerGroupsHtml}
        ${coreSection}
    `;
    // Persist per-section collapsed state so polling re-renders don't reset it.
    if (!(state.moreCollapsedSections instanceof Set)) state.moreCollapsedSections = new Set();
    el.querySelectorAll("details[data-mc-section]").forEach((det) => {
        det.addEventListener("toggle", () => {
            const key = det.dataset.mcSection;
            if (!key) return;
            if (det.open) state.moreCollapsedSections.delete(key);
            else state.moreCollapsedSections.add(key);
        });
    });
    el.querySelectorAll('[data-action="pipeline-add"]').forEach((add) => {
        const trigger = async (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            const id = add.dataset.commandId;
            if (!id) return;
            await dispatchPipeline("add", { id });
        };
        add.addEventListener("click", trigger);
        add.addEventListener("keydown", (ev) => {
            if (ev.key === "Enter" || ev.key === " ") trigger(ev);
        });
    });
    // Wire "open command file" links on each title.
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
}

// Resolve the on-disk markdown path for a command tile, when known.
// Priority:
//   1. composition activeLayer.sourcePath (accurate — includes preset overrides).
//   2. derived preset path from `p.source` + `p.commandName`.
// Returns null when the file isn't on disk (e.g. synthesized core-only commands).
export function commandSourcePath(p) {
    if (!p) return null;
    const activeLayer = lookupActiveLayer(p.id, p.commandName);
    if (activeLayer?.sourcePath) return activeLayer.sourcePath;
    // Derive from `source: "preset:<presetId>"` for preset-only commands
    // that don't have composition entries (game-narrative extras).
    if (typeof p.source === "string" && p.source.startsWith("preset:") && p.commandName) {
        const presetId = p.source.slice("preset:".length).split(":")[0];
        return `.specify/presets/${presetId}/commands/${p.commandName}.md`;
    }
    return null;
}

// Look up the winning composition layer for a command id (either "commands/<name>" or a phase id).
export function lookupActiveLayer(id, commandName) {
    const compArtifacts = state.snapshot?.composition?.artifacts ?? [];
    const cmdLookupId = commandName ? `commands/${commandName}` : null;
    const compArtifact =
        (cmdLookupId && compArtifacts.find((a) => a.id === cmdLookupId)) ||
        compArtifacts.find((a) => a.id === id);
    return (compArtifact?.stack ?? []).find((l) => l.active) || null;
}

