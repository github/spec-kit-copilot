---
name: speckit-extension
description: 'Manage Spec Kit extensions via `specify extension`. USE FOR: installing/removing/updating spec-kit extensions, searching the extension catalog, showing extension info, enabling/disabling extensions, setting extension resolution priority, managing extension catalogs. DO NOT USE FOR: presets (use speckit-preset), bundles (use speckit-bundle), or workflows (use speckit-workflow).'
argument-hint: '<list|add|remove|search|info|update|enable|disable|set-priority|catalog> [extension]'
---

# Spec Kit — extensions

Manage spec-kit extensions with the **Specify CLI** `specify extension` command
group. Extensions add reusable commands/hooks to a spec-kit project.

> **Prerequisite:** needs the `specify` CLI. If `specify --version` fails, install it
> with the **speckit-cli-setup** skill first.

## When to use

- Find, install, update, or remove a spec-kit extension.
- Temporarily enable/disable an extension or adjust its resolution priority.
- Add or manage extension catalog sources.

## How to invoke

```bash
# Discover
specify extension list
specify extension search <query>
specify extension info <name>

# Install
specify extension add <name>
specify extension add <name> --force            # overwrite if already installed
specify extension add <path> --dev              # install from a local directory
specify extension add <name> --from <url>       # install from a custom URL
specify extension add <name> --priority <n>     # lower number = higher precedence

# Lifecycle
specify extension update [<name>]               # update one or all extensions
specify extension enable <name>
specify extension disable <name>
specify extension set-priority <name> <n>
specify extension remove <name>

# Catalogs (sources extensions are resolved from)
specify extension catalog list
specify extension catalog add <https-url> --name <name> [--install-allowed] [--priority <n>] [--description <text>]
specify extension catalog remove <name>
```

> Extension catalog URLs must use **HTTPS**. New catalogs are **not** install-allowed
> by default — pass `--install-allowed` to permit installing extensions from them.

## Notes

- Resolution priority: **lower number = higher precedence** (default `10`).
- Prefer `specify extension search` first so you install the correct extension ID.
- `--dev` is for local development of an extension; point it at the extension's
  source directory.
- When the project was initialized in **skills mode** (see the speckit-init skill),
  an installed extension's commands land as `.github/skills/speckit-<cmd>/SKILL.md`.
  To make Copilot pick up the new skills **in the current session**, run
  **`/skills reload`** (no restart needed). They are also loaded automatically on the
  next session start.
