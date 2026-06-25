---
name: speckit-workflow-step
description: 'Manage Spec Kit workflow step types via `specify workflow step`. USE FOR: listing built-in and custom workflow step types, installing/removing a custom step type from a catalog, searching/showing step-type info, managing step-type catalog sources. DO NOT USE FOR: running or installing whole workflows (use speckit-workflow), or bundles (use speckit-bundle).'
argument-hint: '<list|add|remove|search|info|catalog> [step type id]'
---

# Spec Kit — workflow step types

Manage the **step types** that workflows are composed of, using the **Specify CLI**
`specify workflow step` command group. (Requires Specify CLI **>= 0.11**.)

> **Prerequisite:** needs the `specify` CLI. If `specify --version` fails, install it
> with the **speckit-cli-setup** skill first.

## When to use

- Inspect which step types (built-in or custom) are available to workflows.
- Install or remove a custom step type, or manage step-type catalog sources.

## How to invoke

```bash
# Discover step types
specify workflow step list
specify workflow step search <query>
specify workflow step info <step-id>

# Install / remove custom step types
specify workflow step add <step-id>            # from the step catalog
specify workflow step remove <step-id>

# Manage step catalog sources
specify workflow step catalog list
specify workflow step catalog add <url>
specify workflow step catalog remove <index>   # by index
```

## Notes

- Step types are the building blocks referenced by workflow YAML; install the step
  types a workflow needs before running it (see the speckit-workflow skill).
- `list` shows both built-in and custom step types; only custom ones can be removed.
