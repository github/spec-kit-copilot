import { createRequire } from "node:module";
import { startFixture } from "../serve-fixture.mjs";

const require = createRequire(new URL("../../../plugins/spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/ui/markdown-reader/package.json", import.meta.url));
const { test, expect } = require("@playwright/test");

async function openReader(page, canvas, fixture) {
    const url = new URL(fixture.url);
    await page.goto(url.href, { waitUntil: "domcontentloaded" });
    if (canvas === "wizard") await page.locator('[data-tab="phases"]').click();
    await (canvas === "wizard" ? page.locator('#phase-card [data-phase-action="view"]') : page.getByTitle("View spec.md", { exact: true })).click();
    const reader = page.locator("[data-reader-id]");
    await expect(reader).toHaveAttribute("data-reader-state", "ready");
    return reader;
}

for (const canvas of ["wizard", "sdd"]) {
    test(`${canvas} scoped invalidations refresh changed and deleted artifacts without stealing selection`, async ({ page }) => {
        const fixture = await startFixture({ canvas, allowMutations: true });
        try {
            const reader = await openReader(page, canvas, fixture);
            await expect(reader.getByRole("button", { name: "Refresh artifact", exact: true })).toBeVisible({ timeout: 3000 });
            const initialRevision = await reader.getAttribute("data-revision");
            await reader.evaluate((element) => {
                window.__observedReaderStates = [];
                new MutationObserver(() => {
                    const state = document.querySelector("[data-reader-id]")?.getAttribute("data-reader-state");
                    if (state) window.__observedReaderStates.push(state);
                }).observe(element.parentElement, { attributes: true, childList: true, subtree: true });
            });
            await fixture.mutateArtifact("new.markdown", "# Newly generated artifact\n");
            await expect(reader.locator('select[aria-label="Artifacts"] option').filter({ hasText: "new.markdown" })).toHaveCount(1);
            await expect(reader).toHaveAttribute("data-revision", initialRevision);
            await fixture.mutateArtifact("spec.md", "# Changed specification\n\n## Updated section\n\nNew exact bytes.\n");
            await expect(reader.getByRole("heading", { name: "Changed specification", exact: true })).toBeVisible();
            await expect(reader).not.toHaveAttribute("data-revision", initialRevision);
            expect(await page.evaluate(() => window.__observedReaderStates.includes("changed"))).toBe(true);
            await fixture.mutateArtifact("spec.md", null);
            await expect(reader).toHaveAttribute("data-reader-state", "deleted");
            await reader.getByRole("combobox", { name: "Artifacts" }).selectOption({ label: "research.md" });
            await expect(reader.getByRole("heading", { name: "Fixture research", exact: true })).toBeVisible();
            expect(fixture.dispatchCount()).toBe(0);
            expect(fixture.blockedWrites()).toBe(0);
        } finally { await page.close(); expect((await fixture.stop()).cleaned).toBe(true); }
    });

    test(`${canvas} loss and restoration of its existing event stream preserve validated content`, async ({ page }) => {
        const fixture = await startFixture({ canvas });
        try {
            const reader = await openReader(page, canvas, fixture);
            const revision = await reader.getAttribute("data-revision");
            fixture.pauseEvents();
            await expect(reader).toHaveAttribute("data-reader-connection", "disconnected", { timeout: 5000 });
            await expect(reader).toHaveAttribute("data-revision", revision);
            await expect(reader.getByRole("status")).toContainText("Disconnected");
            fixture.resumeEvents();
            await expect(reader).toHaveAttribute("data-reader-connection", "connected", { timeout: 15000 });
            await expect(reader).toHaveAttribute("data-revision", revision);
            expect(fixture.dispatchCount()).toBe(0);
            expect(fixture.workspaceChanged()).toBe(false);
        } finally { await page.close(); expect((await fixture.stop()).cleaned).toBe(true); }
    });
}
