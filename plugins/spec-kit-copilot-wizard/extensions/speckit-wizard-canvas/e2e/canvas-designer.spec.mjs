import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
    await page.goto("/?token=e2e-token");
    await page.getByRole("tab", { name: "Phases" }).click();
    await page.getByRole("button", { name: "Generate canvas" }).click();
});

test("opens a design-only dialog with an available launch", async ({ page }) => {
    const dialog = page.getByRole("dialog", { name: "Canvas designer setup" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("checkbox", { name: /Design preset/ })).toBeVisible();
    await expect(dialog.getByText("Other preset")).toHaveCount(0);
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
    await expect(dialog.getByText("Other bundle")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    await page.getByRole("button", { name: "Generate canvas" }).click();
    await expect(page.getByRole("dialog", { name: "Canvas designer setup" })
        .getByRole("checkbox", { name: /Design preset/ })).not.toBeChecked();
});

test("confirms community selection and checks only listed design bundle members", async ({ page }) => {
    const writes = [];
    page.on("request", (request) => {
        if (request.method() !== "GET") writes.push(request.url());
    });
    const dialog = page.getByRole("dialog", { name: "Canvas designer setup" });
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
    await expect(presets.getByText("Included by bundle: Design bundle")).toBeVisible();
    await expect(presets.getByText("Unlisted preset")).toHaveCount(0);
    await expect(presets.getByRole("checkbox", { name: /Copilot preset/ })).not.toBeChecked();
    await preset.uncheck();
    await expect(preset).not.toBeChecked();
    await dialog.getByRole("tab", { name: "Extensions" }).click();
    await expect(dialog.getByRole("checkbox", { name: /Design extension/ })).toBeChecked();
    await expect(dialog.getByText("Unlisted extension")).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: /Launch designer/ })).toBeEnabled();
    expect(writes).toEqual([]);
});

test("community presets and extensions retain their selection warnings", async ({ page }) => {
    const dialog = page.getByRole("dialog", { name: "Canvas designer setup" });
    for (const [tab, name, kind] of [
        ["Presets", "Design preset", "preset"],
        ["Extensions", "Design extension", "extension"],
    ]) {
        await dialog.getByRole("tab", { name: tab }).click();
        const choice = dialog.getByRole("checkbox", { name });
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
    const dialog = page.getByRole("dialog", { name: "Canvas designer setup" });
    const responsePromise = page.waitForResponse((response) =>
        response.url().includes("/api/designer/launch") && response.request().method() === "POST");
    await dialog.getByRole("button", { name: "Launch designer" }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(202);
    expect(await response.json()).toEqual({ queued: true });
    expect(response.request().postDataJSON()).toMatchObject({
        selections: { presets: [], extensions: [], bundles: [] },
        catalogFingerprint: "e2e-catalog",
    });

    await expect(dialog).toHaveCount(0);
    await page.getByRole("button", { name: "Generate canvas" }).click();
    await expect(page.getByRole("dialog", { name: "Canvas designer setup" })
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
    const dialog = page.getByRole("dialog", { name: "Canvas designer setup" });
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
