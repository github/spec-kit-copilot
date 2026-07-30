---
name: speckit-cli-setup
description: 'Detect and install the Spec Kit `specify` CLI that every other speckit skill depends on. USE FOR: checking whether `specify` is installed/on PATH, installing it when missing, fixing "command not found: specify", confirming the CLI is new enough (>= 0.11). DO NOT USE FOR: upgrading an already-installed CLI to a newer release (use speckit-self) or verifying project tools (use speckit-check).'
argument-hint: 'none'
---

# Spec Kit — CLI setup

The Spec Kit plugin drives the **`specify`** command-line tool. Every other speckit
skill assumes `specify` is installed and on `PATH`. This skill detects it and
installs it when it is missing.

## Detect first

Always check availability before doing anything else:

```bash
specify --version
```

- **Prints a version (e.g. `specify 0.15.0`)** → the CLI is installed. If a skill needs
  `bundle` or `workflow step`, ensure the version is **>= 0.11**; if it is older, hand
  off to the **speckit-self** skill to upgrade.
- **`command not found` / non-zero exit** → not installed. Install it (below).

## Install

Spec Kit's `specify` CLI is published on PyPI as
**[`specify-cli`](https://pypi.org/project/specify-cli/)**. Install the **latest**
release — this plugin is not pinned to a specific `specify` version.
**[uv](https://docs.astral.sh/uv/)** is the recommended installer;
**[pipx](https://pipx.pypa.io/)** is an alternative:

```bash
# Recommended: uv (persistent install, latest from PyPI)
uv tool install specify-cli

# Alternative: pipx (persistent install, latest from PyPI)
pipx install specify-cli

# One-off / ephemeral (no install) — handy to bootstrap a project
uvx --from specify-cli specify init . --integration copilot --integration-options="--skills"
```

If neither `uv` nor `pipx` is available, tell the user to install `uv` first
(`curl -LsSf https://astral.sh/uv/install.sh | sh`, or see <https://docs.astral.sh/uv/>),
then re-run the install. Do not silently install system Python packages.

## Verify

```bash
specify --version
specify check
```

## Notes

- This skill is the **prerequisite** for the rest of the plugin. If any speckit skill
  finds that `specify` is not available, it should run this skill's detect/install
  steps first, then retry.
- For an **already-installed** CLI that just needs a newer version, prefer the
  **speckit-self** skill (`specify self upgrade`) over reinstalling. To refresh a
  `uv`/`pipx` install to the latest PyPI release, use `uv tool upgrade specify-cli`
  or `pipx upgrade specify-cli`.
- Installing from PyPI always pulls the latest published `specify-cli`. Only pin a
  specific version (e.g. `uv tool install "specify-cli==0.15.0"`) if you have a
  concrete reason to hold back.
