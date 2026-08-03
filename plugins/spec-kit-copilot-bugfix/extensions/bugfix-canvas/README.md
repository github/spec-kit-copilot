# bugfix-canvas

A GitHub Copilot **canvas extension** that wraps the Spec Kit
[`bug`](https://github.com/github/spec-kit) extension — the three-stage bug
triage pipeline (`assess → fix → test`) that takes a bug report from triage to a
verified fix.

The canvas gives that pipeline a side-panel UI: it lists every bug under
`.specify/bugs/<slug>/`, shows which stages are done, previews each Markdown
artifact, and drives the pipeline by invoking the generated `speckit-bug-*`
skills through the agent.

## What it does

- **Pipeline overview** — a live count of how many bugs have reached each stage,
  plus a tally of `verified` / `partial` / `failed` verification results.
- **Per-bug cards** — title, slug, the assessment severity and verification
  result badges, a pill per stage (done / next / pending), and a one-click
  **Run &lt;next stage&gt;** button.
- **Rerun from any stage** — every available stage pill stays enabled. Clicking
  one opens its run dialog, where the current artifact can also be previewed.
  Rerun explicitly authorizes overwrite, uses the existing artifact as context,
  preserves still-valid content, and marks later artifacts stale until rerun.
- **Stage-aware inputs** — assess requires a bug report (pasted text or a URL);
  fix requires a current `assessment.md`; test requires a current `assessment.md`
  and `fix.md`. Optional stage guidance is passed through. An `invalid`
  assessment ends the pipeline — the card shows "no fix needed" instead of
  pushing a fix.
- **Rendered artifact preview** — view completed Markdown artifacts
  (`assessment.md`, `fix.md`, `test.md`) as formatted headings, lists, code,
  blockquotes, and tables in a dedicated full-width canvas view with a **Back to
  dashboard** control.
- **Targeted clarification** — `[NEEDS CLARIFICATION: …]` items in the
  assessment's **Reproduction** and **Open Questions** sections render a
  **Clarify** action. The canvas requires an answer in a confirmation dialog
  before it sends a validated assess rerun and overwrite request to the agent.
- **New bug → assess** — paste a bug report (or URL), optionally set a slug, and
  kick off `speckit-bug-assess`.
- **Guided prerequisite setup** — when Spec Kit or the `bug` extension is
  missing, the canvas makes setup the first step and sends the required setup
  work to the agent instead of forwarding an unavailable bug command.
- **Live updates** — the panel refreshes automatically (SSE) as the bug commands
  write new artifacts.

The canvas is **read-only against the filesystem**; it never writes bug files.
All changes happen through the `bug` commands themselves, so the extension's
safety guardrails still apply (only `speckit-bug-fix` ever edits source code).

## Opening the dashboard

This is a **canvas extension**, so it renders in the **GitHub Copilot app** side
panel — not in the plain terminal CLI. Installing the plugin only *registers* the
canvas; nothing opens automatically.

To open it, ask Copilot in chat, e.g. **"Open the Bug Fix Pipeline"** (or "open
the bug fix dashboard"). The agent matches your request to this canvas
(`id: bugfix-canvas`, displayName **"Bug Fix Pipeline"**) and opens it in a side
panel. There is no slash command or menu entry — discovery is the agent matching
the canvas name/description.

Once it is open you can drive it two ways:

- **Click the panel** — the New bug → assess form and each card's Run/Rerun and
  Clarify buttons.
- **Ask the agent** — the canvas also exposes agent-callable actions
  (`list_bugs`, `setup_bug`, `run_stage`, `clarify_item`), so "run assess on this
  stack trace in the bug pipeline" works too.

If the project isn't set up for Spec Kit or the `bug` extension isn't installed,
the canvas shows a setup step first.

## How it drives the pipeline

Buttons in the canvas POST to a loopback HTTP endpoint, which calls
`session.send({ prompt: "/skill:speckit-bug-<stage> slug=<slug>" })`. The skill
runs in your normal chat session — watch the transcript for the agent's work and
any prompts (e.g. slug confirmation, URL-fetch approval).

Each open canvas gets a random capability token. The loopback server requires
that token and its canonical Host/Origin on UI, API, and event-stream requests.

Commands are restricted to the three `speckit-bug-*` skills and slugs are
normalized to `[a-z0-9-]`, so the canvas can only trigger bug stages.

## Agent-callable actions

- `list_bugs` — returns all bugs with per-stage progress, assessment
  verdict/severity, fix status, and verification result.
- `setup_bug` — asks the agent to initialize Spec Kit and install `bug`.
- `clarify_item` — validates a clarification by artifact/index/question, captures
  the user's answer, and reruns the assess stage.
- `run_stage` — runs or reruns a stage
  (`{ slug, stage, report?, instructions?, overwrite? }`) by sending the matching
  command. Existing artifacts require `overwrite: true`.

## Install

**Via marketplace (recommended):**

```bash
copilot plugin marketplace add OWNER/spec-kit-copilot
copilot plugin install spec-kit-copilot-bugfix@spec-kit-marketplace
```

The plugin manifest lives at `plugins/spec-kit-copilot-bugfix/plugin.json` and
declares this directory through its `extensions/` component path.

**Anywhere else (gist):** share it as a private gist
("Share extension as gist…" in the command palette, or the `share_extension`
tool), then install with "Install extension from gist…" into
`~/.copilot/extensions/` so it follows you across projects. The bundled
`copilot-extension.json` manifest is what makes the gist install flow recognize
it.

## Requirements

The canvas detects whether the project is initialized and whether `bug` is
installed. If either prerequisite is missing, it presents a setup action before
the new-bug form. Bugs are written under `.specify/bugs/<slug>/`.

## Files

| File | Purpose |
|------|---------|
| `extension.mjs` | SDK wiring: per-instance loopback server, HTTP + SSE endpoints, canvas actions, `session.send` driving. |
| `bug.mjs` | Filesystem scan: project-root resolution, stage/verdict/result detection, safe artifact reads. |
| `index.html` | The dashboard UI (served to the canvas iframe). |
| `copilot-extension.json` | Manifest for gist share/install. |
