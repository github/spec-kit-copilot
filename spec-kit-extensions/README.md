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

The **Release Extension** workflow validates and publishes Canvas Design as
`canvas-design.zip` when an `extension/canvas-design/vX.Y.Z` tag is pushed.
