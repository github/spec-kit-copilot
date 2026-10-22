# Copilot Lean SDD

Copilot Lean SDD **1.0.0** is an independently maintained, Copilot-specific
adaptation of upstream Lean Workflow **1.0.0**. It preserves Lean's small
`specify -> plan -> tasks -> implement` workflow: one focused Markdown file per
authoring command, no separate design templates or boilerplate artifacts. Four
original Lean command files are imported **byte-for-byte unchanged**; `implement`
has a focused execution-order clarification. Copilot-specific interactive guidance
is in the four additional shared-command replacements.
Source: [GitHub Spec Kit Lean 1.0.0](https://github.com/github/spec-kit/tree/27d14e20c187c1f2916540ea201ecbdc9f8ed588/presets/lean).
Copyright GitHub, Inc.; [MIT licensed](LICENSE).

The package id and directory are **`copilot-lean-sdd`**.
This is Specify CLI plumbing, **not** a `copilot plugin` package.

## Installation and status

Requires Specify CLI **>= 1.0.8** and Copilot **skills mode**. This floor is the
oldest locally verified CLI for this package, not a claim that upstream Lean needs it.
The shared-command adaptations use Copilot's `ask_user` for interactive decisions
and report a missing tool when a blocking question cannot be asked.
No delegation tools or extensions are required.

**Initial release pending.** No release/tag/asset is created by adding this source.
Use a disposable project for local development, starting from a clone of this repo:

```bash
specify init /path/to/lean-project --integration copilot --integration-options="--skills" --non-interactive
cd /path/to/lean-project
specify preset add --dev /absolute/path/to/spec-kit-copilot/spec-kit-presets/copilot-lean-sdd
specify preset resolve speckit.specify
specify preset resolve speckit.clarify
```

After a maintainer publishes `copilot-lean-sdd-v1.0.0`, catalog installation will be:

```bash
specify preset catalog add https://raw.githubusercontent.com/github/spec-kit-copilot/main/spec-kit-presets/catalog.json \
  --name spec-kit-copilot --install-allowed
specify preset add copilot-lean-sdd
```

See the shared
[versioning and release guide](https://github.com/github/spec-kit-copilot/blob/main/spec-kit-presets/README.md#versioning--distribution).

Installation registers `.github/skills/speckit-<command>/SKILL.md`. Use
`/skills reload` in the current Copilot session after generated skills change;
new sessions discover them automatically. The commands run directly in Copilot,
not through a different agent. Interactive shared-command adaptations use `ask_user`
for interactive decisions. Specify renders upstream constitution's command placeholder
for the selected integration when generating its skill.

## Minimal artifact contract and supported commands

The supported inventory is exactly these **nine** commands. Each uses `replace`,
including the four shared commands upstream Lean does not override. This prevents
shared commands from falling back to core instructions containing extension
lifecycle-hook dispatch. Future core additions require an inventory review.

| Command / Copilot skill | Required inputs | Output / behavior |
| --- | --- | --- |
| `constitution` / `speckit-constitution` | User direction and repository context | `.specify/memory/constitution.md`; governance only |
| `specify` / `speckit-specify` | Feature description and user-provided feature directory | `.specify/feature.json`, `<feature>/spec.md` |
| `clarify` / `speckit-clarify` | `feature.json`, `spec.md`; constitution if present | Optional, up to five questions; answers saved incrementally in `spec.md` |
| `plan` / `speckit-plan` | `feature.json`, constitution and `spec.md` context | `<feature>/plan.md` only |
| `tasks` / `speckit-tasks` | `feature.json`, constitution, `spec.md`, `plan.md` context | `<feature>/tasks.md`, dependency-ordered checkbox tasks |
| `analyze` / `speckit-analyze` | `feature.json`, constitution, `spec.md`, `plan.md`, `tasks.md` | Optional, read-only in-session consistency/coverage report |
| `checklist` / `speckit-checklist` | `feature.json`, `spec.md`; plan/tasks/constitution if present | Optional, explicitly requested `checklists/<domain>.md`, reviewer-owned requirements-quality checks |
| `implement` / `speckit-implement` | `feature.json`, constitution, `spec.md`, `plan.md`, `tasks.md` context | Code, validation, task progress; halt on failure |
| `converge` / `speckit-converge` | `feature.json`, constitution, spec/plan/tasks, prior implementation | Optional, append-only remaining work in `tasks.md`; no code changes |

All command ids are prefixed `speckit.` in the manifest. The five Lean-derived commands
keep upstream's direct feature-path and context-loading instructions without added
path checks or prerequisite gates. The four shared-command adaptations follow the
same short User Input / Outline format and report missing configuration or required
inputs. No branch-name convention is required.

**Clarify/analyze/checklist compatibility:** Lean prose and headings are enough;
Full SDD headings, FR/SC identifiers, `research.md`, `data-model.md`, `contracts/`,
`quickstart.md`, and template files are not prerequisites. Clarify normally runs
after specify and before plan; checklist can run as early as specify; analyze
runs after tasks and before implement. None is inserted as a mandatory extra
phase. Custom checklist checkboxes are not task completion or an automatic
implementation gate. Upstream plan, tasks, and implement load the constitution as
context; they do not add an authored-content validation gate. Analyze requires those
same artifacts; clarify and checklist need only the spec and feature configuration.

`taskstoissues` is excluded because it is moving out of core SDD. Older CLI versions
may still generate that deprecated command; this preset neither replaces nor removes
it. It is outside this baseline's supported inventory and hook-free guarantee.

## Baseline and composition boundary

Select this as the **only replacement SDD baseline** in a fresh test project.
Do not stack it with upstream `lean` or another replacement baseline: Specify
priority resolves winners, not mutually exclusive choices. This package does not
enforce exclusivity, implement switching, reconcile generated outputs after
enable/disable/priority changes, or migrate existing projects.

Commands do not read `.specify/extensions.yml` or dispatch extension lifecycle
hooks. There is no embedded before/after hook handler. This does **not** disable
Copilot's native hooks/events, direct user-invoked extension commands, or
CLI-owned behavior. Other installed composition layers can still add instructions;
the hook-free guarantee here is for this baseline alone. Opt-in extension hooks
and delegation compatibility are separate workstreams, not implemented here.

## Validation

From the repository root, use the existing Specify tool environment (which supplies
PyYAML), or an environment with `spec-kit-presets/tests/requirements.txt` installed:

```bash
python -m unittest discover -s spec-kit-presets/tests -v
```

Set `SPECIFY_BIN` to the absolute `specify` executable to include isolated real-CLI
init/install/resolve/generated-skills checks. Set `LEAN_PRESET_ARCHIVE` to a locally
built release zip to validate archive contents too. These checks cover package
metadata, files, license/provenance, command contracts, CLI registration, and
archive contents. They do not invoke an agent or verify model instruction-following.
