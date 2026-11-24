# Generated-only page test fixture

This repository-local Specify preset is **not** in the canonical catalog.
Install it alongside `extension-canvas-design` for a local integration test.
It appends two explicitly registered, complete replace-only named templates
to the composed `load-page` command: a `generated.added-page-definition` JSON definition and
its `generated.added-page-renderer` `.mjs` module. It adds no Designer tab. Generate
copies the winning definition and renderer into the source-owned app; the
resulting app does not resolve the preset or the Canvas Design extension.
