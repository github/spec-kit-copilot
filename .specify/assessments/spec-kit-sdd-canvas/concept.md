# Concept: Spec Kit SDD Workflow Canvas

- **Slug**: spec-kit-sdd-canvas
- **Created**: 2026-07-31
- **Recommended option**: Read-only SDD navigator pilot

## Options

### Option A — Read-only SDD navigator pilot

- **Sketch**: Give a user one focused side-panel view of the active Spec Kit feature: current SDD stage, expected and completed artifacts, pending review gate, and the next available command. Actions hand work back to the foreground agent, while the canvas derives progress from repository artifacts and workflow state rather than becoming a second workflow engine.
- **Appetite**: small (days, as a fixed validation budget; confidence is low)
- **Trade-offs**: Tests whether visibility improves without replacing existing skills or workflows and follows the proven assess-canvas interaction pattern. It sacrifices broad automation, multi-feature portfolio views, and deep failure recovery; filesystem-derived state may be incomplete or stale.
- **Rabbit holes**: Supporting every Spec Kit version and extension, inferring stage state from inconsistent artifacts, adding editing rather than preview, and expanding the pilot into workflow orchestration.

### Option B — Full SDD workflow cockpit

- **Sketch**: Provide an end-to-end control surface for creating and selecting features, running every SDD stage, presenting approval gates, resuming failures, and managing multiple concurrent workflows from one canvas.
- **Appetite**: large (months; confidence is low)
- **Trade-offs**: Offers the strongest unified experience and could reduce context switching across the whole lifecycle. It duplicates workflow-engine responsibilities, increases coupling to changing artifact formats and an experimental canvas API, and carries substantial recovery and concurrency complexity.
- **Rabbit holes**: Branch lifecycle management, concurrent runs, permissions and approvals, long-running implementation progress, partial failures, version migration, extension-defined stages, and conflict resolution between canvas and chat actions.

### Option C — Improve and observe the existing experience

- **Sketch**: Do not add an SDD canvas yet. Clarify the existing skills and workflow journey, collect repeated user signals and state-recovery failures, and establish baseline measures before choosing another product surface.
- **Appetite**: small (days to define and begin evidence collection)
- **Trade-offs**: Avoids duplicative UI and experimental-API maintenance while directly addressing the evidence gap. It does not test whether a visual workflow surface would improve clarity and leaves any real navigation pain in place during observation.
- **Rabbit holes**: Treating indefinite research as progress, collecting metrics without a decision threshold, and broad documentation work unrelated to the stated visibility problem.

## Recommendation

Proceed only with **Option A — Read-only SDD navigator pilot** under a fixed small appetite. It is the narrowest option that can test the stated goals: faster identification of current stage and next action, easier artifact discovery, and clearer recovery after pauses. The existing assess canvas provides credible local prior art, while keeping workflow execution in the agent avoids prematurely duplicating the bundled engine. The pilot should be treated as a validation vehicle, not evidence that a full cockpit is warranted; if baseline and follow-up observations cannot show a meaningful clarity improvement, stop rather than expand.

## Out of Scope (for the recommended option)

- Replacing the `specify` CLI, Copilot skills, or the bundled workflow engine.
- Editing specification, plan, task, or implementation artifacts inside the canvas.
- Automatically approving gates or advancing stages without an explicit user action.
- Multi-repository, portfolio, or organization-wide workflow management.
- Supporting arbitrary third-party extension stages in the pilot.
- Full branch management, conflict resolution, implementation telemetry, or generalized failure orchestration.
- Committing to a stable public API while the canvas SDK remains experimental.

## Assumptions to Validate

- Spec Kit users have recurring difficulty identifying their current stage, artifacts, and next action.
- Repository artifacts and available workflow metadata are sufficient to derive useful status without a second source of truth.
- A side-panel view improves stage-identification time and user-rated clarity over chat and direct file inspection.
- Users prefer actions to return control to the foreground agent rather than execute invisibly inside the canvas.
- One active feature is enough scope for a useful pilot.
- A fixed small appetite is sufficient because the existing assess canvas pattern can be reused at the concept level.
- The project will define a supported Spec Kit version boundary before relying on artifact compatibility.
