---
name: speckit-artifact
description: 'Inspect the effective Spec Kit artifact inventory and composition stacks via `specify artifact`. USE FOR: listing commands/templates/scripts/hooks, explaining which preset or extension layer supplies an artifact, inspecting resolution precedence and hidden layers, checking hook registration, or resolving a stack lookupId to its validated contribution. DO NOT USE FOR: installing or changing presets/extensions (use speckit-preset or speckit-extension), resolving only a preset-managed filename (use speckit-preset), or running an artifact.'
argument-hint: '<list|info|lookup> [artifact name or lookupId] --json'
---

# Spec Kit — artifacts

Inspect commands, templates, scripts, hooks, and their effective composition
stacks with the **Specify CLI** `specify artifact` command group. Requires
Specify CLI **>= 1.0.7**.

> **Prerequisite:** needs the `specify` CLI. If `specify --version` fails, install it
> with the **speckit-cli-setup** skill first.

## When to use

- List every command, template, script, and hook visible to a Spec Kit project.
- Explain which project, preset, extension, or built-in layer supplies an artifact.
- Inspect precedence, composition strategy, active layers, and hidden layers.
- Check whether declared hooks are registered and active.
- Resolve a stack entry back to the validated manifest contribution Spec Kit uses.

## How to invoke

```bash
# Full artifact inventory, including composition stacks
specify artifact list --json

# Inspect one artifact by bare name or source-agnostic artifact id
specify artifact info <name> --json
specify artifact info <kind>:<name> --json
specify artifact info <name> --kind <command|template|script|hook> --json

# Resolve a manifest-backed stack layer to its effective contribution
specify artifact lookup <lookupId> --json
```

## Identifiers

- An artifact `id` has the form `<kind>:<name>`, such as
  `command:speckit.specify`. Pass this value to `specify artifact info`.
- A stack entry's `lookupId` identifies the preset or extension contribution
  behind that layer. Pass this opaque value unchanged to
  `specify artifact lookup`.
- Built-in layers do not have a `lookupId`. Project or convention-only layers may
  not have a manifest contribution that `lookup` can resolve.

## Notes

- All `specify artifact` subcommands are read-only.
- `--json` is currently required. A missing `--json` is a usage error.
- Run commands from an initialized Spec Kit project containing `.specify/`.
- `list` and `info` return ordered stacks. For commands, templates, and scripts,
  index `0` is the winning layer. Hook stacks are additive, so multiple entries
  can be active.
- Composition strategies are `replace`, `wrap`, `prepend`, `append`, and
  `additive` for hooks.
- `active` and `hidden` are independent: an inactive layer can still participate
  in composed output unless a higher `replace` layer hides it.
- Hook artifact ids percent-encode event and target-command components. Reuse ids
  and lookupIds exactly as returned instead of constructing them manually.
