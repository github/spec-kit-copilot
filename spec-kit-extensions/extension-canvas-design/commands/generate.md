---
description: Generate a new source-owned workflow canvas from a frozen Canvas Designer request.
---

## Context

$ARGUMENTS must supply the Designer handoff ID and prepared request ID. Run in
the Designer child session and checkout only. This command does not install
packages or run workflow phases. Creation does not register or open the app.

## Steps

1. Find this session's absolute checkout and `session.workspacePath` from session
   metadata; they are different paths. Read the frozen request at
   `<session.workspacePath>/speckit-canvas-designer/handoffs/<handoffId>/generations/<requestId>/request.json`.
   Use only these bounded IDs, never an arbitrary request path. Check the
   request's project binding, integrity, exact target, and installed runtime
   inventory. Do not substitute newer Designer edits or Designer-only package
   selections. If the target already exists, stop rather than overwriting it,
   unless the validated handoff explicitly authorized replacement.
2. Do not call `create-canvas` or scaffold a project extension.
3. Run `node .specify/extensions/extension-canvas-design/scripts/generate.mjs
   "<child-checkout>" "<session.workspacePath>" "<handoffId>" "<requestId>"`
   (the optional fifth CLI argument is `--replace-existing=<prior-request-id>`
   only when the
   Designer server has validated replacement against this same handoff and
   existing target's provenance; otherwise omit it). The generator
   refuses replacement if that prior request ID changes. Never infer replacement
   permission from a button label, the agent's prior chat, or the frozen
   `request.json`: the replacement flag is not part of that frozen request.
   This copies the maintained SDK entry point and workflow modules into a
   new `.github/extensions/<canvas-id>/`, writes the frozen configuration
   with runtime package IDs and the versions observed by Designer at Generate
   (or `unverified` when unavailable), plus observed priorities but no install-source
   paths or URLs, then validates the extension. The full install locators stay
   in the session-scoped handoff and request. Without validated replacement it
   never overwrites an existing target.
   Source-fingerprint differences, installed-version drift, and any failure to
   remove a prior backup after publication are reported in the command's
   `warnings` output; report them to the user. The generator proceeds with the
   intact frozen request when checkout, target, workflow, and installed inventory
   checks pass. Files are validated in a staging directory, with the entry point
   written only after validation. Confirmed replacement moves the old canvas
   to a backup before publishing the staged one. A publication failure restores
   the old canvas; after successful publication, a locked backup is retained
   for manual inspection and cleanup without failing Generate.
   On failure before publication, report the error. The generator
   removes its failed staging directory; if rollback or cleanup fails, report
   the retained path and error for inspection.
   Do not create an alternative implementation or retry.
4. Report the exact generated target, canvas ID, request ID, and any warnings
   or error in the child session chat. On success say the app was created but
   **not opened**; the separate Open action runs
   `speckit.extension-canvas-design.open-generated` with the same frozen
   handoff ID and request ID. Do not call `extensions_reload`,
   `extensions_manage`, `list_canvas_capabilities`, or `open_canvas` here.
   Reloading kills the Designer provider, so there is no in-panel retry
   after an Open handoff. Do not reopen Designer or run a workflow phase.

Generated canvases are not automatically updated when this extension changes later.
