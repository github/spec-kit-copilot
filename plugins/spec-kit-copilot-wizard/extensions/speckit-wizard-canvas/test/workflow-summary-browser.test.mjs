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
    const metadata = { extensionId: "summary-fixture", displayName: "Workflow", workflowListName: "Assessments", description: "Review ideas & decide <next steps>." };
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
                id, slug: id, label: id, latestPhase: last.instanceKey, phases: Object.fromEntries([first, middle, last].map((step) => [
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
            failed.phases[last.instanceKey].review = { state: "failed", statusId: "result-1", label: "Review unavailable", error: "Reopen to retry." };
            const rejected = item("rejected");
            rejected.phases[last.instanceKey].review = { state: "reviewed", statusId: "result-3", label: "Approved" };
            const deferred = item("deferred");
            deferred.phases[last.instanceKey].review = { state: "reviewed", statusId: "result-2", label: "Deferred" };
            const uncertain = item("uncertain");
            uncertain.phases[last.instanceKey].review = { state: "reviewed", statusId: "not-determined", label: "Not determined" };
            const unavailable = item("unavailable");
            unavailable.phases[last.instanceKey].artifactError = "Cannot read";
            unavailable.phases[last.instanceKey].clarificationCount = null;
            const partial = item("partial", { latestPhase: null });
            partial.phases[first.instanceKey].hasRun = true;
            partial.phases[middle.instanceKey].artifact = null;
            partial.phases[last.instanceKey].artifact = null;
            const snapshot = {
                pipeline: blueprint, selectedItemId: "approved", setup: { ready: true },
                artifactReview: { labels: ["Approved", "Deferred", "Rejected"] },
                items: [approved, clarification, reviewing, failed, rejected, unavailable, partial,
                    item("unstarted", { phases: {}, latestPhase: null }), item("pending"), uncertain, deferred, { id: "__new__", label: "New", isNew: true, phases: {} }],
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
                if (url.pathname === "/api/state") return route.fulfill({ json: {
                    ...snapshot, items: snapshot.items.map((item) => ({ ...item, resultTags: item.resultTags
                        ?? [...new Set(Object.values(item.phases ?? {})
                            .filter((phase) => phase.review?.state === "reviewed" && !phase.review.error && !(phase.clarificationCount > 0))
                            .map((phase) => snapshot.artifactReview?.labels[Number(phase.review.statusId?.replace("result-", "")) - 1])
                            .filter(Boolean))] })),
                } });
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
            const description = page.locator(".collection-description");
            assert.equal(await description.textContent(), metadata.description);
            assert.equal(await description.locator("*").count(), 0, "description is plain text, not HTML");
            assert.equal(await description.evaluate((element) =>
                element.previousElementSibling.classList.contains("instance-collection-head")
                && element.nextElementSibling.id === "browse-collection-folder"), true);
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
            assert.deepEqual(await counts.allTextContents(), ["Approved: 1", "Deferred: 1", "Rejected: 1", "Clarification needed: 2"]);
            assert.equal(await row("partial").textContent(), `Run ${middle.label}`);
            assert.equal(await row("unstarted").textContent(), `Run ${first.label}`);
            assert.equal(await row("pending").count(), 0);
            assert.equal(await row("reviewing").count(), 0);
            assert.equal(await row("rejected").textContent(), "Rejected", "fixed IDs, not review labels, choose the result");
            assert.equal(await row("uncertain").count(), 0);
            assert.equal(await row("failed").count(), 0);
            assert.doesNotMatch(await page.locator("body").innerText(), /Not determined|Review unavailable|Reopen to retry/);
            assert.match(await row("unavailable").getAttribute("title"), /Cannot read/);
            snapshot.clarificationTag = false;
            await page.evaluate(() => window.workflowEvents.onmessage());
            await page.waitForFunction(() => !document.querySelector(".collection-summary").textContent.includes("Clarification needed"));
            assert.deepEqual(await counts.allTextContents(), ["Approved: 1", "Deferred: 1", "Rejected: 1"]);
            assert.equal(await page.locator(".needs-clarification").count(), 0);
            assert.doesNotMatch(await page.locator("#instance-collection").innerText(), /Clarification needed/);
            snapshot.clarificationTag = true;
            await page.evaluate(() => window.workflowEvents.onmessage());
            await page.waitForFunction(() => document.querySelector(".collection-summary").textContent.includes("Clarification needed: 2"));
            await page.locator("#browse-collection-folder").click();
            assert.deepEqual(posts, [{ path: "specs" }]);
            failReveal = true;
            await page.locator("#browse-collection-folder").click();
            await page.getByText("Folder does not exist yet.", { exact: true }).waitFor();
            assert.equal(await page.locator("#browse-collection-folder").isEnabled(), true);
            for (const id of ["approved", "clarification", "reviewing", "failed", "rejected", "unavailable", "pending", "uncertain", "deferred"]) {
                await page.locator(`[data-instance="${id}"]`).click();
                await page.locator('[data-phase-index="2"]').click();
                if (id === "approved") assert.equal(await row(id).textContent(), "Clarification needed", "earlier questions take precedence over a later phase result");
                else assert.deepEqual(await phasePill.allTextContents(), await row(id).allTextContents());
            }
            await page.locator('[data-instance="partial"]').click();
            await page.locator('[data-phase-index="2"]').click();
            assert.equal(await row("partial").textContent(), `Run ${middle.label}`, "navigation does not advance progress");
            await page.locator("#phase-args").fill("Keep my draft");
            await page.locator("#workflow-search").fill("approved");
            assert.deepEqual(await counts.allTextContents(), ["Approved: 1", "Deferred: 1", "Rejected: 1", "Clarification needed: 2"]);
            await page.locator("#workflow-search").fill("");
            if (process.env.VIEWER_SCREENSHOT_DIR) {
                await mkdir(process.env.VIEWER_SCREENSHOT_DIR, { recursive: true });
                await page.screenshot({ path: join(process.env.VIEWER_SCREENSHOT_DIR, `workflow-summary-${width}-${theme}.png`), fullPage: true });
            }
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "summary and rows fit panel width");
            for (const clarificationCount of [2, 1]) {
                partial.phases[first.instanceKey].clarificationCount = clarificationCount;
                await page.evaluate(() => window.workflowEvents.onmessage());
                await page.waitForFunction(() => document.querySelector('[data-instance="partial"] .phase-notice').textContent === "Clarification needed");
                assert.equal(await row("partial").textContent(), "Clarification needed", "earlier unresolved questions override the next-phase hint");
                assert.equal(await page.locator("#phase-args").inputValue(), "Keep my draft");
                assert.deepEqual(await counts.allTextContents(), ["Approved: 1", "Deferred: 1", "Rejected: 1", "Clarification needed: 3"]);
            }
            partial.phases[first.instanceKey].clarificationCount = 0;
            await page.evaluate(() => window.workflowEvents.onmessage());
            await page.waitForFunction((label) => document.querySelector('[data-instance="partial"] .phase-notice').textContent === label, `Run ${middle.label}`);
            partial.phases[middle.instanceKey] = { hasRun: true, artifact: "specs/partial/plan.md", clarificationCount: 0 };
            await page.evaluate(() => window.workflowEvents.onmessage());
            await page.waitForFunction((label) => document.querySelector('[data-instance="partial"] .phase-notice').textContent === label, `Run ${last.label}`);
            assert.equal(await page.locator("#phase-args").inputValue(), "Keep my draft");
            approved.phases[last.instanceKey].review = { state: "pending", label: "Not determined" };
            await page.evaluate(() => window.workflowEvents.onmessage());
            await page.waitForFunction(() => document.querySelector(".collection-summary .phase-notice").textContent === "Approved: 0");
            assert.deepEqual(await counts.allTextContents(), ["Approved: 0", "Deferred: 1", "Rejected: 1", "Clarification needed: 2"]);
            assert.equal(await row("approved").textContent(), "Clarification needed", "stale results are hidden without hiding open clarifications");
            approved.phases[last.instanceKey].review = { state: "reviewing", label: "Reviewing" };
            await page.evaluate(() => window.workflowEvents.onmessage());
            assert.equal(await row("approved").textContent(), "Clarification needed", "running reviews do not introduce a temporary result label");
            const savedItems = snapshot.items;
            snapshot.items = [approved, deferred, rejected];
            approved.phases[last.instanceKey].review = { state: "reviewed", statusId: "result-1", label: "Approved" };
            await page.evaluate(() => window.workflowEvents.onmessage());
            await page.waitForFunction(() => document.querySelector(".collection-summary .phase-notice").textContent === "Approved: 1");
            assert.deepEqual(await counts.allTextContents(), ["Approved: 1", "Deferred: 1", "Rejected: 1", "Clarification needed: 1"]);
            for (const blocked of [
                { review: { state: "reviewed", statusId: "not-determined", label: "Not determined" } },
                { review: { state: "pending", label: "Not determined" } },
                { review: { state: "reviewing", label: "Reviewing" } },
                { review: { state: "failed", label: "Review unavailable", error: "Reopen to retry." } },
                { review: { state: "failed", label: "Review unavailable", error: "Artifact is empty" }, artifactError: "Artifact is empty", clarificationCount: null },
                { review: { state: "failed", label: "Review unavailable", error: "Cannot read" }, artifactError: "Cannot read", clarificationCount: null },
                { review: { state: "reviewed", statusId: "result-1", label: "Approved" }, clarificationCount: 1 },
            ]) {
                approved.phases[last.instanceKey] = { artifact: "specs/approved/tasks.md", clarificationCount: 0, ...blocked };
                await page.evaluate(() => window.workflowEvents.onmessage());
                await page.waitForFunction(() => document.querySelector(".collection-summary .phase-notice").textContent === "Approved: 0");
                assert.deepEqual(await counts.allTextContents(), ["Approved: 0", "Deferred: 1", "Rejected: 1", "Clarification needed: 1"]);
                await page.locator('[data-instance="approved"]').click();
                await page.locator('[data-phase-index="2"]').click();
                assert.equal(await row("approved").textContent(), "Clarification needed");
            }
            approved.phases[first.instanceKey].clarificationCount = 0;
            approved.phases[middle.instanceKey] = { artifact: null, hasRun: true, clarificationCount: null,
                review: { state: "reviewed", statusId: "result-2", label: "Deferred" } };
            approved.phases[last.instanceKey] = { artifact: "specs/approved/tasks.md", clarificationCount: 0,
                review: { state: "reviewed", statusId: "result-1", label: "Approved" } };
            approved.latestPhase = middle.instanceKey;
            await page.evaluate(() => window.workflowEvents.onmessage());
            await page.waitForFunction(() => document.querySelector('[data-instance="approved"] .phase-notice').textContent === "Deferred");
            await page.locator('[data-phase-index="1"]').click();
            assert.equal(await phasePill.textContent(), "Deferred", "an intermediate artifact-free phase displays its own result");
            assert.deepEqual(await counts.allTextContents(), ["Approved: 1", "Deferred: 2", "Rejected: 1", "Clarification needed: 0"]);
            approved.latestPhase = first.instanceKey;
            approved.phases[first.instanceKey].review = { state: "reviewed", statusId: "not-determined", label: "Not determined" };
            await page.evaluate(() => window.workflowEvents.onmessage());
            await page.waitForFunction(() => !document.querySelector('[data-instance="approved"] .phase-notice'));
            assert.equal(await phasePill.textContent(), "Deferred", "rerunning an earlier phase preserves other phase results");
            await page.reload();
            await counts.first().waitFor();
            assert.equal(await row("approved").count(), 0, "an untagged rerun stays untagged after reload");
            approved.phases[first.instanceKey] = { artifact: null, clarificationCount: null,
                artifactError: "Cannot read", review: { state: "reviewed", statusId: "result-3", label: "Rejected" } };
            await page.evaluate(() => window.workflowEvents.onmessage());
            await page.waitForFunction(() => document.querySelector('[data-instance="approved"] .phase-notice').textContent === "Rejected");
            await page.locator('[data-phase-index="0"]').click();
            assert.equal(await phasePill.textContent(), "Rejected", "a decisive response result survives an artifact read error");
            assert.deepEqual(await counts.allTextContents(), ["Approved: 1", "Deferred: 2", "Rejected: 2", "Clarification needed: 0"]);
            approved.latestPhase = last.instanceKey;
            approved.phases[first.instanceKey] = { artifact: "specs/approved/spec.md", clarificationCount: 4 };
            snapshot.items = savedItems.filter((entry) => entry.isNew);
            await page.evaluate(() => window.workflowEvents.onmessage());
            await page.waitForFunction(() => document.querySelector(".collection-summary .phase-notice").textContent === "Approved: 0"
                && document.querySelectorAll(".collection-summary .phase-notice").length === 4);
            assert.deepEqual(await counts.allTextContents(), ["Approved: 0", "Deferred: 0", "Rejected: 0", "Clarification needed: 0"]);
            for (const labels of [["Implemented"], ["Implemented", "Partially implemented", "Not implemented", "Blocked", "Cancelled"]]) {
                snapshot.artifactReview = { labels };
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
            snapshot.artifactReview = { labels: ["Specify", "Plan", "Tasks", "Implement"] };
            snapshot.items = ["one", "two", "three"].map((id) => item(id, {
                resultTags: ["Specify", "Plan", "Tasks", "Implement", "Implement"],
            }));
            await page.evaluate(() => window.workflowEvents.onmessage());
            await page.waitForFunction(() => document.querySelector(".collection-summary .phase-notice").textContent === "Specify: 3");
            assert.deepEqual(await counts.allTextContents(), ["Specify: 3", "Plan: 3", "Tasks: 3", "Implement: 3", "Clarification needed: 0"]);
            snapshot.items = snapshot.items.slice(0, 1);
            await page.evaluate(() => window.workflowEvents.onmessage());
            await page.waitForFunction(() => document.querySelector(".collection-summary .phase-notice").textContent === "Specify: 1");
            assert.deepEqual(await counts.allTextContents(), ["Specify: 1", "Plan: 1", "Tasks: 1", "Implement: 1", "Clarification needed: 0"]);
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
            assert.equal(await page.locator('#phase-navigation .phase-run').count(), 0, "existing files alone do not mark phases as run");
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
