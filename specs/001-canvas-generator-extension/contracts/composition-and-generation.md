# Contract: Composition, Request, and Generation

**Status**: Proposed v1 wire contracts; implement with strict bundled schemas.
No composition-domain API is required. See
[research](../research.md#r1-existing-specify-contracts-and-tag-classification).

## Specify JSON inputs and Canvas Design classification

Use three machine-readable reads per fresh composition capture:

```text
specify artifact list --json
specify preset list --json
specify extension list --json
```

`artifact list` returns one `(kind, name)` row with its full ordered `stack`;
installed-package lists include IDs, version, priority, enabled state,
`source`, and contributions. When these JSON rows omit tags, the Wizard reads
only `tags` from each installed `.specify/presets/<id>/preset.yml` and
`.specify/extensions/<id>/extension.yml`. Each stack layer retains
`sourceId`, `layer`, `strategy`, `active`, `hidden`, `manifestPath`,
`lookupId`, and concrete `sourcePath`. No new resolver field, tag-filter
query, or duplicate tag-qualified artifact row is needed.

Catalog entries tagged `canvas-design` drive discovery; installed package
manifest tags drive classification, including local installs with no catalog
entry. The Wizard and generator reject a Canvas Design Add when catalog and
installed tags disagree, when a tagged component contributes a selected
runtime phase, or when a tagged bundle includes an untagged/runtime-phase
component. Untagged providers remain ordinary runtime providers, even if
they target a generation artifact. These are eligibility checks at the
Wizard/generator boundary, not new Specify installation or precedence rules.
The required generator is tagged in both its catalog entry and extension
manifest, installed through Environment at priority 100, and never removable
from the Generate dialog.

**Precedence**: project override -> presets -> extensions -> core.
Compare numeric priority within a tier, not across tiers; lower
number wins. The base generator is an extension at priority 100, allowing
default-priority customer extensions to replace non-command templates
without shadowing higher-tier presets. Customer composition of the
existing generator command uses presets because extension command-name
collisions are rejected.

## Normalized snapshot

Extension-owned preparation validates and fingerprints the canonical normalized
Specify JSON together with installed-manifest tag classification:

```json
{
  "schemaVersion": 1,
  "compositionFingerprint": "<sha256-of-canonical-normalized-snapshot>",
  "providers": [],
  "artifacts": [],
  "packageClassifications": [
    {
      "id": "pipeline-canvas-generator",
      "kind": "extension",
      "tags": ["canvas-design"],
      "classification": "canvas-design",
      "manifestPath": "<installed extension.yml path>"
    }
  ]
}
```

Each provider includes exact ID/version/priority/enabled/source; each artifact
includes `(kind, name)`, ordered stack with active/hidden state, and concrete
source/manifest paths. Classification entries include kind, ID, tags, and
validated manifest path; they do not have their own artifact winners.
Source paths are resolved only under validated installed provider roots.
A Wizard cache refresh uses this object for Composition and pipeline
derivation; a Generate/Regenerate confirmation refreshes once more and writes
the request from the same snapshot. CLI request preparation uses the same
normalization. Failed reads preserve the prior validated Wizard cache and
write no request.

## Authoritative request and output

One immutable `request.json` per run, prepared by extension-owned code:

```json
{
  "schemaVersion": 1,
  "canvas": { "id": "assess-workflow", "displayName": "Assess Workflow" },
  "workflow": {
    "selectedPhases": ["speckit.assess.intake", "speckit.assess.decide"],
    "categoryTemplates": {
      "<each of six canvas-* names>": {
        "document": { "schemaVersion": 1 },
        "provider": { "kind": "preset", "id": "<owner>", "version": "<version>" },
        "sourcePath": "<installed-template-path>",
        "sha256": "<sha256-of-exact-template-bytes>",
        "templateStack": []
      }
    },
    "phaseOutputs": [
      {
        "phaseId": "speckit.assess.intake",
        "contract": {
          "schemaVersion": 1,
          "commandName": "speckit.assess.intake",
          "result": {
            "kind": "artifact",
            "pathTemplate": ".specify/assessments/<slug>/intake.md"
          }
        },
        "provider": {
          "kind": "extension",
          "id": "assess",
          "version": "<installed-version>"
        },
        "sourcePath": ".specify/extensions/assess/config/phase-output-intake.json",
        "sha256": "<sha256-of-exact-template-bytes>",
        "templateStack": []
      }
    ],
    "artifactSnapshot": {
      "schemaVersion": 1,
      "compositionFingerprint": "<sha256>",
      "providers": [],
      "artifacts": [],
      "packageClassifications": [
        {
          "id": "pipeline-canvas-generator",
          "kind": "extension",
          "tags": ["canvas-design"],
          "classification": "canvas-design",
          "manifestPath": "<installed extension.yml path>"
        }
      ]
    }
  },
  "workspace": "<canonical-workspace-path>",
  "overwrite": false
}
```

`selectedPhases` and the single illustrative `phaseOutputs` entry above do
not constitute a complete Assess workflow fixture; a real request has exactly
one binding per selected phase in the same order. The `sourcePath` above is
illustrative and requires a corresponding author-declared file; it is not a
claim that the current upstream Assess extension ships it. Match the final
per-step representation to
the migrated PR #32 linear compiler while retaining this authority and
order. Only the Wizard/CLI supplies phase selection, identity, target, and
overwrite; only Specify supplies composition. The target is derived as
`.github/extensions/<canvas-id>/` beneath the canonical workspace.

When the Wizard's Generate dialog supplies its installation-consent choice,
the request includes `settings.requireInstallationApproval`. It determines
`prompt` or `automatic` installation mode unless the selected design category
requires `external` installation; standalone CLI requests may omit it.
Canvas Design categories own workflow copy, result labels, clarification, and
slug behavior. Materialization binds those selected values to the generated
blueprint and workflow configuration, without duplicate presentation controls
on the Phases page or in the Generate dialog.

`categoryTemplates` has all six complete category keys. Each template resolves
one effective `replace` provider through the captured `(template, name)`
stack; absent template rows use the generator's packaged default. A bound
document and exact source digest travel in the request, so materialization
cannot reread a mutated installed template. A command override targeting a
customer-owned category is validated but suppressed as a whole, with its
warning and original provider recorded in the receipt and outcome.
An effective `canvas-renderer` template is unsupported and fails request
preparation. The generated canvas always uses its packaged horizontal phase UI.

### Selected phase-output contracts

For each selected command `phaseId`, encode its UTF-8 bytes as lowercase hex
and resolve one `(template, phase-output-<hex>)` artifact from the **same**
captured Specify snapshot. This injective template name uses only characters
accepted by released Specify; no separate resolver, catalog, or inference
path is introduced. Every author-declared template contains exactly:

```json
{
  "schemaVersion": 1,
  "commandName": "speckit.assess.intake",
  "result": {
    "kind": "artifact",
    "pathTemplate": ".specify/assessments/<slug>/intake.md"
  }
}
```

For phases without a durable artifact, declare
`"result": {"kind": "transient"}` explicitly. The `artifact` variant requires
one workspace-confined Markdown path template; `transient` forbids any path.
Generator-owned templates cover supported core commands. A preset wrapper
does not need to redeclare the core output. For commands without a template,
record either a safe skill-derived Markdown path hint or an unknown output;
neither blocks invocation. An explicit transient declaration remains distinct
from an unknown output. Validate any declared template's `commandName`, schema,
supported placeholders, source location, regular file bounds, and unique
effective winner. A mixed-provider stack remains intact; declared bindings
retain the ordered `templateStack`, effective provider kind/ID/version,
source path, and SHA-256 of source bytes. Treat ambiguous winners as errors.

Neither workspace file existence nor the Wizard-only artifact-target cache
establishes these contracts. Do not infer from filenames or skill prose at
materialization time. After writing `request.json`, the compiler uses the
captured normalized `phaseOutputs` only; it neither re-resolves templates
nor re-reads their source files. Updated package contents require a new run.

Validate schema, tested CLI version/JSON contract, snapshot fingerprints,
required phase skill and output bindings, linear topology, path confinement and
symlink/reparse protection before writing the request. Once captured,
materialization MUST NOT re-read Specify or change any authoritative
field. Validate that tagged providers do not supply selected runtime phase
commands; tag classification must not change Specify precedence. A changed
choice requires a new run.

## Command-derived override handshake

The model emits only a sparse draft:

```json
{ "categories": {} }
```

The extension-owned `prepare-override` operation reads the immutable
request, validates the draft against allowlisted category paths, computes
the request digest itself, and atomically emits:

```json
{
  "schemaVersion": 1,
  "requestSha256": "<sha256-of-exact-request>",
  "categories": {}
}
```

`generate` accepts only that finalized document, checks its request digest,
and never reads the draft as materialization input. The empty object is a
valid default. Unknown fields, model-supplied digest, `schemaVersion` in a
sparse category, protected values, and `null` deletion fail. A customer
replacement of a category suppresses the entire sparse patch for that
category and emits a warning in the outcome.

## Compiled blueprint and technical receipt

`pipeline.json` retains PR #32 blueprint schema version 2: metadata,
ordered linear steps, project-level Constitution, required skills,
runtime provider setup records, capabilities, artifact path templates
and argument guidance. It additionally carries the request's ordered
`phaseOutputs` bindings unchanged; each step's existing `artifact` field
is derived solely from the matching bound contract. Its hash is recorded in
the receipt. A design-time
provider that only affects appearance is not a runtime dependency.

`.speckit-canvas.json` in the generated target records schema version 1,
canvas ID, generator extension/version/template version, request and
blueprint hashes, final experience hash and category owner/version pairs,
renderer ID/version/API version, exact runtime provider dependencies,
ordered provenance, and all final generated file paths/hashes. It is a
diagnostic/integrity receipt, not an adoption or manual-edit-preservation
gate. Its own hash is not self-listed. Paths must remain inside the target.

## Controlled result and cleanup

At `.specify/.cache/canvas-generation/<request-id>/`, keep
`request.json`, `command-override-draft.json` (optional after finalization),
`command-override.json`, `staging/`, and `result.json`. The cache subtree is
ignored and control files contain no reusable secrets. Canonicalized paths
cannot escape that exact request directory. The generator atomically writes
one versioned `result.json` last for controlled success or failure:

```json
{
  "schemaVersion": 1,
  "status": "succeeded",
  "target": ".github/extensions/assess-workflow",
  "designProviders": ["preset:copilot-canvas-brand@0.1.0"],
  "warnings": []
}
```

For `status: "failed"`, include a stable `errorCode` plus actionable
details and target when known. The exact failure enum is versioned with
implementation schemas. No result file means interruption, not success.
Only after result consumption may exact request-ID cleanup run; startup
cleans interrupted request directories with bounded, resolved paths.
