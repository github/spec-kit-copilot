# Spec Kit extensions

These packages are consumed by the **Specify CLI** (`specify extension add`),
not by the Copilot plugin marketplace. They have their own `extension.yml`
manifests and versions. Copilot canvas providers remain under `plugins/`.

- [Canvas Design](canvas-design/README.md) registers JSON settings pages for
  a compatible Canvas Designer provider. It does not ship that provider or
  register a Copilot marketplace entry.

## Versioning and releases

Each extension is versioned independently in its `extension.yml`. Canvas Design
uses `extension/canvas-design/vX.Y.Z` tags and the `canvas-design.zip` release
asset. This tag namespace does not match the preset release workflow.
There is no extension catalog in this extraction.

The **Release Extension** workflow validates the package, builds the ZIP inline,
and checks its contents on relevant pull requests and pushes to `main`.
Publishing follows the existing **Release Preset** approach: a maintainer pushes
a version tag, and the tag-triggered workflow packages and publishes the release.
There is no separate manual-dispatch publishing path, and the workflow does not
create or push tags. A failed release job can be rerun against its existing tag.
Update the manifest and package README version together before a future release.
After those changes merge, tag the reviewed commit on `main` with
`extension/canvas-design/v<manifest-version>` and push that tag normally.
Publishing is a separate maintainer action; adding this package does not publish
it, enable a Designer, or migrate an existing Wizard consumer.
