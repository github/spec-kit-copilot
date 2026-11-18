---
description: Register and open an existing generated workflow canvas from a frozen Designer request.
---

## Context

$ARGUMENTS must supply the Designer handoff ID and frozen request ID sent by
the Open action. Run in that Designer child session and its checkout only.
This command opens an **existing** project extension; it never runs Generate,
replaces files, installs packages, or runs workflow phases. A reset or cleared
session does not prove that the project provider is registered.

## Steps

1. Obtain this session's absolute child checkout and `session.workspacePath`
   from session metadata. Run
   `.specify/extensions/extension-canvas-design/scripts/validate-generated-open.mjs`
   in `target` mode with `<child-checkout> <session.workspacePath> <handoffId>
   <requestId>`. Use only the returned `canvasId` and `target`; stop on a
   nonzero exit and report the exact error in chat. The source-owned validator bounds
   and checks the frozen `request.json`, its `sourceFingerprint` and exact
   target before using it. Only if that request
   is unavailable after reset/clear does it inspect immediate child directories
   of this checkout's `.github/extensions/`, with bounded, no-follow reads of
   `settings-provenance.json`. Require one unique matching directory with both
   exact IDs, valid provenance, `canvas-config.json` and `extension.mjs`.
   IDs must match `[A-Za-z0-9][A-Za-z0-9_-]{0,127}`. A present but invalid request is
   an error, not an excuse to choose another app. Do not read or scan the
   metadata yourself or infer an ID from another session or extension registry.
   Do not regenerate or select a different project extension.
2. If the target validator fails or the target is missing, report the exact
   error in chat; do not reload extensions or open a different canvas.
3. Call `extensions_reload` **in this child session** before discovery, even
   when reopening after reset/clear. This terminates the Designer provider:
   do not reopen it or attempt an in-panel retry. If reload fails, report the
   error and target in chat without claiming the app opened.
4. Call `extensions_manage` with `operation: "list"`, then `operation:
   "inspect"` for the generated project extension. Run
   `.specify/extensions/extension-canvas-design/scripts/validate-generated-open.mjs`
   in `provider` mode with `<child-checkout> <canvas-id> <requestId>` and JSON
   stdin containing the **verbatim** management responses as
   `{"list":"<list output>","inspect":"<inspect output>"}`. On Windows a
   PowerShell here-string piped to `node <script> provider ...` avoids writing
   a result file. Stop on a nonzero exit: require exactly one running (or
   ready) project provider with its entry-point path at
   `<child-checkout>/.github/extensions/<canvas-id>/extension.mjs`, not a
   user-owned, stale, failed, or same-named provider from elsewhere.
5. Use the validated `extensionId` in `list_canvas_capabilities` for the
   frozen canvas ID. Run the validator in `canvas` mode with JSON stdin
   `{"capabilities":{"canvasId":"<ID explicitly returned by tool>",
   "extensionId":"<ID explicitly returned by tool>"}}`. Do not fill in a
   missing result ID from the request or infer it from an action list. Stop
   on a nonzero exit before opening. Call `open_canvas` for that exact
   extension ID and canvas ID, with instance ID `generated-<requestId>`.
   Run the validator in `open` mode with JSON stdin
   `{"opened":{"canvasId":"<returned ID>","extensionId":"<returned ID>",
   "instanceId":"<returned ID>"}}`. Copy only IDs explicitly returned by
   the open tool; a nonzero exit or missing field is a failed open.
6. Report the exact target and success only after the open result passes
   validation. Otherwise report the exact reload, registration, capability,
   or open error in the child chat. Do not claim success just because files
   exist, and do not call Generate or reopen Designer.

Generated canvases are not automatically updated when Canvas Design changes later.
