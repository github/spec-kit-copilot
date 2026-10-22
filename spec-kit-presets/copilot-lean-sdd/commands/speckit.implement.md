---
description: Execute the implementation plan by processing all tasks in tasks.md.
---

## User Input

```text
$ARGUMENTS
```

## Copilot Execution

Run directly in Copilot. Read `.specify/feature.json` for `feature_directory`;
resolve it inside this project, outside `.specify`, `.git`, and `.github`.
Stop and report malformed or missing configuration, unsafe paths, or missing
required inputs. Do not infer the feature from a branch name or run setup scripts.
Use Copilot's `ask_user` tool for blocking questions; if unavailable, report and stop.

## Outline

1. Read `.specify/feature.json` to get the feature directory path.

2. **Load context**: `.specify/memory/constitution.md` and `<feature_directory>/spec.md`
   and `<feature_directory>/plan.md` and `<feature_directory>/tasks.md`. Require
   authored inputs; name the missing prerequisite skill and stop. Respect
   repository guidance and existing changes. No extra design artifacts or
   checklists are prerequisites; custom checklist checkboxes are reviewer-owned,
   not implementation completion signals.

3. **Execute tasks** in order:
   - Complete each task before moving to the next
   - Mark completed tasks by changing `- [ ]` to `- [x]` in `<feature_directory>/tasks.md`
   - Halt on failure and report the issue
   - Do not mark unverified, failed, or blocked work complete

4. **Validate**: Verify all tasks are completed and the implementation matches the
   spec and constitution. Run relevant existing tests/checks and report exact
   results, failures, or unavailable validation honestly.

5. Report completed and remaining work. Do not commit, push, publish, or invoke
   follow-up skills without user authorization.
