---
name: speckit-workflow
description: 'Manage and run Spec Kit automation workflows via `specify workflow`. USE FOR: running a workflow by ID or local YAML, resuming a paused/failed run, checking run status, listing/installing/removing workflows, searching the workflow catalog, showing a workflow step graph. DO NOT USE FOR: extensions (use speckit-extension), presets (use speckit-preset), or bundles (use speckit-bundle).'
argument-hint: '<run|resume|status|list|add|remove|search|info|catalog> [workflow id or YAML path]'
---

# Spec Kit — workflows

Run and manage spec-kit automation workflows with the **Specify CLI**
`specify workflow` command group.

> **Prerequisite:** needs the `specify` CLI. If `specify --version` fails, install it
> with the **speckit-cli-setup** skill first.

## When to use

- Execute a multi-step spec-kit automation workflow.
- Resume a run that paused at a gate or failed, or check its status.
- Discover, install, or remove workflows.

## How to invoke

```bash
# Discover
specify workflow list
specify workflow search <query>
specify workflow info <id>             # details and step graph

# Run
specify workflow run <id-or-path>
specify workflow run <id> -i key=value -i other=value   # pass inputs
specify workflow run <id> --json                        # machine-readable outcome

# Resume / status
specify workflow status <run>
specify workflow resume <run>

# Install / remove
specify workflow add <id-or-url-or-path>
specify workflow remove <id>

# Catalogs (sources workflows are resolved from)
specify workflow catalog list
specify workflow catalog add <url> [--name <name>]
specify workflow catalog remove <index>         # by index

# Step types — see the speckit-workflow-step skill
specify workflow step --help
```

## Notes

- `run` accepts either an installed workflow **ID** or a path to a local **YAML** file.
- Pass inputs with repeated `-i key=value` (a.k.a. `--input`) flags.
- Use `--json` when you need to parse the run outcome programmatically; surface a
  human summary to the user afterward.
- If a run stops at a gate, use `specify workflow resume` rather than re-running
  from the start.
- To manage the **step types** workflows are built from, use the
  **speckit-workflow-step** skill.
