---
description: Create a requirements-quality checklist for the feature.
---

## User Input

```text
$ARGUMENTS
```

## Outline

1. Read `.specify/feature.json` to get the feature directory path.

2. **Load context**: `<feature_directory>/spec.md`; read constitution, plan, and tasks if present.
   - Stop and report missing configuration or spec
   - No plan, tasks, or separate template required

3. Clarify the requested focus only when needed using Copilot's `ask_user`, one question at a time.
   - Stop if a blocking question cannot be asked

4. Create `<feature_directory>/checklists/<domain>.md` with `- [ ] CHK001 ...` items.
   - Test requirements quality: completeness, clarity, consistency, measurability, and edge cases
   - Not implementation tests; reference spec sections or identify gaps
   - Append to existing checklists, continuing IDs without changing existing content
   - Leave new items unchecked; reviewer-owned checkboxes are not implementation progress

5. Report the path. This checklist is optional, not an implementation gate.
