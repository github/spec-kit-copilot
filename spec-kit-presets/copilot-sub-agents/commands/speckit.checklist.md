## Sub-Agent Delegation

When executing this command, delegate independent work to parallel sub-agents to reduce total execution time.

**How to dispatch sub-agents in Copilot:**

- **VS Code**: Use the `runSubagent` tool to spawn each sub-agent in an isolated context.
- **CLI**: Delegate to a sub-agent process — Copilot CLI automatically manages subsidiary sub-agent execution. You can also target custom agents defined in `.github/agents/` or `~/.copilot/agents/`.

### Feature Context Loading in Parallel

When loading feature context (step 4), dispatch parallel reads:

1. **Sub-agent: Spec analysis** — "Read spec.md at {FEATURE_DIR}/spec.md. Extract requirements, user stories, edge cases, and non-functional attributes relevant to the checklist domain: '{domain}'. Return a structured summary focused on requirement quality signals."

2. **Sub-agent: Plan and tasks analysis** — "Read plan.md and tasks.md at {FEATURE_DIR}/ (if they exist). Extract technical details, dependencies, and implementation tasks relevant to the checklist domain: '{domain}'. Return a structured summary."

Use the consolidated results to generate higher-quality, context-aware checklist items.
