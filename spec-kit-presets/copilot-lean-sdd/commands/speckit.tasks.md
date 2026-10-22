---
description: Create the tasks needed for implementation and store them in tasks.md.
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
   and `<feature_directory>/plan.md`. Require authored inputs; name a missing
   prerequisite skill (`speckit-constitution`, `speckit-specify`, `speckit-plan`)
   and stop. No research, data-model, contract, or checklist files are required.

3. Create dependency-ordered implementation tasks and store them in `<feature_directory>/tasks.md`.
   - Every task uses checklist format: `- [ ] [TaskID] Description with file path`
   - Use unique `T001`, `T002`, ... identifiers (at least three digits)
   - Organized by phase: setup, foundational, user stories in priority order, polish
   - Trace tasks to spec requirements and plan decisions; include their validation
   - Mark `[P]` only for genuinely independent tasks; do not require delegation
   - If existing tasks record progress, confirm replacement via `ask_user` first

4. Report task count and ordering. Do not execute tasks or create issues automatically.
