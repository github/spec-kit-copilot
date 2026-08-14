# Research: Saturn Trail — Phase 0

**Feature**: `001-saturn-oregon-trail`
**Spec**: `./spec.md`
**Constitution**: `../../.specify/memory/constitution.md` (v1.0.0)
**Date**: 2026-08-14

This document resolves every technical unknown surfaced from the spec + clarifications so no `NEEDS CLARIFICATION` marker remains before Phase 1 design.

---

## 1. Runtime language & framework

- **Decision**: TypeScript 5.x on top of vanilla ES modules; UI in React 18 (function components + hooks) bundled with Vite 5.
- **Rationale**: The spec locks the target to browsers (latest-two Chrome desktop + Safari desktop/iPadOS) and mandates offline-first play after initial load. React is the most widely-supported UI runtime on that browser matrix, and Vite produces a static bundle that trivially satisfies "runs from cache once loaded". TypeScript is required by Constitution Principle I (Code Clarity) — types are the cheapest form of readable intent for a narrative state machine with 7 entities and probabilistic events.
- **Alternatives considered**:
  - *Svelte 5*: smaller bundles, but weaker Safari-on-iPadOS story for older `runes` syntax and shallower ecosystem for the sub-agent tooling used elsewhere in this repo.
  - *Plain JS + Web Components*: rejected — Principle II (Test-First) is much cheaper to satisfy with the React Testing Library + Vitest stack than with custom-element harnesses.
  - *Elm / Rescript*: rejected — team learning curve violates Principle III (Simplicity & YAGNI) for a v1 that will ship 20–40 minutes of gameplay.

## 2. State management

- **Decision**: A single Zustand store (`useRun`) holding the active `ExpeditionRun`, plus a small `useMeta` store for title-screen / captain's-log data. All mutations go through named actions; no direct setState.
- **Rationale**: The whole game is one long finite-state machine over a single run. Zustand keeps the code path readable, integrates cleanly with React 18 concurrent mode, and produces JSON-serializable state — which is exactly what IndexedDB persistence needs (see §4). Constitution Principle V (Observability) is satisfied by wrapping each action with a `log(actionName, payload)` helper.
- **Alternatives considered**:
  - *Redux Toolkit*: rejected — RTK's ceremony (slices + createAsyncThunk) is disproportionate for a single-player game and violates Principle III.
  - *React Context + `useReducer`*: rejected — every state change re-renders every subscriber, which will visibly stutter the event modal on iPadOS Safari.
  - *XState*: attractive for the event-choice sub-flow, but adds a peer dependency purely for the event modal; deferred to v2 if the event tree grows past ~30 nodes.

## 3. Randomness & determinism

- **Decision**: PCG32 seedable PRNG (via the `seedrandom` package) initialized once per run from `crypto.getRandomValues`. All random draws (event pool, detour surfacing, event outcome rolls) go through the same PRNG instance; the seed is persisted with the save.
- **Rationale**: US3's *Independent Test* explicitly requires: "With a scripted seed, run a travel leg and verify the same event fires, presents its choices, and each choice deterministically applies its documented outcome". `Math.random` is not seedable across browsers; PCG32 is fast, small, and produces identical sequences on Chrome and Safari.
- **Alternatives considered**:
  - *`Math.random` + capturing rolls*: rejected — non-deterministic across sessions, forces logging every roll for repro.
  - *Mulberry32*: acceptable but PCG32 has better statistical quality for the ~200 draws per run and equal footprint.

## 4. Persistence (save/resume + captain's log)

- **Decision**: IndexedDB accessed via the tiny `idb-keyval` wrapper. Three keyed stores:
  1. `active-run` — the current `ExpeditionRun` JSON (auto-saved at every waystation + manual save).
  2. `captains-log` — an array of the last **N=20** `RunRecap` records.
  3. `settings` — accessibility toggles + tutorial-seen flag.
- **Rationale**: Session 2026-08-14 clarification pinned IndexedDB (see spec.md FR-008). `idb-keyval` is <1KB gzipped, has no external dependency, and treats stores as promise-returning KV — perfect for JSON-serializable state. `localStorage` was rejected because event history + recap can exceed 5 MB across the 20-run captain's log.
- **Alternatives considered**:
  - *Dexie*: over-featured (query index, migrations) for three fixed keys; adds ~30KB.
  - *Origin Private File System*: not yet on Safari macOS 15 → violates the browser matrix.
- **Data-safety pattern**: every write is JSON-stringified through a versioned envelope `{schemaVersion: 1, data}` so future migrations are additive.

## 5. Save-quota headroom

- **Decision**: On startup, the app calls `navigator.storage.estimate()` and, if `quota - usage < 20 MB`, shows a soft warning banner ("Storage low — save may fail on the next waystation"). Save-failure paths surface a modal, roll back the in-memory state, and offer "Retry" / "Export recap to clipboard".
- **Rationale**: Constitution Principle V requires actionable errors, not silent failures. IndexedDB quota errors are the single most common cause of a broken save in offline-first web games; without this, FR-008 fails silently on shared devices.
- **Alternatives considered**:
  - Ignore quota — rejected; violates Principle V.
  - Automatically purge oldest captain's log entry on failure — rejected; loses user history without consent.

## 6. Clipboard for run recap

- **Decision**: `navigator.clipboard.writeText()`, with a `<textarea>` + `document.execCommand('copy')` fallback path for the iPadOS PWA edge case where the async Clipboard API is gated behind a user gesture that has already been consumed by the modal open.
- **Rationale**: SC-006 targets 95% success on Chrome + Safari; both fully implement the async API, but Safari's user-gesture rules bite when the copy button is inside a follow-up dialog. The fallback is 15 lines and eliminates the failure mode.
- **Alternatives considered**:
  - `navigator.clipboard.write` (rich payload): unnecessary — the recap is plain text.
  - Manual "select all and copy" instructions: rejected; SC-006 requires a one-click flow.

## 7. Rendering, art pipeline & performance

- **Decision**: 2D UI in React DOM + Tailwind CSS 4 for layout; illustrated / pixel-style assets shipped as pre-optimized WebP + PNG fallback, lazy-loaded per scene. No canvas or WebGL in v1. Target **60 fps steady** on the event modal transition and travel-map pan, **≤ 2.0 s time-to-interactive** on a first-visit cold load on a mid-range 2022 iPad (Safari).
- **Rationale**: The spec calls out "2D with illustrated or pixel-style art in the spirit of Oregon Trail's low-fidelity look". Modal + map interactions dominate the render loop; a DOM-only implementation keeps a11y story (keyboard, WCAG AA, focus rings from FR-012) automatic — moving to canvas would require re-implementing focus management.
- **Alternatives considered**:
  - PixiJS canvas layer: attractive for pixel art authenticity but blocks the accessibility floor from FR-012.
  - Static PNG only: rejected — payload size hurts the offline-first cold load.

## 8. Accessibility posture

- **Decision**: Ship WCAG 2.1 AA colour contrast on all text (audited with `axe-core` in CI), a visible focus ring on every interactive element (`:focus-visible` outlined at 2px contrast ratio ≥ 3:1), and never use colour alone to communicate state (each resource meter shows an icon + numeric value + colour). Full screen-reader narration + `prefers-reduced-motion` support are deferred to v2 and MUST appear as a known gap on the About screen (per FR-012 clarification).
- **Rationale**: Direct implementation of the Session 2026-08-14 clarification. `axe-core` in CI is a durable Principle II (Test-First) enforcement of the floor.
- **Alternatives considered**:
  - Full WCAG AAA / screen-reader v1: rejected — expands scope beyond the 20–40 minute MVP loop.
  - Lint-only a11y (`eslint-plugin-jsx-a11y`): weaker than runtime `axe-core`; keep both.

## 9. Testing strategy

- **Decision**: Three-tier stack:
  - **Unit**: Vitest for pure functions (PRNG determinism, resource-consumption formula, event resolution, save-envelope migration).
  - **Component**: React Testing Library + Vitest for panels (event modal, trade panel, title screen, run summary), asserting keyboard-only reachability and ARIA labels.
  - **End-to-end**: Playwright driving Chrome + WebKit (Safari surrogate), running the three *Independent Test* scenarios (US1 full run, US2 waystation buy/sell/repair/hire, US3 scripted-seed determinism), plus save/resume from US4.
- **Rationale**: Constitution Principle II is non-negotiable; every acceptance scenario in the spec becomes at least one automated test. Playwright's WebKit is the closest available Safari-in-CI surrogate and matches the target matrix.
- **Alternatives considered**:
  - Cypress: rejected — no WebKit target, worse for keyboard-only test authoring.
  - Manual QA: rejected — Principle II mandates automation.

## 10. Offline-first packaging

- **Decision**: Vite + `vite-plugin-pwa` (Workbox under the hood) with a `generateSW` strategy: `precache` the app shell + fonts + astronomy Almanac copy; `runtime cache` (StaleWhileRevalidate) for scene art. Ship a `manifest.webmanifest` so iPadOS "Add to Home Screen" gets a legitimate app-icon and standalone display.
- **Rationale**: SC-005 requires a fully-offline playthrough after first load. `vite-plugin-pwa` gives a battle-tested service-worker install path on both Chrome and Safari, and reduces the offline-first work to a config file rather than a hand-rolled SW.
- **Alternatives considered**:
  - Hand-written service worker: rejected — every kilobyte violates Principle III.
  - No PWA, only IndexedDB: rejected — closing and reopening the tab without a network drops the shell.

## 11. Content data authoring

- **Decision**: Waystations, event pools, and Almanac entries live as versioned JSON files under `src/content/` (one file per waystation, one per event pool tag, one per Almanac body), validated at build time with a Zod schema and at content-CI time with a `contentaudit` script that guarantees every event pool includes at least one high-severity and one low-severity outcome (satisfying the edge-case rule that every waystation must have a viable forward route).
- **Rationale**: Keeps content diffable in code review (Principle IV — Reviewability), and turns the "unreachable destination" edge case in the spec into a build-time check rather than a runtime surprise.
- **Alternatives considered**:
  - Author in Markdown: rejected — cannot type-check the event outcome effects.
  - CMS-backed content: rejected — violates offline-first + no-backend.

## 12. Observability

- **Decision**: A single `logEvent(name: string, payload: Record<string, unknown>)` helper that writes to `console.debug` in dev and to an in-memory ring buffer (last 200 entries) in production. The buffer is included in the "Copy diagnostics" button on the About screen for user-initiated bug reports. **No** network telemetry, matching the spec's "no telemetry in v1" assumption.
- **Rationale**: Principle V (Observability) demands actionable errors; the spec forbids remote telemetry. In-memory + opt-in export threads that needle.
- **Alternatives considered**:
  - Sentry: rejected — network beacon violates spec assumption.
  - Nothing: rejected — Principle V.

---

**Result**: 0 `NEEDS CLARIFICATION` markers remain. Phase 0 complete.
