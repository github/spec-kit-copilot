---
description: Execute the implementation plan by processing all tasks in tasks.md.
---

## User Input

```text
$ARGUMENTS
```

## Outline

1. Read `.specify/feature.json` to get the feature directory path.

2. **Load context**: `.specify/memory/constitution.md` and `<feature_directory>/spec.md` and `<feature_directory>/plan.md` and `<feature_directory>/tasks.md`.

3. **Execute tasks sequentially**, in dependency order:
   - Work on one task at a time; wait for its commands and file writes to finish
   - Verify the task's stated outcome, mark it `[x]`, and wait for that write to finish before starting another task
   - Never batch different tasks, including checkbox updates, or run validation alongside changes from a later task
   - If a task fails or its outcome cannot be verified, stop and report; leave it unchecked

4. **Validate**: Verify all tasks are completed and the implementation matches the spec.
