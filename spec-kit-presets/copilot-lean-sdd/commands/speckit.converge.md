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

3. Verify the spec, plan, constitution, and every task outcome, including checked tasks.
   - Run the feature's documented local validation checks sequentially; wait for each result
   - A failed required check is remaining work, even if another command passes
   - Report missing, conflicting or unrequested work with source evidence; do not expand scope
   - If verification is blocked, report it as unverified; do not declare convergence

4. Append missing work to `tasks.md` under `## Phase N: Convergence`.
   - Continue phase numbers and task IDs; use unchecked tasks with file paths and dependencies
   - Reference the requirement or finding; do not duplicate open tasks
   - **Append-only**: Preserve existing tasks; do not modify spec, plan, or code

5. Declare convergence only when all required outcomes are verified. Otherwise report remaining or blocked work. If nothing needs appending, leave `tasks.md` unchanged.
