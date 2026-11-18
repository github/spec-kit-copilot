---
name: dev-tools-speckit-wizard-installed-open
description: 'Open or focus the installed Spec Kit Wizard for the current worktree with Generate enabled by default. USE FOR: installed Wizard opening and Designer launch testing. DO NOT USE FOR: refreshing, configuring, sample/session previews, launching Designer, or running phases.'
argument-hint: '[canvas instance ID] [disable Generate]'
---

# Open the installed Spec Kit Wizard

Open the installed plugin, not a sample or session preview. `cwd` chooses its
workspace, not its provider code. This skill may enable only the known installed
plugin/providers; it never copies code or changes runtime configuration.

1. Resolve the absolute current worktree. Inspect
   `plugin:spec-kit-copilot-wizard:speckit-wizard-canvas` via
   `extensions_manage`. Require the exact ID, `Source: plugin`, and
   `extensions\speckit-wizard-canvas\extension.mjs` under an installed plugin
   root, not this worktree or `session-state\...\extensions\`.
   Derive the root; check `plugin.json` name `spec-kit-copilot-wizard`.
   Stop and report unexpected identity/source/path; do not guess install paths.
2. **Always** inspect `~\.copilot\settings.json` at
   `extensions.disabledExtensions`, even if Wizard says running. Inspect
   `plugin:spec-kit-copilot-wizard:speckit-canvas-designer` and require the exact
   plugin identity and entry path under the same installed root.
   Never enable unknown/non-plugin providers. If either exact ID is persistently
   disabled, back up settings under the current session's `session-state\...\files\`,
   then remove **only** these two exact IDs with a JSON-aware edit, preserving
   every other setting and disabled entry. Re-read and confirm both are absent.
   If the installed plugin itself is disabled, run
   `copilot plugin enable spec-kit-copilot-wizard`.
   After changes call `extensions_reload` and inspect both providers again.
   Stop with status/startup logs on failed/disabled providers; if persisted
   settings are clear but inspection still says disabled, require a new session.
   Do not claim a future child's skill-reload tool is available without checking
   both persisted disabled entries.
3. Call `list_canvas_capabilities` with `canvasId: "speckit-wizard"` and
   `extensionId: "plugin:spec-kit-copilot-wizard:speckit-wizard-canvas"`.
   Require the exact returned provider and an input schema supporting `cwd`
   and boolean `generateCanvas`. Reject incompatible installed versions.
4. Call `open_canvas` with the same IDs and
   `instanceId: "wizard-installed-worktree"` (or supplied ID).
   By default, enable Generate on both initial opens and reopens: pass
   `{ "cwd": "<absolute worktree>", "generateCanvas": true }`.
   Do not omit the flag or preserve a previously disabled instance by default.
   If the user explicitly requests Generate disabled, pass the same `cwd` and
   `"generateCanvas": false` instead. This is a per-instance override;
   do not change runtime configuration or `generateCanvasEnabled`.
   Confirm the exact returned provider and requested workspace. Read the mounted
   Wizard's existing read-only `/api/state` snapshot, and verify
   `featureFlags.generateCanvas` is `true` by default, or `false` for an explicit
   disable request. Do not require a new configuration-summary payload or assume echoed
   open input proves the effective flag. Keep authentication/loopback tokens
   private; never print token-bearing URLs.
   Report mismatches rather than success; never launch Designer or submit Generate.

Opening does not refresh code. Use `dev-tools-speckit-wizard-installed-refresh` explicitly
for source changes. Runtime settings are resolved at provider startup, not live.
Do not claim Designer readiness merely because Wizard opened. Leave personal
skills unchanged; use `/skills reload` to discover project changes.
