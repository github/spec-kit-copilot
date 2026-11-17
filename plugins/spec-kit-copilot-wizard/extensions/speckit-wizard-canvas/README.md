# speckit-wizard

## Runtime settings

Catalog locations are read from packaged `config/runtime-defaults.json`, with
optional overrides in `~/.copilot/spec-kit/runtime-settings.json`. Set
`SPECKIT_CONFIG_FILE` to an absolute settings-file path to select a different
override instead. Explicit missing files, malformed JSON, unknown keys, and
invalid values fail startup with an error rather than reverting to defaults.

Overrides support `catalogs.copilot.presets/extensions`,
`catalogs.default.presets/extensions/bundles`,
`catalogs.community.presets/extensions/bundles`, `copilotCatalogName`, and
boolean `generateCanvasEnabled`. URLs must be HTTPS without credentials or
fragments. Restart/reload the provider after editing; no rebuild is needed.
Use the repository's fork example and project-level local development skills
for setup. A shell selector affects newly launched processes, not an app
already running; the user-level file is the reliable desktop/child-session
choice. Explicit selectors must also reach child processes when used there.

Generate defaults off. A `generateCanvas: true` canvas open explicitly enables
it for that instance; omitted input preserves the value on reopening. The
server rejects disabled launch requests as well as hiding the UI button.
Marketplace identity and release ZIP metadata are distribution configuration,
not runtime settings. Existing handoffs retain their approved install URLs.

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

### Browser tests

Install the Specify CLI separately (`uv tool install specify-cli` or
`pipx install specify-cli`) and ensure `specify` is on `PATH`:
`specify --version` must succeed in the shell running the tests. Node
dependencies do not install the CLI. From this extension directory, run
`npm ci`; also run `npm ci` in the sibling
`speckit-canvas-designer` extension directory. Then run
`npx playwright install chromium` and `npm run test:e2e` here.
The browser tests live in the repository's
`tests/e2e/` directory and start a local Wizard server with fixed
catalog data. The contract journey in `contracts.spec.mjs` injects raw
`specify … list --json` responses through the real inventory reader, captures
the launch prompt, and opens the resulting handoff in a Designer shell;
only this mocked journey needs no live agent or Specify installation.
`specify-fixtures.spec.mjs` runs the CLI to initialize projects, install
packages, and read inventory, so the full browser suite requires Specify.
`wizard-journeys.spec.mjs` uses isolated temporary checkouts and controlled
test-only preset/extension packages for catalog, refresh, phase, and output
journeys; it does not depend on live catalog inventory. The local test server
defaults to port 4177; set `SPECKIT_E2E_PORT` to use another port (and pass
Playwright `--output` when running multiple suites concurrently).
The [user-flow test plan](../../../../docs/testing/wizard-designer-test-plan.md)
and [implementation audit](../../../../docs/testing/wizard-designer-implementation-plan.md)
record coverage and existing-test decisions.
`.github/workflows/wizard-e2e.yml` runs them on PRs targeting `main` when
the Wizard/Designer plugin, Canvas Design extension, presets, or E2E tests change.
The check is advisory until branch protection
is configured separately; its always-present gate can later be made required
without blocking unrelated PRs on a skipped workflow.

### Data contracts

`contracts/agent-pipeline.mjs`, `agent-artifacts.mjs`, and `agent-phase.mjs`
define the agent's inferred pipeline, artifact evidence, and phase action
inputs. `contracts/agent-replies.mjs` defines the shared originating-run ID
format and rejection semantics for pipeline and artifact replies.
`contracts/wizard-state.mjs` normalizes persisted state, including
older records; `contracts/specify-inventory.mjs` normalizes raw CLI responses.
Action handlers, state persistence, prompt dispatch, and subprocess execution
remain at their existing boundaries. Designer handoff validation lives in the
sibling provider's `contracts/wizard-handoff.mjs`; the Wizard builds that same
versioned shape without importing the separately packaged provider at runtime.

## Quickstart

> This is a **canvas extension** — it opens in the **GitHub Copilot app**
> side panel, not the terminal CLI. There is no slash command or menu
> entry.

1. Register the marketplace and install it (see [Install](#install)):

```bash
copilot plugin marketplace add https://github.com/nicolehaugen/spec-kit-copilot.git#staging-canvas
copilot plugin install spec-kit-copilot-wizard@spec-kit-staging
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

Phase cards list the Markdown files and folders their commands produce,
including multiple outputs when the installed skill identifies them. Outputs
with the same named root and filename remain distinct when their root paths
differ. The default output opens in the artifact viewer when the file exists;
folders and not-yet-created files offer a link to an existing parent folder
instead.
Inferred paths use one location form at a time: a repository-relative path,
`relativeTo: "feature"` for the active feature directory (including
`FEATURE_DIR`), or `root: {name, path?}` for a different named output
directory. Combining `root` and `relativeTo` is invalid.
Inference submissions fetch `/api/state` from the same Wizard instance and
copy each current request fingerprint into the POST programmatically. They
check the requested command IDs before posting; a stale request still fails
the server's fingerprint validation rather than saving outdated evidence.
Opening an expected output in the viewer before it exists shows an
"Output not ready or not found" message rather than a raw 404.
The **Composition** button reads **Refresh** when idle, whether or not the latest
data is up to date; its progress and retry messages describe composition refresh
only. Opening the Phases tab and changing installed packages do not start output
inference. After a phase Run click, the Wizard checks missing or stale outputs
for the current user-visible pipeline and dispatches inference in the background
while the phase runs. The Output(s) row shows "Retrieving outputs…" while those
details are pending. If Canvas Designer is launched before a phase has been run,
the launch starts the same pipeline-scoped inference, waits for it to finish
(the button reads "Launching…"), and then opens the Designer session.
Fingerprint-matched cached outputs are reused. Output inference uses up to
three concurrent background workers; refreshes, pipeline edits, and package
removal do not cancel useful work or delete cached results. Removing a command,
preset, or extension leaves its cache available if it is later restored.
Before dispatch, the host reads requested effective `SKILL.md` files
concurrently and includes them in one prompt, up to 512 KiB total. The agent
uses those supplied contents and only reads referenced path helpers when needed.
Built-in commands use canonical Markdown outputs without inference only when
their skill and helper hashes match the Specify integration manifests.
Preset/extension command contributions (including wrap/prepend/append), or
installed skill metadata identifying a non-core provider, retain inference.
Without confirmed core provenance, the host also retains inference. Explicit
artifact declarations and manual metadata keep their existing precedence.
The host uses `session.rpc.tasks.startAgent` and `tasks.cancel`, inheriting
the session's model and permissions. Unsupported runtimes fail visibly rather
than silently falling back to the foreground queue. Each worker has its own
reply run ID, validates only its assigned commands, and merges cache writes
serially so concurrent results are retained. Stale replies remain rejected by
run ID and fingerprint.
This is nonvisual host scheduling; the existing stock Phases status renderer
and snapshot contract are reused, with no new customizable UI template.
An unreadable output cache marks the relevant inference incomplete immediately,
rather than leaving it pending until its fallback timeout. Output inference is
independent of composition refresh ownership; the composition refresh indicator
does not reflect output inference. Agent replies carry their originating run ID:
`showInferredPipeline({runId, inferredPipeline})` copies the refresh prompt's
ID; artifact POSTs use the worker-specific endpoint, including its `runId`
query parameter. Never replace an old ID using a newer state snapshot.
Missing/malformed IDs are rejected (HTTP 400); stale, completed, or expired IDs
are rejected (HTTP 409). Pipeline actions return `ok: false` with
`inferredPipelineStatus.accepted: false` and the concrete rejection reason.
Rejection happens before pipeline application or artifact source/cache reads.
Both state and evidence writers use `canvas-runtime/owned-commit.mjs` for
owned writes: preparation remains asynchronous, but the final owner check,
atomic rename, and in-memory publication run in one non-yielding section.
Only that final rename is synchronous; refresh/inference replacement cannot
interleave while the swap is pending, and no lock is held across scanning or
agent work. Unowned writes retain their existing asynchronous rename.
Pipeline replies and the fast assembler stage composition/state until this
commit succeeds, rather than publishing it before persistence. Pipeline and
output completion are part of commit publication, preventing duplicates
during the later scan. A superseded postcommit snapshot cannot update the
instance or emit a stale state frame. Commit failures propagate explicitly;
rejected/failed writes clean up their prepared temporary files.
These are nonpersistent correlation IDs, not authentication credentials.
Old uncorrelated callers must use a newly issued prompt/endpoint; there is no
legacy fallback. Delayed replies cannot fail or complete replacement work.
Cache/state formats and retry availability are unchanged.
Effective skill and script sources, as well as the artifact evidence cache, are
read through a single file handle with path/identity checks and a 512 KiB cap,
so changing a workspace file during a refresh cannot bypass the read limit.
The skill's output declaration is parsed from the same bytes used to fingerprint
it, so a concurrent skill edit cannot mix two versions in one snapshot.
Cache updates use an exclusive temporary file in a revalidated directory and
atomically replace the destination rather than writing through a cache symlink.
The extension-artifact scanner uses the same secure cache reader when
hydrating outputs. It leaves entries on disk when their command is unavailable,
but does not hydrate them until that command is available again.

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
Treat the wizard as a launcher: avoid rerunning the same phase until the
active chat turn for that run has finished.

Commands are restricted to the `speckit-*` skills of the customized
lifecycle, and feature slugs are normalized to `[a-z0-9-]`, so the
canvas can only trigger phases that belong to your composed pipeline.

## Direct package operations

Preset, extension, and bundle install/remove buttons run Specify directly in the
Wizard provider, rather than queueing an install skill behind the Copilot agent.
Setup's default-preset install, `addPreset`/`addExtension`, and Composition
removal actions use the same service. Initialization, phases, package updates,
and priority-editing actions retain their existing behavior.

The shared contract is `contracts/catalog-operation.mjs`. For these mutations,
`POST /api/prompt` now waits for verified completion and returns HTTP 200 with
`{ok, id, kind, outcome, skillsReloaded, timings}`; `outcome` is `changed` or
`already-satisfied`. It no longer returns the old HTTP 202 `{queued:true}` install
acknowledgement. Other prompt kinds still do. The browser validates the result
against the requested kind; a queued acknowledgement is not package success.
Remove requests identify the actual installed manifest ID, not its display name.
Failures include `error`, `stage`, and `changed` (files may already have changed).
Catalog broadcasts continue to reflect verified inventories even if subsequent
skill reload or composition fails; the provider does not claim rollback.

Install selections must come from provider-fetched catalogs, not advisory
agent-pushed catalog data. Community confirmation is bound to the exact selected
URL or inline manifest. URLs require HTTPS; no catalog trust policy is changed.
ID-only actions require an unambiguous trusted selection. Existing installations
are not forcibly replaced: version, enabled state, requested priority and source
must be verifiable, otherwise the operation reports a conflict. Bundle receipts
do not establish their original source, so an already-installed bundle is not
silently treated as matching another install request.

Specify owns bundle resolution, ordering, and ownership-aware removal. Archive
and manifest staging uses unique, narrowly cleaned temporary directories.
Subprocesses retain augmented PATH, argument-array invocation, a two-minute
timeout and 2 MiB output limit. Concurrent mutations of the same checkout return
an actionable busy error instead of entering a queue. Only the affected catalog
controls show pending state; unrelated phase Run/retry remains available.

Fresh JSON inventories are read in parallel before and after each mutation.
Effective preset/extension changes trigger one bounded SDK skill reload and one
composition rebuild. Package changes do not start output inference; it runs
only on a phase Run click or as the Canvas Designer launch fallback.
Pipeline-order inference still requires the existing Refresh flow when the fast
assembler cannot determine it. Setup skips its extra reload only after the
package result confirms a successful reload.

`timings` reports available inventory, command, source-staging, reload,
composition and total host durations in milliseconds. Browser journeys exercise
real Specify installs and removals in disposable checkouts while `session.send`
remains unresolved. Preset/extension acquisition is mapped to local fixtures;
the bundle journey uses a CLI-bundled extension and checks that removal retains
an independently installed preset. These are local-source measurements, not
hosted-download benchmarks or a matched agent-path speedup comparison.

One local Windows fixture run recorded these host durations in seconds:

| Operation | Inventory before / after | Specify mutation | Composition | Total |
| --- | --- | --- | --- | --- |
| Preset install | 0.86 / 2.76 | 1.03 | 0.58 | 5.23 |
| Extension install | 1.46 / 0.77 | 1.00 | 0.15 | 3.37 |
| Preset removal | 0.82 / 2.89 | 0.98 | 0.53 | 5.22 |

SDK reload was mocked and took under 2 ms; a live reload can cost more. The
retained legacy dispatcher acknowledged enqueueing in about 2 ms without running
any install: that is not an end-to-end baseline. The measured improvement is
independence from agent availability, not a defensible percentage speedup.

Existing stock catalog buttons, community modal, and error styling are reused;
the new error message is fixed-shell UI. No customizable control or cross-host
renderer is added, so no definition/adapter template pair is needed. This
development change does not publish packages, change versions, or refresh an
installed provider.

## Agent-callable actions

You can drive the wizard with natural-language prompts at any point —
the agent maps what you ask into canvas actions and the UI updates
accordingly. The extension registers **13 actions** across four groups:

**Verbs (agent-initiated work):**
- `runPhase` — dispatch a phase's `/speckit-<phase>` slash command with the
  wizard tracking preamble (same code path as the Run phase button).
- `addPreset` — install a preset by id (same code path as the Install button).
- `addExtension` — install a Spec Kit extension by id (same code path as
  the Install button).
- `addPipelinePhases` — add ordered command phases to the Phases pipeline
  without removing or reordering existing steps. Given a README link, the
  agent reads its workflow and supplies installed command IDs with optional
  `after` anchors; automatic hook commands are not addable.
- `reloadSessionSkills` — reload Copilot's in-memory skill registry for
  the session (equivalent to `/skills reload`).
- `runNpmDiagnostics` — dispatch a scripted npm-diagnostic prompt to the
  parent session so the Copilot agent walks a checklist (inspect
  `~/.npmrc`, ask about the org's approved feed / CA / proxy, propose a
  minimal config change, retry the install, then use the Wizard's Retry
  control to clear the error). Wired to the "Diagnose and fix with the agent" button on
  the boot overlay's deps-error card. See [First-open boot](#first-open-boot).

**UI navigation (push state to a tab):**
- `showPresetCatalog` — push the preset catalog to the Catalogs tab.
- `showExtensionCatalog` — push the extension catalog to the Catalogs tab.
- `showBundleCatalog` — push the bundle catalog to the Catalogs tab.
- `showEnvReport` — push environment status (CLI version, probes,
  scaffolded skills) to the Setup → Environment sub-panel.

**LLM-driven inference:**
- `showInferredPipeline` — target of the `composition.inferPipeline`
  prompt; the agent copies its originating `runId` alongside an inferred
  `{ shape, pipeline, unplaced, rationale }` ordering derived from
  `state.composition.artifacts` + fetched READMEs. Missing or stale IDs are
  rejected before applying. Partial-merge preserves the assembler-owned slice.

**Phase-tracking callbacks (agent → wizard after `runPhase`):**
- `setPhaseStatus` — update the status (and optional artifact path) of
  a phase after the scaffolded skill finishes.
- `reportExecution` — report which of the phase's expected templates /
  scripts / hooks the agent actually invoked, per the tracking
  preamble's closed list. Called once after `setPhaseStatus(status:'done')`.

## Canvas Designer setup dialog: local development sources

The Canvas Designer launch dialog (Design tab → Open Designer) lets you
choose hosted presets, extensions, and bundles before launching the child
session that installs them. Hosted catalogs remain the primary, default way
to pick what gets installed.
The new Designer child starts in interactive mode. When the vertical phase
control is installed, its managed Autopilot action switches modes for the run
and restores the previous mode afterward.

There is one collapsed **Local development** `<details>` section, rendered
as a sibling of the Presets/Extensions/Bundles tabpanels rather than inside
any single tab, so it stays visible no matter which tab is active. It is
purely additive — it does not change any existing copy, hosted catalog
list, community warnings, bundle behavior, or keyboard/focus handling. Use
it to point the dialog at one or more local checkouts instead of (or in
addition to) the hosted registry entry:

- Type an absolute directory path and click **Add**. There is no folder
  picker (browse) in this MVP — only a real host file-picker API would be
  wired up, and none exists in this environment, so this stays typed-path
  only rather than faking a browse button.
- There is a single path input, not one per kind. The directory's kind
  (preset vs. extension) is auto-detected server-side from whichever
  manifest is present — a readable, parseable `preset.yml` or
  `extension.yml` with a valid `id`, a non-empty `name`, and an optional
  `version` — so you never pick a subgroup to add it to. Invalid paths,
  missing manifests, and unparseable YAML are all rejected with an
  explicit inline error instead of silently failing.
- You may add multiple unrelated local directories, of either detected
  kind; each appears in the same shared list and can be independently
  checked or removed. Local bundles are not supported — bundles stay
  hosted-catalog-only, and a directory whose manifest doesn't resolve to a
  preset or extension kind is rejected.
- Checking a local entry opts it into the launch handoff. If its `id`
  collides with a hosted selection — including a hosted bundle's member —
  the local entry always wins. Child installation uses
  `specify preset add --dev <path>` (falling back to
  `specify preset remove <id>` + retry on an existing same-ID install) for
  presets, and `specify extension add <path> --dev --force` for
  extensions, so the local checkout always replaces whatever would
  otherwise have been installed from the hosted catalog for that ID. A
  local `extension-canvas-design` checkout replaces only the official CLI
  package install for that step; the official Canvas Designer *canvas
  provider* that ships with this plugin remains unaffected.
- The Designer child installs the required Canvas Design base first, then
  all installed runtime bundles and selected bundles; it verifies and, if
  necessary, restores the required hosted or approved local base before
  remaining standalone extensions and presets. The handoff freezes the
  Wizard's complete installed inventory (including disabled packages and
  priorities), plus verified install locators. Catalog IDs and installed
  manifest IDs are distinct: a catalog entry named `pirate`, for example,
  can install a manifest named `pirate-full-preset`. Catalog-installed
  presets/extensions must also match the CLI's reported catalog source;
  locally installed ones are reproduced from their installed copies in
  the Wizard checkout, not from an ID/version-matched catalog entry. Bundle
  membership does not prove a component's installed source; each runtime
  preset/extension is replayed from its own locator even if a bundle lists
  the same ID, except when an approved local selection replaces it. A
  same-ID local override can have a different version: its installed
  version and local source replace the frozen runtime version and source
  in the child, while the approved local path is frozen as its install
  locator. The original runtime inventory is still checked before dispatch.
  Since the CLI bundle inventory does not report provenance,
  installed bundles use a matching catalog ID/name and version; an explicitly
  selected bundle disambiguates matching catalog sources. A missing or
  ambiguous match blocks launch rather than guessing a source.
  Missing or ambiguous sources and sources that change before dispatch
  block launch instead of guessing. Child package version drift is reported
  as a warning, while mismatched package identity or source still blocks
  launch. The child-side `server/designer-setup.mjs` runner passes approved
  URLs and local paths as separate subprocess arguments, not interpolated
  shell commands; the required base is restored after bundles.
  It installs remaining standalone extensions (including local
  overrides), then
  standalone presets (including local overrides). For an approved local
  Canvas Design base, it first replaces only its generated, dev-linked
  skill files with local copies so Specify can regenerate composed skills
  without writing through links into the source checkout.
  This ensures bundled and standalone preset command additions have the base
  available. It stops on composition warnings even if Specify exits
  successfully. Specify's artifact inventory must resolve the composed
  load-page command, and the installed Canvas Design verifier resolves its
  registered template names through Specify before opening Designer. This
  setup records the resolved manifest ID, version, and CLI source for each
  selected standalone preset or extension in a bounded, handoff-bound file
  beside the child session's `handoff.json`. Finalize requires that record
  and rechecks the same installed packages; a missing or changed record
  blocks launch. When a bundle has already installed a selected catalog
  alias, the runner resolves its actual manifest ID before replacing it,
  or stops if that identity is ambiguous. This ordering applies only to
  Designer launch, not the Wizard's Catalogs install actions or a generated
  canvas opened independently as a standard plugin.
- Before installing, the child-side runner prepares the session-root handoff:
  it accepts
  the exact launch-hashed bytes or strips one trailing LF/CRLF only when the
  remaining bytes match the launch hash. Other changes fail without rewriting
  the file. Its subsequent read-only preflight checks the
  session-root handoff bytes against the hash in the launch prompt, as well as
  Specify CLI version, project setup, and approved local paths and manifest
  IDs. Wizard source stages the exact UTF-8 JSON in its session artifacts,
  without a trailing newline or BOM. The child bootstrap transfers those bytes
  by a bounded source-session reference and checks the launch hash before any
  installation. It never writes into `files/` or derives its destination from
  model-authored paths. This exact-byte
  check applies at preflight only; later `verify-local` calls validate the
  handoff but do not compare its bytes to that launch hash.
  After local installation and later overrides, the child checks the installed
  manifest ID and Specify's local inventory entry (ID and local source kind);
  it does not pin a local development version.
  Local development sources remain mutable; their file contents are not
  compared with a preflight snapshot. The hosted Canvas Design version and
  download URL are frozen from the approved catalog at launch. The child warns
  if the installed version differs but still verifies the installed ID,
  inventory source kind, manifest/inventory agreement, and Designer schema
  contract. Specify reports a package installed from an approved `--from`
  download URL as `source.kind: "local"`; this does not mean it was installed
  as a local development override. The CLI inventory does not preserve the
  download URL, so the child uses the frozen URL for installation and restores
  it after bundles before verifying the base again.
  For hosted Canvas Design, `verify-base` also requires the installed Workflow,
  phase-placement, phase-control, and phase-adapter template registrations and
  files; a compatible schema contract alone is insufficient. If they are
  missing, launch stops before Designer opens and directs the user to an
  approved local-source override instead of treating the hosted package as ready.
  An approved local source may have a different version but must declare a
  compatible Designer tab schema version.
  **Release readiness:** the earlier published `0.1.19` archive lacks
  `generated-phase-control` and `generated-phase-adapter`; its hosted launch
  stops at `verify-base`. The staging catalog selects `0.1.21`; verify the
  actual published archive after installation from that catalog.
  Passing `verify-base` establishes base compatibility, not an entire hosted
  Designer journey.
- The parent agent creates the same app-native default-branch worktree with a
  compact launch reference, not inline handoff JSON. In that child, the LLM
  explicitly calls `speckit_designer_bootstrap` twice: first with
  `{schemaVersion:1,stage:"install",launchRef}`, then, after `installed`, with
  `{schemaVersion:1,stage:"finalize-open",launchRef}`. The source-owned
  `contracts/bootstrap.mjs` defines the nonvisual tool boundary; it requires no
  customizable UI definition/renderer pair. No setup runs at registration or
  session creation. The first call transfers the handoff and invokes
  `installDesignerSetup()` for real Specify initialization, installation, and
  verification. Missing/outdated Specify sends the LLM to the existing
  setup/upgrade skill. The second call reloads skills once for that install,
  invokes `finalizeDesignerSetup()` for real Specify inventory/composition
  checks, and passes its complete `openInput` directly through the installed
  SDK's native `session.rpc.tools.execute({name:"open_canvas",arguments})`.
  Only `openInput` goes to Designer, not sibling `timings` or `warnings`.
  The tool returns compact `installed`, `shell-opened`, or explicit `failure`
  status with warning count, stage timings, and a diagnostics path. Full install,
  reload, finalize, and native results remain in handoff-adjacent `bootstrap.json`
  (bounded to 16 MiB, including maximum-sized Unicode inventories). Native tool
  display text can be truncated; the complete `canvas.listOpen()` snapshot is
  authoritative for provider/canvas/instance/input verification. The model never
  needs to regenerate their payloads.
  Installation and resolution never run in the Wizard checkout. The handoff
  schema, `202 { queued: true }` launch response, and official canvas open input
  remain unchanged. Native tool invocation, canvas snapshots, session metadata,
  and skill reload are required; unsupported runtimes fail visibly, without a
  CLI-created session or an LLM-authored opening fallback.
- Canvas Design must supply a read-only verifier over the **generated,
  composed** load-page skill and Specify's per-name resolution/stack metadata.
  It produces the complete pages/templates input only when all registrations
  check out. Packages lacking `scripts/verify-launch.mjs` fail this launch path;
  legacy manual resolution is not supported. The bootstrap checks native
  provider/canvas/instance identity and the entire returned input. Explicit
  native denial/failure is retryable without a second successful skill reload.
  An interrupted or timed-out open is reconciled against the stable native
  instance; an unknown outcome never triggers an automatic second open.
  Shell availability alone does not assert all pages loaded or generation
  readiness. Worktree/local-source verification is separate from verifying the
  published archive selected by the hosted catalog; routine development does
  not bump versions or publish releases.
- Local selections reset when the dialog is closed after a **successful**
  launch (matching the existing reset behavior for hosted selections), but
  are retained if the launch fails, so you can fix the problem and retry
  without re-adding your local paths.

## Install

**Via marketplace (recommended):**

```bash
copilot plugin marketplace add https://github.com/nicolehaugen/spec-kit-copilot.git#staging-canvas
copilot plugin install spec-kit-copilot-wizard@spec-kit-staging
```

The plugin manifest lives at `plugins/spec-kit-copilot-wizard/plugin.json`
and declares this directory through its `extensions/` component path.
For the fork's staging release, add the marketplace from
`https://github.com/nicolehaugen/spec-kit-copilot.git#staging-canvas`;
the default-branch marketplace is separate.

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
- Node.js 22 or newer (bundled with the Copilot App). Wizard setup installs
  `js-yaml` for YAML manifests and `es-module-lexer` for the sibling
  Designer's generated-renderer validation when either is missing.

<a id="first-open-boot"></a>

### First-open boot

Startup and restored opens wait for the SDK session join before resolving the
workspace or starting the local server and boot work. A failed join rejects the
open rather than starting with a partial session. This protects canvas restoration;
it does not prevent Copilot's deliberate session restart after repository-configuration
approval.

On first open of a fresh worktree, the wizard shows a live boot overlay
while the backend runs its startup checklist: **workspace → deps-check
→ deps-install → env-probe → catalog → ready**. The HTTP server is
started *first*, before any long-running work, so the canvas iframe
loads within ~1 second and each step animates in place with an elapsed
timer. The `deps-install` row streams npm's live output as the last
line under the row title, so users see progress instead of a blank
"installing…" spinner.

If `npm ci --omit=dev` fails (e.g. a corporate TLS-inspecting proxy blocks
`registry.npmjs.org`), the deps-install row is replaced in-place with
an error card classifying the failure and offering two buttons:

- **Diagnose and fix with the agent** — dispatches a scripted prompt
  to the Copilot agent (via the `runNpmDiagnostics` canvas action).
  The agent inspects `~/.npmrc`, asks about the user's approved
  internal feed / CA / proxy, proposes a minimal config change, and
  retries the install. Once it succeeds, click **Retry install** on the
  Wizard's error card to recheck dependencies and clear the error.
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

## Troubleshooting

**A phase status, pipeline command, or composition change looks wrong after
overlapping wizard actions.**

Concurrent updates can occasionally overwrite newer fields in
`.speckit-wizard/state.json`. This state-write limitation predates
`addPipelinePhases`; the new action is another possible participant. It
affects the wizard's saved progress and pipeline, **not the generated spec,
plan, or other artifact files**. Refresh the canvas and check the artifacts
before rerunning a phase. If the state still looks wrong, ask the agent to
reconcile it against the files on disk and the pipeline you intended; the
wizard cannot detect or undo the overwritten update automatically.

**First open shows a dependency-install error like
`ERR_SSL_SSL/TLS_ALERT_HANDSHAKE_FAILURE`, `ECONNREFUSED`, `ETIMEDOUT`,
or `403 Forbidden` against `registry.npmjs.org`.**

The first time the canvas opens in a fresh clone or worktree it installs
each missing runtime dependency from its extension's lockfile with
`npm ci --omit=dev`. The Wizard's Playwright dev dependency is not installed.
If your machine can't
reach the public npm registry — typically due to a corporate proxy,
egress firewall, or TLS-inspecting appliance — that install fails and
the Wizard shows its recovery card; you can continue with reduced functionality.
This is an npm reachability problem on the host, not a wizard bug.
`package-lock.json` doesn't help here: it only
pins versions, npm still has to fetch packages from a registry.

Pick whichever applies:

1. **Configure npm to use a registry you *can* reach.** If your org
   provides an approved npm mirror (Azure Artifacts, JFrog Artifactory,
   Nexus, Verdaccio, GitHub Packages, etc.), point npm at it:
   ```
   npm config set registry https://<your-approved-mirror>/npm/registry/
   ```
   Verify the approved mirror serves both `js-yaml` and
   `es-module-lexer`, then close and reopen the wizard canvas.
2. **Trust your corporate root CA.** If your network intercepts TLS,
   npm needs the corporate CA:
   ```
   npm config set cafile "/path/to/corp-root-ca.pem"
   ```
   Your IT/security team can point you at the cert.
3. **Install the missing dependency manually, once**, then reopen the canvas.
   Run this in the folder shown in the Wizard's error card (Wizard for
   `js-yaml`, Designer for `es-module-lexer`):
   ```
   cd <path-to>/spec-kit-copilot-wizard/extensions/<affected-canvas>
   npm ci --omit=dev
   ```
   After this succeeds the wizard skips the auto-install on every
   subsequent open in the same folder.

If `js-yaml` remains unavailable, the Wizard's **Catalogs** and
**Composition** pages cannot parse YAML. If `es-module-lexer` remains
unavailable, Designer reports the missing dependency on open. Manual
installation in the affected extension folder doesn't require org-wide
npm reconfiguration.

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
| `catalog/` | Catalog hydration for the Setup → Catalogs page: `sources.mjs` (runtime-configured catalog URL table + `fetchCatalogJson`), `presets.mjs`, `extensions.mjs`, `bundles.mjs`, `shared.mjs`. |
| `env/` | Environment probe + PATH resolution: `probe.mjs`, `probe-cache.mjs`, `resolve-path.mjs` (locates `copilot`/`specify` binaries when the SDK dir isn't on `PATH`), `deps-check.mjs`, `workspace.mjs`. |
| `state/` | `.speckit-wizard/state.json` read / write / normalize: `store.mjs`, `normalize.mjs`, `execution-reports.mjs`. |
| `ui/` | Dashboard UI served to the canvas iframe: `index.html`, `app.js`, `client.js`, plus per-page modules (`setup.js`, `catalog.js`, `composition.js`, `composition-artifacts.js`, `phase-card.js`, `phase-contributors.js`, `phase-runtime.js`, `state.js`, `modals.js`). |
| `test/` | 5 consolidated `node --test` files (`composition`, `catalog`, `env`, `state-and-scanner`, `server-integration`) — zero SDK, zero network, zero real subprocess spawns. |
| `copilot-extension.json` | Manifest for gist share/install. |
| `package.json`, `package-lock.json` | `js-yaml` runtime dependency; Wizard setup also checks the sibling Designer's lockfile. |
