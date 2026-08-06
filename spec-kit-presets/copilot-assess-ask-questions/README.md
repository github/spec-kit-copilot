# Copilot Assess Clarifying Questions Preset

A [Spec Kit](https://github.com/github/spec-kit) preset that layers an interactive
**`#askQuestions`-style clarifying round** onto every stage of the
[assess extension](https://github.com/github/spec-kit/tree/main/extensions/assess).

In VS Code, GitHub Copilot can pause and ask you a focused batch of clarifying
questions *before* it does the work. This preset brings that behavior to the assess
pipeline by driving it through Copilot's interactive **`ask_user`** question tool:
before each stage writes its artifact, the agent asks you targeted multiple-choice
questions and folds your answers into the result — instead of guessing.

## Built for GitHub Copilot

This preset is **specific to GitHub Copilot — the App, the CLI, and VS Code** — where the
interactive `ask_user` question tool is always available. It has **no plain-text
fallback**: questions are always presented through the tool as multiple-choice prompts.
It is not meant for agents that lack an interactive question capability.

## When to Use This Preset

Use it when you want the assess pipeline to be **conversational and interrogative** —
when you'd rather answer a few sharp multiple-choice questions per stage than review a
draft full of guesses and clarification markers.

## What It Does

This preset uses the `wrap` composition strategy to place a **Clarifying Questions
Protocol** around each of the five assess commands. It wraps the core stage so the agent
sees a short **gate at the top** — *"don't write the artifact until you've done the
clarifying round"* — reads the unchanged stage logic in the middle, and finds the **full
`ask_user` protocol at the bottom**. The top primes the pause; the bottom (read last)
carries the detail and the recency that makes the agent actually stop and ask.

| Command | Questions focus on… |
|---------|---------------------|
| `speckit.assess.intake` | The idea's origin & trigger, its type, the slug, and the boundary of what's proposed (capture only — never evaluates) |
| `speckit.assess.research` | Which evidence lenses matter, sources you can point to, verified-vs-assumption claims, and known counter-evidence |
| `speckit.assess.define` | Primary users & stakeholders, concrete success metrics, non-goals, and the cost of inaction |
| `speckit.assess.shape` | Appetite/budget, hard constraints, whether "do nothing / buy" is on the table, and the trade-off that matters most |
| `speckit.assess.decide` | Relative weight of criteria & any must-pass bar, risk tolerance, strategic context, and which stage to revisit |

## The Protocol

Each command is wrapped with the same rules:

- **Always ask through `ask_user`.** Every question is put to the user with Copilot's
  `ask_user` tool as an interactive multiple-choice prompt — never hand-formatted as
  chat text.
- **One question per call, up front.** The agent asks up to 3–5 highest-impact questions
  for the stage, one at a time, before writing the artifact, and waits for each answer.
- **Concrete choices.** Each question carries 2–4 context-specific options with the
  likely one listed first and marked `(Recommended)`. No "Other" catch-all — Copilot
  adds a free-text answer automatically.
- **Answers are authoritative.** They're folded straight into the artifact. If you
  genuinely don't know, that gap becomes a `[NEEDS CLARIFICATION: …]` marker. No
  guardrail is relaxed — path safety, slug rules, the URL Trust Policy, and output
  formats all still apply.

## Prerequisites

- GitHub Copilot (App, CLI, or VS Code) — the environment providing the `ask_user` tool
- [Spec Kit](https://github.com/github/spec-kit) >= 0.9.0
- [assess extension](https://github.com/github/spec-kit/tree/main/extensions/assess) installed

```bash
specify extension add assess
```

## Installation

From the catalog:

```bash
specify preset catalog add https://raw.githubusercontent.com/mnriem/spec-kit-copilot/main/spec-kit-presets/catalog.json
specify preset add copilot-assess-ask-questions
```

Or from a local clone:

```bash
specify preset add --dev ./copilot-assess-ask-questions
```

## Usage

The workflow is identical to the standard assess pipeline — same five commands, same
order. The preset only changes *how* each command gathers its input:

```bash
/speckit.assess.intake "Let users work offline and sync when they reconnect"
# → agent asks (via ask_user) about origin, type, slug, boundary; you pick answers;
#   intake.md is written

/speckit.assess.research   slug=offline-mode
/speckit.assess.define     slug=offline-mode
/speckit.assess.shape      slug=offline-mode
/speckit.assess.decide     slug=offline-mode
# → on a "go" verdict, hand decision.md to /speckit.specify
```

If a stage already has everything it needs, the agent says so and proceeds without
asking.

## License

MIT
