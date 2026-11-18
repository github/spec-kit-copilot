---
applyTo: "plugins/spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/**/*,plugins/spec-kit-copilot-wizard/extensions/speckit-canvas-designer/**/*,spec-kit-extensions/extension-canvas-design/**/*,spec-kit-extensions/tests/**/*,spec-kit-presets/*/generated/**/*,tests/e2e/**/*,tests/fixtures/specify/**/*,tests/fixtures/test-presets/**/*"
---

**Treat a failing test as evidence to investigate, not permission to change the assertion.**
Reproduce the failure and compare the expected behavior with the relevant flow
plan, product requirements, and prior behavior. If it is a regression, fix the
production code rather than changing the test to match the regression. Change a
test only when the behavior change is intentional; explain the old expectation,
the new expectation, and the reason in the pull request. Apply the same scrutiny
to deleted, skipped, or weakened tests.
