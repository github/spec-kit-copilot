// Composition tab: artifact rows (kind grouping + per-artifact stack).

import { escapeHtml } from "./client.js";
import { canonicalSpine, isCanonical, canonicalDescription, commandsForCoreScript, isSharedCoreScript, commandsForCoreTemplate } from "../pipeline/canonical.mjs";
import {
    state,
    bareCommandId,
    displayCommand,
} from "./state.js";
import {
    LAYER_LABEL,
    ARTIFACT_KIND_ORDER,
    ARTIFACT_KIND_LABEL,
    ARTIFACT_KIND_ICON,
    ORIGIN_LABEL,
    bareArtifactId,
    artifactOrigin,
    artifactPillOrigin,
    synthesizeCoreArtifacts,
    computeCompositionKindCounts,
    updateCompositionKindHeading,
    renderStackLayer,
    renderFlatLayerTable,
    wireFlatLayerActionButtons,
    deriveLayers,
} from "./composition.js";

// -------- Section: composition/artifact-rows.js --------

let __openArtifactViewer = () => {};

export function setArtifactRowsDeps({ openArtifactViewer }) {
    if (typeof openArtifactViewer === "function") __openArtifactViewer = openArtifactViewer;
}

export function renderCompositionArtifacts() {
    const host = document.getElementById("comp-artifacts");
    if (!host) return;
    const comp = state.snapshot.composition ?? {};
    let artifacts = comp.artifacts ?? [];
    const layers = deriveLayers(comp);
    const presets = comp.presets ?? [];
    const anyPresetInstalled = presets.some((p) => p.enabled !== false);

    // Fill in any missing core artifacts by ID. The composition.refresh
    // skill should emit the full core set, but if it omits some (or if
    // only extension-command artifacts were pushed), synthesize the
    // gaps so users always see the complete artifact inventory alongside
    // any extension-added commands. Explicit entries always win.
    const presentIds = new Set(artifacts.map((a) => a.id));
    const coreFill = synthesizeCoreArtifacts().filter((a) => !presentIds.has(a.id));
    if (coreFill.length) {
        artifacts = artifacts.concat(coreFill);
    }

    if (!artifacts.length) {
        // Fallback: no artifact resolution data yet, show the flat-layer
        // table so we still communicate something useful. `layers` always
        // contains at least the synthetic "core" row, so `layers.length <= 1`
        // means "no preset/extension installed" — surface a helpful hint
        // rather than the empty-header stack.
        if (layers.length <= 1) {
            host.innerHTML = state.compositionRequested
                ? `<div class="empty">Loading composition…</div>`
                : `<div class="empty">Refresh to load composition data.</div>`;
            return;
        }
        host.innerHTML = renderFlatLayerTable(layers);
        wireFlatLayerActionButtons(host);
        return;
    }

    const visible = artifacts;

    // `anyPresetInstalled` computed at top of function; used to gate the
    // "not customized by preset" neutral badge — noise on bare projects.

    // Group by artifact kind, preserving a stable order.
    const groups = new Map();
    for (const kind of ARTIFACT_KIND_ORDER) groups.set(kind, []);
    for (const a of visible) {
        const kind = ARTIFACT_KIND_ORDER.includes(a.kind) ? a.kind : "command";
        // Expand multi-binding hook artifacts (e.g. one hook command that
        // fires from BOTH `after_specify` AND `after_plan`) into one row
        // per binding on the Hooks tab so the count and rendering reflect
        // every phase the extension actually attaches to. Other tabs are
        // unaffected — the commands tab looks hooks up by target id
        // through `hookByTargetId`, which is built from the original
        // artifact list below.
        if (kind === "hook" && Array.isArray(a.hookBindings) && a.hookBindings.length > 1) {
            for (const binding of a.hookBindings) {
                groups.get(kind).push({
                    ...a,
                    hookBindings: [binding],
                    hookBinding: binding,
                });
            }
        } else {
            groups.get(kind).push(a);
        }
    }

    // Sort each group:
    //   commands  → canonical spine order first, then any preset-only /
    //               unknown commands alphabetically
    //   templates → alphabetical
    //   scripts   → alphabetical
    const canonicalOrder = new Map(canonicalSpine().map((id, i) => [id, i]));
    const commandRank = (a) => {
        // Ids arrive as `commands/<name>` from Wave A resolves; strip prefix.
        const bare = bareCommandId(a.id);
        return canonicalOrder.has(bare) ? canonicalOrder.get(bare) : Number.POSITIVE_INFINITY;
    };
    const alpha = (a, b) => String(a.id || "").localeCompare(String(b.id || ""));
    const commandCompare = (a, b) => {
        const ra = commandRank(a);
        const rb = commandRank(b);
        if (ra !== rb) return ra - rb;
        return alpha(a, b);
    };
    if (groups.has("command")) groups.get("command").sort(commandCompare);
    if (groups.has("template")) groups.get("template").sort(alpha);
    if (groups.has("script")) groups.get("script").sort(alpha);

    const parts = [];
    // Always emit one descriptor per kind so all four tabs (Commands /
    // Templates / Scripts / Hooks) render even when empty — an empty
    // panel shows a friendly "no X yet" message instead of the tab
    // disappearing.
    const kindDescriptors = [];
    for (const kind of ARTIFACT_KIND_ORDER) {
        const rows = groups.get(kind);
        const coreRows = rows.filter((a) => artifactOrigin(a) === "core");
        const addedRows = rows.filter((a) => artifactOrigin(a) !== "core");
        kindDescriptors.push({ kind, coreRows, addedRows, total: rows.length });
    }

    // Pick the active tab. Prefer the user's last selection; else the first
    // kind that actually has content; else fall back to Commands so the
    // active tab still resolves on a completely empty payload.
    const availableKinds = new Set(kindDescriptors.map((d) => d.kind));
    const firstNonEmpty = kindDescriptors.find((d) => d.total > 0)?.kind;
    let activeKind = state.compositionActiveKind && availableKinds.has(state.compositionActiveKind)
        ? state.compositionActiveKind
        : (firstNonEmpty ?? kindDescriptors[0].kind);
    state.compositionActiveKind = activeKind;

    // Hook-target lookup: every kind:"hook" artifact carries the id of the
    // command it dispatches. Build a `commandId → hookArtifact` map so a
    // command row can pick up its hook binding metadata (auto-run pill +
    // "Dispatched after /X" subline) even when we're viewing the Commands
    // subtab. The Hooks subtab is unaffected — hook artifacts still render
    // as their own rows there.
    // Hook-target lookup: every kind:"hook" artifact carries the id of the
    // command it dispatches. A command can be the target of MULTIPLE hooks
    // (e.g. `speckit.agent-context.update` fires from BOTH `after_specify`
    // AND `after_plan`) so we store an ARRAY of hook artifacts per target
    // id — collapsing to a single value here would silently drop trigger
    // rows on the target command's "Dispatched after /X" subline.
    const hookByTargetId = new Map();
    const sourceByCommandId = new Map();
    for (const a of visible) {
        if (a.kind === "hook") {
            const hasBindings = (Array.isArray(a.hookBindings) && a.hookBindings.length)
                || !!a.hookBinding;
            if (hasBindings) {
                const list = hookByTargetId.get(a.id) || [];
                list.push(a);
                hookByTargetId.set(a.id, list);
            }
        }
        if (a.kind === "command") {
            const activeL = (a.stack || []).find((l) => l.active);
            const sp = artifactSourcePath(a, activeL);
            if (sp) sourceByCommandId.set(a.id, sp);
        }
    }

    const renderBand = (label, bandRows) => bandRows.length
        ? `<div class="comp-artifact-subband">
               <div class="comp-artifact-subband-head">
                   <span class="comp-artifact-subband-label">${escapeHtml(label)}</span>
                   <span class="comp-artifact-subband-count">${bandRows.length}</span>
               </div>
               ${bandRows.map((a) => renderArtifactRow(a, { anyPresetInstalled, hookByTargetId, sourceByCommandId })).join("")}
           </div>`
        : "";

    // Copy dynamically per kind so the empty state reads naturally ("No
    // hooks are registered..." vs "No commands are provided...").
    const EMPTY_COPY = {
        command: {
            title: "No commands installed",
            hint: "Commands may be provided by presets or extensions. Additional commands will only be displayed here if a preset or extension that defines them is installed.",
        },
        template: {
            title: "No templates installed",
            hint: "Templates may be provided by presets or extensions. Templates will only be displayed here if a preset or extension that defines them is installed.",
        },
        script: {
            title: "No scripts installed",
            hint: "Scripts may be provided by presets or extensions. Scripts will only be displayed here if a preset or extension that defines them is installed.",
        },
        hook: {
            title: "No hooks installed",
            hint: "Hooks may be installed as part of an extension, and run automatically before or after a phase. Hooks will only be displayed here if an extension that defines them is installed.",
        },
    };

    const tabs = kindDescriptors.map(({ kind, total }) => {
        const isActive = kind === activeKind;
        const classes = ["subtab"];
        if (isActive) classes.push("is-active");
        return `<button class="${classes.join(" ")}" data-subtab="comp:${kind}" role="tab" aria-selected="${isActive ? "true" : "false"}">${escapeHtml(ARTIFACT_KIND_LABEL[kind])}</button>`;
    }).join("");

    const panels = kindDescriptors.map(({ kind, coreRows, addedRows, total }) => {
        const isActive = kind === activeKind;
        const body = total > 0
            ? `${renderBand("Core", coreRows)}${renderBand("Added", addedRows)}`
            : (() => {
                const copy = EMPTY_COPY[kind] ?? { title: "Nothing to show", hint: "" };
                return `<div class="comp-kind-empty">
                    <div class="comp-kind-empty-title">${escapeHtml(copy.title)}</div>
                    ${copy.hint ? `<div class="comp-kind-empty-hint">${escapeHtml(copy.hint)}</div>` : ""}
                </div>`;
            })();
        return `<div class="subtab-panel${isActive ? " is-active" : ""} comp-kind-panel kind-${kind}${total === 0 ? " is-empty" : ""}" data-subtab-panel="comp:${kind}" data-subtab-group="composition"${isActive ? "" : " hidden"}>
            ${body}
        </div>`;
    }).join("");

    parts.push(panels);

    // Inject the subtabs nav OUTSIDE the artifacts host so it sits above
    // the shared "Core / Layers" band header row. Injecting the panels
    // into the artifacts host below keeps subtab switching + panel
    // visibility wiring intact — the wiring uses host-relative
    // querySelectorAll on `.comp-subtabs` and `[data-subtab-panel]` and
    // now looks up the nav via the wizard `.wizard` root instead.
    const subtabsHost = document.getElementById("comp-subtabs-host");
    if (subtabsHost) {
        subtabsHost.innerHTML = `<nav class="subtabs comp-subtabs" role="tablist" aria-label="Artifact kind" data-subtab-group="composition">${tabs}</nav>`;
    }
    host.innerHTML = parts.join("");
    // Wire the just-injected composition subtabs — the global handler in
    // init() only bound to elements present at boot. Query the subtabs
    // via the subtabs-host + panels via the artifacts host.
    const navRoot = subtabsHost || host;
    navRoot.querySelectorAll('.subtabs[data-subtab-group="composition"] .subtab[data-subtab]').forEach((btn) => {
        btn.addEventListener("click", () => {
            const which = btn.dataset.subtab;
            navRoot.querySelectorAll('.subtabs[data-subtab-group="composition"] .subtab[data-subtab]').forEach((b) => {
                const active = b.dataset.subtab === which;
                b.classList.toggle("is-active", active);
                b.setAttribute("aria-selected", active ? "true" : "false");
            });
            host.querySelectorAll('[data-subtab-panel][data-subtab-group="composition"]').forEach((panel) => {
                const active = panel.dataset.subtabPanel === which;
                panel.classList.toggle("is-active", active);
                panel.hidden = !active;
            });
            state.compositionActiveKind = which.replace(/^comp:/, "");
            updateCompositionKindHeading();
        });
    });
    // Wire the artifact-id chips as links to their source files.
    for (const btn of host.querySelectorAll(".comp-artifact-id-link")) {
        btn.addEventListener("click", () => {
            const src = btn.getAttribute("data-artifact-src");
            if (!src) return;
            __openArtifactViewer({
                artifactPath: src,
                shortLabel: src.split("/").pop(),
                id: src,
            });
        });
    }
    // Wire hook-target jump links (parent command → hook-invoked command).
    // If the target lives in a different kind subtab, switch to it first,
    // then scroll the row into view and briefly flash it.
    for (const a of host.querySelectorAll(".comp-hook-jump[data-jump-to]")) {
        a.addEventListener("click", (ev) => {
            ev.preventDefault();
            const targetId = a.getAttribute("data-jump-to");
            if (!targetId) return;
            const row = host.querySelector(`.comp-artifact-row[data-canonical-id="${CSS.escape(targetId)}"]`);
            if (!row) return;
            const panel = row.closest('[data-subtab-panel][data-subtab-group="composition"]');
            if (panel && panel.hidden) {
                const which = panel.dataset.subtabPanel;
                const btn = host.querySelector(`.subtabs[data-subtab-group="composition"] .subtab[data-subtab="${CSS.escape(which)}"]`);
                if (btn) btn.click();
            }
            row.scrollIntoView({ behavior: "smooth", block: "center" });
            row.classList.add("is-jump-flash");
            setTimeout(() => row.classList.remove("is-jump-flash"), 1600);
        });
    }
    updateCompositionKindHeading();
}


export function renderArtifactRow(artifact, opts = {}) {
    const stack = (artifact.stack ?? []).slice();
    // Stack order is authoritative: it comes from the CLI's resolved
    // precedence state and must not be reconstructed from layer kinds.

    const activeLayer = stack.find((l) => l.active);
    const activeIsCore = activeLayer?.layer === "core";
    const isScript = artifact.kind === "script";
    const canonicalId = isCanonical(artifact.id) || isCanonical(bareCommandId(artifact.id));

    // Hook-target lookup: if this command row is the target of a hook
    // binding, opts.hookByTargetId will have an entry keyed by our id.
    // We treat the command row as "hook-invoked" and render the auto-run
    // pill + mandatory/optional chip + "Dispatched after /X" subline
    // pulled from the hook artifact's `hookBinding`.
    // `hookTargetOf` is now an array of hook artifacts (one per parent
    // phase). A command can be dispatched by multiple hooks (e.g.
    // `speckit.agent-context.update` fires from BOTH `after_specify` AND
    // `after_plan`) so we render one meta line per binding rather than
    // silently keeping just the last one.
    const hookTargetOf = (artifact.kind === "command" && opts.hookByTargetId instanceof Map)
        ? (opts.hookByTargetId.get(artifact.id) || null)
        : null;

    // Neutral pill: this artifact isn't customized by any installed preset —
    // core will run it. Shown for every kind (command / template / script)
    // when at least one preset is installed. On bare projects (no preset)
    // every row would wear it, which is noise, so we suppress it there.
    // Neutral "not customized by preset" badge was removed — the origin
    // badge (Core / Extension-only / Preset-only) already conveys where the
    // artifact comes from, so the extra pill was redundant noise.
    const neutralBadge = "";

    // Strategy chip previously lived here on the row summary; it now
    // sits inline inside the preset layer that applies it (see
    // `renderStackLayer`), so the causal link between preset and
    // strategy is explicit and there's no double-labeling.
    const strategyChip = "";

    const stackHtml = stack.length
        ? stack.map((l, i) => renderStackLayer(l, artifact, i)).join("")
        : `<div class="comp-stack-layer is-active">
              <span class="layer-label"><span class="layer-dot layer-core"></span>Core <span class="muted">(default)</span></span>
              <span></span>
              <span></span>
              <span class="layer-marker">← active</span>
           </div>`;

    // Scripts are helpers commands shell out to, not pipeline steps —
    // suppress any description so the row stays clean; the "Used by"
    // sub-line already communicates the relationship to commands.
    // For canonical commands, fall back to the hardcoded action-oriented
    // description in canonical.mjs so core rows aren't left blank when
    // the composition payload doesn't carry a description.
    let description;
    if (isScript) {
        description = "";
    } else if (artifact.kind === "command") {
        const bare = bareCommandId(artifact.id);
        description = artifact.description || canonicalDescription(bare);
    } else {
        description = artifact.description;
    }

    // Display id — always show a `<kind-plural>/<name>` relative-path
    // form so commands / templates / scripts read consistently. Core
    // template ids come in bare from the payload, so re-derive from the
    // artifact's kind rather than trusting whatever prefix is on the id.
    const kindPrefix = { command: "commands", template: "templates", script: "scripts", hook: "hooks" }[artifact?.kind] || "";
    const bare = bareArtifactId(artifact);
    const displayId = kindPrefix ? `${kindPrefix}/${bare}` : bare;

    // Compute the on-disk path for this artifact. Prefer the winning layer's
    // resolved `sourcePath` (accurate for preset overrides + core alike when
    // the CLI reported it); otherwise synthesize the expected core path based
    // on kind so the core-only fallback (no CLI resolves yet) still links.
    // For hook artifacts, prefer the target command's .md file — clicking the
    // hook id opens the command that actually runs, which is more useful than
    // opening the `extension.yml` wiring declaration.
    let sourcePath = artifactSourcePath(artifact, activeLayer);
    const _isHookHere = artifact.kind === "hook";
    // For hook artifacts, the artifact.id is already the target command
    // id (e.g. "commands/speckit.companion.capture"). Prefer opening that
    // command's .md rather than the extension.yml wiring declaration.
    let _hookTargetLabel = "";
    if (_isHookHere) {
        const sourceByCommandId = opts?.sourceByCommandId;
        const targetSrc = sourceByCommandId
            ? (sourceByCommandId.get(artifact.id) || sourceByCommandId.get(bareCommandId(artifact.id)))
            : "";
        if (targetSrc) {
            sourcePath = targetSrc;
            _hookTargetLabel = `/${bareCommandId(artifact.id)}`;
        }
    }
    const idTitle = _hookTargetLabel
        ? `Open ${sourcePath} — runs ${_hookTargetLabel}`
        : `Open ${sourcePath}`;
    const idHtml = sourcePath
        ? `<button type="button" class="phase-artifact-link comp-artifact-id-link" data-artifact-src="${escapeHtml(sourcePath)}" title="${escapeHtml(idTitle)}"><code class="comp-artifact-id">${escapeHtml(displayId)}</code></button>`
        : `<span class="comp-artifact-id">${escapeHtml(displayId)}</span>`;

    // Hook attributions — extensions that augment this artifact via
    // `.specify/extensions.yml` (e.g. `before_specify`, `after_plan`).
    // Rendered as small chips beneath the head so the causal link is
    // legible. Each chip surfaces the target command that the hook
    // dispatches (so users can trace "what actually runs?") and the
    // mandatory/optional flag alongside the extension attribution.
    const hookList = Array.isArray(artifact.hooks) ? artifact.hooks : [];
    const hooksHtml = hookList.length
        ? `<div class="comp-artifact-hooks">${hookList.map((h) => {
              const phase = escapeHtml(String(h.phase || ""));
              const extName = escapeHtml(String(h.extensionName || h.extensionId || ""));
              const target = String(h.targetCommand || "");
              // Target command opens the underlying .md file (same
              // behavior as the row's id chip). Resolved via the
              // sourceByCommandId map built by renderCompositionArtifacts.
              const sourceByCommandId = opts?.sourceByCommandId;
              const targetSrc = target && sourceByCommandId
                  ? sourceByCommandId.get(`commands/${target}`) || sourceByCommandId.get(target)
                  : "";
              const targetHtml = target
                  ? (targetSrc
                      ? `<span class="comp-hook-chip-sep">→</span>
                         <button type="button" class="comp-hook-chip-target comp-artifact-id-link" data-artifact-src="${escapeHtml(targetSrc)}" title="Open ${escapeHtml(targetSrc)}"><code>/${escapeHtml(target)}</code></button>`
                      : `<span class="comp-hook-chip-sep">→</span>
                         <span class="comp-hook-chip-target"><code>/${escapeHtml(target)}</code></span>`)
                  : "";
              const tip = target
                  ? `Runs /${target} after ${h.phase || "phase"} (${h.extensionName || h.extensionId || "extension"})`
                  : `${h.extensionName || h.extensionId || "Extension"} attaches ${h.phase || "hook"}`;
              return `<span class="comp-hook-chip" title="${escapeHtml(tip)}">
                  <span class="comp-hook-icon" aria-hidden="true">🪝</span>
                  <span class="comp-hook-chip-ext"><span class="comp-hook-chip-label">Extension</span> <strong>${extName}</strong></span>
                  <span class="comp-hook-chip-sep">·</span>
                  <span class="comp-hook-chip-phase"><code>${phase}</code> <span class="comp-hook-chip-label">hook</span></span>
                  ${targetHtml}
              </span>`;
          }).join("")}</div>`
        : "";

    // Inline icon in the head so mixed lists read at a glance;
    // paired with the `.kind-<kind>` left-rail color via CSS.
    const kindClass = ARTIFACT_KIND_ORDER.includes(artifact.kind) ? artifact.kind : "command";
    const kindIcon = ARTIFACT_KIND_ICON[kindClass] || "";
    const kindIconHtml = kindIcon
        ? `<span class="comp-artifact-kind-icon" aria-hidden="true">${kindIcon}</span>`
        : "";

    // Treat as "hook-shaped" both:
    //   • the standalone hook artifact row (kind === "hook"), and
    //   • a command row that is the TARGET of a hook binding.
    // Both surfaces get the same auto-run pill, Required/Optional chip,
    // and "Dispatched after /X" subline — so users see the same wiring
    // whether they're browsing hooks or the commands the hooks dispatch.
    const isHook = artifact.kind === "hook";
    // Normalize the hook-target attribution into an array of bindings so
    // downstream chips render one entry per parent phase. For standalone
    // hook rows, the artifact IS the hook, so wrap its single binding.
    const hookTargetBindings = isHook
        ? (Array.isArray(artifact.hookBindings) && artifact.hookBindings.length
            ? artifact.hookBindings
            : (artifact.hookBinding ? [artifact.hookBinding] : []))
        : (Array.isArray(hookTargetOf)
            ? hookTargetOf.flatMap((h) => (
                Array.isArray(h?.hookBindings) && h.hookBindings.length
                    ? h.hookBindings
                    : (h?.hookBinding ? [h.hookBinding] : [])
            ))
            : hookTargetOf?.hookBinding
                ? [hookTargetOf.hookBinding]
                : []);
    const isHookTarget = !isHook && hookTargetBindings.length > 0;
    // Required/Optional chip on standalone hook rows. The artifact may have
    // multiple bindings (e.g. after_specify + after_plan) — if ANY binding
    // is Required (non-optional), the whole hook is Required (it will
    // definitely fire on that path). Otherwise Optional.
    const hb = isHook
        ? (hookTargetBindings.length
            ? { optional: hookTargetBindings.every((b) => b?.optional) }
            : (artifact.hookBinding ?? null))
        : null;
    // Auto-run pill on hook-target command rows (the standalone hook row
    // already reads as a hook via its kind icon + `is-hook` class, so
    // this pill lives on command-kind rows only, next to the origin badge).
    const autoRunPill = isHookTarget
        ? `<span class="comp-artifact-auto-run" title="Runs automatically when a parent phase completes">🪝 Hook auto-run</span>`
        : "";
    // Required/Optional chip lives on the head-top row alongside the
    // strategy chip so all "modifier" pills sit in one place.
    const mandatoryChip = (isHook && hb)
        ? `<span class="comp-artifact-strategy-chip comp-hook-mandatory-chip ${hb.optional ? "is-optional" : "is-mandatory"}" title="${hb.optional ? "Parent command will offer to run this — user can skip" : "Runs unconditionally after the parent phase — user cannot skip"}">${hb.optional ? "Optional" : "Required"}</span>`
        : "";
    const hookMetaHtml = (isHook || isHookTarget)
        ? (() => {
              // Derive the parent user-facing slash command from the hook
              // event key. Convention: `<before|after>[_-]<cmd>` → `/speckit.<cmd>`
              // (e.g. `after_specify` → `/speckit.specify`). If we can't parse
              // the phase, fall back to showing the raw event key. One
              // sentence per binding so multi-hook targets show every
              // parent phase.
              const sentences = hookTargetBindings.map((binding) => {
                  const phase = String(binding.phase || "");
                  const m = phase.match(/^(?:before|after)[_-](.+)$/);
                  const parentCmd = m ? `/speckit-${m[1].replace(/_/g, "-")}` : "";
                  const yamlPath = phase;
                  const head = parentCmd
                      ? `Dispatched after <code class="comp-hook-parent-cmd">${escapeHtml(parentCmd)}</code>`
                      : `Dispatched on <code class="comp-hook-parent-cmd">${escapeHtml(phase)}</code>`;
                  const via = `via the <code class="comp-hook-event-key">${escapeHtml(yamlPath)}</code> hook event`;
                  const tail = binding.manifestPath
                      ? ` — <button type="button" class="comp-hook-manifest-link comp-artifact-id-link" data-artifact-src="${escapeHtml(binding.manifestPath)}" title="View wiring declaration in ${escapeHtml(binding.manifestPath)}">declared in <code>extension.yml</code></button>`
                      : "";
                  return `<div class="comp-hook-sentence" title="Runs when the parent phase completes">${head} ${via}${tail}</div>`;
              }).join("");
              return sentences
                  ? `<div class="comp-artifact-hook-meta">${sentences}</div>`
                  : "";
          })()
        : "";

    // Origin badge — reflects which layer is currently providing the artifact.
    // Core-inventory rows overridden by a preset (e.g. Lean's replacements)
    // read as "Preset" here; the Core/Added band split still uses the strict
    // core-inventory check so those rows stay grouped under Core.
    const origin = artifactPillOrigin(artifact);
    const originTitle = origin === "core"
        ? "Provided by the Spec Kit core inventory"
        : origin === "extension"
            ? "Provided by an installed extension"
            : "Provided by an installed preset";
    const originBadge = `<span class="comp-artifact-origin origin-${origin}" title="${escapeHtml(originTitle)}">${escapeHtml(ORIGIN_LABEL[origin])}</span>`;

    // "Used by" sub-line for script artifact rows — tells the user which
    // canonical command(s) invoke this script, sourced from the hardcoded
    // mapping in `core-capabilities.mjs` (`commandsForCoreScript`).
    // Shared-library scripts (like `common`) render "Shared library (used
    // by other scripts)" instead. Non-core / preset-added scripts have no
    // canonical mapping and get no sub-line here — their attribution comes
    // from the stack rows below.
    const scriptUsedByHtml = (() => {
        if (artifact.kind !== "script") return "";
        const bare = String(artifact.id || "").replace(/^scripts\//, "");
        if (!bare) return "";
        if (isSharedCoreScript(bare)) {
            return `<div class="comp-artifact-usedby comp-artifact-usedby-shared" title="Sourced by other scripts, not invoked directly by any command">Shared library — used by other scripts</div>`;
        }
        const cmds = commandsForCoreScript(bare);
        if (cmds.length === 0) return "";
        const chips = cmds.map((cmdId) => {
            const dash = cmdId.replace(/^speckit\./, "speckit-");
            return `<code class="comp-artifact-usedby-cmd">/${escapeHtml(dash)}</code>`;
        }).join(" ");
        return `<div class="comp-artifact-usedby" title="This core script is invoked by the canonical body of these commands">Used by ${chips}</div>`;
    })();

    // "Used by" sub-line for template artifact rows — tells the user which
    // canonical command(s) load this template, sourced from the hardcoded
    // mapping in `core-capabilities.mjs` (`commandsForCoreTemplate`). Non-core
    // / preset-added templates with no canonical mapping get no sub-line —
    // their attribution comes from the stack rows below.
    const templateUsedByHtml = (() => {
        if (artifact.kind !== "template") return "";
        const bare = String(artifact.id || "").replace(/^templates\//, "").replace(/\.md$/, "");
        if (!bare) return "";
        const cmds = commandsForCoreTemplate(bare);
        if (cmds.length === 0) return "";
        const chips = cmds.map((cmdId) => {
            const dash = cmdId.replace(/^speckit\./, "speckit-");
            return `<code class="comp-artifact-usedby-cmd">/${escapeHtml(dash)}</code>`;
        }).join(" ");
        return `<div class="comp-artifact-usedby" title="This core template is loaded by the canonical body of these commands">Used by ${chips}</div>`;
    })();

    return `<div class="comp-artifact-row kind-${kindClass} origin-${origin}${isHook ? " is-hook" : ""}${isHookTarget ? " is-hook-target" : ""}" data-canonical-id="${escapeHtml(canonicalId || artifact.id || "")}">
        <div class="comp-artifact-head">
            <div class="comp-artifact-head-top">
                ${kindIconHtml}${idHtml}${originBadge}${autoRunPill}
                ${neutralBadge}${strategyChip}${mandatoryChip}
            </div>
            ${description ? `<div class="comp-artifact-head-desc">${escapeHtml(description)}</div>` : ""}
            ${hookMetaHtml}
            ${scriptUsedByHtml}
            ${templateUsedByHtml}
        </div>
        ${hooksHtml}
        <div class="comp-stack">${stackHtml}</div>
    </div>`;
}

/**
 * Resolve an on-disk relative path for a composition artifact so its ID
 * chip can link to the underlying file. Prefers the winning layer's
 * `sourcePath` (what `specify preset resolve` reported); falls back to
 * conventional core locations when only kind + id are known.
 */
export function artifactSourcePath(artifact, activeLayer) {
    if (activeLayer?.sourcePath) return activeLayer.sourcePath;
    const rawId = String(artifact?.id || "");
    if (!rawId) return null;
    switch (artifact?.kind) {
        case "command": {
            // Ids arrive as `commands/speckit.<name>` (or bare `speckit.<name>`).
            const bare = bareCommandId(rawId);
            if (!bare) return null;
            return `.github/skills/speckit-${bare}/SKILL.md`;
        }
        case "template": {
            const bare = rawId.replace(/^templates\//, "").replace(/\.md$/, "");
            if (!bare) return null;
            return `.specify/templates/${bare}.md`;
        }
        case "script": {
            const bare = rawId.replace(/^scripts\//, "");
            if (!bare) return null;
            // Wizard scaffolds PowerShell flavor on Windows via `--script ps`.
            // If a `.ps1` isn't there the viewer will report missing; the
            // link still points at the canonical location.
            return `.specify/scripts/powershell/${bare}.ps1`;
        }
        default:
            return null;
    }
}

