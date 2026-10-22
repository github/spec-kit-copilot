---
description: Convert tasks.md into dependency-ordered GitHub issues.
---

## User Input

```text
$ARGUMENTS
```

## Outline

1. Warn that this command is deprecated; recommend the bundled `github` extension without installing or invoking it.

2. Read `.specify/feature.json` to get the feature directory path; load `<feature_directory>/tasks.md`.
   - Stop and report missing configuration or tasks

3. Read `git config --get remote.origin.url`; require an unambiguous GitHub target.
   - Never create issues in another repository

4. Match whole task IDs (`\bT\d{3,}\b`) against existing open and closed issues, paginating as needed.
   - Skip duplicates; halt on retrieval failure

5. Obtain explicit permission for the target and issue set through Copilot's `ask_user`, unless already authorized.
   - Use the host's issue-creation tool; halt if required tools are unavailable
   - Create missing issues in dependency order, titled `T001: <description>`, with task context and dependencies
   - Halt on failure and report partial completion; do not retry uncertain writes

6. Report created URLs and skipped tasks. Do not modify `tasks.md`.
