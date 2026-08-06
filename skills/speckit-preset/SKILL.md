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
specify preset catalog add <url>
specify preset catalog remove <name>
```

## Notes

- Resolution priority: **lower number = higher precedence** (default `10`).
- **Official Copilot preset catalog (this repo).** This repository publishes
  Copilot-specific presets. Register the catalog, then install by id:
  ```bash
  specify preset catalog add https://raw.githubusercontent.com/mnriem/spec-kit-copilot/main/spec-kit-presets/catalog.json
  specify preset add copilot-sub-agents      # parallelize core commands via Copilot sub-agents
  specify preset add assess-ask-questions    # ask_user clarifying round; needs the `assess` extension
  ```
  These are consumed by `specify preset`, not `copilot plugin` — they are not Copilot
  plugins/skills. See `spec-kit-presets/README.md` in this repo for the boundary.
- A preset can also be installed at project creation:
  `specify init <name> --integration copilot --integration-options="--skills" --script sh --preset <id>`
  (use `--script ps` on Windows; see the speckit-init skill for the full OS-aware form and
  why `--script` is required).
- Use `specify preset resolve` to debug unexpected template resolution.
- Unlike extensions/bundles, `specify preset add` does **not** scaffold skills — a
  preset overrides the **templates** used to generate command content and is applied
  at **init** time. `/skills reload` only matters if a regeneration actually changes
  `SKILL.md` files under `.github/skills/`.
