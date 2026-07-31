# Decision: Spec Kit SDD Workflow Canvas

- **Slug**: spec-kit-sdd-canvas
- **Decided**: 2026-07-31
- **Verdict**: needs-clarification
- **Artifacts reviewed**: intake.md | research.md | problem.md | concept.md

## Scorecard

| Criterion | Rating | Justification |
|-----------|--------|---------------|
| Problem validity | weak | The product-owner/business-analyst persona is identified and the visibility problem is plausible, but only one broad request exists and no observed workflow failure establishes severity or recurrence. |
| Evidence strength | weak | Research found useful internal prior art and constraints but no interviews, usage data, repeated requests, external prior art, or measured baseline. |
| Value vs. inaction | unknown | The updated problem makes command-line independence an explicit goal, but existing skills and the bundled workflow may already be sufficient for some users; the cost of reconstructing state from chat and files has not been measured. |
| Feasibility / appetite | weak | The recommended full visual workspace directly satisfies the no-command-line goal, whereas a read-only navigator does not, but it remains a large, months-scale appetite with low confidence; the assess canvas proves the interaction pattern but not full-cycle orchestration, recovery, or concurrency. |
| Strategic fit | adequate | A guided Copilot experience aligns with the repository README, but the project constitution is still an unfilled template and provides no ratified strategic criteria. |
| Risk posture | weak | Experimental canvas APIs, Spec Kit version mismatch, stale state, and workflow recovery risks are identified but not yet credibly mitigated. |

## Verdict & Rationale

**Needs clarification.** The target persona is identified, command-line independence is now an explicit problem goal, and the full visual SDD workspace is the only shaped option that satisfies that goal. The gate still cannot return `go` because evidence strength and appetite fit are weak while value over existing skills/workflows remains unknown. The next investment should validate recurring workflow pain, establish a baseline and decision threshold, confirm that trustworthy full-cycle state can be represented, and determine whether a phased large appetite is justified within a supported Spec Kit version boundary. If that evidence is not found, the existing experience should remain the preferred option.

## If needs-clarification

- **Blocking questions**:
  - [NEEDS CLARIFICATION: how often product owners or business analysts who are vibe coding cannot identify the current SDD stage, artifact, gate, or next action]
  - [NEEDS CLARIFICATION: what observed delays, abandonment, or recovery errors result from the current chat, skills, and workflow experience]
  - [NEEDS CLARIFICATION: what baseline and minimum improvement would justify a separate canvas surface]
  - [NEEDS CLARIFICATION: whether repository artifacts and workflow metadata can represent paused, failed, and resumed state reliably]
  - [NEEDS CLARIFICATION: whether stakeholders will fund a phased months-scale appetite for the full visual workspace]
  - [NEEDS CLARIFICATION: which Spec Kit versions the visual workspace supports and how compatibility will be bounded]
- **Revisit stage**: research

## If go — Handoff to `/speckit-specify`

Not applicable until the blocking evidence and risk questions are resolved and the decision gate is rerun.
