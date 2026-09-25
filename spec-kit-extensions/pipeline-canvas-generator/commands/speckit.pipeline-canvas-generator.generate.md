# Generate a Spec Kit canvas

Use this command only to create a standalone, project-scoped canvas from confirmed
Spec Kit phases. A design package can change its appearance, but must not supply
any selected runtime phase command. No phase skill runs during generation.

1. Use choices already supplied by the user; collect missing ordered
   phase command IDs, each command's explicit `expectsArtifact` (`true`,
   `false`, or `null` for unknown) and `outputPath` (string or `null`),
   canvas ID, display name, or recipient workspace. Do not guess paths
   from skills. `false` requires a null path. Confirm
   the derived exact target `.github/extensions/<canvas-id>/` and whether this
   is new generation or replacement. If the target
   exists, show its full path and warn that **every file in that directory,
   including manual edits, will be deleted without backup or rollback**.
   Require explicit confirmation of that exact path before preparing an
   overwrite request; cancellation stops without touching the target. This
   applies even to partial or unrecognized generated targets. Check that Specify is at least
   1.0.7, the workspace is initialized in Copilot skills mode, and the current
   host has the `create-canvas` skill, extension management/scaffold, reload,
   inspect, and canvas-open capabilities. Surface unavailable capabilities.
2. If the Wizard supplied an absolute prepared `request.json` path, use that
   immutable request directly. It was created by the extension-owned
   `prepare-request` entry using the Wizard's freshly captured Specify
   inventory and confirmed phase order; do **not** recapture composition or
   create a second request. Verify its recorded canvas, workspace, selected
   phases, and replacement decision match the Wizard confirmation. Otherwise,
   invoke `scripts/python/canvas_generate.py prepare-request` with `--workspace`,
   `--canvas-id`, `--display-name`, `--overwrite` for a confirmed replacement,
   and one `--phase <speckit.command>` per phase in confirmed order. Pass
   `--phase-outputs-json '<ordered JSON array>'`, with each entry shaped
   `{"commandName":"speckit.plan","expectsArtifact":true,"outputPath":"specs/<slug>/plan.md"}`.
   Use `null` for genuinely unknown expectations/paths; Analyze, Taskstoissues,
   and Implement have no direct artifact by default (`false`, `null`).
   The Wizard entry may pass its freshly captured Specify
   `artifacts`, `presets`, and `extensions` JSON using `--inventory-stdin`; the
   CLI entry lets the operation capture those three Specify lists itself.
   If the user explicitly supplies one or more complete, versioned JSON
   documents, pass each to the corresponding `--presentation-json`,
   `--phase-outputs-document-json`, `--results-json`,
   `--interactions-json`, or `--setup-json` option. Never infer an override
   from ordinary prose, accept partial documents, strip comments, or
   rewrite an installed preset. Validate with `validate-config` if needed;
   `prepare-request` validates every input again. A customer preset or
   Canvas Design extension supplying the same named document wins as a
   whole; disclose any overridden one-off input before continuing. The
   generator default for phase outputs contains exactly the selected
   commands. A customer replacement must match that exact set.
   Use the emitted `requestPath` for every subsequent operation. Complete a
   validated generation brief in this **same agent turn**: the captured choices,
   request-bound selected phase order, explicit artifact handoff, design
   inputs, and project-scoped output. Never edit
   `request.json`, recompute provider stacks, infer output paths from files or
   prose, or run a phase as part of authoring.
3. Invoke the `create-canvas` skill, call extension management `guide`, and
   obtain a fresh **session-scoped** canvas scaffold with a unique temporary
   name. Save the returned scaffold directory path. Do not scaffold at the
   project target; the target must remain untouched until the complete
   candidate passes validation. Do not reload the temporary scaffold.
   Run `stage-scaffold --request <requestPath> --scaffold <temporary-directory>`
   and retain its `scaffoldPath`; this snapshots the validated scaffold under
   the request's confined staging, then resolves the five complete JSON
   documents with the captured Specify winners for presentation, phase
   outputs, and results. A missing or invalid document stops generation.
4. **Only when** the effective generation command or the confirmed Generate
   action explicitly names a distinct Canvas Design support command, call
   `support-command --request <requestPath> --command <name>`. Require its
   effective contributing extension, documented `## Inputs` and `## Result`,
   and returned invocation to match the captured composition. Invoke that
   returned skill **once**, passing only its documented inputs; if it fails,
   stop and surface the failure. Pass its actual JSON response to
   `record-support-result --request <requestPath> --command <name>
   --source-sha256 <sourceSha256 from support-command>
   --result-stdin`. This validates the result and writes the draft; the
   compatibility envelope permits only `{"categories":{}}`. A nonempty sparse
   result fails visibly and must not be merged into any named design document.
   Do not invoke any support command merely because a package was
   installed or reloaded. There is no automatic support hook. When **no**
   support command was explicitly named, write exactly
   `{"categories": {}}` as `command-override-draft.json` beside the request.
   Do not include a digest or schema version in the draft.
5. Call `prepare-override --request <requestPath>`. The extension computes the
   digest from the exact request bytes and writes `command-override.json`.
   Pass the request and the staged `scaffoldPath` to `materialize
   --request <requestPath> --scaffold <scaffoldPath>`; this requires the finalized
   override, validates the scaffold, and writes a confined candidate and
   integrity receipt. The draft is **never** materialization input. On any
   failure, do not publish or manufacture a success result.
6. For a new target, call `generate --request <requestPath> --scaffold <scaffoldPath>`.
   For a confirmed replacement, call `regenerate --request <requestPath>
   --scaffold <scaffoldPath> --confirmed-target <exact-confirmed-path>`. Regenerate
   validates the candidate before locking and removes only that target, with
   no backup or rollback. If publication fails, report the recorded
   failure or absence of a result; a partial target is handled by a fresh,
   confirmed Regenerate request, not a hidden retry.
7. Remove only the unique temporary session-scoped scaffold directory after
   publication, then reload extensions. Inspect `project:<canvas-id>` and
   confirm that it is ready and declares `<canvas-id>`. Open that canvas once
   with an absolute `cwd` equal to the confirmed workspace and a fresh
   instance ID. Only after the provider was inspected and the open succeeded,
   call `record-outcome --request <requestPath> --provider-id
   project:<canvas-id> --opened-instance <instance-id>`. If reload, inspect,
   or open fails, call `record-outcome` instead with `--error-code` and
   `--details`; surface the error and do not claim success. An absent
   `result.json` means the run was interrupted.

The generated canvas is independent of this generator and the Wizard. Its
runtime dependencies are only the selected phase providers captured in the
request; design-only packages are not runtime dependencies. Effective
`canvas-renderer` templates are unsupported and fail preparation.
