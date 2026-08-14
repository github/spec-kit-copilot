<!-- speckit:plan v1 -->
# Contract — Save Format

Saves live in IndexedDB via `idb-keyval`:
- `save:v1` — current active run
- `settings:v1` — user preferences
- `captainsLog:<runId>` — archived logs (post-endgame)

## Serialized shape

```ts
interface SaveV1 {
  version: 1;
  savedAt: string;   // ISO-8601, display only
  run: Run;          // engine-level Run object (see data-model.md)
}
```

- Serialized with `JSON.stringify` — all engine types are JSON-safe (no `Map`, `Set`, or `Date` at rest).
- `run.captainsLog` is included up to its 500-entry ring cap.

## Version migration policy

- On load, if `version !== 1`, the load API returns `{ ok: false, reason: "unreadable" }` and the UI offers a "Start fresh" action.
- Future migrations to version 1 → N will be additive-only; no silent drops.
- Rollback is not supported.

## Save-write contract

```ts
saveRun(run: Run): Promise<
  | { ok: true }
  | { ok: false; reason: "quota-exceeded" | "storage-unavailable" | "serialization-failed" }
>;
```

- Before every write, `navigator.storage.estimate()` is consulted. If `usage + candidateSize > quota * 0.8`, the call returns `quota-exceeded` without writing — the UI surfaces the pre-warning promised by SC-006.
- Writes are atomic (single `idb-keyval` object-store transaction per key).
- Serialization goes to a `Blob` first to accurately measure `candidateSize`.

## Save-read contract

```ts
loadRun(): Promise<
  | { ok: true; run: Run }
  | { ok: false; reason: "no-save" | "unreadable" | "storage-unavailable" }
>;
```

- Reads the raw JSON, then round-trips it through the `Run` Zod schema.
- Any schema failure → `"unreadable"`. The stored blob is left in place; a manual purge action may be offered.

## Storage isolation

- Only three key prefixes: `save:`, `settings:`, `captainsLog:`.
- Clearing site data (browser DevTools) is the sanctioned reset path — no in-app "delete everything" button in v1.

## Test contract (integration)

- Vitest + `fake-indexeddb`: round-trip a canonical `Run` fixture and assert deep-equal.
- Quota simulation: mock `navigator.storage.estimate` to return `usage = 0.9 * quota`; assert `saveRun` returns `quota-exceeded` without writing.
- Malformed blob: seed IndexedDB with `{"version":2,...}`; assert `loadRun` returns `"unreadable"`.
