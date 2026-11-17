# External customization contracts

`external-` identifies a contract consumed by preset/extension authors: definition
shapes, executable exports, arguments, callbacks, results, capabilities, and
lifecycle. It does not identify every file containing contributor data.

The filenames classify and isolate the existing interfaces; they do not change
contribution IDs, artifact kinds, template names, versions, validation, behavior,
or customization points. There are no old-path aliases. Contributor modules
remain self-contained and do not import these host-owned contracts.

## Locations and ownership

The following abbreviations keep the index readable:

- **D**: `plugins/spec-kit-copilot-wizard/extensions/speckit-canvas-designer/`.
- **R**: this package's `generated-scaffold/`.
- **S**: this package's `schemas/`.
- **DT**: `D/test/`.
- **RT**: `spec-kit-extensions/tests/`.
- **E2E**: `tests/e2e/`.

Designer contracts ship with the Copilot Wizard plugin, independently of this
Specify extension. Generated contracts are copied and syntax-checked through
`scripts/generate.mjs`'s `featureFiles` inventory. The finished app does not need
the original design package or presets.

Hosts retain rendering mount-point selection, navigation, persistence,
session/workflow operations, artifact access, action checks, execution,
confinement, integrity, and diagnostics. Adapters retain DOM rendering, events,
and interaction wiring, including composite controls. The contracts contain the
existing boundary checks; they do not dispatch actions or run contributed code.
Provider script construction describes execution, but execution stays in the
runtime's worker/VM.

## Definition and executable index

All schema names below are relative to **S**. Executable checks may intentionally
differ between inspection, generation, and live mounting. Do not substitute one
host's checks for another's.

| Family / host | Definition schema | Executable contract | Consuming implementation | Relevant tests |
| --- | --- | --- | --- | --- |
| Registration/composition / both | The appropriate schema below; no new registration schema | `D/contracts/external-design-contributions.mjs`, `external-definitions.mjs`, `external-executable-modules.mjs` | `D/pages.mjs`; Wizard `server/designer-setup.mjs`; `scripts/verify-launch.mjs` still resolves Specify inventory | `DT/provider.test.mjs`, `external-executable-modules.test.mjs`; `RT/canvas_launch.test.mjs`, `test_canvas_design.py`; `E2E/contracts.spec.mjs`, preset journeys |
| Designer tabs/settings / Designer | `external-designer.tab-definition.schema.json`, `external-designer.setting-definition.schema.json` | `D/contracts/external-design-contributions.mjs`, `external-definitions.mjs`; `D/external-designer-contract.json` records supported tab schema versions | `D/pages.mjs`; Wizard setup, launch and local-source checks | `DT/contracts.test.mjs`, `provider.test.mjs`; Wizard `test/designer-setup.test.mjs`, `designer-local-sources.test.mjs`; `E2E/preset-designer.spec.mjs`, `designer-pages.spec.mjs` |
| Shared typed controls / both | `external-shared.control-definition.schema.json` | `D/external-control-contract.mjs`, `D/contracts/external-control-adapter.mjs`, `D/ui/external-control-adapter-contract.js`; `R/external-control-contract.mjs`, `R/contracts/external-generated-controls.mjs` | `D/pages.mjs`, `generation.mjs`, `ui/app.js`; `scripts/generate.mjs`; `R/ui/app.js`, `ui/page-assets.mjs` | `DT/external-controls.test.mjs`, `provider.test.mjs`; `RT/control_contract.test.mjs`, `external_contracts.test.mjs`, image/text/slot tests; `E2E/preset-generated.spec.mjs` |
| Badge types/settings / Designer | `external-designer.badges-settings-definition.schema.json` | `D/contracts/external-badge-definitions.mjs`, `external-badges.mjs` | `D/pages.mjs`, `settings.mjs`, `generation.mjs`, `ui/badges-control.js` | `DT/badges.test.mjs`, `badges-control.test.mjs`, `provider.test.mjs`; `E2E/designer-pages.spec.mjs` |
| Generated badge import / Designer fixed shell only | Existing generated `canvas-config.json` envelope; no generated-format change | `D/contracts/badge-import.mjs`; `D/ui/badge-import-contract.js` | `D/server.mjs`, `ui/app.js`, `ui/badges-control.js`; append-only draft validation, never evaluator execution | `DT/badge-import.test.mjs`, `badges-control.test.mjs`, actual generator/import/Save/regeneration in `provider.test.mjs`; `E2E/designer-pages.spec.mjs` |
| Badge input editors / Designer | `external-designer.badge-input-control.schema.json`, `external-designer.badge-input-binding.schema.json` | `D/contracts/external-badge-input-control.mjs`, `external-executable-modules.mjs`; `D/ui/external-control-adapter-contract.js` | `D/pages.mjs`, `ui/app.js`, `ui/badges-control.js` | `DT/badge-input-control.test.mjs`, `badges-control.test.mjs`, `external-controls.test.mjs`, `provider.test.mjs`; Badge Input fixture journey |
| Badge rules/evaluators / both definitions, generated execution | `external-generated.badge-rule-definition.schema.json` | `D/contracts/external-badge-definitions.mjs`, `external-executable-modules.mjs`; `R/contracts/external-badge-evaluator.mjs` | `D/pages.mjs`; `R/badge-runtime.mjs` | `RT/badge_adapters.test.mjs`, `generated_badges.test.mjs`, `ordered_badge_generation.test.mjs`, `external_contracts.test.mjs`; `DT/provider.test.mjs`; Badge Input fixture journey |
| Workflow page / generated | `external-generated.workflow-page-definition.schema.json` | `D/contracts/external-definitions.mjs`, `external-executable-modules.mjs`; `R/contracts/external-host-adapter.mjs` | `D/pages.mjs`; `R/ui/app.js` | `RT/workflow_page_adapter.test.mjs`, `external_contracts.test.mjs`, `canvas_generation.test.mjs`; `E2E/generated-slug.spec.mjs` |
| Phase control / generated | `external-generated.phase-control-definition.schema.json` | `D/contracts/external-definitions.mjs`, `external-executable-modules.mjs`; `R/contracts/external-host-adapter.mjs` | `D/pages.mjs`; `R/ui/app.js` | `RT/phase_control_lifecycle.test.mjs`, `vertical_phase_adapter.test.mjs`, `vertical_autopilot.test.mjs`; `E2E/generated-slug.spec.mjs` |
| Added pages/renderers / generated | `external-generated.added-page-definition.schema.json` | `D/contracts/external-definitions.mjs`, `external-executable-modules.mjs`; `R/contracts/external-generated-controls.mjs` | `D/pages.mjs`; `R/ui/app.js` | `DT/provider.test.mjs`; `RT/generated_slot_ui.test.mjs`, `external_contracts.test.mjs`; Generated Page and Logo Gallery fixture journeys |
| Field placements / generated | `external-generated.field-placement.schema.json` | `D/contracts/external-definitions.mjs`; `R/contracts/external-generated-controls.mjs` | `D/pages.mjs`; `R/ui/app.js`, `ui/page-assets.mjs` retain DOM slot checks | `RT/generated_slot_ui.test.mjs`, `canvas_image_generation.test.mjs`; Values, Risk Matrix and Logo Gallery fixture journeys |
| Values/providers / Designer definitions, generated execution | `external-generated.value-definition.schema.json` | `D/contracts/external-definitions.mjs`, `external-executable-modules.mjs`; `R/contracts/external-value-provider.mjs` | `D/pages.mjs`; `R/runtime.mjs`; `R/contract.mjs` retains internal generated field inventory checks and imports typed value validation | `DT/provider.test.mjs`; `RT/external_contracts.test.mjs`, `canvas_generation.test.mjs`; Values fixture journey |
| Dialogs / generated | `external-generated.dialog-definition.schema.json` | `D/contracts/external-definitions.mjs`, `external-executable-modules.mjs`; `R/contracts/external-dialog-button.mjs` | `D/pages.mjs`; `scripts/generate.mjs`; `R/ui/app.js` | `DT/dialog-contracts.test.mjs`, `provider.test.mjs`; `RT/generated_dialog.test.mjs`, `external_contracts.test.mjs`; Dialog Buttons fixture journey |
| Phase dialog bindings / generated | `external-generated.phase-dialog-binding.schema.json` | `D/contracts/external-definitions.mjs`; dialog adapter checks above | `D/pages.mjs`; `R/ui/app.js` | `DT/dialog-contracts.test.mjs`; `RT/generated_dialog.test.mjs`; Dialog Buttons fixture journey |
| Buttons/placements / generated | `external-generated.button-control-definition.schema.json`, `external-generated.button-placement.schema.json` | `D/contracts/external-definitions.mjs`, `external-executable-modules.mjs`; `R/contracts/external-dialog-button.mjs` | `D/pages.mjs`; `scripts/generate.mjs`; `R/ui/app.js` | `RT/setup_button_control.test.mjs`, `generated_dialog.test.mjs`, `external_contracts.test.mjs`; Dialog Buttons fixture journey |

The test-preset journeys are mapped to their fixture IDs and last observable
surface in [the E2E README](../../tests/e2e/README.md). Python package tests validate
the shipping file inventory, all definition schemas, and fixture registrations.

## Registration and inspection

Executable contributions are named Specify **templates**, not native script
registrations. Existing replace-only winner, source, ownership, reference,
collision, and slot rules apply. The composed `load-page` command explicitly
names contributed tabs and templates; discovery tags do not register them.

`external-executable-modules.mjs` checks the required export names below from
lexer results. The loader still parses source and syntax-checks it separately.
Executable modules retain their 32 KiB limit and self-contained requirement.
Inspection does not import browser adapters or execute providers to test them.
Badge input identity/version literals retain their separate static checks.
Runtime checks, including actual export values and mandatory handles, happen at
the same boundaries as before.

## Exports, calls, and lifecycle

### Designer controls and badge editors

**Badge import** is a fixed Designer Badges shell operation, not a customizable
badge-input control. This single-host exception intentionally has no contribution
definition/adapter template pair or generated-host renderer. The host checks a
complete generated configuration's badge definitions against the resolved model
and evaluator hashes, then validates the entire combined draft using the existing
Save validator. The UI appends every instance or none; it never imports types,
rules or code, persists settings, supplies missing required fields, or migrates
legacy formats. See the [Designer import contract and limits](../../plugins/spec-kit-copilot-wizard/extensions/speckit-canvas-designer/README.md#importing-badges).
Future badge-format changes must update the import contract, validation,
documentation and real generator round-trip tests together.

Designer controls export `controlId`, `valueContract`, `mount`, and `validate`.
The declared value agrees with the definition; Node-side typed-control checks
and browser scalar/image/object checks retain their existing distinctions.
The host calls:

```js
mount({ root, field, value, onChange, ...imageContext })
```

Only images receive `context: { setBusy }`. `onChange(value)` retains structural
value checks, updates the draft, and triggers the existing Save/Generate state
updates. `mount` is synchronous here. Its handle must expose `isReady`;
readiness must return literal `true`, not a promise or another truthy value.
This does not impose generated-control lifecycle requirements on Designer
controls.

Badge editors export `controlId`, `contractVersion = 1`, and `mount`. The host
supplies `{ root, rule, inputs, phases, outputs, onChange }`. The badge editor
receives the existing cloned rule/input/evidence context. `onChange(nextInputs)`
requires exactly the rule's declared inputs, safe JSON data, and compatible
draft evidence. Old-render callbacks remain ignored. The captured `isReady`
method is called with the control as its receiver and must return literal
`true` before saving. Existing unavailable-control diagnostics, optional
`validationError`, optional `dispose`, and disposal/readiness failure handling
remain in the editor.

A rule can declare at most one `badge-selection` input. Its value is an ordered
array of 1–100 entries `{ id, value, color }` plus placement text, with
unique stable IDs. `value` is the literal **Text to find**. Each entry carries
`text` (Workflow list), `phaseText` (Phase card) and `summaryText`
(Workflow summary) exactly when the badge selects that placement; text for an
unselected placement must be absent. Search values are nonblank literal strings
of at most 256 characters; placement texts are nonblank, at most 120
characters, and contain no placeholders.
The shape is documented by
`schemas/external-badge-selection.schema.json`; runtime validation additionally
requires unique entry IDs and the placement rule. Colors use the standard badge palette
or a six-digit hex value. Inputs and entry fields are validated at save, freeze,
generation and generated-runtime boundaries. The host gives a selection
editor a separate `selectionRoot` and `placements` object with boolean
`summary`, `workflow`, and `phase` keys. Its handle must implement
`updatePlacements(placements)` and emit entries whose placement text matches
the new placements. It owns the entry rendering and interaction;
the host owns the shared placements and rejects invalid changes or handles.

Every badge instance has a required `category`: a nonblank user-entered name
of at most 80 characters without control characters or angle brackets.
Rendered workflow-list and summary badges carry `category`; hosts group
badges whose categories match case-insensitively into one labeled bracket,
ordered by first appearance. Phase cards do not show category labels.
Instances of rules without a `badge-selection` input carry `text`,
`phaseText` and `summaryText` exactly for their selected Workflow list,
Phase and Workflow summary placements; selection-rule instances carry no
instance text. Workflow and phase text may use the rule's declared
placeholders. Summary text allows no placeholders and renders as `text: N`
using the aggregate count, including zero. There is no fallback between
placement texts.

Badge controls with the `declare-markdown-output` capability must export the
literal `declaresMarkdownOutput = true` and return a handle with
`handlesOutputDeclaration = true`. Only those controls receive
`onDeclareFile(phase, path)` at mount; the host validates and records a new
expected Markdown output without changing the inferred View target.
Missing or incompatible declarations and handles fail before that action is
available. Controls without the capability never receive the callback.

### Workflow and phase adapters

Workflow adapters export `pageId = "workflow"`, `contractVersion = 1`, and
`mount`. They receive `{ root, definition, state, actions }`; their mount may
be asynchronous. Their handle must provide `update(state)` and `dispose()`.
State validation includes the existing `phaseState.slugEditable`,
`model.userProvidesSlug` agreement, and project badge result rules.

`definition.canvas.workflowItemName` is the singular presentation name used
for item labels. The generated host sends a trimmed, nonblank string of at most
80 characters without control characters; an absent field in a legacy
configuration or adapter exchange means `Workflow`. Invalid supplied values
are rejected, not replaced. Designer accepts an optional blank value and freezes
it as `Workflow`. `canvas.workflowListName` remains the independent header
value; neither field changes workflow IDs, directories, or actions. The
stock page adapter is self-contained and implements the same checks as the
source-owned host contract.

Workflow actions remain `selectWorkflow`, `createWorkflow`, `deleteWorkflow`,
`selectPhase`, `run`, `view`, `saveDraft`, `runConstitution`, `viewConstitution`,
`constitutionDraft`, `saveValue`, `setIdentity`, `setConstitutionDraft`,
`touchSlug`, `confirmSetup`, `clearSetupPlan`, `mountPhase`, `showDialog`, and
`error`. Their existing arguments, return values, and guards are implemented
by `R/ui/app.js`; this refactor adds no actions.

Phase adapters export `controlId = "workflow-phases"`, `contractVersion = 1`,
and `mount`. Optional `requiredCapabilities` accepts the existing unique
`workflow.rows.v1` and `workflow.managed-run.v1` capability names.
They receive `{ root, definition, state, actions }` and synchronously return
`update(state)` and `dispose()`. Actions remain `select`, `run`, `view`,
`runAt`, `viewAt`, `startManagedRun`, `stopManagedRun`, `confirmRun`, `reveal`,
`draft`, and `error`. Rendering uses the supplied states and host-owned actions;
adapters do not call workflow endpoints. Manual Run/retry remains reachable
while a prior agent turn is unanswered.

### Added pages and generated controls

Added-page renderers export `renderPage`. The host awaits
`renderPage({ root, canvas: { id, displayName }, values })`. No new renderer
version or disposal handle is required. The renderer emits declared
`data-field-slot` and `data-asset-slot` mount points; the host retains missing,
unknown, and duplicate slot diagnostics.

Generated controls export `controlId`, `valueContract`, and `mount`.
Legacy object presentation receives `{ root, field, value, values, readValues }`.
Placed controls additionally receive `editable`; `onChange` is supplied only
for editable values and saves through the existing host value action.
`update` and `dispose` remain optional on placed-control handles. The host
retains updates, navigation cleanup, stale async-mount disposal, and inline
errors. Stock text receives its existing slot/class context; stock image
receives the authorized packaged image URL and `{ alt, className }` context.
No new generated `validate` export is required.

### Badge evaluators

Evaluators export `contractVersion = 1` and `evaluate`. The generated worker
awaits `evaluate({ ruleId, inputs, evidence, workflowId })`.
`evidence` exposes the existing async `readArtifact({ phase, output })`,
`getRun(phase)`, and `countMarkdownFiles({ phase, output })` methods.
Undeclared artifact/directory evidence returns the existing unknown-state
diagnostic; an undeclared run returns `null`.

Results require boolean `match`; optional `values` is an object, optional
`summaryCount` is a safe integer from 0 through 1,000,000 (accepted for legacy
evaluators; summaries count matching workflows rather than summing this value), and optional
`diagnostics` is an array of strings. The serialized result retains its 8192
character limit. Execution limits, hashing, caching, placement, and error
reporting remain in `badge-runtime.mjs`, not in evaluator modules.

An evaluator for a `badge-selection` input returns `selection` containing a
declared entry ID exactly when `match` is true; otherwise it must omit it.
Selection results cannot declare a summary count other than the match count.
The host rejects incompatible results with a diagnostic, renders the selected
entry and increments only its per-workflow Summary item. Non-selection rules
must not return a selection.

### Values and computed providers

Providers retain a single direct `export function provideValue` or
`export const provideValue` declaration, not a named re-export. The generated
worker calls `provideValue({ workflow })` with the existing frozen selected
workflow containing `id`, `slug`, and `label`. Results must be synchronous and
JSON-serializable, within the existing 8192-character serialized limit and
declared string/boolean/object value schema.

Typed result validation retains its `UserError` behavior and existing
`structuredClone` return. It does not add arbitrary input/output sanitization.
Source/hash approval, module integrity, execution time limits, provider error
reporting, and worker/VM isolation remain unchanged. Providers are not run
during Designer inspection.

### Dialogs and buttons

Dialog adapters export `dialogId = "stock.dialog"`, `contractVersion = 1`,
and `mount`. The host awaits
`mount({ root, definition, context, onDecision })`. The handle requires
`dispose()` and a thenable `result` resolving to `"confirmed"` or `"cancelled"`.
The host supplies its existing no-op `onDecision`, awaits `result`, disposes
in `finally`, and clears the root. Phase dialogs receive the selected phase
context; concurrency reservation and workflow-change checks remain host-owned.

Button adapters export the registered `controlId`, `contractVersion = 1`,
and `mount`. The host awaits `{ root, definition, onSetup }` for setup or
`{ root, definition, onTrigger }` for a dialog trigger. Their handle requires
`dispose()`. Confirmation, cancellation, setup, and phase dispatch remain host
actions. Generation retains its existing direct-source export checks, which
are intentionally not replaced with live-import checks.

## Fixed-shell and nonvisual exceptions

Required Designer identity fields use the fixed identity control. Outputs
uses the existing fixed artifacts control and remains hidden in the current
Designer UI. Neither is a newly customizable adapter boundary.
Nonvisual settings such as custom-slug and show-setup use a Designer checkbox
without a generated visual adapter; the host consumes the frozen boolean.
Stock rendering can be reused rather than creating per-field/per-element
adapters. Computed providers and badge evaluators are nonvisual.
Value match's registered composite editor is Designer-only; generated
canvases use the existing badge renderers rather than an entry editor.
Generated-only pages and Designer-only tabs do not implicitly add a page to
the other host. Visual custom controls rendered in both hosts retain their
paired definition/adapter registrations.

## Internal contracts remain internal

`wizard-handoff.mjs`, `host-open.mjs`, `designer-settings.mjs`,
`generation-request.mjs`, `generated-output.mjs`, `workflow-state.mjs`,
`agent-actions.mjs`, and `packaged-contributions.mjs` remain unprefixed.
They govern host operations, transport, persistence, and integrity, not
interfaces contributor modules should import. `R/contract.mjs` remains the
internal generated configuration boundary; its typed result validator is
implemented in `external-value-provider.mjs`.

Missing validation or a known contract defect is not fixed by this naming and
extraction refactor. Such changes require explicit approval of old/new
semantics and compatibility impact. Local-source test success is not evidence
that the published archive selected by the hosted catalog contains these files.
