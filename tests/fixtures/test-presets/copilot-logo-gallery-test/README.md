# Logo gallery test fixture

This repository-local Specify preset is **test-only** and is not in the
canonical preset catalog. It adds a Logo gallery **Designer tab** with a
`stock.image` upload and a separate **generated page** with a `hero.logo`
asset slot. The renderer places that slot below the page heading and
description, centered in a 240 px-wide container. This tests custom-page
placement without relying on the header or workflow intro slots.

Use an initialized Spec Kit project with the **current worktree's** Canvas
Design extension (version 0.1.18 or newer) and this preset installed for local
development. From the project root:

```powershell
specify extension add --dev <path-to-worktree>\spec-kit-extensions\extension-canvas-design
specify preset add --dev <path-to-worktree>\tests\fixtures\test-presets\copilot-logo-gallery-test
```

The gallery field requires the base extension's shared `stock.image`
definition and paired adapters; it does not define separate image code.
The `--dev` installations are local tests, not releases. Reopen Designer
through the Wizard handoff after installation so its composed load-page
command resolves all four registered templates. On the **Logo gallery** tab,
upload a supported image (PNG, JPEG, GIF, or WebP; at most 32 KiB), then
generate a canvas. Open the generated **Logo gallery** page and confirm the
uploaded image appears in its centered hero slot, with the "Gallery logo"
accessible description. Remove the image and generate a new canvas to confirm
the page renders without an image. Header and main-page Logos can be uploaded
independently and should not affect the gallery. The generated app should
still display the image when run without the preset or Canvas Design package.

The preset is consumed by `specify preset`, not by `copilot plugin`, and is
intentionally not published in `spec-kit-presets/catalog.json`.
