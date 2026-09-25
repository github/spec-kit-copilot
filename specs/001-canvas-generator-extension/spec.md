# Feature Specification: Standalone Canvas Generator Extension

**Feature Branch**: `nicolehaugen-spec-kit-setup`

**Created**: 2026-09-23

**Status**: Draft

**Input**: User description: "Use the revised Canvas Generation as a Spec Kit Extension plan to specify standalone, customizable Copilot canvas generation with tag-based Canvas Design classification."

**Revised configuration contract**: [Original plan, Section 17](../../docs/canvas-extension-original-plan.md#17-revised-generation-configuration-and-result-behavior) supersedes this draft's six-category, phase-output-template, and request-snapshot descriptions where they conflict. Only newly generated canvases use that contract.

## Clarifications

### Session 2026-09-23

- Q: What generation-time target should the first release promise for a ready user creating and opening a default five-phase canvas? (SC-003) -> A: No time limit; a ready user can generate, validate, install, reload, inspect, and open a default five-phase canvas in one uninterrupted workflow without manual file editing or restarting generation.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Generate a standalone workflow canvas (Priority: P1)

As a Wizard user, I select an ordered workflow, name its canvas, and generate a
standalone application with the familiar behavior of the existing Wizard-generated
canvas. I can run phases and inspect their artifacts without depending on the Wizard
after generation.

**Why this priority**: A functioning generated canvas is the core outcome; no other
customization matters without it.

**Independent Test**: Generate a supported linear workflow using only generator
defaults, open it in another compatible repository, and run a phase there without
opening or installing the Wizard.

**Acceptance Scenarios**:

1. **Given** a ready Wizard and a supported ordered workflow, **When** I confirm
   its identity and target and select Generate, **Then** a standalone canvas opens
   with the chosen phases, order, artifacts, project prerequisites, setup, and
   default experience.
2. **Given** a completed generation, **When** I open the canvas in a compatible
   recipient repository, **Then** the canvas can establish readiness and run its
   captured phases without the Wizard or the generation session.
3. **Given** an unsupported workflow shape or missing provider, **When** I try to
   generate, **Then** I receive an actionable error rather than an inaccurate
   or partially supported canvas.

---

### User Story 2 - Generate directly from Copilot CLI (Priority: P1)

As a Copilot CLI user without the Wizard, I provide or confirm the phases, order,
canvas identity, target, and replacement choice, then generate the same kind of
standalone application from the installed generator.

**Why this priority**: Separately installable generation must work without the
Wizard; this is a defining property of the feature.

**Independent Test**: In a ready project without the Wizard, install the generator,
select a supported workflow, generate a canvas, and compare its behavior with a
Wizard-generated canvas from equivalent choices and installed components.

**Acceptance Scenarios**:

1. **Given** compatible prerequisites and an installed generator, **When** I invoke
   generation from Copilot CLI, **Then** I can confirm all missing choices and
   receive a working canvas without opening the Wizard.
2. **Given** equivalent selected phases and installed components, **When** the
   Wizard and Copilot CLI each generate, **Then** both preserve the same workflow
   and supported experience decisions.
3. **Given** an incompatible prerequisite, **When** I invoke generation, **Then**
   I see the missing or required capability and no final target is changed.

---

### User Story 3 - Reuse a customized canvas design (Priority: P2)

As a Canvas Design author, I publish reusable experience choices so customers can
change generated terminology, branding, layout, interactions, artifacts, results,
and onboarding without changing the selected workflow or protected behavior.
When supported choices are insufficient, I can replace the complete presentation.

**Why this priority**: Reusable customization is the principal reason to separate
the generator from Wizard-owned configuration.

**Independent Test**: Add a design component that changes terminology, theme,
layout, and pre-run confirmation; generate a canvas and verify those changes while
its phase still invokes the independently selected runtime behavior.

**Acceptance Scenarios**:

1. **Given** a complete customer-owned experience category, **When** I generate,
   **Then** it wins over default and command-derived choices for that category;
   other categories retain their resolved values.
2. **Given** supported command-derived guidance and no customer-owned replacement
   for its category, **When** I generate, **Then** the bounded choices appear in
   the canvas without changing phases, paths, or security rules.
3. **Given** a design package offering a replacement renderer, **When** I generate,
   **Then** generation rejects that template; supported design categories retain
   the generator's horizontal PR #32-style phase presentation.
4. **Given** a configured pre-run confirmation, **When** I cancel it, **Then**
   the phase does not run; **When** I confirm it, **Then** the selected effective
   phase runs once.

---

### User Story 4 - Manage Canvas Design separately (Priority: P2)

As a Wizard user, I find Canvas Design components in Generate rather than the
runtime Catalog, add or remove one at a time with the usual trust confirmation,
and immediately see their effect on the next generation.

**Why this priority**: Mixing design-time and runtime packages obscures which
components a generated app actually needs.

**Independent Test**: Install and remove a tagged design preset and a design-only
bundle from Generate, inspect catalog classification and unchanged effective
composition, then generate again.

**Acceptance Scenarios**:

1. **Given** the Wizard Environment is ready, **When** I open Generate, **Then**
   the required generator appears as Added and Required, while optional eligible
   design presets, extensions, and bundles appear in a separate searchable area.
2. **Given** an eligible community component, **When** I add it, **Then** I
   confirm the existing trust prompt before immediate installation; removing it
   immediately excludes it from future generation.
3. **Given** a design-only component, **When** I inspect the normal or generated
   runtime Catalog, **Then** it is not presented as a runtime workflow component.
4. **Given** a catalog-tagged design component whose installed package lacks the
   matching tag or contributes a selected runtime phase, **When** I try to add
   it through Canvas Design, **Then** I receive an actionable package-specific
   error instead of an incorrectly classified installation.

---

### User Story 5 - Regenerate without silently losing edits (Priority: P2)

As a canvas owner, I can regenerate from the current workflow and installed design
choices. Before any existing target is replaced, I see the exact directory and
an explicit warning that all files inside it, including manual edits, will be
deleted; cancellation leaves it unchanged.

**Why this priority**: Whole-target replacement is destructive and must be
informed, confined, and repeatable.

**Independent Test**: Regenerate both a previously generated canvas with manual
edits and an unrecognized target; check cancellation, confirmation, failure,
and recovery without touching workflow artifacts outside the target.

**Acceptance Scenarios**:

1. **Given** an existing target, **When** I cancel its exact-path deletion
   warning, **Then** no target file changes.
2. **Given** an existing target with manual edits, **When** I confirm regeneration,
   **Then** a newly validated candidate replaces the entire target; prior edits
   are not merged or restored.
3. **Given** publication or reload fails after confirmation, **When** I receive
   the failure, **Then** no success is reported and the ordinary Regenerate action
   can build a fresh candidate without deleting external workflow data.

---

### User Story 6 - Start safely in another repository (Priority: P2)

As a recipient, I can see exactly which foundations and workflow components the
canvas requires, approve any allowed changes, or use a workspace already prepared
by my administrator. Setup never treats a missing prerequisite or denied host
permission as success.

**Why this priority**: A standalone canvas is useful only when its setup is
portable, understandable, and permission-preserving.

**Independent Test**: Open the same generated canvas in ready, uninitialized,
externally managed, and partially prepared repositories under each supported
component-installation policy.

**Acceptance Scenarios**:

1. **Given** missing project initialization, **When** I open the canvas,
   **Then** it remains blocked until I explicitly approve the warned
   initialization action; cancel leaves the project unchanged.
2. **Given** the approval-based installation policy and missing runtime
   components, **When** I cancel, **Then** none are installed; **When** I approve,
   **Then** the complete disclosed set is installed and readiness is rechecked.
3. **Given** the externally managed policy and missing components, **When** I open
   the canvas, **Then** it reports the complete missing set without installing any.
4. **Given** an administrator-authorized automatic policy, **When** the captured
   component identities or sources differ or host permission is denied, **Then**
   setup blocks rather than installing substitutes.

---

### User Story 7 - Understand current phase outcomes (Priority: P3)

As a workflow participant, I see current phase state, optional configured result
tags, progress, and clarification as distinct signals. A rerun updates the
current outcome instead of adding a duplicate result.

**Why this priority**: Accurate, configurable outcomes preserve the existing
canvas value without a second post-phase classification step.

**Independent Test**: Configure a global result and one phase override, run phases
with both supported result sources, rerun one phase, and verify tags, summaries,
clarification, and missing-result behavior.

**Acceptance Scenarios**:

1. **Given** no configured result contract, **When** a phase finishes, **Then**
   no result label is invented, while state, progress, and clarification still work.
2. **Given** one configured result source and a valid current result, **When**
   the phase succeeds, **Then** at most one tag appears and eligible summaries
   count the workflow item once.
3. **Given** a failed, stale, missing, or conflicting result report, **When**
   state is refreshed, **Then** no invalid tag replaces a valid settled outcome.

### Edge Cases

- A component is removed, disabled, reprioritized, or updated between opening
  Generate and confirming it: generation uses a fresh composition, not the stale
  preview or the model's recollection.
- The shared phase-output template has multiple active winners or an unsafe
  declared path: request preparation rejects it without writing a request.
  A selected phase without an override uses the shared default, not a
  hard-coded phase list.
- A design catalog entry lacks a matching installed package tag, a tagged package
  contributes a selected runtime phase, or a design bundle includes an untagged
  component: the Canvas Design flow rejects the mismatch without changing how
  Specify resolves artifacts.
- A locally installed package has no catalog entry: its installed package tag
  determines Wizard classification; an untagged package remains an ordinary
  runtime package even if it targets a generation artifact.
- A generation target, workspace, or asset is a symlink,
  points outside the allowed location, or exceeds bounds: the operation fails
  before changing the final target.
- A design package contributes a `canvas-renderer` template: generation rejects
  the unsupported presentation replacement before target mutation.
- A customer replaces the entire generation command: that replacement owns its
  behavior and is not represented as validated generator-owned output unless it
  meets the complete compatibility contract.
- An installation is denied, interrupted, or only partly successful: the canvas
  stays blocked and reports what remains; it does not claim readiness.
- A result field is unknown, an earlier phase reports after a rerun, or an
  unresolved clarification makes a phase stale: no inaccurate current result
  or summary is shown.
- A target is partly published or locked by the host: report the failure and
  allow a new Regenerate operation; never delete a broader directory.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The generator MUST be independently installable and usable through
  Copilot CLI without installing, opening, or retaining the Wizard.
- **FR-002**: The Wizard and Copilot CLI MUST collect or confirm phase selection
  and order, canvas identity, target, and replacement decision through their
  respective entry paths.
- **FR-003**: Both entry paths MUST produce equivalent workflow and experience
  behavior for equivalent confirmed choices and installed composition.
- **FR-004**: Generation MUST preserve the existing Wizard-generated canvas's
  supported phase execution, artifact viewing, project-level prerequisites,
  setup, and standalone behavior under default settings.
- **FR-005**: A generated canvas MUST retain everything required for its own
  operation without loading Wizard presentation files or the generation session.
- **FR-006**: Every Generate and Regenerate operation MUST capture current
  installed providers, their active composition and provenance, and the selected
  phase order once; subsequent changes MUST NOT alter that in-flight run.
  Request preparation MUST also resolve a versioned, author-declared output
  contract for every selected phase through the existing Specify template
  stack, then capture its normalized value, effective provider provenance,
  source path, and hash in the immutable request. The compiler MUST use only
  those captured bindings, unchanged.
- **FR-007**: The system MUST use one project and classify Canvas Design
  packages using the existing `canvas-design` tag in catalog entries and
  installed package manifests; untagged packages MUST remain ordinary runtime
  packages. Classification MUST NOT change Specify artifact identity, resolution,
  or precedence.
- **FR-008**: Packages classified as Canvas Design MUST be offered to Generate
  but omitted from the normal and generated runtime catalogs and workflow-phase
  selection, including catalog search and counts; the Composition page MAY
  show complete effective artifact stacks with design providers labeled or
  filtered without changing their resolution.
- **FR-009**: The Wizard MUST make the compatible generator a required Environment
  prerequisite, offer explicit update or retry for missing/outdated installation,
  and prevent Generate while that prerequisite is not ready.
- **FR-010**: The Phases page MUST retain the PR #32 Pipeline-header Generate
  button without generation fields on the page. Its Generate dialog MUST retain
  the applicable PR #32 canvas settings and show a separate searchable Canvas
  Design area for tagged presets, extensions, and design-only bundles whose
  installed components also carry the tag, with the required generator visible
  but not removable there.
- **FR-011**: Adding or removing an optional design component MUST take effect
  one at a time immediately, follow existing community trust confirmation, and
  update composition before the next generation; closing Generate MUST NOT undo
  completed component operations.
- **FR-012**: Design-time providers MUST be able to contribute supported
  generation guidance, independently replaceable complete experience
  categories, or one complete presentation package; only explicitly invoked
  design support commands may run.
- **FR-013**: Generator defaults MUST cover terminology and copy, theme and
  branding, layout, workflow interactions, phase/artifact presentation,
  results, and setup/onboarding without requiring optional design components.
- **FR-014**: Customer-owned complete category replacements MUST take precedence
  over bounded command-derived values; command-derived values MUST apply only
  to generator-owned categories; all other fields retain their resolved defaults.
- **FR-015**: Invalid, unknown, unsafe, or protected experience choices MUST
  fail validation rather than be ignored or change workflow order, execution,
  path authorization, or setup permissions.
- **FR-016**: A design provider MUST be able to configure a simple native
  confirmation before a phase runs; cancel MUST leave the phase unchanged and
  confirm MUST invoke the selected phase once. General-purpose forms and
  conditional field collection are out of scope.
- **FR-017**: The generator MUST independently own the sole PR #32-style
  horizontal phase presentation without importing the Wizard's live UI.
  Effective replacement renderer templates MUST be rejected.
- **FR-018**: The generator MUST reject unsupported workflow topology, missing
  commands or providers, ambiguous or unsafe *declared* outputs, unsafe paths,
  replacement renderer templates, and invalid configuration with actionable
  diagnostics. A missing output declaration MUST NOT block a callable command:
  a safe path in the effective skill may supply a best-effort hint, or the
  output remains unknown. An explicit transient declaration still means no
  single durable file to present. Unknown and transient results appear as
  "No artifact" until a real file can be verified. Hints MUST NOT be treated
  as proof that a file was produced;
  only workspace-confined existing artifacts may be presented as results.
- **FR-019**: Generation MUST validate the complete candidate's workflow
  equality, required and forbidden capabilities, package integrity, setup,
  configuration, and path confinement before publishing it.
- **FR-020**: Every controlled success or failure MUST have one authoritative
  outcome; an interrupted operation with no completed outcome MUST NOT be
  reported as successful.
- **FR-021**: Existing targets MUST require a confirmation showing the exact
  target and stating that all contained files, including manual edits, will
  be deleted; cancellation MUST leave that target unchanged.
- **FR-022**: Regeneration MUST use the current selected workflow and design
  composition to validate a fresh complete candidate, then replace only the
  exact confirmed generated-extension directory; it MUST NOT merge previous
  files, retain a backup, or delete workflow data outside that directory.
- **FR-023**: Publication, validation, or reload failures MUST be reported
  without claiming success; a subsequent ordinary Regenerate MUST be able to
  build a fresh candidate even if the prior target is partial or unrecognized.
- **FR-024**: The generated canvas MUST verify compatible Copilot plugin,
  Specify CLI, skills-mode project initialization, and reload support before
  offering workflow execution; it MUST NOT install the plugin or CLI.
- **FR-025**: Project initialization MUST be a distinct, read-only readiness
  check followed by a warned, explicit user-approved action when needed;
  cancellation or failure MUST leave setup blocked.
- **FR-026**: After foundation readiness, component setup MUST honor the
  captured `external`, `prompt`, or `automatic` policy, act only on the complete
  required runtime set, disclose sources and trust facts where approval is
  required, and recheck readiness after changes.
- **FR-027**: Automatic component setup MUST be limited to the administrator's
  exact captured dependency set and provenance; changes, denied permissions,
  or unavailable credentials MUST block setup without substitution.
- **FR-028**: Design-time-only packages MUST NOT become runtime prerequisites
  merely because they contributed to the generated presentation; effective
  workflow providers MUST remain runtime prerequisites.
- **FR-029**: Phase state, result tag, progress, and unresolved clarification
  MUST be independently derived from current evidence; reruns MUST replace
  settled results rather than accumulate duplicates.
- **FR-030**: A phase MUST have at most one optional configured result tag, with
  a global default and phase-specific replacement or disablement; no result
  label MUST be inferred when none is configured.
- **FR-031**: A configured result MUST come from either a declared artifact
  field or the original phase run's explicit report, without an additional
  classification run or automatic fallback to another source.
- **FR-032**: Missing, malformed, stale, or conflicting result evidence MUST
  produce no new tag and a visible diagnostic without turning an otherwise
  successful phase into a failure.
- **FR-033**: Summaries MUST count current completed workflow items once per
  configured result, exclude stale and unresolved phases, and count
  clarification and deterministic progress separately.
- **FR-034**: Generated application assets, required setup disclosures, and
  phase actions MUST remain accessible and usable in the supported light/dark
  and desktop/mobile experiences.
- **FR-035**: The system MUST record the effective generator,
  configuration providers, runtime dependencies, and integrity of generated
  files for compatibility and diagnostics without promising preservation of
  edits to generated output.
- **FR-036**: The generated runtime MUST authorize each action, confine file
  access, preserve host permissions, and avoid exposing credentials or private
  maintenance capabilities to untrusted callers.
- **FR-037**: The Wizard and generator MUST reject a Canvas Design addition
  when its catalog and installed package tags disagree, when a tagged package
  contributes a selected runtime phase command, or when a design bundle contains
  untagged or runtime-phase components; rejection MUST leave the component
  unadded, and classification MUST NOT alter Specify artifact precedence.

### Key Entities *(include if feature involves data)*

- **Generation Request**: One run's confirmed canvas identity, target,
  workflow selection and order, replacement decision, and captured composition.
- **Composition Snapshot**: One Specify-resolved set of installed providers,
  effective artifact stacks, active layers, versions, priority, source, and
  provenance, alongside captured installed-package tag classification for
  one run.
- **Workflow Blueprint**: Immutable phase order, effective commands, artifact
  contracts, project prerequisites, and runtime dependency set.
- **Experience Profile**: Complete resolved defaults and customer-owned settings
  for content, theme, layout, interactions, results, and onboarding.
- **Renderer**: The one selected presentation package with declared capabilities;
  consumes workflow state without owning protected execution or authorization.
- **Generated Canvas**: Standalone application and its generation receipt;
  replaceable as a whole, separate from durable workflow artifacts.
- **Phase Result**: Optional current configured outcome for one workflow item and
  phase, separate from phase state, progress, and clarification evidence.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In reference acceptance flows, 100% of supported linear
  workflows generated with defaults can open and run a selected phase in a
  compatible recipient repository without the Wizard.
- **SC-002**: For equivalent choices and installed components, Wizard and
  Copilot CLI generation yield the same selected phase order, runtime
  dependencies, and visible experience in 100% of comparison scenarios.
- **SC-003**: A ready user can generate, validate, install, reload, inspect,
  and open a default five-phase canvas in one uninterrupted workflow without
  manual file editing or restarting the generation process.
- **SC-004**: In every supported Canvas Design acceptance flow, users can
  locate and apply a design component and distinguish it from a runtime
  dependency without editing generated files.
- **SC-005**: In every acceptance scenario involving cancellation, invalid
  configuration, unsupported topology, or denied permission, no unapproved
  installation or target deletion occurs.
- **SC-006**: In every accepted replacement scenario, the user sees the exact
  target and all-files deletion warning before any existing target changes;
  cancel preserves 100% of its files.
- **SC-007**: After a phase rerun, each current workflow item contributes
  at most one configured phase result to summaries, and incomplete or stale
  evidence contributes zero.
- **SC-008**: In every supported generation or setup failure scenario, the
  user receives an actionable failure instead of a success indication.

## Assumptions

- The initial scope is supported linear workflows and scenarios grounded in
  Assess, Bugfix, SDD, and the existing Wizard canvas-generation behavior.
- Generator-owned output declarations cover supported core commands. Other
  callable commands can run without declarations; safe skill-derived output
  hints are best effort and do not make upstream packages provide contracts.
- The minimum compatible Specify version is determined from tests of its
  existing artifact and installed-package listing and manifest behavior;
  no unreleased composition-domain capability is a prerequisite.
- The Copilot host provides the supported canvas-authoring, scaffold, skill
  discovery, and reload capabilities; invoking a materializer without Copilot
  is not a supported user entry path.
- Existing Wizard community-confirmation and package-management semantics
  remain in force; this feature does not redesign trust confirmation.
- The first release has no arbitrary native forms, formula language,
  post-generation customization scripts, multiple simultaneous result tags,
  renderer-specific configuration system, or automatic second-pass result review.
- Generated output is disposable. Customers retain durable design changes in
  separately installed design components or separately owned source, and
  workflow artifacts remain outside the generated extension directory.
