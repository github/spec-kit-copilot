import { createRequire } from "node:module";
import { startFixture } from "../serve-fixture.mjs";

const require = createRequire(new URL("../../../plugins/spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/ui/markdown-reader/package.json", import.meta.url));
const { test, expect } = require("@playwright/test");

const markdown = [
    "# Canvas review fixture", "## Purpose", "Review the specification without leaving the workflow.",
    ...Array.from({ length: 18 }, () => "A synthetic paragraph keeps the document long enough to exercise section navigation and its explicit scroll container."),
    "## Details", "### Requirements", "- [x] Read existing artifacts\n- [ ] Preserve workflow state",
    `| Name | Value |\n| --- | --- |\n| Wide content | ${"unbroken".repeat(120)} |`,
    `\`\`\`text\n${"wide-code-".repeat(120)}\n\`\`\``, "## References", "A footnote[^fixture] and [research](research.md).",
    "[^fixture]: Synthetic footnote.", "![Non-loading example](https://example.invalid/fixture.png)",
].join("\n\n");

for (const canvas of ["wizard", "sdd"]) {
    test(`${canvas} TOC layout follows exact reader container widths`, async ({ page }) => {
        const fixture = await startFixture({ canvas, markdown });
        const url = new URL(fixture.url);
        try {
            await page.setViewportSize({ width: 1440, height: 900 });
            await page.goto(url.href, { waitUntil: "domcontentloaded" });
            if (canvas === "wizard") await page.locator('[data-tab="phases"]').click();
            await (canvas === "wizard" ? page.locator('#phase-card [data-phase-action="view"]') : page.getByTitle("View spec.md", { exact: true })).click();
            const reader = page.locator("[data-reader-id]");
            await expect(reader).toBeVisible();
            for (const width of [360, 480, 640, 819, 820, 821, 1024]) {
                await reader.evaluate((element, pixels) => { element.style.width = `${pixels}px`; }, width);
                await expect.poll(() => reader.evaluate((element) => element.clientWidth)).toBe(width);
                await expect(reader).toHaveAttribute("data-reader-layout", width < 820 ? "compact" : "wide");
            }
        } finally { await page.close(); expect((await fixture.stop()).cleaned).toBe(true); }
    });

    for (const width of [360, 480, 640, 820, 1024, 1440]) {
        test(`${canvas} TOC keyboard and overflow at ${width}px`, async ({ page }, testInfo) => {
            const fixture = await startFixture({ canvas, markdown });
            const url = new URL(fixture.url);
            const external = [];
            const errors = [];
            page.on("pageerror", (error) => errors.push(error.name));
            await page.route("**/*", async (route) => {
                if (new URL(route.request().url()).origin !== url.origin) { external.push("external"); await route.abort(); }
                else await route.continue();
            });
            try {
                await page.setViewportSize({ width, height: 900 });
                await page.emulateMedia({ reducedMotion: "reduce" });
                await page.goto(url.href, { waitUntil: "domcontentloaded" });
                if (canvas === "wizard") await page.locator('[data-tab="phases"]').click();
                const trigger = canvas === "wizard" ? page.locator('#phase-card [data-phase-action="view"]') : page.getByTitle("View spec.md", { exact: true });
                await trigger.click();
                const reader = page.locator("[data-reader-id]");
                await expect(reader).toBeVisible();
                const readerWidth = await reader.evaluate((element) => element.clientWidth);
                const compact = readerWidth < 820;
                await expect(reader).toHaveAttribute("data-reader-layout", compact ? "compact" : "wide", { timeout: 3000 });
                if (compact) {
                    await reader.getByRole("button", { name: "Table of contents", exact: true }).click();
                    const dialog = reader.getByRole("dialog", { name: "Table of contents", exact: true });
                    await expect(dialog).toBeVisible();
                    const close = dialog.getByRole("button", { name: "Close table of contents", exact: true });
                    await expect.poll(() => close.evaluate((element) => {
                        const bounds = element.getBoundingClientRect();
                        return element.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2));
                    })).toBe(true);
                    const target = dialog.getByRole("button", { name: "Details", exact: true });
                    await target.focus();
                    await target.press("Enter");
                    await expect(dialog).toHaveCount(0);
                } else {
                    const navigation = reader.getByRole("navigation", { name: "Table of contents", exact: true });
                    await expect(navigation).toBeVisible();
                    const target = navigation.getByRole("button", { name: "Details", exact: true });
                    await target.focus();
                    await target.press("Enter");
                }
                const destination = reader.locator('.md-reader__article [data-reader-heading]').filter({ hasText: /^Details$/ });
                await expect(destination).toBeFocused();
                await expect(destination).toBeInViewport();
                const overflow = await page.evaluate(() => ({
                    width: document.documentElement.clientWidth,
                    scrollWidth: document.documentElement.scrollWidth,
                    elements: [...document.querySelectorAll("body *")].map((element) => ({ element, rect: element.getBoundingClientRect() }))
                        .filter(({ rect }) => rect.width > 0 && rect.right > document.documentElement.clientWidth + 1)
                        .slice(0, 12).map(({ element, rect }) => ({ tag: element.tagName, id: element.id, className: element.className, width: rect.width, right: rect.right })),
                }));
                expect(overflow.scrollWidth, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.width + 1);
                await expect(reader.locator(".md-reader__article img, .md-reader__article script")).toHaveCount(0);
                await expect(reader.locator(".md-reader__table-scroll table")).toHaveCount(1);
                await expect(reader.locator(".md-reader__article pre code")).toHaveCount(1);
                const preview = page.locator(canvas === "wizard" ? "#phase-artifact-viewer" : "#aside");
                await preview.screenshot({ path: testInfo.outputPath(`${canvas}-${width}-toc.png`) });
                if (compact) {
                    await reader.getByRole("button", { name: "Table of contents", exact: true }).click();
                    await reader.getByRole("dialog").press("Escape");
                    await expect(reader.getByRole("dialog")).toHaveCount(0);
                    await expect(preview).toBeVisible();
                }
                await page.locator(canvas === "wizard" ? ".artifact-viewer-back" : "#closeArt").click();
                const returnState = await trigger.evaluate(async (element) => {
                    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                    const ancestors = [];
                    for (let parent = element; parent; parent = parent.parentElement) {
                        const style = getComputedStyle(parent);
                        ancestors.push({ tag: parent.tagName, id: parent.id, className: parent.className, visibility: style.visibility, display: style.display, inert: parent.inert, inlineStyle: parent.getAttribute("style") });
                    }
                    return { activeTag: document.activeElement?.tagName, activeId: document.activeElement?.id,
                        bodyClass: document.body.className, overlayHidden: document.getElementById("phase-artifact-viewer")?.hidden,
                        remainingReaders: document.querySelectorAll("[data-reader-id]").length, ancestors };
                });
                await expect(trigger, JSON.stringify({ ...returnState, errors })).toBeFocused();
                expect(external).toEqual([]);
                expect(errors).toEqual([]);
                expect(fixture.dispatchCount()).toBe(0);
                expect(fixture.workspaceChanged()).toBe(false);
            } finally { await page.close(); expect((await fixture.stop()).cleaned).toBe(true); }
        });
    }

    test(`${canvas} TOC remains usable at 200 percent zoom`, async ({ page }, testInfo) => {
        const fixture = await startFixture({ canvas, markdown });
        const url = new URL(fixture.url);
        try {
            await page.setViewportSize({ width: 1280, height: 900 });
            await page.goto(url.href, { waitUntil: "domcontentloaded" });
            await page.evaluate(() => { document.body.style.zoom = "2"; });
            if (canvas === "wizard") await page.locator('[data-tab="phases"]').click();
            await (canvas === "wizard" ? page.locator('#phase-card [data-phase-action="view"]') : page.getByTitle("View spec.md", { exact: true })).click();
            const reader = page.locator("[data-reader-id]");
            await expect(reader).toHaveAttribute("data-reader-layout", "compact", { timeout: 3000 });
            await reader.getByRole("button", { name: "Table of contents", exact: true }).click();
            await expect(reader.getByRole("dialog")).toBeInViewport();
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
            await page.locator(canvas === "wizard" ? "#phase-artifact-viewer" : "#aside").screenshot({ path: testInfo.outputPath(`${canvas}-zoom-200.png`) });
        } finally { await page.close(); expect((await fixture.stop()).cleaned).toBe(true); }
    });
}
