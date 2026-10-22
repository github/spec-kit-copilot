---
description: Create a plan and store it in plan.md using Copilot Lean SDD.
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
Use Copilot's `ask_user` tool for blocking questions; if unavailable, report and stop.

## Outline

1. Read `.specify/feature.json` to get the feature directory path.

2. **Load context**: `.specify/memory/constitution.md` and `<feature_directory>/spec.md`.
   Require an authored constitution and spec; if absent or still placeholders,
   name the prerequisite (`speckit-constitution` or `speckit-specify`) and stop.

3. Create an implementation plan and store it in `<feature_directory>/plan.md`.
   - Technical context: tech stack, dependencies, project structure
   - Design decisions, architecture, file structure
   - Honor the constitution and identify unresolved constraints explicitly
   - Keep necessary research and design in this file; do not require research.md,
     data-model.md, contracts/, quickstart.md, or separate templates

4. Report the path, decisions, and unresolved blockers. Do not generate tasks or
   invoke follow-up skills automatically.
