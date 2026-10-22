---
description: Create a specification and store it in spec.md using Copilot Lean SDD.
---

## User Input

```text
$ARGUMENTS
```

## Copilot Execution

Run this command directly in Copilot. For questions, use Copilot's interactive
`ask_user` tool, one question at a time. If unavailable, report the missing
capability and stop rather than guessing an answer. Follow-up commands are
Copilot skills (`speckit-<command>`); do not switch integrations or invoke them
automatically.

## Outline

1. **Ask the user** for the feature directory path (e.g., `specs/my-feature`).
   Do not proceed until provided. Resolve it inside the project; reject paths
   outside the project or into `.specify`, `.git`, or `.github`. If a spec already
   exists there, confirm before replacing it.

2. Create the directory and write `.specify/feature.json`, preserving any other keys:
   ```json
   { "feature_directory": "<feature_directory>" }
   ```

3. Create a specification from the user input and store it in `<feature_directory>/spec.md`.
   - Overview, functional requirements, user scenarios, success criteria
   - Every requirement must be testable
   - Make informed defaults for unspecified details
   - Honor `.specify/memory/constitution.md` if authored; do not invent governance
   - Do not require a spec template, separate checklist, branch, or extra artifacts

4. Report the path and any assumptions. Suggest clarification before planning
   where material ambiguity remains; do not run another skill automatically.
