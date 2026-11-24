# Risk-matrix Canvas Design test preset

This repository-local fixture is intentionally absent from `catalog.json`.
Its appended `load-page` command registers four distinct, replace-only
Specify named templates: `shared.control-definition`, `designer.setting-definition`,
`designer.control-adapter`, and `generated.control-adapter`. Only the command is appended;
the JSON files and complete `.mjs` modules are never appended, merged, or
registered as Specify scripts. Resolve all four names before opening
Designer. There is no separate Designer tab: the field is placed in
`essentials.options`, and its explicit `generatedBinding` places the
generated control in `details.content`. A missing or invalid adapter must
not fall back to stock text.
The real Specify/browser regression installs a disposable copy of this preset
with `--dev` before mutating resolved adapters; a development symlink must
never point those destructive checks back into this checked-in fixture.

The `risk-matrix` control defines the frozen `risk.rating` value:
`{impact, likelihood}`, where both properties are required, no others are
allowed, and each is exactly `low`, `medium`, or `high`. Designer initially
receives `null` as an unselected draft. Save may keep an incomplete `null` draft; Generate rejects incomplete or
invalid values. The Designer adapter permits `null` until the user selects
a cell; the generated adapter requires a complete value.

Both complete, self-contained host modules export `mount`. Designer also exports
pure `validate(value, field): boolean`, and its `mount` returns a handle with
`isReady(): boolean`. Designer calls `mount({root, field, value, onChange})`; generated calls
`mount({root, field, value})`. `root` is an exclusively owned DOM element,
`field` is the resolved field definition with `id`, and `onChange(nextValue)`
updates the unsaved draft. Generate validates using the approved Designer adapter; the host
supplies values by field ID but does not re-mount after `onChange`; the adapter
updates only its owned root to reflect the new selection. Generate packages
the winning generated `.mjs` locally with the source-owned app. There are no imports,
external calls, runtime edits, or stock scalar adapter files.

Impact runs across columns and likelihood down rows. Tab enters the selected
cell (or the first cell when unselected); arrows move and select, Home/End
move to the first/last cell, and Space/Enter select. Visible focus, labeled
axes and cells, and a read-only generated table with one marked selected
cell make the rating understandable without relying on color.
