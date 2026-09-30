# Spec Kit Canvas Designer

This extension is **under development and not ready for use**. It ships inside
the `spec-kit-copilot-wizard` plugin. Installing that plugin registers both the
Wizard and Designer canvases.

The primary flow launches Designer **from the Wizard**. The Wizard
provides a handoff containing its configured pipeline and selected presets,
extensions, and bundles. The child agent invokes the Spec Kit skills to initialize
the child project when needed and install the required Canvas Design extension
and approved customizations. A validation-only helper then checks installed
packages and resolves registered JSON pages before opening Designer. Essentials provides the identity controls;
Artifacts, Appearance, and Result Badges are empty placeholders. Save and
Generate remain disabled.

The Wizard launch flow supplies `{ "handoffId": "<id>" }` and asks the child
session to write the handoff JSON to
`speckit-canvas-designer/handoffs/<id>/handoff.json` **under that child's
`session.workspacePath`**. From the child checkout it runs the plugin's
`validate-setup.mjs preflight <id> <checkout> <session-workspace>` before project
changes. Preflight checks the immutable handoff, source, child boundary and any
existing setup. The agent then invokes `speckit-init` only if uninitialized,
`speckit-extension` for the required local DEV package, `speckit-bundle` for approved
bundles, and `speckit-extension` / `speckit-preset` for remaining selections.
Matching installed packages, including bundle-owned members, are not reinstalled;
conflicts or installation errors stop setup. Downloads and installs are performed
by the agent following the skills, not by a JavaScript installer.

After init and again after all installations, the agent calls the provider's
`speckit_designer_reload_skills` tool. This uses `session.rpc.skills.reload()`, the
same mechanism as the Wizard's reload action; printing `/skills reload` is not
sufficient. The tool is available without opening a canvas. Missing reload support,
RPC failures or skill-loading errors stop setup. Warnings are logged.

The child then runs `validate-setup.mjs verify <id> <checkout> <session-workspace>`.
Neither validation mode initializes, downloads or installs; only the separate
session-artifact setup receipt is written. Verification requires compatible
Copilot skills mode, all selected packages, matching required source files and
valid registered pages before marking the receipt ready. The handoff is never
changed. After extension reload, opening a prepared Designer performs another
skill reload and fails without opening the canvas if it reports errors.
The provider comes from the installed plugin, not a copy in the
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
