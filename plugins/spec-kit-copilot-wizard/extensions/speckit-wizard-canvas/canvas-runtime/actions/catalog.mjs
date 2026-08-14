// Catalog-view canvas action handlers: showPresetCatalog, showExtensionCatalog,
// showBundleCatalog. Cache LLM-pushed catalog data on the instance, trigger
// fast composition rebuilds, and trigger session skills reloads.

import { withInstance } from "../instances.mjs";
import { hydratePresetsForSources } from "../../catalog/presets.mjs";
import { hydrateExtensionsForSources } from "../../catalog/extensions.mjs";
import { hydrateBundlesForSources } from "../../catalog/bundles.mjs";
import { persistAndBroadcast, runFastComposition } from "../composition-apply.mjs";
import { reloadSkillsIfInstalledSetChanged } from "../instances.mjs";
import { UnknownActionKindError } from "../../prompts.mjs";
import { dispatchKindPrompt } from "../dispatch.mjs";

/**
 * Shared body of the three showXCatalog handlers.
 *
 * All three do the same four-step dance: (1) re-hydrate from cached
 * catalog sources so installed state is fresh (falling back to the
 * caller-pushed list if we have no sources yet), (2) optionally
 * auto-reload session skills when the installed set has changed,
 * (3) broadcast the up-to-date items to the UI, (4) optionally trigger
 * a fast local composition refresh so the Composition tab reflects
 * the new install state immediately.
 *
 * Presets and extensions do all four steps; bundles skip skill-reload
 * and composition refresh (installing a bundle only fans out to
 * presets/extensions, which own their own reload paths).
 *
 * @param {object} inst          - Canvas instance record
 * @param {object} ctx           - SDK action ctx (used for ctx.input.items)
 * @param {object} cfg
 * @param {"preset"|"extension"|"bundle"} cfg.kind
 * @param {string} cfg.broadcastType    - e.g. "preset-catalog"
 * @param {string} cfg.itemsField       - e.g. "cachedPresetItems"
 * @param {string} cfg.sourcesField     - e.g. "cachedCatalogSources"
 * @param {(inst: object, sources: any[]) => Promise<void>} cfg.hydrate
 * @param {boolean} cfg.reloadSkills    - true for preset/extension, false for bundle
 * @param {boolean} cfg.runComposition  - true for preset/extension, false for bundle
 * @param {string=} cfg.activePresetId  - only set by the preset handler
 * @param {string} cfg.reason           - passed through to runFastComposition
 */
async function applyCatalogPush(inst, ctx, cfg) {
    const pushed = Array.isArray(ctx.input?.items) ? ctx.input.items : [];

    // 1) Re-hydrate from cached catalog sources (fresh install state via
    // listInstalledX). The pushed list is treated as advisory — installed
    // status comes from the CLI, not the caller. This prevents an
    // install-only push from wiping the catalog grid.
    const sources = inst[cfg.sourcesField] ?? [];
    if (sources.length) {
        await cfg.hydrate(inst, sources);
    }
    // If we still have nothing (no sources cached yet), fall back to
    // whatever the caller pushed so the UI shows something.
    if (!inst[cfg.itemsField]?.length && pushed.length) {
        inst[cfg.itemsField] = pushed;
    }

    // 2) Auto-reload session skills when the installed set has changed so
    // newly added commands become callable in the composer without a
    // manual `/skills reload`.
    if (cfg.reloadSkills) {
        const installedIds = (inst[cfg.itemsField] ?? [])
            .filter((x) => x.active)
            .map((x) => x.id ?? x.name)
            .filter(Boolean);
        await reloadSkillsIfInstalledSetChanged(inst, cfg.kind, installedIds);
    }

    // 3) Broadcast items to the UI.
    const message = {
        type: cfg.broadcastType,
        items: [...(inst[cfg.itemsField] ?? [])],
    };
    if (cfg.kind === "preset") {
        message.activePresetId = cfg.activePresetId ?? null;
    }
    inst.broadcast(message);

    // 4) Fast local composition refresh so the Composition tab + phase
    // pages reflect the new install state immediately, without waiting
    // for the slow LLM refresh.
    // Removable once the Speckit CLI exposes the composition data this
    // wizard currently computes locally.
    if (cfg.runComposition) {
        await runFastComposition(inst, { reason: cfg.reason });
    }

    await persistAndBroadcast(
        inst,
        cfg.kind === "preset" && cfg.activePresetId ? { preset: cfg.activePresetId } : null,
    );
    return { ok: true };
}

const CATALOG_ITEM_SCHEMA = {
    type: "object",
    required: ["name"],
    properties: {
        id: { type: "string" },
        name: { type: "string" },
        source: { type: "string" },
        version: { type: "string" },
        active: { type: "boolean" },
        description: { type: "string" },
    },
};

export const catalogActions = [
    {
        name: "showPresetCatalog",
        description: "Push the preset catalog (id, name, source, version, active) to the Catalogs tab.",
        inputSchema: {
            type: "object",
            required: ["items"],
            properties: {
                items: { type: "array", items: CATALOG_ITEM_SCHEMA },
                activePresetId: { type: "string" },
            },
        },
        handler: (ctx) =>
            withInstance(ctx, (inst) =>
                applyCatalogPush(inst, ctx, {
                    kind: "preset",
                    broadcastType: "preset-catalog",
                    itemsField: "cachedPresetItems",
                    sourcesField: "cachedCatalogSources",
                    hydrate: hydratePresetsForSources,
                    reloadSkills: true,
                    runComposition: true,
                    activePresetId: ctx.input?.activePresetId ?? null,
                    reason: "showCatalog",
                }),
            ),
    },
    {
        name: "showExtensionCatalog",
        description: "Push the extension catalog (id, name, source, version, active) to the Catalogs tab.",
        inputSchema: {
            type: "object",
            required: ["items"],
            properties: {
                items: { type: "array", items: CATALOG_ITEM_SCHEMA },
            },
        },
        handler: (ctx) =>
            withInstance(ctx, (inst) =>
                applyCatalogPush(inst, ctx, {
                    kind: "extension",
                    broadcastType: "extension-catalog",
                    itemsField: "cachedExtensionItems",
                    sourcesField: "cachedExtensionCatalogSources",
                    hydrate: hydrateExtensionsForSources,
                    reloadSkills: true,
                    runComposition: true,
                    reason: "showExtensionCatalog",
                }),
            ),
    },
    {
        name: "showBundleCatalog",
        description: "Push the bundle catalog (id, name, source, version, active) to the Catalogs tab.",
        inputSchema: {
            type: "object",
            required: ["items"],
            properties: {
                items: { type: "array", items: CATALOG_ITEM_SCHEMA },
            },
        },
        handler: (ctx) =>
            withInstance(ctx, (inst) =>
                applyCatalogPush(inst, ctx, {
                    kind: "bundle",
                    broadcastType: "bundle-catalog",
                    itemsField: "cachedBundleItems",
                    sourcesField: "cachedBundleCatalogSources",
                    hydrate: hydrateBundlesForSources,
                    reloadSkills: false,
                    runComposition: false,
                    reason: "showBundleCatalog",
                }),
            ),
    },
    {
        name: "addPreset",
        description:
            "Install a preset by id — the same code path the wizard's Install button uses. The agent will run `specify preset add <id>`, then re-list and push `showPresetCatalog`. Use this when the user asks the agent to add a preset instead of clicking Install.",
        inputSchema: {
            type: "object",
            required: ["id"],
            properties: {
                id: { type: "string", description: "Preset id from the catalog (e.g. `copilot-sub-agents`)." },
            },
        },
        handler: (ctx) =>
            withInstance(ctx, async (inst) => {
                const id = typeof ctx.input?.id === "string" ? ctx.input.id.trim() : "";
                if (!id) return { ok: false, error: "missing id" };
                try {
                    await dispatchKindPrompt(inst, "preset.install", { name: id });
                } catch (err) {
                    if (err instanceof UnknownActionKindError) return { ok: false, error: err.message };
                    return { ok: false, error: err?.message ?? String(err) };
                }
                return { ok: true, id };
            }),
    },
    {
        name: "addExtension",
        description:
            "Install a Spec Kit extension by id — the same code path the wizard's Install button uses. The agent will run `specify extension add <id>`, then re-list and push `showExtensionCatalog`. Use this when the user asks the agent to add an extension instead of clicking Install.",
        inputSchema: {
            type: "object",
            required: ["id"],
            properties: {
                id: { type: "string", description: "Extension id from the catalog (e.g. `spec-kit-assess`)." },
            },
        },
        handler: (ctx) =>
            withInstance(ctx, async (inst) => {
                const id = typeof ctx.input?.id === "string" ? ctx.input.id.trim() : "";
                if (!id) return { ok: false, error: "missing id" };
                try {
                    await dispatchKindPrompt(inst, "extension.install", { name: id });
                } catch (err) {
                    if (err instanceof UnknownActionKindError) return { ok: false, error: err.message };
                    return { ok: false, error: err?.message ?? String(err) };
                }
                return { ok: true, id };
            }),
    },
];
