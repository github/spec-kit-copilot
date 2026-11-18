import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { test, expect } from "./playwright.mjs";

const require = createRequire(new URL(
    "../../plugins/spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/package.json",
    import.meta.url,
));
const { load } = require("js-yaml");
const fixtureRoot = fileURLToPath(new URL("../fixtures/test-presets/", import.meta.url));
const catalog = JSON.parse(await readFile(
    new URL("../../spec-kit-presets/catalog.json", import.meta.url), "utf8"));
const fixtures = (await readdir(fixtureRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^copilot-.*-test$/.test(entry.name))
    .map((entry) => entry.name);
const journeys = {
    "copilot-badge-input-test": "preset-generated.spec.mjs",
    "copilot-billing-canvas-test": "designer-pages.spec.mjs",
    "copilot-canvas-design-test": "preset-designer.spec.mjs",
    "copilot-canvas-values-test": "preset-generated.spec.mjs",
    "copilot-dialog-buttons-test": "preset-generated.spec.mjs",
    "copilot-generated-page-test": "preset-generated.spec.mjs",
    "copilot-logo-gallery-test": "preset-generated.spec.mjs",
    "copilot-minimal-essentials-test": "preset-designer.spec.mjs",
    "copilot-phase-view-label-test": "preset-generated.spec.mjs",
    "copilot-risk-matrix-test": "preset-generated.spec.mjs",
    "copilot-wizard-layer-test": "wizard-journeys.spec.mjs",
};

test("test presets are separate from the shipping catalog and preset directory", async () => {
    expect(fixtures).not.toHaveLength(0);
    const shippingRoot = new URL("../../spec-kit-presets/", import.meta.url);
    const shipping = (await readdir(shippingRoot, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    expect(shipping.filter((name) => name.endsWith("-test"))).toEqual([]);
    expect(fixtures.filter((name) => name in catalog.presets)).toEqual([]);
});

test("every test preset has a behavioral Playwright journey and valid manifest", async () => {
    expect(Object.keys(journeys).sort()).toEqual(fixtures.sort());
    for (const name of fixtures) {
        const { preset: manifest, requires } = load(
            await readFile(join(fixtureRoot, name, "preset.yml"), "utf8"));
        expect(manifest.id).toBe(name);
        expect(manifest.version).toBeTruthy();
        if (requires?.extensions?.length) {
            expect(requires.extensions).toEqual(["extension-canvas-design"]);
        }
        const spec = await readFile(new URL(journeys[name], import.meta.url), "utf8");
        const selector = journeys[name] === "preset-generated.spec.mjs"
            ? `journeyFor(page, "${name.slice("copilot-".length, -"-test".length)}"`
            : name === "copilot-wizard-layer-test" ? `${name}/` : `"${name}"`;
        expect(spec, `${name}: missing mapped behavioral journey`).toContain(selector);
    }
});
