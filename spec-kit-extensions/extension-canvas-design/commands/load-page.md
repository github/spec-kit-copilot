---
description: Resolve registered Canvas Design templates and open the Designer once.
---

## Context

Work in this session's project, not the Wizard's checkout. For a request to
**reopen Designer in this same session**, use the `Session folder:` path from
this session's context to check for
`speckit-canvas-designer/last-open.json`. If it is missing, stop and explain
that this session cannot restore Designer; launch Designer again from the
Wizard. Do not ask the user for a handoff ID, scan other sessions, or open the
sample preview. If the file exists, let the provider validate it: open the
official `plugin:spec-kit-copilot-wizard:speckit-canvas-designer` canvas once
with `instanceId:"designer-reopen"` and `input:{}`. Report a provider error
unchanged; do not fall back to a blank shell or preview. Reopening does not
run the template-resolution steps below.

For a **first launch**, `$ARGUMENTS` supplies the Wizard `handoffId` and the
steps below resolve its complete template inventory. If it is missing, stop
and direct the user to launch Designer from the Wizard; never request an
internal handoff ID from the user or guess one from local files.

## Pages

Load these default pages:

- Essentials (`designer-essentials`)
- `designer-badges`
- `designer-appearance`

Use **Essentials** in progress messages and other user-facing descriptions of
the first page. `designer-essentials` is its template ID for
the artifact inventory and the Designer page input; do not rename the ID.

Presets may add pages in sections titled **Additional Designer pages** anywhere
in this command, including after the Steps. These additions extend the default
set; they do not run a second load operation.

The extension may list stock-field contribution JSON under **Canvas Design
templates**. Presets may list these and generated-host pages and modules under
**Additional Canvas Design templates** anywhere in this composed command.
Each registration declares its Canvas Design kind (`designer.badges-settings-definition`,
`generated.badge-rule-definition`, `generated.badge-rule-adapter`,
`designer.badge-input-control`, `designer.badge-input-binding`, `designer.badge-input-adapter`,
`designer.setting-definition`,
`generated.workflow-page-definition`, `generated.workflow-page-adapter`,
`generated.phase-control-definition`,
`generated.phase-control-adapter`,
`generated.field-placement`,
`generated.added-page-definition`, `generated.added-page-renderer`,
`generated.dialog-definition`, `generated.dialog-adapter`,
`generated.phase-dialog-binding`, `generated.button-control-definition`,
`generated.button-adapter`, `generated.button-placement`,
`shared.control-definition`, `designer.control-adapter`, `generated.control-adapter`,
`generated.value-definition`, or `generated.computed-value-provider`) and strategy
(`replace`). A `designer.setting-definition` can also
register `stock.image` assets, bound to the generated `header.brand` or
`workflow.intro` slot, or to a named slot on a registered generated
page via `generatedBinding.page` and `.slot`. Each slot holds one independent
image; the generated page renderer places a `data-asset-slot` element where
the image belongs. The `stock.image` control definition and its paired
Designer/generated adapters must be resolved alongside any image field.
Generate packages the frozen image and winning generated adapter into the
generated app; it never loads Specify at runtime.
All Designer tabs have kind `designer.tab-definition` and strategy `replace`
(implicit for the extension's default tabs). Tabs are identified by their
registered names, not by a separate kind. A preset may replace this command
with fewer or no pages; Designer still opens and shows the resolved pages or
an empty state. Missing generated-canvas dependencies prevent Generate, not
Designer launch. Missing explicitly declared names still stop resolution.
An omitted page slot, field control, host adapter, generated field placement
dependency, or generated-page renderer is reported in Designer while healthy
pages remain editable. Conflicting registrations and invalid or unsafe assets
still stop loading.
A name must be a Specify template
in the manifest. The `canvas-design` tag and files on disk do not register
themselves. Control definitions, host-specific adapters, value definitions,
and computed-value modules must each be explicitly registered. `generated.value-definition`
declares a typed constant or a workflow-scoped computed value; a generated page
declares the value IDs it consumes in its `values` list. A processing-only value
is not automatically presented and is not secret from its declared consumers.
Computed-value providers are packaged, never evaluated by Designer.
The required `generated-workflow` page declares `workflow.phases` first, names a
replaceable `generated.workflow-page-adapter`, and advertises supported badge
destinations (`workflow.list`, `workflow.summary`, `phase.card`, `phase.output`).
The page adapter mounts with `{ root, definition, state, actions }` and returns
`{ update, dispose }`; its state snapshots are read-only, while all actions
are authorized and validated by the host. Presets replacing the adapter may
advertise only the badge destinations they actually render. Generation rejects
badge placements the selected adapter does not support. Legacy generated
copies keep their original Workflow presentation.
The
`generated-phase-control` definition places itself in that slot and references
its registered adapter by name and may set `viewLabels` for selected
non-Constitution phase IDs
(for example, `"plan": "View Plan"`); the generated host passes those labels
to the selected adapter without changing its view action. Each field placement
JSON `id` equals its registered template name. Presets may replace the Workflow
page to add slots or add
pages with declared slots. `generated.field-placement` targets a declared slot
and references a Designer setting field or a generated value ID; its `order`
orders fields in that slot. Object values require an explicit `control` in their placement, naming a
compatible shared control with a generated adapter. Scalar placements may name
a compatible shared control or infer the stock text/checkbox control from their
typed source; image placements use `stock.image` when no control is declared.
Designer setting placements cannot override their field's control. Image asset
bindings retain their separate slots; a field placement cannot occupy one.

Named `generated.dialog-definition` JSON references a registered
`generated.dialog-adapter` module (`mount`, `contractVersion` exports). It
contains only bounded heading, paragraph, warning, list, HTTPS link, and
`pending-packages`/`phase` dynamic slot blocks, plus `buttons.cancel` and
`buttons.confirm` labels.
The setup dialog must expose the complete current package inventory through
`pending-packages`; its adapter returns `confirmed` or `cancelled` (including
close, Escape and backdrop). An optional `generated.phase-dialog-binding`
names exactly one selected `speckit.<phase>` and registered dialog; without
one, phases run directly.

The `generated-setup-button-control` references its registered
`generated.button-adapter`; the setup placement uses `project.setup-button`. The dialog
adapter exports `dialogId = "stock.dialog"`, `contractVersion = 1`, and
`mount({ root, definition, context, onDecision })`; the setup button adapter exports
`controlId = "project.setup-button"`, `contractVersion = 1`, and
`mount({ root, definition, onSetup })`. Both return an object with `dispose`.
The base
`generated-setup-button` placement targets the setup-only `setup.actions`
slot and always invokes `project.setup`, even when a preset replaces its
label, presentation or dialog. Other named `generated.button-placement`
templates can target `workflow.actions` with `dialog.result` and the `dialog.trigger`
control only: its separate adapter mounts with `onTrigger`, opening a registered
dialog and reporting confirmation locally without dispatching a phase or CLI
command. The stock Workflow page declares `workflow.actions` alongside
`workflow.phases`, so the optional button does not replace the page or its
phase adapter. Every executable module must be self-contained and registered;
unregistered files are not loaded.

## Canvas Design templates

- `designer-essentials-description` — `designer.setting-definition`, `replace`
- `designer-essentials-workflow-heading` — `designer.setting-definition`, `replace`
- `designer-essentials-workflow-item-name` — `designer.setting-definition`, `replace`
- `designer-essentials-custom-slug` — `designer.setting-definition`, `replace`
- `designer-essentials-show-setup` — `designer.setting-definition`, `replace`
- `designer-essentials-header-logo` — `designer.setting-definition`, `replace`
- `designer-essentials-main-page-logo` — `designer.setting-definition`, `replace`
- `designer-appearance-light-accent` — `designer.setting-definition`, `replace`
- `designer-appearance-light-background` — `designer.setting-definition`, `replace`
- `designer-appearance-light-surface` — `designer.setting-definition`, `replace`
- `designer-appearance-light-secondary` — `designer.setting-definition`, `replace`
- `designer-appearance-light-text` — `designer.setting-definition`, `replace`
- `designer-appearance-dark-accent` — `designer.setting-definition`, `replace`
- `designer-appearance-dark-background` — `designer.setting-definition`, `replace`
- `designer-appearance-dark-surface` — `designer.setting-definition`, `replace`
- `designer-appearance-dark-secondary` — `designer.setting-definition`, `replace`
- `designer-appearance-dark-text` — `designer.setting-definition`, `replace`
- `generated-workflow` — `generated.workflow-page-definition`, `replace`
- `generated-workflow-page-adapter` — `generated.workflow-page-adapter`, `replace`
- `generated-phase-control` — `generated.phase-control-definition`, `replace`
- `generated-phase-adapter` — `generated.phase-control-adapter`, `replace`
- `generated-setup-dialog` — `generated.dialog-definition`, `replace`
- `generated-dialog-adapter` — `generated.dialog-adapter`, `replace`
- `generated-setup-button-control` — `generated.button-control-definition`, `replace`
- `generated-setup-button-adapter` — `generated.button-adapter`, `replace`
- `generated-setup-button` — `generated.button-placement`, `replace`
- `badges-settings` — `designer.badges-settings-definition`, `replace`
- `badge-rule-value-match` — `generated.badge-rule-definition`, `replace`
- `badge-rule-artifact-current` — `generated.badge-rule-definition`, `replace`
- `badge-rule-markdown-file-count` — `generated.badge-rule-definition`, `replace`
- `badge-rule-checklist-progress` — `generated.badge-rule-definition`, `replace`
- `badge-rule-checklist-complete` — `generated.badge-rule-definition`, `replace`
- `badge-rule-phase-run-complete` — `generated.badge-rule-definition`, `replace`
- `badge-rule-phase-artifact-complete` — `generated.badge-rule-definition`, `replace`
- `badge-rule-artifact-stale` — `generated.badge-rule-definition`, `replace`
- `badge-rule-content-adapter` — `generated.badge-rule-adapter`, `replace`
- `badge-rule-artifact-state-adapter` — `generated.badge-rule-adapter`, `replace`
- `badge-rule-ordered-stale-adapter` — `generated.badge-rule-adapter`, `replace`
- `badge-rule-run-adapter` — `generated.badge-rule-adapter`, `replace`
- `badge-rule-phase-artifact-complete-adapter` — `generated.badge-rule-adapter`, `replace`
- `designer-badge-input-stock` — `designer.badge-input-control`, `replace`
- `designer-badge-input-stock-adapter` — `designer.badge-input-adapter`, `replace`
- `designer-badge-input-value-match` — `designer.badge-input-control`, `replace`
- `designer-badge-input-value-match-adapter` — `designer.badge-input-adapter`, `replace`
- `designer-badge-input-checklist` — `designer.badge-input-control`, `replace`
- `designer-badge-input-checklist-adapter` — `designer.badge-input-adapter`, `replace`
- `designer-badge-input-phase-artifact` — `designer.badge-input-control`, `replace`
- `designer-badge-input-phase-artifact-adapter` — `designer.badge-input-adapter`, `replace`
- `designer-badge-input-ordered-stale` — `designer.badge-input-control`, `replace`
- `designer-badge-input-ordered-stale-adapter` — `designer.badge-input-adapter`, `replace`
- `designer-badge-binding-value-match` — `designer.badge-input-binding`, `replace`
- `designer-badge-binding-artifact-current` — `designer.badge-input-binding`, `replace`
- `designer-badge-binding-artifact-stale` — `designer.badge-input-binding`, `replace`
- `designer-badge-binding-markdown-file-count` — `designer.badge-input-binding`, `replace`
- `designer-badge-binding-checklist-progress` — `designer.badge-input-binding`, `replace`
- `designer-badge-binding-checklist-complete` — `designer.badge-input-binding`, `replace`
- `designer-badge-binding-phase-run-complete` — `designer.badge-input-binding`, `replace`
- `designer-badge-binding-phase-artifact-complete` — `designer.badge-input-binding`, `replace`
- `shared-controls-image` — `shared.control-definition`, `replace`
- `designer-control-adapter-image` — `designer.control-adapter`, `replace`
- `generated-control-adapter-image` — `generated.control-adapter`, `replace`
- `shared-controls-text` — `shared.control-definition`, `replace`
- `designer-control-adapter-text` — `designer.control-adapter`, `replace`
- `generated-control-adapter-text` — `generated.control-adapter`, `replace`
- `shared-controls-checkbox` — `shared.control-definition`, `replace`
- `designer-control-adapter-checkbox` — `designer.control-adapter`, `replace`

## Steps

After installation and one successful skill reload, run
`node .specify/extensions/extension-canvas-design/scripts/verify-launch.mjs
<child-checkout>` once from the child project root. It reads this **generated**
composed skill, checks all declarations and performs the read-only resolution,
replace-only stack and script-collision checks in steps 1-3. Use its complete
`pages` and `templates` JSON for step 4; stop on a nonzero exit or an
unresolved declared name. Do not repeat those CLI checks or open twice. Older compatible
hosted packages without this verifier must perform steps 1-3 manually.

1. Read this entire composed command first. Collect the defaults and every name
   in every **Additional Designer pages**, **Canvas Design templates**, and
   **Additional Canvas Design templates** section, removing duplicates.
   Record each declaration's kind and strategy. Conflicting kinds/strategies
   for a name are an error. Names must start with a lowercase letter and contain only lowercase letters,
   digits and hyphens (at most 80 characters). Keep pages separate from
   non-page templates; a name in both groups is an error.
2. Run `specify artifact list --json` once from the project root after reading
   this composed skill. Use Specify CLI >=1.0.7. Match each registered name
   against its exact `template:<name>` artifact ID; do not scan `.specify`,
   reconstruct precedence, or substitute an extension default. Derive the
   winning file from the single active stack layer's `sourcePath`, relative to
   the project root, and validate that it resolves to a readable file inside
   the project's `.specify` directory.
3. Inspect the inventory, stderr, and exit status. Stop on warnings, invalid
   or duplicate metadata, missing/ambiguous names or winners, and command
   errors, even when exit status is zero. Require every layer in each
   registered **template** stack to have `strategy: replace` (extension
   templates replace implicitly). Reject a native `script:<name>` entry for
   an executable asset; reject `append`, `prepend`, or `wrap` asset stacks.
   The composed **load-page command** itself may contain appended preset
   layers; those additions are why this generated skill must be read in full.
   Do not require replace-only composition for that command. Appended
   instructions in the command are allowed; composing multiple complete JSON
   documents or appending executable JavaScript is not.
4. Only after every name resolves, open the official installed Copilot provider
   exactly once with the complete collected set:
   `open_canvas({canvasId:"speckit-canvas-designer",
   extensionId:"plugin:spec-kit-copilot-wizard:speckit-canvas-designer",
   instanceId:"designer-<handoffId>",input:{handoffId:"<handoffId>",
   pages:[{"name":"<default-page-name>","path":"<resolved-path>","kind":"designer.tab-definition","strategy":"replace"},
          {"name":"<additional-page-name>","path":"<resolved-path>","kind":"designer.tab-definition","strategy":"replace"},...],
   templates:[{"name":"<asset-name>","path":"<resolved-path>","sourceId":"<Specify-reported-source-ID>","kind":"<declared-kind>","strategy":"replace"},...]}})`.
   Obtain each `sourceId` from the active layer's `layer` and `sourceId`:
   map the project layer to `project`, retain a preset ID as-is, and prefix
   an extension ID with `extension:`. Stop on missing or invalid source
   metadata; do not infer the source from the file path. Use
   an empty `templates` array if none are registered. Submit all defaults,
   additional pages, and registered templates in this single call. The provider
   validates the handoff and complete inventory before returning a URL. A
   resolved page with invalid JSON in a readable file appears as an error tab
   with its path and reason; other pages remain available. A missing or unreadable
   winning file prevents opening. Malformed, safely
   readable non-page files show a named composition error; invalid registrations
   and unsupported dependencies stop the open with an actionable error. Generated
   pages require a matching registered renderer and do not create Designer tabs. Do not
   substitute another provider or open if resolution failed.
   Confirm the `open_canvas` result matches the requested canvas ID, plugin
   extension ID, instance ID and `input.handoffId`; report a mismatch as a failure.
   A successful open means only that the shell is available, not that every
   page loaded or that generation is ready. Designer shows page-load errors to
   the user; do not use Playwright or inspect tabs after opening.

If resolution fails before step 4, report the CLI error/output and stop without
opening Designer. If opening fails, report the error unchanged; do not run a
Python helper or write the provider's state files yourself. Do not invoke a
page-loading action, manually reload, or re-resolve pages on tab changes.
