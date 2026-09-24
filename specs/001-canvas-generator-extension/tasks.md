# Tasks: Standalone Canvas Generator Extension

**Input**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/), and [quickstart.md](quickstart.md).

**Tests**: The specification defines an independent test for every story; write the listed contract and journey tests before the corresponding implementation.

**Organization**: Tasks are grouped by user story. Paths are repository-relative. `spec-kit-extensions/pipeline-canvas-generator/` is a Specify extension, not a Copilot plugin; the Wizard remains under `plugins/spec-kit-copilot-wizard/`. Catalogs remain in their respective `spec-kit-extensions/`, `spec-kit-presets/`, and `spec-kit-bundles/` roots, as shown in the plan.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish the extension package and reviewable migration baseline without changing Wizard behavior.

- [X] T001 Pin the reviewed PR #32 source revision (or merged equivalent) and record the compiler, template, runtime, UI, and parity-fixture extraction map in `spec-kit-extensions/pipeline-canvas-generator/README.md`; do not invent absent source files.
- [X] T002 Create the Specify package manifest with `canvas-design` installed tags, generation/inspect/remove commands, six named experience JSON templates, a default renderer manifest, and generator-owned `phase-output-<UTF-8 command ID as lowercase hex>` JSON templates for supported core commands in `spec-kit-extensions/pipeline-canvas-generator/extension.yml`; document priority-100 installation.
- [X] T003 [P] Create Python entry point modes for request preparation, override finalization, and generation in `spec-kit-extensions/pipeline-canvas-generator/scripts/python/canvas_generate.py`; leave actual generation blocked until contract validation exists.
- [X] T004 [P] Set up extension-owned Python test discovery and baseline fixtures in `spec-kit-extensions/pipeline-canvas-generator/tests/README.md`; reuse the Wizard's `node --test` runner rather than adding a mandatory test framework.

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Define one immutable request and one validated composition boundary used by both entry paths.

**CRITICAL**: Finish this phase before starting story implementations. A request must never be assembled from model-transcribed Specify output.

- [X] T005 Verify the earliest released Specify CLI that supports the exact artifact/preset/extension JSON, installed-manifest, and installation contracts used here; record the tested version and fixtures in `spec-kit-extensions/pipeline-canvas-generator/tests/contracts/test_specify_json.py` without assuming composition-domain support.
- [X] T006 [P] Define strict snapshot, request with ordered `phaseOutputs`, phase-output declaration/binding, finalized-override, blueprint, result, and receipt schemas in `spec-kit-extensions/pipeline-canvas-generator/schemas/artifact-snapshot.schema.json`, `generation-request.schema.json`, `phase-output.schema.json`, `command-override.schema.json`, `pipeline.schema.json`, `generation-result.schema.json`, and `generation-receipt.schema.json`; preserve `(kind, name)` identity and the fields in `contracts/composition-and-generation.md`.
- [X] T007 [P] Add mixed-provider command and phase-output template stacks, installed tags, versioned output/transient declarations, and malformed-JSON contract fixtures in `spec-kit-extensions/pipeline-canvas-generator/tests/fixtures/composition/mixed-stack.json`, `installed-presets.json`, `installed-extensions.json`, and `invalid-response.json`; include local installs without catalog entries.
- [X] T008 Implement one normalizer for `specify artifact list --json`, `preset list --json`, and `extension list --json`, retaining full ordered stacks, active/hidden layers, versions, priority, paths, and provenance in `spec-kit-extensions/pipeline-canvas-generator/scripts/lib/artifact_snapshot.py`; never recalculate precedence.
- [X] T009 Read only the `tags` field from validated installed `preset.yml` and `extension.yml` when list JSON omits tags, classify untagged packages as runtime for presentation, and fingerprint the normalized snapshot plus classifications in `spec-kit-extensions/pipeline-canvas-generator/scripts/lib/artifact_snapshot.py`.
- [X] T010 Implement shared Wizard/CLI request preparation in `spec-kit-extensions/pipeline-canvas-generator/scripts/lib/request.py`: preflight the tested Specify minimum, capture one immutable snapshot, preserve selected phase order, and derive stable canvas ID/target. Bind any effective `phase-output-<UTF-8 command ID as lowercase hex>` Specify template with its validated Markdown-artifact or explicit transient result, provider provenance, source path, hash, and full ordered template stack. When absent, bind a safe skill-derived path hint or unknown output without blocking a callable command. Reject ambiguous, unsafe, or mismatched declarations and any `canvas-design` contributor to a selected runtime phase command; write no request on error. Keep Specify's resolution authority and do not treat hints as verified artifacts.
- [X] T011 [P] Define bounded path, symlink/reparse-point, declared-file, and package-root validation primitives in `spec-kit-extensions/pipeline-canvas-generator/scripts/lib/validation.py`.
- [X] T012 Implement request-scoped control paths and atomic write/read helpers beneath ignored `.specify/.cache/canvas-generation/<request-id>/` in `spec-kit-extensions/pipeline-canvas-generator/scripts/lib/staging.py`; never delete a broad cache/repository root or store reusable secrets.
- [X] T013 [P] Add schema and normalization tests for mismatched fingerprints, unknown fields, invalid IDs/paths, installed-manifest tags, mixed design/runtime stacks, unchanged Specify winners, phase-output template precedence and provenance/hash binding, durable/transient validation, missing/ambiguous/unsafe declarations, and T010 package/phase-specific rejection with no request written in `spec-kit-extensions/pipeline-canvas-generator/tests/contracts/test_request.py`.
- [X] T014 Wire the same request schema including phase-output bindings into Wizard and standalone adapters through the extension-owned preparation boundary in `spec-kit-extensions/pipeline-canvas-generator/scripts/python/canvas_generate.py`; neither adapter may run a second precedence assembler or output-path inference.

**Checkpoint**: A tested, immutable request can be prepared from existing Specify JSON without a Wizard-specific or tag-qualified resolver.

## Phase 3: User Story 1 - Generate a standalone workflow canvas (Priority: P1) MVP

**Goal**: Generate a supported linear canvas from Wizard-confirmed choices, then open and run it in a compatible ready repository without the Wizard.

**Independent Test**: Generate with defaults from a ready Wizard, transfer only the produced extension to a ready recipient repository, open it, run a phase, and view its artifact.

### Tests for User Story 1

- [X] T015 [P] [US1] Port pinned PR #32 Assess/Bugfix/SDD compiler and generated-runtime parity fixtures into `spec-kit-extensions/pipeline-canvas-generator/tests/fixtures/pipelines/`.
- [X] T016 [P] [US1] Add contract tests for linear phase order, request-bound declared outputs (including explicit transient), optional skill-derived hints and unknown outputs, project-level Constitution prerequisite, required runtime providers, unsafe/non-Markdown artifacts, and unsupported topology in `spec-kit-extensions/pipeline-canvas-generator/tests/contracts/test_pipeline.py`; never treat a Wizard cache or workspace file as output authority.
- [X] T017 [P] [US1] Add generated-canvas journey tests for default phase dispatch, artifact viewing, standalone startup, required/forbidden actions, and the empty `{"categories": {}}` draft finalized with the exact request digest before materialization in `spec-kit-extensions/pipeline-canvas-generator/tests/integration/test_default_canvas.py`; missing, draft-only, or mismatched finalized overrides must fail rather than fall back.

### Implementation for User Story 1

- [X] T018 [US1] Port the PR #32 compiler to `spec-kit-extensions/pipeline-canvas-generator/scripts/lib/compiler.py`, emitting its schema-v2 immutable linear `pipeline.json` from the captured snapshot, selected phase order, and unchanged request-bound phase-output contracts without executing phase skills or re-reading template files.
- [X] T019 [US1] Port the protected generated backend and project-artifact/runtime modules from the pinned source into `spec-kit-extensions/pipeline-canvas-generator/templates/generated-canvas/extension.mjs`, `runtime/workflow-adapter.mjs`, `runtime/phase-runs.mjs`, and `runtime/workspace-files.mjs`, keeping action authorization, dispatch/completion distinction, path confinement, and standalone behavior.
- [X] T020 [P] [US1] Package the extension-owned default frontend independently of the Wizard's live UI in `spec-kit-extensions/pipeline-canvas-generator/renderer/mount.mjs`, `renderer/renderer.json`, and `renderer/styles/workflow-theme.css`, with light/dark and responsive behavior and no runtime Wizard imports.
- [X] T021 [US1] Implement the same-turn `speckit.pipeline-canvas-generator.generate` authoring command in `spec-kit-extensions/pipeline-canvas-generator/commands/speckit.pipeline-canvas-generator.generate.md`: complete request and validated brief, invoke `create-canvas`, load the extension guide, obtain a fresh scaffold, write `command-override-draft.json` as `{"categories": {}}` for defaults, invoke `canvas_generate.py prepare-override`, and pass its request-bound `command-override.json` to the materializer. Document and implement an explicit invocation path for a distinct support command contributed by a Canvas Design extension only when the effective generation command (or a defined Generate action) names it; validate the named command against captured composition, its documented inputs and returned result, execute at most once per explicit invocation, and surface failures. Installing or reloading an extension must never execute its support commands; do not add automatic command hooks or pass the draft as materialization input.
- [X] T022 [US1] Validate the fresh `create-canvas` scaffold and refine rather than discard its SDK/session, canvas lifecycle, server, and actions foundation in `spec-kit-extensions/pipeline-canvas-generator/scripts/lib/staging.py`; fail before target mutation if authoring/scaffold capability is absent.
- [X] T023 [US1] Add complete generator-owned defaults in `spec-kit-extensions/pipeline-canvas-generator/config/canvas-content.json`, `canvas-theme.json`, `canvas-layout.json`, `canvas-interactions.json`, `canvas-results.json`, and `canvas-onboarding.json`, with basic complete-document validation in their corresponding `schemas/canvas-*.schema.json` files; default results include clarification/progress but no inferred tag.
- [X] T024 [US1] Implement shared `prepare-override` in `spec-kit-extensions/pipeline-canvas-generator/scripts/python/canvas_generate.py`: validate the draft has only `categories` (empty for defaults), calculate `requestSha256` from the immutable request, and atomically write the finalized override; materialize request-bound `pipeline.json`, six-category `canvas-experience.json`, default renderer, protected runtime, and assets only when that finalized file is present and request-bound, with no absent-override or phase-output inference fallback.
- [X] T025 [US1] Validate candidate blueprint equality, required/forbidden actions, scaffold contract, schemas, package integrity, final path confinement, and file bounds before publication in `spec-kit-extensions/pipeline-canvas-generator/scripts/lib/validation.py`.
- [X] T026 [US1] Record generator/configuration/renderer/provider provenance and all final generated-file hashes in `.speckit-canvas.json` via `spec-kit-extensions/pipeline-canvas-generator/scripts/lib/receipt.py`.
- [X] T027 [US1] Publish a new absent target only under `.github/extensions/<canvas-id>/`, perform read-back validation, reload, inspect the running provider, open once, and write one authoritative atomic `result.json` in `spec-kit-extensions/pipeline-canvas-generator/scripts/python/canvas_generate.py`; missing outcome means interruption.
- [X] T028 [US1] Connect Wizard generation confirmation and progress/result reporting to the extension-owned request and command in `plugins/spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/server/handlers-ops.mjs`, preserving Wizard-selected phase order and target.

**Checkpoint**: Defaults produce a portable generated canvas; no optional design package, runtime-component installation, or result tag is required to pass the ready-repository test.

## Phase 4: User Story 2 - Generate directly from Copilot CLI (Priority: P1)

**Goal**: Produce equivalent output through the separately installed generator without opening or installing the Wizard.

**Independent Test**: Install the generator alone in a ready project, invoke its skill from Copilot CLI, confirm missing human choices, and compare behavior with a Wizard generation from equivalent inputs.

### Tests for User Story 2

- [X] T029 [P] [US2] Add CLI-vs-Wizard request, normalized configuration, selected-order, and dependency equivalence fixtures in `spec-kit-extensions/pipeline-canvas-generator/tests/integration/test_entry_equivalence.py`.
- [X] T030 [P] [US2] Add negative tests for unsupported CLI version, missing canvas-authoring host, absent phase binding, bare Python/Specify invocation, and a `canvas-design` package installed directly through Specify that contributes to a selected runtime phase command in `spec-kit-extensions/pipeline-canvas-generator/tests/integration/test_cli_entry.py`; assert the package and phase/command are identified, no request is written, and Specify's effective stack is unchanged.

### Implementation for User Story 2

- [X] T031 [US2] Collect or confirm only missing ordered phases, canvas identity, target, and replacement choice before request preparation in `spec-kit-extensions/pipeline-canvas-generator/commands/speckit.pipeline-canvas-generator.generate.md`; never model-transcribe installed provider stacks.
- [X] T032 [US2] Implement standalone Specify JSON request preparation using the shared normalizer and generated skill bindings in `spec-kit-extensions/pipeline-canvas-generator/scripts/lib/request.py`, with no import of Wizard state.
- [X] T033 [US2] Route standalone generation through the same scaffold, compiler, candidate validation, receipt, outcome, reload/inspect/open sequence in `spec-kit-extensions/pipeline-canvas-generator/scripts/python/canvas_generate.py`.
- [X] T034 [US2] Document installation, skills reload, CLI invocation, author-declared phase-output template naming/ownership and incompatibility diagnostics, capability errors, and transfer without Wizard in `spec-kit-extensions/pipeline-canvas-generator/README.md`.

**Checkpoint**: The CLI and Wizard entry paths are independently usable but share the same generation contract.

## Phase 5: User Story 3 - Reuse a customized canvas design (Priority: P2)

**Goal**: Replace supported complete experience categories or the whole frontend without changing the selected runtime workflow or protected backend.

**Independent Test**: Apply a tagged design package changing terminology, theme, layout, and pre-run confirmation; cancel and confirm the latter; verify an independent runtime preset still owns the selected phase command.

### Tests for User Story 3

- [X] T035 [P] [US3] Add tests for customer-derived nonempty sparse `categories` drafts using the US1 `prepare-override` path, complete-category ownership, unknown/protected key and null rejection, array replacement, and phase-ID-map merging in `spec-kit-extensions/pipeline-canvas-generator/tests/contracts/test_experience.py`; in `spec-kit-extensions/pipeline-canvas-generator/tests/integration/test_design_support_command.py` verify install/reload only exposes a distinct design support command, an explicitly named generation-time invocation with documented inputs runs exactly once and validates its result, and a failed invocation surfaces an error.
- [X] T036 [P] [US3] Add renderer manifest, declared asset, API capability, setup-disclosure, and replacement conformance tests in `spec-kit-extensions/pipeline-canvas-generator/tests/contracts/test_renderer.py` and `tests/contracts/test_setup_renderer.py`.
- [X] T037 [P] [US3] Add pre-run Cancel/no-dispatch and Confirm/one-effective-skill-dispatch integration tests in `spec-kit-extensions/pipeline-canvas-generator/tests/integration/test_confirmation.py`.

### Implementation for User Story 3

- [X] T038 [US3] Extend the six complete-document schemas from US1 with strict command-override allowlists, one canonical owner/path per setting, and rejection of executable expressions or unused presentation selectors in `spec-kit-extensions/pipeline-canvas-generator/schemas/canvas-content.schema.json`, `canvas-theme.schema.json`, `canvas-layout.schema.json`, `canvas-interactions.schema.json`, `canvas-results.schema.json`, and `canvas-onboarding.schema.json`.
- [X] T039 [US3] Extend the existing US1 `prepare-override` validation in `spec-kit-extensions/pipeline-canvas-generator/scripts/python/canvas_generate.py` to accept customer-derived sparse category values on the same draft/finalization path; reject model-supplied digest/schema, protected or unknown fields, and never introduce another finalizer or an absent-override fallback.
- [X] T040 [US3] Resolve full category templates through captured Specify stacks, suppress a command patch for a customer-owned category with a warning, and merge only allowlisted scalar, whole-array, and stable-ID-map leaf values in `spec-kit-extensions/pipeline-canvas-generator/scripts/lib/category_contracts.py`.
- [X] T041 [US3] Implement confined logo and renderer resource resolution (default, PNG/JPEG/WebP asset, none; declared files, dimensions/bytes, symlink and path checks) in `spec-kit-extensions/pipeline-canvas-generator/scripts/lib/renderer.py`.
- [X] T042 [US3] Define numeric v1 renderer manifest and `mountCanvas({root,api,config})` package contract in `spec-kit-extensions/pipeline-canvas-generator/renderer/renderer.json`; support exactly one active renderer.
- [X] T043 [P] [US3] Implement the versioned protected `CanvasRuntimeApiV1` snapshot, subscription, capability and normalized action-result interface in `spec-kit-extensions/pipeline-canvas-generator/runtime/canvas-runtime-api.mjs`.
- [X] T044 [US3] Implement the generated-runtime host adapter and backend-authorized actions in `spec-kit-extensions/pipeline-canvas-generator/runtime/generated-runtime-adapter.mjs`; renderers receive no credentials, private routes, or maintenance capabilities.
- [X] T045 [US3] Add an isolated Wizard preview/conformance adapter in `plugins/spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/canvas-runtime/renderer-preview.mjs`; do not load generator renderer files into the Wizard's live UI.
- [X] T046 [US3] Render supported categories and native phase confirmation in `spec-kit-extensions/pipeline-canvas-generator/renderer/mount.mjs`; keep setup facts protected and accessible under light/dark, desktop/mobile, and keyboard navigation.

**Checkpoint**: Changing design inputs changes generated presentation; protected workflow, setup authorization, and Wizard live UI remain unchanged.

## Phase 6: User Story 4 - Manage Canvas Design separately (Priority: P2)

**Goal**: Discover eligible design packages in Generate and apply immediate one-at-a-time Add/Remove without contaminating runtime catalog/phase surfaces.

**Independent Test**: Add and remove a tagged preset and design-only bundle, check trust confirmation, post-install tags, catalog/search/count filtering, unchanged Specify stacks, and next-generation effect.

### Tests for User Story 4

- [X] T047 [P] [US4] Add Wizard tests for catalog/installed tag mismatch, local installs, untagged runtime packages, selected-phase contributors, mixed bundle rejection without retained additions, and Add/reload making a design support command available without executing it in `plugins/spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/test/catalog.test.mjs`.
- [X] T048 [P] [US4] Add Specify-JSON cache/priority regression tests for tag filtering without precedence changes or agent-transcribed composition in `plugins/spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/test/composition.test.mjs`.
- [X] T049 [P] [US4] Add Environment and Generate dialog tests for required generator, priority-100 repair, immediate one-component operations, community confirmation, and reload in `plugins/spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/test/env.test.mjs`.

### Implementation for User Story 4

- [X] T050 [US4] Replace Wizard `composition/assembler.mjs` and `composition/collect.mjs` as precedence authorities with a shared cached Specify-JSON snapshot in `plugins/spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/composition/snapshot.mjs`; retain original effective stacks and invalidate after mutations.
- [X] T051 [US4] Route passive artifact/preset/extension reads through existing direct `specifyRun(...)`, use bounded installed-manifest tag reads solely for classification, and refresh one cache on Generate/Regenerate in `plugins/spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/catalog/shared.mjs`.
- [X] T052 [US4] Filter ordinary Catalog and phase pickers in `plugins/spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/ui/catalog.js` and `ui/phase-runtime.js` before search, counts, recommendations, updates, and installation; do not alter effective stacks. The generated canvas has no runtime catalog or `runtime/catalog-runtime.mjs` (setup only inspects captured components), so there is no generated catalog to filter.
- [X] T053 [US4] Implement Canvas Design eligibility validation for matching catalog/installed tags, selected-phase command contributors, and every design bundle member in `plugins/spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/catalog/design.mjs`; preflight available package manifests, verify installed manifests before marking Added, ensure rejection leaves no newly added component, and report package/artifact errors without changing Specify resolution.
- [X] T054 [US4] Use existing catalog skill-based Add/Remove, community prompt, reload, cache refresh, and bundle ownership rules for one immediate operation at a time in `plugins/spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/canvas-runtime/actions/catalog.mjs`; closing Generate does not undo completed operations.
- [X] T055 [US4] Render the searchable Presets/Extensions/Bundles design area, generator Added/Required state, and busy/failure card states in `plugins/spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/ui/modals.js`.
- [X] T056 [US4] Install a missing first-party generator at extension priority 100 in Environment, repair disabled/wrong-priority installations without reinstalling, and gate Generate on its compatible version and the tested Specify minimum; expose Update/Retry instead of lazy Generate installation in `plugins/spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/env/deps-check.mjs`.
- [X] T057 [US4] Publish the tagged generator catalog entry in `spec-kit-extensions/catalog.json` and add that first-party URL to the fixed source table in `plugins/spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/catalog/sources.mjs`; do not discover arbitrary user-configured sources.
- [X] T058 [US4] Publish/sample tagged package and design-only bundle metadata in `spec-kit-presets/catalog.json`, `spec-kit-extensions/catalog.json`, and `spec-kit-bundles/catalog.json`, with individually tagged installed-manifest fixtures in `spec-kit-extensions/pipeline-canvas-generator/tests/fixtures/design-packages/`; never place a preset catalog at repository root.
  - Source metadata, canonical release build, fixture validation, and clean-project install from an independently installed local preset are verified. A live catalog-based install is a post-release check once the versioned ZIPs are published.

**Checkpoint**: Design selection is an immediate Wizard catalog operation; runtime catalog surfaces stay runtime-focused without changing the single Specify registry or resolver.

## Phase 7: User Story 5 - Regenerate without silently losing edits (Priority: P2)

**Goal**: Validate a fresh candidate first, then replace only the exact explicitly confirmed generated target without preserving manual edits.

**Independent Test**: Cancel and confirm replacement of recognized and unrecognized targets with manual files; simulate locked/partial publication and recover through ordinary Regenerate without touching workflow data outside the target.

### Tests for User Story 5

- [X] T059 [P] [US5] Add confirmation, exact-path deletion, symlink/reparse, concurrent-lock, cancelled, partial-publication, and recovery tests in `spec-kit-extensions/pipeline-canvas-generator/tests/integration/test_regeneration.py`.
- [X] T060 [P] [US5] Add receipt integrity and recognized-target removal tests in `spec-kit-extensions/pipeline-canvas-generator/tests/contracts/test_lifecycle.py`.

### Implementation for User Story 5

- [X] T061 [US5] Build a fresh `create-canvas` scaffold under a unique temporary extension name, move it into confined request staging without reload, and refine through the same candidate path as Generate in `spec-kit-extensions/pipeline-canvas-generator/scripts/lib/staging.py`; never use the old target as source.
- [X] T062 [US5] Show the exact target and all-files/manual-edits deletion warning for every existing target, including partial/unrecognized output, before acquiring a mutation lock in `spec-kit-extensions/pipeline-canvas-generator/commands/speckit.pipeline-canvas-generator.generate.md`.
- [X] T063 [US5] Lock the exact canvas target, recheck confinement and confirmation, delete only that confirmed directory, publish the validated candidate, and report sharing/partial/reload failures without backup or rollback in `spec-kit-extensions/pipeline-canvas-generator/scripts/python/canvas_generate.py`.
- [X] T064 [US5] Implement receipt-based inspect and confirmed recognized-target remove without following links in `spec-kit-extensions/pipeline-canvas-generator/scripts/python/canvas_inspect.py`, `scripts/python/canvas_remove.py`, `commands/speckit.pipeline-canvas-generator.inspect.md`, and `commands/speckit.pipeline-canvas-generator.remove.md`.
- [X] T065 [US5] Add Wizard ordinary Regenerate action after any failed, absent, partial, or unrecognized target in the Phases Generate dialog; do not introduce a separate retry or rollback state.

**Checkpoint**: Cancellation is nondestructive; confirmed replacement is whole-directory and recoverable by a fresh ordinary run.

## Phase 8: User Story 6 - Start safely in another repository (Priority: P2)

**Goal**: Make foundation and runtime-component readiness explicit and permission-preserving in transferred canvases.

**Independent Test**: Open the same canvas in ready, uninitialized, externally managed, partially prepared, and denied-permission repositories under all three component policies.

### Tests for User Story 6

- [X] T066 [P] [US6] Add readiness tests for plugin/CLI versions, `.specify/init-options.json`, Copilot skills-mode files, reload capability, cancellation, and warned initialization in `spec-kit-extensions/pipeline-canvas-generator/tests/integration/test_foundation.py`.
- [X] T067 [P] [US6] Add external/prompt/automatic policy tests for complete-set disclosure, exact source/version/priority/skill fingerprints, host denial, source drift, and partial installation in `spec-kit-extensions/pipeline-canvas-generator/tests/integration/test_setup_policy.py`.
- [X] T068 [P] [US6] Add renderer setup-disclosure accessibility and no-partial-approval conformance tests in `spec-kit-extensions/pipeline-canvas-generator/tests/contracts/test_setup_renderer.py`.

### Implementation for User Story 6

- [X] T069 [US6] Implement read-only foundation probe for compatible plugin/Specify, Copilot skills-mode initialization evidence, and reload support in `spec-kit-extensions/pipeline-canvas-generator/templates/generated-canvas/runtime/setup-runtime.mjs`; never install plugin or CLI.
- [X] T070 [US6] Expose explicit destination-user confirmation warning for `specify init --here --force --integration copilot --integration-options="--skills" --script py --ignore-agent-tools`, then reload and reprobe, in `spec-kit-extensions/pipeline-canvas-generator/templates/generated-canvas/runtime/setup-runtime.mjs`.
- [X] T071 [US6] Capture only effective phase-provider presets/extensions, required skills, and exact provenance/fingerprint as runtime setup requirements in `spec-kit-extensions/pipeline-canvas-generator/scripts/lib/compiler.py`; exclude presentation-only packages.
- [X] T072 [US6] Implement `external` (no install), `prompt` (one all-or-nothing approval), and administrator-authorized `automatic` (exact-set only) in `spec-kit-extensions/pipeline-canvas-generator/templates/generated-canvas/runtime/approval-runtime.mjs`, always honoring host permission and rechecking readiness.
- [X] T073 [US6] Render immutable dependency identity, source/trust/executable facts and mandatory community warning beside bounded customization copy in the protected host `templates/generated-canvas/ui/setup-view.mjs`; never let a renderer hide required facts.

**Checkpoint**: Transferred canvas blocks on unmet foundation and dependencies; it never claims success after a denial, cancellation, or partial install.

## Phase 9: User Story 7 - Understand current phase outcomes (Priority: P3)

**Goal**: Expose one optional configured result per phase separately from execution state, progress, and clarification, with correct rerun summaries.

**Independent Test**: Configure global and phase-specific results using both supported sources, rerun a phase, and verify current tags, one-item counts, clarification, and missing/conflicting result diagnostics.

### Tests for User Story 7

- [X] T074 [P] [US7] Add result-schema tests for no default tag, finite values/tones, global default, per-phase replace/disable, one explicit source, and rejection of computed or multiple simultaneous results in `spec-kit-extensions/pipeline-canvas-generator/tests/contracts/test_results.py`.
- [X] T075 [P] [US7] Add original-turn `phase-report` tests in `spec-kit-extensions/pipeline-canvas-generator/tests/integration/test_phase_report.py`: only configured phases receive the active canvas instance ID, current `phaseRunId`, allowed result IDs, and instructions to invoke `report_phase_result` via `invoke_canvas_action` before that same turn completes; `artifact-field` and unconfigured phases receive none of this context. Test accepted run/result binding, idempotent repeats, conflicting/older reports, failure/cancel, missing evidence, and no second classification turn or source fallback.
- [X] T076 [P] [US7] Add evidence-derived rerun, stale downstream, unresolved clarification, artifact-field, task-progress, and distinct-workflow count tests in `spec-kit-extensions/pipeline-canvas-generator/tests/integration/test_result_summary.py`.

### Implementation for User Story 7

- [X] T077 [US7] Define v1 `canvas-results` global/phase-specific contract with optional single `artifact-field` or `phase-report` source and no inferred labels in `spec-kit-extensions/pipeline-canvas-generator/schemas/canvas-results.schema.json`.
- [X] T078 [US7] Implement the complete original-turn `phase-report` protocol in `spec-kit-extensions/pipeline-canvas-generator/templates/generated-canvas/runtime/phase-runs.mjs` and `runtime/phase-results.mjs`: only when the configured source is `phase-report`, pass the active canvas instance ID, current `phaseRunId`, allowed result IDs, and instructions to call `report_phase_result` through existing `invoke_canvas_action` before that same phase turn completes. Accept only an allowed result for the active run, make same-value repeats idempotent, reject conflicting/stale reports, settle pending evidence only after success, and show a diagnostic rather than failing a successful phase when evidence is missing. Never inject reporting context for `artifact-field` or unconfigured phases, launch a second classification turn, register another SDK tool, or fall back between sources.
- [X] T079 [US7] Derive current result, phase state, clarification, and deterministic progress independently from settled run and artifact evidence; exclude stale/unresolved results and count each workflow item once in `spec-kit-extensions/pipeline-canvas-generator/templates/generated-canvas/runtime/phase-runs.mjs`.
- [X] T080 [US7] Render at most one tag with semantic tone and accessible attention/critical changes without inventing a missing result in `spec-kit-extensions/pipeline-canvas-generator/renderer/components/phase-view.mjs`.
- [X] T081 [US7] Render workflow-card and aggregate result counts computed from current items rather than mutable event totals in `spec-kit-extensions/pipeline-canvas-generator/renderer/components/workflow-collection.mjs`.

**Checkpoint**: A successful phase can have no result tag; stale or malformed evidence cannot inflate summaries or change successful execution into failure.

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Validate integrated release compatibility, documentation, and portability after desired stories land.

- [X] T082 [P] Publish Canvas Design authoring, command strategies, category ownership, bundle eligibility, renderer trust, and runtime-package separation in `spec-kit-extensions/pipeline-canvas-generator/README.md`.
- [X] T083 [P] Document Wizard Environment/Generate migration and independently versioned generator metadata in `plugins/spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/README.md` and `.github/plugin/marketplace.json`; do not bump unrelated plugins.
- [X] T084 [P] Add cross-host API contract and mock replacement-renderer conformance tests in `plugins/spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/test/renderer-api.test.mjs`, exercising both the generated and isolated Wizard adapters.
- [X] T085 [P] Add Windows and macOS/Linux path, symlink, setup, and transfer coverage in `spec-kit-extensions/pipeline-canvas-generator/tests/integration/test_portability.py`.
- [X] T086 Complete the [quickstart](quickstart.md) default five-phase uninterrupted generate/validate/install/reload/inspect/open acceptance flow without manual edits or an arbitrary time limit; record reproducible invocation steps in `specs/001-canvas-generator-extension/quickstart.md`.
- [X] T087 Confirm the tested Specify minimum is identical in extension manifest, Wizard gate, standalone preflight, generated setup, tests, and documentation in `spec-kit-extensions/pipeline-canvas-generator/README.md`.

## Dependencies & Execution Order

- **Setup (Phase 1)** precedes **Foundational (Phase 2)**; every story depends on the shared request/snapshot and validation boundary. T005 is the released-CLI compatibility evidence for T010 and Wizard/recipient version gates.
- **US1 (Phase 3)** is the first independently demonstrable increment in an already ready recipient repository; **US2** depends on its shared generator and adds the standalone CLI entry.
- **US3** depends on the US1 generated runtime, renderer, and always-present request-bound override finalizer; it extends the draft's category values rather than adding a separate finalization path. **US4** depends on the shared snapshot and extension packaging, and can run alongside US3 after US1; it must integrate with US3 before customized Generate acceptance.
- **US5** depends on the US1 candidate builder but can progress alongside US3/US4. **US6** depends on the US1 blueprint/runtime and can progress alongside US4/US5. **US7** depends on US1 phase dispatch and can progress alongside US4/US5/US6.
- **Polish** follows the desired story increments; final quickstart coverage requires all seven. PR #32 extraction and tested Specify minimum are release checks, not an unreleased upstream composition-domain dependency.

## Parallel Execution Examples

| Story | Independent tasks after prerequisites |
| --- | --- |
| US1 | T015 compiler fixtures, T016 blueprint tests, T017 generated journey tests; T020 default renderer can proceed separately from T018 compiler. |
| US2 | T029 equivalence fixtures and T030 failure tests can proceed together before shared CLI wiring. |
| US3 | T035 category, T036 renderer, and T037 confirmation tests are independent; T043 runtime API can proceed while T038 schemas are defined. |
| US4 | T047 catalog, T048 composition, and T049 Environment tests target separate files; implementation shares catalog/UI surfaces and should be integrated serially. |
| US5 | T059 regeneration journey and T060 receipt tests are independent before mutation logic. |
| US6 | T066 foundation, T067 policy, and T068 renderer disclosure tests can proceed together. |
| US7 | T074 schema, T075 action, and T076 summary tests can proceed together before runtime integration. |

## Implementation Strategy

1. **MVP**: Complete Setup, Foundational, then US1; verify the ready-repository independent test before adding optional design or recipient setup.
2. **Standalone entry**: Add US2 without importing Wizard state; compare outputs from equivalent requests.
3. **Design and lifecycle**: Add US3/US4 for customization/catalog and US5 for safe regeneration; integrate at the shared request and renderer contracts.
4. **Recipient operation**: Add US6 foundation/setup policies, then US7 configured results. Run cross-cutting conformance and portability checks before release.

**Task discipline**: `[P]` means different files and no dependency on another incomplete task in that parallel group. Within each story, write its tests before implementation; execute nonparallel tasks in their listed order. Preserve the single Specify-resolved stack and immutable per-run snapshot in every increment.
