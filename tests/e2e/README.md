# Test-preset browser journeys

The fixtures under [`tests/fixtures/test-presets/`](../fixtures/test-presets/)
are not shipped. Browser coverage should prove their **observable effects** in
the Wizard, Designer, and generated canvas, through the last surface each
fixture changes. A successful `specify preset add` alone does not prove those
effects.

## Deterministic agent boundary

Routine Playwright tests do not run a Copilot model. Use the real Wizard UI and
record its `session.send` launch prompt, including the exact `HANDOFF_JSON`
bytes.

Generate journeys explicitly opt in with `featureFlags: { generateCanvas: true }`
in their Wizard snapshot and `generateCanvas: true` on the server-side instance.
Both are required: the snapshot controls button visibility, while the instance
controls launch authorization. Other Wizard journeys keep Generate disabled by
default; do not rely on a developer's local runtime settings.

A test driver stands in only for the child agent's orchestration:

1. Write those bytes unchanged to the child session's handoff artifact, check
   its SHA-256, and load it through the Designer's handoff reader. Do not
   silently reserialize or reconstruct the Wizard's selections.
2. Initialize an isolated child checkout with `specify init` in Copilot skills
   mode. Install the selected local Canvas Design extension and test preset
   from the handoff's approved paths using `--dev`; check their installed
   identities/versions and the generated, preset-composed `load-page` skill.
3. After installation/composition (and skill reload in a live child), execute
   **the installed child package's** `scripts/verify-launch.mjs` with that
   checkout path. It reads the composed skill and `specify artifact list --json`
   to return all winning `pages` and `templates`. Reject missing registrations
   and errors; do not hand-maintain a list of resolved template paths.
4. Feed that complete result and the captured handoff to the Designer host.
   Exercise real tabs, adapters, save/reopen, and validation in Playwright.
5. For generated-canvas fixtures, click Generate in Designer, assert the
   dispatched Generate skill and resulting frozen request ID, use that ID with
   the **installed** `scripts/generate.mjs`, then serve the generated provider
   and assert the fixture's behavior in Playwright. For UI requiring a completed
   phase or artifact, provide deterministic source-owned runtime event/artifact
   evidence rather than calling an agent; do not mock the generated renderer.
   Wizard-only fixtures stop at observable Wizard composition/behavior;
   Designer-only fixtures stop at Designer.

The Billing journey in `designer-pages.spec.mjs` and seven journeys in
`preset-generated.spec.mjs` exercise the generated-app path; two
`preset-designer.spec.mjs` journeys stop at Designer, and the installed
Wizard Layer case in `wizard-journeys.spec.mjs` stops at Wizard.
These tests are not evidence that a live agent
invokes the skills in the correct order. Nor does a local worktree-source
install verify the published archive selected by the catalog; that requires
separate release-readiness verification.

## Fixture coverage

| Fixture | Last surface | Distinct behavior to assert |
|---|---|---|
| `copilot-wizard-layer-test` | Wizard | Installed command layers affect the Wizard pipeline and selected command evidence. **Implemented.** |
| `copilot-canvas-design-test` | Designer | Contributed test tab/fields render, edit, save and reopen. **Implemented.** |
| `copilot-minimal-essentials-test` | Designer | Essentials replacement has only the required identity controls and no removed registrations. **Implemented.** |
| `copilot-billing-canvas-test` | Generated canvas | Billing field persists through Designer and renders read-only under Billing in the generated canvas. **Implemented.** |
| `copilot-risk-matrix-test` | Generated canvas | Composite keyboard selection survives as the generated read-only cell. **Implemented.** |
| `copilot-badge-input-test` | Generated canvas | Preset badge type/control and evaluator produce the expected badge using deterministic completed-run evidence. **Implemented.** |
| `copilot-logo-gallery-test` | Generated canvas | Uploaded gallery image renders in the generated gallery slot. **Implemented.** |
| `copilot-generated-page-test` | Generated canvas | Registered page appears only in the generated app, not as a Designer tab. **Implemented.** |
| `copilot-canvas-values-test` | Generated canvas | Typed values and computed provider render the intended generated page/workflow. **Implemented.** |
| `copilot-dialog-buttons-test` | Generated canvas | Dialog-only button confirms without a run; Implement phase dialog shows selected-phase context, cancels without a run and confirms a run request. **Implemented.** |
| `copilot-phase-view-label-test` | Generated canvas | Replacement phase definition changes the generated Plan viewer label using a deterministic Plan artifact. **Implemented.** |

All 11 fixtures have behavioral journeys with `--dev` installs from the
test-only location. The duplicate installation-only cases have been removed;
`preset-fixtures.spec.mjs` retains manifest-to-journey discovery and the
shipping-catalog boundary. Focused negative, integrity, and host/adapter
contract tests remain: a happy-path journey does not replace an
incompatible-exchange or failure-recovery test.

## Running the pilot

From the repository root with the project's Playwright dependencies and
`specify` CLI available:

```powershell
& plugins\spec-kit-copilot-wizard\extensions\speckit-wizard-canvas\node_modules\.bin\playwright.cmd test designer-pages.spec.mjs --config plugins\spec-kit-copilot-wizard\extensions\speckit-wizard-canvas\playwright.config.mjs --grep 'Wizard-selected Billing' --workers=1
```

The pilot requires Specify; a missing CLI is a failure rather than a skipped
integration test. See
[`docs/testing/wizard-designer-test-plan.md`](../../docs/testing/wizard-designer-test-plan.md)
for the wider Wizard/Designer coverage and boundary policy.
