---
description: Resolve up to five material ambiguities in a Lean specification interactively.
---

## User Input

```text
$ARGUMENTS
```

## Copilot Execution

Run directly in Copilot. Read `.specify/feature.json` for `feature_directory`;
resolve it inside this project, outside `.specify`, `.git`, and `.github`.
Stop and report malformed or missing configuration, unsafe paths, or missing
required inputs. Do not infer the feature from a branch name or run setup scripts.
Use Copilot's interactive `ask_user` tool, one question at a time; if unavailable,
report the missing capability and stop. Do not substitute a plain-text questionnaire.

## Outline

1. Require `<feature_directory>/spec.md`; if missing or unfilled, suggest
   `speckit-specify` and stop. Read `.specify/memory/constitution.md` if authored.
   No plan, tasks, templates, or checklist are required. Prefer clarification
   before planning; warn of downstream rework when explicitly skipped.

2. Scan for material ambiguity in scope, user journeys, domain/data, error cases,
   dependencies, constraints/tradeoffs, terminology, measurable success criteria,
   and non-functional requirements (including security, privacy, accessibility,
   performance, and reliability). Do not demand Full SDD headings or requirement
   IDs; use the actual Lean prose. Ignore trivial style and already-resolved points.

3. Prioritize by impact and uncertainty. Ask at most five questions across this
   clarification session, sequentially through `ask_user`. Each must be a complete,
   plain-language question explaining why its answer matters, with 2-5 concrete
   choices and a reasoned recommendation where meaningful, or a short-answer prompt.
   Never assume the recommendation was accepted. Stop when the user declines
   more questions, material ambiguity is resolved, or the limit is reached.

4. After each accepted answer, save it to `spec.md` under
   `## Clarifications` / `### Session YYYY-MM-DD` as `- Q: ... -> A: ...`.
   Update the relevant requirement or scenario immediately, replacing conflicting
   wording rather than duplicating it. Preserve unrelated text and structure.
   Check for contradictions, consistent terminology, testability, and exactly one
   recorded answer per accepted question. Do not invent answers or change governance.

5. Report question count, updated path/sections, remaining/deferred risks, and
   whether planning can proceed. Do not create a checklist or invoke another skill.
