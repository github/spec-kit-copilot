# Spec Kit Canvas Designer shell

This extension is **under development and not ready for use**. It ships inside
the `spec-kit-copilot-wizard` plugin. Installing that plugin registers both the
Wizard and Designer canvases.

Open `speckit-canvas-designer` without input (or with `{}`) for an empty shell.
Design pages are not implemented yet. When launched from the Wizard, supply
`{ "handoffId": "<id>" }` to open with its handoff. The Wizard launch flow asks
the child session to write the handoff JSON to
`speckit-canvas-designer/handoffs/<id>/handoff.json` **under that child's
`session.workspacePath`** before opening the canvas. The provider never writes
that file or installs the selected customizations.

A supplied ID must match the bounded handoff ID pattern; the provider checks the
handoff structure, fingerprint, size, and session-artifact boundary. A supplied ID
with a missing or invalid file is an error, not an empty shell. The HTTP shell
binds to loopback and requires an unguessable URL token.

Run the provider tests with:

```bash
node --test plugins/spec-kit-copilot-wizard/extensions/speckit-canvas-designer/test/provider.test.mjs
```
