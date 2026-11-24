---
name: dev-tools-speckit-wizard-local-generate-launch
description: "Launch local Generate testing with this worktree's installed Wizard and Designer and explicitly enabled Generate. USE FOR: unreleased local generation changes. DO NOT USE FOR: publishing, automatically submitting generation, sample previews, or claiming child package installation from a Wizard open."
argument-hint: '[wizard instance ID] [requested runtime settings setup]'
---

# Launch local Generate testing

Local development launcher, not an unattended generation run. The `dev-tools-`
prefix distinguishes this project launcher from personal development skills.

1. Record `git status --short`; require both current-worktree provider entry
   files under `plugins\spec-kit-copilot-wizard\extensions\`.
   Never use the main checkout or session-local previews.
2. Invoke `dev-tools-speckit-wizard-installed-refresh` for **both providers**, retaining
   inventory, customization approval, backup, identity, hash and reload checks.
   Forward runtime setup only if requested; ordinary launch must not rewrite
   settings. Stop on partial refresh or failed/incompatible providers.
3. Invoke `dev-tools-speckit-wizard-installed-open` with the supplied instance ID or
   `wizard-installed-worktree`, **explicitly requesting Generate**.
   Require `plugin:spec-kit-copilot-wizard:speckit-wizard-canvas`,
   this worktree's absolute `cwd`, and `input.generateCanvas: true`.
   Verify snapshot `featureFlags.generateCanvas` and the corresponding refreshed
   `plugin:spec-kit-copilot-wizard:speckit-canvas-designer`.
4. Guide the user to select phases and, in Wizard **Local development**, approve
   both paths in this worktree:
   - `spec-kit-extensions\extension-canvas-design`
   - `spec-kit-presets\copilot-vertical-phase-control`
   Keep the resulting extension/preset selections checked. The child may start
   from the project default branch; approved paths, not that branch, supply the
   development packages. Leave Designer launch, Essentials settings, and
   Generate submission user-driven. Do not invoke phases or submit Generate.
5. Compare final Git status. Report only that the installed Wizard is open
   with Generate enabled, not that generation or child setup succeeded.
   If asked to validate the journey, inspect the actual child installation:
   Canvas Design `commands\generate.md`, `scripts\generate.mjs`, packaged
   templates; vertical control command/templates and resolved contribution
   provenance; and actual generated output. Require both approved local package
   selections to match the worktree. Do not silently fall back to hosted ZIPs.
   Never modify a symlinked Specify development installation.

Separate local-source evidence from hosted release readiness. Hosted readiness
requires the actual published ZIPs selected by the catalogs and a journey with
no local overrides. Do not bump versions or publish for routine testing.
Leave personal skills untouched; run `/skills reload` and verify project discovery.
