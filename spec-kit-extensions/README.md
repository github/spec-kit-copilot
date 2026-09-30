# Copilot-specific Spec Kit extensions

This catalog contains extensions that depend on Copilot-specific tools or
providers, not general-purpose Spec Kit extensions. These packages are consumed
by the **Specify CLI** (`specify extension add`), not by the Copilot plugin
marketplace. Their `catalog.json` and `extension.yml` manifests live here;
Copilot canvas providers remain under `plugins/`.

- [Canvas Design](canvas-design/README.md) registers JSON settings pages for
  a compatible Canvas Designer provider. It does not ship that provider or
  register a Copilot marketplace entry.

## Installation

Register the catalog once, then install by ID:

```powershell
specify extension catalog add https://raw.githubusercontent.com/github/spec-kit-copilot/main/spec-kit-extensions/catalog.json --name spec-kit-copilot --install-allowed
specify extension add canvas-design
```

Catalogs are discovery-only by default; `--install-allowed` permits installation.
The referenced release ZIP must be published before installation can succeed.
See the package README for provider requirements and direct-URL installation.

## Versioning and releases

Each extension is versioned independently in its `extension.yml`. Update the
manifest, catalog entry, and package README version together.

To publish an extension from the GitHub Actions UI after merging those updates:

1. Open **Actions** in `github/spec-kit-copilot`.
2. Select **Release Extension Trigger**, then **Run workflow**.
3. Leave **Use workflow from** set to **main**, enter the extension's directory
   name under `spec-kit-extensions/` (for example, `canvas-design`), and enter
   its manifest version (for example, `0.1.0`; an optional `v` prefix is accepted).
4. Click **Run workflow** and monitor its packaging and release jobs.

The trigger calls the reusable **Release Extension** workflow as part of the
same run. GitHub's built-in `GITHUB_TOKEN` can create tags and publish releases,
but tags pushed with it do not automatically start another workflow. Calling
the publisher directly avoids that limitation; no personal access token is
needed. The publisher validates the requested extension/version, manifest,
catalog version and download URL, tests the package
and ZIP, then creates `extension/<extension-id>/vX.Y.Z` at the selected commit
and publishes `<extension-id>.zip`. The extension must have an `extension.yml`
and a matching entry in this directory's `catalog.json`; no workflow edit is
needed when adding another extension.

Packaging rejects missing or non-file assets declared under `provides`,
including command files, templates, and configuration templates. The ZIP is
verified against the complete package file inventory before a tag is created.

Direct pushes of `extension/<extension-id>/vX.Y.Z` tags run the same publisher
for that extension. Pull requests and relevant pushes to `main` validate and
package every extension directory containing `extension.yml`; they do not
create tags or releases.

If tagging succeeds but no release is created, use **Re-run failed jobs** on the
original Actions run to retry the same commit. An existing tag is reused only
if it points to that commit; a tag pointing elsewhere is rejected and never
moved. Publication uses the same single `gh release create` command as preset
releases; existing releases are not overwritten or repaired automatically.
If a code fix is needed after tagging, release a new version instead of moving
the old tag.
