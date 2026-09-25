# Research: Standalone Canvas Generator Extension

**Date**: 2026-09-23

## R1. Existing Specify contracts and tag classification

**Decision**: Use the released `specify artifact list --json`,
`specify preset list --json`, and `specify extension list --json` as the sole
composition authority. Classify Canvas Design for UI and addition policy with
the existing free-form `canvas-design` tag: catalog tags for discovery and
installed `preset.yml` / `extension.yml` tags when installed-list JSON omits
them. No new Specify resolver domain, registry field, or upstream release is
required for this classification.

**Evidence**: The local CLI is v1.0.7 and exposes `artifact list --json`.
The released [artifact reference](https://github.com/github/spec-kit/blob/main/docs/reference/artifacts.md)
documents an ordered stack per `(kind, name)` artifact; the
[preset](https://github.com/github/spec-kit/blob/main/docs/reference/presets.md)
and [extension](https://github.com/github/spec-kit/blob/main/docs/reference/extensions.md)
lists carry installed identities and provenance. The source plan identifies
preserved installed manifests and existing package/catalog tags. Verify the
complete JSON shapes, manifest retention, and installation behavior in contract
tests before selecting a minimum released CLI version; the local CLI's
availability alone does not establish the shipping floor.

**Rationale**: A tag is classification metadata, not composition authority.
Specify still resolves one artifact identity `(kind, name)` with one ordered
stack even when design and ordinary providers both contribute to it.
Manifest reads supply only the missing tag field, not resolver precedence.
Untagged local installs remain ordinary runtime packages.

**Alternatives considered**: Composition domains (unnecessary upstream
dependency), nested `.specify` projects (split registry and skill discovery),
catalog tags alone (do not cover local installs), or Wizard-side precedence
assembly (contradicts Specify's authority).

**Release check**: Test the earliest released CLI supporting the exact JSON,
manifest and installation contracts used, then apply the same minimum in the
extension manifest, Wizard Environment, CLI preflight, generated metadata and
readiness, tests, and docs. No guessed version or missing-field fallback.

## R2. PR #32 migration source

**Decision**: Use
[github/spec-kit-copilot#32](https://github.com/github/spec-kit-copilot/pull/32)
as a reviewed extraction source, not an assumed directory in this branch.
Pin its head commit or merged equivalent before porting fixtures/runtime.

**Evidence**: PR #32 is open and draft. Its file list contains
`generation/compiler.mjs`, `generation/materialize-template.mjs`,
`generation/generated-canvas-template/`, `shared-workflow-ui/`, and a
generated-canvas test matrix. None of the `generation/` directory is present
in this current checkout; the current Wizard lives at
`plugins/spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/`.

**Rationale**: Retain parity and reviewable migration history without
pretending the draft is merged or adding an independent implementation.

**Alternatives considered**: Rebuild from the narrative alone (loses
regression fixtures), or make generated output import the draft Wizard UI
(violates independent release and portability).

## R3. Composition snapshot, package eligibility, and authority

**Phase-output authority refinement (2026-09-24)**: Specify's artifact JSON
exposes effective command and template stacks and their source paths, but not
the output path of a phase command. The pinned Wizard compiler previously
received output targets from its scanner. Replace that Wizard-only input
with one complete `phase-outputs` Specify template, defaulting to `unknown`
and containing optional per-command artifact or transient entries. A preset
may replace the whole document; no implicit merge from the generator's known
core overrides occurs. Bind each selected result, effective provider, source
path, source hash, and complete shared template stack to the immutable
request. Other callable commands may lack an entry: capture a safe Markdown
path in the effective skill as a best-effort hint or record unknown output,
without blocking invocation. Only
existing workspace-confined files establish produced artifacts. This keeps
declared outputs unambiguous without making the Wizard cache authoritative.

**Decision**: Extension-owned preparation reads exactly the existing
`artifact list --json`, `preset list --json`, and `extension list --json`
surfaces, normalizes/validates them into one versioned snapshot, and computes
one fingerprint with captured per-package tag classification. Wizard refreshes its
Composition cache from that snapshot; the CLI path uses the same normalizer.
No materialization-time re-resolution or model transcription of provider stacks.

**Rationale**: Preserve Specify's precedence, active/hidden layers, concrete
source paths, priority, and provenance under concurrent catalog changes.
Wizard human choices overlay the snapshot but do not rewrite it. Catalog-tagged
packages must retain the tag when installed through Canvas Design; design-only
bundles require every member to be tagged. A tagged package contributing a
selected runtime phase is rejected by Wizard/generator policy with a named
artifact diagnostic. These checks do not alter Specify's install or resolution
semantics. Filter normal and generated-runtime catalog entries before search,
counts, recommendations, and actions; the Composition page may display full
stacks with a design-provider label.

**Alternatives considered**: N `artifact info` calls, parsing Rich text,
direct registry scans or manifest-based precedence, and separate Wizard/CLI
assemblers. Do not silently install then retain an invalid package after an Add
policy failure; prevalidate package/catalog information where available and
reconcile failed additions through the existing package-management path.

**Existing boundary**: Wizard
`catalog/shared.mjs::specifyRun(...)` already performs passive direct CLI
reads. Preserve the user-visible Copilot skill path for package mutations.
Its current `composition/assembler.mjs` and `collect.mjs` are transitional.
The generator at extension priority 100 remains the fallback within the
extension tier; presets always rank above extensions and ordinary customer
extensions at priority 10 can replace non-command templates.

## R4. Same-turn supported authoring and deterministic materialization

**Decision**: In the effective generation turn, establish the authoritative
request and complete brief, interpret optional supported guidance, then invoke
`create-canvas` as the first generation tool. Follow its current guide and
scaffold; move a fresh project-scoped scaffold to confined staging for both
new generation and regeneration. Validate the sparse draft with extension-owned
code and bind the finalized override to the request before materialization.
Refine the scaffold rather than rebuilding from an empty directory.

**Rationale**: Satisfy Constitution III/V and the host-supported authoring
workflow while keeping dynamic behavior as validated data. The interpreted
guidance is captured in the brief before skill invocation; programmatic
validation after the skill binds the persisted override before it affects
any output. Identical captured inputs imply semantic/contract equivalence,
not byte-identical model-authored source.

**Alternatives considered**: Direct Python generation without scaffold (not
supported), a second context-free agent turn (loses brief), or mutable
generated source patches from arbitrary prose (unverifiable).

**SDK evidence**: The public
[Copilot SDK extension examples](https://github.com/github/copilot-sdk/blob/main/nodejs/docs/examples.md)
document `joinSession`; the
[canvas API](https://github.com/github/copilot-sdk/blob/main/nodejs/src/canvas.ts)
exposes `createCanvas` with `open`, `onClose`, and declared actions. A host
capability reports canvas support. Use current `extensions_manage guide`
at implementation time for the exact experimental lifecycle.

## R5. Experience composition and provider precedence

**Decision**: Keep six complete, independently replaceable category
documents. Customer replacement owns an entire category; otherwise a
validated sparse command override patches generator defaults. Scalars
replace, arrays replace whole, stable-ID maps merge only allowlisted leaves;
unknown fields, `schemaVersion` patches, and `null` deletion fail. A suppressed
override emits a warning. One renderer manifest selects a whole package.

**Rationale**: One canonical owner/path per setting avoids conflicting
configuration and makes partial natural-language guidance deterministic
after normalization.

**Alternatives considered**: Textually merging JSON, arbitrary CSS/JS
fragments, always appending arrays, or renderer source edits. Full command
`replace` is a customer-owned path outside generator guarantees unless it
independently satisfies all contracts.

## R6. Recipient setup and permission boundary

**Decision**: Verify compatible plugin, CLI, Copilot skills initialization,
and reload capability before workflow setup. Missing project initialization
requires an explicit warning/confirmation; the app never installs the plugin
or CLI. Only after foundation readiness may `external`, `prompt`, or
administrator-authorized `automatic` handle the exact captured runtime
component set. `prompt` is all-or-nothing, `external` never installs, and
`automatic` still honors exact provenance and host permissions.

**Rationale**: Separate administrator-authored policy from destination-user
trust decisions; avoid success-shaped partial setup or silent `--force` init.

**Alternatives considered**: Always initializing, auto-installing CLI/plugin,
partial dependency selection, or trusting manifest labels without source checks.

## R7. Renderer API and trust model

**Decision**: Document one versioned Canvas Runtime API implemented by the
generated-runtime adapter and an isolated Wizard preview adapter. Keep the
Wizard's live presentation independently owned. Renderer manifests declare
required capabilities and files; the protected host validates package
paths, resources, actions, and full setup disclosures.

**Rationale**: A presentation package can add layout and views without
changing phase dispatch, setup approval, artifact authorization, or
filesystem access. A same-process renderer is executable trusted code,
not a sandbox; backend authorization remains mandatory.

**Alternatives considered**: Shipping one Wizard-owned renderer everywhere
(release coupling), importing private routes/DOM IDs (non-portable), and
assuming conformance tests are a malicious-code security barrier.

## R8. Result model and lifecycle

**Decision**: No inferred result labels by default. A configured phase has
one optional result tag from an artifact field or a report in the original
phase turn, never a second reviewer. Validate report against active run and
allowed IDs; retain settled value while rerun is pending, replace on success,
exclude stale and unresolved evidence from summaries. Clarification and
numeric progress remain independent.

**Rationale**: User-visible PR #32 results without extra agent invocation
or mutable aggregation counters. Missing/invalid report yields a diagnostic,
not phase failure or fallback classification.

**Alternatives considered**: Separate LLM review, inferred prose labels,
computed results, and provider-defined aggregation formulas.

## R9. Whole-target publication and observability

**Decision**: Build and validate candidate before any target mutation.
For an existing exact target, show destructive confirmation regardless of
receipt validity. Lock that target, delete the entire confirmed directory,
publish the candidate, read back, reload, inspect, and open once. Do not
back up, roll back, preserve manual edits, or add a distinct Retry workflow.
Atomically write one outcome; absence of an outcome means interruption.

**Rationale**: Generated output is disposable, but the user must not lose
files silently. Validation cannot falsely report success after a partial
publication. Workflow artifacts remain elsewhere.

**Alternatives considered**: In-place merges (unknown-file drift),
backup/rollback journals (complexity inconsistent with disposable output),
and blindly replacing a symlink/reparse point (unsafe).

## R10. Test and packaging strategy

**Decision**: Use the Wizard's existing Node ESM test runner for adapter/UI
regressions, add Python contract/compiler tests and copied PR #32 fixtures
for supported workflows, and run one Runtime API suite against both
adapters plus a mock renderer conformance suite. Cover Windows and
macOS/Linux path and setup behavior.

**Rationale**: Existing Wizard `package.json` uses
`node --test ./test/*.test.mjs`; this layout preserves the local test
ecosystem while the extension owns its independent tests. Test semantic
equivalence rather than pixel/byte parity between independently versioned
Wizard and generator renderers.

**Alternatives considered**: An exhaustive host-by-third-party-renderer
cross-product or adding a new mandatory frontend test framework without
need.
