# Implementation Plan: Standalone Canvas Generator Extension

**Branch**: `nicolehaugen-spec-kit-setup` | **Date**: 2026-09-23 |
**Spec**: [spec.md](spec.md)

**Input**: Feature specification from
`specs/001-canvas-generator-extension/spec.md`; detailed architecture and
acceptance material from the original Copilot-authored
[Canvas Generation as a Spec Kit Extension plan](../../docs/canvas-extension-original-plan.md).
This source document records the original proposal; the Spec Kit plan and
subsequent implementation decisions take precedence where they differ.
`SPECIFY_FEATURE_DIRECTORY=specs/001-canvas-generator-extension` selects
this feature independently of the Git branch name.

**Current configuration contract**: [Section 17 of the original plan](../../docs/canvas-extension-original-plan.md#17-revised-generation-configuration-and-result-behavior) replaces earlier six-category and per-command phase-output design in this draft. The generator implementation follows that section; previously generated canvases are not migrated.

## Summary

Extract the draft Wizard generation behavior in
[github/spec-kit-copilot#32](https://github.com/github/spec-kit-copilot/pull/32)
into a separately installable Spec Kit `pipeline-canvas-generator` extension.
The Wizard and Copilot CLI prepare the same immutable request from a freshly
captured Specify composition snapshot, including validated author-declared
phase-output contracts resolved from that snapshot. A single supported Copilot canvas-authoring
flow scaffolds a standalone candidate; extension-owned validation, compilation,
configuration, and renderer packaging refine that scaffold. After complete
validation, generation publishes one confined disposable target, reloads and
inspects the provider, and opens the canvas once. Optional Canvas Design
providers customize the generated experience, not the Wizard's live UI or the
protected runtime.

## Technical Context

**Language/Version**: Python for request preparation, schema checks, compiler,
materializer, and lifecycle scripts (`py` integration); JavaScript ES modules
for the Copilot canvas extension, protected runtime, renderer, and Wizard adapter.
Local development uses Python 3.12 and Node.js 22; minimum supported versions
must follow released Specify and host compatibility, not these local versions.

**Primary Dependencies**: Released Specify CLI with the existing artifact,
preset, and extension list JSON and preserved installed package manifests;
Copilot CLI/App with
`create-canvas`, extension scaffold/reload and SDK canvas support; installed
`spec-kit-copilot` plugin; Wizard plugin only for its optional adapter. No
additional generator runtime service.

**Storage**: Confined, ignored per-request staging and control files under
`.specify/.cache/canvas-generation/`; immutable compiled configuration and
technical generation receipt inside `.github/extensions/<canvas-id>/`. Durable
workflow artifacts remain outside the generated extension.

**Testing**: Python schema/compiler/validation and path-confinement tests;
existing Wizard `node --test` suite plus migrated PR #32 generated-runtime,
security, UI, and browser fixtures; contract tests for both host adapters,
renderer conformance, cross-entry equivalence, and acceptance flows.

**Target Platform**: Copilot CLI/App canvas hosts on Windows, macOS, and Linux;
destination repositories initialized for Copilot skills mode. Supported
generation requires Copilot's canvas-authoring host, not bare Python/Specify.

**Project Type**: Versioned Spec Kit extension, with a separate Wizard plugin
adapter and a portable generated Copilot canvas application.

**Performance Goals**: A ready user completes generation, validation,
installation, reload, inspection, and first open as one uninterrupted workflow,
without manual editing or restart (SC-003). No invented wall-clock SLA.

**Constraints**: Linear workflow only; one versioned `phase-outputs` template
resolved through Specify before request publication, with an unknown default
and optional per-command artifact/transient results; no unverified artifact
inference from workspace state or skill prose;
one `.specify` project and tag-based
Canvas Design classification without changing artifact resolution;
one active renderer; six versioned experience categories; one optional result
tag per phase; immutable request, blueprint, and protected runtime; exact-path
replacement confirmation; no silent fallback or backup. Size/time limits remain
bounded and tested implementation details, not public preset contracts.

**Scale/Scope**: Assess, Bugfix, SDD, and PR #32-grounded scenarios for v1.
Additional topology, arbitrary forms, executable customization expressions,
multiple result tags, and renderer-specific config are deferred.

## Constitution Check

*GATE: Evaluate before research and re-check after design.*

| Principles | Design gate | Status |
| --- | --- | --- |
| I-II, VIII-IX, XXIII | Independent Wizard/generator assets; one replaceable renderer; generated app standalone; protected backend; design-only providers materialized | PASS |
| III-V | Full request, guidance interpretation and validated brief precede the `create-canvas` call in the same agent turn; use supported scaffold; only bounded data-based overrides; reproducible semantics | PASS, sequencing detailed in research |
| VI-VII, XII-XIV, XXV | Wizard/CLI retain human choices; Specify owns precedence; one snapshot per run with provenance and package-tag classification for UI only; immutable blueprint | PASS |
| X-XI, XV, XIX-XX | Validate final candidate and explicit errors; permission-preserving setup; linear-only; reporting non-blocking | PASS |
| XVI-XVIII | Derive state from artifacts and settled runs; distinguish dispatch from completion; project prerequisites separate | PASS |
| XXI-XXII, XXIV | Disposable exact target, explicit confirmation; small semantic surface; immediate one-component Catalog operations | PASS |

**Specify compatibility gate**: The installed CLI exposes the three JSON list
commands. No composition-domain release is required: catalog and installed
manifest `canvas-design` tags classify packages for Wizard/generator presentation
and eligibility, never for resolution or artifact identity. Verify the earliest
released version supporting every JSON, installation, and manifest behavior used
by the implementation; set that tested minimum consistently in manifests,
Wizard Environment, standalone preflight, generated setup, tests, and docs.
Reject missing/malformed required data instead of reconstructing precedence.

**Source gate**: PR #32 is open and draft as of 2026-09-23; its generation
files are not in this checkout. Port from its pinned review commit (or merged
equivalent) only after source is available and parity fixtures are captured.

## Design Sequence

1. Verify existing Specify artifact/preset/extension JSON and installed-manifest
   contracts against released CLI versions. Normalize one resolved snapshot,
   augment it with bounded installed-manifest tag reads, and validate catalog
   versus package tags at the Wizard/generator boundary. Do not add an upstream
   resolver domain or a second Spec Kit project.
2. In this repository, define the extension manifest, request/snapshot,
   phase-output, override, experience, renderer, blueprint, receipt, and outcome contracts.
   Build shared extension-owned request preparation for Wizard and Copilot CLI.
   Resolve one effective `phase-outputs` template for the selected pipeline;
   bind each selected command's result, source path, digest, and Specify
   provider provenance to the request. Ship one generator-owned configuration
   with an unknown default and known core overrides; a preset replaces the
   entire document. A missing template or command override records either
   a safe best-effort skill-derived output hint or unknown output; neither
   blocks invocation. Explicit transient declarations remain distinct, and
   only existing workspace-confined files establish produced artifacts.
3. Port PR #32 compiler, generated backend, and parity fixtures into the
   extension with minimal initial movement. The old Wizard generation path
   remains the behavioral baseline until the adapter switches over. Adapt its
   compiler inputs to the request-bound output contracts; do not port the
   Wizard-only artifact-target inference cache as generation authority.
4. Compose the generation command through preset strategies; distinguish
   bounded supported command guidance from a full customer-owned replacement.
   Resolve six complete category documents and apply sparse guidance only to
   generator-owned categories.
5. Replace post-phase review with configured original-turn result reporting;
   add explicit recipient prerequisites and `external`/`prompt`/`automatic`
   runtime-component setup. Keep state, results, progress, and clarification
   distinct and evidence-derived.
6. Extract a generator-owned default renderer from the draft generated UI.
   Implement one versioned Canvas Runtime API through generated-runtime and
   isolated Wizard-preview adapters. Keep Wizard live presentation independent.
7. Validate and stage fresh candidates for both Generate and Regenerate. Lock
   only the exact target; require destructive confirmation for any existing
   directory; replace whole target without backup/rollback. Rebuild on ordinary
   Regenerate after failure.
8. Replace Wizard scanner/assembler with one direct machine-readable Specify
   snapshot and centrally filtered runtime/Canvas Design UI views. Reject
   catalog/manifest tag mismatch and tagged selected-phase contributors before
   a Canvas Design Add is accepted; verify design-only bundle members individually.
   Integrate Environment readiness and immediate Canvas Design catalog operations.
9. Publish tag-bearing Canvas Design catalog entries and package manifests, sample
   preset/extension fixtures,
   compatible release metadata, migration guidance, and platform/contract tests.

See [research.md](research.md) for source verification and tradeoffs,
[data-model.md](data-model.md) for entities and transitions,
[contracts/](contracts/) for wire and runtime interfaces, and
[quickstart.md](quickstart.md) for end-to-end validation.

## Project Structure

### Documentation (this feature)

```text
specs/001-canvas-generator-extension/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── checklists/requirements.md
└── contracts/
    ├── composition-and-generation.md
    ├── experience-and-renderer.md
    └── runtime-and-lifecycle.md
```

### Source Code (repository root; proposed, not created by this command)

```text
spec-kit-extensions/pipeline-canvas-generator/
├── extension.yml
├── README.md
├── commands/
│   ├── speckit.pipeline-canvas-generator.generate.md
│   ├── speckit.pipeline-canvas-generator.inspect.md
│   └── speckit.pipeline-canvas-generator.remove.md
├── scripts/
│   ├── python/
│   │   ├── canvas_generate.py
│   │   ├── canvas_inspect.py
│   │   └── canvas_remove.py
│   └── lib/
│       ├── artifact_snapshot.py     # Specify JSON + bounded manifest-tag reads
│       ├── request.py
│       ├── compiler.py
│       ├── contracts.py
│       ├── theme_asset.py
│       ├── receipt.py
│       ├── staging.py
│       └── validation.py
├── config/
│   ├── canvas-content.json
│   ├── canvas-theme.json
│   ├── canvas-layout.json
│   ├── canvas-interactions.json
│   ├── canvas-results.json
│   └── canvas-onboarding.json
├── templates/generated-canvas/
│   ├── extension.mjs
│   ├── runtime/
│   └── ui/                 # sole horizontal PR #32-style presentation
├── schemas/
│   ├── artifact-snapshot.schema.json
│   ├── generation-request.schema.json
│   ├── command-override.schema.json
│   ├── pipeline.schema.json
│   ├── canvas-{content,theme,layout,interactions,results,onboarding}.schema.json
│   ├── canvas-experience.schema.json
│   ├── generation-result.schema.json
│   └── generation-receipt.schema.json
└── tests/
    ├── contracts/
    ├── fixtures/
    ├── integration/
    └── unit/

spec-kit-extensions/catalog.json # tagged extension discovery

plugins/spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/
├── env/                         # prerequisite/version readiness
├── catalog/                     # existing installed-ID and trust flows
├── composition/                 # replace assembler/collect with snapshot adapter
├── canvas-runtime/              # state and actions; separate Wizard UI
├── server/                      # dispatch and progress/results
├── ui/                          # Generate Canvas Design area
└── test/                        # Wizard adapter and catalog regression

spec-kit-presets/catalog.json    # Copilot preset discovery stays inside preset root
spec-kit-bundles/catalog.json    # optional design-only bundle discovery
.github/plugin/marketplace.json  # component-specific release metadata
```

**Structure Decision**: The generator lives under `spec-kit-extensions/`
because Specify installs it, not the Copilot plugin manager. The Wizard adapter
stays under its existing plugin; it does not import the generated canvas UI.
`github/spec-kit` owns upstream CLI/registry changes in a separate
repository; no upstream change is required for tag classification. Do not mirror
Specify internals here. Declarative category templates customize the single
generated phase presentation; replacement renderer manifests are unsupported.

## Post-Design Constitution Check

The proposed data and interface contracts retain all pre-research PASS gates:
one project, one canonical composition authority with UI-only tag classification,
generated-UI/backend separation,
immutable captured workflow, final-output validation, portable setup,
exact-target confirmation, and evidence-derived state. The generated
configuration has no executable customization field. The command's optional
natural-language guidance is interpreted before the complete brief is handed
to `create-canvas`; extension-owned validation binds its persisted override to
the request before materialization. No justified constitution exceptions.
The tested Specify minimum-version and PR #32 source checks remain release
validation work; neither requires composition-domain support.
