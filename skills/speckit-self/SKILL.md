---
name: speckit-self
description: 'Check for and apply Spec Kit CLI updates via `specify self`. USE FOR: checking whether a newer specify-cli release is available, previewing an upgrade with --dry-run, upgrading the CLI in place (optionally to a pinned tag). DO NOT USE FOR: checking project tools/integrations (use speckit-check) or managing extensions/presets/integrations/workflows.'
argument-hint: '<check|upgrade> [--dry-run] [--tag <version>]'
---

# Spec Kit — self (CLI maintenance)

Maintain the **Specify CLI** itself with the `specify self` command group.

> **Prerequisite:** needs the `specify` CLI. If `specify --version` fails, install it
> with the **speckit-cli-setup** skill first.

## When to use

- The user asks whether a newer `specify-cli` release exists.
- The user wants to upgrade the CLI, or preview what an upgrade would do.

## How to invoke

```bash
# Read-only: is a newer release available?
specify self check

# Preview the upgrade without changing anything
specify self upgrade --dry-run

# Upgrade in place
specify self upgrade

# Upgrade to a specific pinned release
specify self upgrade --tag <version>
```

## Notes

- `specify self check` is read-only and safe.
- Run `specify self upgrade --dry-run` first and show the user the preview before
  performing an actual in-place upgrade.
- After upgrading, run `specify version` (see the speckit-check skill) to confirm
  the new version.
