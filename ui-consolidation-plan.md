# UI folder consolidation plan

## Problem

The `ui/` tree is over-modularized. Current state:

- **48 JS/mjs files** + **8 CSS files** across **11 folders**
- ~7,000 lines of JS + ~3,750 lines of CSS
- Many files are tiny helpers (5 files <25 lines each)
- The `render/phase-customizations/` sub-sub-folder has 8 files that are all one cohesive concern
- Cross-folder `setXxxDeps({...})` wiring in `app.js` alone spans ~20 imports

## Current inventory (JS)

| Folder | Files | Lines |
|---|---|---|
| `render/` | 14 | 1,743 |
| `composition/` | 7 | 1,228 |
| `phase/` | 7 | 898 |
| `modals/` | 4 | 557 |
| `setup/` | 3 | 554 |
| `catalog/` | 1 | 481 |
| `net/` | 2 | 242 |
| `util/` | 5 | 108 |
| `state/` | 2 | 79 |
| (root) | 3 | 490 (`app.js` 246 + `client.mjs` 91 + `markdown.mjs` 153) |

## Recommendation: consolidate to **11 top-level modules**

Everything moves to `ui/` root. No sub-folders. Target ~500 lines, tolerating a couple of ~700–900 line files where the code is one cohesive concern.

| # | New file | Merges from | Est. lines |
|---|---|---|---|
| 1 | `app.js` | `app.js` + `render/log.js` + `render/cwd.js` | ~275 |
| 2 | `client.js` | `client.mjs` + `net/dispatch.js` + `net/messages.js` | ~333 |
| 3 | `state.js` | `state/store.js` + `state/constants.js` + `util/*` (filters, phase-selectors, strings, paths, urls) | ~187 |
| 4 | `setup.js` | `setup/state.js` + `setup/actions.js` + `setup/render.js` | ~554 |
| 5 | `catalog.js` | `catalog/tiles.js` | 481 |
| 6 | `composition.js` | `composition/{tiles,meta,summary,sidebars,stack-layer,helpers}.js` | ~638 |
| 7 | `composition-artifacts.js` | `composition/artifact-rows.js` | 590 |
| 8 | `phase-card.js` | `render/{phase-card,graph-phase-card,stepper,env}.js` | ~795 |
| 9 | `phase-contributors.js` | `render/phase-customizations/*` (all 8) | ~817 |
| 10 | `phase-runtime.js` | `phase/*` (extension-card + resolver + pipeline + inference + run-lock + draft-cache + clarifications) | ~898 |
| 11 | `modals.js` | `modals/*` + `markdown.mjs` | ~710 |

**Result:** 11 files, avg 570 lines, max 898.

## Why these groupings

- **`state.js`** — the `util/` folder is really "state selectors and string/path helpers." Merging with `state/*` puts all pure functions in one place.
- **`client.js`** — SSE transport + HTTP dispatch + inbound-message handler = one story: "how the UI talks to the canvas server."
- **`setup.js`** — the three files already form a tight cycle. Merging removes circular-import risk.
- **`composition.js` + `composition-artifacts.js`** — 2 files because `artifact-rows.js` is a self-contained 590-line renderer for the "who contributed what" grid.
- **`phase-card.js`** — everything the phase card shell needs: header, graph body, stepper strip, environment sub-card.
- **`phase-contributors.js`** — the entire `phase-customizations/` sub-folder is one concern: rendering the "Active artifacts" grid rows.
- **`phase-runtime.js`** — non-render phase concerns: resolver, dispatch, run-locks, draft cache, inference, extension-card action wiring.
- **`modals.js`** — 4 small modal files + `markdown.mjs` (only the artifact viewer uses markdown rendering).

## What we're NOT touching

- **`styles/`** — 8 CSS files, well-scoped. Leave for a separate pass if desired.
- **`index.html`** — no change.
- Sibling non-UI folders (`prompts/`, `server/`, `canvas-runtime/`, etc.).

## Todos

- **t0-baseline-smoke** — Capture pre-refactor Playwright baseline (screenshots + console warnings) before touching code
- **t1-state** — Merge `state/*` + `util/*` → `state.js`
- **t2-client** — Merge `client.mjs` + `net/*` → `client.js`
- **t3-app** — Absorb `render/log.js` + `render/cwd.js` into `app.js`
- **t4-setup** — Merge `setup/*` → `setup.js`
- **t5-catalog** — Move `catalog/tiles.js` → `catalog.js`
- **t6-composition** — Merge composition (6 files) → `composition.js`; move `artifact-rows.js` → `composition-artifacts.js`
- **t7-phase-card** — Merge `render/{phase-card,graph-phase-card,stepper,env}.js` → `phase-card.js`
- **t8-phase-contributors** — Merge `render/phase-customizations/*` → `phase-contributors.js`
- **t9-phase-runtime** — Merge `phase/*` → `phase-runtime.js`
- **t10-modals** — Merge `modals/*` + `markdown.mjs` → `modals.js`
- **t11-imports-sweep** — Update all import paths, delete empty folders
- **t12-tests-smoke** — Run 213 tests + full Playwright regression walk (see checklist below)

## Regression verification (mandatory before completion)

Every module merge (t1–t10) is followed by a **cheap re-check** at the module boundary:
- After each merge: reload extensions, refresh the open canvas, confirm no console errors and the affected UI region still paints.
- After **t11-imports-sweep**: full test suite + full Playwright walk (see t12).

**t12 checklist** — Playwright must exercise:
1. Fresh canvas instance boot — no console errors
2. **Setup tab**: environment card renders, all substeps clickable, stepper reflects state
3. Switch to **Phases tab**: pipeline stepper strip renders, click each of the 9 phases
4. For each phase card: header + active-artifacts grid + freeform textarea + Back/View artifact/Rerun/Continue buttons all render
5. Click **View artifact** on a done phase → artifact viewer opens, markdown renders, Clarify pill flow reachable (parseClarifications wired)
6. **Available commands** region renders below phase card with all core + extension tiles
7. **Composition tab**: composition tiles, artifact-rows grid, sidebars, meta panel all render
8. **Catalog tab**: presets/extensions/bundles subtabs all render + filter inputs work
9. Open **Wizard modal** (Q&A UI) → closes cleanly
10. Console error count = 0 (favicon 404 OK) across all steps

## Considerations

- **No functional change** — pure file-consolidation refactor. Same exports, same wiring, just fewer files.
- **`setXxxDeps` pattern** — most files use this to receive shared deps at boot. After consolidation, files that land in the same module can share via module scope; but for the first pass, keep the setter pattern (mechanical merge) and only inline setters where both sides are in the same new file. A follow-up pass can prune redundant setters.
- **Test coverage** — 213 tests pass now. Tests cover server + prompts, not `ui/`; should stay green with zero test edits.
- **Diff size** — ~48 files touched (deletes + creates). Bulk is content moves, not logic edits.
- **One PR** — everything is atomic (imports must update together). Otherwise the tree is broken mid-way.

## Execution order

The 10 merges (t1–t10) are mostly independent — each new file is self-contained internally, only cross-file imports change. Suggested order:

1. **Leaves first**: `state.js` (t1), `client.js` (t2), `modals.js` (t10), `catalog.js` (t5), `setup.js` (t4)
2. **Middle layer**: `composition.js` + `composition-artifacts.js` (t6), `phase-runtime.js` (t9), `phase-contributors.js` (t8)
3. **Top layer**: `phase-card.js` (t7), `app.js` (t3)
4. **Sweep**: t11 (imports + folder cleanup), t12 (verify)
