## Sub-Agent Delegation

When executing this command, delegate independent work to parallel sub-agents to reduce total execution time.

**How to dispatch sub-agents in Copilot:**

- **VS Code**: Use the `runSubagent` tool to spawn each sub-agent in an isolated context.
- **CLI**: Delegate to a sub-agent process — Copilot CLI automatically manages subsidiary sub-agent execution. You can also target custom agents defined in `.github/agents/` or `~/.copilot/agents/`.

### Parallel Task Execution

When processing tasks within a phase, identify all tasks marked with `[P]` (parallel-safe). Dispatch each parallel-safe task as a **separate sub-agent**:

- For each `[P]` task in the current phase:
  → Sub-agent: "Implement task {TaskID}: {description}. Context: {relevant plan/spec excerpts}. File path: {target file}. Return: confirmation of completion, files created/modified, and any issues encountered."

**Rules for sub-agent dispatch:**

- Only dispatch tasks within the **same phase** — never cross phase boundaries
- Sequential tasks (without `[P]`) must run in the main agent, in order
- If a parallel task depends on a sequential task in the same phase, wait for the sequential task first
- After all sub-agents for a phase complete, **verify results** in the main agent before moving to the next phase
- Mark each completed task as `[X]` in tasks.md after verifying the sub-agent's output

### Context Loading in Parallel

When loading implementation context (step 3), dispatch parallel reads:

1. **Sub-agent: Load plan context** — "Read plan.md and extract tech stack, architecture decisions, and file structure. Return a structured summary."
2. **Sub-agent: Load supporting docs** — "Read data-model.md, contracts/, research.md, and quickstart.md (whichever exist). Return a consolidated context summary."

Use the consolidated results to inform implementation.
