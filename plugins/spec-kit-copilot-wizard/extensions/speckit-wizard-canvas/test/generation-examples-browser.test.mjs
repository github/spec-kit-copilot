// Verify advisory example guidance never blocks Generate, including stale and failed checks.
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";

test("Generate remains usable with missing examples and failures on desktop/mobile in both themes", async (t) => {
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
        if (process.env.VIEWER_SCREENSHOT_DIR) await mkdir(process.env.VIEWER_SCREENSHOT_DIR, { recursive: true });
        for (const width of [1280, 390]) for (const theme of ["light", "dark"]) {
            const page = await browser.newPage({ viewport: { width, height: 1000 }, colorScheme: theme });
            const errors = [];
            page.on("pageerror", (error) => errors.push(error.message));
            await page.route("**/*", async (route) => {
                const url = new URL(route.request().url());
                assert.equal(url.origin, "http://127.0.0.1:43221");
                const path = url.pathname === "/" ? "ui/index.html" : url.pathname.slice(1);
                let body = await readFile(join(root, ...path.split("/")), "utf8");
                if (path === "ui/index.html") body = body.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");
                await route.fulfill({ contentType: path.endsWith(".html") ? "text/html" : path.endsWith(".css") ? "text/css" : "application/javascript", body });
            });
            await page.goto("http://127.0.0.1:43221/");
            await page.evaluate(async (theme) => {
                document.documentElement.dataset.theme = theme;
                const { state } = await import("/ui/state.js");
                const { openGenerationDialog, setGenerationDeps } = await import("/ui/generation.js");
                state.snapshot = { setup: { pluginInstalled: true, cliInstalled: true, projectInitialized: true, skillsReloaded: true },
                    pipeline: [{ id: "specify" }, { id: "plan" }] };
                window.example = { available: false, missing: ["Specify", "Plan"] };
                window.started = 0;
                window.failStart = false;
                window.deferred = [];
                setGenerationDeps({ postJson: async (url, body) => {
                    if (url.endsWith("/start")) {
                        window.started++;
                        if (window.failStart) throw new Error("fixture send failed");
                        return { requestId: "fixture" };
                    }
                    const response = { ok: true, example: structuredClone(window.example), target: { relativeDirectory: `.github/extensions/${body.extensionId}` } };
                    if (window.defer) return new Promise((resolve) => window.deferred.push(() => resolve(response)));
                    return response;
                }, render: () => {} });
                window.openGeneration = openGenerationDialog;
                openGenerationDialog();
            }, theme);
            const generate = page.locator("#generation-submit");
            await page.locator("#generation-example").waitFor();
            assert.match(await page.locator("#generation-example").textContent(), /generate now with standard/);
            assert.equal(await generate.isEnabled(), true);
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
            if (process.env.VIEWER_SCREENSHOT_DIR) {
                await page.screenshot({ path: join(process.env.VIEWER_SCREENSHOT_DIR, `example-advisory-${width}-${theme}.png`) });
            }
            await page.evaluate(() => { window.failStart = true; });
            await generate.click();
            await page.getByText("Could not queue generation. Try again.", { exact: true }).waitFor();
            assert.equal(await generate.isEnabled(), true, "failed submission cannot leave the button disabled");
            await page.evaluate(() => { window.failStart = false; });
            await generate.click();
            await page.locator(".generation-modal").waitFor({ state: "detached" });
            assert.equal(await page.evaluate(() => window.started), 2);
            await page.evaluate(() => {
                window.example = { available: true, source: "alpha", finalArtifact: "specs/alpha/plan.md" };
                window.openGeneration();
            });
            await page.getByText("Example artifacts available", { exact: true }).waitFor();
            assert.equal(await generate.isEnabled(), true);
            // An earlier advisory must not overwrite a newer check.
            await page.evaluate(() => { window.defer = true; });
            await page.locator("#generation-extension-id").fill("older");
            await page.waitForFunction(() => window.deferred.length === 1);
            await page.evaluate(() => { window.example = { available: false, missing: ["Plan"] }; });
            await page.locator("#generation-extension-id").fill("newer");
            await page.waitForFunction(() => window.deferred.length === 2);
            await page.evaluate(() => window.deferred[1]());
            await page.getByText("Example artifacts improve status labels", { exact: true }).waitFor();
            await page.evaluate(() => window.deferred[0]());
            assert.match(await page.locator("#generation-example").textContent(), /Missing or unreadable: Plan/);
            assert.equal(await generate.isEnabled(), true);
            assert.deepEqual(errors, []);
            await page.close();
        }
    } finally { await browser.close(); }
});
