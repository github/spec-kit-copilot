// catalog/extensions.mjs — extension catalog hydration.
//
// Why direct CLI, not the /speckit-extension skill: this is a passive,
// server-side detection read that runs during tile rendering — there is no
// active agent turn to dispatch a prompt into. Skill dispatch (via the
// wizard's /api/prompt seam → Copilot agent → /speckit-extension) is
// reserved for user-triggered actions like add/remove, where the agent's
// invocation output belongs in chat. Machine-parseable read-only queries
// stay on the direct CLI path (same pattern as presets.mjs and
// bundles.mjs).

import { hydrateFromCatalogSources, cliOrderFromInstalled } from "./shared.mjs";
import { readSpecifySnapshot } from "../composition/snapshot.mjs";

// Query `specify extension list` to detect installed extensions. Mirrors
// listInstalledPresets. The CLI's output format for `extension list` follows
// the same convention as `preset list`: indented lines like
// `  <name> (<id>) v<version>`. If the format differs, the parser will simply
// return an empty set and every extension will render as not-installed —
// still functional, just missing the "added" badge.
export async function listInstalledExtensions(workspacePath, inst = { workspacePath }) {
    const { inventory } = await readSpecifySnapshot(inst);
    const items = inventory.extensions;
    return {
        ids: new Set(items.map((item) => item.id)),
        names: new Set(items.map((item) => item.name.toLowerCase())),
        byName: new Map(items.map((item) => [item.name.toLowerCase(), item.id])),
        orderedIds: items.map((item) => item.id),
    };
}

// Given extension catalog sources, fetch each source's JSON directly to
// build the extensions grid. Populates inst.cachedExtensionItems. Delegates
// the source-iteration / fetch / installed-id-match / item-shape scaffolding
// to `hydrateFromCatalogSources`; only extension-specific extras remain here.
export async function hydrateExtensionsForSources(inst, sources) {
    return hydrateFromCatalogSources(inst, sources, {
        kind: "extension",
        dataKey: "extensions",
        outputField: "cachedExtensionItems",
        listInstalled: listInstalledExtensions,
        extraFields: (_raw, { installedId, installed }) => ({
            // CLI precedence position from `specify extension list` (0 = first
            // line = winner). null when the extension isn't installed. See
            // the same field on preset items for the rationale — the wizard
            // MUST NOT compute its own precedence.
            cliOrder: cliOrderFromInstalled(installedId, installed),
        }),
    });
}
