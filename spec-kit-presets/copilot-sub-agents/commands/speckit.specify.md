## Sub-Agent Delegation

When executing this command, delegate independent work to parallel sub-agents to reduce total execution time.

**How to dispatch sub-agents in Copilot:**

- **VS Code**: Use the `runSubagent` tool to spawn each sub-agent in an isolated context.
- **CLI**: Delegate to a sub-agent process — Copilot CLI automatically manages subsidiary sub-agent execution. You can also target custom agents defined in `.github/agents/` or `~/.copilot/agents/`.

### Spec Quality Validation

After writing the specification to SPEC_FILE (step 6), dispatch the quality validation as a sub-agent while the main agent prepares the completion report:

- **Sub-agent: Quality Validation** — "Validate the specification at {SPEC_FILE} against these quality criteria: no implementation details, focused on user value, testable requirements, measurable success criteria, all scenarios defined, edge cases identified, scope bounded. Generate a checklist at {FEATURE_DIR}/checklists/requirements.md. Return: pass/fail status for each item and specific issues found."

If the sub-agent reports failures, address them in the main agent before finalizing.
