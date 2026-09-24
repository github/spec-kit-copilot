# Remove a generated Spec Kit canvas

Confirm the repository and canvas ID, then run
`python <installed-generator>/scripts/python/canvas_inspect.py --workspace <absolute-repository-root> --canvas-id <canvas-id>`.
Show the **exact absolute target path** from its report and warn that removal
deletes **every file under that directory**, including manual edits, without
backup. Ask for explicit confirmation of that exact path; cancellation performs
no mutation. Only after the user confirms, run
`python <installed-generator>/scripts/python/canvas_remove.py --workspace <absolute-repository-root> --canvas-id <canvas-id> --confirmed-target <exact-absolute-path>`.
The remover rechecks receipt integrity under a target lock and refuses partial,
unrecognized, modified, unexpected-file, or linked targets. Never delete a
target manually or interpret a missing receipt as permission to remove it;
use confirmed Regenerate for partial output.
