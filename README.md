# Spec Kit Copilot Plugin

A GitHub Copilot CLI **skills plugin** that exposes the [Spec Kit](https://github.com/github/spec-kit)
`specify` command-line tool to the Copilot agent.

Instead of dispatching prompts to a separate agent, this plugin gives Copilot a set
of focused **skills** — one per `specify` command group — so the agent knows when and
how to drive the `specify` CLI on your behalf (scaffolding Copilot projects, managing
extensions/presets/bundles, running workflows, and maintaining the CLI).

**Status:** active development. This is a companion to the agent-agnostic
[Spec Kit](https://github.com/github/spec-kit) project, focused on making the Copilot
CLI and Copilot App integration smoother.

## Background

[Spec Kit](https://github.com/github/spec-kit) provides the `specify` CLI for
Spec-Driven Development and is intentionally agent-agnostic. This repository delivers
the **Copilot** companion: a skills plugin so Copilot CLI and Copilot App users get a
first-class, guided experience driving `specify` without leaving the agent.

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) to get started, and
[open issues](https://github.com/github/spec-kit-copilot/issues) for the current roadmap.

## Skills

| Skill | Wraps | Purpose |
| --- | --- | --- |
| `speckit-cli-setup` | install / `specify --version` | Detect and install the `specify` CLI the other skills depend on |
| `speckit-init` | `specify init` | Scaffold a new Copilot spec-driven project (or `--here`) |
| `speckit-check` | `specify check`, `specify version` | Verify tools, report version/features |
| `speckit-extension` | `specify extension …` | Install/update/search spec-kit extensions (+ catalogs) |
| `speckit-preset` | `specify preset …` | Install/search/resolve presets (+ catalogs) |
| `speckit-bundle` | `specify bundle …` | Discover, install, update, and author bundles (+ catalogs) |
| `speckit-workflow` | `specify workflow …` | Run/resume/inspect automation workflows (+ catalogs) |
| `speckit-workflow-step` | `specify workflow step …` | Manage workflow step types (+ catalogs) |
| `speckit-self` | `specify self …` | Check for and apply CLI upgrades |

Each skill is a `SKILL.md` (YAML frontmatter + Markdown body). The `description`
field tells Copilot when to load the skill; the body documents the exact `specify`
sub-commands, options, and usage notes. The plugin is described by the
[`plugin.json`](plugin.json) manifest at the repository root.

## Requirements

- [GitHub Copilot CLI](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-copilot-cli)
- The Spec Kit `specify` CLI on your `PATH`:

  ```bash
  uv tool install specify-cli      # or: pipx install specify-cli
  specify --version
  ```

> **Versioning:** this plugin tracks the Specify CLI version (lockstep). Plugin
> `0.11.8` targets `specify 0.11.8`; install or upgrade the matching CLI with
> `specify self upgrade`.

## Installation

### Via marketplace (recommended)

This repository ships a marketplace manifest at
[`.github/plugin/marketplace.json`](.github/plugin/marketplace.json). Register the
marketplace, then install the plugin from it:

```bash
copilot plugin marketplace add OWNER/spec-kit-copilot
copilot plugin install spec-kit-copilot@spec-kit-marketplace
```

### Local development install

Point `copilot plugin install` at this directory while iterating (note: direct
path/URL installs are deprecated and may be removed in a future release):

```bash
copilot plugin install ./spec-kit-copilot
```

Verify it loaded:

```bash
copilot plugin list
# or, inside an interactive session:
/skills list
```

> When iterating on the plugin locally, run `copilot plugin install ./spec-kit-copilot`
> again to refresh the cached components.

Uninstall with the plugin's `name` (from `plugin.json`), not its path:

```bash
copilot plugin uninstall spec-kit-copilot
```

## Usage

Just talk to Copilot in natural language; it selects the matching skill and runs the
right `specify` command. For example:

- "Initialize a spec-kit project here for Copilot" → `speckit-init`
- "Check my spec-kit environment" → `speckit-check`
- "Add the git extension" → `speckit-extension`
- "Run the taskstoissues workflow" → `speckit-workflow`
- "Install the platform-starter bundle" → `speckit-bundle`
- "Is there a newer specify release?" → `speckit-self`

## Layout

```javascript
spec-kit-copilot/
├── plugin.json              # Plugin manifest (required)
├── README.md
├── .github/plugin/
│   └── marketplace.json     # Marketplace manifest (for distribution)
└── skills/
    ├── speckit-cli-setup/SKILL.md
    ├── speckit-init/SKILL.md
    ├── speckit-check/SKILL.md
    ├── speckit-extension/SKILL.md
    ├── speckit-preset/SKILL.md
    ├── speckit-bundle/SKILL.md
    ├── speckit-workflow/SKILL.md
    ├── speckit-workflow-step/SKILL.md
    └── speckit-self/SKILL.md
```

## License

This project is licensed under the terms of the MIT open source license. Please refer to the [LICENSE](./LICENSE) file for the full terms.

## Maintainers

This project is maintained by GitHub staff. See [`.github/CODEOWNERS`](.github/CODEOWNERS) for the current owners.

## Support

See [SUPPORT.md](./SUPPORT.md) for how to get help and file issues. Please also review the [Code of Conduct](./CODE_OF_CONDUCT.md) and [Security Policy](./SECURITY.md).

## Acknowledgement

Built on top of [Spec Kit](https://github.com/github/spec-kit) and its `specify` CLI. Thanks to the Spec Kit team and community.
