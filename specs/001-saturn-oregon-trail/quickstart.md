<!-- speckit:plan v1 -->
# Quickstart — Saturn Oregon Trail

This guide is the validation surface for the feature. It walks a fresh checkout through the three golden user flows from the spec:

1. **Provision-and-survive** — the "happy path" 20-turn journey ending in `outcome: "survived"`.
2. **Provision-and-perish** — a deliberately under-provisioned run that ends early in `outcome: "perished"`.
3. **Replay-from-seed** — enter a known seed, run to end, and confirm the captain's log and final state are byte-for-byte identical to a golden fixture.

## Prerequisites

- Node 20+ and pnpm (or npm) installed.
- Chrome 120+ or Safari 17+ available for manual smoke.

## First-time setup

```bash
git clone <this-repo>
cd <this-repo>
pnpm install
pnpm playwright install chromium webkit    # once, for E2E
```

## Run the dev build

```bash
pnpm dev
# Vite serves at http://localhost:5173
```

Open the URL — the title screen loads. Content schema errors, if any, are visible on the title screen instead of a blank page.

## Golden flow 1 — Provision-and-survive

1. Title screen → **New Journey**.
2. Provisioning: keep default crew (4 members), spend the full budget on food and water.
3. Enter seed `12345` (or leave blank to mint one).
4. Click **Depart**.
5. Click **Next turn** 20 times, resolving events with the first available choice.
6. End screen shows **Survived** with copy of the captain's log.

**Expected**: `run.outcome === "survived"`. Captain's log has ≥ 20 entries. The "Copy recap" button copies plain text ending with `Play at: <no URL — offline-only>`.

## Golden flow 2 — Provision-and-perish

1. New Journey.
2. Provisioning: allocate all credits to `parts`, buying 0 food and 0 water.
3. Depart with any seed.
4. Advance turns until the run ends automatically.

**Expected**: run ends before turn 20 with `outcome === "perished"`. End-of-run screen still offers a copy-able recap.

## Golden flow 3 — Replay-from-seed

1. Run E2E: `pnpm test:e2e -- --grep replay-from-seed`.
2. The test enters seed `999`, plays a scripted 20-turn sequence, and diffs the final `Run` and `captainsLog` against `tests/e2e/fixtures/seed-999.golden.json`.

**Expected**: test passes. A red diff here means either the RNG stream or an engine rule changed — inspect the diff before landing.

## Validation commands

Run these in any PR that touches the game:

```bash
pnpm typecheck               # tsc --noEmit
pnpm lint                    # eslint + prettier check
pnpm test                    # vitest unit + integration + a11y
pnpm test:e2e                # playwright chromium + webkit
pnpm build                   # vite production build (also verifies bundle size gate)
```

**Bundle-size gate**: `pnpm build` fails if `dist/assets/*.js` gzipped > 250 KB (see `scripts/check-bundle-size.mjs`).

## Referenced contracts

- Store surface & invariants → [`contracts/state-store.md`](./contracts/state-store.md).
- Content JSON shape → [`contracts/content-schema.md`](./contracts/content-schema.md).
- IndexedDB save/load → [`contracts/save-format.md`](./contracts/save-format.md).
- End-of-run copy-to-clipboard → [`contracts/run-recap.md`](./contracts/run-recap.md).

## Data model

See [`data-model.md`](./data-model.md) for `Run`, `Caravan`, `Crewmate`, `Supplies`, `LogEntry`, and `Save` shapes plus invariants.

## Definition of done for this feature

- All three golden flows pass locally and in CI.
- `pnpm test` reports every engine and store contract test as green.
- A run installed as a PWA can be started, saved, closed (browser closed), reopened offline, and resumed at the same turn.
- End-of-run recap copies with either `clipboard-api` or `textarea-fallback` in the target browsers.
- Bundle-size gate passes.
