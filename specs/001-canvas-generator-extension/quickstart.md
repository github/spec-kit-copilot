# Quickstart: Validate Standalone Canvas Generation

The default five-phase generation was exercised in a Copilot skills-mode
worktree with Specify 1.0.7. A new canvas was prepared, scaffolded in the
session, materialized, published, reloaded, inspected, opened once, and
recorded as succeeded without editing the generated output or running any
phase. The provider exposed exactly Constitution, Specify, Plan, Tasks,
and Implement, and `list_items` reported setup ready. Release assets still
require their corresponding version tags to be published. No
composition-domain API is required. All example
commands below run from the repository root in PowerShell; use
platform-equivalent shell syntax on macOS/Linux.

## 1. Confirm prerequisites and source

```powershell
specify --version
specify artifact list --json
specify preset list --json
specify extension list --json
gh pr view 32 --repo github/spec-kit-copilot --json state,headRefOid
```

**Expected after implementation**: the installed CLI meets the minimum
verified by contract tests for the existing JSON commands, installation,
and preserved installed manifests. The artifact response has one ordered
stack per `(kind, name)`; package tags are read from installed `preset.yml`
and `extension.yml` when absent from installed-list JSON. No
`compositionDomain` field, tag-filtered artifact row, or upstream change is
required. Pin the PR #32 source revision used for parity fixtures.

Confirm the compatible `spec-kit-copilot` plugin and the destination's
Copilot skills-mode initialization. If the latter is missing, the
generated canvas's own setup flow must offer its explicit `--force`
warning and confirmation, not initialize silently.

## 2. Install the implemented generator in a test workspace

In a disposable acceptance worktree with the tested CLI:

```powershell
specify extension add .\spec-kit-extensions\pipeline-canvas-generator --dev --priority 100
specify extension list --json
copilot skill list
```

**Expected**: one installed enabled `pipeline-canvas-generator` at
priority 100 with `canvas-design` in its installed `extension.yml` and
catalog entry; Copilot discovers
`speckit-pipeline-canvas-generator-generate`, `speckit-pipeline-canvas-generator-inspect`, and
`speckit-pipeline-canvas-generator-remove`. Reload skills in the current Copilot session
after installation. Do not install this extension as a `copilot plugin`
or create another `.specify` project.

The generator ships output declarations for supported core commands. Other
callable commands need no output declaration; their installed skill may
provide a best-effort Markdown path hint. Missing hints show unknown output
instead of blocking generation. Declared outputs remain validated.

## 3. Run focused contracts and parity tests

When implementation and migrated fixtures exist:

```powershell
python -m unittest discover -s .\spec-kit-extensions\pipeline-canvas-generator\tests -p "test_*.py"
npm test --prefix .\plugins\spec-kit-copilot-wizard\extensions\speckit-wizard-canvas
```

**Expected**: generation request and override validation, catalog and
installed-manifest tag classification, unchanged Specify precedence,
design-only bundle member checks, selected-phase contributor rejection,
path confinement, PR #32 Assess/Bugfix/SDD parity,
generated-runtime actions, setup authorization, renderer conformance,
and Wizard adapter tests pass. Add dedicated test selectors as these
suites materialize; do not treat this guide as a full test implementation.

## 4. Generate through Copilot CLI without the Wizard

In a compatible test project initialized for Copilot skills mode, add a
supported runtime workflow and optional Canvas Design components through
Specify, then reload skills. Invoke `/skill:speckit-pipeline-canvas-generator-generate` in
Copilot CLI. Supply or confirm a linear five-phase workflow, canvas ID,
display name, destination repository, and new-target decision.

**Expected**: one complete uninterrupted authoring workflow prepares
the request with exactly one validated phase-output binding per selected
phase, invokes `create-canvas` in the same turn, scaffolds in
confined staging, validates, installs, reloads, inspects a running
provider, and opens the generated canvas once. No manual file editing,
Wizard installation, second generation run, or phase execution is
required. The generated extension has a receipt and complete vendored
runtime/renderer. Source-authored files need not be byte-identical to
another run, but normalized contracts and application semantics must.

Inspect the exact result and target, substituting the run ID and canvas
ID from the generation response:

```powershell
Get-Content .\.github\extensions\<canvas-id>\.speckit-canvas.json
Get-Content .\.github\extensions\<canvas-id>\canvas-experience.json
```

The request-specific `.specify\.cache\canvas-generation\<request-id>\`
directory can be removed after the result is consumed. No credentials,
callback tokens, or reusable secrets appear in control or receipt files.
See [composition and generation contract](contracts/composition-and-generation.md).

For a reproducible smoke run, use the five ordered IDs
`speckit.constitution`, `speckit.specify`, `speckit.plan`, `speckit.tasks`,
`speckit.implement`, a previously absent ID such as `sdd-acceptance-demo`,
and the initialized worktree as `--workspace`. Run
`canvas_generate.py prepare-request` with those choices and retain its
`requestPath`. Use the `create-canvas` skill and extension management guide
to scaffold a uniquely named **session** canvas; run `stage-scaffold` with
that scaffold, create only `{"categories": {}}` as the adjacent
`command-override-draft.json`, then run `prepare-override`, `materialize`,
and `generate` in that order against the same request and returned staged
scaffold path. Delete only the temporary session scaffold. Reload
extensions, inspect `project:sdd-acceptance-demo`, open it once with
`{"cwd":"<absolute worktree>"}`, and record the actual provider ID and
instance ID through `record-outcome`. Inspect the resulting `result.json`
for `status: succeeded`; invoke `list_items` to verify five phases and
ready setup. Do not impose an elapsed-time cutoff on Generate's queued
result: wait for its authoritative success or failure record.

## 5. Compare Wizard entry path and Canvas Design precedence

In the Wizard Environment page, verify the generator is installed or
repaired at priority 100 and the CLI version gate passes before Generate
opens. In Generate, add a design preset or extension from Canvas Design;
verify one-at-a-time immediate Add/Remove and ordinary community
confirmation. Generate from the same selected phases and installed
components as the CLI run.

**Expected**: the runtime Catalog and Phases tab omit design-only providers;
the Composition page may label or filter them without changing the full
Specify-resolved stacks. Generate shows the required generator and eligible
tagged design components separately from runtime providers. The
Wizard and CLI produce equivalent requests, phase order, dependencies,
experience, and receipt provenance. A customer category replacement
wins over sparse command guidance for that category, emits a suppression
warning, and leaves other category defaults unchanged. A `canvas-renderer` replacement is rejected; supported design categories
customize the generator's sole horizontal phase presentation, not the
Wizard's live UI or backend authorization.

Check that a locally installed package without catalog metadata is classified
from its installed manifest, an untagged package remains runtime even if it
contributes a generation template, catalog/manifest tag mismatch is rejected,
and a bundle containing an untagged or runtime-phase component cannot be added
through Canvas Design. A tagged package contributing a selected runtime phase
must yield a package-and-artifact diagnostic and remain unadded; no eligibility
check may change Specify artifact identity or precedence. After each Add/Remove,
verify immediate skill reload and a refreshed composition; closing Generate
must not roll back completed operations.

For a configured native pre-run confirmation, Cancel must not dispatch
the skill; Confirm invokes the selected effective runtime phase once.
For results, no configuration means no result tag. A configured
artifact-field or original-turn phase report may produce one current
tag; reruns replace it rather than double-counting summaries. See
[experience and renderer contract](contracts/experience-and-renderer.md).

## 6. Transfer and exercise setup policies

Copy only the generated extension to a separate compatible repository
without the Wizard. Open it first with missing project initialization,
then in separately prepared repositories under `external`, `prompt`,
and `automatic` runtime-component policies.

**Expected**: initialization never runs before the destination user
accepts the explicit warning; Cancel leaves the project unchanged.
`external` reports missing components and installs none. `prompt`
discloses the complete dependency set and installs all or none.
`automatic` installs only the exact administrator-authorized set and
blocks source drift or denied host permissions. After setup, run a
phase and inspect its artifact. Design-only components must not be
runtime prerequisites. See [runtime and lifecycle contract](contracts/runtime-and-lifecycle.md).

## 7. Regenerate, cancel, and recover

Modify or add a file **inside the test generated target only**. Change
the selected design component, select Regenerate, and inspect the
exact-path all-files deletion warning.

- **Cancel**: every target file remains unchanged.
- **Confirm**: a fresh validated candidate replaces the whole exact
  target; manual edits and unknown files are not merged or backed up.
  Files containing workflow data outside the target remain unchanged.
- **Invalid candidate or denied permission before deletion**: existing
  target remains unchanged, with actionable error and no false success.
- **Simulated failure after deletion**: outcome is failed; target may be
  partial or absent; ordinary Regenerate rebuilds from current
  composition and asks again before deleting any existing exact target.
- **Symlink/reparse or escaping target**: reject without following it.

For controlled failures, consume the single authoritative result;
for interruption with no result, report interrupted rather than
succeeded. Inspect every generated path/hash against the receipt.

## Release checks

The sample bundle references `copilot-canvas-studio` by ID rather than
embedding its preset files. Before claiming a clean bundle install, publish
the preset, bundle, and generator release ZIPs referenced by their catalogs;
register the Copilot preset catalog with install permission in a clean test
project and install the bundle there. Offline `specify bundle validate
--path spec-kit-bundles/copilot-canvas-studio --offline` verifies the bundle
shape but warns that it cannot resolve the uninstalled preset; it does not
substitute for that clean-install check. Until the release assets are
published, `tests/integration/test_design_package_install.py` initializes a
throwaway Copilot-skills project, installs the design preset from its local
source, builds the canonical bundle ZIP, and verifies offline install/removal
preserves the independently installed preset. The bundle release workflow uses
the same `specify bundle build` artifact path.

Before shipping, determine the earliest released Specify version verified for
the existing JSON, installation, and manifest contracts and use that minimum
consistently across manifest, Wizard gate, CLI preflight, request compatibility,
generated setup, tests, and docs;
verify the pinned PR #32 migration fixtures; test Windows and
macOS/Linux paths; run default and replacement renderer conformance;
and review the 25 constitution principles. No fixed wall-clock
generation threshold is a release criterion.
