# AGENTS.md — Maintainer guidance for Spec Kit Copilot integrations

This file captures the design decisions behind these integrations so they are not
accidentally reverted when revving or regenerating it. Read this before adding,
removing, or regenerating skills.

## What this repository is

The **Copilot integration hub for Spec Kit**. It can contain independently versioned
Copilot CLI/App plugins, skills, extensions, canvases, hooks, and workflow surfaces.
Do not assume every integration belongs in the core skills plugin.

## Core skills plugin

A **GitHub Copilot CLI plugin** (`plugin.json` + `skills/<name>/SKILL.md`) that
exposes the Spec Kit **`specify` CLI** to the Copilot agent. Each skill documents a
`specify` command group and tells the agent *when* and *how* to shell out to
`specify`. The plugin does **not** dispatch prompts to another agent — Copilot itself
runs the CLI.

## Core decisions (do not silently undo)

1. **The integration is always Copilot in skills mode — do NOT expose `specify integration`.**
   This is the *Copilot* plugin, so the agent is already Copilot. Managing or
   switching integrations (claude, gemini, etc.) is meaningless here. There is
   intentionally **no `speckit-integration` skill**. Do not re-add it when
   regenerating the skill set.
   - `speckit-init` always scaffolds Copilot **in skills mode**:
     `--integration copilot --integration-options="--skills"`. Skills mode makes
     spec-kit commands (and later-added extensions) install as Copilot Agent Skills
     (`.github/skills/speckit-<cmd>/SKILL.md`) instead of `.agent.md` files, which is
     what Copilot CLI discovers as `SKILL.md`. Do not drop `--integration-options="--skills"`.
   - Skills must not tell the user to pick or switch a different agent.

2. **Expose the rest of the `specify` surface as skills**, including nested
   `catalog` subcommands and `workflow step`:
   - `speckit-cli-setup` → detect/install the `specify` CLI (bootstrap; prerequisite for all others)
   - `speckit-init`    → `specify init` (Copilot only)
   - `speckit-check`   → `specify check`, `specify version`
   - `speckit-extension` → `specify extension …` (+ `catalog`)
   - `speckit-preset`  → `specify preset …` (+ `catalog`)
   - `speckit-bundle`  → `specify bundle …` (+ `catalog`)
   - `speckit-workflow` → `specify workflow …` (+ `catalog`)
   - `speckit-workflow-step` → `specify workflow step …` (+ `catalog`)
   - `speckit-self`    → `specify self …`

   Every command-running skill carries a **Prerequisite** note that defers to
   `speckit-cli-setup` when `specify --version` fails. `speckit-cli-setup` installs the
   **latest** `specify-cli` from PyPI via `uv` (preferred) or `pipx`; `speckit-self`
   handles upgrading an already-installed CLI. Keep this prerequisite wiring when
   adding new skills.

3. **Plugins are independently versioned and are not pinned to Specify CLI.** The
   core `spec-kit-copilot` plugin targets the
   **latest** `specify` published on PyPI (package `specify-cli`), with a minimum floor
   of **>= 0.11** for the `bundle` / `workflow step` skills — do **not** hard-pin an
   `@vX.Y.Z` install tag in the skills. The plugin's own `version` in `plugin.json` and
   `.github/plugin/marketplace.json` is an **independent** semver that tracks changes to
   the plugin/skills themselves, not the CLI release. Marketplace metadata and each
   plugin entry must match the component they describe; do not force unrelated plugins
   to share a version. When revving a plugin, update its manifest, marketplace entry,
   and README version note together. Note: `specify init` stamps
   whichever installed CLI version ran it into the generated project
   (`.specify/init-options.json`, integration manifests), so the CLI version is
   determined at init time, not by this plugin.

4. **Skills are guidance, not dispatch.** SKILL.md frontmatter needs `name`
   (matching the directory), a discovery-oriented `description` (USE FOR / DO NOT
   USE FOR), and an `argument-hint`. The body lists the exact subcommands, options,
   and notes so the agent runs the real `specify` binary correctly.

5. **Picking up newly generated skills.** When a `specify` command writes new/changed
   `SKILL.md` files into the project's `.github/skills/` (extensions on `add`, bundles
   on `install`, and presets only if they regenerate skills), Copilot loads them in
   the **current** session via the `/skills reload` slash command — no restart needed —
   and automatically on the next session start. This is distinct from this plugin's own
   skills, which are refreshed with `copilot plugin install` / `/plugin`.

## Spec Kit presets (`spec-kit-presets/`) — keep the plumbing boundary

`spec-kit-presets/` holds **Copilot-specific Spec Kit presets** — this repo is their
canonical, sole home. Guard the boundary so contributors never conflate the two
toolchains:

- **Two different consumers.** Copilot plumbing (`plugin.json`, `skills/`, `plugins/`,
  `.github/plugin/marketplace.json`) is consumed by the **`copilot plugin`** CLI/App.
  Presets are consumed by the **`specify` CLI** (`specify preset add`). They are *not*
  Copilot plugins, skills, canvases, or marketplace entries.
- **Isolate, don't scatter.** All preset content — including its `catalog.json` — lives
  **inside** `spec-kit-presets/`. Do **not** put a preset `catalog.json` at the repo
  root, and do not mix it up with the Copilot marketplace manifest at
  `.github/plugin/marketplace.json`. Keep the boundary note in
  `spec-kit-presets/README.md`.
- **Promotion criterion: Copilot-specific only.** A preset belongs here only if it
  depends on Copilot's own agent mechanisms (e.g. `copilot-sub-agents` uses the VS Code
  `runSubagent` tool / Copilot CLI sub-agents / `.github/agents/`; `assess-ask-questions`
  requires Copilot's interactive `ask_user` tool with no plain-text fallback).
  Agent-agnostic presets (generic themes, or workflows tied to an extension rather
  than to Copilot's tools) do **not** belong here. Do not import them.
- **Independent versioning & release.** Each preset carries its own `version` in
  `preset.yml` and a matching `catalog.json` entry, separate from plugin versions.
  Releases are cut by CI (`.github/workflows/release-preset.yml`), which zips the
  preset **inline** (no build script) on a pushed `<preset>-v<version>` tag; use the
  **Release Preset Trigger** workflow to create that tag from a preset id + version.
  When revving a preset, bump `preset.yml` + the `catalog.json` entry together
  **before** tagging.

## When revving the core skills plugin

1. Re-enumerate the `specify` CLI surface for the **latest** release
   (`specify <group> --help`, including nested `catalog` / `step` groups).
2. Add/adjust skills for new or changed command groups — but keep decision (1):
   no integration-management skill, and `init` stays Copilot + skills mode
   (`--integration copilot --integration-options="--skills"`).
3. Bump the core plugin's `version` in `plugin.json` and its marketplace entry
   together. Bump marketplace metadata when the catalog changes. Do not bump
   `spec-kit-copilot-assess` unless that plugin changes. Update the README "Versioning"
   note. Keep the `speckit-cli-setup` skill installing the
   **latest** `specify-cli` from PyPI (no `@vX.Y.Z` pin); only touch the `>= 0.11`
   minimum notes if the floor actually changes.
4. Reinstall and verify. `copilot plugin install` takes a `plugin@marketplace`,
   `owner/repo`, `owner/repo:path`, or git URL — it does **not** accept a local path.
   After the change is pushed and the marketplace catalog is refreshed
   (`copilot plugin marketplace update spec-kit-marketplace`), run
   `copilot plugin install spec-kit-copilot@spec-kit-marketplace` (or
   `copilot plugin update`) and confirm `copilot plugin list` reports the new version
   with the expected skill count.
