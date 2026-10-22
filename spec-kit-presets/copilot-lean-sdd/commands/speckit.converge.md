---
description: Find remaining implementation work and append it to tasks.md.
---

## User Input

```text
$ARGUMENTS
```

## Outline

1. Read `.specify/feature.json` to get the feature directory path.

2. **Load context**: `.specify/memory/constitution.md` and `<feature_directory>/spec.md`, `plan.md`, and `tasks.md`.
   - Stop and report missing configuration or required inputs
   - Run after implementation

3. Compare current code against the spec, plan, constitution, and all tasks, including checked tasks.
   - Identify unmet requirements and conflicting or unrequested work
   - Report evidence and source references; do not expand the feature scope

4. Append missing work to `tasks.md` under `## Phase N: Convergence`.
   - Continue phase numbers and task IDs; use unchecked tasks with file paths and dependencies
   - Reference the requirement or finding; do not duplicate open tasks
   - **Append-only**: Preserve existing tasks; do not modify spec, plan, or code

5. Report remaining work. If nothing needs appending, leave `tasks.md` unchanged.
