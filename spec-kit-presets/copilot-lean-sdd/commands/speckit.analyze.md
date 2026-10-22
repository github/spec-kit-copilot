---
description: Perform read-only consistency and quality analysis of Lean spec, plan, and tasks.
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

## Outline

1. Require authored `<feature_directory>/spec.md`, `plan.md`, `tasks.md`, and
   `.specify/memory/constitution.md`. Name missing prerequisites
   (`speckit-specify`, `speckit-plan`, `speckit-tasks`, `speckit-constitution`)
   and stop instead of generating partial analysis. Run after tasks, before implementation.
   No research, data-model, contracts, quickstart, or checklist files are required.

2. **STRICTLY READ-ONLY**: Do not modify any files or run remediation commands.
   Load requirements, measurable buildable success criteria, user scenarios, plan
   decisions, task IDs/dependencies/paths, and constitution rules. Lean prose and
   headings are sufficient: use explicit IDs if present, otherwise stable phrase
   keys with file/section references. Exclude post-launch business metrics from
   implementation-task coverage.

3. Detect duplication, ambiguity, underspecification, terminology/ordering
   inconsistencies, missing task coverage, unmapped tasks, and constitution conflicts.
   Constitution MUST conflicts are CRITICAL; never dilute governance to resolve one.
   Also classify blocking absent functionality as CRITICAL; conflicting/untestable
   requirements as HIGH; coverage/terminology gaps as MEDIUM; minor polish as LOW.
   Bound the report to 50 high-signal findings; summarize any overflow.

4. Output an in-session report with:
   - Findings: ID, category, severity, file/section or line, evidence, recommendation
   - Coverage: requirement key, task IDs, uncovered requirements, unmapped tasks
   - Totals: requirements, tasks, coverage percentage, ambiguity/duplication/critical counts
   - Constitution alignment and recommended next actions
   Recommend resolving CRITICAL findings before `speckit-implement`. Remediation
   requires separate explicit approval; do not apply it or invoke another skill.
