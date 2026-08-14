// Consolidated phase-customizations renderer (contributor block on phase cards).

import { escapeHtml, safeExternalHref } from "./client.js";
import { state, bareCommandId, displayCommand, orderedCompositionPresets } from "./state.js";
import { activeChainForArtifact } from "../pipeline/active-artifacts.mjs";
import { isCanonical, canonicalTemplateIds, coreScriptsForCommand, CORE_INVENTORY } from "../pipeline/canonical.mjs";
import { bareArtifactId } from "./composition.js";
import { hooksForCommand } from "./phase-runtime.js";

// -------- Section: render/phase-customizations/lookups.js --------

export function buildPresetLookups(state) {
    const compPresets = orderedCompositionPresets();
    const catalogPresets = state.snapshot?.catalog?.presets ?? [];
    const compPresetById = new Map();
    for (const pr of compPresets) if (pr?.id) compPresetById.set(pr.id, pr);
    const catalogPresetById = new Map();
    for (const cp of catalogPresets) {
        if (cp?.id) catalogPresetById.set(cp.id, cp);
        if (cp?.installedId && cp.installedId !== cp.id) {
            catalogPresetById.set(cp.installedId, cp);
        }
    }
    const presetLabel = (presetId) => {
        const meta = compPresetById.get(presetId);
        const cat = catalogPresetById.get(presetId);
        const friendly = meta?.name || cat?.name || presetId;
        return friendly && friendly !== presetId ? friendly : (presetId || "?");
    };
    return { compPresetById, catalogPresetById, presetLabel };
}

// Extension catalog lookup so hook rows can link the extension name
// to its GitHub repo (or homepage). Contributors show up in hooks
// rather than in presets, so this parallels catalogPresetById.
export function buildExtensionLookup(state) {
    const catalogExtensions = state.snapshot?.catalog?.extensions ?? [];
    const catalogExtensionById = new Map();
    for (const ce of catalogExtensions) {
        if (ce?.id) catalogExtensionById.set(ce.id, ce);
        if (ce?.installedId && ce.installedId !== ce.id) {
            catalogExtensionById.set(ce.installedId, ce);
        }
    }
    return catalogExtensionById;
}

// One place for the "contributor display name → optional repo/homepage link"
// pattern. Used by the Preset/Extension contributor rows AND the Hook
// row's extension attribution. Consolidates three previously-duplicated
// catalog lookups (one of which was silently missing the <a> wrap, so
// Extension names on the Command row weren't linked even though the
// repository URL was available).
export function contributorLinkHtmlFor(layer, id, fallbackLabel, deps) {
    const { catalogExtensionById, catalogPresetById, presetLabel } = deps;
    const cat = layer === "extension"
        ? catalogExtensionById.get(id)
        : layer === "preset"
        ? catalogPresetById.get(id)
        : null;
    const label = layer === "preset" ? presetLabel(id) : (fallbackLabel || id || "?");
    const href = cat?.repository || cat?.homepage;
    const safeHref = safeExternalHref(href);
    return safeHref
        ? `<a href="${safeHref}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(href)}">${escapeHtml(label)}</a>`
        : escapeHtml(label);
}


// -------- Section: render/phase-customizations/helpers.js --------

export const strategyVerb = (strategy) => {
    switch (strategy) {
        case "replace": return "Replaces";
        case "wrap": return "Wraps";
        case "prepend": return "Prepends";
        case "append": return "Appends";
        default: return strategy ? `${strategy.charAt(0).toUpperCase()}${strategy.slice(1)}s` : "";
    }
};

export const strategyVerbForOmit = (strategy) => {
    switch (strategy) {
        case "replace": return "replaces";
        case "wrap":    return "wraps";
        case "prepend": return "prepends to";
        case "append":  return "appends to";
        default:        return "customizes";
    }
};

// Build a comma-delimited sentence for the "detail" portion of a row.
// Parts are joined with ", " and rendered inline. `null`/`""` parts skipped.
// Runtime pills (`phase-runtime-pill …`) are separated with a plain space
// instead of a comma — a run-state indicator is not another content part,
// and reading "constitution-template, Executed" as prose is wrong.
export const isRuntimePill = (s) => typeof s === "string" && s.includes("phase-runtime-pill");
export const isChainToggle = (s) => typeof s === "string" && s.includes("phase-cust-chain-toggle");
export const joinParts = (parts) => {
    const clean = parts.filter(Boolean);
    let out = "";
    for (let i = 0; i < clean.length; i++) {
        const p = clean[i];
        if (i === 0) { out += p; continue; }
        const sep = (isRuntimePill(p) || isChainToggle(p)) ? " " : `<span class="phase-cust-sep">, </span>`;
        out += sep + p;
    }
    return out;
};

export const unchangedPart = `<span class="phase-cust-unchanged">Core &middot; unchanged</span>`;

// Grid row: 2 cells — Kind + Detail. The "used at runtime" state is
// rendered as a pill INSIDE the Detail cell (see `runtimePillFor`
// below) rather than as its own column, so multi-part detail lines
// stay compact and the run-state reads as an attribute of the
// artifact rather than a separate axis. The optional `pill` argument
// is rendered AFTER the comma-joined parts, separated by a space
// rather than a comma — a run-state pill is not another content part.
export const buildRow = (kindLabel, parts, extraClass = "", pill = "") => `
    <div class="phase-cust-row ${extraClass}">
        <span class="phase-cust-kind">${kindLabel}</span>
        <span class="phase-cust-detail">${joinParts(parts)}${pill ? ` <span class="phase-cust-pill-wrap">${pill}</span>` : ""}</span>
    </div>`;

export const layerOwnerName = (layer) =>
    layer?.presetName || layer?.extensionName || layer?.presetId || layer?.extensionId || "";

// Chain-key builder for the expand/collapse state. Keyed per-phase +
// kind + bareId so different artifacts don't share state.
export const chainKeyFor = (cmdName, kind, bareId) => `${cmdName}|${kind}|${bareId}`;
export const isChainExpandedFor = (cmdName, kind, bareId) =>
    state.expandedArtifactChains.has(chainKeyFor(cmdName, kind, bareId));


// -------- Section: render/phase-customizations/contributor-parts.js --------

export const contributorPart = (active, bareId, sourcePath, deps) => {
    const { unchangedPart, contributorLinkHtml } = deps;
    if (!active) return unchangedPart;
    const layerLabel = active.layer === "core"
        ? "CORE:"
        : active.layer === "preset"
            ? "PRESET:"
            : active.layer === "extension"
                ? "EXTENSION:"
                : null;
    if (!layerLabel) return unchangedPart;
    if (!bareId) {
        if (active.layer === "core") return unchangedPart;
        if (active.layer === "preset") {
            return `<span class="phase-cust-part-label">PRESET:</span> ${contributorLinkHtml("preset", active.presetId)}`;
        }
        return `<span class="phase-cust-part-label">EXTENSION:</span> ${contributorLinkHtml("extension", active.presetId, active.presetName)}`;
    }
    const path = sourcePath || active.sourcePath || "";
    const nameHtml = path
        ? `<a class="phase-cust-target-link" href="#" data-reveal-path="${escapeHtml(path)}" title="${escapeHtml(path)}"><code>${escapeHtml(bareId)}</code></a>`
        : `<code>${escapeHtml(bareId)}</code>`;
    return `<span class="phase-cust-part-label">${layerLabel}</span> ${nameHtml}`;
};

// The Command row wants a different framing than templates/scripts. The
// linked artifact is the SKILL.md file (the composed skill), not a raw
// preset asset — so it reads as "SKILL: /speckit-specify". We then
// append a second chip attributing the winning contributor by NAME
// ("PRESET: Copilot Sub-Agents" or "EXTENSION: <name>") so the row
// tells the reader both *what* they'd click and *who* owns it.
export const commandContributorPartsFor = (active, bareCommand, skillPath, deps) => {
    const { unchangedPart, contributorLinkHtml } = deps;
    if (!active) return [unchangedPart];
    const nameHtml = skillPath
        ? `<a class="phase-cust-target-link" href="#" data-reveal-path="${escapeHtml(skillPath)}" title="${escapeHtml(skillPath)}"><code>${escapeHtml(bareCommand)}</code></a>`
        : `<code>${escapeHtml(bareCommand)}</code>`;
    const skillChip = `<span class="phase-cust-part-label">SOURCE:</span> ${nameHtml}`;
    if (active.layer === "core") {
        // Core-only: SKILL points at the composed file; contributor is Core.
        return [skillChip, `<span class="phase-cust-part-label">CORE</span>`];
    }
    if (active.layer === "preset") {
        return [
            skillChip,
            `<span class="phase-cust-part-label">PRESET:</span> ${contributorLinkHtml("preset", active.presetId)}`,
        ];
    }
    if (active.layer === "extension") {
        return [
            skillChip,
            `<span class="phase-cust-part-label">EXTENSION:</span> ${contributorLinkHtml("extension", active.presetId, active.presetName)}`,
        ];
    }
    return [skillChip];
};

export const strategyPart = (active) => {
    if (!active || active.layer === "core") return "";
    const verb = strategyVerb(active.strategy);
    return verb ? `<span class="phase-cust-part-label">Strategy:</span> ${verb}` : "";
};

// Build the parts array (SOURCE + LAYER + STRATEGY) for a single
// layer in an artifact's stack. Used to render each sub-row of the
// active chain (see buildChainRows below). Mirrors the shape used
// for a winner-only row so collapsed and expanded rows look consistent.
export const layerRowPartsFor = (layer, { sourcePath, bareId, sourceLabel = "SOURCE" }, deps) => {
    const { contributorLinkHtml } = deps;
    const path = layer?.sourcePath || sourcePath || "";
    const nameHtml = path
        ? `<a class="phase-cust-target-link" href="#" data-reveal-path="${escapeHtml(path)}" title="${escapeHtml(path)}"><code>${escapeHtml(bareId)}</code></a>`
        : `<code>${escapeHtml(bareId)}</code>`;
    const sourceChip = `<span class="phase-cust-part-label">${escapeHtml(sourceLabel)}:</span> ${nameHtml}`;
    let contributorChip = "";
    if (layer?.layer === "preset") {
        contributorChip = `<span class="phase-cust-part-label">PRESET:</span> ${contributorLinkHtml("preset", layer.presetId, layer.presetName)}`;
    } else if (layer?.layer === "extension") {
        contributorChip = `<span class="phase-cust-part-label">EXTENSION:</span> ${contributorLinkHtml("extension", layer.presetId, layer.presetName)}`;
    } else if (layer?.layer === "core") {
        contributorChip = `<span class="phase-cust-part-label">CORE</span>`;
    }
    return [sourceChip, contributorChip, strategyPart(layer)].filter(Boolean);
};


// -------- Section: render/phase-customizations/command-row.js --------

export function renderCommandRow({ p, cmdName, bareId, commandArt, deps }) {
    const {
        buildChainRows,
        commandContributorParts,
        strategyPart,
        pillForState,
    } = deps;

    let commandActive = (commandArt?.stack ?? []).find((l) => l.active) || null;
    if (!commandActive && isCanonical(bareId)) {
        commandActive = { layer: "core", active: true };
    }
    const dashCommand = displayCommand(cmdName);
    const skillPath = `.github/skills/${dashCommand}/SKILL.md`;
    // Command row: SKILL link + winning contributor by name. Multi-layer
    // stacks (e.g. wrap/prepend/append presets sitting on top of core)
    // expand into their contributing chain via the disclosure caret —
    // even though the composition step has already merged the chain into
    // one SKILL.md, users want to see WHO contributed. The Composition
    // tab shows the same information globally.
    const commandChain = commandArt
        ? activeChainForArtifact(commandArt)
        : (commandActive ? [commandActive] : []);
    return {
        commandActive,
        commandRow: `
        <div class="phase-cust-row-group phase-cust-row-command-group">
            ${buildChainRows({
                kindLabel: "Command",
                kind: "command",
                bareId,
                chain: commandChain,
                runtimePill: (() => {
                    // Command execution mirrors phase status: `done` = executed
                    // (the winning skill body ran and produced an artifact),
                    // `skipped` = user explicitly skipped the phase. `empty`
                    // and `in_progress` render no pill so the row matches the
                    // artifact-row "silence is not a claim" contract.
                    const owner = layerOwnerName(commandActive);
                    const parentCmd = `/${dashCommand}`;
                    if (p.status === "done") {
                        let reason;
                        if (commandActive?.layer === "core") {
                            reason = `Executed as part of core Spec Kit's ${parentCmd} body.`;
                        } else if (commandActive?.layer === "preset") {
                            const verb = commandActive?.strategy === "replace" ? "replaced"
                                : commandActive?.strategy === "wrap" ? "wraps"
                                : commandActive?.strategy === "prepend" ? "prepends to"
                                : commandActive?.strategy === "append" ? "appends to"
                                : "customizes";
                            reason = `Executed because the ${owner || "installed"} preset ${verb} the core ${parentCmd} body.`;
                        } else if (commandActive?.layer === "extension") {
                            reason = `Executed by the ${owner || "installed"} extension's ${parentCmd}.`;
                        } else {
                            reason = `Executed during the most recent run of ${parentCmd}.`;
                        }
                        return pillForState({ state: "executed" }, reason);
                    }
                    if (p.status === "skipped") {
                        return pillForState(
                            { state: "omitted" },
                            `${parentCmd} was skipped — optional phase not run.`,
                        );
                    }
                    return "";
                })(),
                buildWinnerParts: (winner) =>
                    [...commandContributorParts(winner, `/${dashCommand}`, skillPath), strategyPart(winner)],
                subRowSourcePath: skillPath,
                subRowSourceLabel: "SOURCE",
            })}
        </div>`,
    };
}


// -------- Section: render/phase-customizations/artifact-rows.js --------

const MAX_ROWS_PER_KIND = 5;

export function renderArtifactRows({
    cmdName,
    commandActive,
    templateArts,
    phaseHooks,
    compArtifacts,
    deps,
}) {
    const {
        buildRow,
        buildChainRows,
        layerRowParts,
        contributorLinkHtml,
        runtimePillFor,
        unexpectedFor,
    } = deps;

    const capRows = (kindRows, kindLabel) => {
        if (kindRows.length <= MAX_ROWS_PER_KIND) return kindRows;
        const keep = kindRows.slice(0, MAX_ROWS_PER_KIND - 1);
        const hidden = kindRows.length - keep.length;
        const overflowParts = [
            `<span class="phase-cust-unchanged">+ ${hidden} more ${escapeHtml(kindLabel)} not shown</span>`,
        ];
        keep.push(buildRow("", overflowParts, "phase-cust-row-overflow"));
        return keep;
    };
    const rows = [];

    // Template rows — one per template the phase canonically loads. Each
    // row's detail cell ends with a "Used in last run" / "Skipped in last
    // run" pill (or nothing, before the phase has ever been run). Multi-
    // layer stacks expand into their contributing chain via a disclosure
    // caret.
    const templateRows = [];
    templateArts.forEach(({ bareId: tBareId, art: tArt }, idx) => {
        const tActive = (tArt?.stack ?? []).find((l) => l.active) || null;
        const label = idx === 0 ? "Template(s)" : "";
        const templateSourcePath = tActive?.sourcePath || `.specify/templates/${tBareId}.md`;
        const pill = runtimePillFor("template", tBareId, { commandActive, artifactActive: tActive });
        if (!tArt) {
            const parts = [`<span class="phase-cust-unchanged">not resolved by any layer</span>`];
            templateRows.push(buildRow(label, parts, "", pill));
            return;
        }
        const chain = activeChainForArtifact(tArt);
        templateRows.push(buildChainRows({
            kindLabel: label,
            kind: "template",
            bareId: tBareId,
            chain: chain.length ? chain : (tActive ? [tActive] : []),
            runtimePill: pill,
            buildWinnerParts: (winner) => layerRowParts(winner, {
                sourcePath: templateSourcePath,
                bareId: tBareId,
                sourceLabel: "SOURCE",
            }),
            subRowSourcePath: templateSourcePath,
            subRowSourceLabel: "SOURCE",
        }));
    });
    // Unexpected templates observed in the run — one row each.
    unexpectedFor("template").forEach((bonus) => {
        const label = templateRows.length === 0 ? "Template(s)" : "";
        const parts = [
            `<span class="phase-cust-badge phase-cust-badge-unexpected" title="Used during the last run but not declared by the command body">+ ${escapeHtml(bonus)}</span>`,
        ];
        templateRows.push(buildRow(label, parts, "", runtimePillFor("template", bonus, { commandActive, unexpected: true })));
    });
    rows.push(...capRows(templateRows, "template(s)"));

    // Hooks — additive dispatch, one row per hook.
    const hookRows = [];
    phaseHooks.forEach((h, idx) => {
        const extNameHtml = contributorLinkHtml("extension", h.extensionId, h.extensionName);
        const rawPhase = String(h.phase || "");
        const eventLabel = rawPhase
            ? rawPhase.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())
            : "";
        const hookArt = h.targetCommand
            ? compArtifacts.find((a) => a.id === `commands/${h.targetCommand}` && a.kind === "hook")
            : null;
        const hookActive = hookArt ? (hookArt.stack ?? []).find((l) => l.active) : null;
        const isOptional = !!h.optional;
        const reqLabel = isOptional ? "Optional" : "Required";
        const reqTitle = isOptional
            ? "Parent command will offer to run this — user can skip"
            : "Runs unconditionally after the parent phase — user cannot skip";
        const reqPart = `<span class="phase-cust-part-label">Trigger:</span> <span title="${escapeHtml(reqTitle)}">${reqLabel}</span>`;
        const label = idx === 0 ? "Hook(s)" : "";
        const hookParts = [
            `<span class="phase-cust-part-label">Extension:</span> ${extNameHtml}`,
            reqPart,
            eventLabel ? `<span class="phase-cust-part-label">Event:</span> ${escapeHtml(eventLabel)}` : "",
        ];
        const hookPill = rawPhase ? runtimePillFor("hook", rawPhase, { commandActive, artifactActive: hookActive, hookOptional: isOptional }) : "";
        hookRows.push(buildRow(label, hookParts, "", hookPill));
    });
    // Unexpected hooks observed (extension-added dispatch, drift, etc.) —
    // one row each, rendered even when phaseHooks is empty.
    const bonusHooks = unexpectedFor("hook");
    bonusHooks.forEach((bonus, idx) => {
        const label = phaseHooks.length === 0 && idx === 0 ? "Hook(s)" : "";
        const parts = [
            `<span class="phase-cust-badge phase-cust-badge-unexpected" title="Dispatched during the last run but not declared by the command body">+ ${escapeHtml(bonus)}</span>`,
        ];
        hookRows.push(buildRow(label, parts, "", runtimePillFor("hook", bonus, { commandActive, unexpected: true })));
    });
    rows.push(...capRows(hookRows, "hook(s)"));

    // Scripts row(s). Renders per-phase Core scripts inline plus any
    // preset/extension-provided scripts.
    //
    // Which scripts apply to this phase comes from the hardcoded mapping
    // in `core-capabilities.mjs` (via `coreScriptsForCommand`). Example:
    //   • speckit.plan  → setup-plan
    //   • speckit.tasks → check-prerequisites, setup-tasks
    //   • speckit.constitution → (none)
    // The shared library `common.{sh,ps1}` is intentionally excluded here
    // — it's sourced by other scripts, not directly invoked by any
    // canonical command body.
    //
    // Non-core scripts (preset/extension overrides + net-new additions)
    // still show as their own rows underneath. Both are surfaced from the
    // global composition — scripts aren't phase-scoped in spec-kit's
    // model — so overrides/adds appear on every phase's card. This mirrors
    // the Composition page's Scripts tab, which likewise splits core and
    // added rows via `artifactOrigin()` and shows a "Used by" sub-line
    // built from the same reverse index (`commandsForCoreScript`).
    const allScripts = compArtifacts.filter((a) => a.kind === "script");
    const nonCoreScripts = allScripts.filter((a) => {
        const active = (a.stack ?? []).find((l) => l.active);
        return active && active.layer !== "core";
    });
    const phaseCoreScripts = coreScriptsForCommand(cmdName);

    // Unexpected scripts observed at runtime (compute early so we can decide
    // whether to skip the whole Script(s) block).
    const unexpectedScripts = unexpectedFor("script").filter(
        (bonus) => !nonCoreScripts.some((a) => bareArtifactId(a) === bonus)
    );

    // Skip the entire Script(s) block when the phase has no canonical core
    // scripts, no preset/extension-added scripts, and no unexpected runtime
    // scripts to report. E.g. `/speckit.constitution` — no need to render
    // an empty "none" row.
    const shouldRenderScripts = phaseCoreScripts.length > 0
        || nonCoreScripts.length > 0
        || unexpectedScripts.length > 0;

    if (shouldRenderScripts) {
        const scriptRows = [];
        // Core rows — one per canonical core script. Each row gets its own
        // per-row Executed / Omitted / Unknown pill from `runtimePillFor`,
        // matching how templates, hooks, and non-core scripts render. No
        // group-level summary — each row's own state is the source of truth.
        if (phaseCoreScripts.length > 0) {
            phaseCoreScripts.forEach((scriptId, idx) => {
                const scriptSourcePath = `.specify/scripts/powershell/${scriptId}.ps1`;
                const nameLink = `<a class="phase-cust-target-link" href="#" data-reveal-path="${escapeHtml(scriptSourcePath)}" title="${escapeHtml(scriptSourcePath)}"><code>${escapeHtml(scriptId)}</code></a>`;
                const parts = [
                    `<span class="phase-cust-part-label">CORE:</span> ${nameLink}`,
                ];
                scriptRows.push(buildRow(idx === 0 ? "Script(s)" : "", parts, "", runtimePillFor("script", scriptId, { commandActive, artifactActive: { layer: "core" } })));
            });
        }

        // Per-script rows for anything not-core. Multi-layer stacks
        // expand into their contributing chain via a disclosure caret.
        for (const art of nonCoreScripts) {
            const active = (art.stack ?? []).find((l) => l.active);
            const bare = bareArtifactId(art);
            const scriptSourcePath = active?.sourcePath
                || `.specify/${active?.layer === "extension" ? "extensions" : "presets"}/${active?.presetId}/scripts/powershell/${bare}.ps1`;
            const chain = activeChainForArtifact(art);
            const label = scriptRows.length === 0 ? "Script(s)" : "";
            const pill = runtimePillFor("script", bare, { commandActive, artifactActive: active });
            scriptRows.push(buildChainRows({
                kindLabel: label,
                kind: "script",
                bareId: bare,
                chain: chain.length ? chain : (active ? [active] : []),
                runtimePill: pill,
                buildWinnerParts: (winner) => {
                    const parts = layerRowParts(winner, {
                        sourcePath: scriptSourcePath,
                        bareId: bare,
                        sourceLabel: "SOURCE",
                    });
                    // Preserve today's terse layout for scripts: strip the
                    // "Core · unchanged" strategy part on winner when it's
                    // absent (already handled by strategyPart returning "").
                    return parts;
                },
                subRowSourcePath: scriptSourcePath,
                subRowSourceLabel: "SOURCE",
            }));
        }

        // Unexpected scripts observed at runtime that neither Core nor any
        // installed preset/extension contributes to the composition.
        unexpectedScripts.forEach((bonus) => {
            const parts = [
                `<span class="phase-cust-badge phase-cust-badge-unexpected" title="Executed during the last run but not declared by the command body">+ ${escapeHtml(bonus)}</span>`,
            ];
            const label = scriptRows.length === 0 ? "Script(s)" : "";
            scriptRows.push(buildRow(label, parts, "", runtimePillFor("script", bonus, { commandActive, unexpected: true })));
        });
        rows.push(...capRows(scriptRows, "script(s)"));
    }

    return rows;
}


// -------- Section: render/phase-customizations/chain-block.js --------

export function buildChainRowsFor({
    kindLabel,
    kind,
    bareId,
    chain,
    runtimePill = "",
    buildWinnerParts,
    subRowSourcePath,
    subRowSourceLabel,
}, deps) {
    const { chainKey, isChainExpanded, buildRow, layerRowParts } = deps;
    const chainLen = chain.length;
    const winner = chain[0] || null;
    // Winner row uses caller-supplied parts (which typically match
    // today's exact format — e.g. Command row shows a SKILL: chip).
    // The toggle chip is appended as a final part when the chain is
    // multi-layer, so it sits at the row's end alongside runtime pill.
    const key = chainKey(kind, bareId);
    const expanded = isChainExpanded(kind, bareId);
    const parts = buildWinnerParts(winner) ?? [];
    let toggleChip = "";
    if (chainLen > 1) {
        const label = expanded ? "− hide layers" : `▸ +${chainLen - 1} more`;
        toggleChip = `<button type="button" class="phase-cust-chain-toggle" data-chain-key="${escapeHtml(key)}" aria-expanded="${expanded ? "true" : "false"}" title="Show the full contributing chain">${escapeHtml(label)}</button>`;
    }
    const winnerCls = chainLen > 1
        ? "phase-cust-row-chain-winner phase-cust-row-chain-has-sub"
        : "phase-cust-row-chain-winner";
    const winnerRow = buildRow(
        kindLabel,
        toggleChip ? [...parts, toggleChip] : parts,
        winnerCls,
        runtimePill,
    );
    if (chainLen <= 1 || !expanded) return winnerRow;

    // Sub-rows: layers 1..N (winner is already rendered at index 0).
    const subRows = chain.slice(1).map((layer, i) => {
        const isBase = i === chainLen - 2; // last sub-row = base of chain
        const subParts = layerRowParts(layer, {
            sourcePath: subRowSourcePath,
            bareId,
            sourceLabel: subRowSourceLabel || "SOURCE",
        });
        const cls = `phase-cust-row-chain-sub${isBase ? " phase-cust-row-chain-base" : ""}`;
        return buildRow("", subParts, cls);
    }).join("");
    return winnerRow + subRows;
}


// -------- Section: render/phase-customizations/execution-report.js --------

export function buildExecutionReport(state, cmdName) {
    const execReport = state.snapshot?.composition?.executionReports?.[`commands/${cmdName}`] || null;
    const asBareSet = (arr) => new Set((Array.isArray(arr) ? arr : []).map(String));
    const expectedByKind = {
        template: asBareSet(execReport?.expected?.templates),
        script:   asBareSet(execReport?.expected?.scripts),
        hook:     asBareSet(execReport?.expected?.hooks),
    };
    // Witness map: null when the agent explicitly declined to report
    // (`artifacts: null`), else three per-kind maps of bare id → { state,
    // detail }. Absence of an id under a kind ⇒ "unreported".
    const artifactsByKind = execReport && execReport.artifacts !== null
        ? {
            template: execReport.artifacts?.template ?? {},
            script:   execReport.artifacts?.script   ?? {},
            hook:     execReport.artifacts?.hook     ?? {},
        }
        : null;
    const hasReport = !!execReport;
    const artifactsKnown = hasReport && artifactsByKind !== null;
    const isStaleReport = !!execReport?.stale;
    // Dynamic 1-sentence "why" for a pill, keyed on the phase's active
    // command layer (which owns the runtime body) plus the artifact's
    // own contributor. Reads better than a generic agent-POV sentence
    // because most real Omitted cases have a determinstic explanation
    // (e.g. a Lean preset replaced the command body and its replacement
    // simply doesn't invoke the script). Returns "" if we can't reason.
    const reasonFor = (kind, runState, ctx = {}) => {
        const parentCmd = ctx.parentCommand
            ? `/${displayCommand(ctx.parentCommand)}`
            : "the command";
        const cmdLayer     = ctx.commandActive?.layer || "";
        const cmdOwner     = layerOwnerName(ctx.commandActive);
        const cmdStrategy  = ctx.commandActive?.strategy || "";
        const artLayer     = ctx.artifactActive?.layer || "";
        const artOwner     = layerOwnerName(ctx.artifactActive);
        if (runState === "executed") {
            if (ctx.unexpected) {
                return `Executed at runtime even though no installed layer declares it for ${parentCmd}.`;
            }
            if (kind === "hook") {
                return artOwner
                    ? `Auto-dispatched by the ${artOwner} extension after ${parentCmd}.`
                    : `Auto-dispatched as a hook on ${parentCmd}.`;
            }
            if (cmdLayer === "core") {
                if (artLayer && artLayer !== "core" && artOwner) {
                    return `Executed by core ${parentCmd}, using the ${kind} contributed by ${artOwner}.`;
                }
                return `Executed as part of core Spec Kit's ${parentCmd} body.`;
            }
            if (cmdLayer === "preset") {
                const verb = cmdStrategy === "replace" ? "replaced"
                          : cmdStrategy === "wrap"    ? "wraps"
                          : cmdStrategy === "prepend" ? "prepends to"
                          : cmdStrategy === "append"  ? "appends to"
                          : "customizes";
                return `Executed because the ${cmdOwner || "installed"} preset ${verb} the core ${parentCmd} body.`;
            }
            if (cmdLayer === "extension") {
                return `Executed by the ${cmdOwner || "installed"} extension's ${parentCmd}.`;
            }
            return "";
        }
        if (runState === "omitted") {
            if (ctx.unexpected) {
                return `${parentCmd} didn't touch this ${kind} during the last run.`;
            }
            if (kind === "hook") {
                if (ctx.hookOptional) {
                    return `Optional hook — ${parentCmd} chose not to dispatch it this run.`;
                }
                return `${parentCmd} didn't dispatch this hook during the last run.`;
            }
            if (cmdLayer === "preset") {
                const verb = strategyVerbForOmit(cmdStrategy);
                if (cmdStrategy === "replace") {
                    return `The ${cmdOwner || "installed"} preset's replacement ${parentCmd} body doesn't invoke this ${kind}.`;
                }
                return `The ${cmdOwner || "installed"} preset ${verb} ${parentCmd}, and its body didn't invoke this ${kind}.`;
            }
            if (cmdLayer === "extension") {
                return `${cmdOwner || "The installed extension"}'s ${parentCmd} didn't invoke this ${kind} during the last run.`;
            }
            if (cmdLayer === "core") {
                if (artLayer && artLayer !== "core" && artOwner) {
                    return `${artOwner} contributes this ${kind}, but core ${parentCmd}'s body doesn't invoke it.`;
                }
                return `Core ${parentCmd}'s body didn't invoke this ${kind} during the last run.`;
            }
            return `${parentCmd} didn't invoke this ${kind} during the last run.`;
        }
        return "";
    };
    // Runtime PILL for a single declared artifact by kind + bare id.
    // Two-state witness contract:
    //   - No report at all → no pill (phase has never been run).
    //   - Report with `artifacts: null` → muted "Unknown" pill (agent
    //     declined to report — re-run to capture).
    //   - Report with a witness map, id present → "Executed" or "Omitted"
    //     pill matching the reported state.
    //   - Report with a witness map, id absent → muted "Unknown" pill.
    //     Silence is not a claim; absence is never inferred as "omitted".
    const staleSuffix = isStaleReport
        ? " (Report is stale — composition changed since the last run.)"
        : "";
    const pill = (cls, label, title) =>
        `<span class="phase-runtime-pill ${cls}" title="${escapeHtml(title)}">${escapeHtml(label)}</span>`;
    const pillForState = (entry, reason) => {
        const detail = entry?.detail ? ` (${entry.detail})` : "";
        const genericExec = "Reported as executed during the most recent run.";
        const genericOmit = "Reported as not executed during the most recent run.";
        switch (entry?.state) {
            case "executed":
                return pill(
                    "phase-runtime-pill-used",
                    "Executed",
                    `${reason || genericExec}${detail}${staleSuffix}`,
                );
            case "omitted":
                return pill(
                    "phase-runtime-pill-omitted",
                    "Omitted",
                    `${reason || genericOmit}${detail}${staleSuffix}`,
                );
            default:
                return "";
        }
    };
    // Runtime PILL for a single declared artifact by kind + bare id.
    // Two-signal contract: render a pill when the witness report
    // explicitly says this artifact was `executed` OR `omitted`. Both
    // are treated as reliable positive claims by the agent. Anything
    // else — no report at all, agent declined (`artifacts: null`), or
    // id simply not mentioned — renders nothing (silence is not a
    // claim; absence is never inferred as omitted).
    //
    // `ctx` (optional) supplies composition-aware detail for the
    // tooltip: `{ parentCommand, commandActive, artifactActive,
    // unexpected, hookOptional }`. All fields are optional — falls
    // back to a generic sentence when omitted.
    const runtimePillFor = (kind, bareId, ctx = {}) => {
        if (!artifactsKnown) return "";
        const entry = artifactsByKind[kind]?.[bareId];
        if (entry?.state !== "executed" && entry?.state !== "omitted") return "";
        const reason = reasonFor(kind, entry.state, { parentCommand: cmdName, ...ctx });
        return pillForState(entry, reason);
    };
    // Return the list of "unexpected" bare ids for a kind — items the
    // agent reported on that the command body doesn't declare. Only
    // items reported as `executed` are surfaced; omitted / unreported
    // bonus items would carry no information under the executed-only
    // pill contract.
    const unexpectedFor = (kind) => {
        if (!artifactsKnown) return [];
        const arts = artifactsByKind[kind] ?? {};
        const exp = expectedByKind[kind];
        return Object.keys(arts).filter((n) => !exp.has(n) && arts[n]?.state === "executed");
    };

    return {
        execReport,
        expectedByKind,
        artifactsByKind,
        hasReport,
        artifactsKnown,
        isStaleReport,
        staleSuffix,
        reasonFor,
        pill,
        pillForState,
        runtimePillFor,
        unexpectedFor,
    };
}


// -------- Section: render/phase-customizations/index.js --------

export function renderPhaseCustomizations(p, outputArtifactHtml) {
    const compArtifacts = state.snapshot?.composition?.artifacts ?? [];
    const cmdName = p.commandName || (isCanonical(p.id) ? `speckit.${p.id}` : "");
    const bareId = bareCommandId(p.id);

    // Lookups + link-html partial applications for this phase render.
    const { catalogPresetById, presetLabel } = buildPresetLookups(state);
    const catalogExtensionById = buildExtensionLookup(state);
    const linkDeps = { catalogExtensionById, catalogPresetById, presetLabel };
    const contributorLinkHtml = (layer, id, fallbackLabel) =>
        contributorLinkHtmlFor(layer, id, fallbackLabel, linkDeps);
    const partsDeps = { unchangedPart, contributorLinkHtml };
    const commandContributorParts = (active, bareCommand, skillPath) =>
        commandContributorPartsFor(active, bareCommand, skillPath, partsDeps);
    const layerRowParts = (layer, opts) => layerRowPartsFor(layer, opts, partsDeps);
    // Chain-key builder for the expand/collapse state. Keyed per-phase +
    // kind + bareId so different artifacts don't share state.
    const chainKey = (kind, keyBareId) => chainKeyFor(cmdName, kind, keyBareId);
    const isChainExpanded = (kind, keyBareId) => isChainExpandedFor(cmdName, kind, keyBareId);
    const chainDeps = { chainKey, isChainExpanded, buildRow, layerRowParts };
    const buildChainRows = (opts) => buildChainRowsFor(opts, chainDeps);

    // Per-phase EXECUTION report machinery. See execution-report.js.
    const { pillForState, runtimePillFor, unexpectedFor } =
        buildExecutionReport(state, cmdName);

    // Command artifact + canonical templates + phase hooks.
    const commandArt = compArtifacts.find((a) => a.id === `commands/${cmdName}` && a.kind === "command");
    // Template lookup routes through `canonicalTemplateIds` so that phases
    // whose template ID diverges from the `<phase>-template` convention
    // (e.g. specify → spec-template, checklist-template) still find every
    // template artifact they load, and phases with no phase-specific template
    // (clarify, analyze, implement, taskstoissues) return [] so we can hide
    // the row rather than lie with "Core · unchanged". Source of truth is
    // core-capabilities.mjs — do not maintain a second list here.
    const templateBareIds = canonicalTemplateIds(bareId);
    const coreTemplateSet = new Set(CORE_INVENTORY.template ?? []);
    const templateArts = templateBareIds.map((tid) => {
        const found = compArtifacts.find((a) => (a.id === tid || a.id === `templates/${tid}`) && a.kind === "template") || null;
        if (found) return { bareId: tid, art: found };
        // No composition data yet, but we know the template ships with
        // core — synthesize a core-active stack so the row renders as
        // "CORE: <tid>" instead of the misleading "not resolved by
        // any layer" fallback below.
        if (coreTemplateSet.has(tid)) {
            return {
                bareId: tid,
                art: {
                    id: tid,
                    kind: "template",
                    stack: [{ layer: "core", active: true }],
                },
            };
        }
        return { bareId: tid, art: null };
    });
    const phaseHooks = hooksForCommand(cmdName);

    // Command "row" — lifted OUT of the artifacts grid; rendered as a
    // standalone summary line above the "Active artifacts" section. See
    // command-row.js for details.
    const { commandActive, commandRow } = renderCommandRow({
        p, cmdName, bareId, commandArt,
        deps: { buildChainRows, commandContributorParts, strategyPart, pillForState },
    });

    // Artifact rows: Templates → Hooks → Scripts. See artifact-rows.js.
    const rows = renderArtifactRows({
        cmdName,
        commandActive,
        templateArts,
        phaseHooks,
        compArtifacts,
        deps: {
            buildRow,
            buildChainRows,
            layerRowParts,
            contributorLinkHtml,
            runtimePillFor,
            unexpectedFor,
        },
    });

    // Writes-to "row" — formatted identically to Command / Template
    // rows (Kind cell + Detail cell) so the top metadata block reads as
    // a clean 2-column table. The output-artifact HTML we're given
    // already renders as a link/code snippet.
    const writesRow = outputArtifactHtml
        ? `<div class="phase-cust-row phase-cust-row-writes">
              <span class="phase-cust-kind">Writes to</span>
              <span class="phase-cust-detail">${outputArtifactHtml}</span>
           </div>`
        : "";

    // Single unified table: title acts as a header above ALL rows
    // (Command, Writes-to, and all artifact rows). Command + Writes-to
    // come first as phase metadata, then the artifact rows below.
    // Info button + popover uses a phase-scoped id so each rendered
    // phase card has its own toggle. The wiring is attached later by
    // wireGraphPhaseCard after the parent card's innerHTML is set.
    const phaseKey = (p.commandName || p.id || "phase").replace(/[^A-Za-z0-9._-]/g, "-");
    const infoBtnId = `phase-active-info-btn-${phaseKey}`;
    const infoPopId = `phase-active-info-popover-${phaseKey}`;
    return `<div class="phase-facts phase-customizations">
        <div class="phase-cust-title">
            Active artifacts in this phase
            <button type="button" class="comp-info-btn" id="${infoBtnId}" aria-label="About active artifacts" aria-expanded="false" aria-controls="${infoPopId}" title="About active artifacts">i</button>
        </div>
        <div id="${infoPopId}" class="comp-info-popover" role="dialog" aria-label="About active artifacts" hidden>
            <p>
                <strong>Active artifacts</strong> lists every template, script, and hook that is <em>available</em> to this phase based on your current <strong>composition</strong> — core Spec Kit plus any presets or extensions you have installed. It reflects what is <em>declared</em>, not what actually is executed or applied at runtime.
            </p>
            <p>
                The command that runs this phase decides which of these artifacts it will actually use. For example, the <strong>Lean preset</strong> replaces the canonical commands with a slimmer prompt that writes the target artifact directly and skips the setup scripts and post-phase hooks the core command would have invoked. Those artifacts still appear here because they are part of the composition, but a run will report them as <em>Omitted</em>.
            </p>
            <p>
                To see what a specific run actually executed, run the phase and check the <strong>Executed</strong> / <strong>Omitted</strong> pills that appear next to each artifact after the run completes. Hover the pill for a one-sentence reason explaining <em>why</em> that artifact was executed or omitted (e.g. which preset replaced the command body).
            </p>
        </div>
        <div class="phase-cust-grid">${writesRow}${commandRow}${rows.join("")}</div>
    </div>`;
}

