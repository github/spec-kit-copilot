## Sub-Agent Delegation

When executing this command, delegate independent work to parallel sub-agents to reduce total execution time.

**How to dispatch sub-agents in Copilot:**

- **VS Code**: Use the `runSubagent` tool to spawn each sub-agent in an isolated context.
- **CLI**: Delegate to a sub-agent process — Copilot CLI automatically manages subsidiary sub-agent execution. You can also target custom agents defined in `.github/agents/` or `~/.copilot/agents/`.

### Document Loading in Parallel

When loading design documents (step 2), dispatch parallel reads for all available documents:

1. **Sub-agent: Core docs** — "Read plan.md and spec.md. Extract tech stack, libraries, project structure, user stories with priorities (P1, P2, P3). Return structured summaries of both."
2. **Sub-agent: Supporting docs** — "Read data-model.md, contracts/, research.md, and quickstart.md (whichever exist under {FEATURE_DIR}). Extract entities, interface contracts, technical decisions, and test scenarios. Return a consolidated summary."

### Per-User-Story Task Generation

After loading all documents, generate tasks for independent user stories in parallel:

- For each user story (P1, P2, P3, ...) from spec.md:
  → Sub-agent: "Generate implementation tasks for User Story {N}: '{story title}'. Tech stack: {from plan.md}. Related entities: {from data-model.md if applicable}. Related contracts: {from contracts/ if applicable}. Follow the strict checklist format: - [ ] [TaskID] [P?] [USN] Description with file path. Return: ordered task list with dependency notes and parallel markers."

Collect all sub-agent results, then:
- Assign sequential Task IDs (T001, T002, ...) across all phases
- Resolve cross-story dependencies
- Assemble into the final tasks.md using the template structure
