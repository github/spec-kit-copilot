---
description: Assess implemented Lean work and append traceable remaining tasks.
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

1. Require authored `<feature_directory>/spec.md`, `plan.md`, and `tasks.md`;
   name the missing prerequisite skill and stop. Run only after `speckit-implement`
   has run on the current tasks; if this is not established, ask before proceeding.
   Load `.specify/memory/constitution.md` if authored; explicitly report skipped
   governance checks if absent or still a template. No extra artifacts are required.

2. Assess the present code against the spec, plan, every existing task (including
   checked and prior convergence tasks), and governing principles. Completion
   claims are not evidence. Use these artifacts as the sole intent source; limit
   code inspection to their named files and relevant concepts, not git/history/diffs.
   Lean prose is valid; explicit FR/SC IDs are not required.

3. Classify evidenced gaps as missing, partial, contradicts, or unrequested.
   Prioritize constitution MUST violations and blocking P1 gaps as CRITICAL,
   core gaps as HIGH, secondary/unclear unrequested work as MEDIUM, polish as LOW.
   Report findings with stable IDs, source references, evidence, remaining work,
   and counts by gap type/severity before appending.

4. **APPEND-ONLY**: The only permitted write is a new `## Phase N: Convergence`
   section at the end of `tasks.md`. Never rewrite existing content, checkbox
   states, IDs, order, or spec/plan/code. Start at the highest phase number plus
   one and highest task ID plus one (`T{M+1:03d}`, three digits minimum).
   Append one unchecked, actionable task per distinct remaining work item, with
   source/finding reference, file path, and dependency ordering. Avoid duplicating
   already-open tasks that cover the gap; report those as still outstanding.
   For unrequested code, append review/justify-or-remove work, not automatic deletion.

5. If no new tasks are needed, leave `tasks.md` **byte-for-byte unchanged**.
   Distinguish fully converged from gaps already covered by open tasks. Report
   appended count/IDs, unresolved work, and suggest `speckit-implement` if needed.
   Do not implement code, run follow-up skills, or manufacture new requirements.
