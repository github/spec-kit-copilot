// catalog/bundles.mjs — bundle catalog hydration.
//
// Why direct CLI, not the /speckit-bundle skill: this is a passive,
// server-side detection read that runs during tile rendering — there is no
// active agent turn to dispatch a prompt into. Skill dispatch (via the
// wizard's /api/prompt seam → Copilot agent → /speckit-bundle) is reserved
// for user-triggered actions like install/remove, where the agent's
// invocation output belongs in chat. Machine-parseable read-only queries
// stay on the direct CLI path (same pattern as presets.mjs and
// extensions.mjs).

import { hydrateFromCatalogSources, specifyRun } from "./shared.mjs";

// Query `specify bundle list` for installed bundles. Tolerant of the
// subcommand being absent — returns empty sets on any error so bundle
// rendering degrades gracefully.
export async function listInstalledBundles(workspacePath) {
    const stdout = await specifyRun(["bundle", "list"], workspacePath);
    const ids = new Set();
    const names = new Set();
    const byName = new Map();
    if (stdout == null) return { ids, names, byName };
    const lines = stdout.split(/\r?\n/);
    for (const line of lines) {
        // `specify bundle list` prints one entry per line:
        //     <id> v<version> (<n> components, installed <ts>)
        // No separate display name is shipped, so id doubles as name.
        const m = line.match(/^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s+v[^\s(]+\s*\(/);
        if (!m) continue;
        const id = m[1];
        ids.add(id);
        names.add(id.toLowerCase());
        byName.set(id.toLowerCase(), id);
    }
    return { ids, names, byName };
}

// Given bundle catalog sources, fetch each source's JSON directly. Delegates
// the source-iteration / fetch / installed-id-match / item-shape scaffolding
// to `hydrateFromCatalogSources`; only bundle-specific extras remain here.
// Fetch failures (e.g. the built-in `bundles/catalog.json` returning 404
// today) are logged as warnings and skipped so the community bundles still
// render.
export async function hydrateBundlesForSources(inst, sources) {
    return hydrateFromCatalogSources(inst, sources, {
        kind: "bundle",
        dataKey: "bundles",
        outputField: "cachedBundleItems",
        listInstalled: listInstalledBundles,
        extraFields: (raw) => ({
            // TODO: temp only — carries an inline bundle.yml body for the
            // wizard-shipped `test` catalog. The install prompt materializes
            // it to a temp dir and runs `specify bundle install <dir>`.
            bundleYml: raw?.bundle_yml ?? null,
        }),
    });
}
