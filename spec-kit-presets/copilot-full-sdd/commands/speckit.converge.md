---
description: Assess the current codebase against the feature's spec, plan, and tasks, then append only remaining work not already covered by open tasks.
scripts:
  sh: scripts/bash/check-prerequisites.sh --json --require-spec --require-tasks --include-tasks
  ps: scripts/powershell/check-prerequisites.ps1 -Json -RequireSpec -RequireTasks -IncludeTasks
  py: scripts/python/check_prerequisites.py --json --require-spec --require-tasks --include-tasks
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Goal

Close the gap between what a feature's specification, plan, and tasks call for and what the
codebase currently implements. Read `spec.md`, `plan.md`, and `tasks.md` as the **sole
source of intent** (with the constitution as governing constraints), assess the current
state of the code, determine which requirements, acceptance criteria, plan decisions, and
existing tasks are unmet, incomplete, or only partially satisfied, and **append only
remaining work not already covered by open tasks** at the bottom of `tasks.md` so that
`__SPECKIT_COMMAND_IMPLEMENT__` can complete it. This command MUST run only after
`__SPECKIT_COMMAND_TASKS__` has produced a complete `tasks.md` and
`__SPECKIT_COMMAND_IMPLEMENT__` has attempted implementation for the feature.
A repeat assessment does not require another implementation pass on tasks appended
by an earlier Convergence run.

This is **not** a diff tool and does **not** track changes. It assesses the present state
of the code relative to the feature's artifacts — no git, no branch comparison, no history.

## Operating Constraints

**APPEND-ONLY, NEVER REWRITE**: The command's **only permitted write** is appending a new
`## Phase N: Convergence` section to `tasks.md`. It MUST NOT:

- modify `spec.md` or `plan.md` in any way;
- rewrite, renumber, reorder, or delete any existing task (including tasks from a prior
  Convergence phase);
- modify, create, or delete any application code — completing the appended tasks is the
  job of `__SPECKIT_COMMAND_IMPLEMENT__`.

When no new tasks are needed, the command MUST leave `tasks.md`
**byte-for-byte unchanged** (no empty Convergence header). Report a clean result only
when the assessment finds no remaining work.

**Constitution Authority**: The project constitution (`/memory/constitution.md`) is
**non-negotiable**. Code that violates a MUST principle is the highest-severity finding and
requires a corresponding remediation task unless already covered by an open task. If the
constitution is an unfilled template, skip constitution checks gracefully rather than failing.

## Execution Steps

### 1. Initialize Convergence Context

Run `{SCRIPT}` once from repo root and parse JSON for FEATURE_DIR and AVAILABLE_DOCS. Derive absolute paths:

- SPEC = FEATURE_DIR/spec.md
- PLAN = FEATURE_DIR/plan.md
- TASKS = FEATURE_DIR/tasks.md
- CONSTITUTION = `/memory/constitution.md` (if present)
If `spec.md`, `plan.md`, or `tasks.md` is missing, STOP with a clear, actionable message naming the
prerequisite command to run (`__SPECKIT_COMMAND_SPECIFY__` for a missing spec, `__SPECKIT_COMMAND_PLAN__` for a missing plan,
`__SPECKIT_COMMAND_TASKS__` for missing tasks). Do not produce partial output.
For single quotes in args like "I'm Groot", use escape syntax: e.g 'I'\''m Groot' (or double-quote if possible: "I'm Groot").

### 2. Load Artifacts (Progressive Disclosure)

Load only the minimal necessary context from each artifact:

**From spec.md:**

- Functional Requirements (FR-###)
- Success Criteria (SC-###) — include only items requiring buildable work; exclude
  post-launch outcome metrics and business KPIs
- User Stories and their Acceptance Scenarios
- Edge Cases (if present)

**From plan.md:**

- Architecture/stack choices and technical decisions
- Data Model references
- Phases and named touch-points (files/components the plan says will be created or edited)
- Technical constraints

**From tasks.md:**

- Task IDs (to compute the next ID and next phase number)
- Checkbox states, descriptions, phase grouping, source references, and referenced file paths

**From constitution (if not an unfilled template):**

- Principle names and MUST/SHOULD normative statements

### 3. Build the Intent Inventory

Create an internal model (do not echo raw artifacts):

- **Requirements inventory**: one stable key per FR-### / SC-### / user-story acceptance
  scenario (e.g. `US1/AC2`), plus the plan decisions and constitution principles that
  impose buildable obligations.
- **Code-scope map**: from the file paths named in `plan.md` and `tasks.md`, plus a keyword
  search for the concepts each requirement describes, derive the set of source files and
  components in scope for assessment. Bound the assessment to these — do **not** infer
  scope beyond what the artifacts define.

### 4. Assess the Codebase and Classify Findings

Include every existing task in the intent inventory, regardless of checkbox state or
Convergence phase: completion claims are not evidence. Verify current behavior against
the spec, plan, tasks, and constitution; for corrective task chains, assess the resulting
behavior, not superseded implementation details. Check both unmet obligations and
implementation that contradicts, exceeds, or falls outside the stated intent.

For each item in the intent inventory, inspect the current code in scope and produce a
`Finding` only where there is a gap. Classify every finding by **gap type**:

- **`missing`**: the required work is absent from the code entirely.
- **`partial`**: the work exists but does not yet fully satisfy the requirement /
  acceptance criterion / plan decision.
- **`contradicts`**: the code does something that conflicts with stated intent or a
  constitution MUST principle.
- **`unrequested`**: the code contains work not called for by the spec, plan, or tasks
  (surfaced for awareness — converge does **not** delete code, it only appends a task to
  review/justify or remove it).

Each `Finding` records: a stable id, the `source-ref` it traces to, the `gap-type`, a
severity, and a short human-readable description with the evidence (the file/area observed).

For every actionable finding, compare the concrete remaining work with unchecked
tasks (`- [ ]`) across all phases, including prior Convergence phases. If open tasks
already cover the work, mark the finding **already tracked** and record the covering
task IDs. Match by the work those tasks would complete, not by exact wording or a
shared source reference alone. If open tasks cover only part of the work, report
the tracked portion and append only the uncovered remainder. A checked task alone
does not cover a still-unmet finding; that finding remains eligible for a new task.

**Edge cases:**

- **Little or no code yet**: treat the entire specified scope as `missing` remaining work
  rather than failing.
- **Nothing remains**: produce zero findings and follow the converged branch in Step 7.

### 5. Assign Severity

- **CRITICAL**: violates a constitution MUST principle, or a `missing`/`contradicts` gap
  that blocks baseline functionality of a P1 user story.
- **HIGH**: a `missing` or `partial` gap on a core functional requirement or acceptance
  criterion.
- **MEDIUM**: a `partial` gap on a secondary requirement, or an `unrequested` addition with
  unclear justification.
- **LOW**: minor partial gaps, polish, or low-risk `unrequested` additions.

### 6. Present the In-Session Findings Summary

Before appending anything, output a compact, severity-graded summary (no file writes yet):

## Convergence Findings

| ID | Gap Type | Severity | Source | Evidence | Remaining Work | Tracking |
|----|----------|----------|--------|----------|----------------|----------|
| F1 | missing  | HIGH     | FR-008 | Example: no append-only guard detected in path/to/module.py when writing tasks.md | Add append-only enforcement | Already tracked by T041 |

Report already-tracked findings alongside uncovered findings. Cite the open task IDs
for tracked work and distinguish any uncovered remainder that needs a new task.

**Summary metrics:**

- Requirements / acceptance criteria checked
- Plan decisions checked
- Constitution principles checked (or "skipped — template")
- Findings by gap type (missing / partial / contradicts / unrequested)
- Findings by severity

### 7. Append Convergence Tasks (or report without changes)

**If there is any uncovered actionable work** (`tasks_appended` outcome):

Append to the **end** of `tasks.md`, per the append contract:

1. Scan all existing task IDs; let `M` be the maximum. Determine the next phase number `N`
   (highest existing phase + 1).
2. Write a single new section header `## Phase N: Convergence`.
3. Emit one checklist item per actionable finding with uncovered work, describing only
   that uncovered work. Order CRITICAL/HIGH first, assigning zero-padded IDs
   `T{M+1:03d}, T{M+2:03d}, …`:

   ```markdown
   - [ ] T042 <imperative description> per <source-ref> (<gap-type>)
   ```

   `<source-ref>` traces the task to its origin: e.g. `FR-003`, `SC-002`,
   `US1/AC2`, `plan: storage decision`, `Constitution II`.

   `<gap-type>` is one of `missing`, `partial`, `contradicts`, `unrequested`.

   Constitution-violation tasks MUST be emitted first and described as
   `CRITICAL`.
4. Never reuse or renumber existing IDs. If a prior Convergence phase exists, add a new,
   separately-numbered one below it — do not touch the old one.

**If all remaining work is already tracked by open tasks**:

- Do **not** modify `tasks.md` at all.
- Report that work remains, cite the covering task IDs, and state that no new tasks
  were appended. Do not report `converged` or `tasks_appended`.

**If a completed assessment finds no remaining work** (`converged` outcome):

- Do **not** modify `tasks.md` at all — no empty phase header.
- Report: **"✅ Converged — the implementation satisfies the spec, plan, and tasks."**
- Include the summary counts of what was checked.

### 8. Provide Next Actions (Handoff)

- On `tasks_appended`: state how many tasks were appended under which phase, and recommend
  running `__SPECKIT_COMMAND_IMPLEMENT__` to complete them and any already-tracked work
  identified above.
- When remaining work is already tracked and nothing was appended, recommend running
  `__SPECKIT_COMMAND_IMPLEMENT__` on the cited open tasks before assessing again.
- On `converged`: recommend proceeding to review / opening a PR. No further implement pass
  is needed for this feature's specified scope.
