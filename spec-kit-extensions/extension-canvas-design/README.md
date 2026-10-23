# Canvas Design

A Spec Kit extension that supplies settings-page templates and a page-loading
command for a compatible Copilot Canvas Designer.

## What It Does

Canvas Design **0.1.0** registers four JSON page templates and the
`speckit.extension-canvas-design.load-page` command. The command resolves the
project's preset-composed pages and submits them to the Designer provider.

| Template | Page | Default contents |
| --- | --- | --- |
| `canvas-settings-setup` | Essentials | Canvas ID, Title, Description, Workflow header, Show slug field |
| `canvas-settings-artifacts` | Artifacts | Empty placeholder |
| `canvas-settings-appearance` | Appearance | Empty placeholder |
| `canvas-settings-results` | Result Badges | Empty placeholder |

The package includes the page schema, but not the Designer provider. It does not
implement canvas generation, persistence, or result evaluation.

## Requirements

- Specify CLI **>=1.0.7** and an initialized Spec Kit project.
- GitHub Copilot with a separately installed, compatible Canvas Designer
  provider exposing `speckit_designer_load_pages`.
- A launching integration that supplies the Designer handoff.

Installing this extension does not install or open a Designer. Compatibility
with a released Wizard version is not established by this package.

## Installation

**Recommended: register the catalog once, then install by ID.** Catalogs are
discovery-only by default; `--install-allowed` permits installation:

```powershell
specify extension catalog add https://raw.githubusercontent.com/github/spec-kit-copilot/main/spec-kit-extensions/catalog.json --name spec-kit-copilot --install-allowed
specify extension add extension-canvas-design
```

For a one-off installation without registering the catalog, use the release ZIP:

```powershell
specify extension add extension-canvas-design --from https://github.com/github/spec-kit-copilot/releases/download/extension-canvas-design-v0.1.0/extension-canvas-design.zip
```

The ZIP must be published before either installation method can succeed.
For a new Copilot project, initialize it first:

```powershell
specify init . --integration copilot --integration-options="--skills"
```

Use normal installation rather than a development symlink for preset composition.
In Copilot skills mode, the command is exposed as
`speckit-extension-canvas-design-load-page`. Run `/skills reload` after installing
or changing composed skills to make them available in the current session.

## How It Works

The [page-loading command](commands/load-page.md) collects the default template
names and any additional names contributed by presets. It uses
`specify preset resolve <name>` to find each project's effective page, then
submits the complete set to the compatible Designer provider. Missing pages or
an unavailable provider stop the operation.

Presets can replace an existing page template or append instructions that add
pages to the command. Adding a JSON file alone does not register a new page.
Page definitions must follow the [page schema](schemas/page.schema.json).

## License

MIT
