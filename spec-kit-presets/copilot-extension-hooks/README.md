# Copilot Extension Hooks

Copilot Extension Hooks **1.0.0** is an independently configurable, opt-in
Specify preset for Copilot **skills mode**. It wraps one selected
`copilot-lean-sdd` or `copilot-full-sdd` baseline without replacing or editing
its body, metadata, artifact requirements, approval gates, or safeguards.
It is not a Copilot plugin and does not control Copilot native hooks/events.

Requires released Specify CLI **1.2.3 exactly**, a project initialized by that
release in Copilot skills mode, and exactly one of those hook-free baselines.
The version constraint describes the validated composition contract, not the
version of this preset. Full also requires 1.2.3; Lean's broader requirement is
compatible with it. Install trusted extensions separately; this preset neither
installs extensions nor registers hooks. Their installed command skills must be
available to the Copilot host.

## Install and configure

**Initial release pending.** The catalog reserves a release URL; source addition
does not publish an asset. For local development in a disposable project:

```bash
specify --version                        # must report 1.2.3
specify init /path/to/project --integration copilot --integration-options="--skills" --non-interactive --script sh
cd /path/to/project
specify preset add --dev /path/to/spec-kit-copilot/spec-kit-presets/copilot-lean-sdd --priority 10
# OR install copilot-full-sdd at priority 10, not both baselines.
specify preset add --dev /path/to/spec-kit-copilot/spec-kit-presets/copilot-extension-hooks --priority 5
specify preset resolve speckit.plan
```

Use `--script ps` or `--script py` as appropriate. After publication,
[register the preset catalog](https://github.com/github/spec-kit-copilot/blob/main/spec-kit-presets/README.md#installing-a-preset), then install
the selected baseline and `specify preset add copilot-extension-hooks --priority 5`.
See the shared [release guide](https://github.com/github/spec-kit-copilot/blob/main/spec-kit-presets/README.md#versioning--distribution).

**Lower preset numbers have higher precedence.** The hooks layer must precede
the replacement baseline (for example, hooks `5`, baseline `10`). A higher
precedence replacement or project-local command override hides this wrapper.
Equal priorities depend on id ordering; use distinct priorities instead.
Do not compose with hook-bearing core fallbacks or another hook dispatcher.
The CLI does not enforce the baseline prerequisite or exclusivity for this
preset. Confirm the generated `.github/skills/speckit-*/SKILL.md` contains one
`Copilot extension lifecycle checkpoints` section and the intended baseline.
All nine commands are covered: constitution, specify, clarify, plan, tasks,
analyze, checklist, implement, converge. `taskstoissues` is not covered.

Configure individual hooks in the extension-managed `.specify/extensions.yml`:

```yaml
hooks:
  before_plan:
    - extension: example
      command: speckit.example.prepare
      optional: false
  after_plan:
    - extension: example
      command: speckit.example.review
      enabled: true
      optional: true
      prompt: "Review the completed plan?"
```

Replace example ids with real installed extension commands. Hooks follow the
core command-template contract: YAML list order (not hook-priority sorting),
missing `enabled` means enabled, explicit `enabled: false` is skipped,
optional hooks are presented rather than automatically invoked, and mandatory
hooks are actually invoked with results awaited sequentially. Missing `optional`
defaults to optional, matching extension registration. Nonempty `condition`
expressions are skipped, not interpreted by the agent; this is not
HookExecutor's condition-evaluating path. The reserved
`settings.auto_execute_hooks` is not an activation switch.

Hook IDs and invocations are distinct: `speckit.git.commit` identifies the hook,
while its installed `speckit-git-commit` skill is invoked in Copilot CLI as
`/speckit-git-commit`. Optional-hook suggestions use the host-supported skill
invocation; `EXECUTE_COMMAND` retains the configured dotted ID. Unavailable
optional skills are reported as unavailable, not offered as executable commands.

Invalid YAML is reported with its parser error and the warning that mandatory
hooks could not be checked, then the workflow continues, as in core.
An unavailable, denied, or failed mandatory invocation instead stops the
invocation and reports failure. Completion post-hooks do not run after a
baseline prerequisite/gate/validation stop. The wrapper preserves each command's
checkpoint, including a completed Lean convergence assessment that leaves
existing open tasks unchanged: its reported remaining work is not convergence,
but it still reaches `after_converge`. Blocked assessments do not.
It keeps an invocation-local dispatch record to avoid
duplicate invocation, including report/checklist re-entry. It is prompt guidance,
not a runtime executor, persistent lock, sandbox, or deterministic host enforcement.

## Changing activation or priority

Specify 1.2.3's `preset enable`, `disable`, and `set-priority` change resolution
state but **do not regenerate existing skills**. `/skills reload` reloads files;
it does not reconcile them. Do not claim hooks are off just because resolution
or registry state changed.

The validated explicit flow, with a surviving enabled baseline, is:

```bash
# Turn hooks off and restore generated baseline skills:
specify preset remove copilot-extension-hooks

# Turn hooks back on, or apply a different wrapper priority:
specify preset add --dev /path/to/spec-kit-copilot/spec-kit-presets/copilot-extension-hooks --priority 5
# After publication, use: specify preset add copilot-extension-hooks --priority 5
```

Inspect generated skills after each change, then run `/skills reload` in the
current Copilot session (or start a new session). Removal/reinstallation is an
explicit configuration operation, not an automatic migration; authored workflow
artifacts are not changed. Use this flow rather than merely toggling an installed
preset. Reliable installed-but-disabled defaults and automatic reconciliation
remain shared Specify prerequisites. A future bundle may install this component
disabled by default; bundle assembly/defaults are not implemented here.

## Source, license, and validation

Hook-handling rules and output blocks are adapted from
[Spec Kit core commands at `27d14e20c187c1f2916540ea201ecbdc9f8ed588`](https://github.com/github/spec-kit/tree/27d14e20c187c1f2916540ea201ecbdc9f8ed588/templates/commands),
the source retained by Full before hook removal, and checked against released
1.2.3. Shared handling is factored into one wrapper; command-specific checkpoint
placement is retained. Copilot skill invocation, single-dispatch tracking, and
explicit mandatory-failure reporting are added. Copyright GitHub, Inc.;
[MIT licensed](LICENSE).

Run `python -m unittest discover -s spec-kit-presets/tests -p 'test_extension_hooks.py' -v`
with PyYAML installed. Set `HOOKS_SPECIFY_BIN` to Specify 1.2.3 and
`HOOKS_BASELINES_ROOT` to a source tree's `spec-kit-presets` containing both
canonical baselines to include real init/install/composition/removal checks.
Set `HOOKS_PRESET_ARCHIVE` to an externally built release ZIP to compare its
file names, count, and file bytes with the package, normalizing CRLF to LF on
both sides while preserving every other byte. This archive check is
skipped when no ZIP is supplied; creating a ZIP from the expected inventory is
not release-workflow validation.
These checks validate files and generation, not model compliance. Bounded
Copilot CLI marker-hook exercises are opt-in and consume model usage:

```bash
PYTHONPATH=spec-kit-presets/tests HOOKS_COPILOT_BIN=/absolute/path/to/copilot \
  python -m unittest test_extension_hooks.CopilotBehaviorTests -v
```

Keep the same `HOOKS_SPECIFY_BIN` and `HOOKS_BASELINES_ROOT` environment variables.
These disposable local exercises cover mandatory invocation/waiting, list order,
disabled/conditional/optional skipping, duplicate suppression, missing baseline
inputs, denied execution, mandatory pre/post failure, absent-layer behavior, and
malformed YAML. Each host process has a five-minute timeout. To retain diagnostic
transcripts, set `HOOKS_EVIDENCE_DIR` to a private directory outside the repository.
Rejected forbidden, duplicate, retried, or out-of-order marker calls are recorded
before failing, so continuing after a tool error cannot hide the attempt.
The denied-hook case blocks only the hook entry point, not the baseline's Python
command, and also checks that baseline execution was not attempted.
Reporting checks inspect final assistant responses for mandatory-hook failures
and assistant-authored warnings for malformed YAML, not matching tool output.
Negative transcript cases reject tool-only evidence and contradictory success.
Separate Lean convergence cases cover existing open work and blocked assessment.
The marker-hook cases seed registrations and command skills directly; they do
not exercise extension installation.

For the separate end-to-end installed-extension test, also set
`HOOKS_SPECIFY_SOURCE` to the extracted Spec Kit **1.2.3** source tree. That test
installs the unmodified bundled `git` extension with `specify extension add --dev`,
checks enabled inventory and automatically registered hooks/generated skills,
then executes `specify` with each baseline. It verifies that the mandatory
`before_specify` hook actually invokes the extension's branch-creation script
once using a constrained single-command format with a successful tool result
and script JSON output, then verifies the resulting local branch. Reading the
script does not count as an invocation; shell-wrapped attempts and combined
calls are rejected rather than ignored, including failed retries. Simple `head`,
`ls`, and numeric-range `sed -n` print inspections are allowed without counting
as execution; executable `sed` expressions are not. Optional commit
hooks remain unrequested. All Git operations are confined to throwaway
repositories without remotes; no existing project or global Git configuration
is changed.

They are behavioral samples, not proof of enforcement in every host; Copilot App
behavior is not established by CLI tests.
