# Pipeline Canvas Generator

This is a Spec Kit extension, not a Copilot plugin. It is installed through
`specify extension add` and requires a compatible Copilot canvas-authoring host.
The Wizard is an optional request producer; generated canvases must not depend
on it. To exercise the source checkout locally at priority 100:

```powershell
specify extension add .\spec-kit-extensions\pipeline-canvas-generator --dev --priority 100
```

Specify v1.0.7 requires extension command IDs in the
`speckit.<extension-id>.<command>` namespace. This package contributes
`speckit.pipeline-canvas-generator.generate`, `.inspect`, and `.remove`;
after installation and skill reload, invoke them as
`/skill:speckit-pipeline-canvas-generator-generate`,
`/skill:speckit-pipeline-canvas-generator-inspect`, or
`/skill:speckit-pipeline-canvas-generator-remove`. Inspect and remove
accept only intact, receipt-backed targets; removal requires confirmation
of the exact absolute path and deletes the entire directory without backup.

## Specify compatibility

The initial tested minimum is **Specify CLI 1.0.7**. The
[`test_specify_json.py`](tests/contracts/test_specify_json.py) contract exercises
the released `artifact`, `preset`, and `extension` JSON list commands, installs a
tagged local extension in an isolated project at priority 100, checks its
persisted manifest, and checks the effective artifact stack fields. The
v1.0.7 release added artifact introspection and preset/extension JSON output;
the v1.0.6 release tree has no `specify_cli/artifacts` package. This is a
released-CLI gate, not a dependency on an unreleased composition domain.
Recheck the same contract wherever the minimum version is enforced.

## Authoring Canvas Design packages

Canvas Design is a presentation input to generation, not a runtime phase
provider. A preset or extension must declare `canvas-design` in its own
`preset.yml` or `extension.yml` and in its catalog entry. Local installations
without a catalog entry are classified by their installed manifest. A catalog
tag alone does not make an installed package eligible: disagreement, an unsafe
manifest, or contribution to a selected runtime phase rejects it. Each member
of a design-only bundle must independently be tagged and eligible. Do not
remove such packages from Specify's effective stacks or change their
priorities to make them disappear from the runtime catalog.

Six complete JSON templates can customize the generated experience:
`canvas-content`, `canvas-theme`, `canvas-layout`, `canvas-interactions`,
`canvas-results`, and `canvas-onboarding`. A package owning an effective
category supplies a whole, schema-valid template; it does not claim ownership
of another category. Generator-owned categories accept sparse, allowlisted
command guidance, but customer-owned categories suppress conflicting command
patches with a warning. `canvas-results` has at most one configured source per
phase (`artifact-field` or original-turn `phase-report`); neither source is
inferred from an artifact or from another turn.

A design extension may also contribute a **distinct** support command with
documented inputs. Installation and skill reload only make that command
available. The effective generation command or an explicit Generate action
must name it before the generator validates its captured provider and invokes
it once. A failed invocation or malformed result is a generation error, never
an invitation to run all installed support commands. See the
[`support-command` contract](../../specs/001-canvas-generator-extension/contracts/composition-and-generation.md)
for the request shape and evidence requirements.

Generated canvases always present the generator-owned PR #32 horizontal phase
stepper, workflow card, collection, and artifact viewer directly in the
trusted host. Design packages customize the six declarative categories; an
effective `canvas-renderer` template is rejected rather than loading
replacement JavaScript. The Wizard owns its live UI independently.

## Phase-output hints and declarations

Request preparation uses Specify's effective commands for phase invocation.
Where present, it resolves a versioned JSON output template from the captured
Specify `(template, name)` stack. Its template name is
`phase-output-` followed by the phase's UTF-8 command ID encoded as lowercase
hex; for example, `speckit.plan` maps to
`phase-output-737065636b69742e706c616e`. Each declaration identifies its
`commandName` and exactly one result: a workspace-confined Markdown
`pathTemplate`, or `{ "kind": "transient" }` for no durable output. The
generator supplies declarations for supported core commands. A preset wrapper
does not need to repeat a core output declaration. Without a template, a safe
Markdown path in the installed skill's opening description is captured as a
best-effort hint; otherwise the output is unknown and the phase can still run.
Only verified, workspace-confined files are shown as produced artifacts.

The immutable request records the normalized declaration, effective provider,
source path, SHA-256 of its exact bytes, and unmodified ordered template stack.
When a selected Copilot skill exists in the source workspace, its SHA-256 is
also bound into the request and the recipient setup contract; destination
readiness rejects a changed skill rather than trusting its filename alone.
An absent source skill is explicitly recorded without a fingerprint and still
must be present in the recipient before phase execution.
The compiler must not revisit the source or infer output from existing files,
the Wizard's artifact-target cache, filenames, or skill prose. Missing,
ambiguous, composed, mismatched, or unsafe contracts fail before a request is
written.

The same request captures six complete `canvas-*` category bindings from
Specify's effective template stacks. Each binding records the validated
document, provider, source path, source hash, and unchanged ordered stack;
uncontributed categories use the generator's validated default. Only one
effective `replace` winner is supported per category. A sparse command draft
can modify generator-owned categories, while a customer-owned category keeps
its complete template and emits a suppression warning in the receipt and
generation result. Template files are not reread during materialization.
Custom branding accepts only confined PNG, JPEG, or WebP with bounded
dimensions. The logo is copied to the generated canvas, served through an
authenticated route, and its provenance appears in the generation receipt.
Private routes remain cookie- and origin-guarded. The Wizard never loads
the generated canvas UI into its live presentation. The generated host
retains phase-run confirmation and installation review, including captured
package identity, source, executable-content warning, and approval copy.

For phases whose `canvas-results` source is `phase-report`, the generated
runtime passes the canvas instance, run ID, and allowed result IDs into the
original phase turn. The phase reports through the protected canvas action;
evidence settles only after a successful turn. Unconfigured and
`artifact-field` phases receive no reporting instructions.
For `artifact-field`, the declared result field is one top-level scalar in
the Markdown artifact's opening `---` frontmatter and must equal an allowed
result ID. A missing, stale, or duplicate field never creates a tag. Phase
state, unresolved clarification, and parsed `- [x]`/`- [ ]` task progress
are derived independently; aggregate result counts count each current
workflow item once per label.

## Standalone generation and transfer

Initialize the recipient repository with `specify init --here --force
--integration copilot --integration-options="--skills" --script py
--ignore-agent-tools` only after reviewing its file-replacement warning.
The generated setup contract retains the captured composition fingerprint and
the CLI-listed order, source metadata, manifest SHA-256, version, enabled state,
and priority of effective runtime providers. Recipient setup compares the
installed Specify JSON inventory and manifest against those facts, instead of
trusting a matching package ID alone. It excludes Canvas Design-only providers;
a local-only source is provenance, not a portable install URL, so a missing
local-only package requires external installation rather than catalog substitution.
The captured onboarding mode controls whether missing runtime providers are
externally managed, require one complete-contract approval, or may be installed
automatically from their exact portable HTTPS source. Neither mode bypasses host
permissions or permits installation of the Specify CLI or Copilot plugin.
Install the required runtime phase providers and this generator through
Specify; then reload Copilot skills in the current session. Supply the
generate skill with the selected *ordered* `speckit.*` phase command IDs,
canvas ID, display name, and recipient workspace. It asks for missing
choices, captures Specify's three JSON inventories itself, builds a
request-bound phase-output contract, invokes the supported `create-canvas`
scaffold, snapshots it inside request staging without reloading it, finalizes
the override, validates/publishes the candidate, and
reloads, inspects, and opens the resulting project canvas in the same turn.
The package does not import the Wizard or its state.

Installing or reloading a Canvas Design extension never runs its helper
commands. Only a Generate action or the effective generation command that
explicitly names a distinct helper may use `support-command` to validate its
captured provider and documented inputs, invoke its returned skill once, then
pass the JSON result to `record-support-result` with the returned
`sourceSha256`. A changed helper source or invalid sparse result is rejected
before writing a draft; without an explicitly named helper, use
`{"categories": {}}`.

An incompatible Specify version, missing authoring/scaffold host, absent
selected command, design-tagged runtime contributor, or
unsafe output path is a generation error; do not bypass it by running bare
Python or Specify commands. Missing output metadata alone does not block a
callable skill. Declared outputs remain validated and bound to the request;
skill-derived paths are hints rather than declarations.

After successful publication and provider verification, copy only
`.github/extensions/<canvas-id>/` to a compatible target repository.
Install its recorded runtime providers there; neither this generator nor
the Wizard is a runtime dependency. Startup checks for Specify >=1.0.7,
an enabled compatible `spec-kit-copilot` plugin (>=0.15.0), Copilot
skills-mode initialization and required skill files, and a host that can
reload skills; these probes never install the plugin or CLI. An
uninitialized destination requires its own protected, explicit
confirmation before the setup agent may run `specify init --force`; declining
keeps the canvas blocked without dispatching setup. An existing target,
including a partial or unrecognized one, requires confirmation of the exact absolute
target path and a fresh validated candidate. Regenerate locks that target,
deletes every file including manual edits, and publishes the new candidate
without a backup or rollback. Cancellation or candidate validation failure
leaves the old target intact; a publication failure may leave a partial
target, which can be replaced through an ordinary confirmed Regenerate.

The Wizard's Phases header retains only the Generate button. Its dialog
confirms the canvas ID, name, derived target, installation-approval choice,
Canvas Design packages (which own copy, result tags, and slug behavior), and
for existing targets, Regenerate through the same action. It confirms
the displayed phase order and exact destination, captures fresh Specify
artifact/preset/extension JSON in the server, and hands the extension-owned
prepared request to the same generate skill. The status remains queued
until the generator writes its authoritative `result.json` after provider
inspection and first open; no result is not success. Wizard and CLI
request preparation use the same normalizer and produce equivalent
request content for equivalent composition and choices.

## Pinned extraction source

The migration baseline is [github/spec-kit-copilot#32](https://github.com/github/spec-kit-copilot/pull/32)
at commit `a2497002cb1ab81b70916818d1a889f8182f172a` (the draft PR head
observed 2026-09-23). The PR has not merged; this is a fixed extraction
reference, not a claim that its implementation is already in this checkout.
Source paths below are relative to
`plugins/spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/` **at that
commit**, not to this worktree.

| Source at pinned commit | Intended extraction |
| --- | --- |
| `generation/compiler.mjs`, `generation/applicability.mjs`, `pipeline/canonical.mjs`, `pipeline/effective-phases.mjs` | Blueprint compilation and supported linear workflow checks; preserve the compiler's schema-v2 semantics and eliminate live Wizard state from inputs. |
| `generation/materialize-template.mjs`, `generation/generated-canvas-template/` | Generated-app template and validation baseline; stage behind the supported `create-canvas` scaffold rather than publishing directly from this template. |
| `generation/generated-canvas-template/extension.mjs`, `workflow-adapter.mjs`, `phase-runs.mjs`, `workspace-files.mjs`, `project-artifacts.mjs`, `setup-runtime.mjs`, `approval-runtime.mjs` | Protected runtime, artifact access, prerequisites, and setup; vendor the needed modules into the generated application. |
| `generation/generated-canvas-template/ui/`, `shared-workflow-ui/` | Default generated renderer and shared visual behavior; extract independent renderer-owned assets without importing the Wizard's live UI. |
| `test/fixtures/generation/{assess,bugfix,sdd}.json`, `test/generation-compiler.test.mjs`, `test/generated-*.test.mjs`, `test/generation-*.test.mjs` | Blueprint parity fixtures, generated-runtime regression tests, and baseline generation journeys; adapt assertions to the new request and override contract. |

Before porting, compare source files at this commit, capture the parity
fixtures, and document any intentional behavior changes. Do not infer missing
source files from the proposed layout in the implementation plan.
