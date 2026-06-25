---
name: speckit-check
description: 'Check the local environment for Spec Kit by running `specify check` (and `specify version`). USE FOR: verifying required tools are installed, diagnosing a broken spec-kit setup, reporting CLI version/feature capabilities. DO NOT USE FOR: installing or upgrading the CLI itself (use the speckit-self skill).'
argument-hint: 'none (optionally "version" for version/feature details)'
---

# Spec Kit — check & version

Inspect the local Spec Kit environment with the **Specify CLI**. This skill exposes
the read-only `specify check` and `specify version` commands.

> **Prerequisite:** needs the `specify` CLI. If `specify --version` fails, install it
> with the **speckit-cli-setup** skill first.

## When to use

- Before/after `specify init` to confirm required tools are present.
- To report the installed CLI version and feature capabilities.

## How to invoke

```bash
# Check that all required tools are installed
specify check

# Show version and system information
specify version

# Show local CLI feature capabilities
specify version --features

# Machine-readable capabilities
specify version --features --json
```

## Notes

- These commands are read-only and safe to run without confirmation.
- If the user reports a version problem, hand off to the **speckit-self** skill to
  check for and apply CLI upgrades.
