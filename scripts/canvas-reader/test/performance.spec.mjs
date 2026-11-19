import { createRequire } from "node:module";
import { cpus, totalmem } from "node:os";
import { startFixture } from "../serve-fixture.mjs";

const require = createRequire(new URL("../../../plugins/spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/ui/markdown-reader/package.json", import.meta.url));
const { test, expect } = require("@playwright/test");

function sizedMarkdown(size) {
    const header = "# Performance fixture\n\n";
    const sentence = "Review current working-tree artifacts and preserve the selected workflow. ";
    const sections = Array.from({ length: 40 }, (_, index) => {
        const heading = `## Section ${index + 1}\n\n`;
        return heading + sentence.repeat(Math.floor((size / 40 - heading.length - header.length) / sentence.length)) + "\n\n";
    });
    const content = header + sections.join("");
    return content + " ".repeat(size - Buffer.byteLength(content));
}

for (const canvas of ["wizard", "sdd"]) {
    for (const size of [102_400, 5_242_880]) {
        test(`${canvas} renders and navigates ${size} bytes within the release budget`, async ({ page }, testInfo) => {
            test.setTimeout(90_000);
            const fixture = await startFixture({ canvas, markdown: sizedMarkdown(size) });
            const url = new URL(fixture.url);
            try {
                await page.setViewportSize({ width: 1440, height: 1000 });
                await page.emulateMedia({ reducedMotion: "reduce" });
                await page.addInitScript(() => {
                    const original = window.fetch.bind(window);
                    window.fetch = async (...args) => {
                        const response = await original(...args);
                        if (String(args[0]).includes("/api/review/content")) {
                            const readJson = response.json.bind(response);
                            response.json = async () => {
                                const payload = await readJson();
                                if (payload.ok) {
                                    window.__readerPerfStart = performance.now();
                                    window.__readerPerfBytes = payload.data.byteSize;
                                    const observer = new MutationObserver(() => {
                                        const reader = document.querySelector('[data-reader-state="ready"]');
                                        if (!reader?.querySelector(".md-reader__article h1")) return;
                                        observer.disconnect();
                                        requestAnimationFrame(() => requestAnimationFrame(() => { window.__readerRenderMs = performance.now() - window.__readerPerfStart; }));
                                    });
                                    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
                                }
                                return payload;
                            };
                        }
                        return response;
                    };
                });
                await page.goto(url.href, { waitUntil: "domcontentloaded" });
                if (canvas === "wizard") await page.locator('[data-tab="phases"]').click();
                await (canvas === "wizard" ? page.locator('#phase-card [data-phase-action="view"]') : page.getByTitle("View spec.md", { exact: true })).click();
                await expect(page.locator(".md-reader__article h1")).toHaveText("Performance fixture", { timeout: 60_000 });
                await expect.poll(() => page.evaluate(() => typeof window.__readerRenderMs), { timeout: 60_000 }).toBe("number");
                const render = await page.evaluate(() => ({ milliseconds: window.__readerRenderMs, bytes: window.__readerPerfBytes }));
                const interactions = [];
                if (size === 5_242_880) {
                    for (let index = 0; index < 20; index++) {
                        const timing = await page.evaluate(async (ordinal) => {
                            const reader = document.querySelector("[data-reader-id]");
                            const buttons = [...reader.querySelectorAll("[data-toc-slug]")];
                            const button = buttons.find((element) => element.dataset.tocSlug === `section-${ordinal % 2 ? 39 : 2}`);
                            const started = performance.now();
                            button.click();
                            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                            return { milliseconds: performance.now() - started, highlighted: button.getAttribute("aria-current") === "location" };
                        }, index);
                        interactions.push(timing);
                    }
                }
                const record = {
                    canvas, bytes: render.bytes, renderMs: render.milliseconds, interactionMs: interactions.map((item) => item.milliseconds),
                    responsiveInteractions: interactions.filter((item) => item.highlighted && item.milliseconds <= 200).length,
                    cpu: cpus()[0]?.model, logicalProcessors: cpus().length, memoryGiB: Math.round(totalmem() / 1024 ** 3),
                    node: process.version, browser: page.context().browser()?.version(),
                };
                await testInfo.attach("performance", { body: JSON.stringify(record, null, 2), contentType: "application/json" });
                console.log(JSON.stringify(record));
                expect(render.bytes).toBe(size);
                expect(render.milliseconds).toBeLessThanOrEqual(size === 102_400 ? 1000 : 5000);
                if (interactions.length) expect(record.responsiveInteractions).toBeGreaterThanOrEqual(19);
                expect(fixture.dispatchCount()).toBe(0);
                expect(fixture.workspaceChanged()).toBe(false);
            } finally { await page.close(); expect((await fixture.stop()).cleaned).toBe(true); }
        });
    }
}
