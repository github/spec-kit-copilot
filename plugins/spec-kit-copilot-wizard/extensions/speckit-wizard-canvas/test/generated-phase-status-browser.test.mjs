// Check artifact-derived phase states and neutral notices in the materialized browser UI.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import { compileBlueprint } from "../generation/compiler.mjs";
import { writeGenerationRequest } from "../generation/storage.mjs";
import { materialize } from "../generation/materialize-template.mjs";

test("phase status and neutral notices refresh without losing selection or drafts in both themes", async (t) => {
    let chromium;
    try {
        ({ chromium } = await import(process.env.PLAYWRIGHT_MODULE
            ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright"));
    } catch (error) {
        if (process.env.PLAYWRIGHT_MODULE) throw error;
        t.skip("Optional browser check: install Playwright or set PLAYWRIGHT_MODULE to its index.mjs");
        return;
    }
    const workspace = join(dirname(fileURLToPath(import.meta.url)), `.phase-status-${randomUUID()}`);
    const target = join(workspace, ".github", "extensions", "status-fixture");
    const metadata = { extensionId: "status-fixture", displayName: "Workflow", description: "Phase status fixture" };
    const blueprint = compileBlueprint({ pipeline: ["specify", "plan", "tasks", "implement"].map((id) => ({ id })) }, metadata);
    const [specify, plan, tasks, implement] = blueprint.pipeline.steps;
    let browser;
    try {
        await mkdir(target, { recursive: true });
        const request = { requestId: randomUUID(), workspacePath: workspace, metadata, blueprint,
            target: { relativeDirectory: ".github/extensions/status-fixture" } };
        const requestDir = await writeGenerationRequest(workspace, request);
        await materialize({ requestFile: join(requestDir, "request.json"), targetDirectory: target, request });
        browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
        if (process.env.VIEWER_SCREENSHOT_DIR) await mkdir(process.env.VIEWER_SCREENSHOT_DIR, { recursive: true });
        for (const width of [1280, 390]) {
            for (const theme of ["light", "dark"]) {
                const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme: theme });
                const errors = [];
                page.on("pageerror", (error) => errors.push(error.message));
                const phases = {
                    [specify.instanceKey]: { artifact: "specs/alpha/spec.md", clarificationCount: 0 },
                    [plan.instanceKey]: { artifact: "specs/alpha/plan.md", clarificationCount: 2 },
                    [tasks.instanceKey]: { artifact: null, clarificationCount: null },
                    [implement.instanceKey]: { artifact: "specs/alpha/implementation.md", clarificationCount: null,
                        artifactError: "Could not read the artifact safely. Automatic refresh will retry." },
                };
                const snapshot = {
                    pipeline: blueprint, selectedItemId: "alpha", setup: { ready: true },
                    items: [{ id: "alpha", slug: "alpha", label: "Alpha", phases }],
                };
                await page.route("**/*", async (route) => {
                    const url = new URL(route.request().url());
                    assert.equal(url.origin, "http://127.0.0.1:43220");
                    assert.equal(route.request().method(), "GET", "status checks never execute a phase");
                    if (url.pathname === "/api/state") return route.fulfill({ json: snapshot });
                    const path = url.pathname === "/" ? "ui/index.html" : url.pathname.slice(1);
                    const contentType = path.endsWith(".html") ? "text/html" : path.endsWith(".css") ? "text/css" : "application/javascript";
                    await route.fulfill({ contentType, body: await readFile(join(target, ...path.split("/")), "utf8") });
                });
                await page.addInitScript((theme) => {
                    localStorage.setItem("speckit-workflow-theme", theme);
                    window.EventSource = class { constructor() { window.workflowEvents = this; } };
                }, theme);
                await page.goto("http://127.0.0.1:43220/");
                const buttons = page.locator("#phase-navigation .step");
                await buttons.nth(3).waitFor();
                assert.match(await buttons.nth(0).getAttribute("class"), /artifact-ready/);
                assert.equal(await buttons.nth(0).locator(".step-order").textContent(), "✓");
                assert.match(await buttons.nth(1).getAttribute("aria-label"), /Clarification needed/);
                assert.equal(await buttons.nth(1).locator(".step-order").textContent(), "!");
                assert.doesNotMatch(await buttons.nth(2).getAttribute("class"), /artifact-ready|needs-clarification/);
                assert.equal(await buttons.nth(2).locator(".step-order").textContent(), "3");
                assert.doesNotMatch(await buttons.nth(3).getAttribute("class"), /artifact-ready|needs-clarification/);
                await buttons.nth(1).click();
                const pill = page.locator(".phase-notice");
                assert.equal(await pill.textContent(), "Clarification needed");
                const colors = await pill.evaluate((element) => {
                    const style = getComputedStyle(element);
                    const stepStyle = getComputedStyle(document.querySelector(".step.needs-clarification"));
                    return { background: style.backgroundColor, border: style.borderColor,
                        phaseBackground: stepStyle.backgroundColor, phaseBorder: stepStyle.borderColor,
                        outline: stepStyle.outlineStyle };
                });
                assert.notEqual(colors.background, colors.phaseBackground);
                assert.notEqual(colors.border, colors.phaseBorder);
                assert.equal(colors.outline, "solid", "selection remains visible on amber");
                assert.equal(await pill.locator("*").count(), 0, "notice is text-only");
                await page.locator("#phase-args").fill("Retain these phase details");
                assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no page overflow");
                if (process.env.VIEWER_SCREENSHOT_DIR) {
                    await page.screenshot({ path: join(process.env.VIEWER_SCREENSHOT_DIR, `phase-status-${width}-${theme}.png`) });
                }
                phases[plan.instanceKey].clarificationCount = 1;
                await page.evaluate(() => window.workflowEvents.onmessage());
                assert.equal(await pill.textContent(), "Clarification needed", "partial answers remain amber");
                phases[plan.instanceKey].clarificationCount = 0;
                await page.evaluate(() => window.workflowEvents.onmessage());
                assert.equal(await pill.count(), 0);
                assert.match(await buttons.nth(1).getAttribute("class"), /artifact-ready/);
                assert.equal(await buttons.nth(1).getAttribute("aria-current"), "step");
                assert.equal(await page.locator("#phase-args").inputValue(), "Retain these phase details");
                await buttons.nth(3).click();
                assert.equal(await pill.textContent(), "Artifact unavailable");
                assert.deepEqual(await pill.evaluate((element) => {
                    const style = getComputedStyle(element);
                    return { background: style.backgroundColor, border: style.borderColor };
                }), { background: colors.background, border: colors.border }, "all notices use one neutral style");
                const last = phases[implement.instanceKey];
                delete last.artifactError;
                last.clarificationCount = 0;
                last.review = { state: "reviewed", label: "Goal met" };
                await page.evaluate(() => window.workflowEvents.onmessage());
                assert.equal(await pill.textContent(), "Goal met");
                assert.match(await buttons.nth(3).getAttribute("class"), /artifact-ready/);
                assert.equal(await pill.locator("*").count(), 0);
                last.clarificationCount = 1;
                await page.evaluate(() => window.workflowEvents.onmessage());
                assert.equal(await pill.textContent(), "Clarification needed");
                last.clarificationCount = 0;
                last.review = { state: "failed", label: "Review unavailable", error: "Rerun or reopen to retry." };
                await page.evaluate(() => window.workflowEvents.onmessage());
                assert.equal(await pill.textContent(), "Review unavailable");
                assert.match(await pill.getAttribute("aria-label"), /Rerun or reopen/);
                delete last.review;
                await page.evaluate(() => window.workflowEvents.onmessage());
                assert.equal(await pill.count(), 0, "standard artifact-ready behavior has no extra pill");
                assert.deepEqual(errors, []);
                await page.close();
            }
        }
    } finally {
        await browser?.close();
        await rm(workspace, { recursive: true, force: true });
    }
});
