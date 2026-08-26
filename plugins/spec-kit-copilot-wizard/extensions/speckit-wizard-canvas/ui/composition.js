// Consolidated Composition tab (Copilot plugins/extensions/bundles/presets stack).

import { escapeHtml, dispatchKind } from "./client.js";
import { CORE_INVENTORY } from "../pipeline/canonical.mjs";
import {
    state,
    orderedCompositionPresets,
    orderedCompositionExtensions,
    capitalize,
} from "./state.js";
import { DEFAULT_INSTALL_PRESET_IDS } from "./catalog.js";
import {
    renderCompositionArtifacts,
    setArtifactRowsDeps,
} from "./composition-artifacts.js";
import { parseLookupId } from "./lookup-id.mjs";

// -------- Section: composition/layers.mjs --------
// Single source of truth for the composition layer-stack order.
// Speckit stacks contributors bottom-to-top as: core → extensions → presets.
// Presets sit at the top and win over extensions; extensions stack on core.
// Consumers that need the flat `layers` shape (a UI fallback table and the
// per-tab summary count) derive it here from the authoritative
// `{ presets, extensions }` slices instead of caching a separate array —
// that way the order can't drift between producers.

export function deriveLayers({ presets = [], extensions = [] } = {}) {
    const layers = [
        { kind: "core", name: "core", source: "builtin", version: null, contributes: "Base spec-kit" },
    ];
    for (const e of Array.isArray(extensions) ? extensions : []) {
        if (!e || typeof e !== "object") continue;
        const name = typeof e.name === "string" ? e.name : (typeof e.id === "string" ? e.id : null);
        if (!name) continue;
        layers.push({
            kind: "extension",
            name,
            source: typeof e.source === "string" ? e.source : "catalog",
            version: typeof e.version === "string" ? e.version : null,
            contributes: typeof e.description === "string" ? e.description : "",
        });
    }
    for (const p of Array.isArray(presets) ? presets : []) {
        if (!p || typeof p !== "object") continue;
        const name = typeof p.name === "string" ? p.name : (typeof p.id === "string" ? p.id : null);
        if (!name) continue;
        layers.push({
            kind: "preset",
            name,
            source: typeof p.source === "string" ? p.source : "catalog",
            version: typeof p.version === "string" ? p.version : null,
            contributes: typeof p.description === "string" ? p.description : "",
        });
    }
    return layers;
}

// -------- Section: composition/helpers.js --------

export const LAYER_LABEL = {
    preset: "Preset",
    extension: "Extension",
    core: "Core",
};
export const ARTIFACT_KIND_ORDER = ["command", "template", "script", "hook"];
export const ARTIFACT_KIND_LABEL = {
    command: "Commands",
    template: "Templates",
    script: "Scripts",
    hook: "Hooks",
};
export function formatArtifactCounts(counts, kinds = ARTIFACT_KIND_ORDER) {
    return kinds.map((kind) => {
        const label = ARTIFACT_KIND_LABEL[kind].toLowerCase().replace(/s$/, "");
        const count = counts?.[kind] ?? 0;
        return `${count} ${label}${count === 1 ? "" : "s"}`;
    }).join(", ");
}
// Icons rendered inline on each artifact row so scanning a mixed page of
// commands / templates / scripts is a glance rather than a text read.
// The left-rail color is applied via `.kind-<kind>` in CSS.
export const ARTIFACT_KIND_ICON = {
    command: "⚡",
    template: "📄",
    script: "🔧",
    hook: "🪝",
};

// Origin — where the artifact fundamentally comes from, independent of
// which layer is currently winning. Core-origin ids are the canonical
// inventory shipped by spec-kit; anything else is "added" by an extension
// or preset.
export function bareArtifactId(artifact) {
    return String(artifact?.id || "")
        .replace(/^commands\//, "")
        .replace(/^templates\//, "")
        .replace(/^scripts\//, "")
        .replace(/^hooks\//, "");
}
export function artifactOrigin(artifact) {
    const kind = artifact?.kind || "command";
    // Hooks are always extension-provided auto-run wiring — there's no
    // core or preset-only equivalent, so short-circuit before the core
    // inventory check (which would miss the "commands/" prefix anyway).
    if (kind === "hook") return "extension";
    const bare = bareArtifactId(artifact);
    const coreSet = CORE_INVENTORY[kind] ?? [];
    if (coreSet.includes(bare)) return "core";
    const stack = artifact?.stack ?? [];
    if (stack.some((l) => l.layer === "extension")) return "extension";
    return "preset";
}
export const ORIGIN_LABEL = { core: "Core", extension: "Extension", preset: "Preset" };

// Pill origin — reflects which layer is currently *providing* the artifact,
// independent of whether the bare id is in the core inventory. This is what
// drives the small badge next to the artifact id. A core-inventory command
// that a preset replaces (e.g. Lean's `speckit.constitution`) reads as
// "Preset" here because the preset is the active provider; the band split
// below still uses `artifactOrigin` so those rows stay in the Core band.
export function artifactPillOrigin(artifact) {
    const kind = artifact?.kind || "command";
    if (kind === "hook") return "extension";
    const stack = artifact?.stack ?? [];
    const active = stack.find((l) => l.active) ?? stack[0];
    if (active?.layer === "preset") return "preset";
    if (active?.layer === "extension") return "extension";
    if (stack.some((l) => l.layer === "preset")) return "preset";
    if (stack.some((l) => l.layer === "extension")) return "extension";
    return "core";
}

// Core-only fallback: when no preset is installed and refresh hasn't
// populated `composition.artifacts`, synthesize a static Core inventory
// from the shared `core-inventory.mjs` list (same list `composition.refresh`
// feeds to the LLM). Each artifact carries a single `layer: 'core'` entry
// so the same row/stack renderer works unchanged.
export function synthesizeCoreArtifacts() {
    const out = [];
    for (const kind of ARTIFACT_KIND_ORDER) {
        const ids = CORE_INVENTORY[kind] ?? [];
        const prefix = kind === "command" ? "commands/" : "";
        for (const id of ids) {
            out.push({
                id: `${prefix}${id}`,
                kind,
                stack: [{ layer: "core", active: true }],
            });
        }
    }
    return out;
}

export function computeProviderContributions(artifacts) {
    // Walk the artifacts stack and tally, per preset/extension id, how many
    // core-inventory artifacts it contributes to ("customized") vs new
    // artifacts outside the core inventory ("added"). Used to describe what
    // each provider is doing in the sidebar without hard-coding counts.
    const out = new Map();
    for (const a of artifacts ?? []) {
        const kind = ARTIFACT_KIND_ORDER.includes(a.kind) ? a.kind : "command";
        const isCore = artifactOrigin(a) === "core";
        // Hook artifacts merge multiple bindings (e.g. same hook command
        // fired from both `after_specify` AND `after_plan`) into a single
        // artifact. Count each binding as its own contribution so the
        // per-extension totals match the Hooks subtab.
        const weight = kind === "hook"
            ? Math.max(1, Array.isArray(a.hookBindings) ? a.hookBindings.length : 0)
            : 1;
        const seen = new Set();
        for (const layer of a.stack ?? []) {
            if (layer.layer !== "preset" && layer.layer !== "extension") continue;
            // Prefer the deterministic lookupId's providerId; fall back to
            // legacy presetId/extensionId for wizard-synthesized hook layers
            // (applyHookAttributions writes lookupId: null — see
            // composition/artifact-cli.mjs). This fallback can be deleted
            // once spec-kit issue #4343 ("Expose hook contributions and
            // runtime bindings via specify artifact") lands AND the wizard
            // migrates off applyHookAttributions to consume CLI-native hook
            // artifacts directly (tracked alongside #4209) — at that point
            // every hook layer will carry a real, non-null lookupId and this
            // fallback becomes dead code. Landing #4343 alone is not
            // sufficient; applyHookAttributions must stop synthesizing
            // lookupId: null first.
            const id = parseLookupId(layer.lookupId)?.providerId
                ?? layer.presetId
                ?? layer.extensionId;
            if (!id || seen.has(id)) continue;
            seen.add(id);
            let bucket = out.get(id);
            if (!bucket) {
                bucket = { customized: {}, added: {} };
                out.set(id, bucket);
            }
            const target = isCore ? bucket.customized : bucket.added;
            target[kind] = (target[kind] ?? 0) + weight;
        }
    }
    return out;
}

export function describeProviderContribution(providerId, contributions, { includeHooks = true } = {}) {
    const b = contributions.get(providerId) ?? { customized: {}, added: {} };
    const kinds = includeHooks
        ? ARTIFACT_KIND_ORDER
        : ARTIFACT_KIND_ORDER.filter((k) => k !== "hook");
    const counts = Object.fromEntries(
        kinds.map((kind) => [
            kind,
            (b.customized[kind] ?? 0) + (b.added[kind] ?? 0),
        ]),
    );
    return `Provides ${formatArtifactCounts(counts, kinds)}`;
}


// -------- Section: composition/summary.js --------

// Compute per-kind Core / Overridden / Added counts from the artifact list.
// Used by the summary line (aggregate description) and the artifact renderer
// (to gate empty kinds out of the subtab bar). "Overridden" separates the
// core-inventory rows that a preset/extension is currently replacing from the
// ones still resolved from stock core — hiding that split makes preset
// customization look like it did nothing when it really re-implemented core
// commands under the same name. Returns
// `{ command: { core, overridden, added, total }, ... }`.
export function computeCompositionKindCounts(artifacts) {
    const out = {};
    for (const kind of ARTIFACT_KIND_ORDER) out[kind] = { core: 0, overridden: 0, added: 0, total: 0 };
    for (const a of artifacts ?? []) {
        const kind = ARTIFACT_KIND_ORDER.includes(a.kind) ? a.kind : "command";
        const origin = artifactOrigin(a);
        const pill = artifactPillOrigin(a);
        // Hook artifacts merge multiple bindings (e.g. same hook command
        // fired from both `after_specify` AND `after_plan`) into a single
        // artifact. Count each binding as its own row so the header
        // summary matches the per-binding rows the Hooks subtab renders.
        const weight = kind === "hook"
            ? Math.max(1, Array.isArray(a.hookBindings) ? a.hookBindings.length : 0)
            : 1;
        out[kind].total += weight;
        if (origin === "core") {
            if (pill === "core") out[kind].core += weight;
            else out[kind].overridden += weight;
        } else {
            out[kind].added += weight;
        }
    }
    return out;
}

export function renderCompositionSummary() {
    const el = document.getElementById("comp-summary");
    if (!el) return;
    const comp = state.snapshot.composition ?? {};
    const presets = comp.presets ?? [];
    const extensions = comp.extensions ?? [];
    let artifacts = comp.artifacts ?? [];
    const layers = deriveLayers(comp);

    if (!presets.length && !extensions.length && !artifacts.length && layers.length <= 1) {
        el.innerHTML = `Only core is active. Add a preset or extension from the <strong>Catalogs</strong> page to layer on top of it — refresh this page afterward to see the change reflected here.`;
        return;
    }
    if (!artifacts.length && !presets.length && !extensions.length) {
        const nonCore = layers.filter((l) => l.kind !== "core");
        el.innerHTML = `Core + <strong>${nonCore.length}</strong> layer${nonCore.length === 1 ? "" : "s"} — refresh for detailed stack.`;
        return;
    }

    // Include synthesized core fill (same logic as renderCompositionArtifacts)
    // so the counts here match the tabs the user actually sees below.
    const presentIds = new Set(artifacts.map((a) => a.id));
    const coreFill = synthesizeCoreArtifacts().filter((a) => !presentIds.has(a.id));
    if (coreFill.length) artifacts = artifacts.concat(coreFill);

    const counts = computeCompositionKindCounts(artifacts);
    // Emit one bullet per non-empty kind. Core is reported as the full
    // inventory count with an optional "(N customized)" qualifier that
    // names how many are currently provided by a preset/extension instead
    // of stock core — that keeps the top-line Core number honest (10 stays
    // 10) while still surfacing the preset customization the user did.
    const items = ARTIFACT_KIND_ORDER.map((kind) => {
        const c = counts[kind];
        if (!c.total) return null;
        const bits = [];
        const coreTotal = c.core + c.overridden;
        if (coreTotal) {
            const qualifier = c.overridden ? ` (<strong>${c.overridden}</strong> customized)` : "";
            bits.push(`Core <strong>${coreTotal}</strong>${qualifier}`);
        }
        if (c.added) bits.push(`Added <strong>${c.added}</strong>`);
        if (!bits.length) return null;
        return `<li><span class="comp-summary-kind">${escapeHtml(ARTIFACT_KIND_LABEL[kind])}</span> — ${bits.join(", ")}</li>`;
    }).filter(Boolean);
    // Lead-in: installed preset / extension totals (enabled only). Gives
    // the user a one-glance answer to "what's actually stacked on core?"
    // before they scan the per-kind artifact bullets below.
    const enabledPresets = presets.filter((p) => p.enabled !== false).length;
    const enabledExtensions = extensions.filter((e) => e.enabled !== false).length;
    const totalsBits = [];
    if (enabledPresets) {
        totalsBits.push(`<strong>${enabledPresets}</strong> preset${enabledPresets === 1 ? "" : "s"}`);
    }
    if (enabledExtensions) {
        totalsBits.push(`<strong>${enabledExtensions}</strong> extension${enabledExtensions === 1 ? "" : "s"}`);
    }
    const totalsLine = totalsBits.length
        ? `<div class="comp-summary-totals">${totalsBits.join(" · ")} installed</div>`
        : "";
    el.innerHTML = items.length
        ? `${totalsLine}<ul class="comp-summary-list">${items.join("")}</ul>`
        : totalsLine || `No artifacts yet — refresh to load composition data.`;
}

const COMP_KIND_HEADING = {
    command: "Command stack",
    template: "Template stack",
    script: "Script stack",
    hook: "Hook stack",
};
export function updateCompositionKindHeading() {
    const el = document.getElementById("comp-kind-heading");
    if (!el) return;
    const kind = state.compositionActiveKind || "command";
    el.textContent = COMP_KIND_HEADING[kind] || "Command stack";
}


// -------- Section: composition/stack-layer.js --------

export function renderStackLayer(layer, artifact, layerIdx) {
    const isCore = layer.layer === "core";
    const isActive = !!layer.active;
    const layerLabel = LAYER_LABEL[layer.layer] ?? layer.layer;
    const providerName = layer.presetName
        || layer.extensionName
        || layer.name
        || layer.presetId
        || layer.extensionId;
    const nameParts = [];
    if (providerName && !isCore) {
        nameParts.push(`${layerLabel}:`);
        nameParts.push(escapeHtml(providerName));
    } else if (isCore) {
        nameParts.push(layerLabel);
        nameParts.push('<span class="muted">(default)</span>');
    } else {
        nameParts.push(layerLabel);
    }
    // Shadowing rule (matches CLI `preset resolve` semantics):
    // `effectiveBaseIdx` is the index of the topmost `replace` layer in the
    // stack (scanning highest-precedence first). Contributing layers live at
    // index <= effectiveBaseIdx; anything below it is shadowed by the
    // effective base and would never affect the resolved output. When the
    // payload omits the field (e.g. legacy caller, single-layer stack),
    // fall back to the older "non-active non-core = shadowed" rule which
    // is correct for all-replace stacks.
    const stack = Array.isArray(artifact?.stack) ? artifact.stack : [];
    const effBase = Number.isInteger(artifact?.effectiveBaseIdx)
        ? artifact.effectiveBaseIdx
        : null;
    const idx = Number.isInteger(layerIdx) ? layerIdx : stack.indexOf(layer);
    const isShadowedByBase = effBase !== null && idx > effBase;
    let marker = "";
    if (isActive) {
        marker = "← active";
    } else if (isCore) {
        marker = "fallback";
    } else if (isShadowedByBase) {
        marker = "shadowed";
    } else {
        marker = "contributes";
    }
    // Strategy pill sits inline in the preset layer that applies it —
    // e.g. "Preset · Some Name  [Replace]" — so the causal
    // link between layer and strategy is legible.
    //
    // Skip the chip for:
    //   • Core layers (never carry a composition semantic — they're the
    //     terminal fallback).
    //   • Layers below the effective base — their strategy doesn't apply
    //     because the base overwrites them.
    //   • The bottom-most layer in the stack — there's nothing below for
    //     the strategy to combine with, so "Replace" on a single-layer
    //     preset-only artifact would be misleading noise.
    const hasLayerBelow = idx < stack.length - 1;
    const meaningfulStrategy =
        !isCore &&
        !isShadowedByBase &&
        hasLayerBelow &&
        layer.strategy;
    const strategy = meaningfulStrategy
        ? `<span class="comp-artifact-strategy-chip comp-stack-layer-strategy" title="Composition strategy applied by this layer">${escapeHtml(capitalize(layer.strategy))}</span>`
        : "<span></span>";
    const version = layer.version
        ? `<span class="layer-version">v${escapeHtml(layer.version)}</span>`
        : "<span></span>";
    const title = layer.sourcePath ? ` title="${escapeHtml(layer.sourcePath)}"` : "";
    const classes = [
        "comp-stack-layer",
        isActive ? "is-active" : "",
        (isShadowedByBase || (!isActive && !isCore && effBase === null)) ? "is-shadowed" : "",
    ].filter(Boolean).join(" ");
    return `<div class="${classes}"${title}>
        <span class="layer-label"><span class="layer-dot layer-${escapeHtml(layer.layer)}"></span>${nameParts.join(" ")}</span>
        ${strategy}
        ${version}
        <span class="layer-marker">${escapeHtml(marker)}</span>
    </div>`;
}



// Fallback: render the flat-layer table inside the artifacts host when the
// server hasn't provided the richer per-artifact resolution shape yet.
// Consumers pass the layers list they got by calling deriveLayers() on
// state.snapshot.composition — this renderer doesn't know or care about the
// core → extensions → presets stacking order; it just draws what it's given.
export function renderFlatLayerTable(layers) {
    const rows = layers.map((l) => {
        const canAct = l.kind !== "core";
        const kindKey = l.kind.charAt(0).toUpperCase() + l.kind.slice(1);
        const actions = canAct
            ? `
            <button class="btn btn-ghost btn-xs" data-comp-action="view" data-kind="${escapeHtml(l.kind)}" data-name="${escapeHtml(l.name)}">View</button>
            <button class="btn btn-ghost btn-xs" data-comp-action="update" data-kind="${escapeHtml(l.kind)}" data-name="${escapeHtml(l.name)}">Update</button>
            <button class="btn btn-ghost btn-xs" data-comp-action="remove" data-kind="${escapeHtml(l.kind)}" data-name="${escapeHtml(l.name)}">Remove</button>`
            : "";
        return `<tr>
            <td>${escapeHtml(l.kind)}</td>
            <td>${escapeHtml(l.name)}</td>
            <td>${escapeHtml(l.source ?? "")}</td>
            <td>${escapeHtml(l.version ?? "")}</td>
            <td>${actions}</td>
        </tr>`;
    }).join("");
    return `<div class="comp-fallback">
        <h4>Raw layer stack (per-artifact resolution not yet available)</h4>
        <table>
            <thead><tr><th>Layer</th><th>Name</th><th>Source</th><th>Version</th><th>Actions</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>
    </div>`;
}

export function wireFlatLayerActionButtons(host) {
    host.querySelectorAll("button[data-comp-action]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const action = btn.dataset.compAction;
            const kind = btn.dataset.kind;
            const name = btn.dataset.name;
            const kindTitle = kind.charAt(0).toUpperCase() + kind.slice(1);
            dispatchKind(`composition.${action}${kindTitle}`, { name });
        });
    });
}


// -------- Section: composition/sidebars.js --------

export function renderCompositionCoreSidebar() {
    const el = document.getElementById("comp-core-card-meta");
    if (!el) return;
    const counts = Object.fromEntries(
        ARTIFACT_KIND_ORDER.map((kind) => [kind, (CORE_INVENTORY[kind] ?? []).length]),
    );
    el.textContent = `Provides ${formatArtifactCounts(counts)}`;
}

export function renderCompositionPresetSidebar() {
    const host = document.getElementById("comp-presets");
    const groupEl = document.getElementById("comp-group-presets");
    const countEl = document.getElementById("comp-group-presets-count");
    if (!host) return;
    const comp = state.snapshot.composition ?? {};
    // Precedence is owned by the CLI (`specify preset resolve`) and passed
    // through in composition.presets[] by the speckit-preset skill. The UI
    // renders in payload order — no local sort, no tiebreak.
    const presets = orderedCompositionPresets();

    if (!presets.length) {
        if (groupEl) groupEl.hidden = false;
        if (countEl) countEl.textContent = "0";
        host.innerHTML = `<div class="comp-sidebar-empty">
            <div class="comp-sidebar-empty-title">No presets installed</div>
        </div>`;
        return;
    }
    if (groupEl) groupEl.hidden = false;
    if (countEl) countEl.textContent = `${presets.length}`;

    // Derive per-provider contribution stats from the resolved artifact
    // stacks so the sidebar can say "Customizes 5 commands" for Lean and
    // "Adds 5 commands" for extensions like assess, without hard-coding.
    const artifacts = comp.artifacts ?? [];
    const contributions = computeProviderContributions(artifacts);

    const cards = presets.map((p) => {
        const enabled = p.enabled !== false;
        const providesLine = describeProviderContribution(p.id || p.name, contributions, { includeHooks: false });
        const id = escapeHtml(p.id || p.name);
        const isDefaultInstall = DEFAULT_INSTALL_PRESET_IDS.has(p.id || p.name);
        const defaultBadge = isDefaultInstall
            ? `<span class="badge default-install" title="Installed by default during setup.">Default</span>`
            : "";
        return `<div class="comp-preset-card ${enabled ? "" : "is-disabled"}" data-preset-id="${id}">
            <div class="comp-preset-card-head">
                <div class="comp-preset-card-chips">
                    <span class="comp-chip layer-preset">Preset</span>
                    ${defaultBadge}
                </div>
                <span class="comp-preset-card-name">${escapeHtml(p.name || p.id)}</span>
            </div>
            ${providesLine ? `<div class="comp-preset-card-meta">${escapeHtml(providesLine)}</div>` : ""}
        </div>`;
    }).join("");

    host.innerHTML = cards;
}

export function renderCompositionExtensionSidebar() {
    const host = document.getElementById("comp-extensions");
    const groupEl = document.getElementById("comp-group-extensions");
    const countEl = document.getElementById("comp-group-extensions-count");
    if (!host) return;
    const comp = state.snapshot.composition ?? {};
    // Precedence comes from the CLI via composition.extensions[]. The UI
    // renders in payload order — no local sort, no tiebreak.
    const extensions = orderedCompositionExtensions();

    if (!extensions.length) {
        if (groupEl) groupEl.hidden = false;
        if (countEl) countEl.textContent = "0";
        host.innerHTML = `<div class="comp-sidebar-empty">
            <div class="comp-sidebar-empty-title">No extensions installed</div>
        </div>`;
        return;
    }
    if (groupEl) groupEl.hidden = false;
    if (countEl) countEl.textContent = `${extensions.length}`;

    const artifacts = comp.artifacts ?? [];
    const contributions = computeProviderContributions(artifacts);

    const cards = extensions.map((e) => {
        const enabled = e.enabled !== false;
        const providesLine = describeProviderContribution(e.id || e.name, contributions);
        const id = escapeHtml(e.id || e.name);
        return `<div class="comp-preset-card ${enabled ? "" : "is-disabled"}" data-extension-id="${id}">
            <div class="comp-preset-card-head">
                <span class="comp-chip layer-extension">Extension</span>
                <span class="comp-preset-card-name">${escapeHtml(e.name || e.id)}</span>
            </div>
            ${providesLine ? `<div class="comp-preset-card-meta">${escapeHtml(providesLine)}</div>` : ""}
        </div>`;
    }).join("");

    host.innerHTML = cards;
}


// -------- Section: composition/meta.js --------

let __postJson = async () => ({ ok: false });
let __renderComposition = () => {};

export function setCompositionMetaDeps({ postJson, renderComposition }) {
    if (typeof postJson === "function") __postJson = postJson;
    if (typeof renderComposition === "function") __renderComposition = renderComposition;
}

export function wireCompositionRefresh() {
    const triggerRefresh = () => {
        if (state.compositionRequested) return;
        state.compositionRequested = true;
        updateCompositionRefreshButton();
        __renderComposition();
        // First reload skills so the registry reflects freshly scaffolded /
        // installed skills, then dispatch composition.refresh. We call the
        // direct SDK-backed endpoint (/api/skills/reload) instead of the
        // agent-prompt `skills.verify` — the endpoint returns real
        // diagnostics from `session.rpc.skills.reload()` and its result
        // lands on state.snapshot.skillsReload. Failures are logged but do
        // not block the refresh.
        __postJson("/api/skills/reload", {})
            .then((result) => {
                if (!result?.ok) {
                    console.warn(`skills reload reported issues (errors=${result?.errors ?? "?"}, warnings=${result?.warnings ?? "?"})`);
                }
            })
            .catch((err) => {
                console.error(`skills reload failed: ${err?.message ?? err}`);
            })
            .finally(() => {
                dispatchKind("composition.refresh", {});
            });
    };
    document.getElementById("comp-refresh")?.addEventListener("click", triggerRefresh);
    // Info popover toggles (composition + catalogs)
    wireInfoPopover("comp-info-btn", "comp-info-popover");
    wireInfoPopover("catalogs-info-btn", "catalogs-info-popover");
}

export function wireInfoPopover(btnId, popId) {
    const btn = document.getElementById(btnId);
    const pop = document.getElementById(popId);
    if (!btn || !pop) return;
    const close = () => {
        pop.hidden = true;
        btn.setAttribute("aria-expanded", "false");
    };
    btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const open = pop.hidden;
        pop.hidden = !open;
        btn.setAttribute("aria-expanded", open ? "true" : "false");
    });
    document.addEventListener("click", (e) => {
        if (pop.hidden) return;
        if (!pop.contains(e.target) && e.target !== btn) close();
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
}

export function updateCompositionRefreshButton() {
    const iconBtn = document.getElementById("comp-refresh");
    const busy = state.compositionRequested;
    // Icon button: keep glyph, toggle disabled + aria-busy (CSS spins it).
    if (iconBtn) {
        iconBtn.disabled = busy;
        if (busy) iconBtn.setAttribute("aria-busy", "true");
        else iconBtn.removeAttribute("aria-busy");
    }
}


// -------- Section: composition/tiles.js --------

// artifact-rows lives in composition-artifacts.js — re-export the pieces
// downstream modules import from this file.
export { renderCompositionArtifacts, renderArtifactRow, artifactSourcePath } from "./composition-artifacts.js";

export function setCompositionDeps({ openArtifactViewer }) {
    setArtifactRowsDeps({ openArtifactViewer });
}

export function renderComposition() {
    if (!state.snapshot) return;
    renderCompositionSummary();
    renderCompositionArtifacts();
    renderCompositionPresetSidebar();
    renderCompositionExtensionSidebar();
    renderCompositionCoreSidebar();
}

