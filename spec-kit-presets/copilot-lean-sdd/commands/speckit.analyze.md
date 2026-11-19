---
description: Analyze consistency across spec.md, plan.md, and tasks.md.
---

## User Input

```text
$ARGUMENTS
```

## Outline

1. Read `.specify/feature.json` to get the feature directory path.

2. **Load context**: `.specify/memory/constitution.md` and `<feature_directory>/spec.md`, `plan.md`, and `tasks.md`.
   - Stop and report missing configuration or required inputs
   - No additional design artifacts or checklists required

3. **Analyze** after task generation, before implementation:
   - Duplication, ambiguity, contradictions, and missing requirements
   - Requirement-to-task coverage and dependency ordering
   - Constitution conflicts are CRITICAL; do not reinterpret governing principles
   - Use existing prose and section references; formal requirement IDs are optional

4. Report findings, severity, artifact references, coverage gaps, and recommended fixes in the conversation.
   - **Read-only**: Do not modify files; fixes require separate approval
   - Resolve CRITICAL findings before implementation
