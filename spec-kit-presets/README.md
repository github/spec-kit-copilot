# Spec Kit presets (Copilot-specific)

> [!IMPORTANT]
> **This directory is Spec Kit plumbing, not Copilot plumbing.** Everything here is
> consumed by the **`specify` CLI** via `specify preset add` — it is *not* a Copilot
> plugin, skill, extension, or marketplace entry. Do not confuse the `catalog.json`
> in this directory with the Copilot marketplace manifest at
> [`.github/plugin/marketplace.json`](../.github/plugin/marketplace.json), and do not
> confuse a preset here with a Copilot plugin under [`plugins/`](../plugins) or a
> skill under [`skills/`](../skills).

| Plumbing | Consumed by | Lives in |
| --- | --- | --- |
| **Copilot** plugins / skills / canvases | `copilot plugin …` (Copilot CLI & App) | root `plugin.json`, `skills/`, `plugins/`, `.github/plugin/marketplace.json` |
| **Spec Kit** presets (this folder) | `specify preset …` (Spec Kit `specify` CLI) | `spec-kit-presets/` |

## What lives here

These are **Spec Kit presets maintained for the Copilot experience**, including
upstream-derived SDD baselines. Their instructions may remain portable.
See [contribution scope and placement](../CONTRIBUTING.md#scope-and-package-placement)
for maintainer guidance on which packages belong here.

| Preset | Requires | Copilot purpose |
| --- | --- | --- |
| [`copilot-extension-hooks`](copilot-extension-hooks) | Specify `==1.2.3`, one Copilot Lean/Full SDD baseline | Opt-in lifecycle dispatch through installed Copilot command skills; preserves the selected baseline and does not control native hooks. See its explicit activation/regeneration flow. |
| [`copilot-full-sdd`](copilot-full-sdd) | Spec Kit `== 1.2.3`, Copilot skills mode | Full core workflow registered as Copilot skills, without extension lifecycle hooks and with safeguards for creating and updating specs. [1.0.0 release](https://github.com/github/spec-kit-copilot/releases/tag/copilot-full-sdd-v1.0.0). |
| [`copilot-lean-sdd`](copilot-lean-sdd) | Spec Kit `>= 1.0.8`, Copilot skills mode | Upstream Lean's minimal artifacts with Copilot skill invocation and `ask_user`; replaces all nine core SDD commands without extension lifecycle-hook dispatch. [1.0.0 release](https://github.com/github/spec-kit-copilot/releases/tag/copilot-lean-sdd-v1.0.0). |
| [`copilot-sub-agents`](copilot-sub-agents) | Spec Kit `>= 0.8.0` | Built around Copilot delegation mechanisms — VS Code's `runSubagent` tool, Copilot CLI sub-agent processes, and custom agents in `.github/agents/` / `~/.copilot/agents/`. |
| [`copilot-assess-ask-questions`](copilot-assess-ask-questions) | Spec Kit `>= 0.9.0`, the `assess` extension | Drives the assess pipeline through Copilot's interactive `ask_user` tool (App, CLI, VS Code). No plain-text fallback — not meant for agents without an interactive question tool. |

## Installing a preset

**Recommended — register the catalog once, then install by id.** Catalogs are
discovery-only by default, so `--install-allowed` is required to install from them
(and `--name` is required):

```bash
specify preset catalog add https://raw.githubusercontent.com/github/spec-kit-copilot/main/spec-kit-presets/catalog.json \
  --name spec-kit-copilot --install-allowed

# then add by id — the normal way:
specify preset add copilot-sub-agents
specify preset add copilot-assess-ask-questions   # also: specify extension add assess
```

Choose one SDD baseline and follow its installation prerequisites:
[Full SDD](copilot-full-sdd#installation-and-prerequisites) (`specify preset add copilot-full-sdd`)
or [Lean SDD](copilot-lean-sdd#installation-and-prerequisites) (`specify preset add copilot-lean-sdd`).
Do not install both in the same project.

`copilot-extension-hooks` **1.0.0 is pending release**; use its
[local-development install](copilot-extension-hooks#install-and-configure).
It is an opt-in layer over one selected baseline, not another baseline.
After publication, install it with `specify preset add copilot-extension-hooks --priority 5`.

The two methods below are escape hatches, not the primary path:

- **One-off, without registering a catalog** — install straight from a release zip
  (`--from` requires an HTTPS URL):

  ```bash
  specify preset add --from https://github.com/github/spec-kit-copilot/releases/download/copilot-sub-agents-v1.0.0/copilot-sub-agents.zip
  specify preset add --from https://github.com/github/spec-kit-copilot/releases/download/copilot-assess-ask-questions-v1.0.0/copilot-assess-ask-questions.zip
  ```

- **Local development only** — install from a working clone of this repo:

  ```bash
  specify preset add --dev ./spec-kit-presets/copilot-sub-agents
  specify preset add --dev ./spec-kit-presets/copilot-assess-ask-questions
  specify preset add --dev ./spec-kit-presets/copilot-lean-sdd
  specify preset add --dev ./spec-kit-presets/copilot-full-sdd  # alternative to Lean
  specify preset add --dev ./spec-kit-presets/copilot-extension-hooks --priority 5  # opt-in layer
  ```

## Layout

```text
spec-kit-presets/
├── README.md              # this file (the plumbing boundary note)
├── catalog.json           # Spec Kit preset catalog (NOT the Copilot marketplace)
├── copilot-extension-hooks/
│   ├── preset.yml
│   ├── LICENSE
│   └── commands/
├── copilot-full-sdd/
│   ├── preset.yml
│   ├── LICENSE
│   └── commands/
├── copilot-lean-sdd/
│   ├── preset.yml
│   ├── LICENSE
│   └── commands/
├── copilot-sub-agents/
│   ├── preset.yml
│   └── commands/
└── copilot-assess-ask-questions/
    ├── preset.yml
    └── commands/
```

## Validation

The [Preset validation workflow](../.github/workflows/preset-validation.yml)
runs on pull requests that touch this directory or the workflow itself. It runs
the unit suite and installs and renders both SDD presets with released Specify
CLIs: 1.0.8 for Lean (its minimum supported version) and 1.2.3 for Full (its
required version). The CLIs use separate Python virtual environments.

To run the suite locally from the repository root, install the dependencies in
`spec-kit-presets/tests/requirements.txt` and run
`python -m unittest discover -s spec-kit-presets/tests -v`. To include both CLI
smoke tests, set `SPECIFY_BIN` and `FULL_SPECIFY_BIN` to the absolute paths of
the respective `specify` executables. The release-archive checks, Full upstream
source comparison, and extension hook CLI and Copilot exercises remain opt-in.

## Versioning & distribution

Presets are versioned and released **independently** of the Copilot plugins in this
repo. Each preset carries its own `version` in `preset.yml` and its own
`catalog.json` entry. `specify preset add <name>` (catalog install) resolves a
release-asset zip via each entry's `download_url`, tagged
`<preset>-v<version>` (e.g. `copilot-sub-agents-v1.0.0`).

Releases are cut by CI — there is no local build script. The zip is built **inside**
the release workflow (`.github/workflows/release-preset.yml`) from the preset
directory, so `preset.yml` and `commands/` sit at the archive root.

The manual trigger requires a repository Actions secret named **`RELEASE_PAT`**
containing a token authorized to push tags. Checkout persists this credential for
the tag push, matching Spec Kit's core release trigger and allowing the separate
release workflow to start. Do not use the default `GITHUB_TOKEN` for this handoff:
its tag pushes do not trigger another workflow.

To publish:

- **Preferred:** run the **Release Preset Trigger** workflow
  (`.github/workflows/release-preset-trigger.yml`) via *Actions → Run workflow* with
  the preset id and version; it validates, then creates and pushes the
  `<preset>-v<version>` tag.
- **Or** push the tag yourself (`git tag copilot-sub-agents-v1.0.0 && git push origin
  copilot-sub-agents-v1.0.0`).

Either path fires `release-preset.yml`, which builds the zip and creates the GitHub
release with that asset. When revving a preset, bump its `preset.yml` version and the
matching `catalog.json` entry together **before** tagging.

The trigger checks the requested version against the manifest and catalog before
creating any tag. Both the trigger and publisher also require the catalog's
`download_url` to match the release repository, tag, and `<preset>.zip` asset.
Update that URL when bumping the catalog version. Direct tag pushes receive the
same version and URL checks in the publisher before packaging or publication.
Both workflows require the manifest ID to match the directory. Package IDs use
lowercase letters, digits, and single hyphen separators after `copilot-`.
Symlinks in the package root or contents (including hidden and dangling links)
are rejected before reading manifests or creating archives.

The preset publisher listens only for `copilot-*-vX.Y.Z` tags, while extension
publishers listen for `extension-*-vX.Y.Z` tags. Their workflow structure remains
aligned with Spec Kit's manual-trigger and separate tag-push publisher model.
Versions are parsed after the final `-v`; changelog notes are passed through a
file rather than interpolated into shell scripts.
