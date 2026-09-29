import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
    await page.goto("/?token=e2e-token");
    await page.getByRole("tab", { name: "Phases" }).click();
    await page.getByRole("button", { name: "Generate canvas" }).click();
});

test("opens a design-only dialog without enabling launch", async ({ page }) => {
    const dialog = page.getByRole("dialog", { name: "Canvas designer setup" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("checkbox", { name: /Design preset/ })).toBeVisible();
    await expect(dialog.getByText("Other preset")).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: /Launch designer/ })).toBeDisabled();
    await dialog.getByRole("tab", { name: "Bundles" }).click();
    await expect(dialog.getByRole("checkbox", { name: /Design bundle/ })).toBeVisible();
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
    await warning.getByRole("button", { name: "Cancel" }).click();
    await expect(community).not.toBeChecked();
    await community.check();
    await warning.getByRole("button", { name: "Select anyway" }).click();
    await expect(community).toBeChecked();

    await dialog.getByRole("checkbox", { name: /Design bundle/ }).check();
    await dialog.getByRole("tab", { name: "Presets" }).click();
    const presets = dialog.getByRole("tabpanel", { name: "Presets" });
    const preset = presets.getByRole("checkbox", { name: /Design preset/ });
    await expect(preset).toBeChecked();
    await expect(presets.getByText("Included by bundle: Design bundle")).toBeVisible();
    await expect(presets.getByText("Unlisted preset")).toHaveCount(0);
    await expect(presets.getByRole("checkbox", { name: /Community preset/ })).not.toBeChecked();
    await preset.uncheck();
    await expect(preset).not.toBeChecked();
    await dialog.getByRole("tab", { name: "Extensions" }).click();
    await expect(dialog.getByRole("checkbox", { name: /Design extension/ })).toBeChecked();
    await expect(dialog.getByText("Unlisted extension")).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: /Launch designer/ })).toBeDisabled();
    expect(writes).toEqual([]);
});
