# speckit-wizard

A **visual, guided wizard** for the [`spec-kit-copilot`](https://github.com/github/spec-kit-copilot)
plugin that brings Spec-Driven Development into an interactive canvas.
Ships as a GitHub Copilot **canvas extension** that sits on top of the
plugin's `speckit-*` skills and gives you three complementary ways to
work with them:

1. **Discover.** Browse the full catalog of presets, extensions,
   and bundles that customize the SDD lifecycle — with
   descriptions, source, and one-click activation, all in one place.
2. **Visualize the composition.** See how the presets and extensions
   you've layered on top of core combine — which layer contributes which
   artifact, where the hooks come from, and the resulting pipeline your
   project will actually run:

```
   setup → constitution → specify → clarify → plan → tasks → analyze → checklist → implement
```
3. **Execute the lifecycle.** Drive every phase from the **Phases** tab —
   click a phase in the pipeline, fill its form, watch the agent produce
   the artifact via the matching `speckit-*` skill.

Everything under the hood routes through the `spec-kit-copilot` plugin's
skills, so the same guardrails and behaviors apply whether you drive
Spec Kit from the wizard, from chat, or from the `specify` CLI.

![The Spec Kit Wizard canvas showing the Catalogs tab with the active preset, available presets, extensions, and bundles](../../../../docs/images/wizard-canvas.png)

## Quickstart

> This is a **canvas extension** — it opens in the **GitHub Copilot app**
> side panel, not the terminal CLI. There is no slash command or menu
> entry.

1. Register the marketplace and install it (see [Install](#install)):

```bash
  copilot plugin marketplace add OWNER/spec-kit-copilot
   copilot plugin install spec-kit-copilot-wizard@spec-kit-marketplace
```
2. Ask Copilot in chat: **"Open the Spec Kit Wizard"**.

The agent opens the wizard in a side panel. See
[Opening the dashboard](#opening-the-dashboard) for details.

## What it does

- **Guided setup** — the **Setup** tab walks you step-by-step through
  getting your environment ready to run Spec Kit. The wizard checks
  each step and tells you what to do next.
- **Catalogs** — browse built-in, Copilot, and community catalogs for
  presets, extensions, and bundles. Install them to customize your SDD
  lifecycle.
- **Composition** — see which presets and extensions are layered on top
  of core, and their composed artifacts.
- **Phases pipeline** — the **Phases** tab shows a live pipeline of every
  phase in your lifecycle. Each phase corresponds to a command you
  execute — customize the commands in the pipeline, provide input to
  execute them, and view each artifact produced.

## Opening the dashboard

This is a **canvas extension**, so it renders in the **GitHub Copilot
app** side panel — not in the plain terminal CLI. Installing the plugin
only *registers* the canvas; nothing opens automatically.

To open it, ask Copilot in chat, e.g. **"Open the Spec Kit Wizard"** (or
"open the wizard"). The agent matches your request to this canvas
(`id: speckit-wizard`, displayName **"Spec Kit Wizard"**) and opens it
in a side panel. There is no slash command or menu entry — discovery is
the agent matching the canvas name/description.

Once it is open you can drive it two ways:

- **Click through the wizard UI** in the canvas.
- **Ask the agent in chat** to run a step or open a view for you.

## How it drives the pipeline

Buttons in the canvas POST to a loopback HTTP endpoint, which calls
`session.send({ prompt: "/skill:speckit-<command> …" })`. The skill runs
in your normal chat session — watch the transcript for the agent's work
and any prompts (e.g. slug confirmation, clarifying questions, etc).

Commands are restricted to the `speckit-*` skills of the customized
lifecycle, and feature slugs are normalized to `[a-z0-9-]`, so the
canvas can only trigger phases that belong to your composed pipeline.

## Agent-callable actions

You can drive the wizard with natural-language prompts at any point —
the agent maps what you ask into canvas actions and the UI updates
accordingly. The extension registers **11 actions** across four groups:

**Verbs (agent-initiated work):**
- `runPhase` — dispatch a phase's `/speckit-<phase>` slash command with the
  wizard tracking preamble (same code path as the Run phase button).
- `addPreset` — install a preset by id (same code path as the Install button).
- `addExtension` — install a Spec Kit extension by id (same code path as
  the Install button).
- `reloadSessionSkills` — reload Copilot's in-memory skill registry for
  the session (equivalent to `/skills reload`).

**UI navigation (push state to a tab):**
- `showPresetCatalog` — push the preset catalog to the Catalogs tab.
- `showExtensionCatalog` — push the extension catalog to the Catalogs tab.
- `showBundleCatalog` — push the bundle catalog to the Catalogs tab.
- `showEnvReport` — push environment status (CLI version, probes,
  scaffolded skills) to the Setup → Environment sub-panel.

**LLM-driven inference:**
- `showInferredPipeline` — target of the `composition.inferPipeline`
  prompt; the agent pushes an inferred `{ shape, pipeline, unplaced,
  rationale }` ordering derived from `state.composition.artifacts` +
  fetched READMEs. Partial-merge preserves the assembler-owned
  composition slice.

**Phase-tracking callbacks (agent → wizard after `runPhase`):**
- `setPhaseStatus` — update the status (and optional artifact path) of
  a phase after the scaffolded skill finishes.
- `reportExecution` — report which of the phase's expected templates /
  scripts / hooks the agent actually invoked, per the tracking
  preamble's closed list. Called once after `setPhaseStatus(status:'done')`.

Example prompts:

- "Open the Catalogs view and show me the active preset."
- "Update the environment panel."
- "Run the plan phase on `<slug>`."
- "Add the `copilot-sub-agents` preset."
- "Add the `spec-kit-assess` extension."
- "Mark tasks done for `<slug>`."

## Install

**Via marketplace (recommended):**

```bash
copilot plugin marketplace add OWNER/spec-kit-copilot
copilot plugin install spec-kit-copilot-wizard@spec-kit-marketplace
```

The plugin manifest lives at `plugins/spec-kit-copilot-wizard/plugin.json`
and declares this directory through its `extensions/` component path.

**Anywhere else (gist):** share it as a private gist
("Share extension as gist…" in the command palette, or the
`share_extension` tool), then install with "Install extension from gist…"
into `~/.copilot/extensions/` so it follows you across projects. The
bundled `copilot-extension.json` manifest is what makes the gist install
flow recognize it.

## Requirements

- The Spec Kit `specify` CLI on your `PATH` (the wizard's environment
  probe checks this and offers a one-click install via
  `speckit-cli-setup`).
- The `spec-kit-copilot` core skills plugin installed — the wizard
  dispatches to its skills by name.
- Node.js runtime (bundled with the Copilot App); one npm dependency
  (`js-yaml`) is used for reading preset / bundle YAML.
  The wizard installs it automatically on first open of a fresh clone
  or worktree — no manual `npm install` needed.

The wizard writes its own control-plane state to
`.speckit-wizard/state.json` in the target project. Artifact files
live where Spec Kit puts them: `.specify/memory/constitution.md` and
`specs/<slug>/{spec,plan,tasks,analysis}.md` plus
`specs/<slug>/checklists/`.

## Files

| File | Purpose |
| --- | --- |
| `extension.mjs` | Sole importer of `@github/copilot-sdk/extension`; SDK wiring, canvas actions, `session.send` driving. |
| `pipeline/phases.mjs` | Phase list, form schemas, default text, `SKILL_BY_KIND`, and the file-contract preamble. |
| `project-scanner.mjs` | Workspace scan, defensive normalization, size-bounded artifact reads. |
| `prompts.mjs` | Pure `(kind, payload, context) → string`. |
| `canvas-runtime/snapshot-builder.mjs` | Pure `buildStateSnapshot` and HTML fragment helpers. |
| `server.mjs` | `createHandler(deps)`, `startServer(instanceId, deps)`. |
| `env/probe.mjs` | Pure `decideChecks`, impure `runChecks`, `summarizeResults`. |
| `state/store.mjs` | `.speckit-wizard/state.json` read / write / normalize. |
| `graph.mjs` | Phase graph derivation. |
| `preset/loader.mjs` | Loads presets from disk (YAML manifests + command files). |
| `preset/order.mjs` | Deterministic preset ordering rules. |
| `composition-assembler.mjs` | Assembles the effective composition (presets/extensions + hooks + artifact stacks) from preset / extension / bundle / workflow inputs. |
| `env/deps-check.mjs` | Detects whether `js-yaml` is installed under `node_modules/`. |
| `workspace.mjs` | Workspace path and session-metadata helpers. |
| `ui/` | Dashboard UI (served to the canvas iframe): `index.html`, `app.js`, `styles.css`, and the small pure helpers it imports. |
| `composition/collect.mjs` | Companion CLI that assembles a composition report from a project. |
| `test/*.test.mjs` | `node --test`-runnable unit tests (zero SDK, zero network, zero real subprocess spawns). |
| `copilot-extension.json` | Manifest for gist share/install. |
| `package.json`, `package-lock.json` | `js-yaml` runtime dependency. |
