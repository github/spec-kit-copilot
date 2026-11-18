---
name: dev-tools-speckit-wizard-installed-refresh
description: 'Refresh both installed Wizard and Designer providers from the current worktree for local development, optionally setting runtime configuration when requested. USE FOR: testing worktree changes through installed plugin canvases. DO NOT USE FOR: publishing, updating marketplace metadata, modifying source, or sample/session previews.'
argument-hint: '[open-wizard] [fork|defaults|custom settings setup]'
---

# Refresh the installed Wizard and Designer

Local development only. A later `copilot plugin update` can replace copied code.
Use one active Wizard/Designer provider pair; never substitute a user/session
preview, write to the main checkout, or modify personal skill copies.

1. Resolve `plugins\spec-kit-copilot-wizard` in the **current worktree**.
   Check `plugin.json` names `spec-kit-copilot-wizard` and both
   `extensions\speckit-wizard-canvas\extension.mjs` and
   `extensions\speckit-canvas-designer\extension.mjs` exist. Record
   `git status --short`. Run `node dev-tools\configure-runtime.mjs show`.
   Fail visibly on invalid configuration; do not mask it with defaults.
2. **Only when requested**, set up fork/default/custom runtime settings:
   preview `node dev-tools\configure-runtime.mjs use-fork` (custom:
   `--source "<settings JSON>"`) or `use-defaults`. Optional `--file` selects
   an explicit destination; normally use the user-level file for desktop and
   child sessions. Present the actual replacement diff and effective settings,
   obtain confirmation, then repeat the same command with
   `--apply --expect "<preview expect digest>"`. Re-preview any conflict.
   Replaced files get sibling dated backups; retain them. `use-fork` merges
   selected overrides, preserving other valid settings; `use-defaults` replaces
   overrides with `{}` without breaking an explicit selector. No per-value
   environment overrides or machine-wide environment edits.
   Do not rewrite configuration on ordinary refresh.
3. Use `extensions_manage` **inspect** on the exact IDs
   `plugin:spec-kit-copilot-wizard:speckit-wizard-canvas` and
   `plugin:spec-kit-copilot-wizard:speckit-canvas-designer`.
   Derive their common installed plugin root from returned paths; never guess
   a username, marketplace directory, or session ID. Require both `source: plugin`,
   the same root, and `plugin.json` name `spec-kit-copilot-wizard`.
   Check destination trees and ancestors are real directories, not junctions
   or symlinks. Stop and report unexpected/missing providers or paths.
4. Compare inventories and hashes for **both extension trees**. Include
   source-owned runtime files, manifests, UI assets, and documentation.
   Exclude `node_modules`, `.git`, tests, e2e, `test-results`, and caches.
   Show changed/new files; obtain approval before overwriting an unexpected
   installed-only customization. Refresh both trees together: Wizard
   `server\handlers-designer.mjs` imports sibling Designer `handoff.mjs`.
5. Back up each affected installed file to a dated directory under the current
   CLI session's `session-state\...\files\`, not the repository. Copy only
   changed/new source-owned files, preserving dependencies, unrelated files,
   and customizations. Never use `robocopy /MIR` or delete either tree.
   If a removed source file leaves executable stale code, identify that exact
   file, back it up, and obtain approval before removing it; no bulk deletion.
6. Restore dependencies with the repository package manager only if a dependency
   manifest changed or a validation command fails for a missing dependency.
   Stop on failure. Hash-verify copied files, call `extensions_reload`, and
   `list_canvas_capabilities` for `speckit-wizard` and
   `speckit-canvas-designer` with their respective exact plugin IDs.
   Inspect both providers and failed-provider startup logs. Require the
   restored Wizard `cwd`/boolean `generateCanvas` input contract. Stop on
   incompatibility; do not silently select another provider.
7. Run configuration `show` again. Report **selected settings** and **installed
   code** separately; applying a file is not proof a running provider reloaded.
   Verify the mounted snapshot's `featureFlags.generateCanvas` for a newly opened
   instance (existing instances preserve their flag); no public config-summary
   payload is needed. If reload does not apply settings/code, require a new
   session/restart. Do not implicitly open a canvas just to perform refresh.
   Check explicit `SPECKIT_CONFIG_FILE` selection in children rather than assuming
   environment inheritance; prefer the default user-level file for desktop.
   If an open was requested, invoke `dev-tools-speckit-wizard-installed-open`, forwarding
   any explicit Generate disable request; its default is enabled. Do not launch Designer
   or run phases. Compare final Git status with the starting state.
   Never print loopback tokens or claim child setup succeeded from opening Wizard.

Switching runtime settings does not restore published provider code. Use an
explicit marketplace install/update when the user requests that restoration.
The `dev-tools-` prefix distinguishes this project skill from personal skills.
Leave personal copies untouched; use `/skills reload` to discover project changes.
