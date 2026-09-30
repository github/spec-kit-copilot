# Canvas Design

Canvas Design **0.1.0** is a Spec Kit extension requiring Specify CLI **>=1.0.7**.
It supplies JSON settings pages for the Canvas Designer; it is not a Copilot
plugin or a canvas provider.

The Wizard's Canvas Designer setup includes this extension automatically as a
checked, locked requirement. Launch captures its validated local source, version,
and content fingerprint in an immutable handoff. In the nested session, Specify
installs the extension and approved optional packages before the Copilot provider
opens Designer. The Wizard's configuration is not changed.

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

Pages are discovered from `specify artifact list --json` and resolved through
Specify's preset precedence, with effective artifact provenance checked before
rendering. Dropping an arbitrary JSON file into a directory does not register it.
To add or override a page, declare its `canvas-settings-*` template in a preset or
extension manifest and supply JSON conforming to `schemas/page.schema.json`.

Page JSON defines its title, description, order, enabled state, and fields.
Enabled pages sort by order, then page ID. Fields support strings and booleans;
field IDs must be unique across enabled pages. Canvas ID and Title must remain
present. The identity fields retain their built-in constraints even when a
preset changes their labels or placement. Missing winning files, unsupported
controls/composition, unsafe paths, or invalid JSON are errors, not reasons to
ignore a preset and use the base page.

The UI retains temporary edits across page navigation, but does not save them.
**Save and Generate are disabled.** Artifacts, Appearance, and Result Badges are
placeholders; custom HTML, generation, and result evaluation are not supported.
Theme switching and the live connection indicator are functional.

## Tests

With Python and `specify-cli >=1.0.7` installed:

```powershell
python -X utf8 -m unittest discover -s spec-kit-extensions\canvas-design\tests -v
```

Tests initialize temporary projects, install the package through Specify, and
exercise registration, preset overrides, ordering, disabled pages, and invalid
templates. Designer browser tests live in the Wizard's existing Playwright suite.
