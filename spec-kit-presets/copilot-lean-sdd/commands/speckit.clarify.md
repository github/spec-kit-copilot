---
description: Clarify the specification and store answers in spec.md.
---

## User Input

```text
$ARGUMENTS
```

## Outline

1. Read `.specify/feature.json` to get the feature directory path.

2. **Load context**: `<feature_directory>/spec.md` and `.specify/memory/constitution.md` if present.
   - Stop and report missing configuration or spec
   - No plan, tasks, or checklist required

3. **Ask the user** up to five material clarification questions using Copilot's `ask_user`, one at a time.
   - Focus on ambiguous requirements, scenarios, edge cases, and success criteria
   - Stop if the tool is unavailable or the user declines further questions

4. After each accepted answer, update `spec.md` and record the question and answer under Clarifications.
   - Resolve conflicting wording; preserve unrelated content

5. Report remaining ambiguities before planning.
