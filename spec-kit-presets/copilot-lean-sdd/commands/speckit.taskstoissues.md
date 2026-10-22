---
description: Deprecated, explicitly authorized conversion of Lean tasks to GitHub issues.
---

## Deprecation Notice

First warn that `speckit-taskstoissues` is deprecated. Recommend the bundled
`github` extension's task-to-issues command for future use, but do not install,
enable, or invoke it automatically. Continue this requested workflow.

## User Input

```text
$ARGUMENTS
```

## Copilot Execution

Run directly in Copilot. Read `.specify/feature.json` for `feature_directory`;
resolve it inside this project, outside `.specify`, `.git`, and `.github`.
Stop and report malformed or missing configuration, unsafe paths, or missing
required inputs. Do not infer the feature from a branch name or run setup scripts.
Use Copilot's `ask_user` tool for authorization; if unavailable, report and stop.

## Outline

1. Require authored `<feature_directory>/tasks.md`; suggest `speckit-tasks` and
   stop if absent. Read spec, plan, and constitution if present for context, but
   do not require additional artifacts or modify any of them.

2. Read `git config --get remote.origin.url`. Resolve the exact GitHub host and
   owner/repository, including SSH remotes. Stop for missing, ambiguous, or
   non-GitHub remotes. Never create issues in another repository.

3. Strip checkbox and optional `[P]` / `[US#]` markers to extract task IDs and
   descriptions. IDs are `T` plus at least three digits, matched with
   `\bT\d{3,}\b` so `T1000` is not mistaken for `T100`. Validate unique IDs.
   Read existing open AND closed issues with pagination and deduplicate by whole
   task ID. Stop fetching when all task IDs match or pagination is exhausted.
   Report duplicates as skipped. If issue retrieval fails, stop; do not assume empty.

4. Before any write, obtain explicit permission for the target repository and
   proposed issue set using `ask_user`, unless that exact action was already
   authorized. Use the available issue-creation tool required by the Copilot host;
   if unavailable, report the capability gap rather than claiming success.
   Create only missing issues, title `T001: <description>`, preserving task intent,
   file paths, and dependency order in the body. Stop/report errors and partial
   completion; do not silently retry a possibly successful creation.

5. Report created issue URLs and skipped/failed tasks. Do not change task states,
   install extensions, or invoke another skill.
