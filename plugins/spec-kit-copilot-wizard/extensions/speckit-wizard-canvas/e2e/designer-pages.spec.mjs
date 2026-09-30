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

test("Designer status labels meet normal-text contrast in both themes", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/designer");
    await expect(page.getByRole("heading", { name: "Essentials" })).toBeVisible();
    const darkColors = {
        connecting: [240, 195, 109],
        live: [76, 208, 139],
        lost: [255, 122, 107],
    };
    for (const theme of ["light", "dark"]) {
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        const labels = await page.evaluate(() => {
            const rgb = (color) => color.match(/[\d.]+/g).map(Number);
            const luminance = (channels) => channels.map((channel) => {
                const value = channel / 255;
                return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
            }).reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
            const header = document.querySelector(".app-header");
            const backdrop = rgb(getComputedStyle(header).backgroundColor);
            return ["connecting", "live", "lost"].map((state) => {
                const label = document.createElement("span");
                label.className = `conn conn-${state}`;
                label.textContent = state;
                header.querySelector(".toolbar-actions").append(label);
                const style = getComputedStyle(label);
                const foreground = rgb(style.color);
                const tint = rgb(style.backgroundColor);
                const alpha = tint[3] ?? 1;
                const background = tint.slice(0, 3).map((value, i) =>
                    value * alpha + backdrop[i] * (1 - alpha));
                const light = luminance(foreground), dark = luminance(background);
                const result = { state, foreground, fontSize: style.fontSize,
                    contrast: (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05) };
                label.remove();
                return result;
            });
        });
        for (const label of labels) {
            expect(label.fontSize).toBe("12px");
            expect.soft(label.contrast, `${theme} ${label.state} contrast`).toBeGreaterThanOrEqual(4.5);
            if (theme === "dark") expect(label.foreground).toEqual(darkColors[label.state]);
        }
        if (theme === "light") await page.locator("#theme-toggle").click();
    }
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
    await page.route("**/events?*", (route) => route.abort());
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

test("explicit reload confirms draft loss and publishes an additional page", async ({ page }) => {
    const requests = [];
    page.on("request", (request) => {
        if (request.method() === "POST") requests.push(request.url());
    });
    await page.goto("/designer");
    const id = page.getByRole("textbox", { name: "Canvas ID (required)" });
    await id.fill("temporary");
    await page.getByRole("button", { name: "Reload pages", exact: true }).click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(requests).toEqual([]);
    await expect(id).toHaveValue("temporary");
    await page.getByRole("button", { name: "Reload pages", exact: true }).click();
    await page.getByRole("button", { name: "Discard and reload" }).click();
    await expect(page.getByRole("tab", { name: "Accessibility" })).toBeVisible();
    await expect(id).toHaveValue("");
    await expect(page.getByRole("button", { name: "Reload pages", exact: true })).toBeEnabled();
    await page.getByRole("tab", { name: "Accessibility" }).click();
    await expect(page.getByRole("heading", { name: "Accessibility" })).toBeVisible();
    expect(requests).toHaveLength(1);
    await expect(page.getByRole("button", { name: "Generate", exact: true })).toBeDisabled();
});

test("failed reload retains edited values and reports the agent error", async ({ page }) => {
    await page.goto("/designer?reload=fail");
    const id = page.getByRole("textbox", { name: "Canvas ID (required)" });
    await id.fill("keep-draft");
    await page.getByRole("button", { name: "Reload pages", exact: true }).click();
    await page.getByRole("button", { name: "Discard and reload" }).click();
    await expect(page.getByRole("alert")).toHaveText("canvas-settings-extra: not found");
    await expect(id).toHaveValue("keep-draft");
    await expect(id).toBeEnabled();
    await expect(page.getByRole("tab")).toHaveCount(4);
});

test("a pending load can be explicitly retried without tab-driven dispatch", async ({ page }) => {
    await page.goto("/designer?reload=pending");
    await page.getByRole("button", { name: "Reload pages", exact: true }).click();
    await expect(page.getByRole("button", { name: "Reload pages", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Retry reload" })).toBeVisible();
    await page.getByRole("tab", { name: "Appearance", exact: true }).click();
    await page.getByRole("button", { name: "Retry reload" }).click();
    await expect(page.getByRole("tab", { name: "Accessibility" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Appearance", exact: true })).toHaveAttribute("aria-selected", "true");
});
