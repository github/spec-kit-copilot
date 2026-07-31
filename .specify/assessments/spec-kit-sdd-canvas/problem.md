# Problem Definition: Spec Kit SDD Workflow Visibility

- **Slug**: spec-kit-sdd-canvas
- **Created**: 2026-07-31
- **Inputs used**: intake.md | research.md

## Problem Statement

GitHub Copilot users working through Spec Kit's multi-stage SDD cycle may have difficulty seeing their current stage, required review gates, generated artifacts, and next action without reconstructing state from chat and repository files. Whether this creates enough recurring friction to justify additional product work is not yet validated by user or usage evidence.

## Affected Users & Stakeholders

- **Users**: GitHub Copilot CLI and Copilot App users who run Spec Kit workflows — potentially affected by fragmented workflow state across chat, skills, and repository artifacts; the frequency and severity are [NEEDS CLARIFICATION].
- **Stakeholders**: Spec Kit Copilot plugin maintainers — responsible for a coherent Copilot integration and ongoing compatibility.
- **Stakeholders**: [NEEDS CLARIFICATION: sponsoring team or product owner] — decides whether the observed user problem warrants investment.
- **Stakeholders**: [NEEDS CLARIFICATION: Spec Kit workflow maintainers] — impacted by assumptions about workflow stages, gates, and artifact formats.

## Goals

- Enable users to identify the current SDD stage, outstanding gate or blocker, and next required action without manually reconstructing workflow state.
- Make generated SDD artifacts easier to discover and review during the workflow.
- Preserve continuity when an SDD run pauses, fails, or resumes.
- Establish evidence that improved workflow visibility materially benefits Spec Kit users rather than duplicating existing skill and workflow controls.

## Non-Goals

- Replacing the `specify` CLI, Spec Kit skills, or the bundled workflow engine.
- Changing Spec Kit artifact formats, stage semantics, or review-gate policy.
- Automatically approving review gates or making product decisions for users.
- Designing implementation architecture, APIs, UI components, or task breakdowns during problem definition.
- Expanding scope to every Spec Kit extension before the core SDD workflow need is validated.

## Success Metrics

- Median time for a user to correctly identify the current stage and next required action (baseline: unknown; target: [NEEDS CLARIFICATION]).
- Percentage of started SDD cycles that reach implementation without users losing track of workflow state (baseline: unknown; target: [NEEDS CLARIFICATION]).
- Rate of navigation or state-recovery errors during paused, failed, or resumed runs (baseline: unknown; target: [NEEDS CLARIFICATION]).
- User-rated clarity of SDD progress and artifact location (qualitative baseline: unknown; target: [NEEDS CLARIFICATION]).
- Evidence from repeated requests, interviews, or usage observations that the visibility problem is recurring (baseline: one broad request; target: [NEEDS CLARIFICATION]).

## Cost of Inaction

Users retain the existing natural-language skills and bundled workflow, which may already be sufficient. If the assumed visibility problem is real, users continue relying on chat history and direct artifact inspection, with unknown time and completion costs; if it is not real, doing nothing avoids duplicative UI and experimental-API maintenance.

## Open Questions

- [NEEDS CLARIFICATION: which user segment experiences this problem and how often]
- [NEEDS CLARIFICATION: what concrete failures or delays users experience with the current chat, skills, and workflow experience]
- [NEEDS CLARIFICATION: whether the relevant unit of progress is a workflow run, feature directory, branch, or another identity]
- [NEEDS CLARIFICATION: which artifacts and review gates users must see or act on]
- [NEEDS CLARIFICATION: what behavior is required for failures, resumptions, concurrent features, and stale state]
- [NEEDS CLARIFICATION: what measurable improvement would justify maintaining an additional canvas surface]
- [NEEDS CLARIFICATION: whether Spec Kit/plugin version lockstep will be restored before relying on artifact compatibility]
