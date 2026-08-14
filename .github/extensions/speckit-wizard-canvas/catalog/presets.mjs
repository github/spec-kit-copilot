// catalog/presets.mjs — preset catalog hydration.
//
// Why direct CLI, not the /speckit-preset skill: this is a passive,
// server-side detection read that runs during tile rendering — there is no
// active agent turn to dispatch a prompt into. Skill dispatch (via the
// wizard's /api/prompt seam → Copilot agent → /speckit-preset) is reserved
// for user-triggered actions like add/apply, where the agent's invocation
// output belongs in chat. Machine-parseable read-only queries stay on the
// direct CLI path (same pattern as extensions.mjs and bundles.mjs).

import { parsePresetListOutput } from "../composition/preset-order.mjs";
import { hydrateFromCatalogSources, cliOrderFromInstalled, specifyRun } from "./shared.mjs";

// Query `specify preset list` to detect installed / active presets. This is
// local project state, not remote catalog data — shelling out is deterministic
// (parseable line format) and unavoidable.
//
// Returns { ids: Set<string>, names: Set<string> } so callers can match a
// catalog entry against an installed preset by either. Some upstream catalog
// entries declare an id (e.g. `foo`) that differs from what the preset's
// own manifest ships (`foo-full-preset`) — matching by name catches those.
//
// Parsing is delegated to preset-order.mjs so that this helper and the
// preset loader share ONE parser — no duplicated regex.
export async function listInstalledPresets(workspacePath) {
    const stdout = await specifyRun(["preset", "list"], workspacePath);
    if (stdout == null) {
        return { ids: new Set(), names: new Set(), byName: new Map(), orderedIds: [] };
    }
    const parsed = parsePresetListOutput(stdout);
    return {
        ids: new Set(parsed.orderedIds),
        names: new Set(parsed.byName.keys()),
        byName: parsed.byName,
        // CLI precedence order (first = winner). Consumed by the
        // composition assembler to break priority ties correctly.
        orderedIds: parsed.orderedIds,
    };
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
            // CLI precedence position (0 = first line of `specify preset list`
            // = winner). null when the preset isn't installed, or when the CLI
            // list wasn't available. The assembler uses this as the primary
            // sort key so tied-priority presets resolve exactly the way the
            // CLI would.
            cliOrder: cliOrderFromInstalled(installedId, installed),
        }),
    });
}
