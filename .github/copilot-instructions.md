For Wizard, Designer, and generated canvases, host-adapter interactions need
explicit source-owned contracts and tests for valid and incompatible exchanges.
Hosts own session/workflow operations, mounting, persistence, artifacts, and
action checks; adapters own rendering and interaction wiring, including
composite controls. New customizable UI normally registers a JSON definition
and JavaScript adapter/renderer template for each host where it appears; reuse
stock rendering and document single-host, nonvisual, or fixed-shell exceptions.
Review agents must flag missing contracts/tests, contribution-specific host
branches, and missing template pairs. Existing contract changes require explicit
user approval; see `.github/instructions/wizard-designer-contracts.instructions.md`.

For local-development PRs, distinguish worktree/local-source testing from the
published hosted path. Report a hosted package incompatibility as a
release-readiness concern, but do not recommend bumping versions or publishing
on every development edit. Before claiming a hosted path is ready, verify it
against the published archive selected by the catalog, not only worktree source.
