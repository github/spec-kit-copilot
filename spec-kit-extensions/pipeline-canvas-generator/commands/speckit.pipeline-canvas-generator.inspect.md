# Inspect a generated Spec Kit canvas

Confirm the recipient repository and canvas ID. Run
`python <installed-generator>/scripts/python/canvas_inspect.py --workspace <absolute-repository-root> --canvas-id <canvas-id>`
and report its exact target, generator version, and receipt-backed file count.
The inspector rejects modified, partial, unrecognized, or linked targets;
do not claim they are recognized or repair them implicitly.
