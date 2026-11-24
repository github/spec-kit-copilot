# Copilot Vertical Phase Control

Version **1.0.1** of this Specify preset replaces the generated Canvas Design Workflow page's phase
adapter with a vertical, numbered step list and a Copilot Autopilot action.
The Wizard and Designer do not gain a new appearance setting: select this preset
alongside `extension-canvas-design` before Generate. The generated app packages
the selected adapter and its managed-run phase-control definition, and runs
without the design-time preset installed.

In local development, add it from this checkout using
`specify preset add --dev ./spec-kit-presets/copilot-vertical-phase-control`.
For the staging release, register
`https://raw.githubusercontent.com/nicolehaugen/spec-kit-copilot/staging-canvas/spec-kit-presets/catalog.json`
as `spec-kit-staging` with `--install-allowed` and use
`specify preset add copilot-vertical-phase-control`.

Each step can be started manually. Autopilot asks the attached Copilot session
to run the installed skills in order; the host validates reported outputs
before accepting the next step. Stop or a failed/missing output leaves the
workflow pending for an explicit retry. Like the stock control, a manual retry
while a prior turn is pending may duplicate work; check chat first. Project
Constitution remains a separate, project-scoped action; the default generated app retains its
horizontal control when this preset is not selected.
After a generated app restart, an unfinished Autopilot run is persisted as
blocked. Check chat and outputs before retrying: the next request starts at
the first unverified step, never replays a verified step, and restores the
session mode from before the original run when it finishes. If every step
was already verified, there is no step to retry; check chat for the outcome.
An active Autopilot workflow cannot be deleted until it stops or finishes.
Its Stop action remains visible when a different workflow is selected; phase
progress on that workflow is not attributed to the active run. You can change
the selection to reach Stop, but must stop a blocked run before starting
Autopilot on another workflow if Copilot is still in Autopilot mode.
The managed-run capability is declared in the preset's phase-control JSON and
frozen into generated configuration. The server verifies both packaged hashes
without executing the browser module.
The replacement control also declares the phase-card and output badge slots,
so Designer badge placements remain available with the vertical layout.
The replacement control retains running and error notices but does not show a
built-in completed status; add a completion badge explicitly in Designer.

This preset depends on the Copilot Canvas Design runtime and its Copilot
session APIs. Its packaged adapter requires `workflow.rows.v1` and
`workflow.managed-run.v1` host capabilities; a generated host missing either
reports an incompatibility instead of silently omitting Autopilot. It is not
a general-purpose Specify layout preset. Its catalog archive URL only becomes
usable when the versioned preset release is published.
