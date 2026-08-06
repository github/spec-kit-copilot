> **copilot-assess-ask-questions preset — GitHub Copilot (App, CLI, VS Code).** Gate: **do not write `intake.md` until you have completed the interactive Clarifying Questions round defined at the end of this command.** That round asks the user targeted multiple-choice questions through Copilot's `ask_user` tool — reproducing VS Code's `#askQuestions` — and its answers are required input for `intake.md`. Read the full stage first, run the round, *then* write.

---

{CORE_TEMPLATE}

---

## Clarifying Questions Protocol (copilot-assess-ask-questions preset)

Now execute the gate flagged at the top of this command. This round runs **before the Execution step above writes `intake.md`** — resolve ambiguity **by asking the user through the `ask_user` tool**. Do not guess, and do not jump straight to `[NEEDS CLARIFICATION: …]` markers without asking first.

### When to run it

- Run it **once, up front**: after reading this stage's inputs (the prerequisites and any prior assessment artifacts described above) but **before** you write `intake.md`.
- Ask **only** about gaps that would **materially change** `intake.md`. If everything you need is already unambiguous, say so in one line and proceed — never ask questions for their own sake.

### How to ask — always use the `ask_user` tool

- Put every question to the user with the **`ask_user`** tool so it renders as an interactive prompt. Never hand-format questions as plain chat text — the tool is always available on the Copilot App, CLI, and VS Code.
- Ask **one question per `ask_user` call**, and ask at most the **3–5 highest-impact questions** for this stage.
- Give each question a **`choices`** array of **2–4 concrete options** drawn from the actual context. List the most likely option **first** and suffix it with **`(Recommended)`** when you have a basis for one.
- **Do not** add an "Other" / "Something else" catch-all option — Copilot automatically offers a free-text answer alongside the choices.
- Keep each question **closed and decision-shaped**: every answer must change what you write.
- Ask the questions one at a time and **wait** for each answer before moving on.

### After the answers

- Treat the answers as **authoritative input** and fold them directly into `intake.md`.
- If the user genuinely does not know an answer, record that gap as a `[NEEDS CLARIFICATION: …]` marker in `intake.md` — never invent an answer to fill it.
- Do **not** re-ask anything the user already answered earlier in this session; reuse those answers.
- Everything in the stage above (path safety, slug resolution, URL Trust Policy, output format, and guardrails) still applies **unchanged** — this round only gathers input; it never relaxes a guardrail.

### What to ask about at the `intake` stage

- The idea's **origin and trigger** — who raised it and what prompted it *now* (a complaint, outage, sales ask, strategy shift).
- The **idea type** when the input does not make it obvious — new-capability / improvement / fix / exploration / cost-saving / compliance / other.
- The **slug** to file the idea under, if one was not supplied — offer a 2–4 word kebab-case default derived from the idea.
- The **boundary of what is being proposed** — which parts of the stated idea are in vs. out — captured verbatim.

Keep every question about **what the idea is and where it came from**. Intake captures; it does not evaluate, size, or solutionize — never ask whether the idea is a good one here.
