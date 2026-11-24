# Copilot Minimal Essentials Test

This uncataloged, repository-local test preset replaces the Canvas Design
Essentials page and the composed `load-page` command. It keeps only the required
**Canvas ID** and **Title**, with the same labels, ID hint, and page slot. The
replacement command deliberately omits registration of optional stock-field
templates, but retains the stock-text definition and adapters required by the
fixed identity fields. This is a test fixture, not
a published preset or a general mechanism for disabling fields.

Install `extension-canvas-design` v0.1.18 or later in a **separate initialized
Designer child project**, then add this directory as a local development preset
in the Wizard selection (or use `specify preset add --dev <absolute-path>` in
that child project). Reload the generated skills and follow the composed
`speckit-extension-canvas-design-load-page` skill. The Wizard's handoff and its
runtime package selection are unchanged.

Generate with a valid, non-reserved Canvas ID and Title. With the current
worktree's Canvas Design source, the generated canvas uses description
`Spec Kit workflow canvas.` and workflow heading `Workflows`; each new
workflow requires an artifact folder name (slug). Removing either required
identity field or entering an invalid ID blocks Generate.

Because this preset **replaces** the load-page command, it captures the
Canvas Design v0.1.18 resolution instructions. Keep the replacement command
in sync with the base command when its contract changes. Other presets may append
their page/template registrations to its **Additional Designer pages** and
**Additional Canvas Design templates** sections in Specify's usual order.
