// Verify pipeline utilities stay enabled and require confirmation before dispatch.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";

test("Clear and Reset share confirmation for empty, default and edited pipelines", async (t) => {
    let chromium;
    try {
        ({ chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright"));
    } catch (error) {
        if (process.env.PLAYWRIGHT_MODULE) throw error;
        t.skip("Set PLAYWRIGHT_MODULE for browser checks."); return;
    }
    const root = fileURLToPath(new URL("../", import.meta.url));
    const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
    try {
        for (const width of [1280, 390]) {
            const page = await browser.newPage({ viewport: { width, height: 900 } });
            const errors = [];
            page.on("pageerror", (error) => errors.push(error.message));
            await page.route("**/*", async (route) => {
                const url = new URL(route.request().url());
                assert.equal(url.origin, "http://127.0.0.1:43221");
                if (url.pathname === "/") {
                    await route.fulfill({ contentType: "text/html", body: '<link rel="stylesheet" href="/ui/styles/pipeline.css"><div id="pipeline-banner" class="pipeline-banner"></div>' });
                    return;
                }
                const path = url.pathname.slice(1);
                await route.fulfill({ contentType: path.endsWith(".css") ? "text/css" : "application/javascript",
                    body: await readFile(join(root, ...path.split("/")), "utf8") });
            });
            await page.goto("http://127.0.0.1:43221/");
            for (const mode of ["empty", "default", "edited"]) {
                await page.evaluate(async (mode) => {
                    const { state } = await import("/ui/state.js");
                    const { renderPipelineBanner, setPipelineDeps } = await import("/ui/phase-runtime.js");
                    state.activeTab = "phases";
                    state.snapshot = { pipeline: mode === "empty" ? [] : mode === "edited" ? [{ id: "specify" }] : undefined };
                    window.posts = [];
                    setPipelineDeps({ postJson: async (url, body) => window.posts.push({ url, body }) });
                    renderPipelineBanner();
                }, mode);
                for (const action of ["clear", "reset"]) {
                    const button = page.locator(`.pipeline-${action}`);
                    const popover = page.locator(".confirm-popover");
                    assert.equal(await button.isEnabled(), true);
                    const before = await page.evaluate(() => window.posts.length);
                    for (const dismiss of ["cancel", "escape", "outside"]) {
                        await button.click();
                        await popover.waitFor();
                        assert.equal(await page.evaluate(() => window.posts.length), before);
                        if (dismiss === "cancel") await popover.locator(".confirm-popover-cancel").click();
                        else if (dismiss === "escape") await page.keyboard.press("Escape");
                        else await page.locator(".comp-subtitle").click();
                        await popover.waitFor({ state: "detached" });
                        assert.equal(await page.evaluate(() => window.posts.length), before);
                    }
                    await button.click();
                    await popover.locator(".confirm-popover-ok").click();
                    await page.waitForFunction((count) => window.posts.length === count, before + 1);
                    assert.deepEqual(await page.evaluate(() => window.posts.at(-1)), { url: "/api/pipeline", body: { action } });
                    assert.equal(await button.isEnabled(), true);
                }
            }
            assert.deepEqual(errors, []);
            await page.close();
        }
    } finally { await browser.close(); }
});
