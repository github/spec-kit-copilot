# __DISPLAY_NAME__

__DESCRIPTION__

This project-scoped canvas was generated from a Spec Kit Wizard pipeline. Its runtime and renderer are a deterministic, self-contained copy of the Wizard workflow template. Copilot customizes only declarative data in `workflow-config.json`; all executable files, including `workflow-adapter.mjs`, are protected template code.

## Automatic setup

On open, the generated canvas reads the portable setup contract in `pipeline.json`.
If Spec Kit or dynamically selected skills are missing, the canvas automatically sends
a setup prompt to the coding agent. A canvas with recorded presets or extensions also
sends that prompt when their directories already exist so the agent can reconcile their
enabled states and numeric priorities instead of treating directory presence as sufficient.
Readiness requires independently observed contribution state and recorded relative precedence,
not an agent acknowledgement. A mismatch or unreadable state reports expected versus observed
details and invalidates cached readiness.
Presets and extensions are reconciled in the Wizard-recorded precedence order.
The agent performs setup mutations through the Spec Kit skills and CLI. The extension
runtime only reads local setup files and runs read-only `specify preset list` /
`specify extension list` queries. Those queries are coalesced and cached for up to
30 seconds, invalidated by setup evidence changes, and forcibly refreshed during
`reloadSessionSkills`. The runtime does not write setup files or install contributions.

By default the canvas creator's selection in the Wizard permits automatic setup.
With installation approval disabled, the app automatically installs missing
included presets/extensions without asking for its own installation approval.
Normal host/platform tool permissions still apply; this UI setting never bypasses
those checks.
When immutable `setup.requireInstallationApproval` is true, the canvas first
verifies which required contributions are installed in this project using
registry/manifests and read-only CLI inventory. If they are all installed, even
through a separate CLI invocation, no approval or reinstall is requested.
Only when one or more are missing does an inline installation review list exactly
this canvas's captured presets and extensions before setup, skill reload, or
phase dispatch. **Approve and install** approves the complete contract;
**Not now** leaves browsing and drafting available without installing or queuing a run.
**Review installation** restores the list. A run attempted before approval reveals
the review rather than queuing it. An empty component list bypasses this gate.
The section uses separated rows, type badges, and expandable **View source**
details for recorded HTTPS sources. Community badges require recorded community
provenance. No priority, precedence, enabled, or installed-state labels are displayed.
Missing source details stay explicit, with no invented links or
sample descriptions. The section retains the canvas theme and stacks actions
on narrow screens.

Approval is stored separately from readiness in
`.speckit-wizard/canvas-approvals/<extension-id>.json`, scoped to the actual canvas
identity, canonical workspace, and complete setup fingerprint. Changed setup contracts
require fresh approval only when an installation is needed; cosmetic headings and
phase input guidance do not. Missing approval is pending only for missing
components; malformed, unsafe, or unwritable metadata reports an error when
consent is needed. Ambiguous installation evidence is a verification error, not
a request to reinstall.
Only the renderer's HTTP installation-review endpoint records acceptance; ordinary
setup/run actions and caller-supplied flags cannot approve installation.

After approval the panel shows actual setup verification or a failure with **Retry
setup**, disappearing once all required components are verified as installed.
External installations are detected on refresh; no acceptance record is written
for already-installed components. Phase execution still requires actual
configuration/skill readiness and session reload. Installed components are
retained without reinstalling, even when their settings need reconciliation.
Setup uses only captured IDs and sources, preserves unrelated destination contributions,
and honors platform and tool permission requirements. This local consent record is
not sandbox enforcement, a package-safety guarantee, or immutable remote-content verification.

Once setup evidence matches, the generated canvas reloads the current Copilot session through
its `reloadSessionSkills` action, backed by `session.rpc.skills.reload()`. Failed or
interrupted setup exposes a retry action; default first-run setup requires no user click.

Caught runtime exceptions are reported through fixed, operation-specific messages in
HTTP responses and canvas state, rather than exposing exception text or stack traces.
Unavailable or oversized artifacts retain HTTP status 413; other failed requests return 400.

## Project Constitution (when selected)

Template version 10 supports optional `projectArtifacts.constitution`, referencing
the exact selected `speckit.constitution` instance key with `required: true`.
The complete source command remains in `pipeline.steps`, setup's required skills,
and `workflow-config.json` phase input keys. The shared protected
`ui/command-views.mjs` derives the numbered workflow without that record.
Constitution does not belong to any workflow item or affect its slug/root.
An effective override retains its captured project Markdown path and skill.
Duplicate Constitution commands, missing/transient/slug-scoped outputs and
unsafe paths are rejected at generation rather than guessed.

One compact **Constitution** card sits above the workflow collection. **View**
opens the existing Markdown viewer; **Create / update** opens **Run Constitution**
with **Guidance**, **Cancel**, and **Run**. The standard skill's native placeholder
is “Optional: principles to emphasize (e.g. testing, performance, UX)”; an effective
override can change the content-only guidance. The textarea starts empty: its
placeholder is never submitted. No slug, item picker or feature path is added.
The exact captured skill runs through the normal session; chat owns execution and
questions. The canvas never writes or replaces Constitution content itself.
Viewing, going Back, and updating preserve the selected workflow, phase and draft.
There is no second Constitution section beneath the pipeline.

Installation approval and setup/session-skill readiness come first. Then every
non-Constitution run—including HTTP, agent actions, queued setup-era requests and
reruns—rechecks the Constitution. Missing or empty content is **Not created**;
unresolved uppercase `[PLACEHOLDER]` tokens mean **Template**; otherwise nonempty
content is **Ready**. Reads are bounded to 512 KiB and must match the declared
regular project artifact, with no symlinks/junctions. Unreadable, unsafe or oversized
content is an explicit blocking error, not “missing” or “ready.”
Ready is only a completion heuristic, not proof of policy quality, formal
ratification or human approval.

Until ready, phase Run is unavailable with an accessible explanation in the top
card; browsing, phase selection and input drafting remain available. Server
rejection returns `constitution_required` without dispatch or silent requeueing.
Constitution itself remains runnable after setup, never creates/binds a workflow
or reserves a slug, and never runs automatically. Status is observed again on
refresh and by every panel's existing one-second polling/SSE cycle. Command
completion or time passing cannot mark it ready. Updating does not rerun or mark
items stale; removing content or restoring placeholders gates subsequent runs.

A Constitution-only selection shows the card alone, without a dummy item or empty
pipeline. When the descriptor is absent, there is no Constitution surface, read,
or gate—even if an existing Constitution file is present. Legacy snapshots are
not retrofitted implicitly.

## Files

- `pipeline.json` — immutable generated workflow definition.
- `workflow-config.json` — validated workflow labels, fixed phase arguments, and input guidance inferred from effective installed skills.
- `workflow-adapter.mjs` — protected interpretation of that configuration; never generated executable logic.
- `setup-runtime.mjs` — deterministic read-only readiness checks and agent setup prompt.
- `approval-runtime.mjs` — protected, bounded local approval storage and contract checks.
- `project-artifacts.mjs` — protected Constitution observation and execution gate.
- `ui/command-views.mjs` — shared full/project/workflow command views and descriptor validation.
- `workspace-files.mjs` — blueprint-scoped artifact/folder authorization and operating-system reveal behavior.
- `extension.mjs` — standard secure canvas runtime.
- `ui/` — standard Wizard workflow renderer.

Configuration has four fields: `version: 1`, `itemLabels` (workflow ID to
display label), `phaseArguments` (blueprint phase instance key to optional
single-line `prefix` and `suffix` strings), and `phaseInputs` (every blueprint phase
instance key to `label`, `helper`, and boolean `optional`). Input labels are at most
80 characters; helpers are at most 240 characters. Both are plain single-line text
describing useful content, never slug, identifier, command, or location instructions.
Legacy configs without `phaseInputs` use neutral guidance; a supplied map must cover
every phase. Empty labels/fixed-arguments maps use standard behavior.
The runtime always retains user input, chooses the command from the blueprint, and
inserts the workflow slug once. Configuration cannot change item identities, discovery,
phase order, artifact locations, setup, or the New sentinel. Unsupported
fields or requirements fail explicitly rather than silently falling back.

The Wizard automatically enables immutable `runtime.multiInstance` for pipelines
with a shared slug-scoped artifact root, without a generation-popup toggle.
These canvases enumerate slug directories as a collection while retaining a
selected-instance phase view and a New action. Project-only pipelines
retain a single project view. Legacy single-instance blueprints still bind one
slug once and reuse it without exposing sibling directories.

The collection heading uses `metadata.workflowListName` from `pipeline.json`
(default **Workflows** for older blueprints). It preserves the admin's name without
singular/plural conversion. New, Current selection, Search, empty states, and
deletion confirmations use neutral wording or the selected item's actual name.
New remains available when the collection is empty. This display-only setting
does not rename items, slugs, folders, commands, phases, or their input guidance.
When custom slugs are enabled, the renderer shows the field only on the first configured
phase whose artifact path uses `<slug>`. The slug becomes read-only after that phase
starts, applies to every later phase, and must be unique within the generated canvas
extension and workspace.
When user-provided slugs are disabled, no slug field or `slug=` argument is added:
Spec Kit chooses a default, or Copilot may ask the user in the chat session.
The optional slug field appears below Phase input with the same label, spacing, and
control styling, without a separate shaded container. It remains a single-line input
and becomes read-only once the workflow starts. Each phase shows concise input
guidance inside an empty textarea as placeholder text, derived during generation from the effective
installed skill (including preset overrides), not copied from raw argument hints.
The placeholder disappears when typing and returns when cleared; it is never a
prefilled value or submitted as phase input. The field label remains visible, and
the same guidance remains available as a screen-reader description.
Only skills that explicitly support no additional textbox input receive an optional
label. Conditional requirements get content-only advice; unknown requirements use
neutral Phase input guidance, without claiming the input is optional or required.
There is no empty-input validation or general phase-order gating. Users can select
any phase directly and run it once required installation approval, setup, and the
optional project Constitution prerequisite are complete.
The Writes to control resolves `<slug>` to the active workflow, opens the containing
workspace folder, and uses an existing artifact path when available. Artifact files are
rendered as safe Markdown with headings, lists, links, emphasis, tables, and code blocks.
Reads must match a declared artifact template; folder reveal is limited to those
artifacts' containing directories. For `<name>.md` templates such as SDD checklists,
the viewer selects the newest matching Markdown file, with path order breaking timestamp
ties. It never searches outside the declared folder.
Multi-workflow canvases show a compact searchable workflow list and a horizontally
scrollable phase pipeline.
Deleting a workflow requires confirmation and permanently removes its directory and
artifacts from the workspace. Deletion is restricted to an exact item directory under
the blueprint's dedicated `<slug>` root, never the workspace, collection parent,
or Spec Kit/Copilot installation directories. All filesystem actions reject traversal
and symbolic links/junctions in the target path, including links to sibling workflows.

The generated app intentionally does not expose pipeline editing or recursive canvas generation.
