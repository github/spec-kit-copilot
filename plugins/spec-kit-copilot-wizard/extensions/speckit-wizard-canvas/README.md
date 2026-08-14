# speckit-wizard

A **visual, guided wizard** that brings Spec-Driven Development into an
interactive canvas — a showcase of both the [Spec Kit `specify`
CLI](https://github.com/github/spec-kit) and the
[`spec-kit-copilot`](https://github.com/github/spec-kit-copilot) plugin.
Ships as a GitHub Copilot **canvas extension** that sits on top of the
plugin's `speckit-*` skills (which in turn shell out to the `specify`
CLI) and gives you three complementary ways to work with them:

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

### The four main pages

**Setup → Environment** — verifies prerequisites (plugin, CLI, project init,
default presets, skills reload) and lights up each step as it completes.

![Setup → Environment page](../../../../docs/images/wizard-environment.png)

**Setup → Catalogs** — browse Built-in, Copilot, and Community catalogs of
presets, extensions, and bundles, and add the ones you want to your project.

![Setup → Catalogs page](../../../../docs/images/wizard-catalogs.png)

**Setup → Composition** — the layered view of what your project actually runs:
per-artifact stacks (commands, templates, scripts, hooks) resolved across
Core, presets, and extensions, plus a Layers sidebar in precedence order.

![Setup → Composition page](../../../../docs/images/wizard-composition.png)

**Phases** — the executable pipeline. Click any phase to see its active
artifacts, provide input, and run the matching `speckit-*` skill.

![Phases page](../../../../docs/images/wizard-phases.png)

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

This is a **canvas extension**, so it renders in the **GitHub Copilot app**
side panel — not in the plain terminal CLI. Installing the plugin
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
- `runNpmDiagnostics` — dispatch a scripted npm-diagnostic prompt to the
  parent session so the Copilot agent walks a checklist (inspect
  `~/.npmrc`, ask about the org's approved feed / CA / proxy, propose a
  minimal config change, retry the install, call `refreshEnvironment`
  when done). Wired to the "Diagnose and fix with the agent" button on
  the boot overlay's deps-error card. See [First-open boot](#first-open-boot).

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

<a id="first-open-boot"></a>

### First-open boot

On first open of a fresh worktree, the wizard shows a live boot overlay
while the backend runs its startup checklist: **workspace → deps-check
→ deps-install → env-probe → catalog → ready**. The HTTP server is
started *first*, before any long-running work, so the canvas iframe
loads within ~1 second and each step animates in place with an elapsed
timer. The `deps-install` row streams npm's live output as the last
line under the row title, so users see progress instead of a blank
"installing…" spinner.

If `npm install` fails (e.g. a corporate TLS-inspecting proxy blocks
`registry.npmjs.org`), the deps-install row is replaced in-place with
an error card classifying the failure and offering two buttons:

- **Diagnose and fix with the agent** — dispatches a scripted prompt
  to the Copilot agent (via the `runNpmDiagnostics` canvas action).
  The agent inspects `~/.npmrc`, asks about the user's approved
  internal feed / CA / proxy, proposes a minimal config change, and
  retries the install. When it succeeds the agent calls
  `refreshEnvironment`; the boot overlay picks up the new state and
  animates through the remaining steps.
- **Retry install** — re-runs `installDeps` on the same backend, so
  the same overlay progress + error classification pipeline covers the
  retry too.

The wizard never hard-fails on install failure — the canvas stays
open with the actionable boot overlay so users can self-serve the
repair without closing the panel.

The wizard writes its own control-plane state to
`.speckit-wizard/state.json` in the target project. Artifact files
live where Spec Kit puts them: `.specify/memory/constitution.md` and
`specs/<slug>/{spec,plan,tasks,analysis}.md` plus
`specs/<slug>/checklists/`.

## Files

| File | Purpose |
| --- | --- |
| `extension.mjs` | Sole importer of `@github/copilot-sdk/extension`; SDK wiring, canvas actions, `session.send` driving. |
| `server.mjs` | `createHandler(deps)` + `startServer(instanceId, deps)` — loopback HTTP surface the canvas iframe posts to. |
| `server/` | HTTP request handlers (`handlers-ops.mjs`, `handlers-phase.mjs`) and shared HTTP utilities incl. sandbox helpers (`http-utils.mjs`). |
| `project-scanner.mjs` | Workspace scan, defensive normalization, size-bounded artifact reads. |
| `prompts.mjs` | Pure `(kind, payload, context) → string` slash-command builder. |
| `canvas-runtime/` | Long-lived per-instance state: `instances.mjs`, `snapshot-builder.mjs` (pure state → snapshot), `snapshot.mjs` (broadcast), `watchers.mjs` (fs), `dispatch.mjs` (SDK action router), `wizard-phases.mjs` (phase list + `SKILL_BY_KIND`), `composition-apply.mjs`. |
| `pipeline/` | Pipeline math: `canonical.mjs` (canonical phase vocabulary), `effective-phases.mjs`, `active-artifacts.mjs` (per-phase resolved artifacts), `validate.mjs`. |
| `composition/` | Composition graph: `assembler.mjs` (composes preset/extension/bundle layers), `preset-loader.mjs`, `preset-order.mjs`, `collect.mjs` (companion CLI). |
| `catalog/` | Catalog hydration for the Setup → Catalogs page: `sources.mjs` (hardcoded catalog URL table + `fetchCatalogJson`), `presets.mjs`, `extensions.mjs`, `bundles.mjs`, `shared.mjs`. |
| `env/` | Environment probe + PATH resolution: `probe.mjs`, `probe-cache.mjs`, `resolve-path.mjs` (locates `copilot`/`specify` binaries when the SDK dir isn't on `PATH`), `deps-check.mjs`, `workspace.mjs`. |
| `state/` | `.speckit-wizard/state.json` read / write / normalize: `store.mjs`, `normalize.mjs`, `execution-reports.mjs`. |
| `ui/` | Dashboard UI served to the canvas iframe: `index.html`, `app.js`, `client.js`, plus per-page modules (`setup.js`, `catalog.js`, `composition.js`, `composition-artifacts.js`, `phase-card.js`, `phase-contributors.js`, `phase-runtime.js`, `state.js`, `modals.js`). |
| `test/` | 5 consolidated `node --test` files (`composition`, `catalog`, `env`, `state-and-scanner`, `server-integration`) — zero SDK, zero network, zero real subprocess spawns. |
| `copilot-extension.json` | Manifest for gist share/install. |
| `package.json`, `package-lock.json` | `js-yaml` runtime dependency. |
