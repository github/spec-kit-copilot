# Contract: Canvas Runtime, Setup, and Lifecycle

**Status**: Proposed v1 integration contract. Final action names and shapes
must be checked against the pinned PR #32 generated-runtime actions during
the extraction; do not invent a parallel action transport.

## Host and renderer API boundary

The generated extension uses the supported Copilot SDK extension session
and canvas declaration. The protected host provides a versioned
`CanvasRuntimeApiV1` to exactly one renderer; a generated-runtime adapter
and an isolated Wizard preview/conformance adapter implement the same
contract. The Wizard's **live** UI does not mount that generator renderer.

Conceptual interface:

```text
getSnapshot() -> {
  workflowMetadata,
  projectPrerequisites,
  workflowItems,
  phases,
  artifacts,
  phaseState,
  phaseResults,
  progress,
  clarification,
  setupReadiness,
  protectedDependencyFacts,
  capabilities
}
subscribe(onChange) -> unsubscribe
invoke(knownAction, validatedInput) -> { ok, value? } | { ok: false, code, message }
```

The host, not the renderer, computes current/stale state, protected
dependency facts, paths, permissions, and success/error results. Supported
semantic action families include phase dispatch/rerun, artifact preview,
clarification/amendment, workflow creation/deletion when declared, and
explicit setup confirmation. Each host advertises capabilities; a
renderer must declare only required ones and fail to load if missing.
Final action identifiers are fixed by the versioned API contract after
mapping the PR #32 actions; no private HTTP route is public renderer API.

The original phase turn may report a configured `phase-report` result via
the existing host `invoke_canvas_action` transport to the protected
`report_phase_result` action, carrying `instanceId`, active `phaseRunId`,
and allowed `resultId`. This is agent-to-host evidence, not a public
renderer mutation or an additional SDK tool. It must be run-bound,
idempotent on same value, reject conflicting/older reports, and settle
only after phase success.

## Recipient readiness and setup

Foundation probe, in order:

1. Compatible released Specify CLI and compatible `spec-kit-copilot`
   Copilot plugin are present; the generated app installs neither.
2. The destination's `.specify/init-options.json` records Copilot
   skills mode, required infrastructure exists, and the generated
   `.github/skills/speckit-<command>/SKILL.md` layout is present.
   Neither `.specify/` alone nor `specify check` alone proves readiness.
3. The host can reload skills/plugins as needed.

If project initialization is absent or malformed, remain blocked and
show a warning that `--force` merges Spec Kit infrastructure and may
replace conflicting `.specify/` / `.github/skills/` files. Only after
destination-user confirmation may the protected action run:

```text
specify init --here --force --integration copilot --integration-options="--skills" --script py --ignore-agent-tools
```

Execute at a verified repository root, reload skills, and rerun the whole
readiness probe. Cancel or failure remains blocked; no runtime-component
installation policy may bypass this confirmation.

After foundation readiness, compare the exact captured required runtime
set (ID, version, source, priority, enabled state, skills) with installed
state and apply one of:

| Policy | Missing or incompatible set |
| --- | --- |
| `external` | Report complete set, perform no install, remain blocked until external preparation |
| `prompt` | Disclose all type/ID/version/catalog/source/trust/executable facts and community warning; one Install all or Cancel decision bound to complete-set fingerprint |
| `automatic` | Install only the administrator-authorized exact fingerprint-bound set without recipient prompt, still respecting host/org/source permissions |

No subset picker, substitution for source drift, credential embedding, or
approval copy that hides protected facts. Setup reloads skills after
installation and verifies the full set; partial/failed installation stays
blocked. Design-only components are not installed at recipient runtime.

## Design-time Wizard boundary

Wizard Environment installs the required first-party generator after
project initialization at extension priority 100, repairs wrong
priority/disabled state, and gates Generate on the released compatible
Specify version and generator readiness. It never installs it lazily
from the Generate button. The Canvas Design area uses the existing
catalog's fixed trusted source set, tabs, search, trust disclosure, and
immediate one-component Add/Remove, including skill reload on successful
package changes. Its Cancel action does not roll back completed Add/Remove
operations; Generate does no mixed batch.

The normal Main Catalog and Phases tab filter out catalog/installed-manifest
`canvas-design` packages; the generated runtime Catalog excludes design
entries before search, sorting, pagination, counts, recommendations, updates,
and install actions. The Composition page may show complete Specify-resolved
stacks with tagged providers labeled or filtered for its UI; it never
recalculates precedence. Generate consumes the original effective stacks
plus package-tag classification for eligibility. A design-time support
command is never automatically invoked just because its provider is
installed. Bundle-level tags do not propagate: every included package
must be individually eligible.

## Generation and regeneration state machine

```text
capture fresh composition + confirmed human choices
  -> immutable request
  -> complete same-turn brief + create-canvas skill
  -> guide + fresh scaffold in confined request staging
  -> validate scaffold + normalize sparse override
  -> compile immutable blueprint and complete experience
  -> refine and validate whole candidate + receipt
  -> if target exists: show exact-path all-files warning; cancel leaves it unchanged
  -> acquire exact-target lock, replace only confirmed target
  -> read back, reload, inspect running provider, open once
  -> atomically write authoritative result; consume and clean exact request directory
```

**Confirmation and failure invariants**:

- A recognized receipt is informational; a receipt-less, partial, or
  unrecognized exact target gets the same whole-target warning with its
  classification. Confirmation permits replacement of only that path.
- The old target is never a new candidate input; Generate and Regenerate
  both start from a fresh supported scaffold in request staging.
- Validate candidate before mutation. Reject workspace/target/staging
  symlinks or reparse points and paths outside the verified root.
- Acquire the target-specific lock immediately before mutation. Concurrent
  requests cannot both publish to the same canvas ID.
- Delete the exact confirmed directory as a whole, publish the validated
  candidate, validate read-back, reload and inspect; never merge unknown
  files, back up, or roll back.
- A sharing violation or partial publication is a controlled failure;
  keep the diagnostic and offer ordinary Regenerate. It repeats the
  entire flow with fresh composition and confirmation.
- Workflow artifacts/user data outside the generated extension are never
  cleanup targets; never recursively delete `.specify/`, its cache root,
  the repository, or an unresolved target.
- Optional callback/analytics failures are visible separately and
  cannot convert a successful generation or phase dispatch to failure.
- An absent authoritative `result.json` indicates interruption, not
  success. No second independently authoritative result on stdout.

The generator's explicit inspect/remove commands use the receipt for
diagnostics and recognized-target verification. Removal requires exact
target confirmation; receipt-less or partial targets use Regenerate
instead. Neither follows symlinks or broad deletion.
