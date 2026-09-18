// Verify collection totals, row status parity, next-phase hints and safe folder interaction.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import { compileBlueprint } from "../generation/compiler.mjs";
import { writeGenerationRequest } from "../generation/storage.mjs";
import { materialize } from "../generation/materialize-template.mjs";

test("workflow summaries independently count current reviews across refresh, selection and search", async (t) => {
    let chromium;
    try {
        ({ chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright"));
    } catch (error) {
        if (process.env.PLAYWRIGHT_MODULE) throw error;
        t.skip("Set PLAYWRIGHT_MODULE for browser checks."); return;
    }
    const workspace = join(dirname(fileURLToPath(import.meta.url)), `.workflow-summary-${randomUUID()}`);
    const target = join(workspace, ".github", "extensions", "summary-fixture");
    const metadata = { extensionId: "summary-fixture", displayName: "Workflow", workflowListName: "Assessments", description: "Summary fixture" };
    const blueprint = compileBlueprint({ pipeline: ["specify", "plan", "tasks"].map((id) => ({ id })) }, metadata);
    const [first, middle, last] = blueprint.pipeline.steps;
    let browser;
    try {
        await mkdir(target, { recursive: true });
        const request = { requestId: randomUUID(), workspacePath: workspace, metadata, blueprint,
            target: { relativeDirectory: ".github/extensions/summary-fixture" } };
        const requestDir = await writeGenerationRequest(workspace, request);
        await materialize({ requestFile: join(requestDir, "request.json"), targetDirectory: target, request });
        browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
        for (const width of [1280, 390]) for (const theme of ["light", "dark"]) {
            const page = await browser.newPage({ viewport: { width, height: 1000 }, colorScheme: theme });
            const errors = [], posts = [];
            let failReveal = false;
            page.on("pageerror", (error) => errors.push(error.message));
            const item = (id, overrides = {}) => ({
                id, slug: id, label: id, phases: Object.fromEntries([first, middle, last].map((step) => [
                    step.instanceKey, { artifact: step.artifact.pathTemplate.replace("<slug>", id), clarificationCount: 0 },
                ])), ...overrides,
            });
            const approved = item("approved");
            approved.phases[last.instanceKey].review = { state: "reviewed", statusId: "result-1", label: "Approved" };
            approved.phases[first.instanceKey].clarificationCount = 4;
            const clarification = item("clarification");
            clarification.phases[last.instanceKey].review = { state: "reviewed", statusId: "result-1", label: "Approved" };
            clarification.phases[last.instanceKey].clarificationCount = 2;
            const reviewing = item("reviewing");
            reviewing.phases[last.instanceKey].review = { state: "reviewing", label: "Reviewing" };
            const failed = item("failed");
            failed.phases[last.instanceKey].review = { state: "failed", label: "Review unavailable", error: "Reopen to retry." };
            const rejected = item("rejected");
            rejected.phases[last.instanceKey].review = { state: "reviewed", statusId: "result-3", label: "Approved" };
            const deferred = item("deferred");
            deferred.phases[last.instanceKey].review = { state: "reviewed", statusId: "result-2", label: "Deferred" };
            const uncertain = item("uncertain");
            uncertain.phases[last.instanceKey].review = { state: "reviewed", statusId: "not-determined", label: "Not determined" };
            const unavailable = item("unavailable");
            unavailable.phases[last.instanceKey].artifactError = "Cannot read";
            unavailable.phases[last.instanceKey].clarificationCount = null;
            const partial = item("partial");
            partial.phases[middle.instanceKey].artifact = null;
            partial.phases[last.instanceKey].artifact = null;
            const snapshot = {
                pipeline: blueprint, selectedItemId: "approved", setup: { ready: true },
                artifactReview: { phase: last.instanceKey, labels: ["Approved", "Deferred", "Rejected"] },
                items: [approved, clarification, reviewing, failed, rejected, unavailable, partial,
                    item("unstarted", { phases: {} }), item("pending"), uncertain, deferred, { id: "__new__", label: "New", isNew: true, phases: {} }],
            };
            await page.route("**/*", async (route) => {
                const url = new URL(route.request().url());
                assert.equal(url.origin, "http://127.0.0.1:43223");
                if (route.request().method() === "POST") {
                    assert.equal(url.pathname, "/api/reveal", "summaries must not run phases or request reviews");
                    posts.push(route.request().postDataJSON());
                    return route.fulfill({ status: failReveal ? 400 : 200,
                        json: failReveal ? { error: "Folder does not exist yet." } : { ok: true } });
                }
                if (url.pathname === "/api/state") return route.fulfill({ json: snapshot });
                const path = url.pathname === "/" ? "ui/index.html" : url.pathname.slice(1);
                await route.fulfill({ contentType: path.endsWith(".html") ? "text/html" : path.endsWith(".css") ? "text/css" : "application/javascript",
                    body: await readFile(join(target, ...path.split("/")), "utf8") });
            });
            await page.addInitScript((theme) => {
                localStorage.setItem("speckit-workflow-theme", theme);
                window.EventSource = class { constructor() { window.workflowEvents = this; } };
            }, theme);
            await page.goto("http://127.0.0.1:43223/");
            const counts = page.locator(".collection-summary .phase-notice");
            const row = (id) => page.locator(`[data-instance="${id}"] .phase-notice`);
            const phasePill = page.locator("#phase-card .phase-notice");
            await counts.first().waitFor();
            assert.deepEqual(await counts.allTextContents(), ["Approved: 1", "Deferred: 1", "Rejected: 1", "Clarification needed: 2", "Not determined: 1"]);
            assert.equal(await row("partial").textContent(), `Run ${middle.label}`);
            assert.equal(await row("unstarted").textContent(), `Run ${first.label}`);
            assert.equal(await row("pending").textContent(), "Not determined");
            assert.equal(await row("rejected").textContent(), "Rejected", "fixed IDs, not review labels, choose the result");
            assert.equal(await row("uncertain").textContent(), "Not determined");
            assert.match(await row("failed").getAttribute("title"), /Reopen to retry/);
            assert.match(await row("unavailable").getAttribute("title"), /Cannot read/);
            await page.locator("#browse-collection-folder").click();
            assert.deepEqual(posts, [{ path: "specs" }]);
            failReveal = true;
            await page.locator("#browse-collection-folder").click();
            await page.getByText("Folder does not exist yet.", { exact: true }).waitFor();
            assert.equal(await page.locator("#browse-collection-folder").isEnabled(), true);
            for (const id of ["approved", "clarification", "reviewing", "failed", "rejected", "unavailable", "pending", "uncertain", "deferred"]) {
                await page.locator(`[data-instance="${id}"]`).click();
                await page.locator('[data-phase-index="2"]').click();
                assert.equal(await phasePill.textContent(), await row(id).textContent());
            }
            await page.locator('[data-instance="partial"]').click();
            await page.locator('[data-phase-index="2"]').click();
            assert.equal(await row("partial").textContent(), `Run ${middle.label}`, "navigation does not advance progress");
            await page.locator("#phase-args").fill("Keep my draft");
            await page.locator("#workflow-search").fill("approved");
            assert.deepEqual(await counts.allTextContents(), ["Approved: 1", "Deferred: 1", "Rejected: 1", "Clarification needed: 2", "Not determined: 1"]);
            await page.locator("#workflow-search").fill("");
            if (process.env.VIEWER_SCREENSHOT_DIR) {
                await mkdir(process.env.VIEWER_SCREENSHOT_DIR, { recursive: true });
                await page.screenshot({ path: join(process.env.VIEWER_SCREENSHOT_DIR, `workflow-summary-${width}-${theme}.png`), fullPage: true });
            }
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "summary and rows fit panel width");
            partial.phases[middle.instanceKey] = { artifact: "specs/partial/plan.md", clarificationCount: 0 };
            await page.evaluate(() => window.workflowEvents.onmessage());
            await page.waitForFunction((label) => document.querySelector('[data-instance="partial"] .phase-notice').textContent === label, `Run ${last.label}`);
            assert.equal(await page.locator("#phase-args").inputValue(), "Keep my draft");
            approved.phases[last.instanceKey].review = { state: "pending", label: "Not determined" };
            await page.evaluate(() => window.workflowEvents.onmessage());
            await page.waitForFunction(() => document.querySelector(".collection-summary .phase-notice").textContent === "Approved: 0");
            assert.deepEqual(await counts.allTextContents(), ["Approved: 0", "Deferred: 1", "Rejected: 1", "Clarification needed: 2", "Not determined: 1"]);
            const savedItems = snapshot.items;
            snapshot.items = [approved, deferred, rejected];
            approved.phases[last.instanceKey].review = { state: "reviewed", statusId: "result-1", label: "Approved" };
            await page.evaluate(() => window.workflowEvents.onmessage());
            await page.waitForFunction(() => document.querySelectorAll(".collection-summary .phase-notice").length === 4);
            assert.deepEqual(await counts.allTextContents(), ["Approved: 1", "Deferred: 1", "Rejected: 1", "Clarification needed: 1"]);
            for (const blocked of [
                { review: { state: "reviewed", statusId: "not-determined", label: "Not determined" } },
                { review: { state: "pending", label: "Not determined" } },
                { review: { state: "reviewing", label: "Reviewing" } },
                { review: { state: "failed", label: "Review unavailable", error: "Reopen to retry." } },
                { review: { state: "reviewed", statusId: "result-1", label: "Approved" }, artifactError: "Artifact is empty", clarificationCount: null },
                { review: { state: "reviewed", statusId: "result-1", label: "Approved" }, artifactError: "Cannot read", clarificationCount: null },
                { review: { state: "reviewed", statusId: "result-1", label: "Approved" }, clarificationCount: 1 },
            ]) {
                approved.phases[last.instanceKey] = { artifact: "specs/approved/tasks.md", clarificationCount: 0, ...blocked };
                await page.evaluate(() => window.workflowEvents.onmessage());
                const explicitUnknown = blocked.review.statusId === "not-determined";
                await page.waitForFunction((count) => document.querySelectorAll(".collection-summary .phase-notice").length === count, explicitUnknown ? 5 : 4);
                assert.deepEqual(await counts.allTextContents(), ["Approved: 0", "Deferred: 1", "Rejected: 1", "Clarification needed: 1",
                    ...(explicitUnknown ? ["Not determined: 1"] : [])]);
                await page.locator('[data-instance="approved"]').click();
                await page.locator('[data-phase-index="2"]').click();
                assert.equal(await phasePill.textContent(), await row("approved").textContent());
            }
            snapshot.items = savedItems.filter((entry) => entry.isNew);
            await page.evaluate(() => window.workflowEvents.onmessage());
            await page.waitForFunction(() => document.querySelector(".collection-summary .phase-notice").textContent === "Approved: 0"
                && document.querySelectorAll(".collection-summary .phase-notice").length === 4);
            assert.deepEqual(await counts.allTextContents(), ["Approved: 0", "Deferred: 0", "Rejected: 0", "Clarification needed: 0"]);
            for (const labels of [["Implemented"], ["Implemented", "Partially implemented", "Not implemented", "Blocked", "Cancelled"]]) {
                snapshot.artifactReview = { phase: last.instanceKey, labels };
                snapshot.items = labels.map((label, index) => {
                    const entry = item(`classified-${index}`);
                    entry.phases[last.instanceKey].review = { state: "reviewed", statusId: `result-${index + 1}`, label };
                    return entry;
                });
                await page.evaluate(() => window.workflowEvents.onmessage());
                await page.waitForFunction((count) => document.querySelectorAll(".collection-summary .phase-notice").length === count, labels.length + 1);
                assert.deepEqual(await counts.allTextContents(), [...labels.map((label) => `${label}: 1`), "Clarification needed: 0"]);
                for (let index = 0; index < labels.length; index++) assert.equal(await row(`classified-${index}`).textContent(), labels[index]);
                assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "five result counts fit narrow panels");
                snapshot.items = savedItems.filter((entry) => entry.isNew);
                await page.evaluate(() => window.workflowEvents.onmessage());
                await page.waitForFunction(() => document.querySelector(".collection-summary .phase-notice").textContent.endsWith(": 0"));
                assert.deepEqual(await counts.allTextContents(), [...labels.map((label) => `${label}: 0`), "Clarification needed: 0"]);
            }
            snapshot.items = savedItems;
            approved.phases[last.instanceKey] = { artifact: "specs/approved/tasks.md", clarificationCount: 0 };
            snapshot.artifactReview = null;
            for (const entry of snapshot.items) delete entry.phases?.[last.instanceKey]?.review;
            await page.evaluate(() => window.workflowEvents.onmessage());
            await page.waitForFunction(() => document.querySelector(".collection-summary .phase-notice").textContent === "Clarification needed: 2");
            assert.deepEqual(await counts.allTextContents(), ["Clarification needed: 2"]);
            await page.locator('[data-instance="approved"]').click();
            await page.locator('[data-phase-index="2"]').click();
            assert.equal(await phasePill.count(), 0);
            assert.equal(await row("approved").textContent(), "Clarification needed", "earlier questions remain visible without result labels");
            for (const id of ["rejected", "partial", "unstarted", "pending", "unavailable"]) assert.equal(await row(id).count(), 0);
            await page.locator('[data-instance="unavailable"]').click();
            await page.locator('[data-phase-index="2"]').click();
            assert.equal(await phasePill.count(), 0);
            assert.equal(await page.locator('#phase-card [role="status"].workflow-error').textContent(), "Cannot read");
            assert.equal(await page.locator('[data-instance="unavailable"] [role="status"].workflow-error').textContent(), "Cannot read");
            assert.equal(await page.locator('#phase-navigation .artifact-ready').count(), 2);
            await page.locator('[data-instance="approved"]').click();
            assert.equal(await page.locator('#phase-navigation .needs-clarification').count(), 1);
            assert.equal(await page.locator("#view-artifact").isEnabled(), true);
            snapshot.items = snapshot.items.filter((entry) => entry.isNew);
            await page.evaluate(() => window.workflowEvents.onmessage());
            await page.waitForFunction(() => document.querySelector(".collection-summary .phase-notice").textContent === "Clarification needed: 0");
            assert.deepEqual(await counts.allTextContents(), ["Clarification needed: 0"]);
            assert.equal(await page.locator("#browse-collection-folder").isEnabled(), true);
            assert.deepEqual(errors, []);
            await page.close();
        }
    } finally {
        await browser?.close();
        await rm(workspace, { recursive: true, force: true });
    }
});
