# Spec Kit extensions

These packages are consumed by the **Specify CLI** (`specify extension add`),
not by the Copilot plugin marketplace. They have their own `extension.yml`
manifests and versions. Copilot canvas providers remain under `plugins/`.

- [Canvas Design](canvas-design/README.md) registers JSON settings pages for
  a compatible Canvas Designer provider. It does not ship that provider or
  register a Copilot marketplace entry.

## Versioning and releases

Each extension is versioned independently in its `extension.yml`. Update the
manifest and package README version together.

The **Release Extension** workflow validates and publishes Canvas Design as
`canvas-design.zip` when an `extension/canvas-design/vX.Y.Z` tag is pushed.
