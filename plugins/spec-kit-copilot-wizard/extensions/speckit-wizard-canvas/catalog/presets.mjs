// catalog/presets.mjs — preset catalog hydration.
//
// Why direct CLI, not the /speckit-preset skill: this is a passive,
// server-side detection read that runs during tile rendering — there is no
// active agent turn to dispatch a prompt into. Skill dispatch (via the
// wizard's /api/prompt seam → Copilot agent → /speckit-preset) is reserved
// for user-triggered actions like add/apply, where the agent's invocation
// output belongs in chat. Machine-parseable read-only queries stay on the
// direct CLI path (same pattern as extensions.mjs and bundles.mjs).

import { hydrateFromCatalogSources, cliOrderFromInstalled, parseInstalledPackageList, specifyRun } from "./shared.mjs";

// Query `specify preset list` to detect installed / active presets. This is
// local project state, not remote catalog data. Use the CLI's JSON inventory
// so its returned order stays aligned with preset resolution.
//
// Returns { ids: Set<string>, names: Set<string> } so callers can match a
// catalog entry against an installed preset by either. Some upstream catalog
// entries declare an id (e.g. `foo`) that differs from what the preset's
// own manifest ships (`foo-full-preset`) — matching by name catches those.
//
export async function listInstalledPresets(workspacePath, run = specifyRun) {
    const stdout = await run(["preset", "list", "--json"], workspacePath);
    return parseInstalledPackageList(stdout, "preset");
}

// Given catalog sources (populated by the skill), fetch each source's JSON
// directly to build the presets grid. Populates inst.cachedPresetItems.
// Delegates the source-iteration / fetch / installed-id-match / item-shape
// scaffolding to `hydrateFromCatalogSources`; only preset-specific extras
// remain here.
export async function hydratePresetsForSources(inst, sources) {
    return hydrateFromCatalogSources(inst, sources, {
        kind: "preset",
        dataKey: "presets",
        outputField: "cachedPresetItems",
        listInstalled: listInstalledPresets,
        extraFields: (_raw, { installedId, installed }) => ({
            // CLI precedence position (0 = first entry in the JSON list =
            // winner). null when the preset isn't installed, or when the CLI
            // list wasn't available. The assembler uses this as the primary
            // sort key so tied-priority presets resolve exactly the way the
            // CLI would.
            cliOrder: cliOrderFromInstalled(installedId, installed),
        }),
    });
}
