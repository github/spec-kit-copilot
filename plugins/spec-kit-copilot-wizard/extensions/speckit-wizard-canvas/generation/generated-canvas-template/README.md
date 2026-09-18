# __DISPLAY_NAME__

__DESCRIPTION__

This project-scoped canvas was generated from a Spec Kit Wizard pipeline. Its runtime and renderer are a deterministic, self-contained copy of the Wizard workflow template. Copilot customizes only declarative data in `workflow-config.json`; all executable files, including `workflow-adapter.mjs`, are protected template code.

Captured files, configuration, and runtime contracts are validated before loading.
Completion reporting only records the result; a Wizard
update or reporting failure does not prevent opening a successfully validated and
loaded canvas. Reporting failures are surfaced separately from generation failures.

## Artifact viewer

Template version 21 always shows **View artifact** on workflow phase cards,
including before a phase runs. Like the Wizard, it opens the in-canvas viewer
using the phase's output path. Missing or unresolved artifacts show guidance in
the viewer; read errors stay inline rather than using browser alerts. Back
preserves the selected phase and draft, and viewing never runs a phase.

Template version 13 snapshots the Wizard's shared `shared-workflow-ui/markdown.mjs` and
`shared-workflow-ui/artifact-viewer.css` into protected `ui/` files. Both viewers load the
viewer stylesheet before `workflow-theme.css`, retaining the Wizard's final cascade,
heading hierarchy, lists, code, tables, quotes, links, clarification pills and header.
The generated back button returns to the workflow; no installed Wizard assets are
needed at runtime.

Template version 16 keeps document content left-aligned across the available
viewer width instead of centering a narrow column. Side padding is 24px on wider
panels and 16px on narrow panels; the Wizard uses the same shared layout.

The shared renderer escapes HTML and strips complete comments with a separating
space. It tokenizes inline code and links before clarification markers, and keeps
fenced code inert; marker-looking text in code, links or comments is not interactive.
Unsafe link schemes resolve to `#`. Generated canvases use **Apply answers** to
amend artifacts, separately from normal phase reruns (see below). The existing
Wizard uses the same focused amendment behavior as of template version 15.

Maintainers can run `node --test test/artifact-viewer-parity.test.mjs` in the Wizard
extension source tree with Playwright available (or `PLAYWRIGHT_MODULE` pointing to
its `index.mjs`; `PLAYWRIGHT_CHANNEL=msedge` uses an existing Edge installation).
The test materializes an isolated fixture, mocks all state/artifact requests, and
compares the actual viewers against the incumbent Git `HEAD` at desktop/mobile
sizes in light/dark themes. `VIEWER_BASELINE_REF` can pin another incumbent commit.
It compares computed styles, hover/focus/disabled states, and exact screenshot bytes
after normalizing only application-specific navigation and queue copy. No phase runs.

## Phase indicators

The collection summary beneath the workflow heading contains the shared parent
folder link and neutral count pills. With result labels configured, it counts
explicit current matches for each configured label separately. **Not determined**
counts explicit uncertain reviews and appears only when greater than zero.
Counts exclude New and are independent of search or selection; they are not
adjusted to add up to the workflow total. Unstarted, unreviewed, and unavailable
workflows are not assigned a result to fill a remainder. **Clarification needed**
counts workflows with one or more unresolved markers in any workflow phase,
not individual questions, and overlaps the result counts.

With result labels, every workflow row reuses the final-phase pill once its final artifact exists.
Otherwise it shows **Run &lt;next phase&gt;**, using the first phase without artifact
evidence (or a current-session submission for a transient phase). Navigating to a
later page does not advance progress. No new execution history, LLM calls or stored
counters are introduced. Automatic snapshot refresh updates the rows and totals.
Without result labels, only clarification pills and counts are displayed.
Rows show clarification when any workflow phase has unresolved questions.
Artifact-readiness and next-phase pills are omitted; errors remain explicit inline text.
The folder link opens only the blueprint's shared collection root, remains enabled
when empty, and reports missing-folder or reveal errors inline.

Phase indicators use fresh, safely bounded artifact reads.
A readable, nonempty artifact with no open clarification markers is green
with a checkmark; remaining markers make the phase amber with an exclamation mark.
Missing artifacts stay neutral. Empty, oversized or unreadable artifacts stay
neutral with an unavailable notice, rather than being mistaken for completion.
The selected-phase outline remains independent of these colors.

The phase card displays a text-only **Clarification needed** pill with one neutral
background and border, also used for other notices. No warning color or icon is
attached to the pill. Existing automatic refresh updates the indicators; submitting
answers alone does not change them. Run, Run again and navigation are unchanged.

The shared viewer detector recognizes bracketed markers such as
`[NEEDS CLARIFICATION: Scope?]`, `[ needs clarification : Scope? ]`,
`[**NEEDS CLARIFICATION:** Scope?]` and `[**NEEDS CLARIFICATION**: Scope?]`,
including italic/underscore label variants. Exact marker text is retained for
amendments. Ordinary mentions, code, links and comments are not open questions.
Green describes artifact presence and absence of detected markers, not correctness.

Maintainers can run `node --test test/generated-phase-status-browser.test.mjs`
with the same Playwright environment as the viewer parity check above. It checks
desktop/mobile and light/dark layouts, partial/final clarification transitions,
selection and input retention, and neutral notices without executing any phase.

## Optional final-artifact status

An optional list of up to five result labels is supplied in the
Generate settings, such as **Implemented / Partially implemented / Not implemented**
or **Go / Hold / Kill**. Labels are preserved exactly and ordered for display, not priority;
generation does not inspect workflow artifacts to choose them.

Runtime review uses format-independent reading guidance. Concepts such as **goal outcome**, **status**,
**verdict**, **decision**, and **result** are illustrative semantic cues, not
required keywords or headings. Copilot considers the whole artifact and locates
the passages that most closely express its current overall outcome, in any
Markdown structure. Actual outcomes take precedence over aspirations, future
plans, examples and intermediate findings; neither the first keyword match nor
the last section is presumed authoritative. Unclear, unsupported, or conflicting
evidence yields **Not determined** rather than forcing a configured result.
The review fingerprint includes this guidance, invalidating cached assessments
when it changes. Empty result settings mean clarification-only pills and no review requests.

When configured, Copilot selects a fixed status ID using only the current final
artifact and configured labels. All workflow instances use the same 1-3 word
labels. The neutral pill displays that label; unresolved clarification markers
always take precedence. Green/amber phase colors retain their artifact-based meaning.
Insufficient evidence yields **Not determined**, not an assumed result.

The existing refresh loop waits for settled content and an idle session, with one
pending review at a time. Its read-only prompt requests a scoped canvas-action
callback; arbitrary labels, stale snapshots and cross-workflow results are rejected.
Only the latest accepted result per workflow is stored under
`.speckit-wizard/artifact-reviews/`, keyed by workspace/canvas/item/phase and
fingerprinted against artifact content and configuration. Review errors surface as **Review unavailable**, with
accessible details. Existing rerun/reopen actions retry failed reviews without
automatic retry loops. These are assessments of document evidence, not independent
verification of code, tests or skill execution.

## Automatic setup

### Reusing the creator's workspace or running standalone

**This app can run standalone in a fresh workspace. You do not need to open or run
the Spec Kit Wizard to prepare that workspace.** The generated app drives its own
setup using the requirements captured in `pipeline.json`.

- **Same workspace used by the Wizard:** matching `.specify/` scaffolding,
  installed presets/extensions, and `.github/skills/` files already exist and are
  reused. Generating or opening this app does not copy or reinstall them.
- **Fresh workspace with this standalone app:** on open, the app detects missing
  setup and asks Copilot to use the Spec Kit setup skills to initialize the project
  with `specify init` in Copilot skills mode and install/configure the captured
  presets and extensions. Spec Kit scaffolds this workspace's `.specify/` and
  applicable `.github/skills/` files, then the app reloads the session's skills.
  If installation approval is enabled, the recipient must approve missing
  contributions first; otherwise setup is automatic. Normal tool/platform
  permissions still apply.

The generated package contains canvas code and configuration, not a copy of the
creator's `.specify/` directory, installed contributions, or skill files. The
Spec Kit setup skills and CLI are separate prerequisites, not bundled Wizard
assets. Matching installations and unrelated contributions are preserved.

### Readiness and reconciliation

Template version 14 checks the portable setup contract in `pipeline.json` on open.
If initialization, recorded contributions and required skill files already match,
the canvas skips agent-led setup—even with presets/extensions and installation
approval disabled—and reloads the current session's skills directly when needed.
Only missing or mismatched setup sends a setup prompt to the coding agent.
Readiness requires independently observed contribution state and recorded relative precedence,
not an agent acknowledgement. A mismatch or unreadable state reports expected versus observed
details and invalidates cached readiness.
Presets and extensions are reconciled in the Wizard-recorded precedence order.
The agent performs setup mutations through the Spec Kit skills and CLI. The extension
runtime only reads local setup files and runs read-only `specify preset list` /
`specify extension list` queries. Those queries are coalesced and cached for up to
30 seconds, invalidated by setup evidence changes, and forcibly refreshed during
`reloadSessionSkills`. The runtime does not write setup files or install contributions.

After readiness is established, routine `/api/state`, `list_items` and one-second
UI polls use an in-memory status snapshot: no setup inspections, contribution CLI
queries or required-skill file reads. Before phase execution or artifact amendments,
the runtime inspects current evidence again. Unchanged evidence reuses loaded-session
readiness; changed matching skill/setup evidence reloads skills directly. Missing or
mismatched evidence uses the existing gated repair flow (amendments remain unqueued).
Explicit setup/retry, installation-review actions and skill reloads also recheck.
Reload failures remain failures and never trigger a full setup audit merely because
the session registry needs reloading.

Unresolved setup continues bounded local checks and cached inventory queries so
agent repairs and out-of-band installations can become visible without new UI.
Readiness and concurrent reload coalescing are scoped by workspace, canvas and setup
contract in the provider's memory only. New workspaces/providers recheck; no loaded
session readiness is persisted, no watchers are installed, and generation gains no
extra setup or verification step.

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
External installations are detected while setup is unresolved or at the next explicit
setup/execution check; no acceptance record is written
for already-installed components. Phase execution still requires actual
configuration/skill readiness and session reload. Installed components are
retained without reinstalling, even when their settings need reconciliation.
Setup uses only captured IDs and sources, preserves unrelated destination contributions,
and honors platform and tool permission requirements. This local consent record is
not sandbox enforcement, a package-safety guarantee, or immutable remote-content verification.

Once setup evidence matches, the generated canvas reloads the current Copilot session through
its `reloadSessionSkills` action, backed by `session.rpc.skills.reload()`. Failed or
interrupted setup exposes a retry action; default first-run setup requires no user click.
The runtime reload result is the current-session registry authority; running
`copilot skill list` in another CLI process is not an additional verification step.

Caught runtime exceptions are reported through fixed, operation-specific messages in
HTTP responses and canvas state, rather than exposing exception text or stack traces.
Unavailable or oversized artifacts retain HTTP status 413; other failed requests return 400.

## Workflow slug validation

Template version 12 shares a protected `ui/workflow-slug.mjs` validator between
the renderer and runtime. Slugs are trimmed without lowercasing. Leave the field
blank for automatic naming; otherwise use lowercase letters, numbers, and single
hyphens. Windows reserved directory names (`con`, `prn`, `aux`, `nul`,
`com1`–`com9`, `lpt1`–`lpt9`) are rejected on every platform.

Invalid input is reported at the field before running state or installation/rerun
dialogs. Editing clears the error without discarding drafts. Runtime validation
also precedes approval checks, setup queueing, and dispatch: HTTP runs return 400
with fixed guidance, and actions return `ok: false`, `queued: false`, and
`code: "invalid_workflow_slug"`. Unexpected failures retain generic error messages.

## Project Constitution (when selected)

Template version 11 supports optional `projectArtifacts.constitution`, referencing
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

## Artifact clarifications

The Markdown viewer recognizes the Wizard's case-insensitive
`[NEEDS CLARIFICATION: question]` markers, including multiline questions.
**Clarify** opens an answer editor; **Save draft** saves the answer and
**Edit draft** remains available while the marker exists. Neutral **Draft saved**
labels and a separate draft count are not resolution indicators. Code examples and links stay non-interactive,
and artifact HTML remains escaped.

**Apply answers** submits the checked subset (including a single draft) through `/api/artifact/amend`, not
`/api/run`. Answering two of five questions amends just those two; the remaining
markers are preserved. The endpoint validates the exact phase, existing workflow
item, declared regular artifact and selected marker text against a fresh bounded
read. Any stale or ambiguous duplicate marker rejects the whole batch before
dispatch. Constitution uses its project phase without a workflow item or slug.
Installation approval and setup/session readiness must be satisfied; amendments
are never queued for later setup execution.

Template version **17** disables **Apply answers** only while the submission request
is being sent or no applicable drafts are selected. After acceptance, an unresolved
question can be edited and resubmitted immediately; marker presence and observation
timeouts do not block follow-up answers. Automatic artifact refresh replaces the
manual Refresh artifact link.

The dedicated prompt asks the coding agent to incorporate the answers into the
relevant sections and remove only resolved exact markers. It treats the JSON
artifact/answer payload as untrusted data and preserves unrelated prose,
unanswered markers and provenance. It forbids invoking the original skill,
research, phase reruns or downstream changes. Insufficient/conflicting answers
keep their exact markers; the agent adds or updates a concise nearby explanation
of what is missing, without duplicate notes. The normal **Rerun**
phase action and its confirmation remain unchanged.

Viewing, polling, queuing the last answer and going Back never dispatch a phase.
Back retains answers. Browser-local drafts are keyed by workspace/canvas, item
(or project), exact phase key and artifact path, not the currently selected item.
They survive viewer navigation and same-origin page reloads; browser storage
restrictions or a new loopback origin can limit persistence.
Gate rejection, stale markers and failed sends keep answers with an explicit
message. Dispatch acknowledgement never clears drafts or marks completion.
Only drafts persist; legacy submitted metadata is ignored on reload.
Submission snapshots are transient and revision-aware. Two matching nonempty
observations at least one second apart may remove unchanged submitted drafts
whose visible markers disappeared. Empty/unstable reads, and truncated reads that
also lose unanswered markers, retain drafts. This is conservative observation,
not an agent completion or semantic correctness signal. In-flight edits and
additions remain. This is structural verification, **not proof that an answer was
correctly incorporated**—review the artifact.

The viewer reuses ordinary refreshes and polls every two seconds while an amendment
is pending, for up to two minutes. Unchanged content leaves its DOM, scroll and
open answer editor untouched. Reads are scoped to the captured artifact and cannot
repaint a different selected viewer. Partial updates retain unresolved answers.
Timeout is an observation warning, never success or a submission lock. The server
blocks overlapping submission requests per workspace/canvas/artifact only while
dispatch is in flight, releasing the lock on acceptance or failure. There is no
durable job or agent-completion signal: acceptance does not mean editing has finished,
so review the artifact before retrying. Closing a viewer does not discard drafts.

Template version **18** presents an empty workflow collection as a single,
unboxed instruction: "Start your first workflow below." The existing New action
and workflow creation behavior are unchanged.

## Files

- `pipeline.json` — immutable generated workflow definition.
- `ui/clarifications.mjs` — shared, protected artifact-scoped drafts and transient submission observations.
- `ui/clarification-controls.mjs` — shared neutral draft controls, subset selection and retained-draft review.
- `ui/amendment.mjs` — shared exact visible-marker validation and focused amendment prompt.
- `amendment-runtime.mjs` — guarded, deduplicated edit-artifact dispatch; no phase execution.
- `artifact-review.mjs` — optional final-artifact result classification and latest-result storage.
- `workflow-config.json` — validated workflow labels, fixed phase arguments, and input guidance inferred from effective installed skills.
- `workflow-adapter.mjs` — protected interpretation of that configuration; never generated executable logic.
- `setup-runtime.mjs` — deterministic read-only readiness checks and agent setup prompt.
- `approval-runtime.mjs` — protected, bounded local approval storage and contract checks.
- `project-artifacts.mjs` — protected Constitution observation and execution gate.
- `ui/command-views.mjs` — shared full/project/workflow command views and descriptor validation.
- `workspace-files.mjs` — blueprint-scoped artifact/folder authorization and operating-system reveal behavior.
- `extension.mjs` — standard secure canvas runtime.
- `ui/` — standard Wizard workflow renderer.

Configuration has four standard fields: `version: 1`, `itemLabels` (workflow ID to
display label), `phaseArguments` (blueprint phase instance key to optional
single-line `prefix` and `suffix` strings), and `phaseInputs` (every blueprint phase
instance key to `label`, `helper`, and boolean `optional`). Input labels are at most
80 characters; helpers are at most 240 characters. Both are plain single-line text
describing useful content, never slug, identifier, command, or location instructions.
A supplied `phaseInputs` map must cover every phase. Empty labels/fixed-arguments
maps use standard behavior.
Optional `resultLabels` is an array of zero to five labels, each a trimmed,
single-line label of 1-3 words and at most 60 characters. Labels must be distinct
case-insensitively and must not use built-in notice labels such as Not determined,
Clarification needed, Reviewing, Review unavailable, or Artifact unavailable.
Both Needs clarification and Clarification needed are reserved, regardless of case
or whitespace. Generation validates the list and its order against the captured settings
exactly. Runtime classification binds to the actual final workflow phase and returns
only the configured positional IDs (`result-1` through `result-5`) or `not-determined`;
no free-form labels are accepted. Missing/null settings normalize to an empty list.
Empty settings show only clarification pills. Effective skills are consulted
for phase-input guidance only, not for result labels.
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
