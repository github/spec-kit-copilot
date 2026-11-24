---
applyTo: "plugins/spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/**/*,plugins/spec-kit-copilot-wizard/extensions/speckit-canvas-designer/**/*"
---

When running `specify` from the Wizard or Designer provider, pass subprocess
options from `specifySpawnOptions(project, { timeout, maxBuffer, ... })` in
`speckit-wizard-canvas/env/specify-invocation.mjs`. It augments `PATH` for
user-local uv/pipx installs and handles the Windows shell. Do not call
`execFile`/`spawn` for `specify` with only `cwd`, or rebuild its `PATH` at new
call sites. Preserve bounded output and existing warning behavior when the
CLI is genuinely unavailable.
