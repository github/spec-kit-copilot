<!-- speckit:plan v1 -->
# Contract — Zustand State Store

The Zustand store is the single source of truth for a live run. Only the store may mutate `Run`; UI components read via selectors and dispatch actions.

## Store shape

```ts
interface GameStore {
  // State
  run: Run | null;
  settings: Settings;
  contentReady: boolean;
  contentError: ContentLoadError | null;

  // Provisioning actions (phase === "provisioning")
  beginProvisioning(): void;
  renameCrew(index: number, name: string): void;
  allocateSupplies(next: Supplies): void;
  startJourney(seed?: number): void;

  // Travel actions
  advanceTurn(): void;
  resolveEvent(choice: EventChoice): void;

  // End-of-run
  endRun(reason: RunOutcome): void;
  clearRun(): void;

  // Persistence
  saveNow(): Promise<void>;
  loadSave(): Promise<{ ok: true } | { ok: false; reason: SaveLoadError }>;

  // Debug/observability (dev builds only)
  __dumpState?(): Run | null;
}
```

## Action contracts

### `beginProvisioning()`
- **Precondition**: `run === null || run.phase === "ended"`.
- **Postcondition**: creates a new `Run` with `phase = "provisioning"`, a fresh `id`, a placeholder crew, and the current `settings.autoSave` value copied.
- **Errors**: none.

### `renameCrew(index, name)`
- **Precondition**: `run.phase === "provisioning"`; `index in [0, crew.length)`; `name.length in [1, 20]`.
- **Postcondition**: `crew[index].name === name`.
- **Errors**: throws `InvalidCrewName`.

### `allocateSupplies(next)`
- **Precondition**: `run.phase === "provisioning"`; `cost(next) <= startingCredits`.
- **Postcondition**: `run.supplies` replaced by `next`; leftover credits stored on the run.
- **Errors**: throws `OverBudget`.

### `startJourney(seed?)`
- **Precondition**: `run.phase === "provisioning"`; every crewmate has a name; `crew.length >= 3`.
- **Postcondition**: `run.phase = "traveling"`; `run.seed = seed ?? mint()`; RNG initialized; captain's log records `"Departed with N crew."`.
- **Errors**: `NotReady`.

### `advanceTurn()`
- **Precondition**: `run.phase === "traveling"`; `run.turn < 20`.
- **Postcondition**: `run.turn++`; supplies debited; an event card MAY be drawn — if so, `phase = "event"`; if `turn === 20` without a fatal event, `phase = "ended"` with `outcome = "survived"`.
- **Errors**: `NotTraveling`.

### `resolveEvent(choice)`
- **Precondition**: `run.phase === "event"`; `choice` matches one option offered by the current event.
- **Postcondition**: `Effect[]` from the chosen branch applied; `phase = "traveling"` (unless a fatal effect ends the run).
- **Errors**: `NoActiveEvent`, `InvalidChoice`.

### `endRun(reason)` / `clearRun()`
- Standard terminal / reset transitions.

### `saveNow()` / `loadSave()`
- Delegate to `state/persist.ts`. See `save-format.md`.

## Selectors (read-only, memoized)

```ts
const useAliveCrew        = () => useStore(s => s.run?.caravan.crew.filter(alive) ?? []);
const useJourneyProgress  = () => useStore(s => (s.run?.turn ?? 0) / 20);
const useSuppliesLow      = () => useStore(s => (s.run?.supplies.food ?? 0) < (s.run?.caravan.crew.length ?? 0));
```

## Invariants the store enforces

1. UI never sees an intermediate mid-turn state — `advanceTurn` runs atomically inside the store's set-callback.
2. `run.turn` never exceeds `20`.
3. `run.phase === "ended"` is terminal within the store; only `clearRun()` or `beginProvisioning()` moves out.
4. Every state transition that mutates `run` also appends 0..1 `LogEntry`.

## Test contract (unit)

- `startJourney` produces identical `Run` snapshots for a fixed seed across 100 iterations.
- Every action rejects preconditions with the documented error and leaves state unchanged.
- 20× `advanceTurn` with a fixed seed terminates in `phase === "ended"` and matches a checked-in `captainsLog` golden.
