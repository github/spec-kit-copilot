---
applyTo: "plugins/spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/**/*,plugins/spec-kit-copilot-wizard/extensions/speckit-canvas-designer/**/*,spec-kit-extensions/extension-canvas-design/generated-host/**/*,spec-kit-extensions/extension-canvas-design/generated-scaffold/**/*,spec-kit-presets/*/generated/**/*,tests/fixtures/test-presets/*/generated/**/*"
---

Keep phase Run and retry actions available when a Copilot agent turn is
`Request sent`, `Running`, or otherwise awaiting a response. An agent turn may
never report completion, so do not disable or hide these actions solely until
the turn completes. For the MVP, assume the user waits for the agent to return
before clicking Run again; a second click while pending may dispatch the same
phase again. Show the current status, but do not add pending-state disablement
or a duplicate-run confirmation solely to enforce that usage assumption.

If later adding retry safeguards, keep the action reachable when an agent never
responds. Any in-flight submission guard must have a bounded recovery path
after errors, timeouts, or refresh.
