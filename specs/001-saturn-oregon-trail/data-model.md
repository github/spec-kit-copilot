<!-- speckit:plan v1 -->
# Data Model — Saturn Oregon Trail

Derived from `spec.md` (FR-001..016, SC-001..010) and `research.md` decisions §1–§12.

All state lives in memory (Zustand store) during a run and is snapshotted to IndexedDB on save. Nothing here maps to a database — the "model" is TypeScript types + runtime validators (Zod at content-load boundaries).

## Entities

### Run

The top-level per-play-through object. One active `Run` at a time.

| Field | Type | Notes |
|---|---|---|
| `id` | `string` (uuid v4) | Stable identifier used by save keys and captain's log. |
| `seed` | `number` (uint32) | RNG seed captured at run start; drives determinism. |
| `startedAt` | `string` (ISO-8601) | Wall-clock stamp; display only, never used for game logic. |
| `turn` | `number` (0..20) | Current turn index. `20` = journey complete. |
| `phase` | `RunPhase` | `"provisioning" \| "traveling" \| "event" \| "ended"`. |
| `outcome` | `RunOutcome \| null` | `"survived" \| "perished" \| null while in-progress. |
| `caravan` | `Caravan` | See below. |
| `supplies` | `Supplies` | See below. |
| `captainsLog` | `LogEntry[]` | Append-only; ≤ 500 entries per run (ring buffer beyond that). |

Validation:
- `turn` monotonically increases; the store rejects a transition where `nextTurn < currentTurn` (game rule).
- `phase === "ended"` iff `outcome !== null`.
- `id` is generated once by `crypto.randomUUID()` at run start; never changes.

State transitions:

```
provisioning ──(startJourney)──▶ traveling
traveling    ──(rollTurn: eventDrawn)──▶ event
event        ──(resolveEvent)──▶ traveling  |  ended
traveling    ──(turn === 20)──▶ ended (outcome = survived)
traveling    ──(caravan.headcount == 0 or supplies.food <= 0 && condition)──▶ ended (outcome = perished)
```

### Caravan

Represents the group of crewmates on the journey.

| Field | Type | Notes |
|---|---|---|
| `crew` | `Crewmate[]` | 3..6 members. Fixed at provisioning; cannot grow. |
| `wagonCondition` | `number` (0..100) | Vehicle integrity. Breakdowns cost turns. |
| `morale` | `number` (0..100) | Affects success rates in some events. |

Validation:
- `crew.length` is set at provisioning and immutable after `startJourney`.
- `wagonCondition <= 0` → next `advanceDay` triggers a "wagon lost" ending unless resolved by a repair event.

### Crewmate

| Field | Type | Notes |
|---|---|---|
| `name` | `string` (1..20 chars) | Player-editable during provisioning. Unicode allowed. |
| `role` | `CrewRole` | `"captain" \| "engineer" \| "medic" \| "scout" \| "cook" \| "greenhorn"`. |
| `health` | `number` (0..100) | 0 = crewmate is lost. Cannot revive. |
| `status` | `CrewStatus` | `"healthy" \| "hungry" \| "ill" \| "injured" \| "lost"`. |

Validation:
- Exactly one `role === "captain"` per caravan.
- `health === 0` → `status = "lost"` and the crewmate is excluded from `caravan.crew.filter(alive)` reads.
- `status` transitions are driven by events; the raw fields are internal to the engine.

### Supplies

| Field | Type | Notes |
|---|---|---|
| `food` | `number` (0..999) | Consumed each turn; `foodPerTurn = alive(crew).length`. |
| `water` | `number` (0..999) | Consumed each turn same as food. |
| `parts` | `number` (0..99) | Consumed by wagon repair events. |
| `credits` | `number` (0..9999) | Provisioning budget carryover; some events accept credits. |

Validation:
- `food < 0` or `water < 0` triggers "starvation" / "dehydration" status transitions the next turn — never persisted negative.
- Initial values assigned during provisioning must not exceed the `credits` budget.

### LogEntry (captain's log — one run's accumulated feed)

| Field | Type | Notes |
|---|---|---|
| `at` | `number` (turn 0..20) | When this entry was recorded. |
| `kind` | `LogKind` | `"event" \| "resource" \| "milestone" \| "system"`. |
| `text` | `string` (1..280 chars) | Human-readable line, ready for clipboard paste. |
| `eventId` | `string \| null` | Optional back-reference to `EventCard.id`. |

Validation:
- Entries are append-only during a run.
- `text` is pre-formatted at write time — no runtime templating during export.

### EventCard (content, not run-state)

| Field | Type | Notes |
|---|---|---|
| `id` | `string` (kebab-case) | Stable id used for tests and determinism. |
| `kind` | `EventKind` | `"weather" \| "breakdown" \| "encounter" \| "find" \| "ambience"`. |
| `weight` | `number` (0.0..1.0) | Draw probability tuning; sum-normalized per kind. |
| `minTurn` / `maxTurn` | `number` | Draw window along the 20-turn track. |
| `effects` | `Effect[]` | Declarative — see contract. |
| `flavor` | `{ title: string; body: string; }[]` | 1..4 variants picked by RNG. |

Validation (Zod at content load):
- `kind` matches enum.
- `weight >= 0` and `<= 1`.
- `effects` array parses against `Effect` union in `contracts/content-schema.md`.
- Content-schema failure surfaces as a fatal `ContentLoadError` before the title screen renders — the app does not silently degrade.

### Save

Serialized `Run` snapshot in IndexedDB.

| Field | Type | Notes |
|---|---|---|
| `version` | `1` | Save-format version. See `contracts/save-format.md`. |
| `run` | `Run` | Full run object at the moment of save. |
| `savedAt` | `string` (ISO-8601) | Display only. |

Validation:
- Save schema is versioned. A missing or higher `version` on load → migration path OR "unreadable save" screen with a "start fresh" button. Never silently dropped.

### Settings

Global user preferences persisted separately from a run.

| Field | Type | Notes |
|---|---|---|
| `theme` | `"saturn"` | Reserved for future themes; only `"saturn"` in v1. |
| `reducedMotion` | `boolean` | Honored if set; also auto-detected via `prefers-reduced-motion` at startup. |
| `autoSave` | `boolean` | Default `true`. |

## Relationships

- `Run` **has one** `Caravan`.
- `Caravan` **has many** `Crewmate`.
- `Run` **has one** `Supplies`.
- `Run` **has many** `LogEntry` (append-only during play).
- `Run` **references** `EventCard.id`s via `LogEntry.eventId`; cards themselves are content, not run state.
- `Save` **wraps** `Run` (1:1 at rest).

## Derived / Computed

- `alive(crew) = crew.filter(c => c.status !== "lost")`.
- `foodPerTurn = alive(caravan.crew).length`.
- `waterPerTurn = alive(caravan.crew).length`.
- `journeyProgress = run.turn / 20`.
- `outcome` is computed at `phase === "ended"` — never manually assigned by a UI action.

## Invariants (enforced in `src/engine/` — pure functions, unit-tested)

1. **Determinism**: `applyEvent(state, event, rng)` is a pure function. Given the same `state`, `event`, and `rng` state, output is identical. E2E golden `replay-from-seed` asserts this.
2. **Non-negative resources**: after every `advanceDay`, `supplies.{food, water, parts, credits}` are clamped to `[0, MAX]`.
3. **Bounded log**: `captainsLog.length <= 500`; a new push past the cap drops the head. Verified in a unit test.
4. **Immutability of provisioning**: `caravan.crew.length` and `Crewmate.role` do not mutate after `startJourney`.
5. **Single active run**: the store holds at most one `Run` at a time. Starting a new run archives the current save if `autoSave === true` and confirmed.
