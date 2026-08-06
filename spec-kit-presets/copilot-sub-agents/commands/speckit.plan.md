## Sub-Agent Delegation

When executing this command, delegate independent work to parallel sub-agents to reduce total execution time.

**How to dispatch sub-agents in Copilot:**

- **VS Code**: Use the `runSubagent` tool to spawn each sub-agent in an isolated context.
- **CLI**: Delegate to a sub-agent process — Copilot CLI automatically manages subsidiary sub-agent execution. You can also target custom agents defined in `.github/agents/` or `~/.copilot/agents/`.

### Phase 0 — Research in Parallel

When generating research tasks for unknowns in Technical Context, dispatch each research topic as a **separate sub-agent**:

- For each NEEDS CLARIFICATION item in Technical Context:
  → Sub-agent: "Research {unknown} for {feature context}. Return: Decision, Rationale, Alternatives considered."

- For each technology choice needing best-practices review:
  → Sub-agent: "Find best practices for {tech} in {domain}. Return: recommended patterns, pitfalls, configuration guidance."

Launch all research sub-agents in parallel, then consolidate their results into `research.md`.

### Phase 1 — Design Artifacts in Parallel

After research.md is complete, generate these artifacts via parallel sub-agents:

1. **Sub-agent: Data Model** — "Extract entities from the feature spec and research findings. Generate `data-model.md` with entity names, fields, relationships, validation rules, and state transitions."
2. **Sub-agent: Interface Contracts** — "Define interface contracts for the project based on the spec and research. Generate files under `contracts/` documenting exposed interfaces."
3. **Sub-agent: Quickstart** — "Create `quickstart.md` with integration scenarios and getting-started guidance based on the spec, data model, and contracts."

Wait for all three to complete, then proceed to agent context update and constitution re-evaluation.
