# Feature Specification: Saturn Trail — A Modern Oregon Trail on Saturn

**Feature Branch**: `001-saturn-oregon-trail`

**Created**: 2026-08-13

**Status**: Draft

**Input**: User description: "create a modern day oregon trail on saturn"

## Clarifications

### Session 2026-08-13

- Q: What varies across the three difficulty tiers (Cadet / Officer / Commander)? → A: Resource scarcity and event severity only — same map, same event pool, same route length. Higher tiers consume fuel/oxygen/food/hull faster and roll harsher outcomes on random events. Starting loadout, crew size, event pool, and event frequency are identical across tiers.
- Q: Crew size bounds (start / minimum-to-continue / maximum hires can bring the roster to)? → A: Start 4 (captain + 3 specialists), minimum-to-continue 1 (the captain), maximum 6.
- Q: How many concurrent saved runs, and what happens when the player picks "Start New" while an active run exists? → A: One active run at a time. Starting a new run shows a confirmation modal ("This will overwrite your current run — continue?"). Title screen shows "Continue" when a save exists, else "New Expedition."
- Q: Is the route between Titan and the Ring Habitation Station fixed linear, or does it branch? → A: Fixed spine of 5–6 required waystations in the same order every run, plus 1–2 optional side stops per run drawn from a detour pool (extra reward for extra fuel/time cost). The spine is not procedurally reordered; only which detours surface varies by seed.
- Q: Tone and target audience for death and grim events? → A: Deadpan / educational, all ages (E-rating equivalent). Death is frank, named, and matter-of-fact ("Chen died. Cause: hypoxia. Buried in the Ring."). No graphic imagery, profanity, or body horror. Family- and school-safe.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Complete a full expedition from Titan to the Ring Station (Priority: P1)

A single player takes on the role of an expedition captain leading a small crew of colonists across the Saturnian system in the near future. Starting at a launch outpost on Titan, they must reach the Ring Habitation Station by hopping between moons and orbital waystations. Along the way they manage fuel, oxygen, food, and crew morale; make branching decisions at each waystation (trade, repair, take on a passenger, chart a shortcut); and survive random events (dust storms on Iapetus, radiation flares, hull micro-punctures, ice-quakes on Enceladus). The expedition ends when the crew arrives at the destination, the captain dies, or the crew is lost.

**Why this priority**: This is the core "one full run" loop. Without an end-to-end journey the product is not a game — it is a menu. Delivering just this gives a playable, shippable MVP that captures the Oregon Trail spirit in a Saturnian setting.

**Independent Test**: A tester can launch a new expedition, play through at least one full journey (win or lose), and see a final summary screen with a score/epitaph. No other feature must exist for this to be testable and enjoyable.

**Acceptance Scenarios**:

1. **Given** a new player on the title screen, **When** they start an expedition and choose a captain name and a starting difficulty, **Then** the game loads the starting waystation on Titan with a full crew, a starting supply loadout, and a visible map of the route ahead.
2. **Given** an active expedition, **When** the player travels between two waystations, **Then** the game consumes fuel, oxygen, and food based on distance and crew size, advances the in-game clock, and has a defined probability of triggering a random event that requires a decision or resource cost.
3. **Given** the crew arrives at the Ring Habitation Station with the captain alive, **When** the final leg completes, **Then** the game shows a victory summary with time elapsed, crew survivors, credits earned, high-score entry, and an epitaph/log of the journey.
4. **Given** the captain dies or the last crew member is lost mid-journey, **When** the death event resolves, **Then** the game shows a "lost expedition" summary with the location, cause, and a shareable epitaph, and offers to start a new run.

---

### User Story 2 - Manage supplies and crew at a waystation (Priority: P2)

At each waystation the player can rest the crew, repair the ship, refuel, trade supplies with local operators using in-game credits, and hire or dismiss crew members. Prices vary by waystation (Titan is cheap for methane fuel; Enceladus is cheap for water/oxygen; Mimas is cheap for repairs; the Ring Station is expensive for everything). The player must balance spending against the remaining route.

**Why this priority**: This is the economic decision layer that makes the survival loop meaningful. Without it, User Story 1 collapses into "press Next until game ends." It's the second most valuable slice.

**Independent Test**: Given a save state at a waystation with known inventory and credits, the player can complete a buy, a sell, a repair, and a hire; inventory, credits, and ship condition update correctly and persist to the next travel leg.

**Acceptance Scenarios**:

1. **Given** the player is docked at a waystation, **When** they open the trade panel, **Then** the panel shows the local price list, the player's credits, and the current cargo/consumable inventory with clear stock limits per resource.
2. **Given** the player attempts to buy more than they can afford or store, **When** they confirm the purchase, **Then** the game blocks the transaction and shows a plain-language reason (insufficient credits, cargo full, ship damaged).
3. **Given** the player hires a new crew member, **When** they leave the waystation, **Then** the new crew member consumes supplies on the next leg and is visible on the crew roster.

---

### User Story 3 - Face and resolve random events during travel (Priority: P2)

Between waystations, the game presents narrative random events with 2–4 choices (e.g., "A distress signal from an unregistered lifter — investigate, ignore, or scan first?"). Each choice consumes or grants resources, changes crew morale or health, and may branch into a follow-up event. Events are drawn from a themed deck tuned to the current sector of the journey.

**Why this priority**: Events are what people remember about Oregon Trail. They are the story engine. But they only matter once the journey loop (P1) and economy (P2) exist to give choices weight.

**Independent Test**: With a scripted seed, run a travel leg and verify the same event fires, presents its choices, and each choice deterministically applies its documented outcome to the game state.

**Acceptance Scenarios**:

1. **Given** a travel leg triggers an event, **When** the event modal appears, **Then** it shows a short scenario description, 2–4 clearly labeled choices, and a hint of the resource stakes for each (icons only, no exact numbers).
2. **Given** a choice has a probabilistic outcome, **When** the player selects it, **Then** the game resolves the outcome, shows a one-sentence result, and applies the state change atomically (no partial updates).

---

### User Story 4 - Save, resume, and share expedition runs (Priority: P3)

The player can save their run and resume later on the same device. At the end of a run — win or loss — they can copy a short "run recap" (captain name, distance covered, cause of death, key events) to the clipboard for sharing.

**Why this priority**: Not required for a first playable slice, but drives retention and word-of-mouth once the loop is fun.

**Independent Test**: Save mid-run, close and reload the game, and verify the resumed state exactly matches the saved state (inventory, crew, position, elapsed time, event history). Trigger end-of-run recap and verify the clipboard payload is a well-formed text block under 500 characters.

**Acceptance Scenarios**:

1. **Given** an active run, **When** the player chooses "Save and quit," **Then** the game persists the run locally and returns to the title screen; on next launch, "Continue" restores the exact state.
2. **Given** the run ends, **When** the player selects "Copy recap," **Then** a formatted text summary is placed on the clipboard and a "Copied" confirmation appears.

---

### Edge Cases

- What happens when the player runs out of fuel mid-leg? The ship drifts; a rescue event fires with a costly or dangerous choice. If declined or failed, the run ends as "lost in transit."
- What happens when food or oxygen hits zero? Crew members begin taking health damage each in-game day; morale drops; probability of desertion or mutiny events increases.
- What happens if every crew member (including the captain) dies at once? Game shows a "total loss" summary and blocks resume.
- What happens if the player's browser or app is closed mid-event? On resume, the same event is re-presented; no double-resolution.
- What happens when a decision would push a resource below zero (e.g., a trade that would leave −10 oxygen)? The choice is disabled with a plain-language reason, not silently allowed and then clamped.
- What happens with an unreachable destination (all forward routes blocked by story flags)? The game guarantees at least one viable route from every waystation; automated content validation must enforce this.
- What happens on very slow devices or intermittent connectivity? Core gameplay must remain fully playable offline once the game has loaded.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST let a player start a new expedition by choosing a captain name, a difficulty level (at least three: Cadet, Officer, Commander), and a starting loadout preset. Difficulty MUST affect only resource-consumption rates and random-event outcome severity; the map, route length, starting loadout, crew size, and event pool MUST be identical across all tiers.
- **FR-002**: System MUST present a route map showing a fixed spine of 5–6 required waystations from Titan to the Ring Habitation Station (same order every run), plus 1–2 optional side-stop detours per run drawn from a detour pool. The current position MUST be clearly indicated; future spine waystations MUST be visible but their event contents remain hidden until reached; surfaced detours MUST be shown as optional forks with a preview of the reward-vs-cost tradeoff.
- **FR-003**: System MUST simulate resource consumption per travel leg based on distance, crew size, and difficulty, covering at minimum: fuel, oxygen, food/water (as a single "life support" stock), and ship hull integrity.
- **FR-004**: System MUST allow the player at each waystation to rest, repair, refuel, trade (buy/sell), and manage crew (hire/dismiss), with prices and availability that vary by waystation.
- **FR-005**: System MUST trigger random narrative events during travel legs from a themed event pool, with each event offering 2–4 player choices that visibly affect state.
- **FR-006**: System MUST track and display for the player: current resource levels, crew roster and per-crew health/morale, ship condition, credits, in-game date/elapsed time, and distance remaining.
- **FR-006a**: System MUST enforce crew-size bounds: every new expedition starts with exactly 4 crew (captain + 3 specialists); the run auto-ends when the roster falls to 0 (all lost) or when the captain specifically dies; hiring at waystations is blocked once the roster reaches 6.
- **FR-007**: System MUST end the run under any of these conditions and show a run-summary screen: player-captain death, entire crew lost, arrival at the Ring Habitation Station, or player-initiated abandonment.
- **FR-008**: System MUST persist an in-progress run locally so the player can quit and resume without loss of state; saving MUST be automatic at every waystation and manually available on demand. Only one active run is supported at a time; starting a new expedition while a save exists MUST show a confirmation modal that names the overwrite consequence before proceeding. The title screen MUST show "Continue" when a save exists and "New Expedition" otherwise.
- **FR-009**: System MUST provide a copy-to-clipboard "run recap" at end-of-run with expedition name, outcome, key stats, and a memorable one-line epitaph or headline.
- **FR-010**: System MUST record a local high-score / captain's log list showing the last N completed runs (win or loss) sorted by score, viewable from the title screen.
- **FR-011**: System MUST prevent transactions and choices that would result in negative resource levels, showing a plain-language reason instead of silently clamping.
- **FR-012**: System MUST support keyboard-only play for all in-game decisions (accessibility baseline); every actionable element MUST be reachable and confirmable without a mouse.
- **FR-013**: System MUST render legibly at common desktop and tablet viewport sizes; the specific tested resolutions MUST include at least one 1080p desktop and one tablet portrait size.
- **FR-014**: System MUST use a Saturn-authentic setting — waystations map to real Saturnian moons and features (Titan, Enceladus, Mimas, Iapetus, Rhea, Hyperion, the rings) — with hazards themed to each body's real characteristics (methane weather on Titan, cryovolcanism on Enceladus, radiation belts near the rings, etc.). Deviations from real astronomy are allowed for gameplay but MUST be listed in an in-game "Almanac" for educational value.
- **FR-015**: System MUST provide a first-run tutorial or interactive tooltip pass on the first travel leg that covers movement, resource meters, the event modal, and the waystation panel; the tutorial MUST be skippable and re-openable from a menu.
- **FR-016**: All event text and death/loss framing MUST use a deadpan, matter-of-fact tone appropriate for all ages (E-rating equivalent). Deaths MUST be named and specific (e.g., "Chen died. Cause: hypoxia.") but MUST NOT include graphic imagery, profanity, or body horror. Content MUST be safe for classroom and family use.

### Key Entities *(include if feature involves data)*

- **Expedition Run**: A single playthrough. Attributes include captain name, difficulty, starting loadout, seed, current position, elapsed in-game time, credits, resource stocks, event history, and final outcome. Relationship: has many Crew Members, has one active Ship, has a route through Waystations.
- **Crew Member**: A named party member. Attributes: name, role (pilot, engineer, medic, botanist, etc.), health, morale, and flavor backstory. Can be alive, injured, sick, or lost. Related to the Expedition Run and to Events they participated in.
- **Ship**: The vessel making the journey. Attributes: hull condition, cargo capacity, fuel tank size, life-support capacity, and named class (chosen from a small preset list).
- **Waystation**: A stopover node. Attributes: name, Saturnian body reference, biome/hazard theme, local price list, available services (repair, refuel, resupply, hire), and outgoing routes.
- **Route Leg**: A traversal between two Waystations. Attributes: distance, base hazard level, event pool tag, and resource-cost formula.
- **Event**: A narrative encounter drawn during a Route Leg. Attributes: title, description, 2–4 Choices (each with outcome effects), event pool tag, and one-shot vs. repeatable flag.
- **Run Recap**: The end-of-run artifact. Attributes: outcome, distance covered, crew survivors, notable events, score, epitaph text, and shareable text payload.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new player can go from the title screen to their first travel leg in under 90 seconds without reading external documentation.
- **SC-002**: A complete first-time playthrough (win or loss) takes 20–40 minutes on Cadet difficulty in playtesting with at least 5 testers, with 80% of testers finishing without abandoning.
- **SC-003**: At least 60% of playtesters describe the experience as "distinctly Oregon Trail–like" and at least 60% describe the setting as "recognizably Saturn" in a post-play short survey.
- **SC-004**: Fewer than 5% of completed runs end due to a bug, softlock, or unclear game state, measured across at least 100 telemetry-free playtest runs (self-reported).
- **SC-005**: The game remains fully playable offline after the initial load; a device with connectivity disabled can complete a full run start-to-finish.
- **SC-006**: End-of-run recap is copied to the clipboard successfully on the first attempt for 95% of runs in the top two supported browsers.
- **SC-007**: Median first-travel-leg decision time in playtesting is under 30 seconds, indicating the resource meters and event modal are legible without training.
- **SC-008**: The Almanac (astronomy notes for each Saturnian body used as a waystation) is opened at least once by 40% of playtesters, indicating the educational hook works.

## Assumptions

- The product is a **single-player narrative resource-management game** rendered in a **web browser** as the primary platform, with future mobile/desktop wrappers out of scope for v1.
- The "modern day" framing means the tone and UI feel present-era (2020s aesthetic, plain English, familiar UI patterns), even though the setting is a near-future Saturnian expedition. It is **not** a strict simulation of a real crewed Saturn mission.
- Content is **English-only** for v1; localization is deferred.
- The game is **offline-first after initial load**; no accounts, no server-side saves, no in-app purchases, no telemetry in v1. All state is stored on the local device.
- The visual style is **2D with illustrated or pixel-style art**, in the spirit of Oregon Trail's low-fidelity look. Full 3D is out of scope.
- The route is a **fixed spine with optional detours**: the spine of required waystations is the same order every run; a small pool of side-stops surfaces 1–2 optional detours per run, chosen by seed.
- "Saturn" is interpreted as the **Saturnian system** (moons + rings + orbital constructs), not surface travel on Saturn itself, which is physically implausible.
- Existing browser APIs (Local Storage / IndexedDB, Clipboard API) are available in the target browsers and sufficient for save and recap-copy features; no additional platform capabilities are required.
- A short list of the last N completed runs is sufficient for the "captain's log" high-score board; a global leaderboard is out of scope.
- All astronomy/scientific liberties taken for gameplay purposes are documented in the in-game Almanac; scientific accuracy is a **flavor goal**, not a correctness requirement.
- **Content tone is deadpan and all-ages** (E-rating equivalent); the game targets a family and classroom audience alongside general players.
