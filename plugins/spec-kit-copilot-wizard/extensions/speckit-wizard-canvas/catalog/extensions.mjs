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

import { hydrateFromCatalogSources, cliOrderFromInstalled, parseInstalledPackageList, specifyRun } from "./shared.mjs";

// Query Specify's JSON inventory to detect installed extensions and preserve
// resolver order. The human-readable list follows registry order instead.
export async function listInstalledExtensions(workspacePath, run = specifyRun) {
    const stdout = await run(["extension", "list", "--json"], workspacePath);
    return parseInstalledPackageList(stdout, "extension");
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
            // CLI precedence position from `specify extension list --json`
            // (0 = first array entry = winner). null when not installed. See
            // the same field on preset items for the rationale — the wizard
            // MUST NOT compute its own precedence.
            cliOrder: cliOrderFromInstalled(installedId, installed),
        }),
    });
}
