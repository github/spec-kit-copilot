# Canvas Design

Canvas Design **0.1.0** is a Spec Kit extension requiring Specify CLI **>=1.0.7**.
It supplies JSON settings pages for the Canvas Designer; it is not a Copilot
plugin or a canvas provider.

## Installation

From an initialized project, register the Copilot-specific extension catalog
once, then install by ID:

```powershell
specify extension catalog add https://raw.githubusercontent.com/github/spec-kit-copilot/main/spec-kit-extensions/catalog.json --name spec-kit-copilot --install-allowed
specify extension add canvas-design
```

Alternatively, install directly from a published release without registering
the catalog:

```powershell
specify extension add canvas-design --from https://github.com/github/spec-kit-copilot/releases/download/extension/canvas-design/v0.1.0/canvas-design.zip
```

The release ZIP must be published before either installation method can succeed.
For a new Copilot project, initialize it with
`specify init . --integration copilot --integration-options="--skills"` first.
Normal installation copies the package; do not use a development symlink install
for preset composition. Copilot skills mode exposes the command as
`speckit-canvas-design-load-page`. Use `/skills reload` to discover newly installed
or composed skills in the current session.

## Required Designer capability

The package requires a separately installed, compatible Copilot Canvas Designer
provider exposing the **`speckit_designer_load_pages` custom tool** before its
panel opens. That provider/tool is **not shipped by this package**. Installing or
publishing this extension does not create a standalone Designer, and no released
Wizard version is asserted to support this page/tool protocol.

The launching integration must supply a valid `handoffId` and, when reloading,
a `requestId`. The command resolves all pages in that session's project and
submits them together. If the tool is missing, the command must report that and
stop; it must not invent a fallback, run a Python helper, or write provider state.
Only after a successful tool result may the launching integration open
`speckit-canvas-designer` using the same handoff ID.

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
command or a Python script. A compatible provider is responsible for validating
the input and storing the resulting model; this package supplies only the
command, page templates, and schema. The agent is responsible for using the
CLI-selected paths, not independently reconstructing template precedence.

Page JSON defines its full template `id`, title, description, order, enabled state, and fields.
Enabled pages sort by order, then page ID. Fields support strings and booleans;
field IDs must be unique across enabled pages. Canvas ID and Title must remain
present. The identity fields retain their built-in constraints even when a
preset changes their labels or placement. Each file must conform to
`schemas/page.schema.json`, have an `id` equal to its supplied template name,
and resolve to a regular `.json` file inside the session project's `.specify/`.
Invalid names, escaping symlinks, unsupported controls, duplicate fields, invalid
JSON and oversized files reject the entire batch without replacing the last
valid model.
The compatible provider must enforce limits of 100 pages, 256 KiB per file,
and a 2 MiB saved model. These batch, path, uniqueness, and identity constraints
are provider requirements beyond the per-file JSON schema; they are not enforced
by installing this package alone.

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
After installing or removing a preset, refresh the composed skill with
`/skills reload` and use the compatible provider's explicit reload flow.
Artifacts, Appearance, and Result Badges are empty page templates. This package
does not implement UI persistence, canvas generation, or result evaluation.

## Tests

From the repository root, with Python 3.12 or later:

```powershell
python -m pip install -r spec-kit-extensions\tests\requirements.txt
python -m unittest discover -s spec-kit-extensions\tests -v
```

These focused package tests cover manifest/catalog agreement, discovery tags,
shipped files, JSON schema acceptance/rejection, default page shape, and the
agent command contract.
The release workflow builds the ZIP inline with `extension.yml` at its root and
reruns the tests with `CANVAS_DESIGN_ARCHIVE` set to the archive path, checking the
exact member set and bytes. Set that environment variable to check a local ZIP.
No Wizard dependencies or provider are needed for these checks.

Real Specify normal-install/preset-composition tests and consumer migration are
a separate follow-up. These package checks do not claim that the full
CLI/provider integration matrix has passed.
