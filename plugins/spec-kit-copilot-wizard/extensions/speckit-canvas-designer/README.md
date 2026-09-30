# Spec Kit Canvas Designer shell

This extension is **under development and not ready for use**. It ships inside
the `spec-kit-copilot-wizard` plugin. Installing that plugin registers both the
Wizard and Designer canvases.

The intended primary flow launches Designer **from the Wizard**. The Wizard
provides a handoff containing its configured pipeline and selected presets,
extensions, and bundles; these will guide the generation of a workflow-specific
canvas in a later update. For now, Designer displays only a shell (with a
handoff summary when provided): it does not generate a canvas or install
selected customizations.

The Wizard launch flow supplies `{ "handoffId": "<id>" }` and asks the child
session to write the handoff JSON to
`speckit-canvas-designer/handoffs/<id>/handoff.json` **under that child's
`session.workspacePath`** before opening the canvas. The provider never writes
that file. Opening `speckit-canvas-designer` without input (or with `{}`)
shows an empty shell, not a generated canvas.

A supplied ID must match the bounded handoff ID pattern; the provider checks the
handoff structure, fingerprint, size, and session-artifact boundary. A supplied ID
with a missing or invalid file is an error, not an empty shell. The HTTP shell
binds to loopback and requires an unguessable URL token.

Run the provider tests with:

```bash
node --test plugins/spec-kit-copilot-wizard/extensions/speckit-canvas-designer/test/provider.test.mjs
```
