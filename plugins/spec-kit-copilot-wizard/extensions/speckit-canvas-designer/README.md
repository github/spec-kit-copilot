# Spec Kit Canvas Designer

This extension is **under development and not ready for use**. It ships inside
the `spec-kit-copilot-wizard` plugin. Installing that plugin registers both the
Wizard and Designer canvases.

The provider's `contracts/` directory names the Wizard handoff and open input
(`wizard-handoff.mjs`, `host-open.mjs`), saved settings and save request
(`designer-settings.mjs`), configured Badge instances (`external-badges.mjs`) and
registered Badge definitions (`external-badge-definitions.mjs`), generation submission
and frozen request writer (`generation-request.mjs`), generated output status and
bounded folder/Open actions (`generated-output.mjs`), Specify version inventory (`specify-inventory.mjs`),
control adapter exports (`external-control-adapter.mjs`), and contribution field/schema
rules (`external-design-contributions.mjs`). Definition checks live in
`external-definitions.mjs`; static executable export and self-contained-module
requirements live in `external-executable-modules.mjs`. `external-` identifies
contributor-facing contracts, while the unprefixed contracts govern internal
host operations. The [external-contract index](../../../../spec-kit-extensions/extension-canvas-design/EXTERNAL-CONTRACTS.md)
maps both Designer and generated-runtime interfaces to their consumers and tests.
The existing readers and handlers retain
filesystem confinement, UI lifecycle, and revision conflicts. The generator is
independently packaged and validates request integrity with its own
`scripts/contracts/generation-request.mjs`; it does not import the provider.
The browser's matching mount, readiness, badge input, and draft-change rules live in
`ui/external-control-adapter-contract.js`, served with the provider rather than loaded
from a preset.
The additive, nonvisual `contracts/bootstrap.mjs` defines
`speckit_designer_bootstrap`: versioned launch references, explicit LLM-invoked
`install` and `finalize-open` stages, compact results, and native opening checks.
It registers no customizable UI, so it needs no definition/renderer template
pair. `bootstrap-artifacts.mjs` confines exact-byte transfers and diagnostics to
identified session roots; `bootstrap.mjs` reuses the Wizard's setup routines.
The browser-safe `ui/generated-output-state.js` defines status, reveal, Generate,
Open, and error response shapes shared by the server and browser. Reveal responds
with the folder actually opened: the extensions parent before generation, or
the verified canvas target once present.
The browser and provider import the same `ui/generation-state.js` definitions
for pending and duplicate-ID errors; the browser loads that asset through the
authenticated shell. An unavailable Generate skill takes precedence over a
duplicate saved ID, so the duplicate-ID click exception cannot mask a missing
capability.

### Importing badges

On **Badges**, **Import badges** opens a local JSON file picker. Select the complete
`canvas-config.json` from an existing generated canvas (up to 2 MiB), not a
Designer settings file or an array of badges. Only `badges.instances` is appended
to the current badge draft. Nothing is persisted until the existing **Save**
action, and the source canvas, outputs, values, and registered definitions are
never imported or modified.

The whole combined draft must pass the existing Save badge validation, including
required category and placement text, phases/outputs, duplicate IDs and
overlapping badge conflicts, with at most 100 instances total. Invalid files
reject all imported badges and show the first useful reason, including a badge
number or ID when applicable. There are no defaults, old-format migrations,
skipped entries, or replacements of existing badges. Optional instance fields
remain exactly as supplied.

`contracts/badge-import.mjs` defines the schema-version-1 generated envelope and
compatibility check. The envelope requires generated canvas identity, phase,
output, layout and installed-inventory containers; unrelated canvas settings
are not interpreted. Its `badges` object contains only `instances`, `types`, and
`rules`. Types and rules must be unique and used by the imported badges.
Their behavior must match the current resolved Designer model: type rule,
enabled state, defaults and replacement group; rule evaluator name, ordered
input descriptors (including scope, ordering and minimums), placeholders and
placement-phase input. Display titles, descriptions and input labels may differ.
The generated rule's `hash` must match the resolved evaluator template's SHA-256;
the host also verifies its current local bytes against that frozen hash. A type's
whole-settings hash is required metadata but is not used as the evaluator
fingerprint. Missing, changed, or unverifiable behavior rejects the import.
No code from the selected file is loaded or executed.

The new, authenticated `POST /api/validate-badge-import` operation is nonpersisting.
`ui/badge-import-contract.js` defines its exact request
`{schemaVersion:1, modelRevision, config, badges, outputs}`, success
`{schemaVersion:1, badges}` (the unchanged, validated combined draft), and
`{error}` failure. The request limit is 4 MiB; incorrect content types, oversized
bodies, stale model revisions, and invalid input fail explicitly. Browser
validation has a timeout and a reachable **Cancel import** action. Cancellation,
new edits, output changes, replacement views and late responses cannot overwrite
a newer draft. Preview sessions cannot verify evaluator provenance and disable
import. Existing Save, handoff and generated-file contracts are unchanged.

The picker/status UI belongs to the **fixed Designer Badges shell**. This is a
single-host, non-customizable host operation, not a contributed badge input
control, so it deliberately has no JSON definition/adapter template pair and
no generated-host renderer. Existing registered badge input editors are reused
after import.

For local UX inspection, the project skill `speckit-designer-preview` opens the
official Designer canvas with `{preview:true}`. It shows an illustrative Badges
tab with sample phases and output paths, without a Wizard handoff or Specify
installation. The banner marks the session as a preview; Save and Generate are
unavailable in both the UI and HTTP API. Edits are ephemeral and do not verify
template composition, project setup, or the published hosted package.

The Wizard hands approved customizations to a separate child session. That
session initializes Spec Kit in Copilot skills mode if needed, installs the
released `extension-canvas-design` package, approved Designer selections, and
the Wizard's active runtime presets, extensions and bundles through real Specify
operations. It restores the runtime preset/extension priorities recorded by the
Wizard and verifies IDs, versions, enabled states and priorities before opening
Designer; unreproducible packages fail launch rather than being omitted. Local
development selections may override a hosted package only if the frozen runtime
identity, version and priority remain reproducible. The child LLM explicitly
invokes bootstrap `install`, then `finalize-open`.
These stages reuse the real Specify install/finalize helpers; source code does
not run setup automatically or shortcut package composition. The second stage
reloads skills once after a successful install, verifies the composed
`speckit-extension-canvas-design-load-page` skill and its explicitly declared
templates through Specify, and passes the complete typed inventory of names,
paths, asset kinds and replacement strategies directly to native `open_canvas`
through `session.rpc.tools.execute({name,arguments})`. The model carries only a
bounded launch reference; it does not write or reproduce the full handoff or
open input. Native invocation, canvas snapshots, session metadata, and skill
reload must be available. The package must include `scripts/verify-launch.mjs`,
run with external `node` rather than the embedded Copilot host executable;
missing capabilities or verifier are explicit failures, with no legacy manual
resolution/open fallback. Native session metadata must identify distinct checkout
and session-state roots. Both paths are resolved canonically before comparison
and use; filesystem aliases of the same directory fail before handoff staging
writes files.

**Trust boundary and installation approval.** Bootstrap assumes a trusted local
agent acting on behalf of the machine's user. In the Designer launch dialog,
selecting a community-provided preset, extension, or bundle requires explicit
confirmation of a warning; cancellation leaves it unselected. Optional built-in
packages are selected with checkboxes before the user launches Designer. The
required Canvas Design extension is shown as a preselected, non-optional
dependency. These controls reduce unintended or uninformed installations through
the normal dialog flow.

The launch-reference SHA-256 and handoff fingerprint verify integrity, not
authenticated human approval. A caller able to stage a substitute handoff and
steer the agent into invoking bootstrap can recompute the hashes; approval fields
are not host-issued consent credentials. The dialog controls do not protect
against that direct forged-reference path. Authenticated launch provenance is
deferred hardening within this accepted trusted-local-agent boundary, not a
protection supplied by the current contract. Installed packages may contain
scripts or adapters that execute with the user's permissions; local operation
does not make malicious package execution harmless. This boundary does not
establish Copilot App's effective tool-permission policy or claim permission
equivalence between shell and bootstrap invocations.

Full stage/native results remain beside the child `handoff.json` in
`bootstrap.json`, bounded to 16 MiB to retain complete maximum-sized Unicode
inventories. JSON byte size, including escaping, is checked before serialization.
Native replies are normalized as bounded JSON before retention, including
non-success replies and structured metadata. Retained replies and snapshots must
fit the complete record budget, reserving 16 KiB for a compact failure diagnostic.
Malformed or oversized replies are not retained and do not clear the unknown
opening guard. Valid replies remain complete; persisted error summaries are
limited to the same 2048 characters as the tool response.
Bootstrap retains the host's full reload diagnostics, including
failed reloads, before validation; these failures stop finalization and remain
retryable. Before dispatching a skill reload, bootstrap persists the optional
`reloadPending: true` guard. A timeout does not cancel the RPC: an explicit
`finalize-open` retry in the same provider awaits that retained RPC and records its
result rather than dispatching another. A completed reload failure clears the
guard and permits another explicit retry. After a provider restart, a pending
guard without the retained RPC reports an unknown outcome and requires a new
Designer launch; reinstalling cannot reset that guard. Records without the guard
remain valid. Failed session logging falls back to stderr without replacing the
original failure result. Model-facing results contain status, warning count, timings, and
diagnostic path, not pages/templates. Native tool display text can be truncated
by the host; success is verified against the complete `canvas.listOpen()` snapshot,
not by parsing that display text. A verified native snapshot means only
`shell-opened`, not that all pages loaded or generation is
ready. A stable handoff-derived instance is used to reconcile interrupted opens
without automatically opening twice. This local development path must be
verified independently of the published archive selected by the hosted catalog;
worktree success does not establish hosted release readiness.
Preset and project overrides are honored. The provider obtains a fresh inventory
at open and checks submitted names and paths against the active layers. Failed CLI resolution, incomplete
page lists, unsafe paths and invalid handoffs fail opening. A resolved page whose winning file is missing or unreadable prevents opening;
invalid JSON in a readable page appears as a marked tab with its template
name, path and reason so the user can troubleshoot with the agent.
If the installed Canvas Design page schema itself is missing or unusable,
Designer does not open and reports the schema path with repair guidance;
individual page errors still appear as tabs once the schema loads.

Essentials requires Canvas ID and Title from the resolved core page. Description,
Header text, Workflow item name, and Allow custom artifact directory slug are
ordered Essentials contributions. Header text retains the existing
`canvas.workflowListName` field ID and defaults to `Workflows`; the independent
`canvas.workflowItemName` is a singular name of at most 80 characters and
defaults to `Workflow`. Both are trimmed when frozen. The item-name setting is
nonvisual generated configuration, consumed by the Workflow page adapter and
the host's default-name logic rather than a separate generated control.
Renaming the heading does not rewrite a saved settings file. As with all
Designer settings, native reopening starts a fresh form rather than restoring
the saved heading; a subsequent Save replaces the prior draft.
Header logo, Main page logo, and light/dark accent, page background, surface,
secondary surface, and text colors are ordered Appearance contributions
registered by the composed load-page command. The two required identity fields
use the fixed Designer identity control; Badges uses its fixed page shell with
registered badge input control definitions and Designer adapters. Output evidence
is nonvisual host data, not a Designer page. Other fields use registered adapters: `stock.checkbox`
provides the optional boolean editor, and `stock.text` validates optional text
and palette values at Generate. Generate packages the winning stock-text generated adapter
for visible Description, Header text, or read-only text placements. Text
fields on a page or in a contribution can opt into `"required": true`; the
shared text validator rejects blank or whitespace-only values at Generate,
while Save can keep an incomplete draft.
Canvas ID and Title remain unconditionally required, and other text fields
remain optional unless configured otherwise. The current generated canvas
allows an optional artifact directory slug for each new workflow when
Essentials' default-off Allow custom artifact directory slug option is enabled. Otherwise Spec Kit
chooses the directory. The optional Show
setup checkbox follows the stock control pattern without delegating project
setup to adapter code. The Appearance's optional image controls upload, preview, replace,
and remove independent PNG,
JPEG, GIF, or WebP images up to 32 KiB each. Rejected files show an accessible
reason beside their picker, including the actual size when over the limit;
successful replacement or removal clears the message. A failed upload blocks
Save, Generate, and tab departure until retry or explicit cancellation. All image fields,
including preset-owned asset slots, require the same resolved `stock.image`
definition and paired adapters; the Designer adapter validates images for
Generate and renders the picker and preview. Both adapters receive an
image-source string as `value`; only the generated adapter receives
presentation `context` for packaged alt text and styling. The smaller Header
logo replaces the generated header's brand mark; the larger Main page logo appears beside the
workflow heading. Either can be set alone. Both use the shared field/slot
validation path and freeze the selected bytes and hashes at Generate. With no
Header logo, the existing brand mark remains unchanged. Without optional text fields, generated description and heading default to
`Spec Kit workflow canvas.` and `Workflows`.

Preset-generated pages can publish ID-only slots and receive any registered
`stock.image` field by `generatedBinding.page` and `.slot`, independent of the
field's Designer page. The renderer places a `data-asset-slot` element where it
wants the image; the generated host matches the ID and mounts the packaged asset.
Missing and duplicate placements fail explicitly. The generated host
supplies an authorized URL and mount node to the packaged image adapter, which
is shared across Header, Main, and preset placements. An absent Header logo
retains the brand mark; a configured image with a failing adapter reports a
visible error rather than falling back.

The required generated Workflow page declares named slots and a replaceable
`generated.workflow-page-adapter` for its whole-page presentation. Designer
validates and freezes the required `workflow.phases` placement, plus separately
registered typed field placements targeting that page or a preset-added page.
The stock page adapter renders the workflow collection, summary, setup,
constitution, phase composition, and additional Workflow contribution slots;
a replacement adapter controls their presentation rather than inheriting a
host-owned contributions area. Preset-added page renderers expose
`data-field-slot` targets. The generated host retains authorized actions,
persistence, and shared navigation. Designer's own tabs, settings UI, and
control model are unchanged. Read-only values remain the default; explicit
editable generated values use the generated shell's existing typed value API,
while packaged images are display-only.

Workflow name appears in the generated canvas's workflow collection, before
phase navigation, while creating a workflow. It labels the workflow there.
When Allow custom artifact directory slug is on, the generated workflow accepts an optional
Artifact directory slug. If entered, it previews the View target; the created
directory, which may include a numeric prefix, remains authoritative.
Wizard-inferred output evidence remains in the handoff and frozen generation
data without an Outputs page. Badge input controls may declare additional
Markdown files that a phase is expected to produce when inference missed them.
They appear as additional output links and are available as badge evidence,
without changing the inferred default View target.
A phase without an inferred viewer stays without a View button even when
a badge watches a file. Constitution still opens
`.specify/memory/constitution.md`. The **Generate** tab is fixed shell
UI rather than a customizable contribution, so it does not register a JSON
definition or adapter/renderer template pair.
The existing header Save persists confirmed output evidence with the other bounded,
structurally valid drafts, including incomplete field values, to `settings.json`
beside the handoff in the Designer session artifacts (never to the page templates);
reopening the same handoff retains the saved revision but starts a fresh form
from current template defaults, even when the resolved pages have changed.
Reopen and Save safely read the prior file and validate its schema version,
handoff identity, and revision, not its discarded model revision, fields,
outputs, or badges. Saved values, output additions, viewer selections, and badges
are not restored on reopen; a subsequent Save or Generate replaces them with
the current draft. New drafts remain fully validated on Save, and Generate also
validates the saved content against the current model before freezing it.
Appearance's optional `RRGGBB` or `#RRGGBB` palette fields use `stock.text`;
blank retains the current color in that mode, while invalid hex blocks Generate
without preventing an incomplete draft from being saved. The generated canvas
keeps its existing light/dark toggle. Designer's fixed header also has a
keyboard-accessible light/dark toggle, stored in the browser for page refreshes;
it follows the system contrast preference until explicitly changed. There is
no Designer color preview or contrast warning. The Designer connection pill
reports Live when the current provider responds and Disconnected when a
bounded health check fails; the check does not replace the panel or discard
unsaved drafts. A transient interruption notice clears when the connection
recovers, without clearing unrelated errors or accepted Open guidance.
An output-status lookup error is shown on the page without marking a responsive
provider disconnected or removing the editable form.
The 10-second liveness probe fetches a small authenticated
stylesheet; every sixth probe also refreshes the full generation availability
state. The server remains authoritative at Generate if availability changes
between polls. If the provider URL is dead, closing and reopening the panel
from Copilot is still necessary.
Generate freezes the combined artifact links into the app: its phase card links
to each listed file and View artifact opens the selected default. A phase with no
inferred artifacts remains empty unless a link is added.
Appearance remains empty by default.
Preset-registered stock text and checkbox fields mount their shared adapters
in their declared Designer page slot and are saved alongside required values. A registered
`shared.control-definition` for a typed object or image field must reference both a
`designer.control-adapter` and `generated.control-adapter` replace-only template. Both modules
export `mount`, `controlId`, and a matching `valueContract`; Designer adapters also
export pure `validate(value, field): boolean` and return an `isReady()` handle from
`mount({ root, field, value, onChange })`. Each adapter belongs
to one control definition; multiple fields may reuse that control. Fields
resolve their unique `shared.control-definition` by the field's `control` ID.
An optional `requires` entry must name that same definition; Generate packages
the resolved, validated definition and its paired adapter. The Designer
mount receives the field, draft value, and change callback; the generated
mount receives the frozen value and displays it read-only in the declared
`details.content` slot. Missing, wrong-kind, non-replace, or multiply owned
control assets stop Designer opening rather than falling back to a stock input.
A separately registered generated-host page definition
and replace-only renderer add a page only to the generated app, not Designer's
tabs. The provider verifies the executable Specify template stack (and rejects
native script registrations), checks module syntax and declared exports without executing
the bytes in Node, and rechecks Designer adapters before serving captured bytes.
Changed assets require reopening Designer. The Designer document's CSP allows
same-origin scripts, API calls, and styles, plus same-origin images and data-URL
previews for stock-image controls, but blocks ordinary cross-origin
requests from adapters; it does not sandbox approved adapter code.
The browser reports non-function
`mount` exports, incompatible `controlId` or `valueContract` exports, and mount
failures beside the affected control. Callbacks from controls removed during a
tab change cannot overwrite the current draft. It validates the page/renderer pair and freezes
their bytes for packaging without the originating preset. Module dependencies
in generated renderers are rejected because only the renderer is packaged.
Registered `generated.value-definition` JSON templates join the same field-ID collision
registry and declare a typed constant or a workflow-scoped computed value.
Constants may be read-only, runtime-editable, or processing-only; computed values
may be read-only or processing-only, never runtime-editable. A computed value must
have its own replace-only `generated.computed-value-provider` `.mjs` registration with a direct
`export function provideValue` or `export const provideValue` declaration
(`export { provideValue }` and imports are unsupported). The function receives
`{ workflow: { id, slug, label } }` for the selected workflow and must return
a synchronous, JSON-serializable value matching the definition's typed schema.
Async functions and non-function exports fail visibly during generated-canvas
refresh; Designer checks syntax but does not execute providers. Generate
confirms each resolved provider's
name, source and hash before freezing its bytes for packaging. Changes since
Designer opened require reopening and reconfirming. Generated pages may declare
the IDs they consume in `values`. The packaged app rejects changed provider
bytes before execution; this is not a sandbox for approved provider code.
Runtime-editable values belong to the generated canvas shell, not to a
particular workflow's drafts.
Save rejects stale revisions and malformed draft shapes, but accepts incomplete
field values and reports failures without discarding edits. **Generate canvas**
first saves the current draft with the same revision check, validates all
enabled fields, then freezes and dispatches a file-creation-only request to the
child-session agent. A brief **Submitting...** lock ends when the request is
acknowledged, before the child agent begins; later dispatch failures are
reported in the session log, not the already-sent HTTP response.
The server requires the submitted snapshot to match that saved revision and
freezes the saved values, outputs, and badges rather than trusting a second copy.
The Designer stays editable while creation continues. An authenticated output
status check verifies the matching config, provenance, and final entry point
before reporting **Canvas files created.** Superseded status checks cannot replace
the current Canvas ID's status or error. A second click during submission is
blocked, but Generate can dispatch again while awaiting the child-session agent
if its first attempt stalls. If an earlier non-replacement request publishes
after a retry is accepted, its verified output remains openable even if the
newer request fails. Inspect the child-session chat before retrying.
These local checkout and session-artifact checks reject unsafe links and
metadata; they do not coordinate with another local process replacing ordinary
directories while Designer is using them. Avoid concurrent edits to these
folders during Generate or Open.
Reopening starts with template defaults while retaining the saved revision.
Generation requires both separate Generate and Open skills and a complete
Wizard handoff; a hosted package with only the older combined Generate command
is blocked rather than silently reloading Designer.
For a verified same-handoff target, **Regenerate canvas** confirms that all
files, including manual edits, will be overwritten. The generator clears and
rebuilds the final directory in place without staging, backup, or rollback.
It writes the entry point only after validation and removes failed output so
Generate can be retried; cleanup failures require folder inspection. Foreign or
incomplete output is not replaceable. The server rejects replacement fields
when the target is absent; creation must be submitted without replacement,
and replacement requires the matching verified prior request ID. If a target
appears before creation, review it and confirm regeneration when it belongs
to this handoff, or save a different Canvas ID. The target-folder link reveals
`.github/extensions/` until the generated folder exists, and reveals
the generated folder afterward.
**Open canvas** is available only after the generated files are verified.
An accepted regeneration waits for its own verified output before enabling
Open or Share, so the previous published version cannot disconnect Designer
while replacement is pending. If regeneration fails or stalls, reopen Designer
to clear that panel-local wait and recheck the target. Failed regeneration does
not preserve the previous files; when cleanup succeeds, Generate can start again.
Before dispatch, the Open step warns that registration disconnects Designer
and shows the child-chat guidance. Generate and Open stay disabled after the
opening request is accepted; an error before acceptance restores them. The
child-session command reloads extensions, verifies the exact project provider,
and opens its canvas. Reopen Designer to continue editing after registration;
the child chat reports success or failure and can retry opening existing files
without regenerating. There is no supported provider-initiated panel-close operation.
Sharing remains optional instructions for a team project extension, a personal
extension, or a plugin; no distribution happens automatically. The Share commit
path appears only for the current Canvas ID's verified output when no
regeneration is pending; otherwise the page asks for generation and verification.
At Generate, Designer checks the child checkout's Specify inventory for packages
in the Wizard handoff and freezes their installed versions alongside the original
Wizard snapshot. Unrelated installed packages do not affect version verification.
Version drift is reported as a warning rather than blocking generation. If
Specify's inventory cannot be read or a package is missing, that package's
generated version is marked `unverified` and the warning remains visible.
Pages explicitly marked `enabled: false` are omitted even if their other fields
are malformed; unreadable pages still show errors because their enabled state
cannot be determined.
A missing skill directs users to relaunch with the current Canvas Design release or the
current local source, before any generation request is prepared. Healthy pages remain
editable even when another page fails. Essentials
is selected first, including when it shows an error; in that case it supplies
no Canvas ID or Title values, so Generate remains unavailable. When a partial non-preview composition has no pages, Designer explains that
no settings pages are registered and Generate remains unavailable. Tab changes display the in-memory model without re-resolving
pages; there is no page-reload control or persisted page snapshot. After a
successful handoff launch, the provider saves its complete resolved open
inventory in the Designer session's `speckit-canvas-designer/last-open.json`.
Restarting Designer in that same session with no input restores the most recent
successful handoff and revalidates its pages and templates, but starts a fresh
editable form rather than rehydrating saved values.
Startup and restored opens wait for the SDK session join before reading that
session's inventory or starting the local server. A failed join rejects the open.
This protects restoration during a session rebuild; it does not prevent Copilot's
deliberate restart after repository-configuration approval.
An invalid saved inventory or missing handoff fails explicitly rather than
opening a blank shell; an explicit launch can repair the saved inventory.
Replacement saves the new inventory only when the open succeeds; if closing
the previous server fails or the panel closes while replacement is pending,
the prior inventory is restored and the new shell is closed. A concurrent
empty-input open waits for that decision rather than reading a staged record.
Opening `speckit-canvas-designer` without input before any successful handoff
launch still shows an empty shell. A different session cannot reuse this
session's handoff or resolved inventory. Panels opened before this restore
feature was installed have no `last-open.json`; launch once with the original
complete resolved input to establish it.

A supplied `handoffId` must match the bounded handoff ID pattern; the provider
checks the handoff structure, fingerprint, size, and session-artifact boundary.
A missing or invalid handoff is an error, not an empty shell. The HTTP shell
binds to loopback and requires an unguessable URL token.

The provider loads without installed npm dependencies. The Wizard's environment
setup checks and installs the Designer's renderer parser alongside its own YAML
parser. Opening Designer directly without the parser reports an install instruction
instead of failing at provider startup. For local tests, install dependencies with
`npm ci` in this directory and ensure Specify CLI is available, then run:

```bash
node --test plugins/spec-kit-copilot-wizard/extensions/speckit-canvas-designer/test/provider.test.mjs
```

The resolved-template integration test requires a successful `specify --version`
and fails rather than skipping when the CLI is unavailable. The Release Extension
workflow installs Specify before running the Node.js integration tests.

Canvas Design's [taxonomy, kind-named JSON Schemas, and executable module contracts](../../../../spec-kit-extensions/extension-canvas-design/README.md#template-taxonomy-and-schemas)
define the registration and authoring surface. Required and added Designer tabs
share the `designer.tab-definition` kind and schema; the required tabs are identified
by their registered names. Preset fixture JSON omits `$schema` because its
installed package cannot reliably resolve a relative path into a separately
installed extension; see the mapping in the extension README.
