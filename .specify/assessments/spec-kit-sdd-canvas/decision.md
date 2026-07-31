# Decision: Spec Kit SDD Workflow Canvas

- **Slug**: spec-kit-sdd-canvas
- **Decided**: 2026-07-31
- **Verdict**: needs-clarification
- **Artifacts reviewed**: intake.md | research.md | problem.md | concept.md

## Scorecard

| Criterion | Rating | Justification |
|-----------|--------|---------------|
| Problem validity | weak | The visibility problem is plausible and consistent with the repository's guided-experience goal, but only one broad request exists and no observed workflow failure establishes severity or recurrence. |
| Evidence strength | weak | Research found useful internal prior art and constraints but no interviews, usage data, repeated requests, external prior art, or measured baseline. |
| Value vs. inaction | unknown | Existing skills and the bundled workflow may already be sufficient; the cost of reconstructing state from chat and files has not been measured. |
| Feasibility / appetite | adequate | A recommended small pilot exists, and the working assess canvas demonstrates the core read-and-dispatch interaction pattern, though the appetite remains low-confidence. |
| Strategic fit | adequate | A guided Copilot experience aligns with the repository README, but the project constitution is still an unfilled template and provides no ratified strategic criteria. |
| Risk posture | weak | Experimental canvas APIs, Spec Kit version mismatch, stale state, and workflow recovery risks are identified but not yet credibly mitigated. |

## Verdict & Rationale

**Needs clarification.** The idea has a bounded concept and credible local technical precedent, but the gate cannot return `go` because evidence strength is explicitly weak and the value over existing skills/workflows is unknown. The next investment should validate that users repeatedly lose workflow context, establish a baseline and decision threshold, and confirm that the small pilot can derive trustworthy status within a supported Spec Kit version boundary. If that evidence is not found, the existing experience should remain the preferred option.

## If needs-clarification

- **Blocking questions**:
  - [NEEDS CLARIFICATION: how often target users cannot identify the current SDD stage, artifact, gate, or next action]
  - [NEEDS CLARIFICATION: what observed delays, abandonment, or recovery errors result from the current chat, skills, and workflow experience]
  - [NEEDS CLARIFICATION: what baseline and minimum improvement would justify a separate canvas surface]
  - [NEEDS CLARIFICATION: whether repository artifacts and workflow metadata can represent paused, failed, and resumed state reliably]
  - [NEEDS CLARIFICATION: which Spec Kit versions the pilot supports and how compatibility will be bounded]
- **Revisit stage**: research

## If go — Handoff to `/speckit-specify`

Not applicable until the blocking evidence and risk questions are resolved and the decision gate is rerun.
