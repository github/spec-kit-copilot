## Sub-Agent Delegation

When executing this command, delegate independent work to parallel sub-agents to reduce total execution time.

**How to dispatch sub-agents in Copilot:**

- **VS Code**: Use the `runSubagent` tool to spawn each sub-agent in an isolated context.
- **CLI**: Delegate to a sub-agent process — Copilot CLI automatically manages subsidiary sub-agent execution. You can also target custom agents defined in `.github/agents/` or `~/.copilot/agents/`.

### Parallel Issue Creation

Preserve the core command's deduplication pass. First fetch the existing issues in
the target repository and determine which task IDs are already represented — do
**not** skip this step, or reruns will create duplicate issues.

Then dispatch issue creation in parallel batches **only for the task IDs that do not
yet have an issue**:

- For each unmatched task in tasks.md:
  → Sub-agent: "Create a GitHub issue in {owner}/{repo} for task {TaskID}: '{description}'. Phase: {phase name}. Dependencies: {dependency list if any}. Parallel marker: {yes/no}. Use the GitHub MCP server (issue_write tool). Return: issue number and URL."

**Batch size**: Dispatch up to 5 sub-agents at a time to avoid rate limiting. Wait for each batch to complete before dispatching the next.

Collect all sub-agent results and report the created issues (and any that were skipped as already existing) with their numbers and URLs.
