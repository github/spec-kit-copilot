# assess-canvas

A GitHub Copilot **canvas extension** that wraps the Spec Kit
[`assess`](https://github.com/github/spec-kit) extension — the five-stage idea
**discovery funnel** (`intake → research → define → shape → decide`) that turns
an idea into a **go / needs-clarification / kill** decision before it enters
Spec-Driven Development.

The canvas gives that pipeline a side-panel UI: it lists every assessment under
`.specify/assessments/<slug>/`, shows which stages are done, previews each
Markdown artifact, and drives the pipeline by invoking the generated
`speckit-assess-*` skills through the agent.

## What it does

- **Funnel overview** — a live count of how many ideas have reached each stage,
  plus a tally of `go` / `needs-clarification` / `kill` verdicts.
- **Per-idea cards** — title, slug, a pill per stage (done / next / pending),
  the recorded verdict, and a one-click **Run &lt;next stage&gt;** button.
- **Rerun from any stage** — every available stage pill stays enabled. Clicking
  one opens its run dialog, where the current artifact can also be previewed.
  Rerun explicitly authorizes overwrite, uses the existing artifact as context,
  preserves still-valid content, and marks later artifacts stale until rerun.
- **Stage-aware inputs** — intake requires an idea; research and define require
  substantive text only when their upstream artifacts are absent; shape
  requires `problem.md`; decide requires `problem.md` and warns that a missing
  `concept.md` prevents a go verdict. Optional stage guidance is passed through.
- **Rendered artifact preview** — view completed Markdown artifacts
  (`intake.md`, `research.md`, `problem.md`, `concept.md`, `decision.md`) as
  formatted headings, lists, code, blockquotes, and tables in a dedicated
  full-width canvas view with a **Back to dashboard** control.
- **Targeted clarification** — clarification items in designated question
  sections render a **Clarify** action. The canvas requires an answer in a
  confirmation dialog before it sends a validated stage rerun and overwrite
  request to the agent.
- **New idea → intake** — paste an idea (or URL), optionally set a slug, and
  kick off `speckit-assess-intake`.
- **Guided prerequisite setup** — when Spec Kit or the `assess` extension is
  missing, the canvas makes setup the first step and sends the required setup
  work to the agent instead of forwarding an unavailable assess command.
- **Live updates** — the panel refreshes automatically (SSE) as the assess
  commands write new artifacts.

The canvas is **read-only against the filesystem**; it never writes assessment
files. All changes happen through the `assess` commands themselves, so the
extension's safety guardrails still apply.

## How it drives the pipeline

Buttons in the canvas POST to a loopback HTTP endpoint, which calls
`session.send({ prompt: "/skill:speckit-assess-<stage> slug=<slug>" })`. The skill
runs in your normal chat session — watch the transcript for the agent's work
and any prompts (e.g. slug confirmation, URL-fetch approval).

Commands are restricted to the five `speckit-assess-*` skills and slugs are
normalized to `[a-z0-9-]`, so the canvas can only trigger assess stages.

## Agent-callable actions

- `list_assessments` — returns all assessments with per-stage progress and verdict.
- `setup_assess` — asks the agent to initialize Spec Kit and install `assess`.
- `clarify_item` — validates a clarification by artifact/index, captures the
  user's answer, and reruns the owning stage.
- `run_stage` — runs or reruns a stage
  (`{ slug, stage, idea?, instructions?, overwrite? }`) by sending the matching
  command. Existing artifacts require `overwrite: true`.

## Install

**In this repo (committed):** the extension lives at
`.github/extensions/assess-canvas/`. Copilot CLI discovers it automatically when
run inside the repo — no install step.

**Anywhere else (gist):** share it as a private gist
("Share extension as gist…" in the command palette, or the `share_extension`
tool), then install with "Install extension from gist…" into
`~/.copilot/extensions/` so it follows you across projects. The bundled
`copilot-extension.json` manifest is what makes the gist install flow recognize
it.

## Requirements

The canvas detects whether the project is initialized and whether `assess` is
installed. If either prerequisite is missing, it presents a setup action before
the intake form. Assessments are written under
`.specify/assessments/<slug>/`.

## Files

| File | Purpose |
|------|---------|
| `extension.mjs` | SDK wiring: per-instance loopback server, HTTP + SSE endpoints, canvas actions, `session.send` driving. |
| `assess.js` | Filesystem scan: project-root resolution, stage/verdict detection, safe artifact reads. |
| `index.html` | The dashboard UI (served to the canvas iframe). |
| `copilot-extension.json` | Manifest for gist share/install. |
