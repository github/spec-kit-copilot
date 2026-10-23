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

3. **Repeat for up to five material questions**, strictly in this order:
   - Ask **one** question using Copilot's `ask_user`, then wait for its answer
   - Write the accepted question and answer under Clarifications in `spec.md`; update the relevant requirement, preserving unrelated content
   - Read back the saved text to verify the answer is recorded; **only then** consider the next question
   - Never batch questions, run questions and writes in parallel, or defer saving until the end
   - Stop and report if the tool is unavailable, the user declines, or saving fails

4. Report remaining ambiguities before planning. Do not start another command.
