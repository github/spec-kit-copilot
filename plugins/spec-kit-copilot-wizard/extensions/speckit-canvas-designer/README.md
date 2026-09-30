# Spec Kit Canvas Designer

This extension is **under development and not ready for use**. It ships inside
the `spec-kit-copilot-wizard` plugin. Installing that plugin registers both the
Wizard and Designer canvases.

The primary flow launches Designer **from the Wizard**. The Wizard
provides a handoff containing its configured pipeline and selected presets,
extensions, and bundles. Child preparation installs the required Canvas Design
Spec Kit extension and approved customizations, then resolves registered JSON
pages before opening Designer. Essentials provides the identity controls;
Artifacts, Appearance, and Result Badges are empty placeholders. Save and
Generate remain disabled.

The Wizard launch flow supplies `{ "handoffId": "<id>" }` and asks the child
session to write the handoff JSON to
`speckit-canvas-designer/handoffs/<id>/handoff.json` **under that child's
`session.workspacePath`** before running the plugin's `bootstrap.mjs` preparation
script from the child checkout. Setup status is written separately; the handoff
is never changed. The provider comes from the installed plugin, not a copy in the
child checkout. Opening `speckit-canvas-designer` without input (or with `{}`)
shows an empty shell, not a generated canvas.

A supplied ID must match the bounded handoff ID pattern; the provider checks the
handoff structure, fingerprint, size, and session-artifact boundary. A supplied ID
with a missing or invalid file, failed preparation, or invalid page templates is
an error, not an empty shell. The HTTP shell
binds to loopback and requires an unguessable URL token.

Run the provider tests with:

```bash
node --test plugins/spec-kit-copilot-wizard/extensions/speckit-canvas-designer/test/provider.test.mjs
```
