---
name: speckit-bundle
description: 'Discover, install, and author Spec Kit bundles via `specify bundle`. USE FOR: searching/showing/listing bundles, installing/updating/removing a bundle (a curated set of extensions/presets/integrations/workflows), validating a bundle manifest, building a distributable bundle artifact, initializing a project and installing a bundle, managing bundle catalog sources. DO NOT USE FOR: individual extensions/presets/integrations/workflows (use their respective skills).'
argument-hint: '<search|info|list|install|update|remove|validate|build|init|catalog> [bundle id or path]'
---

# Spec Kit — bundles

Discover, install, and author Spec Kit **bundles** with the **Specify CLI**
`specify bundle` command group. A bundle is a versioned, curated set of components
(extensions, presets, integrations, workflows) installed together through each
primitive's own machinery. (Requires Specify CLI **>= 0.11**.)

> **Prerequisite:** needs the `specify` CLI. If `specify --version` fails, install it
> with the **speckit-cli-setup** skill first.

## When to use

- Find and install a bundle, or update/remove an installed one.
- Author a bundle: validate its manifest and build a distributable artifact.
- Initialize a project and install a bundle in one step.

## How to invoke

```bash
# Discover
specify bundle search <query>
specify bundle info <bundle-id>        # full metadata + fully expanded component set
specify bundle list                    # bundles installed in this project

# Install / update / remove
specify bundle install <bundle-id-or-path>     # catalog id, .zip, dir, or bundle.yml
specify bundle install <bundle-id> --integration <key> --offline
specify bundle update <bundle-id>
specify bundle remove <bundle-id>      # removes only what this bundle contributed

# Initialize a project, then optionally install a bundle
specify bundle init [<bundle-id>] [--integration <key>] [--offline]

# Authoring
specify bundle validate                # manifest well-formed + references resolve
specify bundle build --path <dir> --output <dir>   # produce a versioned .zip

# Catalog sources
specify bundle catalog list
specify bundle catalog add <url> [--policy install-allowed|discovery-only] [--priority <n>] [--id <id>]
specify bundle catalog remove <id>
```

## Notes

- `install` accepts a catalog **bundle id** or a **local path** to a `.zip`, a bundle
  directory, or a `bundle.yml`.
- `remove` only uninstalls components the bundle contributed — no collateral removals.
- Use `--offline` to avoid network access when installing from local artifacts.
- For authoring, run `specify bundle validate` before `specify bundle build`.
- A bundle installs its components through each primitive's own machinery, so any
  **extension/command** components scaffold Copilot skills under `.github/skills/`
  (in a skills-mode project). Run **`/skills reload`** to pick those up in the current
  session, or they load on the next session start.
