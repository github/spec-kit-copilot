---
name: refresh-generated-canvas
description: 'Apply source-owned Canvas Design generator changes to an existing generated app in the newest qualifying Canvas designer project session. USE FOR: propagating visual or behavioral edits to generated canvas files, including the SDK entry point and files formerly rewritten after create-canvas. DO NOT USE FOR: creating a canvas, updating installed Wizard/Designer providers, installing the Specify extension, or rewriting another session without checking for user changes.'
argument-hint: '[description of the source changes to apply]'
---

# Refresh an existing generated canvas

This is a **cross-session development operation**, not generation or a plugin
release. A generated canvas is a copy: reloading the Wizard, Designer or Specify
extension cannot update it. Never run `create-canvas` or the Generate command
against an existing target. Do not touch the main checkout.

## Source of truth

Resolve the current worktree and inspect
`spec-kit-extensions/extension-canvas-design/scripts/generate.mjs` before
selecting files. Its `featureFiles` inventory plus
`generated-scaffold/extension.mjs` are the complete source-owned
runtime copied into a new canvas. Include **all relevant changed files** in
that inventory: SDK registration/hosting (`extension.mjs`), server, runtime,
contract, behavior modules, UI JavaScript, Markdown renderer and CSS. This
also covers files previously copied or rewritten after `create-canvas`; current
generation no longer invokes that scaffold. Do not copy
`canvas-config.json`, `canvas-setup.json`, `settings-provenance.json`, runtime
state, project artifacts, or files outside the generator's owned inventory.
Read the actual source diffs/requirements and `git status --short`; untracked
templates may lack a git base, so do not infer changes solely from `git diff`.

## Find the newest eligible session

1. Call `list_sessions_and_chats`. Filter **project sessions** to the current
   project's exact `project_id` and name `Canvas designer`. Sort by
   `created_at` descending, not last activity. If there are none, report
   failure. Do not create a session, select the current Wizard worktree, or
   fall back to a session in another project.
2. In that order, ask each candidate session to inspect **its own checkout**
   read-only, requesting one result message back to the calling session with
   its finding. A qualifying app is an actual project canvas under
   `.github/extensions/<id>/` with a regular `canvas-config.json` identifying
   the same canvas ID, `extension.mjs`, `server.mjs`, `runtime.mjs`, and
   `ui/app.js`. A running Designer shell, an installed
   `.specify/extensions/extension-canvas-design/` package, or a handoff file
   alone is **not** a generated app. The session must report the exact
   repo-relative app path and whether it has local edits. Wait for a concrete
   result before checking the next session; an unavailable or unresponsive
   candidate is not evidence that it lacks an app. If none can be confirmed,
   report failure and the reason rather than guessing.
3. Stop at the **first qualifying session**. If it contains multiple generated
   apps and the requested app is not identifiable, ask the user which one;
   never choose an app by directory order. If the session is archived or
   cannot accept work, report that blocker rather than silently choosing an
   older session.

## Apply in the selected session

Send the selected session an actionable, user-authorized request with the
resolved source worktree path, the owned file inventory, the specific changes
to propagate, and the exact qualifying app path. The selected session must
perform all writes in **its own checkout**. It may read the current worktree's
template files but must not edit that worktree. Send only after confirming the
target exists; message acceptance is not completion.

In the target session:

1. Record `git status --short`. Compare the installed canvas's owned files
   against current templates by path and hash, inspect its config/provenance,
   and inspect relevant diffs. Check for symlinks, junctions, escaping paths
   and unexpected installed-only runtime files. A legacy scaffolded canvas
   without a compatible mapping requires a reviewed, file-by-file migration;
   do not replace its SDK entry point wholesale.
2. Back up **each file to be changed** under that session's session-state
   `files/` directory. Merge the requested visual/behavioral edits into the
   generated copy. Only copy a whole file when the target is demonstrably
   unmodified relative to its generation baseline; preserve target-specific
   settings and later user customizations. Stop and ask if conflicts cannot be
   resolved confidently. Never mirror/delete directories or regenerate over
   the target.
3. Validate copied/merged files and the exact behavior with the smallest
   applicable existing tests. Run syntax checks on affected JS/MJS files,
   check the generated extension loads and its canvas opens if possible, and
   verify that saved config and workflow artifacts are intact. If an active
   canvas provider serves cached code, reload **that target session's** project
   extension and reopen its canvas; do not claim an already-open panel changed
   without checking it.
4. Report the target session link, app path, changed files and any blockers.
   Do not claim success until the target session confirms the applied and
   verified changes. If no qualifying app exists, report failure; do not
   silently settle for updating templates only.
