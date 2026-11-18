# Copilot Dialog and Buttons Test

Test-only Canvas Design preset. Appends six replace-only named templates:
two dialogs (one with selected-phase context), a dialog-only trigger control and
adapter, a binding for `speckit.implement` only, and a Workflow-page button in
`workflow.actions`. Unlike Setup's dedicated control, the trigger only opens
its dialog; confirmation reports a local result and never runs a phase.
Other phase runs stay dialog-free. This fixture does not replace the Workflow
page or the phase control, install runtime packages, or belong in the release
catalog.
