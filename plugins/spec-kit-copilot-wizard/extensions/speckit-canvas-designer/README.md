# Spec Kit Canvas Designer

This extension is **under development and not ready for use**. It ships inside
the `spec-kit-copilot-wizard` plugin. Installing that plugin registers both the
Wizard and Designer canvases.

The primary flow launches Designer **from the Wizard**. The Wizard
provides a handoff containing its configured pipeline and selected presets,
extensions, and bundles. The child agent invokes the Spec Kit skills to initialize
the child project when needed and install the required Canvas Design extension
and approved customizations, inspect CLI results, and report setup failures.
The agent resolves JSON pages through the composed load-page skill and submits
them to the provider's custom tool before opening Designer. The provider does not
independently resolve templates or verify package installation. Essentials provides the identity controls;
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
receipt. Once setup and skill reload succeed, the agent invokes the generated
`speckit-canvas-design-load-page` skill, including preset-appended page declarations.
The skill directs the agent to run `specify preset resolve` for each name and pass
the complete set of resolved JSON paths to `speckit_designer_load_pages`. That
custom tool is registered by this provider, works before the panel opens, and
only validates and stores the pages. It does not locate a Python interpreter,
import Specify internals, or run subprocesses.

Only after the tool succeeds does the agent open Designer. The provider validates
the handoff and reads the persisted `pages.json` model beside that handoff in the
session artifacts. This is canvas state, not a setup receipt. Reopening or provider
restart uses that model without rerunning resolution. A successful open means valid pages and
a successful skill reload, not an independent attestation of package installation.
Opening also performs a real skill reload and fails if it reports errors.
The provider comes from the installed plugin, not a copy in the
child checkout. Opening `speckit-canvas-designer` without input (or with `{}`)
shows an empty shell, not a generated canvas.

Loading, reloading and recovering pages use the child checkout reported by
`session.rpc.metadata.snapshot()`, through the Wizard's shared workspace resolver.
The provider caches a successfully resolved checkout, never falls back to its
process cwd or the session-artifact directory, and reports unavailable metadata
as an error. The saved model's checkout binding remains enforced.

A supplied ID must match the bounded handoff ID pattern; the provider checks the
handoff structure, fingerprint, size, and session-artifact boundary. A supplied ID
with a missing or invalid file, changed bundled source, or invalid page templates is
an error, not an empty shell. The HTTP shell
binds to loopback and requires an unguessable URL token.

**Reload pages** reloads the session's skills and queues the composed load command
with a request token. A successful full-batch load atomically replaces the stored
model and updates matching open panels over SSE. The UI confirms discarding drafts,
retains them on failure, and offers explicit retry if an agent turn never reports
a result. Older request tokens are rejected. Tab switches and SSE reconnects do
not invoke the agent. Package changes are picked up on the next explicit reload,
not by a watcher. See the [package documentation](../../../../spec-kit-extensions/canvas-design/README.md)
for template registration, overrides and additional-page examples.

Run the provider tests with:

```bash
node --test plugins/spec-kit-copilot-wizard/extensions/speckit-canvas-designer/test/provider.test.mjs
```
