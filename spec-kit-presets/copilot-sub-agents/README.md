# Copilot Sub-Agent Delegation

A Spec Kit preset that adds sub-agent delegation instructions to all core commands, enabling parallel execution of independent steps when using GitHub Copilot.

## What It Does

This preset uses the `prepend` composition strategy to inject sub-agent delegation instructions at the top of each core Spec Kit command. When Copilot processes a command, it sees the delegation instructions first and can dispatch independent work items to parallel sub-agents.

## Compatibility

The instructions call out the specific Copilot mechanism per environment:

- **VS Code Copilot**: Use the `runSubagent` tool to spawn each sub-agent in an isolated context
- **Copilot CLI**: Delegate to a subsidiary sub-agent process — Copilot CLI automatically manages sub-agent execution, and can target custom agents defined in `.github/agents/` or `~/.copilot/agents/`

## Parallelism by Command

| Command | What Runs in Parallel |
|---------|----------------------|
| **plan** | Phase 0 research tasks (each unknown independently); Phase 1 artifacts (data-model, contracts, quickstart) |
| **implement** | All tasks marked `[P]` within the same phase; context loading |
| **analyze** | Six detection passes (Duplication, Ambiguity, Underspecification, Constitution, Coverage, Inconsistency) |
| **tasks** | Document loading; per-user-story task generation |

| **taskstoissues** | GitHub issue creation (batches of 5) |
| **specify** | Quality validation checklist generation |
| **checklist** | Feature context loading (spec, plan, tasks) |
| **clarify** | Ambiguity scan categories (functional/domain, quality/integration, UX/edge cases) |

## Installation

```bash
specify preset add copilot-sub-agents
```

## Requirements

- Spec Kit >= 0.2.0
- GitHub Copilot (CLI or VS Code) with sub-agent support

## How It Works

Each command file contains only the sub-agent delegation instructions. The `prepend` strategy places these instructions before the core command content, so the agent sees them first and knows which steps to parallelize.

The core command logic is unchanged — the preset only adds guidance for _how_ to execute existing steps more efficiently.

## Example

When running `speckit.plan`, instead of sequentially researching each unknown in Technical Context, the agent will:

1. Identify all `NEEDS CLARIFICATION` items
2. Dispatch a `runSubagent` call for each one in parallel
3. Collect results and consolidate into `research.md`
4. Then dispatch parallel sub-agents for `data-model.md`, `contracts/`, and `quickstart.md`

## License

MIT
