## Sub-Agent Delegation

When executing this command, delegate independent work to parallel sub-agents to reduce total execution time.

**How to dispatch sub-agents in Copilot:**

- **VS Code**: Use the `runSubagent` tool to spawn each sub-agent in an isolated context.
- **CLI**: Delegate to a sub-agent process — Copilot CLI automatically manages subsidiary sub-agent execution. You can also target custom agents defined in `.github/agents/` or `~/.copilot/agents/`.

### Parallel Detection Passes

After loading artifacts and building semantic models, dispatch each detection pass as a **separate sub-agent**. All six passes are independent and can run in parallel:

1. **Sub-agent: Duplication Detection** — "Analyze these artifacts for near-duplicate requirements. Identify lower-quality phrasings for consolidation. Artifacts: {spec summary}, {plan summary}, {tasks summary}. Return findings as rows: ID, Severity, Location(s), Summary, Recommendation."

2. **Sub-agent: Ambiguity Detection** — "Flag vague adjectives (fast, scalable, secure, intuitive, robust) lacking measurable criteria and unresolved placeholders (TODO, TKTK, ???). Artifacts: {spec summary}, {plan summary}, {tasks summary}. Return findings as rows."

3. **Sub-agent: Underspecification** — "Find requirements with verbs but missing objects or measurable outcomes, user stories missing acceptance criteria, and tasks referencing undefined components. Artifacts: {spec summary}, {plan summary}, {tasks summary}. Return findings as rows."

4. **Sub-agent: Constitution Alignment** — "Check all requirements and plan elements against constitution principles. Flag any conflicts with MUST principles. Constitution: {constitution content}. Artifacts: {spec summary}, {plan summary}, {tasks summary}. Return findings as rows."

5. **Sub-agent: Coverage Gaps** — "Identify requirements with zero associated tasks, tasks with no mapped requirement/story, and success criteria requiring buildable work not reflected in tasks. Requirements inventory: {inventory}. Task coverage mapping: {mapping}. Return findings as rows."

6. **Sub-agent: Inconsistency** — "Detect terminology drift, data entities referenced in plan but absent in spec (or vice versa), task ordering contradictions, and conflicting requirements. Artifacts: {spec summary}, {plan summary}, {tasks summary}. Return findings as rows."

Collect all sub-agent results, assign severities, and merge into the unified analysis report. Cap at 50 total findings.
