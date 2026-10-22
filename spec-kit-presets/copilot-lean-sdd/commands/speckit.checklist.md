---
description: Create an optional reviewer-owned checklist testing Lean requirements quality.
---

## User Input

```text
$ARGUMENTS
```

## Copilot Execution

Run directly in Copilot. Read `.specify/feature.json` for `feature_directory`;
resolve it inside this project, outside `.specify`, `.git`, and `.github`.
Stop and report malformed or missing configuration, unsafe paths, or missing
required inputs. Do not infer the feature from a branch name or run setup scripts.
Use Copilot's interactive `ask_user` tool for material questions, one at a time.
If a question is blocking and the tool is unavailable, report and stop.

## Outline

1. Require authored `<feature_directory>/spec.md`; if missing, suggest
   `speckit-specify` and stop. Read `plan.md`, `tasks.md`, and
   `.specify/memory/constitution.md` only if present and authored. No plan, tasks,
   separate template, or Full SDD design artifacts are prerequisites.

2. Derive the checklist focus, audience, and depth from the user input and actual
   feature context. Ask at most three initial material questions via `ask_user`;
   ask up to two follow-ups only if unresolved scenario classes affect correctness.
   Skip questions already answered. Where not blocking, state reasonable defaults:
   standard depth, reviewer audience, and the top two relevant focus areas.

3. Create `<feature_directory>/checklists/<domain>.md` only on this explicit
   checklist request. Use a short safe domain filename inside `checklists/`.
   Include title, purpose, date, relevant requirement-quality categories, and
   `- [ ] CHK001 ...` items. If the file exists, append without deleting content
   or changing existing checkbox states; continue from the highest CHK number.

4. Test **requirements quality**, not implementation: completeness, clarity,
   consistency, measurability, scenario/edge-case coverage, non-functional needs,
   dependencies, and assumptions. Reference spec sections/IDs or mark `[Gap]`.
   Example: "Are error recovery requirements defined?" NOT "Test error recovery".
   Do not invent requirements merely to fill categories or duplicate existing items.

5. All new items remain `[ ]`. Custom checklists are reviewer-owned; `[x]` means
   the reviewer accepted the requirements-quality criterion, not that code is done.
   Do not evaluate or mark items complete unless explicitly asked by the reviewer.
   Report path, item count, focus, and assumptions. This optional artifact is not
   a new mandatory Lean phase or an automatic implementation gate.
