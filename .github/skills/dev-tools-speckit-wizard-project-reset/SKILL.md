---
name: dev-tools-speckit-wizard-project-reset
description: 'Back up and reset the current worktree for a fresh Wizard test. USE FOR: clearing Spec Kit setup, generated project skills, feature specs, and Wizard state. DO NOT USE FOR: deleting repository source, installed providers, personal settings, or resetting a shared checkout.'
argument-hint: '[current worktree]'
---

# Reset a Wizard test project

This resets the current worktree's **project data**, not the installed Wizard,
Designer, Specify CLI, or runtime settings. It moves `.specify`,
`.speckit-wizard`, `specs`, and Spec Kit skills identified by the installed
Copilot manifest and extension/preset registries into a recoverable backup.
Unregistered skills and all tracked files are protected.

1. Resolve the current worktree root and record `git status --short`. Do not
   target the main checkout or another session's workspace. Ensure no Wizard
   instance or background task is actively writing this project's state.
2. Choose a new, unique backup directory under this session's
   `session-state\...\files\`. Run the read-only preview:

   `node dev-tools\reset-wizard-project.mjs --project "<absolute worktree>" --backup "<absolute new backup directory>"`

   Review its exact targets, retained unregistered skills, and warnings. If the
   user has not authorized resetting that scope, ask before applying. Never
   assume a directory is disposable merely because Git ignores it.
3. Run the same command with `--apply --expect "<preview digest>"`. A stale
   preview, tracked target, unsafe path, or failed move must stop the reset;
   never work around the check with `git clean`, recursive deletion, or a
   guessed path. Re-preview after any conflict.
4. Verify the reported targets are absent and their backups exist. Compare Git
   status, preserving all prior source changes. Reload session skills to discover
   the new project skill and drop removed generated skills. Do not initialize
   Spec Kit, run a phase, change providers, or open a canvas unless requested.

The backup mirrors the worktree-relative paths and contains a reset manifest.
To restore, first ensure the corresponding live destination is absent; preserve
any newer work and move only the desired backed-up paths back. Never overwrite
newer content.
