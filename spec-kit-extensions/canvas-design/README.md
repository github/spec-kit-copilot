# Canvas Design

Canvas Design **0.1.0** is a Spec Kit extension requiring Specify CLI **>=1.0.7**.
It supplies JSON settings pages for the Canvas Designer; it is not a Copilot
plugin or a canvas provider.

The Wizard's Canvas Designer setup includes this extension automatically as a
checked, locked requirement. Launch captures its validated local source, version,
and content fingerprint in an immutable handoff. In the nested session, Specify
installs the extension and approved optional packages, then runs the composed
`speckit-canvas-design-load-page` skill. Only after its custom tool succeeds does
the agent open Designer. The Wizard's configuration is not changed.

This development integration expects this package alongside the Wizard sources
under `spec-kit-extensions/canvas-design`. It installs with
`specify extension add <validated-source-directory> --dev`. Missing or changed
sources block launch; there is no silent fallback to a different release.

## Registered pages

| Template name | Page title | Order | Contents |
| --- | --- | --- | --- |
| `canvas-settings-setup` | Essentials | 10 | Canvas ID, Title, Description, Workflow header, Show slug field |
| `canvas-settings-artifacts` | Artifacts | 20 | Empty |
| `canvas-settings-appearance` | Appearance | 30 | Empty |
| `canvas-settings-results` | Result Badges | 40 | Empty |

`commands/load-page.md` declares the initial page set. The agent reads the
**entire preset-composed command**, including all appended "Additional Designer
pages" sections, and resolves each name with `specify preset resolve <name>`.
It inspects the CLI output: even exit code zero can report `not found`. Missing
templates, composition warnings and command failures stop the load; there is no
fallback to the extension's default file.

The agent submits the complete set of `{name, path}` pairs once to
`speckit_designer_load_pages`, a **custom tool registered by the Copilot Designer
provider**, available before opening its panel. This is not a built-in Specify
command or a Python script. It validates the input, reads the JSON in Node, and
stores the validated canvas model in the child's session artifacts. It does not
resolve templates, search for Python, run CLI subprocesses, or independently
attest which template should have won. The agent is responsible for using the
CLI-selected paths.

Page JSON defines its full template `id`, title, description, order, enabled state, and fields.
Enabled pages sort by order, then page ID. Fields support strings and booleans;
field IDs must be unique across enabled pages. Canvas ID and Title must remain
present. The identity fields retain their built-in constraints even when a
preset changes their labels or placement. Each file must conform to
`schemas/page.schema.json`, have an `id` equal to its supplied template name,
and resolve to a regular `.json` file inside the child project's `.specify/`.
Invalid names, escaping symlinks, unsupported controls, duplicate fields, invalid
JSON and oversized files reject the entire batch without replacing the last
valid model.
Loads are limited to 100 pages, 256 KiB per file, and a 2 MiB saved model.

## Customize pages with a preset

To replace Appearance, declare a JSON template in your `preset.yml`:

```yaml
schema_version: "1.0"
preset:
  id: copilot-canvas-appearance
  name: Copilot Canvas Appearance
  version: "1.0.0"
  description: Replace the Designer Appearance page.
requires:
  speckit_version: ">=1.0.7"
  extensions: [canvas-design]
provides:
  templates:
    - type: template
      name: canvas-settings-appearance
      file: pages/appearance.json
      strategy: replace
```

The JSON `id` must be `canvas-settings-appearance`. Use a small local preset for
project-level changes: `.specify/templates/overrides/` expects Markdown files,
which the JSON loader rejects.

To add a new page, declare both its JSON template and an appended command
contribution in the preset:

```yaml
schema_version: "1.0"
preset:
  id: copilot-canvas-accessibility
  name: Copilot Canvas Accessibility
  version: "1.0.0"
  description: Add a Designer Accessibility page.
requires:
  speckit_version: ">=1.0.7"
  extensions: [canvas-design]
provides:
  templates:
    - type: template
      name: canvas-settings-accessibility
      file: pages/accessibility.json
      strategy: replace
    - type: command
      name: speckit.canvas-design.load-page
      file: commands/add-pages.md
      strategy: append
```

`commands/add-pages.md` contains instructions, without frontmatter:

```markdown
## Additional Designer pages

- canvas-settings-accessibility
```

`pages/accessibility.json` contains, for example:

```json
{
  "schemaVersion": 1,
  "id": "canvas-settings-accessibility",
  "title": "Accessibility",
  "order": 50,
  "enabled": true,
  "fields": []
}
```

Append **command instructions**, not JSON content. Merely dropping a JSON file
into a directory or registering an additional template does not add it to the
command's page set. There is no automatic artifact discovery or package watcher.
After installing or removing a preset, explicitly **Reload pages** to invoke the
current composed skill again.

The UI retains temporary edits across page navigation, but does not save them.
Reload asks before discarding edits; successful reload replaces the full model
and restores defaults, while failed reload retains the last valid model and edits.
Navigation and connection recovery do not dispatch agent turns. Pending reloads
offer an explicit retry; superseded callbacks cannot publish their page set.
**Save and Generate are disabled.** Artifacts, Appearance, and Result Badges are
placeholders; custom HTML, generation, and result evaluation are not supported.
Theme switching and the live connection indicator are functional.

## Tests

With Node and `specify-cli >=1.0.7` installed:

```powershell
$env:DESIGNER_CLI_TESTS = "1"
node --test plugins\spec-kit-copilot-wizard\extensions\speckit-wizard-canvas\test\designer-pages.test.mjs
```

Tests initialize temporary projects, install the package through Specify, and
exercise default resolution, preset replacements, command appends and removal,
plus Node validation, ordering, disabled pages and invalid templates. CI includes
a Windows uv-isolated CLI install. Designer browser tests live in the Wizard's
existing Playwright suite. These tests cover real CLI composition and provider
contracts, not a live autonomous child agent.
