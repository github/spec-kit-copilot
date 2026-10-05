# Copilot-specific Spec Kit extensions

This catalog contains extensions that depend on Copilot-specific tools or
providers, not general-purpose Spec Kit extensions. These packages are consumed
by the **Specify CLI** (`specify extension add`), not by the Copilot plugin
marketplace. Their `catalog.json` and `extension.yml` manifests live here;
Copilot canvas providers remain under `plugins/`.

- [Canvas Design](extension-canvas-design/README.md) registers JSON settings pages for
  a compatible Canvas Designer provider. It does not ship that provider or
  register a Copilot marketplace entry.

## Installation

Register the catalog once, then install by ID:

```powershell
specify extension catalog add https://raw.githubusercontent.com/github/spec-kit-copilot/main/spec-kit-extensions/catalog.json --name spec-kit-copilot --install-allowed
specify extension add extension-canvas-design
```

Catalogs are discovery-only by default; `--install-allowed` permits installation.
The referenced release ZIP must be published before installation can succeed.
See the package README for provider requirements and direct-URL installation.

## Versioning and releases

Each extension is versioned independently in its `extension.yml`. Update the
manifest, catalog entry, and package README version together.
Package IDs, directory names, and ZIP names use `extension-<name>`.
Tags use `<extension-id>-vX.Y.Z`, matching the preset version suffix, and release
titles use `<extension-id> vX.Y.Z`. For example, version `0.1.0` of
`extension-canvas-design` is tagged `extension-canvas-design-v0.1.0` and ships
`extension-canvas-design.zip`. Standard filenames such as `extension.yml` and
`README.md` are unchanged. The discovery tag `canvas-design` is independent of
the package ID and remains unchanged.

To publish an extension from the GitHub Actions UI after merging those updates:

1. Open **Actions** in `github/spec-kit-copilot`.
2. Select **Release Extension Trigger**, then **Run workflow**.
3. Leave **Use workflow from** set to **main**, enter the extension's directory
   name under `spec-kit-extensions/` (for example, `extension-canvas-design`), and enter
   its manifest version (for example, `0.1.0`; an optional `v` prefix is accepted).
4. Click **Run workflow** and monitor the trigger run and subsequent release run.

Like **Release Preset Trigger**, the extension trigger validates its inputs,
checks that the extension directory and manifest exist, rejects existing tags,
then creates and pushes `<extension-id>-vX.Y.Z`. The separate **Release Extension**
workflow validates the tag version against the manifest and catalog, builds
`<extension-id>.zip` inline, generates release notes, and publishes the release
in one job. The extension must have an `extension.yml` and a matching entry in
this directory's `catalog.json`; no workflow edit is needed when adding one.

Both extension workflow files follow the same structure as their preset
counterparts and Spec Kit's release model. Only package-specific tag filters,
input examples, and terminology differ. Keep shared behavior aligned; do not add
separate jobs, reusable workflow calls, artifact handoffs, or extension-only
behavior.

Both manual triggers require a repository Actions secret named **`RELEASE_PAT`**
containing a token authorized to push tags. Checkout persists this credential
for the tag push, matching Spec Kit's core release trigger and allowing the
separate release workflow to start. Do not use the default `GITHUB_TOKEN` for
this handoff: its tag pushes do not trigger another workflow.

A maintainer can also push the tag directly:

```bash
git tag extension-canvas-design-v0.1.0
git push origin extension-canvas-design-v0.1.0
```

The directory name is used unchanged in tags and ZIP names; no additional
prefix or suffix is added by the workflows. Extension publishers listen for
`extension-*-vX.Y.Z` tags; preset publishers listen for `copilot-*-vX.Y.Z` tags.
Each package release starts only its own publisher. Versions are parsed after
the final `-v`, including when a directory name itself contains `-v`.

Release notes use the extension's `CHANGELOG.md` when present, otherwise a
short release title. Notes are passed to GitHub CLI through a file so changelog
content is never interpolated into a shell script. ZIPs use the same shell `zip`
command and exclusion patterns as presets. Pull requests and branch pushes do not
run the release workflow.

If tagging succeeds but publication fails, retry the failed **Release Extension**
run, not the trigger (which rejects the existing tag). Existing releases are not
overwritten automatically. Release a new version if a code fix is needed after
tagging, rather than moving the old tag.
