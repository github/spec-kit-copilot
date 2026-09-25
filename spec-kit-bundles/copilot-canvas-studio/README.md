# Copilot Canvas Studio bundle

This design-only Spec Kit bundle contributes the `copilot-canvas-studio`
preset at priority 10. It changes the generated canvas theme, not the runtime
phase provider or the Wizard interface.

The bundle manifest references the preset by ID. Before installation, make
the [Copilot preset catalog](../../spec-kit-presets/catalog.json) available to
Specify with install permission; otherwise the bundle installer cannot
resolve its component. Catalog and installed manifests must both carry the
`canvas-design` tag. The Wizard checks all declared members before offering
this bundle in Generate. A released zip includes this README and `bundle.yml`.
