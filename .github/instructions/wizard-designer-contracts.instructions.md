---
applyTo: "plugins/spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/**/*,plugins/spec-kit-copilot-wizard/extensions/speckit-canvas-designer/**/*,spec-kit-extensions/extension-canvas-design/**/*,spec-kit-extensions/tests/**/*,spec-kit-presets/*/generated/**/*,tests/e2e/**/*,tests/fixtures/specify/**/*,tests/fixtures/test-presets/**/*"
---

For new or changed host-adapter APIs, payloads, events, state, capabilities, or
mount points, define a source-owned contract for shapes, semantics, allowed
values, validation, and errors. Wire both sides to it and test valid and
incompatible exchanges. Reviewers must flag missing or mismatched contracts
and boundary tests, even when no contract file existed before.

Hosts own shared mounting/navigation, session/workflow operations, saved state
and artifacts, and checks on declared actions (phase order, paths, value types,
revisions). Adapters own DOM, rendering, events, and updates, including
composite controls. Do not add contribution-specific host branches or let
adapters call workflow endpoints or change private host state; new host
capabilities must be reusable. Reviewers must flag violations.

New customizable UI normally registers named JSON definition and JavaScript
adapter/renderer templates for each host where rendered. Reuse shared
definitions and stock/generic rendering; a composite control needs no template
per internal element. Document single-host, nonvisual, or fixed-shell
exceptions. Reviewers must flag missing registrations or unjustified missing
host-specific pairs.

For badge-format changes, update the Designer's generated badge-import contract
(`contracts/badge-import.mjs` and `ui/badge-import-contract.js`), compatibility
validation, directly related documentation, and generator-to-Designer round-trip
tests together. Keep import append-only and atomic; it must not normalize missing
required fields or bypass the existing Save validator.

Do not change Wizard, Designer, or generated-canvas contracts without explicit
user approval: schemas/validation, persisted state/handoffs, canvas actions,
HTTP/SSE payloads, artifact/phase reporting, or defining fixtures. Bug fixes,
passing tests, and UI work do not imply approval. If a change seems necessary,
explain the old and proposed contracts and compatibility/test impact, then ask
before editing; otherwise preserve the contract.
