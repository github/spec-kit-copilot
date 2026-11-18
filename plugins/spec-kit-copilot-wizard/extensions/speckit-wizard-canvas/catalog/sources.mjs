// catalog/sources.mjs — shared helpers + configured catalog URL
// tables for the preset / extension / bundle catalog hydration modules.
// See the sibling files (presets.mjs, extensions.mjs, bundles.mjs) for the
// per-kind hydrators and the CLI-shelled "installed" list queries.

// PRESET_CATALOG_URL: the fixed set of preset catalogs the wizard shows —
// `default` and `community` (the upstream spec-kit built-ins) plus `copilot`
// (this plugin's own catalog).
//
// The wizard is a viewer for a fixed, plugin-owned set of sources with
// runtime-configurable URLs, not a general catalog manager. It does NOT read
// `.specify/preset-catalogs.yml` or invoke `specify preset catalog add`,
// which keeps the wizard read-only with respect to the user's CLI-managed
// catalog config.
//
// How installs still work: for each entry above, the wizard fetches the
// catalog JSON directly over HTTPS and reads each preset's `download_url`
// out of it. Installs use `specify preset add --from <download_url>`, which
// bypasses the CLI's catalog resolution — so no prior `catalog add`
// registration is required.
//
// Out of scope: third-party catalogs a user has registered via the CLI
// (`specify preset catalog add ...`) will NOT appear in the wizard. Users
// who need those should install presets from them via the CLI directly.
import { runtimeSettings } from "../env/runtime-settings.mjs";

export const PRESET_CATALOG_URL = Object.fromEntries(
    ["default", "copilot", "community"].map((source) => [source, runtimeSettings.catalogs[source].presets]));

// Extension catalog counterparts. Extensions have `default` and `community`
// upstream in the spec-kit repo. Same configure-and-fetch-directly design as
// PRESET_CATALOG_URL above; installs use `specify extension add <id> --from
// <download_url>` and no CLI catalog registration is used.
export const EXTENSION_CATALOG_URL = Object.fromEntries(
    ["default", "copilot", "community"].map((source) => [source, runtimeSettings.catalogs[source].extensions]));

// Bundle catalog counterparts. Same configure-and-fetch-directly design as
// above. The built-in `bundles/catalog.json` may not exist yet upstream
// (404); the community catalog carries the sole known bundle today. Fetch
// failures on either URL are non-fatal — see hydrateBundlesForSources.
export const BUNDLE_CATALOG_URL = Object.fromEntries(
    ["default", "community"].map((source) => [source, runtimeSettings.catalogs[source].bundles]));

export async function fetchCatalogJson(url) {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.json();
}
