# Spec Kit Canvas Designer

This extension is **under development and not ready for use**. It ships inside
the `spec-kit-copilot-wizard` plugin. Installing that plugin registers both the
Wizard and Designer canvases.

The primary flow launches Designer **from the Wizard**. The Wizard
provides a handoff containing its configured pipeline and selected presets,
extensions, and bundles. The child agent invokes the Spec Kit skills to initialize
the child project when needed and install the required Canvas Design extension
and approved customizations, inspect CLI results, and report setup failures.
The provider resolves registered JSON pages when opening Designer; it does not
independently verify package installation. Essentials provides the identity controls;
Artifacts, Appearance, and Result Badges are empty placeholders. Save and
Generate remain disabled.

The Wizard launch flow supplies `{ "handoffId": "<id>" }` and asks the child
session to write the handoff JSON to
`speckit-canvas-designer/handoffs/<id>/handoff.json` **under that child's
`session.workspacePath`**. The handoff stays unchanged. In its own checkout,
the agent invokes `speckit-init` only if uninitialized,
`speckit-extension` for the required local DEV package, `speckit-bundle` for approved
bundles, and `speckit-extension` / `speckit-preset` for remaining selections.
The agent handles CLI results and avoids duplicate installs of components just
installed by a selected bundle. ID/version alone is not proof of an existing
package's source. Setup errors are reported in the child conversation and stop
the launch. Downloads, installs and package verification belong to the agent
following the skills, just as in the Wizard.

After init and again after all installations, the agent calls the provider's
`speckit_designer_reload_skills` tool. This uses `session.rpc.skills.reload()`, the
same mechanism as the Wizard's reload action; printing `/skills reload` is not
sufficient. The tool is available without opening a canvas. Missing reload support,
RPC failures or skill-loading errors stop setup. Warnings are logged.

There is no setup-verification script, package-provenance gate or readiness
receipt. Once the agent reports successful setup, it reloads extensions and
opens Designer. The provider validates the handoff and its bundled page-loader
source, discovers registered templates using Specify's artifact registry, and
validates the resolved JSON pages. It does not query installed package inventories
or interpret CLI package-source fields. A successful open means valid pages and
a successful skill reload, not an independent attestation of package installation.
Opening also performs a real skill reload and fails if it reports errors.
The provider comes from the installed plugin, not a copy in the
child checkout. Opening `speckit-canvas-designer` without input (or with `{}`)
shows an empty shell, not a generated canvas.

A supplied ID must match the bounded handoff ID pattern; the provider checks the
handoff structure, fingerprint, size, and session-artifact boundary. A supplied ID
with a missing or invalid file, changed bundled source, or invalid page templates is
an error, not an empty shell. The HTTP shell
binds to loopback and requires an unguessable URL token.

Run the provider tests with:

```bash
node --test plugins/spec-kit-copilot-wizard/extensions/speckit-canvas-designer/test/provider.test.mjs
```
