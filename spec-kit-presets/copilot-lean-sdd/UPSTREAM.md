# Upstream provenance and attribution

Copilot Lean SDD is independently maintained here, not a re-export or a claim of
upstream endorsement. Its independent initial version is **1.0.0**.

The authoritative upstream is [GitHub Spec Kit](https://github.com/github/spec-kit),
whose [first-party preset catalog at the imported commit](https://github.com/github/spec-kit/blob/27d14e20c187c1f2916540ea201ecbdc9f8ed588/presets/catalog.json)
identifies the bundled **Lean Workflow** preset, id `lean`, version **1.0.0**,
author `github`. The source is `presets/lean/`, not a separate repository inferred
from the informal name "lean-preset".

**Exact source commit:** `27d14e20c187c1f2916540ea201ecbdc9f8ed588`
(retrieved 2026-10-22). Upstream preset version and source commit are separate:
the manifest version alone does not identify the imported content.

## Imported and adapted material

| Local files | Source at the exact commit above |
| --- | --- |
| `commands/speckit.{constitution,specify,plan,tasks,implement}.md` | [`presets/lean/commands/`](https://github.com/github/spec-kit/tree/27d14e20c187c1f2916540ea201ecbdc9f8ed588/presets/lean/commands) |
| `preset.yml` packaging structure, five original declarations | [`presets/lean/preset.yml`](https://github.com/github/spec-kit/blob/27d14e20c187c1f2916540ea201ecbdc9f8ed588/presets/lean/preset.yml) |
| Lean workflow/artifact description | [`presets/lean/README.md`](https://github.com/github/spec-kit/blob/27d14e20c187c1f2916540ea201ecbdc9f8ed588/presets/lean/README.md) |
| `commands/speckit.{clarify,analyze,checklist,converge}.md` semantics, condensed and adapted | [`templates/commands/`](https://github.com/github/spec-kit/tree/27d14e20c187c1f2916540ea201ecbdc9f8ed588/templates/commands) |
| `LICENSE` (verbatim) | [`LICENSE`](https://github.com/github/spec-kit/blob/27d14e20c187c1f2916540ea201ecbdc9f8ed588/LICENSE) |

Copyright GitHub, Inc. Upstream material is MIT licensed. The accompanying
[LICENSE](LICENSE) retains the copyright and permission notice and must ship in
the preset archive with this attribution.

## Copilot-specific changes

- Import the five original Lean command files **byte-for-byte unchanged**, including
  frontmatter and whitespace. Tests pin their SHA-256 hashes to the source commit.
  Keep their explicit feature directory, `feature.json`, single-file spec/plan/tasks,
  direct task execution, and governance-only constitution without added guidance.
- The four shared-command adaptations use Lean's short User Input / Outline format,
  with direct context loading and essential constraints rather than repeated
  execution guidance. Interactive questions use Copilot's `ask_user`; missing inputs
  and failures are reported. These additions do not alter the original five.
- Replace the four supported shared core commands with self-contained Lean-compatible
  adaptations. Remove their script/template dependencies and extension lifecycle-hook
  dispatch rather than inheriting Full SDD core fallbacks.
- Preserve clarification's five-question limit and incremental answers, read-only
  analysis and constitution authority, reviewer-owned requirements-quality
  checklists, and append-only convergence.
- Exclude deprecated `taskstoissues`, which is moving out of core SDD. Older CLI
  versions may still expose it independently; this preset does not manage it.
- Do not generate or synchronize a built-in spec quality checklist. Existing custom
  checklists are not automatically rewritten or treated as mandatory Lean gates.
- Change package identity, minimum tested CLI version, and release metadata.
  No automatic upstream synchronization or project migration is implied.

When updating, inspect both the five upstream Lean commands and the complete core
command inventory. Preserve this provenance trail, license, minimal-artifact
contract, and hook-free replacement coverage; review new commands explicitly.
