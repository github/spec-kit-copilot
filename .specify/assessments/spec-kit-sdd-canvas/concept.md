# Concept: Spec Kit SDD Workflow Canvas

- **Slug**: spec-kit-sdd-canvas
- **Created**: 2026-07-31
- **Recommended option**: Full visual SDD workspace

## Options

### Option A — Read-only SDD navigator pilot

- **Sketch**: Give a product owner or business analyst who is "vibe coding" one focused side-panel view of the active Spec Kit feature: current SDD stage, expected and completed artifacts, pending review gate, and the next available command. Actions hand work back to the foreground agent, while the canvas derives progress from repository artifacts and workflow state rather than becoming a second workflow engine.
- **Appetite**: small (days, as a fixed validation budget; confidence is low)
- **Trade-offs**: Tests whether visibility improves without replacing existing skills or workflows and follows the proven assess-canvas interaction pattern. It sacrifices broad automation, multi-feature portfolio views, and deep failure recovery; filesystem-derived state may be incomplete or stale.
- **Rabbit holes**: Supporting every Spec Kit version and extension, inferring stage state from inconsistent artifacts, adding editing rather than preview, and expanding the pilot into workflow orchestration.

### Option B — Full visual SDD workspace

- **Sketch**: Provide product owners and business analysts with an end-to-end visual workspace for creating and selecting features, supplying each stage's inputs, running the complete SDD cycle, reviewing rendered artifacts, resolving clarifications, handling approval gates, and resuming failures without requiring command-line interaction. The canvas remains a visual control surface over Spec Kit rather than replacing its underlying workflow semantics.
- **Appetite**: large (months; confidence is low)
- **Trade-offs**: Best matches a non-CLI persona and offers the strongest unified experience across the whole lifecycle. It requires a broader maintained interaction surface, increases coupling to changing artifact formats and an experimental canvas API, and carries substantial recovery and concurrency complexity.
- **Rabbit holes**: Branch lifecycle management, concurrent runs, permissions and approvals, long-running implementation progress, partial failures, version migration, extension-defined stages, and conflict resolution between canvas and chat actions.

### Option C — Improve and observe the existing experience

- **Sketch**: Do not add an SDD canvas yet. Clarify the existing skills and workflow journey, collect repeated user signals and state-recovery failures, and establish baseline measures before choosing another product surface.
- **Appetite**: small (days to define and begin evidence collection)
- **Trade-offs**: Avoids duplicative UI and experimental-API maintenance while directly addressing the evidence gap. It does not test whether a visual workflow surface would improve clarity and leaves any real navigation pain in place during observation.
- **Rabbit holes**: Treating indefinite research as progress, collecting metrics without a decision threshold, and broad documentation work unrelated to the stated visibility problem.

## Recommendation

Proceed with **Option B — Full visual SDD workspace** because the identified product-owner/business-analyst persona is expected to prefer a visual experience over command-line-driven orchestration. The concept should cover the complete SDD journey while retaining Spec Kit as the underlying execution and artifact system, so users can provide inputs, review outputs, resolve clarifications, approve gates, and recover runs from the canvas. This is a large appetite with low evidence confidence: specification should therefore define phased acceptance boundaries and explicit stop criteria rather than treating every workflow and extension as day-one scope.

## Out of Scope (for the recommended option)

- Replacing the `specify` CLI, Copilot skills, or the bundled workflow engine.
- Automatically approving gates or advancing stages without an explicit user action.
- Providing a general-purpose source-code editor or replacing the user's IDE.
- Multi-repository, portfolio, or organization-wide workflow management in the first release.
- Supporting arbitrary third-party extension stages in the first release.
- Deployment, CI/CD, or production operations management.
- Committing to a stable public API while the canvas SDK remains experimental.

## Assumptions to Validate

- Product owners and business analysts who are "vibe coding" prefer a full visual SDD workspace over command-line-driven orchestration; this preference is user-provided but not yet validated across the broader segment.
- Repository artifacts and available workflow metadata can support a complete visual experience without creating a conflicting source of truth.
- Users will trust the canvas to initiate agent work while preserving visible prompts, permissions, and approval gates.
- The visual workspace can represent long-running work, partial failures, resumptions, and concurrent features coherently.
- A phased delivery within a large appetite can produce useful end-to-end capability before every edge case is supported.
- The project will define a supported Spec Kit version boundary before relying on artifact compatibility.
