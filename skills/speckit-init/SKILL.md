---
name: speckit-init
description: 'Scaffold a Spec Kit (spec-driven development) project for GitHub Copilot by running `specify init --integration copilot --integration-options="--skills"`. USE FOR: starting a new spec-kit project, bootstrapping spec-driven development in an existing repo, installing spec-kit templates/scripts/commands for Copilot. DO NOT USE FOR: managing extensions/presets/bundles of an already-initialized project (use the speckit-extension / speckit-preset / speckit-bundle skills instead).'
argument-hint: 'project name (or "." / --here for current directory)'
---

# Spec Kit — init

Initialize a spec-driven development project for **GitHub Copilot** with the
**Specify CLI** (`specify`). This skill exposes the `specify init` command. You (the
agent) run the CLI on the user's behalf via the shell; the CLI does the scaffolding.

Because this is the Copilot plugin, **always** scaffold Copilot in **skills mode**:

```
--integration copilot --integration-options="--skills"
```

This installs spec-kit commands (and any extensions added later) as Copilot
**Agent Skills** — `.github/skills/speckit-<cmd>/SKILL.md` — rather than the default
`.github/agents/*.agent.md` layout. Skills are what Copilot CLI discovers as `SKILL.md`,
so this keeps the project consistent with how this plugin works. Do not omit
`--integration-options="--skills"`.

## Prerequisite

This skill needs the `specify` CLI. Confirm it is available:

```bash
specify --version
```

If it is missing (`command not found`), use the **speckit-cli-setup** skill to install
it first, then continue.

## When to use

- The user wants to start a **new** spec-kit project.
- The user wants to add spec-driven development to the **current** directory.

## How to invoke

`specify init` scaffolds templates, scripts, the spec-kit workflow, shared
infrastructure, and the Copilot command files. It runs offline from assets
bundled in the installed CLI.

Common forms (always Copilot + skills mode). Pick the `--script` flavor for the
user's OS — `sh` on **macOS/Linux**, `ps` on **Windows** (the examples below use
`sh`; swap in `--script ps` on Windows):

```bash
# New project directory
specify init <project-name> --integration copilot --integration-options="--skills" --script sh

# Initialize in the current directory
specify init . --integration copilot --integration-options="--skills" --script sh
specify init --here --integration copilot --integration-options="--skills" --script sh

# Current directory is non-empty: skip the confirmation prompt
specify init --here --integration copilot --integration-options="--skills" --script sh --force

# Install a preset at init time
specify init <project-name> --integration copilot --integration-options="--skills" --script sh --preset healthcare-compliance
```

On Windows, use `--script ps` instead:

```powershell
specify init <project-name> --integration copilot --integration-options="--skills" --script ps
```

### Key options

- `--integration copilot` — always use this in the Copilot plugin.
- `--integration-options="--skills"` — **required**; scaffolds spec-kit commands as Copilot Agent Skills (`SKILL.md`) instead of `.agent.md` files.
- `--script <sh|ps|py>` — choose the helper script flavor. **Always pass this when
  running `specify init` for the user.** When stdin is a TTY — which the agent shell
  allocates — omitting `--script` opens an interactive "Choose script type" chooser that
  blocks the command. (With genuinely non-interactive stdin, e.g. a closed pipe, the CLI
  instead auto-selects the OS default, but you can't rely on that from a PTY-backed agent
  session.) Use `sh` on **macOS/Linux**, `ps` on **Windows**; `py` is a cross-platform
  Python fallback.
- `--ignore-agent-tools` — skip checks for the agent's CLI tools. **Recommended** for the
  Copilot plugin so init doesn't fail on missing external agent CLIs.
- `--here` / `.` — initialize in the current directory instead of creating a new one.
- `--force` — skip the confirmation when `--here` targets a non-empty directory.
- `--preset <id>` — install a preset during initialization.

## Notes

- Prefer non-interactive flags so the command does not block on prompts.
- **Always pass `--script`** (`sh` on macOS/Linux, `ps` on Windows, `py` anywhere).
  When `specify init` runs with a TTY on stdin — as it does in a PTY-backed agent
  session — omitting `--script` opens an interactive "Choose script type" chooser that
  blocks. (`--integration copilot` already suppresses the *integration* chooser, but the
  *script-type* chooser still appears.) The CLI only auto-selects the OS default when
  stdin is genuinely non-interactive (e.g. a closed pipe), which you can't count on here,
  so this is the most common cause of `specify init` appearing to freeze.
- Always pass both `--integration copilot` and `--integration-options="--skills"`;
  the skills layout is what makes spec-kit commands (and later-added extensions)
  show up as `SKILL.md` for Copilot.
- After init, point the user at the generated skills under `.github/skills/` and the
  `.specify/` directory. Newly generated skills are picked up in the current Copilot
  session with **`/skills reload`**, and automatically on the next session start.
  Suggest `specify check` to verify their environment.
