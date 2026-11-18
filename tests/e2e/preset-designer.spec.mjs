import { test, expect } from "./playwright.mjs";
import { startPresetJourney } from "./preset-journey.mjs";

test("Wizard-selected canvas-design test preset edits, saves and reopens its visible Designer controls", async ({ page }) => {
    test.setTimeout(180_000);
    const journey = await startPresetJourney(page, {
        presetId: "copilot-canvas-design-test", selectedPhases: ["specify"],
    });
    try {
        expect(journey.composedSkill).toContain("- `canvas-settings-pr1-test`");
        expect(journey.composedSkill).toContain("- `canvas-contribution-pr1-toggle`");
        expect(journey.pages.map((entry) => entry.name)).toEqual([
            "designer-essentials", "designer-badges",
            "designer-appearance", "canvas-settings-pr1-test",
        ]);
        expect(journey.templates).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: "canvas-contribution-pr1-test",
                sourceId: "copilot-canvas-design-test" }),
            expect.objectContaining({ name: "canvas-contribution-pr1-toggle",
                sourceId: "copilot-canvas-design-test" }),
        ]));
        expect(journey.resolved.pages.map((entry) => entry.title)).toEqual([
            "Essentials", "Badges", "Appearance", "Test settings",
        ]);
        await expect(page.getByRole("tab")).toHaveText([
            "Essentials", "Badges", "Appearance", "Test settings", "Generate",
        ]);
        await page.getByRole("tab", { name: "Test settings" }).click();
        const label = page.getByRole("textbox", { name: "Test label" });
        const enabled = page.getByRole("checkbox", { name: "Test enabled" });
        await expect(label).toBeVisible();
        await expect(label).toHaveValue("");
        await expect(enabled).toBeChecked();
        await label.fill("Visible from preset");
        await enabled.uncheck();
        await page.getByRole("tab", { name: "Essentials" }).click();
        await page.getByRole("textbox", { name: "Canvas ID (required)" }).fill("pr1-test");
        await page.getByRole("textbox", { name: "Title (required)" }).fill("PR1 test");
        await page.getByRole("button", { name: "Save", exact: true }).click();
        await expect(page.locator("#action-message")).toHaveText("Settings saved.");
        await journey.reopenDesigner();
        await page.getByRole("tab", { name: "Test settings" }).click();
        await expect(page.getByRole("textbox", { name: "Test label" }))
            .toHaveValue("Visible from preset");
        await expect(page.getByRole("checkbox", { name: "Test enabled" }))
            .not.toBeChecked();
        await page.getByRole("tab", { name: "Essentials" }).click();
        await expect(page.getByRole("textbox", { name: "Canvas ID (required)" }))
            .toHaveValue("pr1-test");
        await expect(page.getByRole("textbox", { name: "Title (required)" }))
            .toHaveValue("PR1 test");
    } finally {
        await journey.close();
    }
});

test("Wizard-selected minimal Essentials preset opens a savable but generation-disabled Designer", async ({ page }) => {
    test.setTimeout(180_000);
    const journey = await startPresetJourney(page, {
        presetId: "copilot-minimal-essentials-test", selectedPhases: ["specify"],
        onGenerate: async () => { throw new Error("Incomplete composition must not dispatch generation"); },
    });
    try {
        expect(journey.composedSkill).not.toContain("designer-badges");
        expect(journey.pages.map((entry) => entry.name)).toEqual([
            "designer-essentials", "designer-appearance",
        ]);
        expect(journey.templates.map((entry) => entry.name))
            .not.toContain("generated-workflow-page-adapter");
        await expect(page.getByRole("tab")).toHaveText(["Essentials", "Appearance", "Generate"]);
        await expect(page.getByRole("textbox", { name: "Canvas ID (required)" })).toBeVisible();
        await expect(page.getByRole("textbox", { name: "Title (required)" })).toBeVisible();
        await expect(page.getByRole("textbox", { name: "Description" })).toHaveCount(0);
        await expect(page.locator("#composition-error")).toContainText(
            "generated-workflow-page-adapter");
        await expect(page.locator("#composition-error")).toContainText(
            "extension:extension-canvas-design");
        await page.getByRole("tab", { name: "Generate" }).click();
        await expect(page.locator("#generate-canvas")).toBeDisabled();
        await page.getByRole("tab", { name: "Essentials" }).click();
        await page.getByRole("textbox", { name: "Canvas ID (required)" }).fill("minimal-canvas");
        await page.getByRole("textbox", { name: "Title (required)" }).fill("Minimal Canvas");
        await page.getByRole("button", { name: "Save", exact: true }).click();
        await expect(page.locator("#action-message")).toHaveText("Settings saved.");
        const endpoint = new URL(`/api/generate?token=${new URL(journey.shell.url).searchParams.get("token")}`,
            journey.shell.url);
        const response = await fetch(endpoint, { method: "POST",
            headers: { "Content-Type": "application/json" }, body: "{}" });
        expect(response.status).toBe(422);
        expect((await response.json()).error).toContain("generated-workflow-page-adapter");
        await journey.reopenDesigner();
        await expect(page.getByRole("textbox", { name: "Canvas ID (required)" }))
            .toHaveValue("minimal-canvas");
        await expect(page.getByRole("textbox", { name: "Title (required)" }))
            .toHaveValue("Minimal Canvas");
        await expect(page.locator("#composition-error")).toContainText(
            "generated-workflow-page-adapter");
        await page.getByRole("tab", { name: "Generate" }).click();
        await expect(page.locator("#generate-canvas")).toBeDisabled();
    } finally {
        await journey.close();
    }
});
