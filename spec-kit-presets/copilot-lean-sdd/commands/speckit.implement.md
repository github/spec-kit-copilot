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
   - Work on one task at a time; finish its file writes before running validation, and wait for the result
   - Verify the task's stated outcome, mark it `[x]`, wait for the write, then read `tasks.md` back
   - Only after confirming the saved marker, select and start the next task
   - Never batch different tasks, including checkbox updates, or run validation alongside unfinished file writes
   - If a task fails or its outcome cannot be verified, stop and report; leave it unchecked

4. **Validate**: Verify all tasks are completed and the implementation matches the spec.
