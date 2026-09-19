// Verify optional result settings, stable submission controls, and stale preflight handling.
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";

test("result settings remain usable on desktop/mobile in both themes", async (t) => {
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
                const { validateResultLabels } = await import("/generation/generated-canvas-template/workflow-adapter.mjs");
                state.snapshot = { setup: { pluginInstalled: true, cliInstalled: true, projectInitialized: true, skillsReloaded: true },
                    pipeline: [{ id: "specify" }, { id: "plan" }] };
                window.started = 0;
                window.failStart = false;
                window.deferred = [];
                setGenerationDeps({ postJson: async (url, body) => {
                    if (url.endsWith("/start")) {
                        window.started++;
                        window.lastStart = body;
                        if (window.failStart) throw new Error("fixture send failed");
                        if (window.delayStart) await new Promise((resolve) => { window.finishStart = resolve; });
                        return { requestId: "fixture" };
                    }
                    if (window.failCheck) throw new Error("fixture check failed");
                    const errors = [];
                    try { validateResultLabels(body.resultLabels); }
                    catch (error) { errors.push({ field: "resultLabels", message: error.message }); }
                    const response = {
                        ok: errors.length === 0, errors,
                        target: { relativeDirectory: `.github/extensions/${body.extensionId}` },
                    };
                    if (window.defer) return new Promise((resolve) => window.deferred.push(() => resolve(response)));
                    return response;
                }, render: () => {} });
                window.openGeneration = openGenerationDialog;
                openGenerationDialog();
            }, theme);
            const generate = page.locator("#generation-submit");
            const first = page.locator("#generation-result-0");
            const add = page.locator("#generation-add-result");
            await first.waitFor();
            assert.equal(await first.inputValue(), "");
            assert.equal(await page.locator("[data-result-label]").count(), 1);
            assert.equal(await page.evaluate(() => {
                const reference = getComputedStyle(document.querySelector("#generation-description-label"));
                return [...document.querySelectorAll("#generation-results-title, .generation-modal .wizard-modal-check strong")]
                    .every((element) => {
                        const style = getComputedStyle(element);
                        return style.fontSize === reference.fontSize && style.fontWeight === reference.fontWeight;
                    });
            }), true, "result and checkbox labels match the Description field typography");
            assert.deepEqual(await page.locator(".generation-results").evaluate((element) => {
                const style = getComputedStyle(element);
                const gap = parseFloat(getComputedStyle(element.parentElement).rowGap);
                return {
                    top: style.borderTopWidth, bottom: style.borderBottomWidth,
                    themeBorder: style.borderTopColor === getComputedStyle(document.querySelector(".wizard-modal")).borderTopColor,
                    insideTop: style.paddingTop, insideBottom: style.paddingBottom,
                    outsideTop: gap + parseFloat(style.marginTop), outsideBottom: gap + parseFloat(style.marginBottom),
                };
            }), { top: "1px", bottom: "1px", themeBorder: true, insideTop: "16px", insideBottom: "16px", outsideTop: 16, outsideBottom: 16 });
            assert.equal(await page.locator("#generation-example").count(), 0);
            assert.equal(await page.locator("#generation-results-help").textContent(), "The canvas displays result counts for the workflow based on these labels.");
            assert.match(await page.locator("#generation-results-examples").textContent(), /Examples: Go \/ Kill, or Implemented \/ Partially implemented \/ Not implemented/);
            assert.match(await page.locator("#generation-results-examples").textContent(), /Clarification needed is built in/);
            assert.equal(await generate.isEnabled(), true);
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
            await first.fill("Needs clarification");
            await generate.click();
            await page.getByText('"Needs clarification" is built in. Remove it from the custom result labels.', { exact: true }).waitFor();
            assert.equal(await first.getAttribute("aria-invalid"), "true");
            assert.equal(await page.evaluate(() => window.started), 0);
            await first.fill("Implemented");
            for (const [index, value] of ["Partially implemented", "Not implemented", "Deferred", "Cancelled"].entries()) {
                await add.click();
                await page.locator(`#generation-result-${index + 1}`).fill(value);
            }
            assert.equal(await page.locator("[data-result-label]").count(), 5);
            assert.equal(await add.isDisabled(), true);
            assert.equal(await page.locator(".generation-modal").evaluate((modal) => modal.scrollWidth <= modal.clientWidth), true);
            await page.getByRole("button", { name: "Remove result label 5", exact: true }).click();
            await page.getByRole("button", { name: "Remove result label 4", exact: true }).click();
            assert.equal(await add.isEnabled(), true);
            assert.deepEqual(await page.locator("[data-result-label]").evaluateAll((inputs) => inputs.map((input) => input.value)),
                ["Implemented", "Partially implemented", "Not implemented"]);
            assert.equal(await page.locator("#generation-results-examples").isVisible(), true, "examples remain visible after typing");
            if (process.env.VIEWER_SCREENSHOT_DIR) {
                await page.locator(".generation-results").scrollIntoViewIfNeeded();
                await page.screenshot({ path: join(process.env.VIEWER_SCREENSHOT_DIR, `result-settings-${width}-${theme}.png`) });
            }
            await page.evaluate(() => { window.failStart = true; });
            await generate.click();
            await page.getByText("Could not start generation. Try again.", { exact: true }).waitFor();
            assert.equal(await generate.isEnabled(), true, "failed submission cannot leave the button disabled");
            assert.equal(await generate.textContent(), "Generate");
            await page.evaluate(() => { window.failStart = false; window.delayStart = true; });
            await generate.click();
            await page.waitForFunction(() => document.querySelector("#generation-submit").textContent === "Generating…");
            await generate.click();
            assert.equal(await page.evaluate(() => window.started), 2, "double clicks do not submit twice");
            await page.locator("#generation-display-name").fill("Edited while starting");
            await page.waitForTimeout(250);
            assert.equal(await generate.textContent(), "Generating…", "background validation cannot reset an active submission label");
            await page.evaluate(() => { window.finishStart(); window.delayStart = false; });
            await page.locator(".generation-modal").waitFor({ state: "detached" });
            assert.equal(await page.evaluate(() => window.started), 2);
            assert.deepEqual(await page.evaluate(() => window.lastStart.resultLabels), ["Implemented", "Partially implemented", "Not implemented"]);
            await page.evaluate(() => {
                window.openGeneration();
            });
            await first.waitFor();
            assert.equal(await first.inputValue(), "");
            assert.equal(await generate.isEnabled(), true);
            // An earlier preflight response must not overwrite a newer check.
            await page.evaluate(() => {
                window.defer = true;
                window.buttonLabels = [];
                new MutationObserver(() => window.buttonLabels.push(document.querySelector("#generation-submit").textContent))
                    .observe(document.querySelector("#generation-submit"), { childList: true, characterData: true, subtree: true });
            });
            await page.locator("#generation-extension-id").fill("older");
            await page.waitForFunction(() => window.deferred.length === 1);
            assert.equal(await generate.textContent(), "Generate");
            await page.locator("#generation-extension-id").fill("newer");
            await page.waitForFunction(() => window.deferred.length === 2);
            assert.equal(await generate.textContent(), "Generate");
            await page.evaluate(() => window.deferred[1]());
            await page.waitForFunction(() => document.querySelector("#generation-target").value.endsWith("/newer"));
            await page.evaluate(() => window.deferred[0]());
            assert.equal(await first.isEnabled(), true);
            assert.equal(await page.locator("#generation-results-unavailable").count(), 0);
            assert.equal(await generate.isEnabled(), true);
            assert.equal(await generate.textContent(), "Generate");
            assert.deepEqual(await page.evaluate(() => window.buttonLabels), [], "typing and preflight responses never rewrite the button label");
            await page.evaluate(() => { window.defer = false; window.failCheck = true; });
            await generate.click();
            await page.getByText("Could not check generation settings. Try Generate again.", { exact: true }).waitFor();
            assert.equal(await generate.isEnabled(), true);
            assert.equal(await generate.textContent(), "Generate");
            await page.evaluate(() => { window.failCheck = false; });
            await first.fill("Go");
            await add.click();
            await page.locator("#generation-result-1").fill("Kill");
            await page.evaluate(async () => {
                const { state } = await import("/ui/state.js");
                state.snapshot.pipeline = [{ id: "specify" }, { id: "implement" }];
            });
            await page.locator("#generation-extension-id").fill("no-final-artifact");
            assert.equal(await first.isEnabled(), true);
            assert.equal(await add.isEnabled(), true);
            await page.getByRole("button", { name: "Remove result label 2", exact: true }).click();
            await page.getByRole("button", { name: "Remove result label 1", exact: true }).click();
            assert.equal(await page.locator("[data-result-label]").count(), 0);
            assert.equal(await add.isEnabled(), true, "labels remain configurable when the final phase is Implement");
            await add.click();
            await first.fill("Implemented");
            await generate.click();
            await page.locator(".generation-modal").waitFor({ state: "detached" });
            assert.deepEqual(await page.evaluate(() => window.lastStart.resultLabels), ["Implemented"]);
            assert.deepEqual(errors, []);
            await page.close();
        }
    } finally { await browser.close(); }
});
