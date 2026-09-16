import { createRequire } from "node:module";
import { startFixture } from "../serve-fixture.mjs";

const require = createRequire(new URL("../../../plugins/spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/ui/markdown-reader/package.json", import.meta.url));
const { test, expect } = require("@playwright/test");

test("Wizard primary review stays in its overlay and returns without workflow execution", async ({ page }) => {
    const fixture = await startFixture({ canvas: "wizard" });
    const url = new URL(fixture.url);
    const external = [];
    await page.route("**/*", async (route) => {
        if (new URL(route.request().url()).origin !== url.origin) { external.push("external"); await route.abort(); }
        else await route.continue();
    });
    try {
        await page.goto(url.href, { waitUntil: "domcontentloaded" });
        await page.locator('[data-tab="phases"]').click();
        const trigger = page.locator('#phase-card [data-phase-action="view"]');
        await expect(trigger).toBeVisible();
        const originalTrigger = await trigger.elementHandle();
        const before = await page.locator("#phase-card").textContent();
        await trigger.click();
        const preview = page.locator("#phase-artifact-viewer");
        await expect(preview.locator("[data-review-context]")).toHaveAttribute("data-review-context", /^ctx_/, { timeout: 3000 });
        await expect(preview.locator("[data-reader-id]")).toHaveAttribute("data-revision", /^sha256:[a-f0-9]{64}$/);
        await expect(preview.getByRole("heading", { name: "Canvas review fixture", exact: true })).toBeVisible();
        await page.evaluate(async () => {
            const [{ state }, { handleServerMessage }] = await Promise.all([import("/ui/state.js"), import("/ui/client.js")]);
            handleServerMessage({ type: "state", data: structuredClone(state.snapshot) });
        });
        expect(await originalTrigger.evaluate((element) => element.isConnected), "Background refresh must preserve the reader's workflow return target").toBe(true);
        await preview.locator(".artifact-viewer-back").click();
        await expect(preview).toBeHidden();
        await expect(page.locator("[data-reader-id]")).toHaveCount(0);
        await expect(trigger).toBeFocused();
        expect(await page.locator("#phase-card").textContent()).toBe(before);
        expect(fixture.dispatchCount()).toBe(0);
        expect(fixture.blockedWrites()).toBe(0);
        expect(fixture.workspaceChanged()).toBe(false);
        expect(external).toEqual([]);
    } finally {
        await page.close();
        expect((await fixture.stop()).cleaned).toBe(true);
    }
});

test("Wizard related artifacts, references, and history preserve the selected stage", async ({ page }) => {
    const fixture = await startFixture({ canvas: "wizard" });
    const url = new URL(fixture.url);
    try {
        await page.goto(url.href, { waitUntil: "domcontentloaded" });
        await page.locator('[data-tab="phases"]').click();
        const trigger = page.locator('#phase-card [data-phase-action="view"]');
        const before = await page.locator("#phase-card").textContent();
        await trigger.click();
        const selector = page.getByRole("combobox", { name: "Artifacts", exact: true });
        await expect(selector).toBeVisible({ timeout: 3000 });
        await selector.selectOption({ label: "research.md" });
        await expect(page.getByRole("heading", { name: "Fixture research", exact: true })).toBeVisible();
        await page.getByRole("button", { name: "Previous artifact", exact: true }).click();
        await expect(page.getByRole("heading", { name: "Canvas review fixture", exact: true })).toBeVisible();
        await page.getByRole("button", { name: "Next artifact", exact: true }).click();
        await expect(page.getByRole("heading", { name: "Fixture research", exact: true })).toBeVisible();
        await page.getByRole("button", { name: "Previous artifact", exact: true }).click();
        await page.getByRole("link", { name: "Research", exact: true }).click();
        await expect(page.getByRole("heading", { name: "Fixture research", exact: true })).toBeVisible();
        await page.locator(".artifact-viewer-back").click();
        expect(await page.locator("#phase-card").textContent()).toBe(before);
        await expect(trigger).toBeFocused();
        expect(fixture.dispatchCount()).toBe(0);
        expect(fixture.blockedWrites()).toBe(0);
        expect(fixture.workspaceChanged()).toBe(false);
    } finally { await page.close(); expect((await fixture.stop()).cleaned).toBe(true); }
});

test("Wizard applies workflow progress received during review on return", async ({ page }) => {
    const fixture = await startFixture({ canvas: "wizard" });
    try {
        await page.goto(fixture.url, { waitUntil: "domcontentloaded" });
        await page.locator('[data-tab="phases"]').click();
        const trigger = page.locator('#phase-card [data-phase-action="view"]');
        await trigger.click();
        await expect(page.getByRole("heading", { name: "Canvas review fixture", exact: true })).toBeVisible();
        await page.evaluate(async () => {
            const { markPhaseRunning } = await import("/ui/phase-runtime.js");
            markPhaseRunning("speckit.specify");
        });
        await page.locator(".artifact-viewer-back").click();
        await expect(page.locator("#phase-card").getByRole("button", { name: /Running/ })).toBeDisabled();
        await expect(trigger).toBeFocused();
        expect(fixture.dispatchCount()).toBe(0);
        expect(fixture.workspaceChanged()).toBe(false);
    } finally { await page.close(); expect((await fixture.stop()).cleaned).toBe(true); }
});
