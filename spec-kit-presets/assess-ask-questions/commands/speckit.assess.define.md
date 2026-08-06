> **assess-ask-questions preset — GitHub Copilot (App, CLI, VS Code).** Gate: **do not write `problem.md` until you have completed the interactive Clarifying Questions round defined at the end of this command.** That round asks the user targeted multiple-choice questions through Copilot's `ask_user` tool — reproducing VS Code's `#askQuestions` — and its answers are required input for `problem.md`. Read the full stage first, run the round, *then* write.

---

{CORE_TEMPLATE}

---

## Clarifying Questions Protocol (assess-ask-questions preset)

Now execute the gate flagged at the top of this command. This round runs **before the Execution step above writes `problem.md`** — resolve ambiguity **by asking the user through the `ask_user` tool**. Do not guess, and do not jump straight to `[NEEDS CLARIFICATION: …]` markers without asking first.

### When to run it

- Run it **once, up front**: after reading this stage's inputs (the prerequisites and any prior assessment artifacts described above) but **before** you write `problem.md`.
- Ask **only** about gaps that would **materially change** `problem.md`. If everything you need is already unambiguous, say so in one line and proceed — never ask questions for their own sake.

### How to ask — always use the `ask_user` tool

- Put every question to the user with the **`ask_user`** tool so it renders as an interactive prompt. Never hand-format questions as plain chat text — the tool is always available on the Copilot App, CLI, and VS Code.
- Ask **one question per `ask_user` call**, and ask at most the **3–5 highest-impact questions** for this stage.
- Give each question a **`choices`** array of **2–4 concrete options** drawn from the actual context. List the most likely option **first** and suffix it with **`(Recommended)`** when you have a basis for one.
- **Do not** add an "Other" / "Something else" catch-all option — Copilot automatically offers a free-text answer alongside the choices.
- Keep each question **closed and decision-shaped**: every answer must change what you write.
- Ask the questions one at a time and **wait** for each answer before moving on.

### After the answers

- Treat the answers as **authoritative input** and fold them directly into `problem.md`.
- If the user genuinely does not know an answer, record that gap as a `[NEEDS CLARIFICATION: …]` marker in `problem.md` — never invent an answer to fill it.
- Do **not** re-ask anything the user already answered earlier in this session; reuse those answers.
- Everything in the stage above (path safety, slug resolution, URL Trust Policy, output format, and guardrails) still applies **unchanged** — this round only gathers input; it never relaxes a guardrail.

### What to ask about at the `define` stage

- Who the **primary affected users and stakeholders** are (users experience the problem; stakeholders decide, fund, or are impacted).
- What **success concretely looks like** — which measurable signals or metrics, and their current baseline if known.
- Explicit **non-goals / boundaries** to bound the work and prevent scope creep.
- The **cost of inaction** — what happens, and how urgent it is, if nothing is built.

Keep every question in the **problem space** — no features, APIs, or architecture. If the idea arrived as a solution, ask what underlying problem it is meant to solve.
