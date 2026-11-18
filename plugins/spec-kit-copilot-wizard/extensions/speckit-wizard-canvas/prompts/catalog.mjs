// speckit-wizard — LLM prompt builders for the "catalog" action family.
//
// This file (and its `prompts/*.mjs` siblings) is where the wizard stores
// the text prompts it sends to the Copilot agent. Most builders emit a
// prompt that begins with a `/speckit-<skill>` slash command so Copilot CLI
// auto-loads the matching SKILL.md into context, followed by wizard-
// provided arguments, state, and file contract preambles. A few builders
// (`setup.reloadSkills`, `composition.refresh`, `composition.inferPipeline`)
// emit CLI slash commands (`/skills reload`) or plain natural-language
// instructions instead — see the family map in `../prompts.mjs`.
//
// All builders in THIS file dispatch to a `/speckit-*` skill:
//   • preset.install / preset.remove                  → /speckit-preset
//   • extension.install / extension.remove             → /speckit-extension
//   • bundle.install / bundle.remove                   → /speckit-bundle
//
// See `../prompts.mjs` for the top-level dispatcher and family split.

import { fmtHeader } from "./shared.mjs";

export const CATALOG_KINDS = new Set([
    "preset.install",
    "preset.remove",
    "extension.install",
    "extension.remove",
    "bundle.install",
    "bundle.remove",
]);

export function buildCatalogPrompt(kind, payload, context, { workspacePath, skill }) {
    void context;
    switch (kind) {
        case "preset.install":
        case "preset.remove": {
            const verb = kind === "preset.install" ? "Install" : "Remove";
            const id = payload?.name ?? "<id>";
            const url = payload?.downloadUrl;
            return (
                fmtHeader({
                    skill,
                    kind,
                    workspacePath,
                    boundary: `${verb} exactly the named preset.`,
                }) +
                [
                    kind === "preset.install"
                        ? [
                            `Install the preset with id \`${id}\`${url ? ` from download URL \`${url}\`` : ""}.`,
                            id === "copilot-sub-agents"
                                ? "Install with `--priority 1` so it sits at the top of the layer stack — it takes precedence over other presets by default."
                                : "",
                          ].filter(Boolean).join(" ")
                        : `Remove the preset with id \`${id}\`.`,
                    "Then re-list presets and push via `showPresetCatalog`.",
                    "`.speckit-wizard/state.json` is the state store.",
                ].join("\n")
            );
        }

        // -------- Extension steps --------
        case "extension.install":
        case "extension.remove": {
            const verb = kind === "extension.install" ? "Install" : "Remove";
            return (
                fmtHeader({
                    skill,
                    kind,
                    workspacePath,
                    boundary: `${verb} exactly the named extension.`,
                }) +
                [
                    `Payload: \`${JSON.stringify(payload)}\``,
                    kind === "extension.install"
                        ? "Install rules: If the payload includes a `downloadUrl`, install via `specify extension add <id> --from <downloadUrl>` (used for community/discovery-only extensions). Otherwise install via `specify extension add <id>` (built-in default catalog)."
                        : "Run `specify extension remove <id>` to uninstall.",
                    "Then re-list extensions and push via `showExtensionCatalog`.",
                    "`.speckit-wizard/state.json` is the state store.",
                ].join("\n")
            );
        }

        // -------- Bundle steps --------
        case "bundle.install":
        case "bundle.remove": {
            const verb = kind === "bundle.install" ? "Install" : "Remove";
            return (
                fmtHeader({
                    skill,
                    kind,
                    workspacePath,
                    boundary: `${verb} exactly the named bundle.`,
                }) +
                [
                    `Payload: \`${JSON.stringify(payload)}\``,
                    kind === "bundle.install"
                        ? [
                              "Install rules — the bundle CLI subcommand is `install` (NOT `add`) and has NO `--from` flag. `specify bundle install` accepts a catalog bundle id, a local `.zip` path, a bundle directory, or a `bundle.yml` path.",
                              "• If the payload includes a non-null `bundleYml` string (wizard `test` catalog): materialize it to a temp bundle directory then install from the path. PowerShell: `$d=Join-Path $env:TEMP \"speckit-<id>-bundle\"; if(Test-Path $d){Remove-Item $d -Recurse -Force}; New-Item -ItemType Directory -Path $d | Out-Null; Set-Content -Path (Join-Path $d \"bundle.yml\") -Value <bundleYml> -Encoding utf8; specify bundle install $d`. Delete the temp dir after install completes.",
                              "• Else if the payload includes a `downloadUrl` (community/discovery-only bundle): download the zip to a temp path, then run `specify bundle install <local-zip-path>`. On Windows PowerShell: `Invoke-WebRequest -Uri <downloadUrl> -OutFile $env:TEMP\\<id>.zip -UseBasicParsing; specify bundle install $env:TEMP\\<id>.zip`. On bash: `curl -L <downloadUrl> -o /tmp/<id>.zip && specify bundle install /tmp/<id>.zip`. Delete the temp zip after install completes.",
                              "• Otherwise (built-in default catalog): `specify bundle install <id>`.",
                              "Known upstream constraint: `specify bundle install` delegates to `specify preset add` / `specify extension add` for each referenced component. If any component lives only in a discovery-only catalog and the bundle manifest doesn't include component payloads, install will fail with `Error: <component> not found in any catalog.` This is an authoring issue in the bundle, not a CLI-syntax bug — surface the error in chat and continue.",
                          ].join("\n")
                        : "Run `specify bundle remove <id>` to uninstall.",
                    "Then re-list bundles and push via `showBundleCatalog`.",
                    "Because `specify bundle install/remove` delegates to `specify preset add/remove` and `specify extension add/remove` per component, ALSO re-list presets AND extensions and push `showPresetCatalog` + `showExtensionCatalog` so the Presets/Extensions/Composition views reflect the change.",
                    "Bundle components may scaffold Copilot skills under `.github/skills/`. After the CLI succeeds, invoke the `reloadSessionSkills` canvas action via `invoke_canvas_action` on this wizard instance so the in-memory skill registry picks them up. Do NOT emit `/skills reload` as plain text.",
                    "`.speckit-wizard/state.json` is the state store.",
                ].join("\n")
            );
        }

        default:
            throw new Error(`buildCatalogPrompt: unexpected kind ${kind}`);
    }
}
