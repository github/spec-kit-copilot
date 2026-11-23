# Canvas Design

A Spec Kit extension that supplies settings pages, a page-loading command,
and separate commands to generate and open workflow canvases for the Copilot Designer.

See [External customization contracts](EXTERNAL-CONTRACTS.md) for the definition
schemas, executable interfaces, host consumers, and boundary tests. `external-`
filenames identify contributor-facing contracts; unprefixed internal contracts
continue to govern host operations, persistence, transport, and integrity.

## What It Does

Canvas Design **0.1.21** registers four JSON page templates, fifteen ordered
stock field templates, reusable text and checkbox definitions with Designer
adapters, a shared image definition with paired adapters, and a source-owned
Workflow page definition, phase control definition with its required placement,
and phase adapter, badge types and evaluator rules, plus the
`speckit.extension-canvas-design.load-page` and
`speckit.extension-canvas-design.generate`, and
`speckit.extension-canvas-design.open-generated` commands. The first resolves the
project's preset-composed pages and explicitly named contribution templates,
then opens the Designer with the complete resolved set.
The second writes a maintained SDK entry point and workflow modules into a
project extension directory, then validates the result in place; it does not
reload extensions or open the app. The third reloads extensions in the child
session, verifies the exact project provider and canvas, and opens that app.

Replaceable templates are organized by host: `designer-host/` contains Designer
tabs and settings, `generated-host/workflow-page/` contains the Workflow page,
and `generated-host/phase-control/` contains the phase control with its placement
and adapter. `shared-controls/` contains definitions and adapters used by both
hosts. `generated-scaffold/` is the static app scaffold; Generate
copies the resolved generated-host assets into its `pages/` directory, so the
finished app does not depend on this extension at runtime.
Generated runtime diagnostics use the SDK-supported `warning` log level. If
logging throws or rejects, the runtime reports the diagnostic and logging failure
to the console without aborting badge evaluation.
The stock Workflow page shows its configured logo, workflow name, count, and
description with any summary badges directly beneath it, without a separate
Summary heading. This combined intro is always visible and cannot be collapsed,
even when no summary badges are available. Project foundation, contributed
fields and controls, List, and Detail follow it. Project foundation appears only
when Constitution is configured.
Each following section can be collapsed independently and starts expanded. Expansion
choices survive live updates but reset when the canvas reloads. **+ New**
remains available when List is collapsed and opens it before creating a
workflow. Detail contains the selected workflow and phase workspace, and
follows List without intervening contributions.

Named read-only field sections use their configured titles; fields without a
section use **Configured fields**. Canvas values and their named subsections,
and generated controls, are also collapsible. Contributed Workflow slots are
grouped under **Additional fields and actions** when present, without changing
their mounting or actions. This is stock-adapter presentation, not a new
customization contract: replacement Workflow adapters retain their own layout.
Existing generated apps are not automatically updated.
`scripts/contracts/generation-request.mjs` checks the frozen request's IDs
and SHA-256 integrity before materialization. The generated app packages
`generated-scaffold/contracts/` with agent action/response, host adapter,
contribution, and persisted workflow state rules; no design-time preset is
needed when reopening it. These files define custom workflow behavior, not
the generic `create-canvas` browser/server protocol.

### Workflow discovery

Discovery retains the default `specs` root and applicable legacy output roots.
For a phase with confirmed outputs, a legacy root is applicable only if those
outputs still include it. Otherwise, discovery extracts the directory prefix
before the literal `/<slug>/` in each confirmed output. One distinct fallback
root across those phases is scanned; multiple distinct fallback roots produce
an ambiguity error in the canvas instead of selecting the first output or
first populated folder. No slug-scoped outputs means no inferred root.

Rows represent child directories, so an assessment or other Markdown file is
not required for discovery. A usable legacy root still keeps secondary report
roots artifact-only. This fallback does not establish artifact ownership or add
configuration metadata. Existing generated apps are not automatically updated.

| Template | Page | Default contents |
| --- | --- | --- |
| `designer-essentials` | Essentials | Required Canvas ID and Title |
| `designer-essentials-description` | Essentials slot | Optional Description |
| `designer-essentials-workflow-heading` | Essentials slot | Optional Header text |
| `designer-essentials-workflow-item-name` | Essentials slot | Optional singular Workflow item name |
| `designer-essentials-custom-slug` | Essentials slot | Default-off Allow custom artifact directory slug option |
| `designer-essentials-header-logo` | Appearance slot | Optional small header logo (existing template name retained) |
| `designer-essentials-main-page-logo` | Appearance slot | Optional larger main-page logo (existing template name retained) |
| `designer-appearance-light-accent` | Appearance slot | Optional light-mode accent hex |
| `designer-appearance-light-background` | Appearance slot | Optional light-mode page background |
| `designer-appearance-light-surface` | Appearance slot | Optional light-mode card surface |
| `designer-appearance-light-secondary` | Appearance slot | Optional light-mode secondary surface |
| `designer-appearance-light-text` | Appearance slot | Optional light-mode main text |
| `designer-appearance-dark-accent` | Appearance slot | Optional dark-mode accent hex |
| `designer-appearance-dark-background` | Appearance slot | Optional dark-mode page background |
| `designer-appearance-dark-surface` | Appearance slot | Optional dark-mode card surface |
| `designer-appearance-dark-secondary` | Appearance slot | Optional dark-mode secondary surface |
| `designer-appearance-dark-text` | Appearance slot | Optional dark-mode main text |
| `generated-workflow` | Generated Workflow page | Required page metadata, adapter reference, badge destinations, and named slots |
| `generated-workflow-page-adapter` | Generated Workflow page | Replaceable setup, constitution, list, summary, phase composition, values, and contribution presentation |
| `generated-phase-control` | Generated Workflow page | Phase identity, placement, adapter reference, and per-phase view labels |
| `generated-phase-adapter` | Generated Workflow page | Replaceable phase navigation and card presentation |
| `shared-controls-image` | Shared control | Image value contract and paired adapter names |
| `designer-control-adapter-image` | Designer | Upload, preview, replace, and remove images |
| `generated-control-adapter-image` | Generated app | Render packaged images in authorized slots |
| `shared-controls-text` | Shared control | String value contract and adapter names |
| `designer-control-adapter-text` | Designer | Edit contributed text fields |
| `generated-control-adapter-text` | Generated app | Render visible text in authorized placements |
| `shared-controls-checkbox` | Shared control | Boolean value contract and Designer adapter name |
| `designer-control-adapter-checkbox` | Designer | Edit boolean settings |
| `designer-badges` | Badges | Add opt-in result badges to workflow rows, summaries, phase cards, and individual phase outputs |
| `designer-appearance` | Appearance | Logos and per-mode palette colors |

The Essentials core template lives in `designer-host/tabs/essentials.json`; its
`designer-essentials` is the template ID used for preset resolution.
Its required Canvas ID and Title are rendered by the fixed identity control,
while optional text contributions use the registered `stock.text` adapter.
There is no Outputs page: Wizard-inferred artifacts and viewer defaults remain
host-owned evidence, while badge controls may declare additional expected
Markdown output files directly. The Designer
validates each supplied page without requiring every default tab to open;
presets can still contribute to the `essentials.options` slot. An empty or
partial composition opens with inline diagnostics, but Generate requires
valid identity fields and the selected generated Workflow assets. Identity
length, requiredness, and identifier rules are checked at Generate;
the generator independently guards the generated extension path. Description and
Header text use the packaged stock-text adapter for their visible generated
presentation. Header text retains the `canvas.workflowListName` field ID and
defaults to `Workflows`. Workflow item name uses `canvas.workflowItemName`,
accepts up to 80 characters, and defaults to `Workflow`; it is independent of
the header and is not pluralized. Its setting uses the existing Designer
stock-text adapter. It is a nonvisual configuration input rather than a separate
generated control: the stock Workflow page adapter renders its labels, and the
host uses it for default item names. The optional artifact directory slug hint
also uses the item name in lowercase hyphenated form (for example, `Bug` gives
`bug-1`); names with no letters or numbers usable in a slug fall back to `workflow-1`.
This is only a placeholder and does not assign or rename directories. Newly generated canvases receive these
settings; existing generated canvases are not updated automatically. Authors
may set `"required": true` on a text field in a page or a field contribution to
reject empty or whitespace-only values.
The shared Designer adapter shows the field's syntax guidance; Generate verifies
the constraint independently. Omitted `required` preserves optional text.
Essentials field help comes from each JSON definition's `description`; stock text
and checkbox adapters display it below the corresponding control.
Allow custom artifact directory slug is a stock-checkbox Designer setting with no generated visual
adapter; its frozen boolean controls the generated workflow shell. When enabled,
a user may enter an optional Artifact directory slug to preview the target;
otherwise Specify chooses the actual directory, including any numeric prefix.
When disabled or absent, no slug is requested. The optional Show setup checkbox uses the stock
checkbox pattern; privileged setup stays in the generated host.
The composed load-page command explicitly resolves stock contributions into
`essentials.options` or `appearance.options` in their declared order. Omitting or replacing a stock contribution
does not remove the required Canvas ID and Title. If absent, generated description
defaults to `Spec Kit workflow canvas.` and heading to `Workflows`.
Generate validates all enabled Designer pages, including custom fields;
an invalid page blocks generation until repaired.
Appearance's independent Header logo and Main page logo controls accept PNG, JPEG, GIF,
or WebP images up to 32 KiB each. They appear before palette colors.
Upload, preview, replace, and remove are
available for both in Designer. The smaller header logo replaces the existing
brand mark; the optional larger main-page logo appears next to the workflow
heading and description. Either image may be used alone. Generate freezes
each selected image's bytes and SHA-256 hash and packages it within the
generated extension, together with the frozen, shared generated adapter.
The Designer accepts up to ten selected 32 KiB images; its Save and frozen
generation size limits accommodate that maximum, while still rejecting
oversized aggregate requests explicitly.
Each image contribution uses `"control": "stock.image"` to select the uniquely
resolved shared definition; its `generatedBinding` declares the target slot.
Missing or duplicate definitions fail validation. Presets reuse the definition and both adapters rather than supplying
per-placement image renderers. The resulting app serves its own images and
loads its packaged adapter without Canvas Design installed. It rejects missing
or modified packaged images instead of silently rendering a different logo.
Without a Header logo the existing brand mark remains; a configured image
that cannot mount its adapter shows a local error.
Both adapters receive an image-source string as `value`. Designer supplies
the editable data URI and upload processing in the Designer adapter; the generated
host supplies an authorized packaged URL as `value` and presentation options
such as alt text in `context`. Neither adapter selects a slot or reads files.

Preset-generated pages can also place a `stock.image` contribution. Declare a
slot on the generated page, for example
`"slots": [{"id": "hero.logo"}]`, and bind the image
field with `"control": "stock.image"` and
`"generatedBinding": {"presentation": "asset",
"page": "canvas-generated-gallery", "slot": "hero.logo"}`. The page renderer
puts a `<div data-asset-slot="hero.logo"></div>` at the desired location; the
generated host matches the slot ID and mounts the packaged image there, with
the field label as its accessible description. The renderer may style the slot to choose the size
and layout. Every page, field, and renderer must be explicitly registered as
a named replace-only template. Unknown or duplicate slots fail
validation; a selected image whose slot is not rendered fails visibly when
the generated page opens. Neither preset files nor the Canvas Design package
are needed at runtime.

The package includes the page schema and workflow feature modules, but not the
Designer provider. Generate uses Essentials, selected phases and verified
runtime package inventory from the Wizard handoff. Designer-only `canvas-design`
selections are not runtime canvas configuration.
Appearance exposes per-mode accent, page background, card surface, secondary
surface, and main text colors. Each optional setting accepts `RRGGBB` or
`#RRGGBB` (case-insensitive), or blank. Generate validates and freezes nonblank
values as `#RRGGBB` under `appearance.light` and `appearance.dark` in the
generated canvas's `canvas-config.json`. Each blank setting retains its existing
theme color. Viewers can still switch between light and dark mode. Invalid hex
blocks Generate, but incomplete drafts may be saved. There is no color preview
or contrast warning; choose contrasting text and surfaces. Existing generated
canvases are not updated. A newly opened Badges tab has no configured badges;
no badge is evaluated or rendered until one is explicitly added.
Generated phase and pending-workflow status notices keep in-progress and error states,
but do not show a built-in Completed badge; add a completion badge explicitly in
Designer to show one.

The workflow intro shows the configurable name, count, description and optional
logo and any summary badges in one non-collapsible area, without a separate
Summary heading, followed by **Project foundation**, configured sections,
**List**, and **Detail**. Project foundation appears only when Constitution is configured, and Detail only when
the selected workflow has phases. The compact **+ New** button (accessible name
`New` plus the configured singular item name) sits beside the List heading. The selected row shows an accent
bar and tinted background. Detail is a bordered panel showing the selected name,
and its slug when it differs, without a draft-status note, followed by the
numbered phase stepper with the active step highlighted and the selected phase card. Category badges render as
compact pills with the category as a small label inside a dashed outline that
stays legible in light and dark themes and distinguishes the group from its badges.
The generated canvas shows a bordered,
searchable workflow list immediately. When there are workflow phases but no
workflows, opening the canvas automatically creates and selects a **Not started**
row named from the item name and a number (for example, **Workflow 1** by default).
Existing workflows remain untouched. New adds another selected **Not started**
row at the top of the list. Search and empty-state copy use neutral item wording.
Newly created workflow directories remain above older rows after Specify reports them.
Its editable item name comes
before the optional Artifact directory slug, shown only when enabled in Essentials.
The name labels the list row; a supplied slug previews artifact output paths.
Without one, Specify chooses the artifact directory. No directory is created until
Specify runs; its scripts may add a numeric prefix to the actual directory name.
New stays available while editing, and Remove discards an unstarted row without
deleting any directory. Pending rows and their phase drafts survive a reload.
An external extension reload during a phase can interrupt reporting. A live turn
remains Running; a finished turn without a reported directory is marked Run output unconfirmed.
Recovered runs can report directories and artifacts only while their matched
turn is active; reporting rechecks that evidence and rejects ended turns.
An ended Run output unconfirmed does not block the existing confirmed Delete
action for a discovered workflow directory. Metadata-only discard still refuses
to remove a row when a directory appeared.
The host-to-Workflow-page contract in `generated-scaffold/contracts/external-host-adapter.mjs`
defines pending rows' `hasWorkflowRunHistory` (boolean), `workflowRecoveryMessage`
(string or null), and `status` (Not started, Request sent, Running, Unconfirmed,
Run output unconfirmed, Completed, or Failed). Recovery messages explain discovered
folders or inconclusive checks; they do not authorize deletion.
If a restart loses the dispatch message ID, the host first tries to recover it
from the unique run ID in the dispatched prompt. Otherwise it shows Run output
unconfirmed and permits confirmed metadata discard only after observing session
idle in the restarted host, while still requiring all directory safety checks.
New session activity blocks discard again; the host never treats an untracked
dispatch as proof that no prompt was sent.
Recovered tracked runs also become Run output unconfirmed after an observed
session idle when no terminal response or turn-end event is available. New
activity blocks discard again. Recovery messages share one verified directory
inventory per snapshot; discard always performs fresh directory safety checks.
One restart eligibility rule includes unfinished runs and Completed pending runs
without reported output. Reconciliation and discard share the same active,
ended, or unknown activity decision; unknown activity blocks discard, and a
new matching turn clears the previous turn's ended state.
After the turn ends, a run-backed row offers a confirmed Discard pending row action.
This checks all configured workflow roots against the pre-run snapshot, including
empty directories, and removes only the pending row, drafts, and run history when
no directory appeared. A new or unsafe directory blocks discard and its path is
shown for inspection in the workflow list. The app cannot prevent externally
initiated extension reloads; its existing skill reload behavior is unchanged.
Existing rows offer a confirmed Delete action that permanently removes that
workflow directory and its contents from the checkout, not other workflows.
Deletion checks the owning checkpoint and phase attempts using the same evidence
rules, including Paused checkpoints and phases displaying Run output unconfirmed
after recovery. Matching active turns block deletion regardless of display status
or saved Stop evidence. Otherwise, an Unconfirmed attempt can be deleted when its
owning session has current end evidence or its associated Autopilot stopped;
unknown activity without Stop evidence remains blocked. Only the latest matching
work counts: a response from an earlier turn cannot authorize deletion after newer
tool work, and a tool-using turn ending alone is not task completion. Unrelated
session activity does not override conclusive evidence for this workflow.
Task completion during an open matching turn does not authorize deletion until
that turn ends. Conclusive end evidence takes precedence over stale in-memory
live markers, and queued messages do not erase known turn ownership. Unscoped
task completion still belongs to the current interaction, not a queued workflow.
Confirmation, state-revision, confinement, and symlink checks still apply.
Successful deletion also removes the workflow's explicitly associated Autopilot
checkpoint, including when an artifact report bound its phase run before a slug
report. The saved property is omitted, not set to `null`; other workflows'
Autopilot state is preserved. If Copilot has not left Autopilot after a run that
began in another mode, deletion is blocked until the user switches back,
preserving the recovery record.
A request that never reported its directory can remain as a pending row:
directory discovery alone does not establish ownership for automatic cleanup.
If tracking failed and the session became idle after mode restoration, explicit
Stop remains available before deletion; new session activity blocks this recovery
while the mode is not Autopilot.
After a successful explicit Stop, all phase runs in that Autopilot attempt retain
an optional `stoppedAt` ISO timestamp in saved state, including completed phases
whose statuses and outputs remain unchanged. This preserves stop evidence across
retries, checkpoint replacement, and reloads without treating unknown activity as stopped.
The saved-state validator accepts existing runs without this field and rejects
malformed timestamps or stop evidence on non-Autopilot runs.
Known limitation: Stop evidence is not a temporal fence. If tool work continues
in the same canceled interaction after Stop, a later turn-end without task
completion can still fall back to the older Stop evidence. Distinguishing this
from delayed historical events is deferred; if work visibly continues after Stop,
stop it in chat and wait for completion before deleting its workflow.
Deletion verifies the directory and its parent, moves it to a temporary
location, and checks the moved directory's identity before removing it. If
the parent changes during deletion, the moved directory is retained for manual
recovery at the path shown in the error.
A missing project Constitution must be created before running a
workflow, with project principles required for first-time creation; an existing `.specify/memory/constitution.md` is recognized even if
created outside the canvas, with View and Update actions. The compact project
constitution follows the workflow list and applies to every workflow. The horizontal phase ribbon remains
visible, scrolling on narrow screens, even before a new workflow is started;
phase details appear when a row is selected. Phase navigation
shows phase names without run states; the selected phase card retains its status.
Its subtitle uses the Wizard's phase description when provided, with a built-in
description for canonical phases in older handoffs instead of a command ID.
Dispatch success does not add a separate "Request sent" notice to the canvas.
Phase and Constitution run buttons read "Running" while a request is being
sent or running; they remain available for retries.
Rerunning a completed or failed phase, or a phase with an available artifact,
asks for overwrite confirmation as in the Wizard; in-flight retries do not.
View output opens a full-page viewer with a return-to-canvas action and no
separate Refresh button.
Wizard-inferred pipeline artifacts and viewer defaults are not editable.
Badge input controls may declare extra Markdown files as expected phase outputs
when inference missed them; declaring one does not immediately create it or
change the inferred View target. The phase run receives the full expected output
list, and the generated phase card offers additional output links.
The generated phase card shows the default output first and collapses additional
links behind a count; the primary View output button is hidden when a phase has
no default viewer target, even if it has additional output links. Running
Specify creates the workflow. Constitution always
opens `.specify/memory/constitution.md` and cannot
be changed in the Designer. Existing saved viewer selections and additional
links remain readable; a fresh Designer form starts with Wizard-inferred defaults.

## Generated app project setup

Essentials includes **Show setup**, off by default. When enabled, an unready
project shows a setup card above a read-only preview of its selected workflow.
Phase Run actions remain unavailable until setup completes. Clicking **Set up
project** ensures the Specify CLI is available, initializes Spec Kit in Copilot
skills mode if needed, then asks for confirmation before installing any pending runtime
packages. The confirmation lists every pending package and source, including
community packages. Cancelling does not start installation. After installation
and skill reload are verified, the setup card disappears and the same workflow
enables in place. Already-ready projects skip setup. With Show setup off, the
normal page remains visible but phase runs are blocked with a setup-required
error until the project's
prerequisites are met; no automatic install runs.

Specify may report an approved direct-URL package as a local source. The
generated canvas accepts that inventory only after the confirmed URL install
completes with the frozen identity and settings, and retains an approval receipt
across restarts. An unconfirmed direct-URL package reported as local remains pending.

For a frozen default-catalog locator with no URL and identical catalog and
installed IDs, the canvas also accepts Specify's exact `{"kind":"local"}`
inventory. It still checks package identity, version, enabled state, and
priority, and requires the phase skills for readiness. Specify cannot distinguish
an identically reported local override, so this is not proof of package origin.
Frozen local-path locators still require their approved path and manifest; they
are not converted to portable catalog locators. Newly generated apps receive
this behavior; existing apps retain their packaged setup logic until regenerated.

Only the frozen **workflow runtime** package inventory is considered for
installation. The Canvas Design extension, `canvas-design`-tagged presets,
and local design-time customizations are already represented by their packaged
generated assets and are not installed into projects using the finished app.
Opaque bundles are not replayed: their separately verified runtime preset and
extension members are frozen and installed individually. Bundle-only components
without a verified standalone source cannot be reproduced by this setup path.
Dialog and button definitions/adapters use the same named-template resolution
and packaging as generated pages and controls. The Setup button has a dedicated
`generated-host/setup-button-control/` with a fixed setup callback; the
test preset's Workflow-page button uses a separate `dialog.trigger` control.
A preset can also bind a confirmation dialog to one selected workflow phase without replacing
the phase card or changing other phases. Project-scoped Constitution does not
support generated phase confirmations. Autopilot cannot start when any workflow
phase has a generated confirmation binding; run those phases manually instead.

The named contracts are `schemas/external-generated.dialog-definition.schema.json`,
`external-generated.phase-dialog-binding.schema.json`, `external-generated.button-control-definition.schema.json`,
and `external-generated.button-placement.schema.json`. A dialog adapter exports
`dialogId = "stock.dialog"`, `contractVersion = 1`, and
`mount({root, definition, context, onDecision})`, returning an instance (or a
promise of one) with a decision promise (`confirmed` or `cancelled`) and `dispose()`.
A button adapter exports
`controlId = "project.setup-button"`, `contractVersion = 1`, and
`mount({root, definition, onSetup})`, returning an instance (or a promise of one)
with `dispose()`. The optional
`dialog.trigger` adapter instead receives `onTrigger`. Both are executable
approved template code, not sandboxed JSON. The test-only
`tests/fixtures/test-presets/copilot-dialog-buttons-test` fixture adds one `speckit.implement`
confirmation and a separate `workflow.actions` button; it is not a runtime
package or a catalog release.
The Badges tab offers **Value match**, **Artifact current**,
**Artifact stale**, **Checklist progress**, **Checklist complete**,
**Markdown files**, **Phase run complete**, and **Phase artifact complete**. It starts empty; no badge is added until you choose one. Use
**+ Add badge** to open a separate type picker. The focused editor shows
badge color first, then phase checkboxes with outputs nested under
each selected phase. Selecting a phase starts with its View output; the rule
determines whether one output or several can be selected. Placement offers
Workflow summary, Workflow list, and Phase, each with its own text field.
Workflow-list and phase-card text can use only placeholders declared by the
badge's rule. Summary text is a plain label; the generated canvas adds the
matching-workflow count automatically, for example `Needs review: 3`.
Badge outlines use the same color as their
text in the Designer preview and generated canvas. Phase shows the badge on each selected
evidence phase's card for stock controls; a registered input control can
select a different target phase. Checklist badges can use evidence from one
phase on another phase's card without changing their workflow-list or summary placements.
Previously saved custom phase/output placements remain visible and are
preserved when edited; select Phase to replace them with evidence-phase cards
or remove the saved placements explicitly. Unavailable saved placements can
be removed without losing valid ones. Only one primary action appears per view:
Add badge on the list, then Create badge or Save changes in the editor.
Configured badges have Edit and Remove actions. Selected evidence outputs stay pinned if their View
default later changes; removing one requires choosing another before Generate.
The same badge type can be added again with different placement text or rule inputs,
even at the same placement. Only the same type, placement texts, inputs, and overlapping
phase/output target (or untargeted badge) are rejected as duplicates by
Save and Generate.
**Markdown files** uses the selected confirmed output as a folder anchor,
counting regular `.md` files in that folder for each workflow, including
when the selected file is absent. Its Workflow summary counts workflows with
at least one matching file (not the total number of files); individual badges
can still show the file count using `{count}`. It does not count checklist items;
**Checklist progress** and **Checklist complete** each select a checklist
file from the evidence phase's declared Outputs and at least one earlier
output for currentness. If the checklist path is not listed, expand
**Use a Markdown file not listed** and add one safe relative `.md`
path to that evidence phase. The file need not exist yet, and adding it does
not change the inferred View artifact. This is not a folder or multi-checklist
aggregate. The Designer host owns file declaration: the registered adapter
may call `onDeclareFile(phase, path)` while its editor is active; the host
validates the phase, path, duplicate and output limit, updates draft output evidence,
and returns the updated output snapshot. A missing callback, stale editor,
rejected path, or incompatible returned snapshot must show an error rather
than claim the file was added. Their registered checklist input control
selects a separate workflow target phase (not Constitution) and an ordered
currentness chain (for example,
draft.md → review.md → checklist.md). Every file must exist and each timestamp must
be at least its predecessor's; equal timestamps pass. No separate evidence-phase badge
nor a completed phase run is required. Missing or stale files do not match;
unsafe or unreadable evidence produces a diagnostic. A current, nonempty
checklist shows Progress with `{completed}`, `{total}`, and `{percent}` even
when all boxes are checked. Complete appears only if every box is checked.
The editor places each field's help beneath that field and shows a live
phase-and-file sequence for the selected upstream artifacts and checklist.
Their optional summaries count matching workflows independently. The two
badges may select the same file and chain, but each saves its own selections;
changing one does not update the other. Old saved Designer checklist badges
use incompatible rule inputs and must be removed and recreated; already
generated apps retain their frozen behavior.
**Phase artifact complete** checks one target phase and its selected output
against an optional ordered chain of outputs from earlier selected workflow
phases. Each checked prerequisite phase contributes exactly one declared
output, evaluated in workflow phase order; the target is checked last.
The editor shows help under Target phase and Required output, an inline
**Use an output file not listed** disclosure for declaring a Markdown file
on the target phase, and a live selected phase-and-file sequence. It keeps
the inferred View artifact unchanged. All chosen outputs must be regular
files, and each later modification time must
be at least the preceding one (equal times pass). A missing output does not
match; unsafe or unavailable metadata produces a diagnostic. Intervening
phases that were not checked are not prerequisites, and no completed phase run
is required. A target-only Specify badge needs no earlier output. When Phase
is checked, the badge appears on the **target** phase card, not on each
prerequisite's card. Workflow list and Workflow summary can be checked
independently, each with its own editable text separate from the phase-card
text. The summary counts matching **workflows**, including zero; it does not
count files or phase runs.

Phase artifact complete badges share the `phase-completion` replacement group.
For each workflow, the furthest matching target phase shows on each enabled
display location (workflow list and phase card); ties at that phase remain
visible. Each location selects independently, so a phase-card-only badge does
not hide an earlier workflow-list badge. Other badge types remain independent,
and every matching instance still contributes to its Workflow summary count,
including earlier phases after a later phase becomes current.

**Artifact stale** uses a required ordered chain of at least one earlier
declared output and a selected target output. It shows only when the target
exists and a selected earlier output is missing, or a predecessor in the
chain is newer than its successor; equal timestamps are current. A missing
target does not show a stale badge. Unsafe or unreadable evidence produces
a diagnostic instead of a match. An omitted earlier phase is not checked:
select the full chain for SDD-style staleness, such as
`spec.md → plan.md → tasks.md`. Unlike **Artifact current**, this rule does
not inspect the target phase's run timestamp. Existing saved Designer
Artifact stale badges have incompatible inputs and must be recreated;
previously generated apps retain their frozen behavior.
Constitution can provide badge evidence for workflow badges. Selecting Phase
with Constitution evidence places a matching badge on its project-wide
Constitution card, even before any workflow exists; a saved target may also
place it beside the declared Constitution output. Project-card badges are
evaluated once against project evidence, while Workflow summary still counts
matching workflows, not the project card. The generated Workflow page owns
the Constitution card (rather than the workflow phase control), so both the
stock and adapted page render these project-level placements.
Project card and output placements require every rule input to use Constitution
evidence; use a workflow placement for inputs from Specify or later phases.
Every badge needs a **Category**, such as `Severity`. The editor suggests
categories already used by other badges. The Configured badges list shows each
badge's category, and the generated workflow list and summary group badges of
the same category (ignoring capitalization) in a labeled dashed bracket. Phase
cards show badges without category labels.
Each selected placement has its own text field: **Workflow list text**,
**Phase card text** and **Workflow summary text**. A field appears only while
its placement is selected, and there is no fallback between them. Workflow and
phase text interpolate the rule's declared tokens. Summary text cannot use
tokens; the summary always displays `text: N`, where `N` is the aggregate
count, including zero before any workflows exist. Each matching workflow
contributes one to its summary count.
Renaming a type/default does not overwrite previously saved custom badge text.
**Value match** searches one confirmed Markdown output for an ordered list of
literal strings, ignoring capitalization. For each workflow, the first match
selects the matching value's color and its placement text. Each match has its
own **Text shown in workflow summary**, **Text shown in workflow list** and
**Text shown on phase card** fields for the selected placements. These fields
start blank with general prompts; new badges start with Workflow summary
selected. Each Summary item counts only workflows where that value won,
displaying `text: N`.
Add up to 100 entries and set priority with each
match's numbered **Order** dropdown. Rows stay where they are while editing;
changing an order shifts the other entries' priorities and saves entries in
priority order. Use **+ Add match** and **Remove match** to manage entries.
Matching searches the whole file, including examples and fenced blocks; it does
not interpret regular expressions or count occurrences. Include surrounding
text (for example, `Verdict: needs-clarification`) when context matters.

The complete Designer badge list lives in
`designer-host/badges-settings/badge-types.json`. It is one replace-only
Specify template: replace the whole file to add or remove types, rename their
IDs, change picker titles and descriptions, or change default text, color, and
enabled state. Its definitions also supply the selected types in generated
canvases; a type must refer to a registered rule. Rules and their self-contained
JavaScript adapters remain independently replaceable templates under
`generated-host/badges/`; rule metadata declares typed evidence inputs and
supported text placeholders. Each rule's `adapter` names its registered
`generated.badge-rule-adapter` evaluator; this is separate from the Designer
input control's `adapter`. Preset rule definitions using the former `module`
key must change to `adapter` before loading with this source; generated apps
already on disk keep their bundled rule and runtime unchanged. Saved badge
instances refer to type IDs, so renaming
one requires updating existing instances before Generate. Generate
freezes only selected definitions and adapters into the app so runtime never
needs the design-time preset. Generated apps use bounded reads of declared
outputs and recorded runs; rule adapters decide whether evidence matches and
produce badge values and optional nonnegative `summaryCount`. Directory-scoped
artifact evidence counts regular Markdown siblings of the selected output,
without assuming a folder or phase name. Freshness compares artifact modification
time to the latest run's start (or completion for older records without a start).
Counts and freshness are best-effort; unreadable evidence
produces a diagnostic rather than an invented exact result. A replacement
phase adapter must declare badge support before phase-card placement is used.
The generated app shares badge evaluation across state reads and workflow
selections within one runtime. New phase attempts, accepted artifact or
workflow-slug reports, terminal run changes, explicit Refresh, and workflow
deletion clear this in-memory result. Editing an artifact outside the app does
not update its badge until Refresh or another invalidating event; reopening
starts with an empty cache.

Designer input controls are separate from generated evaluators. Each registered
`designer.badge-input-binding` maps one rule ID to a reusable
`designer.badge-input-control` JSON definition (`id`, `adapter`, supported
`inputTypes`, and optional `capabilities`). Its registered, self-contained
`designer.badge-input-adapter` exports `controlId`, `contractVersion = 1`, and
`mount({root, rule, inputs, phases, outputs, onChange})`. Rules declaring a
`badge-selection` input also receive `selectionRoot` and shared `placements`,
and the handle must implement `updatePlacements(placements)`. The Designer-only
Value match editor renders this composite control; generated canvases reuse
the standard badge renderers. The identity and version must be direct literal `export const`
declarations so Designer can check them without executing preset code in Node;
the browser also checks the loaded adapter before mounting it. It reports the
**complete** structured `inputs` object through
`onChange`. The host passes detached snapshots of the rule, inputs, phases,
and confirmed outputs; mutating them does not change host-owned state.
For contract version 1, `capabilities: ["declare-markdown-output"]` opts into
the synchronous `onDeclareFile(phase, path)` action. The adapter must also
declare `export const declaresMarkdownOutput = true;` as a literal and return
`handlesOutputDeclaration: true` from `mount`. The host checks the declaration
against the resolved control definition before loading the adapter, then checks
the mounted handle before enabling the callback. An adapter without the
capability never receives the callback; a mismatched declaration or handle
produces an incompatible-adapter error in the badge editor. The action rejects
an inactive editor, invalid phase or path, duplicate, or exceeded output limit
by throwing; on success it adds an expected Markdown phase output without
changing `view` and returns a detached complete output snapshot. Adapters
must display errors instead of claiming a failed declaration succeeded.
Adapters must send a complete, JSON-safe replacement with declared input types
and available phase/output selections after initializing defaults and after
each edit. Empty selections may remain while the user finishes editing;
`isReady()` must reject them before Create or Save changes. Invalid callback
payloads are rejected without changing the draft. A failed adapter import is
reported in its badge editor without preventing other Designer pages from
loading. A failing readiness or validation callback blocks that badge's
submission with an inline error; a
failing disposal is reported without blocking navigation. The Designer
validates saved input IDs, types, and confirmed outputs against the rule,
regardless of what the adapter allows in the browser.
The base extension binds its rules to declared stock controls; a preset can
register a custom JSON definition, adapter, and rule binding without editing
the Badges tab. Add the three named templates to the composed
`load-page` command with strategy `replace`; use the existing Specify template
precedence for replacements. Missing controls or evaluators and disabled types
do not fall back to other implementations. A rule with no enabled type needs
no Designer binding, but any binding that remains must resolve its control and
adapter. Saved badges still fail validation when their type or editor is
unavailable. The binding and Designer adapter
are **not** packaged in the generated app. The rule's `before` refers to
another declared input, not to a package dependency.
The generated Workflow page advertises its supported badge destinations
(`workflow.list`, `workflow.summary`, `phase.card`, and `phase.output`) in
`generated-host/workflow-page/workflow.json`. A preset can replace its
registered whole-page adapter and declare a subset; Generate rejects selected
placements outside that subset. The replaceable
phase control declares `phase.card` and `phase.output` in
`generated-host/phase-control/phase-control.json`; its adapter renders the
badge beside the selected phase or individual output link. These names
identify the four supported destinations and are checked at Generate.
The Workflow adapter owns the list, summary, setup, constitution, and phase
composition; the generated host retains authorized actions, persistence,
safe artifact access, and shared application chrome. Declaring another slot
alone does not add a fifth placement choice.

## Requirements

- Specify CLI **>=1.0.7** and an initialized Spec Kit project.
- GitHub Copilot with a separately installed, compatible Canvas Designer
  provider accepting the resolved pages and templates in its open input.
- A launching integration that supplies the Designer handoff.

Installing this extension does not install or open a Designer. The Designer
contract is the `schemaVersion.const` in
`schemas/external-designer.tab-definition.schema.json` (currently `1`). Bump that
schema version and coordinate with the Designer provider when changing its
supported interface; the extension release version alone does not establish
compatibility.

## Installation

**Recommended: register the catalog once, then install by ID.** Catalogs are
discovery-only by default; `--install-allowed` permits installation:

```powershell
specify extension catalog add https://raw.githubusercontent.com/nicolehaugen/spec-kit-copilot/staging-canvas/spec-kit-extensions/catalog.json --name spec-kit-staging --install-allowed
specify extension add extension-canvas-design
```

For a one-off installation without registering the catalog, use the release ZIP:

```powershell
specify extension add extension-canvas-design --from https://github.com/nicolehaugen/spec-kit-copilot/releases/download/extension-canvas-design-v0.1.21/extension-canvas-design.zip
```

The ZIP must be published before either installation method can succeed.
The staging catalog advertises all three commands. Verify the published
archive selected by the staging catalog before treating hosted Generate/Open
as release-ready.
For a new Copilot project, initialize it first:

```powershell
specify init . --integration copilot --integration-options="--skills"
```

Use normal installation rather than a development symlink for preset composition.
In Copilot skills mode, the command is exposed as
`speckit-extension-canvas-design-load-page`. Run `/skills reload` after installing
or changing composed skills to make them available in the current session.

## How It Works

The [page-loading command](commands/load-page.md) collects default page
names and additional page or Canvas Design template names explicitly registered
in the composed command by presets. One `specify artifact list --json` inventory
supplies each active replace-only template layer's winning path; package tags alone do not register
files. Only after all paths resolve does it open the official Designer provider
once with the complete typed, replace-only set. Missing or ambiguous CLI
resolutions, unsafe paths, missing or unreadable winning files, invalid handoffs,
and an unavailable provider stop the operation before an open URL is returned.
A readable page with invalid JSON shows an error tab with a path and reason;
healthy pages stay usable.
For a same-session reopen, the command instead asks the installed Designer
provider to restore its saved `last-open.json` with empty input. If that record
is missing, it directs a new Wizard launch rather than asking the user for an
internal handoff ID or silently opening the sample preview.

`scripts/verify-launch.mjs` reads the generated skill's declarations and
verifies every declared name against one fresh Specify artifact inventory
before returning the complete pages/templates input. It performs no
installation or provider evaluation. A warning (even on exit status 0),
missing name, invalid or unreadable winning path, ambiguous stack, or executable script collision stops the
open.

The Generate command checks the integrity and checkout binding of its frozen
request, the canvas target, and the Wizard handoff's workflow and installed
inventory before writing files. It includes the hosted Canvas Design selection
when recomputing the handoff fingerprint. If only the source fingerprint
differs, the command returns a warning and attempts generation from the intact
frozen request; the agent reports that warning with the generated target.
Request or checkout integrity and workflow mismatches still stop it.
Generate reports its target, canvas ID, request ID, warnings, and creation
status in the child session chat, without reloading, inspecting, or opening
the app. The separate Open action sends the same frozen handoff and request
IDs to [open-generated](commands/open-generated.md). That command first checks
the existing target and its provenance, then reloads extensions in the child
session (which stops the Designer provider), verifies the exact running project
provider with `scripts/validate-generated-open.mjs`, checks the canvas
capabilities and opened instance, and reports success or the exact failure
in chat. There is no in-panel retry after reload. After reset or clear it
reloads before reopening the existing app, using its unique provenance
when the frozen request file is no longer available; it does not regenerate
or assume reset registered the provider. Generation accepts an optional
`--replace-existing=<prior-request-id>` fifth argument only after the Designer server authorizes
replacement for the same handoff and existing target's provenance. The exported
generator rejects a bare `true` in place of that request-bound token; no
replacement permission is stored in the frozen request. Once the staged canvas
is published, a locked prior backup does not undo that success: Generate returns
a warning with the remaining backup location for manual inspection and cleanup.
The generated `canvas-config.json` records the versions observed in the child
checkout's Specify inventory at Generate; changed versions produce warnings
without blocking. Unavailable package versions are marked `unverified` instead
of being attributed to the Wizard's older inventory.

Invalid registered field contributions stop the open with both names on a
field collision; newly registered stock text/checkbox fields mount their
resolved Designer adapters on their declared Designer page and can be saved.
A registered bounded string contribution with
`generatedBinding: {"presentation": "stock.readonly"}` also freezes its
validated value into a read-only generated display, regardless of
which declared Designer slot holds the field. A separately registered
`generated.added-page-definition` definition and `generated.added-page-renderer` `.mjs` template add a
generated-only page without a Designer tab. The renderer is a complete
replace-only Specify template exporting `renderPage({ root, canvas, values })`;
the definition must name that registered renderer. Invalid kinds, references,
strategies, syntax or Specify template-layer metadata stop Designer opening.
Page IDs and renderer names must also be portable filenames: Windows device
names such as `con`, `nul`, and `com1` are rejected before generation.
Switching to a generated page hides Workflow-owned content and restores it on
return; the canvas header and status remain available on either page.
The frozen definition and module are copied into the generated app, which
needs no design-time packages to render them. A typed object field can use a
shared `shared.control-definition` naming separate replace-only `designer.control-adapter`
and `generated.control-adapter` templates; each module exports `mount`, `controlId`,
and `valueContract`. Each object-field contribution requires exactly one
`shared.control-definition` template matching its `field.control`, and Generate uses
that validated template name. Template names cannot be Windows device names because they may become packaged filenames.
The Designer adapter receives
`{root, field, value, onChange}`; the generated adapter receives
`{root, field, value}`. Designer saves drafts, including incomplete values; Generate
freezes the validated object and packages the effective generated adapter and
definition into the app, up to 30 generated controls. The frozen request holds
one asset pair per control ID; each field registration refers to that pair by
its control ID, so reused controls do not repeat module bytes. Missing, wrong-kind,
non-replace, or multiply owned adapters stop Designer opening rather than
falling back to a stock control.

Canvas-wide values can also be declared in a registered `generated.value-definition`
replace-only JSON template. Its `schemaVersion: 1`, stable `id`, `label`,
`schema` (bounded string, boolean, or enumerated object), `source`, and
`presentation` are validated against the same field registry, including
collisions with Designer fields. A constant uses
`"source":{"kind":"constant","value":...}`; a workflow-derived value uses
`"source":{"kind":"computed","module":"<registered-template-name>"}` and a
separate `generated.computed-value-provider` replace-only `.mjs` template exporting
`provideValue({workflow})` with a direct `export function` or `export const`
declaration (without imports). Named re-exports are unsupported.

Provider module names must be portable filenames, not Windows device names
such as `con`, `com1`, or `lpt9`. Designer, the frozen-request materializer,
and the generated app each enforce this before using `providers/<module>.mjs`.

For example:

```js
export function provideValue({ workflow }) {
    return `${workflow.label} (${workflow.slug})`;
}
```

`workflow` is a read-only object with `id`, `slug`, and `label` for the selected
existing workflow. Return a synchronous, JSON-serializable value matching the
value definition's typed schema; do not use `async` or return a Promise.
Designer checks the direct export and transformed script syntax, but **does not
run the provider**. A non-function export, Promise, invalid typed result, or
provider error is reported on generated-canvas refresh, not silently replaced.
Generate requires explicit confirmation of every resolved provider's name,
source (including project overrides), and SHA-256 hash; changed bytes require
reopening Designer and confirming again. `stock.readonly` displays a value
automatically, `stock.editable`
allows a constant's typed value to be edited through shell-owned state shared
by every workflow, and `processing-only` omits automatic display. A generated
page must explicitly list consumed IDs in its definition's `values` array;
processing-only is not a secrecy boundary. Providers require a selected
existing workflow and must return a value matching their declared schema;
refresh errors surface rather than substituting a default. A refresh has a
three-second provider budget shared by all values; providers not evaluated
before the deadline report an error instead of holding the UI indefinitely.
The packaged app
checks provider bytes against the frozen hash before each evaluation and
reports changes without running them. It does not resolve or need the
originating preset at runtime. The bounded worker/VM limits accidental hangs;
**`node:vm` is not a security boundary**. Approved provider JavaScript must be
trusted with the local user's privileges, including filesystem and network
access. Hash checks prevent unnoticed substitutions, not malicious approved
code.
The Designer, generator, and standalone generated app apply the same object
contract and value rules: 1-10 named properties, each with 1-20 distinct,
nonempty string options of at most 80 characters. The canonical
`generated-scaffold/external-control-contract.mjs` is copied into generated apps;
the Wizard provider includes a byte-checked copy, without a runtime dependency
on the design-time extension.
The browser reports incompatible `controlId` or `valueContract` exports,
non-function `mount` exports, and mount failures beside the affected control.
The frozen generation request is bounded to 4 MiB, allowing registered assets
to be packaged after base64 encoding while retaining the 32 KiB limit on each
definition and renderer.
Designer derives generated field and control registrations only from resolved
`generatedBinding` contributions when freezing. All validated Designer values
remain in the request, including Designer-only values, but only bound values
become generated displays. The generator checks registrations against frozen
value constraints and control definitions, as well as file and asset limits.
The request's SHA-256 integrity value catches accidental edits; it is not an
authentication mechanism for a locally rewritten and re-signed request.
For stock read-only fields, an optional `generatedBinding.section` with a
stable `id` and display `title` groups fields under that heading without
changing the Designer slot; fields without a section keep the **Configured
fields** heading. Opening the shell does not mean all pages loaded or that
Essentials is valid for generation.

The repository-local `copilot-billing-canvas-test` preset exercises stock
read-only placement on Billing and Essentials. The isolated
[test-only preset](../../tests/fixtures/test-presets/copilot-canvas-design-test/preset.yml)
registers an additional Designer page with stock text and checkbox fields. The
browser integration test covers the checkbox default, rendering, save, and
reopen. The preset is installed locally, not published in the canonical preset
catalog. Billing and generated-only pages have separate test fixtures.

The [Generate command](commands/generate.md) consumes a frozen, integrity-checked
request prepared by the Designer. It writes the **source-owned SDK entry point**
and packaged workflow UI, theme, routes, and runtime modules into a new
`.github/extensions/<canvas-id>/` directory, alongside the frozen configuration.
The entry point uses `joinSession` and `createCanvas` to register actions and a
loopback HTTP server with open/close lifecycle handling. Generation does not call
`create-canvas` or rewrite an SDK scaffold. It writes directly into the final
directory without staging-directory renames.
Newly generated entries wait for the SDK session join before initializing the
runtime or starting the local server, including when an open panel is restored.
A failed join rejects startup and the pending open. This fixes restoration ordering,
not Copilot's deliberate restart after repository-configuration approval; existing
generated apps are not automatically updated.
An existing target stops generation unless the Designer confirms a recognizable
same-handoff target and passes its prior request ID; confirmed regeneration
clears and rebuilds that directory in place, including manual edits, without
backup or rollback. New creation refuses any occupied destination, including an
empty directory. Failed generation removes its owned output so Generate can be
retried; failed regeneration does not restore the previous canvas. Cleanup
failures report the target path and error for inspection.
Designer saves settings before dispatching Generate, then restores editing
after the bounded submission. The entry point is written only after syntax
and render validation succeeds. Generate does not reload or open the canvas.
The separate Open command reloads and checks the exact project provider before
opening. Reload may disconnect Designer; the child-session chat reports the
outcome and can retry Open without regenerating. The user closes Designer
manually once the Open handoff is accepted.

Presets can replace an existing page template or append instructions that add
pages to the command. Adding a JSON file alone does not register a new page.

## Template taxonomy and schemas

Register each named Specify template as a complete replace-only layer (extension
defaults are implicitly replace-only). The kind belongs to the *registration*,
not the JSON document. No kind is inferred from a filename.

| Kind | Shape | JSON Schema |
| --- | --- | --- |
| `designer.tab-definition` | Required or added Designer tab | [tab](schemas/external-designer.tab-definition.schema.json) |
| `designer.setting-definition` | Field placed in a Designer tab slot | [setting](schemas/external-designer.setting-definition.schema.json) |
| `generated.workflow-page-definition` | Required generated Workflow page, adapter reference, and supported destinations | [Workflow page](schemas/external-generated.workflow-page-definition.schema.json) |
| `generated.workflow-page-adapter` | Replaceable whole Workflow-page `.mjs` presentation | Module contract below |
| `generated.field-placement` | Typed field in a declared generated page slot | [field placement](schemas/external-generated.field-placement.schema.json) |
| `generated.phase-control-definition` | Required phase identity, placement, adapter reference, and optional phase view labels | [phase control](schemas/external-generated.phase-control-definition.schema.json) |
| `generated.phase-control-adapter` | Workflow phase control `.mjs` presentation | Module contract below |
| `designer.badges-settings-definition` | Complete replaceable badge type list and default appearance, shared by Designer and generated canvases | [badges settings](schemas/external-designer.badges-settings-definition.schema.json) |
| `generated.badge-rule-definition` | Evidence inputs, badge text placeholders, and evaluator reference | [badge rule](schemas/external-generated.badge-rule-definition.schema.json) |
| `generated.badge-rule-adapter` | Self-contained `.mjs` evaluator | Module contract below |
| `generated.added-page-definition` | Generated-only page | [generated page](schemas/external-generated.added-page-definition.schema.json) |
| `generated.added-page-renderer` | Generated-only `.mjs` renderer | Module contract below |
| `shared.control-definition` | Shared typed control | [shared control](schemas/external-shared.control-definition.schema.json) |
| `designer.control-adapter` | Designer `.mjs` control adapter | Module contract below |
| `generated.control-adapter` | Generated `.mjs` control adapter | Module contract below |
| `generated.value-definition` | Generated constant or computed value | [generated value](schemas/external-generated.value-definition.schema.json) |
| `generated.computed-value-provider` | Generated `.mjs` provider | Module contract below |
| `generated.dialog-definition` | Named dialog content and decision labels | [dialog](schemas/external-generated.dialog-definition.schema.json) |
| `generated.dialog-adapter` | Generated `.mjs` dialog presentation | Module contract below |
| `generated.phase-dialog-binding` | Optional per-phase dialog reference | [phase binding](schemas/external-generated.phase-dialog-binding.schema.json) |
| `generated.button-control-definition` | Named button identity and adapter reference | [button control](schemas/external-generated.button-control-definition.schema.json) |
| `generated.button-adapter` | Generated `.mjs` button presentation | Module contract below |
| `generated.button-placement` | Setup or workflow button placement and action | [button placement](schemas/external-generated.button-placement.schema.json) |

Each JSON kind has a matching schema filename. The four required tabs are
identified by their registered names; added tabs use the same document shape.
These schemas describe document shapes, not the entire loader:
the loader additionally verifies template-name/ID equality where applicable,
cross-template references and slots, field collisions, schema-dependent constant
values, matching adapter exports, and runtime integrity. `$schema` is optional;
in extension-owned fixtures its relative path resolves to `schemas/`. Preset
fixtures intentionally omit `$schema`: after Specify installs the extension and
preset separately, a relative path between their package roots is not portable.
Use the kind-to-schema table above when editing preset JSON.

### Executable module contracts

Modules are self-contained UTF-8 `.mjs` replace-only templates. Register every
module under its own name as well as its referencing JSON template. The generated
app packages the winning generated-host modules; it does not load source presets
at runtime. Do not import another module from a renderer or provider.

The required `generated-workflow` page has `schemaVersion: 2`,
`id: "workflow"`, title, order, an `adapter` reference, supported
`badgeDestinations`, and named slots including `workflow.phases`. Its
registered page adapter uses `mount({ root, definition, state, actions })`
and returns `{ update, dispose }`. It renders the Workflow collection,
summary, setup, constitution, details, values, controls, and contribution
slots, composing the independently replaceable phase adapter. The host keeps
shared chrome, navigation to additional pages, persistence, and authorized
actions. Presets may replace both the Workflow page JSON and its adapter,
declare a subset of supported badge destinations, and add slots; unsupported
configured placements fail rather than disappearing. Existing generated apps
with the older page definition keep their original presentation.
When a configured badge targets the project Constitution card or output, the
Workflow-page adapter must begin with the literal line
`export const capabilities = ["workflow.badges.project.v1"];` and render
`state.model.badges.project` at those destinations. This first-line declaration
is checked as text at Generate and materialization; the browser adapter is
not executed in Node to inspect its exports. Declaring
`phase.card` or `phase.output` in `badgeDestinations` alone does not promise
project badge rendering. Designer Generate and frozen materialization reject
project placements when a replacement adapter lacks this capability; adapters
that do not render project badges should omit it.
The generated host validates this optional Workflow-page state before calling
the adapter's `update`: `badges.project` is an array of rendered badges with
string `id`, `text`, and `color`, optional strings `phaseText` and `category`, and a `showIn`
array. Each badge has either `targets` (nonempty array of `{ phase, output }`,
with string `phase` and `output` either a string path or `null` for a card)
or a legacy `phase` string with `phase-card` in `showIn`. Malformed project
badge results cause an incompatible Workflow-page state error rather than
being passed to a replacement adapter.
For Workflow list and summary results, optional `badges.items` maps item IDs to
arrays of badge objects, and optional `badges.summary` is an array of badge
objects. The host rejects malformed collections or non-string `category` values
before adapter updates; categories may be absent in older results.
The `generated-phase-control` definition places itself in
`workflow.phases`, has `schemaVersion: 1`, `id: "workflow-phases"`, an `adapter` name (stock:
`generated-phase-adapter`), and optional `viewLabels` keyed by selected phase ID,
for example `{ "plan": "View Plan" }`. Unspecified phases retain "View artifact".
The label does not change artifact availability or the host-owned view action.
Both stock and replacement adapters receive `definition` at mount time and must
apply it when the selected phase changes. Designer freezes those definitions,
and the adapter as integrity-checked assets.

Like Designer settings, separately registered generated field placements
target a page and one of its declared slots, identify a field and display
order, and reuse a stock control for scalar fields or a preset control for
object fields. Custom scalar controls are not supported. Added page renderers expose
`data-field-slot` mount points for declared field placements. Several
placements of one field share one value; independent fields can use the
same control adapter. Read-only is the default; an explicitly editable
constant typed value saves through the host's existing `/api/values` endpoint.
Computed values cannot be edited. Stock images are display-only packaged
assets, not runtime uploads. Fixed legacy brand/intro and details bindings
retain their current behavior.

The phase adapter exports `controlId = "workflow-phases"`,
`contractVersion = 1`, and `mount({ root, definition, state, actions })`, returning
`{ update(state), dispose() }`. It owns phase navigation and the selected-phase
card within `root`. `state` supplies the phase list, current index, workflow
identity, status, draft, output, other outputs, and sending status. The host
supplies `actions.select(index)`,
`actions.run(args)`, `actions.view(output?)`, `actions.reveal()`,
`actions.draft(value)`, and `actions.error(error)`. The first four request
host-validated operations; adapters do not call workflow endpoints directly.
The host owns dispatch safeguards, persistence, and artifacts; it never
reaches into the adapter's DOM. An adapter renders its own controls and updates
them in `update` when the host supplies new state.
The generated host displays failures beside the relevant workflow, phase,
dialog, or page rather than in dismissible notifications. When a declared
Markdown output does not exist yet, its link opens the nearest existing
directory inside the checkout instead of showing an empty viewer. This is
host/runtime behavior, not a phase data-contract requirement.
View artifact and the constitution view remain visible after a workflow
starts, even before output is found. When the artifact is missing, the host
opens the viewer with a "No output found yet" message, reveals the output
folder (or the project root when no output path is known), and refreshes.
Reveal is disabled only for unresolved `<slug>` paths. Generated canvases do
not run output inference; they use the outputs Designer passes in.
A minimal phase list:

The catalog-listed `copilot-vertical-phase-control` preset replaces the
`generated-phase-adapter` and `generated-phase-control` named templates.
Adapters may export `requiredCapabilities` as an array of unique capability
names; absent means no optional capabilities. For managed runs, the resolved
`generated-phase-control` JSON must additionally declare `"managedRun": true`.
Designer freezes that declaration with the definition's hash; the generated
server never imports the browser adapter to determine its privileges. The
browser rejects unknown requirements before calling `mount`. Currently
supported optional capabilities are:

| Requirement | Additional state and actions |
| --- | --- |
| `workflow.rows.v1` | `state.statuses` maps phase IDs to host-verified status, output, artifact availability and error. `actions.runAt(index)` submits the configured phase with its saved draft; `actions.viewAt(index)` opens its authorized artifact. Invalid indexes and unavailable artifacts fail visibly. |
| `workflow.managed-run.v1` | `state.autopilot` contains the session's persisted run status, target workflow ID, current step and progress message (or `null`). `actions.startManagedRun()` preflights and starts the attached Copilot session's ordered workflow; `actions.stopManagedRun()` cancels it from any open panel. Failures are reported through `actions.error` or the host's canvas message. The runtime verifies the packaged adapter's hash and the capability frozen from its phase-control definition before starting a run. |

When no Specify creation phase is configured, Autopilot can start the selected
unstarted workflow at its first configured phase. Configured phase order and
required directory/artifact reporting remain enforced. If a Specify creation
phase is configured but is not first, a new workflow is still rejected.

These actions are stable host operations, not preset-specific buttons. The
vertical adapter owns its entire layout, row selection and confirmation flow;
it does not call `/api` or the Copilot session directly. The host continues to
enforce conflicts, step order, artifact/path checks, cancellation, and
persistence even if the adapter omits a UI safeguard. Adding another adapter
that uses these capabilities needs no new host branch. A genuinely new
privileged operation requires a deliberate, versioned host capability rather
than an adapter reaching into private host code. The stock adapter declares
no optional capabilities, so its behavior remains unchanged. See the
[preset guide](../../spec-kit-presets/copilot-vertical-phase-control/README.md)
for local installation; the catalog download requires a published release.

```js
export const controlId = "workflow-phases";
export const contractVersion = 1;
export function mount({ root, definition, state, actions }) {
  const list = document.createElement("ol");
  root.replaceChildren(list);
  const update = ({ phases, current }) => {
    list.replaceChildren(...phases.map((phase, index) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = phase.label;
      button.setAttribute("aria-current", current === index ? "step" : "false");
      button.onclick = () => Promise.resolve(actions.select(index)).catch(actions.error);
      item.append(button);
      return item;
    }));
  };
  update(state);
  return { update, dispose() { root.replaceChildren(); } };
}
```

The snippet illustrates the lifecycle only; a working replacement also renders
the phase card and actions. See
[`generated-phase-adapter`](generated-host/phase-control/generated-phase-adapter.mjs)
for the complete stock implementation. Module imports are not packaged.

`generated.added-page-renderer` exports
`renderPage({ root, canvas, values })`. `root` is the owned DOM element;
`canvas` contains frozen canvas configuration, and `values` contains only
explicitly declared value IDs from the page definition. Asset bindings need a
matching `<div data-asset-slot="hero.logo"></div>` in the renderer:

```js
export function renderPage({ root, canvas, values }) {
  const heading = document.createElement("h2");
  heading.textContent = `${canvas.displayName}: ${values["demo.heading"] ?? ""}`;
  root.replaceChildren(heading);
}
```

Each registered control adapter exports a `controlId` string matching the control definition
`id` and a `valueContract` object matching its `value`. A Designer adapter also
exports a pure, synchronous `validate(value, field): boolean` and
`mount({ root, field, value, onChange })`, returning `{ isReady(): boolean }`.
`field.validation` is the resolved field's canonical rule object: string fields
receive `type`, `maxLength`, and optional `minLength`, `required`, `pattern`, and
`forbiddenValues`; object fields receive `type` and `properties`; image fields
receive `type`, `maxBytes`, and `mimeTypes`. Canvas ID includes its reserved
IDs in `forbiddenValues`. The Designer derives these rules from approved fields,
not request bodies. A shared adapter checks the rules, not specific field IDs.
The validator must not access browser globals or return a Promise: Generate
executes the approved, hash-checked module in local Node. A false result shows
the host's field-ID-and-label error; thrown errors are reported separately.
Save stores bounded, mountable drafts without invoking `validate`, including
incomplete values; Generate validates the values it freezes. The generator
independently checks its output identity, paths, and frozen request, but cannot
prove every custom adapter's semantics if a replacement ignores its rules.

### Reducing customization breakage

Preset adapters can break if they depend on the Designer's internal layout,
CSS, or validation logic when those internals change. The Designer creates a
separate, initially empty `<div>` for each control and passes it as `root`.
Adapters must not query, modify, or style elements outside that div, or rely on
the surrounding page's CSS. This is a compatibility contract, not JavaScript
isolation; approved adapter modules are trusted code.

The adapter owns how its control works. On an edit, it calls `onChange(value)`
to give the Designer a new unsaved draft value without remounting. It does not
need to know how the Designer stores drafts, switches tabs, or saves settings.
It returns an `isReady()` handle to report unfinished work and exports
`validate(value, field)` to check whether its value is acceptable. The Designer
calls these functions without depending on the adapter's UI or internal
validation logic. An image adapter keeps readiness false during upload and
after failure until retry or explicit cancellation; it owns decoding, upload
progress, and errors.

Save can retain unfinished work. The browser checks `isReady()` before Save or
Generate across visited tabs, but always allows switching tabs so a broken
control cannot trap the user. Returning to a tab retains its control state so
an unfinished upload can be retried or cancelled.
The server invokes the approved adapter's
validator on the values it will freeze before creating a canvas. Keeping these
responsibilities behind a small, documented contract lets the Designer evolve
without requiring presets to follow changes to its internals. There is no
public Designer `context` or readiness callback.

Generated adapters have a separate contract: they receive
`{ root, field, value, context }`, with generated-only presentation information
such as `alt` and `className`.
`stock.checkbox` has only a Designer adapter; generated presentation is
required for image, text and object controls. A minimal pair
for a control with `{type:"object",properties:{level:["low","high"]}}`:

```js
export const controlId = "rating";
export const valueContract = { type: "object", properties: { level: ["low", "high"] } };
export function validate(value, field) {
  return field.validation.type === "object"
    && value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).join() === "level"
    && field.validation.properties.level.includes(value.level);
}
export function mount({ root, field, value, onChange }) {
  const select = document.createElement("select");
  for (const level of valueContract.properties.level) {
    const option = document.createElement("option");
    option.value = option.textContent = level;
    select.append(option);
  }
  select.value = value?.level ?? "low";
  select.setAttribute("aria-label", field.label);
  select.onchange = () => onChange({ level: select.value });
  root.replaceChildren(select);
  return { isReady: () => true };
}
```

```js
export const controlId = "rating";
export const valueContract = { type: "object", properties: { level: ["low", "high"] } };
export function mount({ root, field, value }) {
  const output = document.createElement("span");
  output.textContent = `${field.label}: ${value.level}`;
  root.replaceChildren(output);
}
```

`generated.computed-value-provider` exports a *direct*
`export function provideValue({ workflow })` or
`export const provideValue = ({ workflow }) => ...`. It must return a
synchronous value matching the declared schema. `workflow` is the selected
existing workflow; no selected workflow means the provider cannot run.

```js
export function provideValue({ workflow }) {
  return workflow.label;
}
```

Designer parses but never runs provider code. Generate requires explicit
confirmation of its resolved name, provenance and hash; approved code is trusted
with the local user's privileges. Providers have a shared three-second refresh
budget; `node:vm` and hash checking do not sandbox malicious approved code.

## License

MIT
