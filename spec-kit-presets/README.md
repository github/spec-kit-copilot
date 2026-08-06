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

These are the **Copilot-specific** Spec Kit presets — presets that depend on
**Copilot's own agent mechanisms** rather than being agent-agnostic. This directory is
their canonical home.

| Preset | Requires | Why it is Copilot-specific |
| --- | --- | --- |
| [`copilot-sub-agents`](copilot-sub-agents) | Spec Kit `>= 0.2.0` | Built around Copilot delegation mechanisms — VS Code's `runSubagent` tool, Copilot CLI sub-agent processes, and custom agents in `.github/agents/` / `~/.copilot/agents/`. |
| [`copilot-assess-ask-questions`](copilot-assess-ask-questions) | Spec Kit `>= 0.9.0`, the `assess` extension | Drives the assess pipeline through Copilot's interactive `ask_user` tool (App, CLI, VS Code). No plain-text fallback — not meant for agents without an interactive question tool. |

Only Copilot-specific presets belong here. Agent-agnostic presets (generic themes,
extension-specific workflows that don't rely on Copilot's tools) do **not** belong in
this Copilot integration hub.

## Installing a preset

**Recommended — register the catalog once, then install by id.** Catalogs are
discovery-only by default, so `--install-allowed` is required to install from them
(and `--name` is required):

```bash
specify preset catalog add https://raw.githubusercontent.com/mnriem/spec-kit-copilot/main/spec-kit-presets/catalog.json \
  --name spec-kit-copilot --install-allowed

# then add by id — the normal way:
specify preset add copilot-sub-agents
specify preset add copilot-assess-ask-questions   # also: specify extension add assess
```

The two methods below are escape hatches, not the primary path:

- **One-off, without registering a catalog** — install straight from a release zip
  (`--from` requires an HTTPS URL):

  ```bash
  specify preset add --from https://github.com/mnriem/spec-kit-copilot/releases/download/copilot-sub-agents-v1.0.0/copilot-sub-agents.zip
  specify preset add --from https://github.com/mnriem/spec-kit-copilot/releases/download/copilot-assess-ask-questions-v1.0.0/copilot-assess-ask-questions.zip
  ```

- **Local development only** — install from a working clone of this repo:

  ```bash
  specify preset add --dev ./spec-kit-presets/copilot-sub-agents
  specify preset add --dev ./spec-kit-presets/copilot-assess-ask-questions
  ```

## Layout

```text
spec-kit-presets/
├── README.md              # this file (the plumbing boundary note)
├── catalog.json           # Spec Kit preset catalog (NOT the Copilot marketplace)
├── copilot-sub-agents/
│   ├── preset.yml
│   └── commands/
└── copilot-assess-ask-questions/
    ├── preset.yml
    └── commands/
```

## Versioning & distribution

Presets are versioned and released **independently** of the Copilot plugins in this
repo. Each preset carries its own `version` in `preset.yml` and its own
`catalog.json` entry. `specify preset add <name>` (catalog install) resolves a
release-asset zip via each entry's `download_url`, tagged
`<preset>-v<version>` (e.g. `copilot-sub-agents-v1.0.0`).

Releases are cut by CI — there is no local build script. The zip is built **inside**
the release workflow (`.github/workflows/release-preset.yml`) from the preset
directory, so `preset.yml` and `commands/` sit at the archive root. To publish:

- **Preferred:** run the **Release Preset Trigger** workflow
  (`.github/workflows/release-preset-trigger.yml`) via *Actions → Run workflow* with
  the preset id and version; it validates, then creates and pushes the
  `<preset>-v<version>` tag.
- **Or** push the tag yourself (`git tag copilot-sub-agents-v1.0.0 && git push origin
  copilot-sub-agents-v1.0.0`).

Either path fires `release-preset.yml`, which builds the zip and creates the GitHub
release with that asset. When revving a preset, bump its `preset.yml` version and the
matching `catalog.json` entry together **before** tagging.

