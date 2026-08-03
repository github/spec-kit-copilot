# Spec Kit for GitHub Copilot

**Copilot-native integrations for Spec Kit across GitHub Copilot CLI, the Copilot
App, and VS Code.**

This repository hosts Copilot-specific integrations and Spec Kit components tailored
for Copilot: CLI skills, App canvases, and future plugins, hooks, or workflow surfaces.
Spec Kit remains agent-agnostic; this companion repository provides the first-class
Copilot experience around it.

**Status:** active development.

## Background

[Spec Kit](https://github.com/github/spec-kit) provides the `specify` CLI and
agent-independent foundations for Spec-Driven Development. This repository packages
the integrations that are specifically useful to Copilot users without adding
Copilot-only behavior to the core Spec Kit project.

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) to get started, and
[open issues](https://github.com/github/spec-kit-copilot/issues) for the current roadmap.

## Plugins

| Plugin | Version | Surface | Purpose |
| --- | --- | --- | --- |
| `spec-kit-copilot` | 0.15.0 | Copilot CLI and App agent | Core skills that teach Copilot how to run `specify` |
| `spec-kit-copilot-assess` | 0.1.0 | Copilot App canvas | Optional visual dashboard for the Spec Kit `assess` extension |
| `spec-kit-copilot-bugfix` | 0.1.0 | Copilot App canvas | Optional visual dashboard for the Spec Kit `bug` extension |

The plugins are independently installable and versioned. Install the core skills,
the assessment canvas, the bug fix canvas, or any combination.

## Core skills plugin

`spec-kit-copilot` gives Copilot focused skills—one per `specify` command group—so
the agent knows when and how to drive the CLI on your behalf.

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

## Assessment canvas plugin

`spec-kit-copilot-assess` ships `assess-canvas`, a side-panel dashboard for the
optional Spec Kit `assess` extension. It visualizes the intake → research → define
→ shape → decide funnel, previews artifacts, and invokes the generated assess skills.
When the project is not initialized for Spec Kit or does not have `assess`
installed, the canvas guides the agent through setup first.

The canvas has its own plugin manifest and release cadence; installing the core
`spec-kit-copilot` skills does not enable it. The canvas SDK is currently experimental,
so its wire protocol may change in future Copilot CLI releases.

## Bug fix canvas plugin

`spec-kit-copilot-bugfix` ships `bugfix-canvas`, a side-panel dashboard for the
optional Spec Kit `bug` extension. It visualizes the assess → fix → test triage
pipeline, previews artifacts, and invokes the generated bug skills. When the
project is not initialized for Spec Kit or does not have `bug` installed, the
canvas guides the agent through setup first.

Like the assessment canvas, it has its own plugin manifest and release cadence,
is not enabled by installing the core skills, and rides the same experimental
canvas SDK.

## Requirements

- [GitHub Copilot CLI](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-copilot-cli)
- Copilot CLI 1.0.71 or later when installing `spec-kit-copilot-assess`
- The Spec Kit `specify` CLI on your `PATH`:

  ```bash
  uv tool install specify-cli      # or: pipx install specify-cli
  specify --version
  ```

> **Versioning:** each plugin has an independent version and is not pinned to a
> specific Specify CLI version. The core plugin targets the **latest** `specify`
> published on PyPI (package `specify-cli`), with a
> minimum floor of **>= 0.11** for the `bundle` / `workflow step` skills. Install or
> upgrade with `uv tool install specify-cli` / `uv tool upgrade specify-cli` (or the
> `pipx` equivalents), or `specify self upgrade`. Each plugin's own `version` is
> independent of the CLI version.

## Installation

### Via marketplace (recommended)

This repository ships a marketplace manifest at
[`.github/plugin/marketplace.json`](.github/plugin/marketplace.json). Register the
marketplace, then install either or both plugins:

```bash
copilot plugin marketplace add OWNER/spec-kit-copilot
copilot plugin install spec-kit-copilot@spec-kit-marketplace
copilot plugin install spec-kit-copilot-assess@spec-kit-marketplace
copilot plugin install spec-kit-copilot-bugfix@spec-kit-marketplace
```

### Local development loading

Load either plugin directly from a checkout while iterating:

```bash
copilot --plugin-dir . plugin list
copilot --plugin-dir plugins/spec-kit-copilot-assess plugin list
copilot --plugin-dir plugins/spec-kit-copilot-bugfix plugin list
```

Verify it loaded:

```bash
copilot plugin list
# or, inside an interactive session:
/skills list
```

For a persistent branch install, use `OWNER/REPO` for the core plugin or
`OWNER/REPO:plugins/spec-kit-copilot-assess` for the canvas plugin.

Uninstall with the plugin's `name` (from `plugin.json`), not its path:

```bash
copilot plugin uninstall spec-kit-copilot
copilot plugin uninstall spec-kit-copilot-assess
copilot plugin uninstall spec-kit-copilot-bugfix
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

## Walkthroughs

> [!NOTE]
> Community walkthroughs are independently created and maintained by their respective authors. Review their content before following along and use at your own discretion.

See this plugin driving Spec-Driven Development end to end with this community-contributed walkthrough:

- **[Issue-to-implementation with the assess extension](https://github.com/mnriem/spec-kit-copilot-plugin-demo)** — Takes a raw GitHub issue from idea to shipped change entirely through GitHub Copilot CLI and this plugin: first the Idea Assessment Pipeline (the `assess` extension — intake → research → define → shape → decide) turns the issue into a scored go/no-go decision, then Spec-Driven Development (specify → plan → tasks → implement) delivers the change. Every step documents the exact prompt entered into Copilot.

## Layout

```javascript
spec-kit-copilot/
├── plugin.json              # Core skills plugin manifest
├── README.md
├── .github/plugin/
│   └── marketplace.json     # Marketplace manifest (for distribution)
├── plugins/
│   ├── spec-kit-copilot-assess/
│   │   ├── plugin.json      # Assessment canvas plugin manifest
│   │   └── extensions/
│   │       └── assess-canvas/
│   └── spec-kit-copilot-bugfix/
│       ├── plugin.json      # Bug fix canvas plugin manifest
│       └── extensions/
│           └── bugfix-canvas/
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
