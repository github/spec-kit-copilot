// speckit-wizard — deterministic composition assembler.
//
// TEMPORARY. When `specify composition list --json` (or an equivalent
// per-item skill response) returns fully-resolved artifact stacks with
// per-layer `active: true` markers, this assembler + its callers get
// deleted in one commit — no shim, no gradual migration. Same lifecycle
// as `composition/collect.mjs`.
//
// Purpose: build the same `{ presets, extensions, artifacts }` payload the
// LLM-driven `composition.refresh` produces, but from local filesystem data
// only. No LLM, no README fetches. Used to keep the Composition tab and
// phase customization rows accurate immediately after a preset/extension
// install (or any other catalog change) without waiting for the slow
// two-stage refresh.
//
// What this covers (Stage 1 — extract):
//   • presets[] with per-kind provides counts
//   • extensions[] with per-kind provides + hook counts
//   • artifacts[] — union of core inventory + every preset/extension entry,
//     with layer stacks in CLI-precedence order, strategy per entry, and
//     `active: true` on the winning layer.
//   • Standalone hook artifacts (one per extension hook binding) + inline
//     hook attributions on the target phase command.
//
// What this ALSO covers (pipeline fast path):
//   • When `computePipelineFastPath(...)` returns `pipelineFastPath: true`,
//     the assembler can synthesize `inferredPipeline` directly from the canonical
//     spine intersected with the active command set. This is emitted with
//     `synthetic: true` so consumers can distinguish it from an LLM-inferred
//     pipeline. Skipping the LLM turn is safe when no active command lies
//     outside the canonical spine AND no preset uses `wraps:`/`prepends:`/
//     `appends:` on a canonical.
//
// What this does NOT cover (LLM pipeline inference):
//   • Pipelines that require README-driven ordering — new commands whose
//     placement can only be inferred from prose, mermaid flowcharts, or
//     stack directives. `runFastComposition` leaves `inferredPipeline`
//     unchanged in that case; the user clicks Refresh on the Composition
//     tab to trigger the LLM refresh.
//
// The output shape MUST match what `applyComposition` expects (partial
// merge of `{ presets, extensions, artifacts, inferredPipeline }`), because
// `applyComposition` normalizes and persists both LLM and assembler outputs
// through the same path.

import {
    readPresetManifest,
    readExtensionManifest,
    readHooksMap,
    loadCoreInventory,
} from "./collect.mjs";
import { CORE_COMMANDS, canonicalPipelineIds, requiredCanonicalPipelineIds } from "../pipeline/canonical.mjs";

const VALID_STRATEGIES = new Set(["replace", "wrap", "prepend", "append"]);

/**
 * Return the active subset of `items` in the order the CLI already
 * resolved for us. `cliOrder` is the position in `specify preset list`
 * (0 = first line = winner) — the CLI has already factored in priority
 * and applied its own tiebreak (alphabetical by id at equal priority).
 * The wizard MUST NOT re-derive that ordering; doing so risks drifting
 * from the CLI's actual resolution rules.
 *
 * Items missing `cliOrder` (extensions before we wire `specify extension
 * list`, or catalog rows for uninstalled presets that got filtered out
 * upstream anyway) sort to the end in their input order, so we never
 * mis-attribute a winner based on made-up precedence.
 */
function orderedActive(items) {
    return (items ?? [])
        .filter((i) => i && i.active)
        .map((item, idx) => ({ item, idx }))
        .sort((a, b) => {
            const ca = typeof a.item.cliOrder === "number" ? a.item.cliOrder : null;
            const cb = typeof b.item.cliOrder === "number" ? b.item.cliOrder : null;
            if (ca !== null && cb !== null) return ca - cb;
            if (ca !== null) return -1;
            if (cb !== null) return 1;
            return a.idx - b.idx;
        })
        .map((entry) => entry.item);
}

/**
 * Normalize an entry's strategy. Prefer the explicit `strategy:` field on
 * the raw manifest entry (that's what the LLM reads), fall back to the
 * script's inferred value, and default to "replace" if neither is valid.
 */
function entryStrategy(entry) {
    const explicit = entry?.raw?.strategy;
    if (typeof explicit === "string" && VALID_STRATEGIES.has(explicit)) return explicit;
    if (typeof entry?.strategy === "string" && VALID_STRATEGIES.has(entry.strategy)) return entry.strategy;
    return "replace";
}

/**
 * Compose the artifact id for a manifest entry of the given kind.
 *   command → commands/<name>
 *   template → <name>
 *   script → <name>
 */
function artifactIdFor(kind, name) {
    if (!name) return null;
    if (kind === "command") return `commands/${name}`;
    return name;
}

/**
 * Build a stack layer object for a preset contribution to an artifact.
 */
function presetLayer(manifest, entry) {
    return {
        layer: "preset",
        presetId: manifest.id,
        presetName: manifest.name,
        strategy: entryStrategy(entry),
        version: manifest.version ?? null,
        sourcePath: entry.sourcePath ?? undefined,
        active: false,
    };
}

/**
 * Build a stack layer object for an extension contribution to an artifact.
 * Uses the same `presetId`/`presetName` keys the UI reads to render
 * layer labels (mirrors what the LLM produces).
 */
function extensionLayer(manifest, entry) {
    return {
        layer: "extension",
        presetId: manifest.id,
        presetName: manifest.name,
        strategy: entryStrategy(entry),
        version: manifest.version ?? null,
        sourcePath: entry.sourcePath ?? undefined,
        active: false,
    };
}

/**
 * Assemble the composition payload deterministically.
 *
 * @param {object} opts
 * @param {string} opts.workspaceRoot   Absolute path to the workspace root.
 * @param {Array}  opts.presetItems     Cached preset catalog items (inst.cachedPresetItems).
 * @param {Array}  opts.extensionItems  Cached extension catalog items (inst.cachedExtensionItems).
 * @returns {Promise<{ presets, extensions, artifacts }>}
 */
export async function assembleComposition({ workspaceRoot, presetItems, extensionItems }) {
    const activePresets = orderedActive(presetItems);
    const activeExtensions = orderedActive(extensionItems);

    // Read manifests for every active layer via the extraction script's helpers.
    const presetManifests = [];
    for (const p of activePresets) {
        const id = p.installedId || p.id;
        const m = await readPresetManifest(workspaceRoot, id);
        if (m && !m.error) {
            // Preserve catalog-level priority so downstream sorting stays stable
            // even if the manifest doesn't declare one.
            presetManifests.push({
                ...m,
                priority: typeof m.priority === "number" ? m.priority : (typeof p.priority === "number" ? p.priority : 10),
                catalogItem: p,
            });
        }
    }
    const extensionManifests = [];
    for (const e of activeExtensions) {
        const id = e.installedId || e.id;
        const m = await readExtensionManifest(workspaceRoot, id);
        if (m && !m.error) {
            extensionManifests.push({
                ...m,
                priority: typeof m.priority === "number" ? m.priority : (typeof e.priority === "number" ? e.priority : 10),
                catalogItem: e,
            });
        }
    }

    // Preserve CLI precedence order (already set by orderedActive above).
    // The CLI resolves priority + ties itself; we must NOT re-sort here.
    // Extensions have no `specify extension list`-derived cliOrder yet,
    // so we leave them in input order too. Manifests whose lookup
    // failed above were already dropped, so index alignment with the
    // orderedActive lists is preserved.

    const hooksMap = await readHooksMap(workspaceRoot);
    const coreInventory = await loadCoreInventory();

    // Build the artifact map keyed by id. Each entry accumulates its
    // full stack as we walk layers in precedence order.
    /** @type {Map<string, { id, kind, stack: Array, hooks?: Array, hookBinding?: object, description?: string }>} */
    const artifacts = new Map();
    const ensure = (id, kind) => {
        let a = artifacts.get(id);
        if (!a) {
            a = { id, kind, stack: [] };
            artifacts.set(id, a);
        }
        return a;
    };

    // 1. Walk presets in precedence order — highest priority first.
    //    Each preset's entry pushes a layer onto its artifact's stack.
    for (const manifest of presetManifests) {
        for (const kind of ["command", "template", "script"]) {
            const entries = manifest.entriesByKind?.[kind] ?? [];
            for (const entry of entries) {
                const id = artifactIdFor(kind, entry.name);
                if (!id) continue;
                const a = ensure(id, kind);
                const layer = presetLayer(manifest, entry);
                a.stack.push(layer);
                if (!a.description && entry.description) a.description = entry.description;
            }
        }
    }

    // 2. Walk extensions. Extensions are additive/namespace-isolated —
    //    their commands go into artifacts too, but they do NOT get a core
    //    fallback layer (rule from prompts.mjs).
    //
    //    Exception: if an extension declares a `provides.commands` entry
    //    whose name is also used as a hook `command` in the same manifest,
    //    the command is treated purely as a hook (see step 4 below). Emitting
    //    both a `kind: "command"` artifact AND a `kind: "hook"` artifact for
    //    the same id would create two entries in comp.artifacts sharing an
    //    id, which downstream `find()`-by-id lookups can't disambiguate, and
    //    would cause computePipelineFastPath to treat the hook as a novel
    //    command (forcing unnecessary LLM pipeline inference).
    for (const manifest of extensionManifests) {
        const hookCommandNames = new Set(
            (manifest.hooks ?? [])
                .map((h) => h?.command)
                .filter((n) => typeof n === "string" && n),
        );
        for (const kind of ["command", "template", "script"]) {
            const entries = manifest.entriesByKind?.[kind] ?? [];
            for (const entry of entries) {
                if (kind === "command" && hookCommandNames.has(entry.name)) continue;
                const id = artifactIdFor(kind, entry.name);
                if (!id) continue;
                const a = ensure(id, kind);
                const layer = extensionLayer(manifest, entry);
                a.stack.push(layer);
                if (!a.description && entry.description) a.description = entry.description;
            }
        }
    }

    // 3. Append the terminal `core` layer for every artifact id present
    //    in the core inventory — commands, templates, scripts alike.
    const coreCommands = new Set((coreInventory.command ?? []).map((n) => `commands/${n}`));
    const coreTemplates = new Set(coreInventory.template ?? []);
    const coreScripts = new Set(coreInventory.script ?? []);
    const addCoreLayer = (id, kind) => {
        const a = ensure(id, kind);
        a.stack.push({ layer: "core", active: false, strategy: "replace" });
    };
    for (const id of coreCommands) addCoreLayer(id, "command");
    for (const id of coreTemplates) addCoreLayer(id, "template");
    for (const id of coreScripts) addCoreLayer(id, "script");

    // 4. Hook attributions from extension manifests.
    //    Each declared hook produces:
    //      (a) an inline `hooks` entry on the target phase command artifact
    //      (b) a standalone hook artifact `commands/<hookCommand>` with
    //          `kind: "hook"` and a `hookBinding` block.
    for (const manifest of extensionManifests) {
        for (const hook of manifest.hooks ?? []) {
            const phase = hook.phase;
            const hookCommand = hook.command;
            if (!phase || !hookCommand) continue;

            // Registered check: presence in .specify/extensions.yml under this phase.
            const registeredBindings = hooksMap?.[phase] ?? [];
            const registered = registeredBindings.some(
                (b) => b?.extension === manifest.id && (b?.command == null || b.command === hookCommand),
            );

            // (a) inline attribution — attach to the parent phase's command artifact
            //     (parent phase inferred from the phase name: after_specify → speckit.specify).
            const targetPhaseName = phase.replace(/^(before_|after_)/, "");
            const parentCommandId = `commands/speckit.${targetPhaseName}`;
            const parent = artifacts.get(parentCommandId);
            if (parent) {
                (parent.hooks ??= []).push({
                    phase,
                    extensionId: manifest.id,
                    extensionName: manifest.name,
                    targetCommand: hookCommand,
                    declared: true,
                    registered,
                });
            }

            // (b) standalone hook artifact — one per hookCommand id.
            //     Multiple bindings on the same hook command (e.g.
            //     after_specify + after_plan) accumulate into
            //     `hookBindings: []` on a single artifact, so the Active
            //     Artifacts panel shows one row per fired command with
            //     every trigger listed underneath. `hookBinding` (singular)
            //     is kept as the first-binding alias for readers that
            //     haven't migrated to the plural form.
            const hookArtifactId = `commands/${hookCommand}`;
            const hookMapKey = `hook:${hookCommand}`;
            let hookArtifact = artifacts.get(hookMapKey);
            if (!hookArtifact) {
                hookArtifact = { id: hookArtifactId, kind: "hook", stack: [], hookBindings: [] };
                artifacts.set(hookMapKey, hookArtifact);
            }
            hookArtifact.kind = "hook";
            if (!Array.isArray(hookArtifact.hookBindings)) hookArtifact.hookBindings = [];
            const binding = {
                phase,
                targetCommand: hookCommand,
                optional: !!hook.optional,
                extensionId: manifest.id,
                manifestPath: manifest.manifestPath,
            };
            // Guard against duplicate declarations of the same trigger.
            const bindingKey = `${binding.phase}|${binding.extensionId}`;
            if (!hookArtifact.hookBindings.some((b) => `${b.phase}|${b.extensionId}` === bindingKey)) {
                hookArtifact.hookBindings.push(binding);
            }
            hookArtifact.hookBinding = hookArtifact.hookBindings[0];
            if (!hookArtifact.stack.some((l) => l.presetId === manifest.id)) {
                hookArtifact.stack.push({
                    layer: "extension",
                    presetId: manifest.id,
                    presetName: manifest.name,
                    strategy: "replace",
                    version: manifest.version ?? null,
                    active: false,
                });
            }
        }
    }

    // 5. Mark active layer per artifact.
    //    Rule: the topmost preset layer wins for commands/scripts; for
    //    templates the same rule applies (we don't have `specify preset
    //    resolve` output here, but topmost preset is the correct behavior
    //    for the current CLI implementation). Extension-only artifacts
    //    mark the single extension layer active. Core-only artifacts mark
    //    core active.
    for (const a of artifacts.values()) {
        if (!a.stack.length) continue;
        const topmost = a.stack[0];
        if (topmost) topmost.active = true;
    }

    // 6. Assemble catalog-level summary arrays. Counts come from the
    //    manifest's entriesByKind lengths so the Layers panel shows
    //    accurate per-kind counts without the LLM.
    const presetsOut = presetManifests.map((m) => ({
        id: m.id,
        name: m.name,
        version: m.version ?? undefined,
        priority: m.priority ?? 10,
        enabled: true,
        description: m.description ?? "",
        provides: {
            commands: (m.entriesByKind?.command ?? []).length,
            templates: (m.entriesByKind?.template ?? []).length,
            scripts: (m.entriesByKind?.script ?? []).length,
        },
    }));
    const extensionsOut = extensionManifests.map((m) => ({
        id: m.id,
        name: m.name,
        version: m.version ?? undefined,
        priority: m.priority ?? 10,
        enabled: true,
        description: m.description ?? "",
        category: m.category ?? undefined,
        effect: m.effect ?? undefined,
        provides: {
            commands: (m.entriesByKind?.command ?? []).length,
            templates: (m.entriesByKind?.template ?? []).length,
            scripts: (m.entriesByKind?.script ?? []).length,
            hooks: (m.hooks ?? []).length,
        },
    }));

    return {
        presets: presetsOut,
        extensions: extensionsOut,
        artifacts: [...artifacts.values()],
        // Side channel for downstream `computePipelineFastPath`. NOT part of
        // the persisted composition — callers must strip before writing.
        _presetManifests: presetManifests,
    };
}

// Canonical spine — the ordered list of command IDs (with `commands/` prefix)
// the wizard treats as the augmented-canonical default pipeline. Mirrors
// `ui/pipeline-items.mjs canonicalSpine()` but scoped to seeded phases only
// (the pipeline order LLM inference would emit).
// Fully-qualified command artifact ids for the canonical spine (nine
// seeded phases) — sourced from `ui/canonical.mjs` so this file never
// drifts from the wizard's authoritative phase list.
const CANONICAL_PIPELINE_IDS = Object.freeze(canonicalPipelineIds());

const CANONICAL_COMMAND_ID_SET = new Set(
    CORE_COMMANDS.map((name) => `commands/${name}`),
);

// Required anchors — the five spine phases that MUST appear in an
// `augmented-canonical` pipeline (mirrors `REQUIRED_CANONICAL_PHASES`
// consumed by `state/store.mjs validateInferredPipeline`). If any of
// these is absent from the active command set, the synthesized pipeline
// would fail validation — in that case we defer to LLM inference instead.
const REQUIRED_CANONICAL_PIPELINE_IDS = Object.freeze(requiredCanonicalPipelineIds());

/**
 * Decide whether the pipeline fast path can synthesize a correct pipeline
 * from the canonical spine, or whether `composition.inferPipeline` must use
 * the non-fast LLM approach.
 *
 * The fast path cannot synthesize when either condition holds:
 *   1. `newCommands` is non-empty — some active command has no canonical
 *      placement, so ordering it requires README/prose reasoning.
 *   2. `hasStackDirectives` is true — at least one preset entry uses
 *      `wraps:` / `prepends:` / `appends:` on a canonical command, which
 *      can reorder the spine.
 *
 * When neither holds, the pipeline is just the canonical spine intersected
 * with the active command set (minus hook targets). No LLM turn required.
 *
 * @param {{ artifacts: Array, presets?: Array }} composition
 *   Output of `assembleComposition`. `presets` may be omitted for callers
 *   that only care about `newCommands`.
 * @param {Array} [presetManifests]
 *   Optional array of preset manifests (from `readPresetManifest`) — needed
 *   to detect stack directives at the entry level. `assembleComposition`
 *   doesn't expose these, so `runFastComposition` passes them separately.
 * @returns {{ pipelineFastPath: boolean, newCommands: string[], hasStackDirectives: boolean, syntheticPipeline: object | null }}
 */
export function computePipelineFastPath(composition, presetManifests = []) {
    const artifacts = Array.isArray(composition?.artifacts) ? composition.artifacts : [];
    // Active command IDs (commands only, hooks excluded).
    const activeCommands = new Set(
        artifacts
            .filter((a) => a && a.kind === "command" && typeof a.id === "string")
            .map((a) => a.id),
    );
    const hookTargets = new Set();
    for (const a of artifacts) {
        if (!a || a.kind !== "hook") continue;
        const bindings = Array.isArray(a.hookBindings) && a.hookBindings.length
            ? a.hookBindings
            : (a.hookBinding ? [a.hookBinding] : []);
        for (const b of bindings) {
            const t = b?.targetCommand;
            if (typeof t !== "string" || !t) continue;
            hookTargets.add(t.startsWith("commands/") ? t : `commands/${t}`);
        }
    }
    const newCommands = [...activeCommands]
        .filter((id) => !CANONICAL_COMMAND_ID_SET.has(id))
        .sort();

    // Stack directives — any preset entry whose strategy is not `replace`
    // (i.e. wraps/prepends/appends) targeting a canonical command.
    let hasStackDirectives = false;
    for (const manifest of presetManifests) {
        for (const kind of ["command", "template", "script"]) {
            const entries = manifest?.entriesByKind?.[kind] ?? [];
            for (const entry of entries) {
                const strategy = entry?.strategy ?? "replace";
                if (strategy === "wrap" || strategy === "prepend" || strategy === "append") {
                    hasStackDirectives = true;
                    break;
                }
            }
            if (hasStackDirectives) break;
        }
        if (hasStackDirectives) break;
    }

    const requiresLlmInference = newCommands.length > 0 || hasStackDirectives;

    // Extra safety: augmented-canonical pipelines must contain every
    // REQUIRED_CANONICAL. If the active command set is missing one (e.g.
    // a preset dropped `implement` entirely), the synthesized pipeline
    // would be rejected by validateInferredPipeline. Defer to LLM
    // inference in that case — it can emit a `standalone` shape instead.
    const missingRequiredCanonicals = REQUIRED_CANONICAL_PIPELINE_IDS.filter(
        (id) => !activeCommands.has(id),
    );
    const canSynthesize = !requiresLlmInference && missingRequiredCanonicals.length === 0;

    let syntheticPipeline = null;
    if (canSynthesize) {
        // Canonical spine ∩ active commands, minus hook targets. Preserves
        // spine order. Empty active-canonical set is still valid (core-only
        // stripped by a `lean`-style preset that removes everything is a
        // degenerate but well-formed pipeline).
        const pipelineIds = CANONICAL_PIPELINE_IDS.filter(
            (id) => activeCommands.has(id) && !hookTargets.has(id),
        );
        syntheticPipeline = {
            shape: "augmented-canonical",
            pipeline: pipelineIds,
            unplaced: [],
            rationale: "Synthesized from canonical spine — no new commands and no stack directives detected.",
            synthetic: true,
        };
    }

    return {
        pipelineFastPath: canSynthesize,
        newCommands,
        hasStackDirectives,
        syntheticPipeline,
    };
}
