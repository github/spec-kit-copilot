# Markdown Artifact Review

The existing Wizard and SDD canvases share a Markdown reader inside their
existing artifact previews. This is an enhancement to those canvases, not a
new plugin, canvas, workflow, or installation method.

## Reading Artifacts

Open an existing artifact using the canvas's **View** control. Markdown
previews include GitHub-flavored tables, lists, task lists, code blocks,
footnotes, and a heading outline. The outline uses a side rail when the
preview has room and a keyboard-accessible drawer in narrower containers.

The artifact selector includes the selected feature's supporting documents,
contracts, checklists, and available project constitution. Wizard also
supports command and template sources already known to its composition.
Relative Markdown links open scoped documents in the same reader. Back and
forward arrows select the previous or next available Markdown document in the
current folder, in natural filename order, without requiring prior visits.
They skip unavailable files, do not cross into subfolders, and stop at the first
and last document. Returning to a visited document preserves its reading position
when its revision is unchanged.
Returning to the canvas restores the invoking control and current workflow
state, including progress received while reading.

The source label identifies working-tree content. Existing canvas change
notifications refresh artifact membership and mark changed content; **Refresh**
loads the current revision. Missing, unavailable, oversized, or invalid text
produces an in-preview state without closing the canvas.
If a review context expires, explicit **Refresh** revalidates its scope and
selected document in a new context. Context-bound history starts afresh, and
old clarification bindings are not reused. A document that is no longer in
the authorized scope remains unavailable.

## Existing Workflows

- Canvas identities, agent actions, stage commands, setup, Run/Rerun,
  overwrite confirmation, and prerequisite ordering are retained.
- Wizard catalogs, composition, pipeline customization, folder browsing,
  and non-Markdown source previews retain their existing entry points.
- SDD feature targeting, constitution, progress, optional quality gates,
  new-feature flow, and artifact deep links are retained.
- Existing artifacts can be viewed even when setup or execution is gated.
  This intentionally makes SDD feature cards and Wizard artifact navigation
  available earlier; it does not enable execution or perform setup.
- Reading, changing documents, following local links, and returning do not
  dispatch a workflow, install dependencies, or write project files. The
  Wizard's existing startup and dependency bootstrap are unchanged.

Clarification controls remain explicit workflow actions. SDD still confirms
and submits a targeted answer; Wizard retains queued answers and its
apply-and-rerun flow. Reader answers are additionally bound to the current
context, artifact, revision, question, and owning command. Changed questions
must be refreshed and reconfirmed. Code examples and HTML comments do not
become actionable clarification markers. Existing callers without reader
metadata retain their original action contracts.

## Read Boundary

The server derives membership from the existing canvas workspace and selected
feature or composition, not from a browser-supplied absolute path. Additive
`/api/review/*` endpoints use the existing canvas capability plus Host/Origin
checks; legacy endpoint response shapes remain unchanged. Context, artifact,
and pagination identifiers are opaque and instance-bound, not credentials.

Files must be ordinary, bounded, UTF-8 Markdown inside the authorized
workspace. Path traversal, `.git`, symbolic links and junctions, Windows
device aliases and alternate streams are rejected. Revisions hash exact
file bytes; display-only BOM removal never rewrites the source. Errors shown
by the reader are bounded and do not expose file contents or private paths.

Raw HTML is disabled, images are inert placeholders, and task checkboxes
cannot edit documents. Local and external link decisions go through the
host adapter. Unsafe schemes, protocol-relative URLs, and URLs containing
credentials are inert; reading never passively fetches external content.

Limits are 5 MiB per artifact, 200 items per page, 10,000 inspected entries
per discovery pass, and 50 history entries. Reaching the discovery limit
returns a terminal partial result. This reader has no editing, remote
repository discovery, authentication, or cloning feature.

## Maintainer Layout

The build-only package is
[ui/markdown-reader](../plugins/spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/ui/markdown-reader/package.json)
under Wizard. It owns rendering, outline, focus, and trusted clarification
presentation. Each canvas keeps its own workflow state and server lifecycle.

Wizard's [review service](../plugins/spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/server/artifact-review.mjs)
and browser adapter are canonical. The
[synchronizer](../scripts/canvas-reader/sync-domain.mjs) copies the shared
domain and adapter into SDD, and bundles the clarification parser for Node.
[Asset synchronization](../scripts/canvas-reader/sync-assets.mjs) packages
the reader, dependency notices, and provenance in each plugin independently.
Neither installed plugin requires the sibling checkout or reader build
dependencies. Generated payloads are marked in the repository attributes;
edit their canonical sources and rebuild, not the copies.

## Build And Test

Use Node 24.19.0 and the locked dependencies. From the repository root in
PowerShell:

```powershell
$wizard = "plugins/spec-kit-copilot-wizard/extensions/speckit-wizard-canvas"
$reader = "$wizard/ui/markdown-reader"
npm ci --prefix $wizard --ignore-scripts
npm ci --prefix $reader --ignore-scripts
npm --prefix $reader run typecheck
npm --prefix $reader run lint
npm --prefix $reader test
npm --prefix $reader run build
npm --prefix $reader run verify:package
node --test "$wizard/test/*.test.mjs" "plugins/spec-kit-copilot-sdd/extensions/sdd-canvas/tests/*.test.mjs"
npm --prefix $reader run test:tools
npm --prefix $reader run test:browser
npm --prefix $reader audit --audit-level=low --ignore-scripts
```

The [validation workflow](../.github/workflows/canvas-reader-validation.yml)
runs Windows and Linux checks. CI builds without synchronizing first, so
stale committed payloads fail verification rather than being silently fixed.
Browser tests use Edge on Windows and isolated Chromium on Linux, actual
canvas shells, owned synthetic files, and mocked host sessions. They cover
navigation, responsive layout, clarification, freshness, source preservation,
and independent packaging without executing real workflows. They do not
replace native Copilot App acceptance or real workflow acceptance.
