import { test, expect } from "@playwright/test";

test("Designer renders registered pages, exact Essentials controls, and disabled actions", async ({ page }) => {
    const writes = [];
    page.on("request", (request) => {
        if (request.method() !== "GET") writes.push(request.url());
    });
    await page.goto("/designer");
    await expect(page.getByRole("tab")).toHaveText(["Essentials", "Artifacts", "Appearance", "Result Badges"]);
    const id = page.getByRole("textbox", { name: "Canvas ID (required)", exact: true });
    const title = page.getByRole("textbox", { name: "Title (required)", exact: true });
    const description = page.getByRole("textbox", { name: "Description", exact: true });
    const header = page.getByRole("textbox", { name: "Workflow header", exact: true });
    const slug = page.getByRole("checkbox", { name: "Show slug field", exact: true });
    await expect(page.getByRole("textbox")).toHaveCount(4);
    await expect(id).toHaveAttribute("maxlength", "100");
    await expect(id).toHaveAttribute("pattern", "^[a-z0-9][a-z0-9-]*$");
    await expect(title).toHaveAttribute("maxlength", "120");
    await expect(description).toHaveAttribute("type", "text");
    await expect(description).toHaveAttribute("maxlength", "240");
    await expect(header).toHaveAttribute("maxlength", "80");
    await expect(id).toHaveValue("");
    await expect(slug).not.toBeChecked();
    await id.fill("example-canvas");
    await title.fill("Example");
    await slug.check();
    for (const name of ["Artifacts", "Appearance", "Result Badges"]) {
        await page.getByRole("tab", { name, exact: true }).click();
        await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
        await expect(page.getByText("This template defines no fields.")).toBeVisible();
        await expect(page.getByRole("textbox")).toHaveCount(0);
    }
    await page.getByRole("tab", { name: "Essentials" }).click();
    await expect(id).toHaveValue("example-canvas");
    await expect(slug).toBeChecked();
    await id.press("Enter");
    await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Generate", exact: true })).toBeDisabled();
    await expect(page.getByRole("status")).toHaveText("Live");
    expect(writes).toEqual([]);
});

test("Designer theme, keyboard navigation, and narrow layout remain usable", async ({ page }) => {
    await page.goto("/designer");
    await expect(page.getByRole("heading", { name: "Essentials" })).toBeVisible();
    const initial = await page.locator("html").getAttribute("data-theme");
    await page.locator("#theme-toggle").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", initial === "dark" ? "light" : "dark");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", initial === "dark" ? "light" : "dark");
    await page.getByRole("tab", { name: "Essentials" }).focus();
    await page.keyboard.press("End");
    await expect(page.getByRole("tab", { name: "Result Badges" })).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Essentials" })).toBeFocused();
    await page.setViewportSize({ width: 375, height: 760 });
    await expect(page.getByRole("textbox", { name: "Canvas ID (required)" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("connection status reflects failure and reconnects without losing edits", async ({ page }) => {
    await page.route("**/events?*", (route) => route.abort());
    await page.goto("/designer");
    await expect(page.getByRole("status")).toHaveText("Disconnected");
    const id = page.getByRole("textbox", { name: "Canvas ID (required)" });
    await id.fill("keep-draft");
    await page.unroute("**/events?*");
    await expect(page.getByRole("status")).toHaveText("Live", { timeout: 15_000 });
    await expect(id).toHaveValue("keep-draft");
});

test("Designer exposes state errors and no save or generate endpoints", async ({ page }) => {
    await page.route("**/api/state?*", (route) => route.fulfill({ status: 503, body: "unavailable" }));
    await page.goto("/designer");
    await expect(page.getByRole("alert")).toContainText("503");
    for (const path of ["/api/save", "/api/generate"]) {
        const target = new URL(page.url());
        target.pathname = path;
        expect((await page.request.post(target.href)).status()).toBe(404);
    }
    await expect(page.getByRole("button", { name: "Generate", exact: true })).toBeDisabled();
});
