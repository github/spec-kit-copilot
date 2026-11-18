# Wizard → Designer user-flow test plan

**Status:** Local implementation validated after integrating newer `main` changes. This document defines coverage, while [the implementation plan](wizard-designer-implementation-plan.md) records the applied existing-test dispositions and results. Published-archive readiness is a separate release-only check, not implied by passing local tests.

## Test-data boundary: avoid brittle catalog assertions

Live Default, Community, and other catalog inventories can change independently of this repository. In tests backed by those catalogs, **never assert the complete list, exact item count, order, descriptive copy, current version, or exact membership of an uncontrolled bundle**. Do not assume a new result is absent just because it was absent when a test was written. Assert user-observable invariants instead: the appropriate tab and source badge render, search narrows the currently loaded results, install transitions the selected item, confirmation appears when required, and errors remain actionable. Compare against the catalog snapshot returned for that test run, not hard-coded remote data.

**Controlled exceptions:** Core/built-in presets and extensions whose fixture or published package is under this team's control can be asserted by stable ID and the behavior they provide. Pirate Speak is a team-contributed **Community** preset: when using a controlled snapshot or a verified team-owned package, use catalog ID `pirate` and installed manifest ID `pirate-full-preset` as a provenance example. Do not hard-code its display copy, version, position, or assume it is present in every live Community catalog. Resolve version, source, locator, and bundle membership from the snapshot. Required browser tests must use a controlled local fixture when a live entry is absent; they must not silently skip. Treat all other community entries and bundles as opaque.

**Version assertions:** Never bake the current CLI, plugin, preset, extension, catalog, or archive release version into a user-flow test. Read a fixture's version from its manifest and a selected catalog entry's version from the response; assert their relationship (the selected release is passed through, the resolved install matches its manifest, a displayed update changes the previous value). Prefer computing accepted/rejected samples from the production minimum-version rule and checking the behavior on either side. A literal version is justified only in a focused regression that explicitly protects a documented, stable compatibility floor or parser boundary; state why it is pinned and keep that assertion out of broad browser journeys. For hosted readiness, resolve and inspect the archive URL/version actually selected by the published catalog rather than a fixed release. No snapshot approval of volatile version labels.

Use three data modes: (1) deterministic browser tests using a local server, temporary checkout, seeded snapshot, and fake Copilot session; (2) a small read-only live-catalog smoke check asserting broad capabilities, not inventory; (3) separate published-archive readiness verification when release readiness is requested. Worktree-source success is not proof that the hosted Canvas Design archive selected by the catalog is compatible.

## Package fixture workstream — create before dependent tests

| Package | Work to do | Exact contributions / required behavior | Cases |
|---|---|---|---|
| `copilot-wizard-layer-test` | Test-only Spec Kit preset in `tests/fixtures/test-presets/`, with valid `preset.yml` and real command files; outside the releaseable preset directory and catalog. | `provides.templates` contains a `type: command` `replace` contribution to `speckit.plan` and a `prepend` contribution to `speckit.specify`, with actual referenced files and distinct source markers. The replace exposes the winning layer; the prepend makes Stage 2 inference necessary. Install/enable, disable, reprioritize and remove in temporary checkouts. | W7–W15 |
| `extension-wizard-flow-test` | **Create** a test-only Spec Kit extension, with valid `extension.yml`, README, real commands and locally installed skills; do not publish it or add it to the catalog. | The runnable command `speckit.extension-wizard-flow-test.review` follows Specify's required extension namespace. README places it between Plan and Tasks and names primary/additional Markdown outputs. A second command is registered as an `after_plan` hook in the installed hook registry. The hook must be visible in Composition and on Plan but must not be a runnable pipeline chip. Its skill participates in current-fingerprint output inference through `/api/state`. | W7–W21 |
| Existing `copilot-sub-agents` | Reuse with layer preset. | Existing `prepend` contributions supply a second real layer for precedence and Stage 2. Build additional same-target conflicts in a temporary checkout rather than checking in many near-identical presets. | W9–W12 |
| Existing `extension-canvas-design` | Reuse its **local source** for ordinary PR journeys; independently check the published archive for hosted readiness. | `load-page`, `generate`, required Designer tabs, controls, workflow/phase adapters, and generated host assets. | D1–D21, G1–G3 |
| Existing `copilot-canvas-design-test`, `copilot-billing-canvas-test`, `copilot-risk-matrix-test`, `copilot-logo-gallery-test`, `copilot-minimal-essentials-test`, `copilot-generated-page-test`, `copilot-canvas-values-test` | Reuse instead of creating duplicative Designer presets. | Respectively: added page/stock fields; billing field + generated text; paired typed control; image and generated slot; replaced Essentials; generated-only page; typed values/computed provider. Each declares actual templates and load-page contributions. | D10–D21, G1–G3 |
| Pirate Speak (`pirate` catalog ID / `pirate-full-preset` installed ID) | Use only from a controlled catalog snapshot or verified team-owned package; do **not** make a browser test rely on its appearance in the live catalog. | Community confirmation and catalog-ID-versus-installed-ID provenance through Designer handoff. Fetch version and locator from the snapshot; no fixed copy/count assertions. | W8, D2, D8 |
| Bundle membership | Seed a controlled response **only where membership behavior is the subject of the test**; no new publishable bundle yet. | Include a controlled package, an overlapping direct selection, and an unrelated choice; compare selected members to that response. Do not assert the membership or size of a live community bundle. | W8, D2 |

Fixture acceptance: manifests parse; every declared file exists; package IDs, command IDs, and installed versions match the source manifests without duplicating manifest versions in test code; each test-only preset has Playwright `specify preset add --dev` coverage from `tests/fixtures/test-presets/` against an isolated temporary checkout. Prefer a behavioral journey through its last affected surface over an installation-only case, and remove the latter only after the journey replaces its assertions. The [test-preset E2E README](../../tests/e2e/README.md) records the journey and remaining fixture gaps. Real current fingerprints come from the snapshot rather than hand-transcribed constants. Negative cases mutate a temporary copy, not checked-in packages. Clean up per-test checkouts, caches, timers, and local servers. Keep fixture manifests out of production catalogs and release packaging.

## Testing levels and harness

**P0 browser:** one scenario crossing UI + real loopback server + SSE/HTTP or Wizard→Designer boundaries, with a controlled fake agent. **P1 browser:** additional materially distinct user interaction or failure recovery. **Lower-level:** unit/component/server integration for combinatorial inputs, rejection rules, precedence permutations and path/identity checks. Reuse assertions within a single journey rather than duplicating entire Playwright scenarios. Use role/label locators and auto-retrying assertions; no fixed sleeps or live agent timing. The fake session records prompts and waits. Deliver agent results via real canvas actions and `/api/artifact-targets`, not by replacing the final DOM. Browser tests against controlled packages may assert *their* stable ID and fixture-owned output path; tests against uncontrolled catalogs may not.

### W1. Open Wizard and recover from boot problems
| Case | Level | Action | Assert |
|---|---|---|---|
| W1 | P0 browser | Open a ready local Wizard. | Boot overlay clears, Setup/Phases navigation appears, connection becomes live, initial state renders. |
| W2 | P1 browser | Hold a dependency; fail it and retry. | Progress and actionable error are shown; retry reaches ready UI. |
| W3 | Lower-level | Vary CLI, dependency, and provider failure responses. | Appropriate diagnostic/recovery, never success-shaped failure. |

### W2. Complete Setup → Environment
| Case | Level | Action | Assert |
|---|---|---|---|
| W4 | P0 browser | Start with a missing prerequisite, then complete its setup action. | Relevant row advances and the next step becomes available. |
| W5 | P1 browser | Change a probe result after opening; Recheck/reload. | UI adopts current result without reopening; failure remains retryable. |
| W6 | Lower-level | Incompatible/missing CLI, failed install, failed skills reload. | Correct calls, subprocess options, diagnostics and state. |

### W3. Discover and install catalog items
| Case | Level | Action | Assert |
|---|---|---|---|
| W7 | P1 browser | Browse Presets/Extensions/Bundles, search, and filter added. | Filters operate on *currently loaded* results and selected state survives navigation; **no total counts, global names or ordering**. |
| W8 | P0 browser | Select and remove a **controlled** built-in/fixture item; optionally choose Pirate Speak from a controlled snapshot. | Selected item's status changes; composition reflects it; Community confirmation occurs when applicable. Compare Pirate's installed ID to the snapshot, not fixed text/version. |
| W9 | P1 browser | Select a controlled bundle, cancel/confirm warning, remove bundle. | Actual response members are selected; direct overlapping choice survives; no asserted membership of live bundles. |
| W10 | Lower-level | Install error, selection race, source mismatch. | No invented installed state; retry/error remains available. |

### W4. Inspect Composition stacks
| Case | Level | Action | Assert |
|---|---|---|---|
| W11 | P1 browser | Install layer preset plus flow extension; open Commands/Templates/Scripts/Hooks and Layers. | Fixture-owned entries show the declared active contributor, strategy and hook. Assert **only fixture-owned IDs**, not total rows or global inventory. |
| W12 | Lower-level | Change priority/enablement and uninstall a layer. | Winning source, source attribution, counts computed from input snapshot, and removed layers are correct. |

### W5. Refresh Composition and outputs
| Case | Level | Action | Assert |
|---|---|---|---|
| W13 | P0 browser | Click Refresh with layer preset/flow extension; hold fake agent. | Button is busy; Composition says Refreshing; Phases banner indicates refresh; phase cards remain usable. |
| W14 | Same P0 journey | Submit accepted inferred pipeline, then current-fingerprint output evidence. | Fixture command appears in suggested stepper after accepted pipeline; existing assembled stacks remain; refresh stays pending until outputs arrive; owned output paths appear; busy clears and brief completion appears. |
| W15 | Same P0 journey + lower-level variants | Pause an old pipeline reply during real temporary-file preparation; request a replacement through HTTP, then deliver delayed pipeline/artifact replies and current replies. Separately exercise fast-only and failure recovery. | Original run IDs reject superseded writes and delayed replies without changing current ordering, cache, pending work or timers, including same/old fingerprints. Lower-level covers state reads/write queues, prepared cache/state swaps, failed replacement assembly, duplicate replies during postcommit scans, stale snapshots, and commit cleanup/failure. Final swap/publication cannot yield to replacement. Current and refresh-less replies complete normally; fast path needs no agent and retries remain available. |

### W6. Shape and navigate pipeline
| Case | Level | Action | Assert |
|---|---|---|---|
| W16 | P0 browser | Add flow command, remove, reorder where available, clear/reset. | Stepper and active card reflect edits; reset restores inferred default; no assertion about unrelated catalog commands. |
| W17 | P1 browser | Navigate during composition refresh; receive a new inferred order. | Current selection/user edits are preserved; background update does not hijack navigation. |
| W18 | Lower-level | Hook target, unknown command, duplicate and empty cases. | Pipeline rejects or handles each per contract; hook never user-runnable. |

### W7. Run and rerun a phase
| Case | Level | Action | Assert |
|---|---|---|---|
| W19 | P0 browser | Run controlled core or flow command; hold fake turn; deliver status and execution report. | Prompt is queued once; pending/running feedback and later status/contributors update through real actions. |
| W20 | P1 browser | Fail and retry or leave agent turn unanswered. | Run/Rerun remains reachable; error/recovery visible. |
| W21 | Lower-level | Stale run IDs, out-of-order callbacks, overlapping runs. | Only accepted run controls current status/report. |

### W8. Open phase outputs
| Case | Level | Action | Assert |
|---|---|---|---|
| W22 | P0 browser | Create a **fixture-owned** declared output and open View artifact. | Verified link opens actual content; Back returns to Wizard context. |
| W23 | P1 browser | Declare an output without creating it. | Existing-folder affordance or not-ready message, not a fabricated file link. |
| W24 | Lower-level | Multiple outputs and explicit no-file response. | Correct default, distinct candidates and no stale link. |

### D1. Select Designer packages
| Case | Level | Action | Assert |
|---|---|---|---|
| D1 | P0 browser | Click Generate canvas and navigate selection dialog. | Required **controlled** Canvas Design selection is included; eligible items render and keyboard navigation works; do not assert catalog totals. |
| D2 | P1 browser | Choose controlled bundle/Community Pirate selection; cancel and accept. | Warning/focus behavior and selected controlled ID; membership compared to returned bundle response, not hard-coded live members. |
| D3 | P1 browser | Fail then retry provider activation. | Selections retained on failure; successful queue closes and resets dialog. |

### D2. Add local sources
| Case | Level | Action | Assert |
|---|---|---|---|
| D4 | P1 browser | Add a fixture preset or local Canvas Design with same ID as hosted selection. | Manifest kind and checked selection shown; handoff uses approved local locator for collision, preserving unrelated hosted selections. |
| D5 | P1 browser | Invalid path, pending add, failed launch. | Inline error, blocked conflicting controls while pending, retained choices on failed launch. |
| D6 | Lower-level | Ambiguous manifest/ID, priority/source drift. | Pre-dispatch rejection without guessing provenance. |

### D3. Wizard handoff and child readiness
| Case | Level | Action | Assert |
|---|---|---|---|
| D7 | P0 browser integration | Queue with controlled raw Specify inventory; capture handoff and open Designer shell. | Selected phases, package identity/priority and output defaults survive intact. |
| D8 | Lower-level; one P1 visible failure | Use controlled Pirate catalog ID vs installed manifest ID and missing/unreproducible packages. | Correct locator, explicit repair guidance, no false-ready empty shell. |
| D9 | Release-only | Test archive selected by **published** catalog on default hosted path. | Hosted compatibility proven separately; do not version-bump or publish on each development edit. |

### D4. Resolve and navigate Designer pages
| Case | Level | Action | Assert |
|---|---|---|---|
| D10 | P0 browser | Resolve Canvas Design plus controlled contribution preset; switch pages by mouse/keyboard. | Required pages and fixture-contributed page/field appear; draft retained. Do not assert total pages if another installed package can contribute. |
| D11 | P1 browser | Corrupt a temporary copy of optional page. | Explicit error tab; healthy pages editable; Generate unavailable. |
| D12 | Lower-level | Missing Essentials/schema and malformed registrations. | Open fails with repair guidance instead of false readiness. |

### D5. Edit Essentials and contributed fields
| Case | Level | Action | Assert |
|---|---|---|---|
| D13 | P0 browser | Enter ID/title and built-in optional fields. | Required validation/focus, draft retention and submitted enabled values. |
| D14 | P1 browser | Use Billing or risk-matrix preset field. | Actual registered adapter mounts; value survives Save and appears in generated output. |
| D15 | Lower-level | Invalid required text and incompatible adapter variants. | Save may retain structurally valid incomplete draft; Generate rejects invalid/unready control visibly. |

### D6. Appearance, uploads and custom assets
| Case | Level | Action | Assert |
|---|---|---|---|
| D16 | P1 browser | Edit built-in light/dark palette. | Valid colors persist/generated theme reflects them; invalid hex blocks Generate. |
| D17 | P0 browser | Upload/replace/remove built-in logo or Logo Gallery fixture asset. | Preview and generated slot reflect accepted value; rejection explains problem and is clearable. |
| D18 | P1 browser + lower-level | Hold/fail upload; vary byte/type/slot validation. | Pending upload blocks Save/Generate/tab departure; lower-level rejects invalid bytes or duplicate/missing slot. |

### D7. Configure Outputs
| Case | Level | Action | Assert |
|---|---|---|---|
| D19 | P0 browser | Add fixture-relative Markdown link; choose View default; remove it. | Inferred links read-only; addition persists; removal restores inferred default. |
| D20 | P1 browser | Constitution and no-output phase. | Constitution immutable; empty phase explains absent View action. |
| D21 | Lower-level | Unsafe/stale output edits. | Rejected without changing confirmed outputs. |

### D8. Save, reopen, Generate
| Case | Level | Action | Assert |
|---|---|---|---|
| D22 | P0 browser | Save an incomplete but structurally valid draft; reopen same handoff. | Fields/outputs restore; unchanged Save disabled; no template mutation. |
| D23 | P1 browser | Stale revision conflict. | Visible error; in-memory edits preserved. |
| D24 | P0 browser | Complete requirements and Generate. | Single queued request freezes values, outputs and revisions; duplicate submission prevented. |
| D25 | P1 browser | Computed-provider approval or version drift using controlled Values fixture. | Source/hash approval; cancel sends nothing; approved request frozen; warning is visible without fake failure. |
| D26 | Lower-level | Changed registered bytes or installed inventory. | Stale/malformed generation rejected or requires reopening. |

### G1. Generated canvas outcome
| Case | Level | Action | Assert |
|---|---|---|---|
| G1 | P0 browser integration | Materialize a request built with controlled Canvas Design and a contribution preset. | Workflow page loads and *fixture-owned* title, field, phase order, output links and View default match confirmed Designer values. |
| G2 | P1 browser | Create/select workflow, run phase through fake session, refresh. | Workflow identity/draft and accepted result survive; navigation and viewer work. |
| G3 | Lower-level plus one representative browser path | Swap vertical-phase-control or generated-page/values preset. | Declared adapter, asset and typed-value placements work; no full cross-product of packages. |

## Follow-on existing-test review

Map every present Playwright and Node test to these IDs. For each, record: **keep / consolidate / move lower / remove**, controlled-versus-live data, unique regression protected, failure history, flakiness source, runtime cost, and whether another test covers the same boundary. A security, provenance or data-loss guard is not dispensable merely because its input is unusual. Do not delete or rewrite tests before this mapping and user review.
