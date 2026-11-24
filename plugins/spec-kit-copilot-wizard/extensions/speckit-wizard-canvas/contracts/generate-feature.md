# Generate canvas feature contract

Executable schema and producer/consumer validators live in `generate-feature.mjs`.
Malformed present flags are rejected explicitly; omitted flags from older
snapshots remain disabled. The user explicitly approved this shared validation
and incompatible-payload behavior in this implementation session.

Wizard open input accepts optional boolean `generateCanvas`. For a new instance,
omitting it uses runtime configuration `generateCanvasEnabled` (default false).
On focus/reopen, omission preserves the instance's effective boolean. Explicit
true or false replaces it. Non-booleans, including null, are rejected.

Every Wizard snapshot includes `featureFlags: { generateCanvas: boolean }`.
The UI shows the Generate button only when this value is true. Missing flags
on an older snapshot are treated as disabled by the UI.
Both initial REST and live SSE snapshots are validated before replacing UI
state. Incompatible SSE flags preserve the last accepted snapshot and report
the error through the transport's existing error handler.

Authenticated POST `/api/designer/launch` returns HTTP 403 with the existing
JSON error envelope and message `Generate canvas is disabled` when the instance
flag is not true, before importing or calling the launch handler. Enabled
requests retain existing validation and error behavior. Catalog inspection is
not gated. This flag is not persisted into workflow state or Designer handoffs.

Configuration is resolved once per provider process. It does not rewrite frozen
handoff install locators. The launcher skill explicitly opts in; ordinary open
omits the input and respects configuration.
