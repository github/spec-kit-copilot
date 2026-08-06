## Sub-Agent Delegation

When executing this command, delegate independent work to parallel sub-agents to reduce total execution time.

**How to dispatch sub-agents in Copilot:**

- **VS Code**: Use the `runSubagent` tool to spawn each sub-agent in an isolated context.
- **CLI**: Delegate to a sub-agent process — Copilot CLI automatically manages subsidiary sub-agent execution. You can also target custom agents defined in `.github/agents/` or `~/.copilot/agents/`.

### Parallel Ambiguity Scan

When performing the structured ambiguity & coverage scan (step 2), dispatch independent scan categories as parallel sub-agents:

1. **Sub-agent: Functional & Domain scan** — "Analyze the spec for ambiguity in: Functional Scope & Behavior (core goals, out-of-scope, user roles) and Domain & Data Model (entities, identity rules, state transitions, scale). Mark each category Clear/Partial/Missing. Return the coverage map and candidate questions."

2. **Sub-agent: Quality & Integration scan** — "Analyze the spec for ambiguity in: Non-Functional Quality Attributes (performance, scalability, reliability, observability, security, compliance) and Integration & External Dependencies (external services, data formats, protocols). Mark each category Clear/Partial/Missing. Return the coverage map and candidate questions."

3. **Sub-agent: UX & Edge Cases scan** — "Analyze the spec for ambiguity in: Interaction & UX Flow (user journeys, error/loading states, a11y), Edge Cases & Failure Handling (negative scenarios, rate limiting, conflicts), Constraints & Tradeoffs, Terminology & Consistency, and Completion Signals. Mark each category Clear/Partial/Missing. Return the coverage map and candidate questions."

Merge the coverage maps from all sub-agents and prioritize the combined candidate questions into the final queue of up to 5 questions.
