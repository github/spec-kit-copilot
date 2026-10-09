---
description: Resolve Designer settings pages and load them into the Canvas Designer.
---

## Context

$ARGUMENTS supplies the Wizard `handoffId` and, for an explicit reload, the
`requestId`. Preserve these values in the tool call. Work in this session's
project, not the Wizard's checkout. If the handoff ID is missing, ask for it;
do not guess or select another session's handoff.

## Pages

Load these default pages:

- `canvas-settings-setup`
- `canvas-settings-artifacts`
- `canvas-settings-appearance`
- `canvas-settings-results`

Presets may add pages in sections titled **Additional Designer pages** anywhere
in this command, including after the Steps. These additions extend the default
set; they do not run a second load operation.

## Steps

1. Read this entire composed command first. Collect the defaults and every name
   in every **Additional Designer pages** section, removing duplicates. Page
   names must start with a lowercase letter and contain only lowercase letters,
   digits and hyphens (at most 80 characters).
2. Follow the `speckit-preset` skill to run `specify preset resolve <name>` for
   each name from the project root. Resolve all pages before submitting any.
   Use Specify CLI >=1.0.7. Its human-readable output looks like:

       canvas-settings-setup: C:\project\.specify\extensions\extension-canvas-design\pages\setup.json
         (top layer from: extension:extension-canvas-design v0.1.0)

   Ignore leading indentation and record the complete path following the exact
   `<name>:` prefix. Preserve spaces and drive-letter colons; do not split on
   every colon. If output wraps, rerun with a sufficiently wide `COLUMNS`
   environment setting rather than guessing a truncated path.
3. Inspect the output AND exit status. `not found` can return exit code 0.
   Stop on missing/ambiguous results, command errors, or a composition warning
   for a page. Never choose a file by scanning `.specify`, reconstruct precedence,
   or substitute an extension default. Appended instructions in this command are
   allowed; composing multiple complete JSON documents for a page is not.
4. Call the custom `speckit_designer_load_pages` tool exactly once with
   `handoffId`, the supplied `requestId` if present, and
   `pages: [{"name": "<template-name>", "path": "<resolved-path>"}, ...]`.
   Submit the entire collected set, not individual pages. This tool is provided
   by the installed Canvas Designer Copilot extension, not by Specify.
5. Report the tool's result. On success, the validated model is ready for
   Designer. The launching agent may now open `speckit-canvas-designer` using
   the same `handoffId`; a reload updates already-open panels automatically.
   Do not claim that opening or loading succeeded before the tool succeeds.

If resolution fails before step 4, call the same tool with `handoffId`,
the supplied `requestId` if present, and `error` containing the CLI error/output
instead of `pages`. This reports failure without replacing existing pages.
Report failures unchanged. If the tool is unavailable, report that and stop;
do not run a Python helper or write the provider's state files yourself.
