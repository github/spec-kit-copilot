# Idea Research: Spec Kit SDD Canvas

- **Slug**: spec-kit-sdd-canvas
- **Created**: 2026-07-31
- **Evidence confidence (overall)**: low

## Users & Demand

- The only direct demand signal currently recorded is one request to create a canvas app for the Spec Kit SDD process; this establishes stated interest but not frequency, urgency, or willingness to adopt. — [source: `.specify/assessments/spec-kit-sdd-canvas/intake.md`] (confidence: high, cited)
- The repository explicitly targets GitHub Copilot CLI and Copilot App users who want a first-class guided experience for driving `specify` without leaving the agent. — [source: `README.md:15-20`] (confidence: high, cited)
- No support-ticket volume, user interviews, usage analytics, conversion data, or repeated requests were available in the repository. — [source: repository inspection] (confidence: high, cited)
- The likely primary audience is existing Spec Kit users who prefer a visual progress surface over chat-only orchestration. — [ASSUMPTION] (confidence: low)

## Prior Art

- This repository already contains a working `assess-canvas` extension that scans filesystem artifacts, renders stage progress, previews Markdown, and sends stage commands back to the foreground agent. It demonstrates that the canvas-to-Spec-Kit interaction pattern is technically viable for one bounded workflow. — [source: `.github/extensions/assess-canvas/README.md:9-49`; `.github/extensions/assess-canvas/extension.mjs:35-267`] (confidence: high, cited)
- Spec Kit already provides a "Full SDD Cycle" workflow covering `specify → plan → tasks → implement`, with explicit review gates after specification and planning. This is the closest internal precedent for the process the proposed canvas would expose. — [source: `.specify/workflows/speckit/workflow.yml:1-78`] (confidence: high, cited)
- The Copilot plugin already exposes Spec Kit command groups as focused skills selected from natural-language requests, providing a non-visual guided path through initialization, extensions, workflows, and maintenance. — [source: `README.md:25-42,97-107`] (confidence: high, cited)
- The current assess canvas is specialized around a stable five-file funnel; no existing repository evidence shows that the same presentation model has been validated for feature branches, specification directories, planning artifacts, task execution, or review gates. — [source: `.github/extensions/assess-canvas/README.md:14-29`; `.specify/workflows/speckit/workflow.yml:43-78`] (confidence: medium, cited)

## Market & Context

- Today, users can run the SDD cycle through natural-language skill selection or the bundled `speckit` workflow, so the canvas would complement rather than replace existing orchestration. — [source: `README.md:97-107`; `.specify/workflows/speckit/workflow.yml:1-78`] (confidence: high, cited)
- Without a canvas, users must infer progress from chat output and inspect generated repository artifacts directly. — [ASSUMPTION] (confidence: medium)
- No external competitor, market-size, adoption, or community-demand evidence was collected because the available fetch mechanism does not expose or pin the connected peer IP as required by the assessment URL trust policy. — [source: `.github/skills/speckit-assess-research/SKILL.md:43-51`] (confidence: high, cited)

## Data & Constraints

- The bundled SDD workflow has four command stages and two human review gates; a faithful dashboard must represent both execution progress and approval states rather than only a linear artifact checklist. — [source: `.specify/workflows/speckit/workflow.yml:43-78`] (confidence: high, cited)
- Copilot extensions run as separate Node.js processes connected to the CLI over JSON-RPC and are discovered from immediate `.github/extensions/` subdirectories containing `extension.mjs`. — [source: `/Applications/GitHub Copilot.app/Contents/Resources/copilot-sdk/docs/extensions.md:1-35`] (confidence: high, cited)
- Canvas declarations support typed open input, agent-callable actions, an `open` handler, and optional close cleanup; the SDK labels this canvas surface experimental and subject to change. — [source: `/Applications/GitHub Copilot.app/Contents/Resources/copilot-sdk/canvas.d.ts:3-14,28-98`] (confidence: high, cited)
- The initialized project records Spec Kit 0.14.3, while the plugin manifest currently declares version 0.11.8 and states lockstep targeting in its README. Compatibility expectations would need resolution before relying on generated artifact shapes across versions. — [source: `.specify/init-options.json:1-9`; `plugin.json:1-5`; `README.md:54-56`] (confidence: high, cited)
- No repository data establishes expected numbers of concurrent features, artifact sizes, stage durations, failure rates, or required refresh latency. — [source: repository inspection] (confidence: high, cited)

## Evidence Against the Idea

- Existing skills and the bundled workflow may already solve orchestration adequately; without evidence of navigation or visibility pain, a canvas risks duplicating controls rather than removing a demonstrated bottleneck. — [source: `README.md:25-42,97-107`; `.specify/workflows/speckit/workflow.yml:1-78`] (confidence: medium, cited)
- The only current demand signal is a single broad request with no defined users or success metric, making scope and value difficult to validate. — [source: `.specify/assessments/spec-kit-sdd-canvas/intake.md:8-27`] (confidence: high, cited)
- Full SDD includes branching state, review gates, generated artifacts, and potentially long-running implementation work, so extrapolating directly from the simpler assess funnel may underestimate interaction and recovery complexity. — [source: `.specify/workflows/speckit/workflow.yml:43-78`; `.github/extensions/assess-canvas/README.md:14-29`] (confidence: medium, cited)
- Building against an explicitly experimental canvas API creates maintenance risk, especially alongside the observed Spec Kit version mismatch. — [source: `/Applications/GitHub Copilot.app/Contents/Resources/copilot-sdk/canvas.d.ts:13-14`; `.specify/init-options.json:8`; `plugin.json:4`] (confidence: high, cited)

## Gaps & Open Questions

- [NEEDS CLARIFICATION: which user segment experiences enough SDD navigation or visibility pain to justify a canvas]
- [NEEDS CLARIFICATION: whether the canvas should wrap the bundled workflow, individual skills, or both]
- [NEEDS CLARIFICATION: which artifacts and review gates must be visible or actionable]
- [NEEDS CLARIFICATION: what success metric would distinguish useful workflow guidance from duplicated UI]
- [NEEDS CLARIFICATION: expected behavior for failures, resumptions, concurrent features, and stale artifacts]
- [NEEDS CLARIFICATION: whether plugin/CLI version lockstep will be restored before implementation]
- [NEEDS CLARIFICATION: external prior art and user demand once a connection-safe research mechanism is available]

## Sources

- `.specify/assessments/spec-kit-sdd-canvas/intake.md` (local repository artifact)
- `README.md` (local repository documentation)
- `plugin.json` (local plugin manifest)
- `.github/extensions/assess-canvas/README.md` (local prior-art documentation)
- `.github/extensions/assess-canvas/extension.mjs` (local prior-art implementation)
- `.specify/workflows/speckit/workflow.yml` (local bundled SDD workflow)
- `.specify/init-options.json` (local initialization metadata)
- `.github/skills/speckit-assess-research/SKILL.md` (local research policy)
- `/Applications/GitHub Copilot.app/Contents/Resources/copilot-sdk/docs/extensions.md` (installed SDK documentation)
- `/Applications/GitHub Copilot.app/Contents/Resources/copilot-sdk/canvas.d.ts` (installed SDK type definitions)
- No external URLs fetched; connection-safety validation was unavailable.
