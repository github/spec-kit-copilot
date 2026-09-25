# Data Model: Standalone Canvas Generator Extension

The entities below are design contracts, not a second Spec Kit registry.
Their canonical representation and versioned wire shapes are specified in
[contracts/](contracts/). Identifiers and fingerprints are validated by
extension-owned code, never inferred from agent prose.

## Composition and request entities

### Installed provider

An installed preset or extension with `id`, `version`, `priority`, `enabled`,
`source` (local or named catalog), declared contributions, installed manifest
path, and captured `tags`. The Wizard classifies packages with the
`canvas-design` tag for presentation; untagged packages are ordinary runtime
packages. Catalog entries independently carry tags for discovery. No tag
changes the package's identity or Specify's resolution.

**Relationships**: A provider contributes zero or more artifact stack layers.
Runtime providers required by selected phases become generated-app
dependencies; design providers contribute at generation only.

**Validation**: A Canvas Design Add requires catalog and installed manifest
tags to agree and rejects a package contributing a selected runtime phase.
Design-only bundles require every included preset/extension to qualify
individually. These are Wizard/generator eligibility checks, not Specify
registry mutation rules.

### Artifact stack

One artifact identity `(kind, name)`, with an ordered list of layers containing
provider ID, layer kind, strategy, active/hidden state, manifest path, lookup
ID, source path, and provenance. Specify alone determines effective precedence,
including stacks containing both tagged and untagged providers. No duplicate
tag-qualified artifact rows exist.

**Relationships**: Command stacks supply phase skills or the generator skill;
category and renderer stacks supply complete resolved files. A selected
renderer package's adjacent files are confined relative to its effective
manifest provider.

**Validation**: A source path must resolve to the installed artifact rather
than an inferred filename. Tagged providers selected for runtime phases cause
a package-specific generator validation failure, not a modified resolver result.

### Composition snapshot

One normalized, versioned view of the installed provider lists and artifact
stacks with `compositionFingerprint` and `packageClassifications` derived from
installed manifest tags. Captures provider identity, versions, priorities,
enabled state, sources, active/hidden layers, and paths, without splitting
Specify stacks into separate resolver domains.

**Relationships**: Both the Wizard's Composition cache and generation request
use the same captured snapshot. Wizard pipeline order is a separate overlay.

**Lifecycle**: Passive reads update the cache only after complete validation.
Package mutation invalidates it. Every Generate/Regenerate refreshes once;
later package changes affect the next request, not the in-flight one.

### Generation request

Immutable per-run authority: schema version, canvas ID/display name,
ordered selected phase IDs, exact composition snapshot, canonical workspace,
one validated phase-output binding per selected phase, derived target and
confirmed overwrite decision. One request ID identifies
the confined staging/control directory; a digest binds later overrides.

**Relationships**: Compiles to exactly one immutable blueprint; references
the resolved category providers and renderer selection through the captured
snapshot. Created by the same extension-owned normalizer for Wizard and CLI.

**Validation**: Reject unknown fields, invalid IDs, missing runtime skill
binding, unsupported workflow shape, fingerprint mismatch,
unsafe workspace, target escape, and design-tagged selected runtime phase
providers. The model may supply human choices, not reconstructed provider
stacks or inferred artifact paths.

### Phase-output contract and binding

One author-declared, versioned `phase-outputs` JSON template under existing
Specify `(template, name)` composition when available. Its `default` result
applies to any selected command not named in its `phases` map; packaged core
paths are overrides, not a restriction on phase selection. A preset replaces
the entire document, not individual entries. A result declares a Markdown
`pathTemplate` for `artifact`, explicit `transient` with no path, or `unknown`.
A normalized request binding records the selected result, provider, source path, source hash, and ordered
template stack. Without a template, it records a safe skill-derived `hint`
path or `unknown` output with no provider or template stack. Neither blocks
the phase. The generator supplies declarations for supported core commands.

**Validation**: Ambiguous, mismatched, unsafe, symlinked, or non-Markdown
declarations fail before request publication. Skill prose only supplies an
optional, safe hint, not a declared output. The compiler copies the bound
output metadata into the blueprint; only verified files become results.

### Command-derived override

Two representations: an agent-authored sparse draft containing only
`categories`, then an extension-owned finalized document with schema
version and `requestSha256`. Empty categories are valid. Only allowlisted
paths in the six generator-owned categories may be overridden.

**Relationships**: The finalized override belongs to exactly one request.
Customer-owned complete category documents suppress the corresponding
sparse patch with a warning; there is no field-level mixing.

**Validation**: Reject a digest or schema authority in the draft; reject
missing or mismatched final digest, unknown fields, protected fields,
`schemaVersion` patches, `null` deletion, invalid stable IDs, and
unsupported arrays/maps.

## Compiled application entities

### Pipeline blueprint

Schema v2 contract retained from PR #32: ordered linear steps, effective
commands and installed skill bindings, artifact path templates and
persistence signals, provider provenance, project-level Constitution
contract, required skills/presets/extensions, setup requirements, and
runtime capabilities.

**Relationships**: One blueprint per request; referenced by generated
runtime and hashed in the receipt. Selected phase order comes exclusively
from the request. Project-level prerequisites are not repeated as
workflow-item phases.

**Validation**: No branching topology, unsafe artifact path, added command,
phase reordering, or runtime-required design-only provider.

### Experience category and profile

Six complete category documents: `canvas-content`, `canvas-theme`,
`canvas-layout`, `canvas-interactions`, `canvas-results`, and
`canvas-onboarding`. Each has schema version, exactly one effective owner,
provider source/version/hash, and canonical supported fields. A profile
preserves all six objects under those names without a second runtime-specific
shape.

**Relationships**: Category defaults come from the generator; eligible
design presets/extensions may replace a complete document. Sparse overrides
apply only to categories still owned by the generator. A renderer consumes
the final profile.

**Validation**: Unknown keys, inaccessible colors, unsafe assets, unsupported
combinations, and attempts to configure protected workflow/setup semantics
fail. A change in resolved inputs changes the normalized profile hash.

### Renderer package

One versioned manifest with `id`, `runtimeApiVersion`, entry point/export,
declared files, and required host capabilities, plus adjacent static assets.
The generator default and customer replacement packages are independent of
the Wizard's live renderer.

**Relationships**: One selected renderer mounts against the protected host
API with the complete experience profile. It may alter presentation beneath
the mount root, not backend execution or authorization.

**Validation**: Confirm API compatibility, required capabilities, complete
setup disclosures, allowed file types/sizes, confined regular files and
symlink-free paths, and mock-API conformance. Renderer JavaScript is trusted
executable code, not a security sandbox.

### Generated canvas and generation receipt

The application contains a protected runtime, blueprint, experience profile,
one renderer, declared assets, and a scoped technical receipt. The receipt
records generator/template versions, request/blueprint/configuration hashes,
renderer identity/API version, provider provenance, exact runtime dependencies,
and the path/hash of every final generated file.

**Relationships**: A generated canvas is portable to a compatible repository;
its receipt supports inspection and diagnostics, not edit preservation.
Workflow/user artifacts remain outside the extension target.

**Lifecycle**: `absent -> candidate validated -> target installed -> provider
inspected -> opened`. For an existing target: `existing -> candidate validated
-> confirmation -> exact-target lock -> whole-target deletion ->
publication -> read-back/reload/inspection`. Cancellation leaves the target
unchanged; failure may leave it absent or partial, followed by a fresh
ordinary Regenerate. There is no backup or rollback state.

## Recipient runtime entities

### Setup requirement and approval

A blueprint-bound set of runtime presets/extensions, installed versions,
enabled state, priorities, required skills, catalog/source and trust facts,
and a dependency-set fingerprint. Foundation prerequisites (Copilot plugin,
Specify version, initialized skills-mode project, reload support) are
separate; the generated canvas never installs the plugin or CLI.

**Lifecycle**: `blocked foundation -> optional explicitly confirmed init ->
foundation ready -> runtime dependencies checked -> external/prompt/automatic
policy applied -> reload and verify -> ready`. A denied permission, source
drift, incompatible version, failed or partial installation remains blocked.
An approval in `prompt` binds to the complete set; `automatic` policy is
administrator-authored for the same exact set.

### Phase run and result evidence

Each run has an ephemeral run ID, selected phase and workflow item, execution
state, current/stale artifact evidence, and optionally one allowed
result ID from `artifact-field` or original-turn `phase-report`. The result
contract specifies label, allowed values and tones, source, and summary
eligibility. Clarification markers and numeric task progress are separate.

**Lifecycle**: `ready -> running -> succeeded/failed/cancelled`; a valid
pending phase report settles only after success. Rerun retains the prior
settled result while pending, replaces it on success, and never accumulates
duplicate summary counts. Stale, missing, invalid, older-run, or unresolved
clarification evidence contributes no current result. A successful transient
phase may have no artifact; an existing artifact does not prove dispatch.

### Generation outcome

One versioned authoritative `result.json` for each controlled success or
failure, written atomically as the final operation, with status, target,
provider summary, warnings, and stable failure code/details when relevant.
Its absence means interrupted, never successful. Once consumed, request
control files are removed by exact request ID; later startup cleans
interrupted request directories within bounded scope.
