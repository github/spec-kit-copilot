# assess-canvas

A GitHub Copilot **canvas extension** that wraps the Spec Kit
[`assess`](https://github.com/github/spec-kit) extension — the five-stage idea
**discovery funnel** (`intake → research → define → shape → decide`) that turns
an idea into a **go / needs-clarification / kill** decision before it enters
Spec-Driven Development.

The canvas gives that pipeline a side-panel UI: it lists every assessment under
`.specify/assessments/<slug>/`, shows which stages are done, previews each
Markdown artifact, and drives the pipeline by sending `/speckit.assess.*`
commands back to the agent.

## What it does

- **Funnel overview** — a live count of how many ideas have reached each stage,
  plus a tally of `go` / `needs-clarification` / `kill` verdicts.
- **Per-idea cards** — title, slug, a pill per stage (done / next / pending),
  the recorded verdict, and a one-click **Run &lt;next stage&gt;** button.
- **Artifact preview** — click any completed stage to read its Markdown
  (`intake.md`, `research.md`, `problem.md`, `concept.md`, `decision.md`) in a
  side pane.
- **New idea → intake** — paste an idea (or URL), optionally set a slug, and
  kick off `speckit.assess.intake`.
- **Live updates** — the panel refreshes automatically (SSE) as the assess
  commands write new artifacts.

The canvas is **read-only against the filesystem**; it never writes assessment
files. All changes happen through the `assess` commands themselves, so the
extension's safety guardrails still apply.

## How it drives the pipeline

Buttons in the canvas POST to a loopback HTTP endpoint, which calls
`session.send({ prompt: "/speckit.assess.<stage> slug=<slug>" })`. The command
runs in your normal chat session — watch the transcript for the agent's work
and any prompts (e.g. slug confirmation, URL-fetch approval).

Commands are restricted to the five `speckit.assess.*` verbs and slugs are
normalized to `[a-z0-9-]`, so the canvas can only trigger assess stages.

## Agent-callable actions

- `list_assessments` — returns all assessments with per-stage progress and verdict.
- `run_stage` — runs a stage (`{ slug, stage, idea? }`) by sending the matching command.

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

- The `assess` extension installed in the target project
  (`specify extension add assess`) so the `/speckit.assess.*` commands exist.
- An initialized Spec Kit project (`.specify/` present). Assessments are written
  under `.specify/assessments/<slug>/`.

## Files

| File | Purpose |
|------|---------|
| `extension.mjs` | SDK wiring: per-instance loopback server, HTTP + SSE endpoints, canvas actions, `session.send` driving. |
| `assess.js` | Filesystem scan: project-root resolution, stage/verdict detection, safe artifact reads. |
| `index.html` | The dashboard UI (served to the canvas iframe). |
| `copilot-extension.json` | Manifest for gist share/install. |
