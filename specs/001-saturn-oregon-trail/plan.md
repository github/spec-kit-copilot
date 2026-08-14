<!-- speckit:plan v1 -->
# Implementation Plan: Saturn Oregon Trail

**Branch**: `001-saturn-oregon-trail` | **Date**: 2026-08-14 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-saturn-oregon-trail/spec.md`

## Summary

Ship a browser-native, single-player, turn-based caravan survival game — a Saturn-themed reskin of the Oregon Trail loop. Player provisions, then executes a fixed-length journey of turns where random events (weather, breakdowns, ambient life, resource finds) mutate crew health, supplies, and morale. A one-run captain's log accumulates during play and is offered as clipboard-copyable text at the end.

Technical approach (see [research.md](./research.md) for full rationale): a single-page TypeScript + React 18 app built with Vite 5, styled with Tailwind 4, state managed with Zustand, deterministic RNG via a seeded PCG32 stream, persistence via IndexedDB (idb-keyval), unit/integration tests in Vitest + React Testing Library, end-to-end tests in Playwright (Chrome + WebKit projects), packaged as an installable PWA via vite-plugin-pwa, and accessibility validated with axe-core in a Vitest suite. Content lives in versioned JSON files validated at load time with Zod. In-memory ring-buffer logging only — no telemetry or network calls at runtime.

## Technical Context

**Language/Version**: TypeScript 5.5+ compiled with `strict` on; targeted at ES2022 (evergreen browsers).

**Primary Dependencies**: React 18, Vite 5, Tailwind CSS 4, Zustand (state), `seedrandom` PCG32 variant (deterministic RNG), `idb-keyval` (IndexedDB wrapper), `zod` (content schema), `vite-plugin-pwa` (installable/offline), `axe-core` + `@axe-core/react` (a11y checks), `vitest` + `@testing-library/react` + `@testing-library/user-event` (unit/integration), `playwright` (E2E).

**Storage**: IndexedDB via `idb-keyval` for `save`, `captainsLog:<runId>`, and `settings` keys. No server. No third-party storage. Clipboard API (with a `<textarea>` fallback) for the end-of-run recap.

**Testing**: Vitest for unit + integration + a11y (axe-core) suites. Playwright for E2E, configured with two browser projects: `chromium` (Chrome desktop) and `webkit` (Safari desktop + iPadOS emulation). No live network in any test.

**Target Platform**: Latest-two Chrome desktop and Safari desktop/iPadOS (per FR-012 / clarification 2026-08-14). Runs entirely in-browser. Installable as PWA for offline replay.

**Project Type**: Single-page web application (frontend-only, static-hostable).

**Performance Goals**: 60 fps on canvas/DOM redraws during a turn; turn resolution (roll → apply → render) completes in ≤ 100 ms on a mid-range 2022 laptop; cold-load first paint under 2.0 s on a broadband connection; total gzipped JS bundle ≤ 250 KB.

**Constraints**:
- Fully offline-capable after first load (PWA precache).
- Deterministic replay: same seed + same input transcript → identical run outcome (locked in for regression testing).
- No network telemetry or analytics (privacy-by-default; content decisions per constitution Principle V).
- Save/resume survives browser restart and works with IndexedDB quota headroom checks before every write (SC-006).
- WCAG 2.1 AA minimum: contrast, visible focus rings, no colour-only affordances (per clarification 2026-08-14). Screen-reader and reduced-motion support deferred to v2 and is out-of-scope for this plan.

**Scale/Scope**: Single-player. Fixed 20-turn journey. ~15 event kinds × ~4 flavor variants each = ~60 authored event cards + ~10 resource/find cards + ~6 ambient art cards. One captain's-log per run, retained until user clears it. ~15 in-app screens/dialogs (title, provisioning, turn view, event modal, end-of-run recap, save/load, settings).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Constitution: `.specify/memory/constitution.md` v1.0.0 (ratified 2026-08-14).

| Principle | Assessment | Status |
|-----------|------------|--------|
| I. Code Clarity | TypeScript `strict`, ESLint + Prettier at project baseline, small pure functions for game rules (`applyEvent`, `rollTurn`, `advanceDay`). Named exports only; component files ≤ 200 lines. | PASS |
| II. Test-First (NON-NEGOTIABLE) | Every game-rule function ships alongside a Vitest suite committed in the same PR. E2E for the three golden user flows (provision-and-survive, provision-and-perish, replay-from-seed) written before the corresponding UI wiring lands. | PASS |
| III. Simplicity & YAGNI | No backend, no auth, no accounts, no multiplayer, no server-side leaderboards, no telemetry — all rejected in research §12 and reaffirmed here. Content lives in flat JSON, not a CMS. | PASS |
| IV. Reviewability | Feature slice per PR (state, one screen, its tests). Every PR includes a one-line "how to try it" note pointing at `quickstart.md`. Screenshots for any visual change. | PASS |
| V. Observability | In-memory ring buffer (last 500 events) exposed via `window.__SATURN_LOG` in dev builds; production builds strip the accessor. No network I/O. No analytics SDK. Errors surface via `<ErrorBoundary>` + on-screen recovery. | PASS |

**Result**: Initial Constitution Check PASSES. No violations to justify in Complexity Tracking.

Post-design re-evaluation (after Phase 1): PASSES. The data model, contract set, and quickstart introduce no new dependencies beyond those declared here. Test-first gate is honored by the contract-per-file layout under `contracts/` and the Vitest-based content-schema check.

## Project Structure

### Documentation (this feature)

```text
specs/001-saturn-oregon-trail/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── state-store.md
│   ├── content-schema.md
│   ├── save-format.md
│   └── run-recap.md
├── checklists/          # /speckit-checklist outputs (pre-existing)
└── spec.md              # /speckit-specify output
```

### Source Code (repository root)

Single-project frontend layout (Option 1 from the template — no backend, no mobile shell):

```text
src/
├── engine/                    # Pure game logic — no React, no DOM
│   ├── rng.ts                 # Seeded PCG32 stream + branch()
│   ├── events.ts              # Event registry + applyEvent(state, event)
│   ├── turn.ts                # rollTurn(), advanceDay()
│   ├── endgame.ts             # scoreRun(), buildRecap()
│   └── content-loader.ts      # Zod-validated JSON loader
├── state/
│   ├── store.ts               # Zustand store definition
│   ├── selectors.ts           # Memoized reads
│   └── persist.ts             # idb-keyval save/load + quota checks
├── ui/
│   ├── App.tsx                # Route/screen switcher
│   ├── screens/               # TitleScreen, ProvisioningScreen, TurnScreen, EventModal, EndOfRunScreen, SettingsScreen
│   ├── components/            # ResourceBar, CrewList, LogPanel, SeedInput, etc.
│   └── hooks/                 # useStore, useKeyboardNav
├── content/                   # Static JSON authored by design
│   ├── events.json
│   ├── resources.json
│   ├── ambience.json
│   └── theme.saturn.json
├── styles/
│   └── tailwind.css
└── main.tsx                   # Vite entry

tests/
├── unit/                      # engine/**, state/**, content-loader — Vitest
├── integration/               # store + persist wiring — Vitest + jsdom
├── a11y/                      # axe-core over rendered screens — Vitest + jsdom
└── e2e/                       # playwright: chromium + webkit projects
    ├── golden-provision-survive.spec.ts
    ├── golden-provision-perish.spec.ts
    └── golden-replay-from-seed.spec.ts

public/
├── icons/                     # PWA icons (192/512/maskable)
├── manifest.webmanifest
└── art/                       # Saturn-themed illustrations

package.json                   # scripts: dev, build, test, test:e2e, lint, typecheck
vite.config.ts                 # + vite-plugin-pwa
vitest.config.ts
playwright.config.ts           # projects: chromium, webkit
tsconfig.json                  # strict
tailwind.config.ts
.eslintrc.cjs
```

**Structure Decision**: **Single-project frontend** (Option 1). No backend or mobile shell is needed — the game is browser-native and offline-capable. Game rules live under `src/engine/` as pure functions to keep them testable without React, and UI state is a thin Zustand store that composes those rules. Content is separated from code so a designer can edit `src/content/*.json` without touching TypeScript, protected by a Zod schema check at load and in Vitest.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No violations. All five constitutional principles pass at initial and post-design checks.
