<!-- speckit:plan v1 -->
# Contract — Content JSON Schema (Zod)

Content files live in `src/content/*.json` and are validated at load time. A malformed file fails the app open — the title screen never renders on unreadable content, so authors get immediate feedback.

## Files

| File | Root type | Purpose |
|---|---|---|
| `events.json` | `EventCard[]` | Random events drawn each turn. |
| `resources.json` | `ResourceCard[]` | Finds (food/water/parts caches). |
| `ambience.json` | `AmbienceCard[]` | Non-mechanical flavor cards. |
| `theme.saturn.json` | `Theme` | Palette + copy strings for the Saturn skin. |

## Zod schema (source of truth)

```ts
import { z } from "zod";

const Kind = z.enum(["weather", "breakdown", "encounter", "find", "ambience"]);
const CrewRole = z.enum(["captain", "engineer", "medic", "scout", "cook", "greenhorn"]);

const EffectDelta = z.object({
  op: z.literal("delta"),
  target: z.enum([
    "supplies.food", "supplies.water", "supplies.parts", "supplies.credits",
    "caravan.wagonCondition", "caravan.morale",
  ]),
  amount: z.number().int(),   // negative = cost
});

const EffectCrewStatus = z.object({
  op: z.literal("crewStatus"),
  target: z.union([z.literal("random-alive"), CrewRole]),
  status: z.enum(["healthy", "hungry", "ill", "injured", "lost"]),
  healthDelta: z.number().int().optional(),
});

const EffectLog = z.object({
  op: z.literal("log"),
  kind: z.enum(["event", "resource", "milestone", "system"]),
  text: z.string().min(1).max(280),
});

const Effect = z.discriminatedUnion("op", [EffectDelta, EffectCrewStatus, EffectLog]);

const Choice = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(60),
  effects: z.array(Effect).min(1),
});

const Flavor = z.object({
  title: z.string().min(1).max(80),
  body:  z.string().min(1).max(400),
});

export const EventCard = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  kind: Kind,
  weight: z.number().min(0).max(1),
  minTurn: z.number().int().min(0).max(19),
  maxTurn: z.number().int().min(0).max(19),
  choices: z.array(Choice).min(1).max(3),
  flavor: z.array(Flavor).min(1).max(4),
}).refine(c => c.minTurn <= c.maxTurn, { message: "minTurn must be <= maxTurn" });

export const ResourceCard = EventCard;   // same shape, kind = "find"
export const AmbienceCard = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  kind: z.literal("ambience"),
  weight: z.number().min(0).max(1),
  flavor: z.array(Flavor).min(1).max(4),
});

export const Theme = z.object({
  paletteId: z.literal("saturn"),
  strings: z.record(z.string(), z.string()),
});
```

## Load contract

```ts
loadContent(): Promise<
  | { ok: true; content: LoadedContent }
  | { ok: false; error: ContentLoadError }
>;
```

- Reads the four JSON files in parallel (`fetch`).
- Validates each against its Zod schema.
- Failure returns `error` with a `filePath`, `zodIssues`, and human-readable message.

## Test contract (unit)

- Every checked-in JSON file parses cleanly (Vitest iterates `src/content/`).
- Golden events sample assertion: replacing any required field produces the expected Zod issue path.
- Snapshot test for the loaded content's stable id sort.
