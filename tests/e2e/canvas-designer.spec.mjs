import { test, expect } from "./playwright.mjs";
import { fileURLToPath } from "node:url";
import { validateLocalSource } from "../../plugins/spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/server/designer-local-sources.mjs";

// A real, valid preset directory in this repo — used to exercise the
// "Local development" add flow against an actual manifest on disk, matching
// how the E2E server wires getInstance() to the real repo root rather than a
// fixture workspace.
const LOCAL_PRESET_PATH = fileURLToPath(
    new URL("../../spec-kit-presets/copilot-sub-agents", import.meta.url),
).replace(/[\\/]$/, "");
const LOCAL_CANVAS_DESIGN_PATH = fileURLToPath(
    new URL("../../spec-kit-extensions/extension-canvas-design", import.meta.url),
).replace(/[\\/]$/, "");
const localPreset = await validateLocalSource("presets", LOCAL_PRESET_PATH);
const localCanvasDesign = await validateLocalSource("extensions", LOCAL_CANVAS_DESIGN_PATH);
const LOCAL_VERTICAL_CONTROL_PATH = fileURLToPath(
    new URL("../../spec-kit-presets/copilot-vertical-phase-control", import.meta.url),
).replace(/[\\/]$/, "");
const localVerticalControl = await validateLocalSource("presets", LOCAL_VERTICAL_CONTROL_PATH);

async function expectQueuedLaunch(response) {
    const body = await response.json();
    expect(response.status(), JSON.stringify(body)).toBe(202);
    expect(body).toEqual({ queued: true });
}

test.beforeEach(async ({ page }) => {
    await page.goto("/?token=e2e-token");
    await page.getByRole("tab", { name: "Phases" }).click();
    await page.getByRole("button", { name: "Generate canvas" }).click();
});

test("renders only eligible catalog IDs in each Designer tab", async ({ page }) => {
    const response = await page.request.get("/api/state?token=e2e-token");
    expect(response.ok()).toBe(true);
    const { catalog } = await response.json();
    const dialog = page.getByRole("dialog", { name: "Canvas Designer setup" });

    for (const [kind, tab] of [
        ["presets", "Presets"], ["extensions", "Extensions"], ["bundles", "Bundles"],
    ]) {
        expect(catalog[kind].some((item) => !item.tags?.includes("canvas-design"))).toBe(true);
        const expected = catalog[kind]
            .filter((item) => item?.id && Array.isArray(item.tags)
                && item.tags.includes("canvas-design")
                && (["community", "copilot"].includes(item.source)
                    || (kind === "bundles" && item.source === "default")))
            .map((item) => item.id).sort();
        await dialog.getByRole("tab", { name: tab }).click();
        const rendered = await dialog.getByRole("tabpanel", { name: tab })
            .locator("input[data-designer-id]")
            .evaluateAll((elements) => elements.map((element) => element.dataset.designerId));
        expect(rendered.sort()).toEqual(expected);
    }
});

test("opens a design-only dialog with an available launch", async ({ page }) => {
    const dialog = page.getByRole("dialog", { name: "Canvas Designer setup" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("checkbox", { name: /Design preset/ })).toBeVisible();
    await expect(dialog.getByRole("button", { name: /Launch designer/ })).toBeEnabled();
    const presetsTab = dialog.getByRole("tab", { name: "Presets" });
    const extensionsTab = dialog.getByRole("tab", { name: "Extensions" });
    const bundlesTab = dialog.getByRole("tab", { name: "Bundles" });
    await expect(presetsTab).toHaveAttribute("tabindex", "0");
    await expect(extensionsTab).toHaveAttribute("tabindex", "-1");
    await page.keyboard.press("Tab");
    await expect(presetsTab).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(extensionsTab).toBeFocused();
    await expect(dialog.getByRole("tabpanel", { name: "Extensions" })).toBeVisible();
    await expect(dialog.getByRole("checkbox", { name: /^Design extension\b/ })).toBeVisible();
    await page.keyboard.press("End");
    await expect(bundlesTab).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(presetsTab).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(bundlesTab).toBeFocused();
    await page.keyboard.press("Home");
    await expect(presetsTab).toBeFocused();
    await bundlesTab.click();
    await expect(bundlesTab).toHaveAttribute("tabindex", "0");
    await expect(presetsTab).toHaveAttribute("tabindex", "-1");
    await expect(dialog.getByRole("checkbox", { name: /Design bundle/ })).toBeVisible();
    await dialog.getByRole("checkbox", { name: /Default bundle/ }).check();
    await expect(dialog.getByRole("checkbox", { name: /Default bundle/ })).toBeChecked();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    await page.getByRole("button", { name: "Generate canvas" }).click();
    await expect(page.getByRole("dialog", { name: "Canvas Designer setup" })
        .getByRole("checkbox", { name: /Design preset/ })).not.toBeChecked();
});

test("confirms community selection and checks only listed design bundle members", async ({ page }) => {
    const writes = [];
    page.on("request", (request) => {
        if (request.method() !== "GET") writes.push(request.url());
    });
    const dialog = page.getByRole("dialog", { name: "Canvas Designer setup" });
    await dialog.getByRole("tab", { name: "Bundles" }).click();
    const community = dialog.getByRole("checkbox", { name: /Community bundle/ });
    await community.check();
    const warning = page.getByRole("dialog", { name: "Select community bundle?" });
    await expect(warning.getByText(/not reviewed, audited, or endorsed/)).toBeVisible();
    await expect(page.locator(".designer-backdrop")).toHaveJSProperty("inert", true);
    await expect(page.locator(".designer-backdrop")).toHaveAttribute("aria-hidden", "true");
    await expect(dialog).toHaveCount(0);
    await warning.getByRole("button", { name: "Cancel" }).click();
    await expect(page.locator(".designer-backdrop")).toHaveJSProperty("inert", false);
    await expect(page.locator(".designer-backdrop")).not.toHaveAttribute("aria-hidden", "true");
    await expect(dialog).toBeVisible();
    await expect(community).toBeFocused();
    await expect(community).not.toBeChecked();
    await community.check();
    await warning.getByRole("button", { name: "Select anyway" }).click();
    await expect(page.locator(".designer-backdrop")).toHaveJSProperty("inert", false);
    await expect(page.locator(".designer-backdrop")).not.toHaveAttribute("aria-hidden", "true");
    await expect(community).toBeFocused();
    await expect(community).toBeChecked();

    await dialog.getByRole("checkbox", { name: /Design bundle/ }).check();
    await warning.getByRole("button", { name: "Select anyway" }).click();
    await dialog.getByRole("tab", { name: "Presets" }).click();
    const presets = dialog.getByRole("tabpanel", { name: "Presets" });
    const preset = presets.getByRole("checkbox", { name: /Design preset/ });
    await expect(preset).toBeChecked();
    await expect(preset.locator("..")).toHaveAttribute("title", 'Preset with "quoted" settings');
    await expect(presets.getByText("Included by bundle: Design bundle")).toBeVisible();
    await expect(presets.getByRole("checkbox", { name: /Copilot preset/ })).not.toBeChecked();
    await preset.uncheck();
    await expect(preset).not.toBeChecked();
    await dialog.getByRole("tab", { name: "Extensions" }).click();
    await expect(dialog.getByRole("checkbox", { name: /^Design extension\b/ })).toBeChecked();
    await expect(dialog.getByRole("button", { name: /Launch designer/ })).toBeEnabled();
    expect(writes).toEqual([]);
});

test("community presets and extensions retain their selection warnings", async ({ page }) => {
    const dialog = page.getByRole("dialog", { name: "Canvas Designer setup" });
    for (const [tab, name, kind] of [
        ["Presets", "Design preset", "preset"],
        ["Extensions", "Design extension", "extension"],
    ]) {
        await dialog.getByRole("tab", { name: tab }).click();
        const choice = dialog.getByRole("checkbox", { name: new RegExp(`^${name}\\b`) });
        await choice.check();
        const warning = page.getByRole("dialog", { name: `Select community ${kind}?` });
        await expect(warning.getByText(/not reviewed, audited, or endorsed/)).toBeVisible();
        await expect(warning.getByText("This selection will be installed in the launched Canvas designer session.")).toBeVisible();
        await warning.getByRole("button", { name: "Cancel" }).click();
        await expect(choice).not.toBeChecked();
        await expect(choice).toBeFocused();
        await choice.check();
        await warning.getByRole("button", { name: "Select anyway" }).click();
        await expect(choice).toBeChecked();
        await expect(choice).toBeFocused();
    }
});

test("launch queues a session and closes the dialog", async ({ page }) => {
    const dialog = page.getByRole("dialog", { name: "Canvas Designer setup" });
    const responsePromise = page.waitForResponse((response) =>
        response.url().includes("/api/designer/launch") && response.request().method() === "POST");
    await dialog.getByRole("button", { name: "Launch designer" }).click();
    const response = await responsePromise;
    await expectQueuedLaunch(response);
    expect(response.request().postDataJSON()).toMatchObject({
        selections: { presets: [], extensions: [{
            id: localCanvasDesign.id, source: "copilot", approved: true,
        }], bundles: [] },
        catalogFingerprint: "e2e-catalog",
    });

    await expect(dialog).toHaveCount(0);
    await page.getByRole("button", { name: "Generate canvas" }).click();
    await expect(page.getByRole("dialog", { name: "Canvas Designer setup" })
        .getByRole("checkbox", { name: /Copilot preset/ })).not.toBeChecked();
});

test("activation failure preserves selections for a one-click retry", async ({ page }) => {
    const requests = [];
    await page.route("**/api/designer/launch?*", async (route) => {
        const body = route.request().postDataJSON();
        requests.push(body);
        await route.fulfill({
            status: requests.length === 1 ? 503 : 202,
            contentType: "application/json",
            body: JSON.stringify(requests.length === 1
                ? { error: "Designer activation timed out" } : { queued: true }),
        });
    });
    const dialog = page.getByRole("dialog", { name: "Canvas Designer setup" });
    const preset = dialog.getByRole("checkbox", { name: /Copilot preset/ });
    await preset.check();
    await dialog.getByRole("button", { name: "Launch designer" }).click();
    await expect(dialog.getByRole("alert")).toContainText("activation timed out");
    await expect(preset).toBeChecked();
    await dialog.getByRole("button", { name: "Launch designer" }).click();
    await expect(dialog).toHaveCount(0);
    expect(requests.map((body) => body.enableProvider ?? false)).toEqual([false, false]);
    expect(requests.map((body) => body.selections.presets)).toEqual(Array(2).fill([
        { id: "foreign-preset", source: "copilot", approved: true },
    ]));
});

test("local development section is a single shared section, collapsed by default, covering presets and extensions only", async ({ page }) => {
    const dialog = page.getByRole("dialog", { name: "Canvas Designer setup" });
    const localSection = dialog.locator("[data-designer-local]");
    await expect(localSection).toHaveCount(1);
    await expect(localSection).toBeVisible();
    await expect(localSection.locator("summary")).toHaveText("Local development");
    await expect(localSection).not.toHaveJSProperty("open", true);
    await expect(dialog.getByText(/Add local preset or extension directories to the selection/)).toBeHidden();
    await localSection.locator("summary").click();
    await expect(dialog.getByText(/takes precedence over a catalog selection/)).toBeVisible();
    // A single shared path input/add button covers both local kinds (the
    // server auto-detects preset vs. extension from the manifest file), and
    // the section stays visible across tab switches since it renders
    // outside the tabpanels rather than nested per tab.
    await expect(localSection.locator("[data-designer-local-path]")).toHaveCount(1);
    await expect(localSection.locator("[data-designer-local-add]")).toHaveCount(1);
    await dialog.getByRole("tab", { name: "Bundles" }).click();
    await expect(localSection).toBeVisible();
    await dialog.getByRole("tab", { name: "Presets" }).click();
    const presets = dialog.getByRole("tabpanel", { name: "Presets" });
    await expect(presets.getByRole("checkbox", { name: /Design preset/ })).toBeVisible();
});

test("adds a local preset via typed absolute path, checks it in automatically, and it wins over a hosted id", async ({ page }) => {
    const dialog = page.getByRole("dialog", { name: "Canvas Designer setup" });
    const localSection = dialog.locator("[data-designer-local]");
    await localSection.locator("summary").click();
    await localSection.locator("[data-designer-local-path]").fill(LOCAL_PRESET_PATH);
    await localSection.locator("[data-designer-local-add]").click();
    const localItem = localSection.locator(".designer-local-item");
    await expect(localItem).toHaveCount(1);
    await expect(localItem.getByText(localPreset.name)).toBeVisible();
    await expect(localItem.getByText(`${localPreset.id} · v${localPreset.version}`)).toBeVisible();
    await expect(localItem.getByText("Preset", { exact: true })).toBeVisible();
    await expect(localItem.getByRole("checkbox")).toBeChecked();

    const responsePromise = page.waitForResponse((response) =>
        response.url().includes("/api/designer/launch") && response.request().method() === "POST");
    await dialog.getByRole("button", { name: "Launch designer" }).click();
    const response = await responsePromise;
    await expectQueuedLaunch(response);
    expect(response.request().postDataJSON()).toMatchObject({
        localSelections: { presets: [{ id: "copilot-sub-agents", path: LOCAL_PRESET_PATH }] },
    });
});

test("checked worktree Canvas Design extension is included in the launch request", async ({ page }) => {
    const dialog = page.getByRole("dialog", { name: "Canvas Designer setup" });
    const localSection = dialog.locator("[data-designer-local]");
    await localSection.locator("summary").click();
    await localSection.locator("[data-designer-local-path]").fill(LOCAL_CANVAS_DESIGN_PATH);
    await localSection.locator("[data-designer-local-add]").click();
    await expect(localSection.locator(".designer-local-item"))
        .toContainText(`${localCanvasDesign.id} · v${localCanvasDesign.version}`);
    await expect(localSection.locator(".designer-local-item .designer-choice"))
        .toHaveAttribute("title", localCanvasDesign.description);
    await expect(localSection.locator(".designer-local-item").getByRole("checkbox")).toBeChecked();
    const responsePromise = page.waitForResponse((response) =>
        response.url().includes("/api/designer/launch") && response.request().method() === "POST");
    await dialog.getByRole("button", { name: "Launch designer" }).click();
    const response = await responsePromise;
    await expectQueuedLaunch(response);
    expect(response.request().postDataJSON().localSelections).toEqual({
        extensions: [{ id: "extension-canvas-design", path: LOCAL_CANVAS_DESIGN_PATH }],
    });

});

test("local Generate carries both Canvas Design and vertical phase control selections", async ({ page }) => {
    const dialog = page.getByRole("dialog", { name: "Canvas Designer setup" });
    const localSection = dialog.locator("[data-designer-local]");
    await localSection.locator("summary").click();
    for (const path of [LOCAL_CANVAS_DESIGN_PATH, LOCAL_VERTICAL_CONTROL_PATH]) {
        await localSection.locator("[data-designer-local-path]").fill(path);
        await localSection.locator("[data-designer-local-add]").click();
        await expect(localSection.locator("[data-designer-local-add]")).toBeEnabled();
    }
    await expect(localSection.locator(".designer-local-item")).toHaveCount(2);
    await expect(localSection).toContainText(`${localVerticalControl.id} · v${localVerticalControl.version}`);
    const responsePromise = page.waitForResponse((response) =>
        response.url().includes("/api/designer/launch") && response.request().method() === "POST");
    await dialog.getByRole("button", { name: "Launch designer" }).click();
    const response = await responsePromise;
    await expectQueuedLaunch(response);
    expect(response.request().postDataJSON().localSelections).toEqual({
        extensions: [{ id: "extension-canvas-design", path: LOCAL_CANVAS_DESIGN_PATH }],
        presets: [{ id: "copilot-vertical-phase-control", path: LOCAL_VERTICAL_CONTROL_PATH }],
    });
});

test("rejects an invalid local path with an explicit error and lets the user retry", async ({ page }) => {
    const dialog = page.getByRole("dialog", { name: "Canvas Designer setup" });
    const localSection = dialog.locator("[data-designer-local]");
    await localSection.locator("summary").click();
    const pathInput = localSection.locator("[data-designer-local-path]");
    await pathInput.fill("relative/not-absolute");
    await localSection.locator("[data-designer-local-add]").click();
    await expect(localSection.locator("[data-designer-local-error]")).toContainText("must be absolute");
    const localItem = localSection.locator(".designer-local-item");
    await expect(localItem).toHaveCount(0);

    await pathInput.fill(LOCAL_PRESET_PATH);
    await localSection.locator("[data-designer-local-add]").click();
    await expect(localItem).toHaveCount(1);
});

test("local sources reset on dialog close/reopen but are retained after a launch failure", async ({ page }) => {
    const dialog = page.getByRole("dialog", { name: "Canvas Designer setup" });
    const localSection = dialog.locator("[data-designer-local]");
    await localSection.locator("summary").click();
    await localSection.locator("[data-designer-local-path]").fill(LOCAL_PRESET_PATH);
    await localSection.locator("[data-designer-local-add]").click();
    const localItem = localSection.locator(".designer-local-item");
    await expect(localItem).toHaveCount(1);

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    await page.getByRole("button", { name: "Generate canvas" }).click();
    const reopened = page.getByRole("dialog", { name: "Canvas Designer setup" });
    const reopenedLocalSection = reopened.locator("[data-designer-local]");
    const reopenedLocalItem = reopenedLocalSection.locator(".designer-local-item");
    await expect(reopenedLocalSection).not.toHaveJSProperty("open", true);
    await expect(reopenedLocalItem).toHaveCount(0);

    await reopenedLocalSection.locator("summary").click();
    await reopenedLocalSection.locator("[data-designer-local-path]").fill(LOCAL_PRESET_PATH);
    await reopenedLocalSection.locator("[data-designer-local-add]").click();
    await expect(reopenedLocalItem).toHaveCount(1);

    await page.route("**/api/designer/launch?*", async (route) => {
        await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: "Designer activation timed out" }),
        });
    });
    await reopened.getByRole("button", { name: "Launch designer" }).click();
    await expect(reopened.getByRole("alert")).toContainText("activation timed out");
    await expect(reopenedLocalItem).toHaveCount(1);
    await expect(reopenedLocalItem.getByRole("checkbox")).toBeChecked();
});

test("local controls and hosted launch stay disabled for the whole in-flight add request", async ({ page }) => {
    const dialog = page.getByRole("dialog", { name: "Canvas Designer setup" });
    const localSection = dialog.locator("[data-designer-local]");
    await localSection.locator("summary").click();
    const pathInput = localSection.locator("[data-designer-local-path]");
    const addBtn = localSection.locator("[data-designer-local-add]");
    const launchBtn = dialog.getByRole("button", { name: "Launch designer" });

    // Add a first local source normally so there is an existing
    // checkbox/Remove pair to assert stays disabled during a second,
    // still-pending add — this is what the `inspecting` counter gates
    // beyond just the Add button/path input.
    await pathInput.fill(LOCAL_PRESET_PATH);
    await addBtn.click();
    const firstItem = localSection.locator(".designer-local-item").first();
    await expect(firstItem).toHaveCount(1);

    let releaseResponse;
    const gate = new Promise((resolve) => { releaseResponse = resolve; });
    await page.route("**/api/designer/local-source?*", async (route) => {
        await gate;
        await route.fulfill({
            status: 400,
            contentType: "application/json",
            body: JSON.stringify({ error: "A local preset with id \"copilot-sub-agents\" is already added." }),
        });
    });
    await pathInput.fill(LOCAL_PRESET_PATH);
    const addClick = addBtn.click();
    await expect(addBtn).toBeDisabled();
    await expect(pathInput).toBeDisabled();
    await expect(firstItem.getByRole("checkbox")).toBeDisabled();
    await expect(firstItem.getByRole("button", { name: "Remove" })).toBeDisabled();
    await expect(launchBtn).toBeDisabled();

    releaseResponse();
    await addClick;
    await expect(addBtn).toBeEnabled();
    await expect(pathInput).toBeEnabled();
    await expect(firstItem.getByRole("checkbox")).toBeEnabled();
    await expect(firstItem.getByRole("button", { name: "Remove" })).toBeEnabled();
    await expect(launchBtn).toBeEnabled();
});

test("rejects adding a 21st local preset, mirroring the server's 20-per-kind cap", async ({ page }) => {
    // Mirrors the per-kind limit enforced server-side in
    // handlers-designer.mjs's validateLocalDesignerSelections(); mock the
    // add endpoint so 20 distinct entries can be accumulated without needing
    // 20 real manifest directories on disk.
    let nextId = 0;
    await page.route("**/api/designer/local-source?*", async (route) => {
        nextId += 1;
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                item: { id: `fixture-preset-${nextId}`, name: `Fixture preset ${nextId}`, version: localPreset.version, path: `/fixtures/preset-${nextId}`, kind: "presets" },
            }),
        });
    });

    const dialog = page.getByRole("dialog", { name: "Canvas Designer setup" });
    const localSection = dialog.locator("[data-designer-local]");
    await localSection.locator("summary").click();
    const pathInput = localSection.locator("[data-designer-local-path]");
    const addBtn = localSection.locator("[data-designer-local-add]");
    const localItems = localSection.locator(".designer-local-item");

    for (let i = 1; i <= 20; i += 1) {
        await pathInput.fill(`/fixtures/preset-${i}`);
        await addBtn.click();
        await expect(localItems).toHaveCount(i);
    }

    await pathInput.fill("/fixtures/preset-21");
    await addBtn.click();
    await expect(localSection.locator("[data-designer-local-error]"))
        .toContainText("A maximum of 20 local presets are allowed.");
    await expect(localItems).toHaveCount(20);
});
