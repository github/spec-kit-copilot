# Contract: Canvas Experience and Renderer

> Superseded for newly generated canvases by Section 17 of
> `docs/canvas-extension-original-plan.md`. The current presentation document
> contains effective UI settings only; interactions retains effective navigation,
> rerun, input, and confirmation behavior, while onboarding retains installation,
> slug, and approval policy. The six-category table below is historical.

**Status**: Proposed schema v1. Each complete JSON category is a named Specify
template with independent `replace` composition. No JSON text merge or
post-generation customization script.

## Canonical experience categories

`canvas-experience.json` has `schemaVersion: 1` and a `categories` object
with exactly these six complete, individually versioned documents:

| Category | Canonical supported fields | Owner |
| --- | --- | --- |
| `canvas-content` | `workflowListName`, `itemName`, `description`, `copy.<declared-key>` | General workflow terminology and copy, not setup or phase-input guidance |
| `canvas-theme` | `colors`, `typography`, `density`, `shape`, `brand.logo` | Semantic theme, typography, shape, default/custom/hidden branding |
| `canvas-layout` | `navigation.style`, `pipeline.orientation`, `phases.showDescriptions`, `artifacts.presentation`, `.showMetadata`, `clarification.placement`, `amendment.placement` | Navigation and placement, not behavioral progression |
| `canvas-interactions` | `progression.mode`, `.showFuturePhases`, `.collapseCompletedPhases`, `rerun.enabled`, `.requireConfirmation`, `inputs.retainAfterRun`, `.phases.<phase-id>`, `phaseRunConfirmations.<phase-id>`, `artifacts.showRevisionControls` | Pre-dispatch behavior and action visibility, not layout |
| `canvas-results` | `resultLabels`, `defaultResult`, `phases.<phase-id>`, `clarification`, `progress.enabled` | Optional phase-review labels (up to five) and at most one configured result per phase; clarification and deterministic progress remain distinct |
| `canvas-onboarding` | `workflowSlug.userProvided`, `.label`, `.helperText`, `installationMode`, `approvalCopy`, `readinessCopy`, `firstRunCopy`, `helpCopy`, `recoveryCopy` | Setup policy and bounded setup copy, not dependency identity or permission enforcement |

Each category has exactly one complete-document owner: the effective customer
template provider or generator default. The generator resolves and validates
each category, preserves the six canonical keys, and records effective
source/version/hash in the receipt. No aliases or duplicated field ownership.
The extension's default `canvas-results` has clarification/progress support
but **no result tag contract** unless explicitly configured.

### Sparse command override

Only a category still owned by the generator accepts command-derived
values. Allowed paths are a strict subset of the table above:

- Content: bounded terminology, descriptions, declared labels/empty/recovery
  copy; no setup or phase guidance, arbitrary markup, phase IDs, or paths.
- Theme: semantic colors, typography enums, density, shape/elevation,
  supported branding choice; custom asset only from a resolved package.
  No raw CSS, JavaScript, or undeclared tokens.
- Layout: navigation, pipeline orientation, descriptions, artifact view
  and metadata, clarification/amendment placement. No progression, actions,
  DOM selectors, or renderer module paths.
- Interactions: guided/free progression, future/completed behavior, rerun
  confirmation, input retention and declared phase guidance, bounded
  phase-run confirmation text, revision visibility. No phase order or
  new action type.
- Results: allowed result labels/IDs/tones/sources, per-phase
  replace/disable, clarification label, progress visibility. No formula,
  freshness, deduplication, or result presentation mode.
- Onboarding: workflow slug policy, `external | prompt | automatic`,
  bounded approval/readiness/first-run/help/recovery copy. No captured
  dependency identity, provenance, or permission override.

Scalars replace their values; arrays replace the whole array; stable-ID
maps merge by key and allowlisted leaf. Other objects accept only declared
leaf patches. Omitted fields retain their complete owner's value. Reject
`null` unless explicitly introduced by a future version, unknown fields,
any sparse `schemaVersion`, unsafe URLs/assets, and unsupported
combinations. A customer-owned category suppresses its entire sparse
patch with a warning, never a field-by-field merge. Validate each final
category and the complete profile.

Schema v1 deliberately has **no** generic `responsive`, `colorMode`,
`setupPresentation`, `resultPresentation`, or initial-open selector:
the default renderer remains responsive and host-theme-aware without
exposing no-op options. New options require at least two documented,
tested behaviors.

### Brand assets

`brand.logo.mode` is `default | asset | none`. `default` uses a vendored,
versioned Spec Kit image without a runtime network fetch; `asset` names a
confined PNG/JPEG/WebP packaged by the effective theme provider and
requires bounded nonempty alt text; `none` occupies no empty logo space.
Reject remote/authenticated logo URLs, missing/escaping files, symlinks,
unsupported type, and oversized dimensions/bytes.

## Result contract

A configured result may be a `defaultResult` applied globally or a
phase-specific replacement/disable entry keyed by stable phase command ID.
At most one result tag is active for any phase in v1. Each result has a
label, finite `(id, label, tone)` values, one explicit source, and a
`summary` boolean. Tones are `neutral | info | positive | attention |
critical`. Source is exactly `artifact-field` with a configured field or
`phase-report` from the original phase invocation; there is no automatic
fallback, computed source, or secondary Copilot review.

For `artifact-field`, the configured field is a single top-level scalar in the
first Markdown YAML frontmatter block (`---` on the first and closing lines).
Its value is an unquoted or singly/doubly quoted allowed result ID; duplicate,
unknown, missing, or nested fields are not evidence. The artifact must be the
declared current phase output, written during the latest successful run.
The generator reads only that field; it does not interpret arbitrary headings,
body prose, or other frontmatter keys as a classification.

Only a phase configured with `phase-report` receives the current ephemeral
run ID and allowed result IDs in its original invocation and calls the
protected canvas action `report_phase_result` through the existing host
action transport. The runtime accepts one allowed ID for the active run;
same-value repeats are idempotent, conflicting/stale values rejected.
Pending evidence settles only after phase success. Absent/invalid evidence
means no tag and a diagnostic, never a failed otherwise-successful phase.

Phase state, task progress, and unresolved clarification are independent.
Attention/critical results are emphasized on the producing phase;
only a current complete phase with resolved clarification contributes to
summaries, counted once per workflow item. Reruns replace settled values
and current evidence recalculates counts. An explicit "Needs clarification"
result value is not an unresolved clarification marker.

## Presentation boundary

The generated canvas has one packaged horizontal phase presentation, based on
PR #32. Six validated design categories configure its content, theme, layout,
interactions, results, and onboarding without replacing its JavaScript.
An effective `canvas-renderer` template fails request preparation. The Wizard
owns its separate live presentation; neither imports the other's UI.
