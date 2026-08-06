---
name: speckit-preset
description: 'Manage Spec Kit presets via `specify preset`. USE FOR: installing/removing presets, searching the preset catalog, showing preset info, resolving which template a preset name maps to, enabling/disabling presets, setting preset resolution priority, managing preset catalogs. DO NOT USE FOR: extensions (use speckit-extension), bundles (use speckit-bundle), or workflows (use speckit-workflow).'
argument-hint: '<list|add|remove|search|resolve|info|set-priority|enable|disable|catalog> [preset id]'
---

# Spec Kit — presets

Manage spec-kit presets with the **Specify CLI** `specify preset` command group.
Presets bundle templates/configuration for a particular domain or workflow.

> **Prerequisite:** needs the `specify` CLI. If `specify --version` fails, install it
> with the **speckit-cli-setup** skill first.

## When to use

- Find, install, or remove a preset.
- Check which template a preset name resolves to.
- Enable/disable a preset or adjust its resolution priority.

## How to invoke

```bash
# Discover
specify preset list
specify preset search <query>
specify preset info <id>
specify preset resolve <name>          # show which template a name resolves to

# Install
specify preset add <id>
specify preset add --from <url>        # install from a ZIP URL
specify preset add --dev <path>        # install from a local directory
specify preset add <id> --priority <n> # lower number = higher precedence

# Lifecycle
specify preset enable <id>
specify preset disable <id>
specify preset set-priority <id> <n>
specify preset remove <id>

# Catalogs (sources presets are resolved from)
specify preset catalog list
specify preset catalog add <url> --name <name> [--install-allowed]
specify preset catalog remove <name>
```

## Notes

- Resolution priority: **lower number = higher precedence** (default `10`).
- **Catalogs are added discovery-only by default.** `specify preset catalog add`
  requires `--name` and defaults to `--no-install-allowed`; presets from a
  discovery-only catalog can be browsed but not installed (install errors with a
  "discovery-only" message). Pass `--install-allowed` to permit installs — only for
  catalogs you trust. The `install_allowed` policy lives in the consumer's
  `.specify/preset-catalogs.yml`, not in the catalog's own `catalog.json`.
- A preset can also be installed at project creation:
  `specify init <name> --integration copilot --integration-options="--skills" --script sh --preset <id>`
  (use `--script ps` on Windows; see the speckit-init skill for the full OS-aware form and
  why `--script` is required).
- Use `specify preset resolve` to debug unexpected template resolution.
- Unlike extensions/bundles, `specify preset add` does **not** scaffold skills — a
  preset overrides the **templates** used to generate command content and is applied
  at **init** time. `/skills reload` only matters if a regeneration actually changes
  `SKILL.md` files under `.github/skills/`.
