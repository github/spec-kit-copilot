// Check dispatch-derived phase states and clarification precedence in the materialized UI.
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
                    [specify.instanceKey]: { hasRun: true, artifact: null, clarificationCount: null },
                    [plan.instanceKey]: { hasRun: true, artifact: "specs/alpha/plan.md", clarificationCount: 2 },
                    [tasks.instanceKey]: { hasRun: false, artifact: "specs/alpha/tasks.md", clarificationCount: 0 },
                    [implement.instanceKey]: { hasRun: false, artifact: "specs/alpha/tasks.md", clarificationCount: null,
                        artifactError: "Could not read the artifact safely. Automatic refresh will retry." },
                };
                const snapshot = {
                    pipeline: blueprint, selectedItemId: "alpha", setup: { ready: true },
                    items: [{ id: "alpha", slug: "alpha", label: "Alpha", phases }],
                };
                let dispatch = "failed";
                const posts = [];
                await page.route("**/*", async (route) => {
                    const url = new URL(route.request().url());
                    assert.equal(url.origin, "http://127.0.0.1:43220");
                    if (route.request().method() === "POST") {
                        assert.equal(url.pathname, "/api/run");
                        const input = route.request().postDataJSON();
                        posts.push(input);
                        if (dispatch === "failed") return route.fulfill({ status: 400, json: { error: "Dispatch failed." } });
                        if (dispatch === "queued") return route.fulfill({ json: { ok: true, queued: true } });
                        await new Promise((resolve) => setTimeout(resolve, 200));
                        phases[input.phase].hasRun = true;
                        return route.fulfill({ json: { ok: true, hasRun: true, itemId: "alpha" } });
                    }
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
                assert.match(await buttons.nth(0).getAttribute("class"), /phase-run/);
                assert.match(await buttons.nth(0).getAttribute("title"), /completion not verified/);
                assert.equal(await buttons.nth(0).locator(".step-order").textContent(), "✓");
                assert.match(await buttons.nth(1).getAttribute("aria-label"), /Clarification needed/);
                assert.equal(await buttons.nth(1).locator(".step-order").textContent(), "!");
                assert.doesNotMatch(await buttons.nth(2).getAttribute("class"), /phase-run|needs-clarification/);
                assert.equal(await buttons.nth(2).locator(".step-order").textContent(), "3");
                assert.doesNotMatch(await buttons.nth(3).getAttribute("class"), /phase-run|needs-clarification/);
                await buttons.nth(1).click();
                const pill = page.locator("#phase-card .phase-notice");
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
                assert.match(await buttons.nth(1).getAttribute("class"), /phase-run/);
                assert.equal(await buttons.nth(1).getAttribute("aria-current"), "step");
                assert.equal(await page.locator("#phase-args").inputValue(), "Retain these phase details");
                await buttons.nth(3).click();
                assert.equal(await pill.count(), 0, "unconfigured canvases show errors inline, not as status pills");
                assert.equal(await page.locator("#phase-card").getByText(phases[implement.instanceKey].artifactError, { exact: true }).isVisible(), true);
                const last = phases[implement.instanceKey];
                delete last.artifactError;
                last.clarificationCount = 0;
                last.review = { state: "reviewed", label: "Goal met" };
                await page.evaluate(() => window.workflowEvents.onmessage());
                assert.equal(await pill.count(), 0, "review metadata cannot introduce result pills without configured labels");
                assert.doesNotMatch(await buttons.nth(3).getAttribute("class"), /phase-run/, "shared artifact does not imply execution");
                assert.equal(await page.locator("#run-phase").textContent(), "Run phase");
                await page.locator("#run-phase").click();
                await page.getByText("Dispatch failed.", { exact: true }).waitFor();
                assert.doesNotMatch(await buttons.nth(3).getAttribute("class"), /phase-run/);
                dispatch = "queued";
                await page.locator("#run-phase").click();
                await page.getByText("Queued until setup is ready. This phase has not been sent yet.", { exact: true }).waitFor();
                assert.equal(await page.locator("#run-phase").textContent(), "Run phase");
                assert.doesNotMatch(await buttons.nth(3).getAttribute("class"), /phase-run/);
                dispatch = "sent";
                await page.locator("#run-phase").click();
                await page.getByRole("button", { name: "Sending…" }).waitFor();
                assert.equal(await page.locator("#run-phase").isDisabled(), true);
                assert.doesNotMatch(await buttons.nth(3).getAttribute("class"), /phase-run/);
                await page.getByRole("button", { name: "Run again", exact: true }).waitFor();
                assert.match(await buttons.nth(3).getAttribute("class"), /phase-run/);
                assert.doesNotMatch(await buttons.nth(2).getAttribute("class"), /phase-run/, "running Implement does not mark Tasks");
                assert.equal(posts.length, 3);
                await page.reload();
                await buttons.nth(3).click();
                assert.equal(await page.locator("#run-phase").textContent(), "Run again");
                assert.match(await buttons.nth(3).getAttribute("class"), /phase-run/);
                dispatch = "failed";
                await page.locator("#run-phase").click();
                await page.locator('[data-answer="confirm"]').click();
                await page.getByText("Dispatch failed.", { exact: true }).waitFor();
                assert.match(await buttons.nth(3).getAttribute("class"), /phase-run/, "failed rerun preserves previous dispatch");
                last.clarificationCount = 1;
                await page.evaluate(() => window.workflowEvents.onmessage());
                assert.equal(await pill.textContent(), "Clarification needed");
                last.clarificationCount = 0;
                last.review = { state: "failed", label: "Review unavailable", error: "Rerun or reopen to retry." };
                await page.evaluate(() => window.workflowEvents.onmessage());
                assert.equal(await pill.count(), 0);
                assert.equal(await page.locator("#phase-card").getByText("Rerun or reopen to retry.", { exact: true }).isVisible(), true);
                delete last.review;
                await page.evaluate(() => window.workflowEvents.onmessage());
                assert.equal(await pill.count(), 0, "unconfigured final phases have no readiness pill");
                assert.deepEqual(errors, []);
                await page.close();
            }
        }
    } finally {
        await browser?.close();
        await rm(workspace, { recursive: true, force: true });
    }
});
