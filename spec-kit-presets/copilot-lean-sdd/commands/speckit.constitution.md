---
description: Create or update the project constitution.
---

## User Input

```text
$ARGUMENTS
```

## Copilot Execution

Run directly in Copilot. Use Copilot's interactive `ask_user` tool for clarification,
one question at a time. If unavailable, report the missing capability and stop
rather than guessing. Follow-up commands are Copilot skills (`speckit-<command>`);
do not switch integrations or invoke them automatically.

## Scope Guard

This command's own work is limited to creating or updating the project constitution and
propagating constitution-driven changes to dependent Spec Kit artifacts.

- Classify every part of the user input as constitution content or a separate non-governance
  intent. Feature implementation, code generation, refactoring, build, and deployment requests
  are examples of non-governance intents.
- You **MUST NOT** execute any non-governance intent. Defer each one to `Next Actions`.
- You **MUST NOT** create, modify, or delete application source files or other artifacts
  unrelated to the constitution workflow.
- If an instruction could be either constitution content or a non-governance intent, ask for
  clarification before making changes.
- After updating the constitution, list each deferred intent in a `Next Actions` section with an
  appropriate follow-up Spec Kit skill, such as `speckit-specify`, but do not invoke it.
- Omit `Next Actions` when there are no non-governance intents.

## Outline

1. Create or update the project constitution and store it in `.specify/memory/constitution.md`.
   - Project name, guiding principles, non-negotiable rules
   - Derive from user input and existing repo context (README, docs)
   - Preserve established governance unless the user explicitly changes it
   - Keep this a focused document; no template synchronization or additional artifacts
     are required. Report any affected existing spec/plan/tasks for deliberate follow-up.
