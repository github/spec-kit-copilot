# Copilot Lean SDD

Copilot Lean SDD **1.0.0** is an independently maintained, Copilot-specific
adaptation of upstream Lean Workflow **1.0.0**. It preserves Lean's small
`specify -> plan -> tasks -> implement` workflow: one focused Markdown file per
authoring command, no separate design templates or boilerplate artifacts.
See [UPSTREAM.md](UPSTREAM.md) for the exact source commit, changes, and MIT attribution.

The package id and directory are **`copilot-lean-sdd`**. The workstream name
`copilot-lean-sdd-preset` refers to this one package, not a second preset or alias.
This is Specify CLI plumbing, **not** a `copilot plugin` package.

## Installation and status

Requires Specify CLI **>= 1.0.8** and Copilot **skills mode**. This floor is the
oldest locally verified CLI for this package, not a claim that upstream Lean needs it.
Interactive commands require Copilot's `ask_user`; they report an unavailable
tool rather than silently guessing. No delegation tools or extensions are required.

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

The aligned catalog URL reserves
`https://github.com/github/spec-kit-copilot/releases/download/copilot-lean-sdd-v1.0.0/copilot-lean-sdd.zip`;
it must not be presented as an existing downloadable asset before publication.
The existing preset release workflow packages `preset.yml`, `commands/`, README,
provenance, and license at archive root. Version this package independently of
plugins, upstream Lean, and Specify CLI.

Installation registers `.github/skills/speckit-<command>/SKILL.md`. Use
`/skills reload` in the current Copilot session after generated skills change;
new sessions discover them automatically. The commands run directly in Copilot,
not through a different agent. They use `ask_user` for interactive decisions.

## Minimal artifact contract and supported commands

The supported inventory is exactly these **ten** commands. Each uses `replace`,
including the five shared commands upstream Lean does not override. This prevents
shared commands from falling back to core instructions containing extension
lifecycle-hook dispatch. Future core additions require an inventory review.

| Command / Copilot skill | Required inputs | Output / behavior |
| --- | --- | --- |
| `constitution` / `speckit-constitution` | User direction and repository context | `.specify/memory/constitution.md`; governance only |
| `specify` / `speckit-specify` | Feature description and user-confirmed project-local directory | `.specify/feature.json`, `<feature>/spec.md`; honor authored constitution if present |
| `clarify` / `speckit-clarify` | `feature.json`, authored `spec.md`; constitution if present | Optional, up to five questions; answers saved incrementally in `spec.md` |
| `plan` / `speckit-plan` | `feature.json`, authored constitution and `spec.md` | `<feature>/plan.md` only |
| `tasks` / `speckit-tasks` | `feature.json`, authored constitution, `spec.md`, `plan.md` | `<feature>/tasks.md`, dependency-ordered checkbox tasks |
| `analyze` / `speckit-analyze` | `feature.json`, authored constitution, `spec.md`, `plan.md`, `tasks.md` | Optional, read-only in-session consistency/coverage report |
| `checklist` / `speckit-checklist` | `feature.json`, authored `spec.md`; plan/tasks/constitution if present | Optional, explicitly requested `checklists/<domain>.md`, reviewer-owned requirements-quality checks |
| `implement` / `speckit-implement` | `feature.json`, authored constitution, `spec.md`, `plan.md`, `tasks.md` | Code, validation, task progress; halt on failure |
| `converge` / `speckit-converge` | `feature.json`, authored spec/plan/tasks, prior implementation; constitution if authored | Optional, append-only remaining work in `tasks.md`; no code changes |
| `taskstoissues` / `speckit-taskstoissues` | `feature.json`, authored `tasks.md`, exact GitHub remote, issue tools, explicit write authorization | Optional deprecated conversion with open/closed issue deduplication; no automatic extension install |

All command ids are prefixed `speckit.` in the manifest. Paths are project-relative;
feature directories must resolve inside the project and outside `.specify`, `.git`,
and `.github`. Missing/malformed configuration, unsafe paths, or required artifacts
stop the command with an actionable error rather than selecting a branch or
creating unexpected fallback artifacts. No branch-name convention is required.

**Clarify/analyze/checklist compatibility:** Lean prose and headings are enough;
Full SDD headings, FR/SC identifiers, `research.md`, `data-model.md`, `contracts/`,
`quickstart.md`, and template files are not prerequisites. Clarify normally runs
after specify and before plan; checklist can run as early as specify; analyze
runs after tasks and before implement. None is inserted as a mandatory extra
phase. Custom checklist checkboxes are not task completion or an automatic
implementation gate. An authored constitution remains required for plan, tasks,
analyze, and implement, as it is in the upstream Lean workflow's context.

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

The planned `copilot-sdd-bundle` will select Lean by default. That is future bundle
work, not current installed-by-default behavior or an activation mechanism in this
preset. Full SDD, delegation presets, and existing projects are unchanged.

## Validation

From the repository root, use the existing Specify tool environment (which supplies
PyYAML), or an environment with `spec-kit-presets/tests/requirements.txt` installed:

```bash
python -m unittest discover -s spec-kit-presets/tests -v
```

Set `SPECIFY_BIN` to the absolute `specify` executable to include isolated real-CLI
init/install/resolve/generated-skills checks. Set `LEAN_PRESET_ARCHIVE` to a locally
built release zip to validate archive contents too. Tests never publish or call an
agent. Static checks cover manifest/catalog alignment, ten replacement commands,
minimal-artifact prompt contracts, provenance/license packaging, and forbidden hook
dispatch. Real CLI checks establish registration/composition, **not** model compliance:
live Copilot CLI/App question handling and end-to-end authored artifact quality
still need interactive validation. No live-agent run is claimed by these tests.
