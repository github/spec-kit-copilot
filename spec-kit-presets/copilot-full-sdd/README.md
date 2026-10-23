# Copilot Full SDD

Copilot Full SDD **1.0.0** preserves the traditional full Spec Kit workflow in
Copilot skills mode. Its nine command replacements retain template resolution,
research and design artifacts, constitution checks, quality gates, and validation.
Source: [GitHub Spec Kit core commands](https://github.com/github/spec-kit/tree/27d14e20c187c1f2916540ea201ecbdc9f8ed588/templates/commands)
at revision `27d14e20c187c1f2916540ea201ecbdc9f8ed588`.
Copyright GitHub, Inc.; [MIT licensed](LICENSE).

The upstream commands are imported with only extension lifecycle-hook dispatch,
its separators, and dependent branch/report/checklist references deleted. No
instructions are added or rewritten; questioning, execution, and validation
instructions otherwise remain identical to the pinned core sources. Script metadata
and portable command references remain for Specify to render for the project.
This is a Specify preset, not a `copilot plugin` package.

## Installation and prerequisites

Requires Specify CLI **1.2.3 exactly**, a project initialized with Copilot **skills
mode** and its installed core templates and workflow scripts from that release.
The preset is pinned to this released CLI version, independently of the command
source revision above. No extensions are required.

**Initial release pending.** The catalog reserves the normal release URL; no
tag, release, or asset is created by adding this source. For local development
in a disposable project:

```bash
uv tool install "specify-cli==1.2.3"
specify init /path/to/full-project --integration copilot --integration-options="--skills" --non-interactive
cd /path/to/full-project
specify preset add --dev /absolute/path/to/spec-kit-copilot/spec-kit-presets/copilot-full-sdd
specify preset resolve speckit.plan
```

After publication, register the [preset catalog](https://github.com/github/spec-kit-copilot/blob/main/spec-kit-presets/README.md#installing-a-preset)
and run `specify preset add copilot-full-sdd`. See the shared
[release guide](https://github.com/github/spec-kit-copilot/blob/main/spec-kit-presets/README.md#versioning--distribution) for distribution.
Installation generates `.github/skills/speckit-<command>/SKILL.md`.
Run `/skills reload` after generated skills change in the current Copilot
session; new sessions discover them automatically.

## Full artifact and command contract

Feature commands locate the active feature through `.specify/feature.json`.
Core scripts resolve project/preset/extension template layers and report missing
prerequisites. They are supplied by `specify init`, not bundled again here.

| Command | Required context | Output / safeguards |
| --- | --- | --- |
| `constitution` | Resolved constitution template, project context, principles | `.specify/memory/constitution.md`; governance-only scope, version/date/placeholder validation, Sync Impact Report |
| `specify` | Feature description, resolved spec template; constitution if present | `<feature>/spec.md`, `feature.json`, `checklists/requirements.md`; testable requirements, measurable success criteria, bounded clarification and validation iterations |
| `clarify` | Active `spec.md`; constitution if present | Up to five targeted questions; incremental spec updates, coverage report, built-in quality checklist revalidation |
| `plan` | `spec.md`, constitution, resolved plan template | `plan.md`, `research.md`, `data-model.md`, `quickstart.md`, interface `contracts/` where applicable; resolve unknowns and evaluate constitution gates before/after design |
| `tasks` | `spec.md`, `plan.md`, resolved tasks template; available design artifacts | `tasks.md`; user-story phases, dependency graph, file paths, task IDs, parallel markers and independent test criteria; test tasks only when requested |
| `analyze` | `spec.md`, `plan.md`, complete `tasks.md`, constitution | Read-only consistency/coverage report; constitution violations are CRITICAL; edits require separate approval |
| `checklist` | Active feature, `spec.md`, nonempty `plan.md`, resolved checklist template; `tasks.md` if present | Append-only `checklists/<domain>.md`; requirements-quality questions, not implementation tests; new items unchecked and reviewer-owned |
| `implement` | `plan.md`, complete `tasks.md`, existing checklists and available design artifacts | Code, validation and task progress; checklist approval gate, phase/dependency ordering, failure reporting and completion checks |
| `converge` | `spec.md`, `plan.md`, complete `tasks.md`, implementation already attempted; constitution | Only append traceable remediation tasks; no code/spec/plan edits, no existing-task rewriting; leave tasks byte-identical when converged |

`clarify` normally runs after specify and before plan. `analyze` requires tasks;
`checklist` requires a nonempty `plan.md` through the Spec Kit 1.2.3 setup script;
`tasks.md` is optional. Run plan before checklist. Full's custom checklist state
is an implementation approval gate, not evidence of completed implementation.
Spec quality checklist markers are maintained by specify/clarify; custom
checklists remain reviewer-owned.

All manifest command ids are prefixed `speckit.` and use `replace`.

## Composition boundary

Full and [Lean](https://github.com/github/spec-kit-copilot/blob/main/spec-kit-presets/copilot-lean-sdd/README.md) are **alternative baselines**, not cumulative
layers. Use only one replacement baseline. This preset does not enforce
exclusivity, activate bundle components, switch baselines, reconcile disabled
presets, or migrate existing artifacts.

These nine command bodies do not read `.specify/extensions.yml` or dispatch
extension lifecycle hooks. Opt-in extension lifecycle dispatch belongs to a
separate preset, not this baseline. This does **not** disable or remove native
Copilot hooks/events, user-invoked extension commands, CLI-owned behavior, or
instructions added by other composition layers.

## Validation

Run `python -m unittest discover -s spec-kit-presets/tests -v` in an environment
with the existing `spec-kit-presets/tests/requirements.txt` dependencies.
Set `FULL_SPECIFY_BIN` to the absolute Specify **1.2.3** executable for isolated
init/install/resolve/generated-skill and prerequisite-script checks. This is
independent of Lean's `SPECIFY_BIN`, so directory-wide discovery can validate
each preset with its own compatible CLI. Leaving `FULL_SPECIFY_BIN` unset skips
only Full's real-CLI checks, even when `SPECIFY_BIN` is set for Lean.
Set `FULL_PRESET_ARCHIVE` to a local release zip for archive verification.
Set `FULL_CORE_SOURCE` to a checkout of the pinned Spec Kit source for
authenticated source comparison: every command must exactly match core with
only the enumerated hook-related deletions, with no added bytes after normalizing
CRLF line endings to LF. Digest, source, and archive comparisons use the same
normalization so checkout line-ending conversion does not change their results.
These checks cover package and instruction contracts, not model compliance or
runtime guarantees.
