import { createRequire } from "node:module";
import { startFixture } from "../serve-fixture.mjs";

const require = createRequire(new URL("../../../plugins/spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/ui/markdown-reader/package.json", import.meta.url));
const { test, expect } = require("@playwright/test");
const markdown = "# Clarification fixture\n\n## Scope\n\n[NEEDS CLARIFICATION: Which scope?]\n\n## Tests\n\n[NEEDS CLARIFICATION: Which tests?]\n\n`[NEEDS CLARIFICATION: Inert example?]`\n";

async function openReader(page, canvas, fixture) {
    const url = new URL(fixture.url);
    await page.goto(url.href, { waitUntil: "domcontentloaded" });
    if (canvas === "wizard") await page.locator('[data-tab="phases"]').click();
    await (canvas === "wizard" ? page.locator('#phase-card [data-phase-action="view"]') : page.getByTitle("View spec.md", { exact: true })).click();
    await expect(page.locator(".md-reader__article [data-clarification-id]")).toHaveCount(2);
}

test("Wizard retains cross-file clarification drafts and blocks close during a validated submission", async ({ page }) => {
    const fixture = await startFixture({ canvas: "wizard", markdown });
    let completeSubmission;
    let submitted;
    await page.route("**/api/phase/submit?*", async (route) => {
        submitted = route.request().postDataJSON();
        await new Promise((resolve) => { completeSubmission = resolve; });
        await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ queued: true, untracked: true }) });
    });
    try {
        await openReader(page, "wizard", fixture);
        await page.getByRole("button", { name: "Clarify: Which scope?", exact: true }).click();
        await page.locator(".wizard-modal-textarea").fill("Only the synthetic feature.");
        await page.getByRole("button", { name: "Save answer", exact: true }).click();
        await expect(page.getByRole("button", { name: "Clarify: Which scope?", exact: true })).toHaveText("Answer queued");
        await page.getByRole("combobox", { name: "Artifacts", exact: true }).selectOption({ label: "research.md" });
        await expect(page.getByRole("heading", { name: "Fixture research", exact: true })).toBeVisible();
        await expect(page.locator(".md-reader__article [data-clarification-id]")).toHaveCount(0);
        await page.getByRole("button", { name: "Next artifact", exact: true }).click();
        await expect(page.getByRole("button", { name: "Clarify: Which scope?", exact: true })).toHaveText("Answer queued");
        await page.getByRole("button", { name: "Clarify: Which scope?", exact: true }).click();
        await expect(page.locator(".wizard-modal-textarea")).toHaveValue("Only the synthetic feature.");
        await page.locator(".wizard-modal-cancel").click();
        await page.getByRole("button", { name: "Apply and Rerun", exact: true }).click();
        await expect.poll(() => Boolean(completeSubmission)).toBe(true);
        await page.locator(".artifact-viewer-back").click();
        await expect(page.locator("#phase-artifact-viewer")).toBeVisible();
        expect(submitted.commandName).toBe("speckit.specify");
        expect(submitted.review.answers).toHaveLength(1);
        expect(submitted.review.expectedRevision).toMatch(/^sha256:[a-f0-9]{64}$/);
        completeSubmission();
        await expect(page.locator("#phase-artifact-viewer")).toBeHidden();
        expect(fixture.dispatchCount()).toBe(0);
        expect(fixture.blockedWrites()).toBe(0);
        expect(fixture.workspaceChanged()).toBe(false);
    } finally { completeSubmission?.(); await page.close(); expect((await fixture.stop()).cleaned).toBe(true); }
});

test("SDD submits exactly one bound clarification immediately without a draft batch", async ({ page }) => {
    const fixture = await startFixture({ canvas: "sdd", markdown });
    const submitted = [];
    await page.route("**/api/clarify?*", async (route) => {
        submitted.push(route.request().postDataJSON());
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });
    try {
        await openReader(page, "sdd", fixture);
        await page.getByRole("button", { name: "Clarify: Which scope?", exact: true }).click();
        await page.locator("#clarifyAnswer").fill("Only the synthetic feature.");
        await page.getByRole("button", { name: "Submit and run clarify", exact: true }).click();
        await expect(page.locator("#clarifyDialog")).toBeHidden();
        expect(submitted).toHaveLength(1);
        expect(submitted[0].question).toBe("Which scope?");
        expect(submitted[0].index).toBe(0);
        expect(submitted[0].expectedRevision).toMatch(/^sha256:[a-f0-9]{64}$/);
        expect(submitted[0].artifactId).toMatch(/^artifact_/);
        expect(submitted[0].answers).toBeUndefined();
        await expect(page.locator("[data-reader-id]")).toHaveCount(0);
        expect(fixture.dispatchCount()).toBe(0);
        expect(fixture.workspaceChanged()).toBe(false);
    } finally { await page.close(); expect((await fixture.stop()).cleaned).toBe(true); }
});

test("Wizard Back discards unsubmitted answers without dispatch", async ({ page }) => {
    const fixture = await startFixture({ canvas: "wizard", markdown });
    let submissions = 0;
    await page.route("**/api/phase/submit?*", async (route) => { submissions++; await route.abort(); });
    try {
        await openReader(page, "wizard", fixture);
        await page.getByRole("button", { name: "Clarify: Which scope?", exact: true }).click();
        await page.locator(".wizard-modal-textarea").fill("Discard this synthetic draft.");
        await page.getByRole("button", { name: "Save answer", exact: true }).click();
        await page.locator(".artifact-viewer-back").click();
        await expect(page.locator("#phase-artifact-viewer")).toBeHidden();
        await page.locator('#phase-card [data-phase-action="view"]').click();
        await expect(page.getByRole("button", { name: "Clarify: Which scope?", exact: true })).toHaveText("Clarify");
        expect(submissions).toBe(0);
        expect(fixture.dispatchCount()).toBe(0);
        expect(fixture.workspaceChanged()).toBe(false);
    } finally { await page.close(); expect((await fixture.stop()).cleaned).toBe(true); }
});

test("Wizard failed submissions preserve answers and can be retried", async ({ page }) => {
    const fixture = await startFixture({ canvas: "wizard", markdown });
    let attempts = 0;
    await page.route("**/api/phase/submit?*", async (route) => {
        attempts++;
        await route.fulfill({ status: attempts === 1 ? 500 : 202, contentType: "application/json",
            body: JSON.stringify(attempts === 1 ? { error: "Synthetic dispatch failure" } : { queued: true }) });
    });
    try {
        await openReader(page, "wizard", fixture);
        await page.getByRole("button", { name: "Clarify: Which scope?", exact: true }).click();
        await page.locator(".wizard-modal-textarea").fill("Preserve this synthetic draft.");
        await page.getByRole("button", { name: "Save answer", exact: true }).click();
        await page.getByRole("button", { name: "Apply and Rerun", exact: true }).click();
        await expect(page.locator(".artifact-viewer-clarify-banner")).toContainText("answers are preserved");
        await expect(page.getByRole("button", { name: "Clarify: Which scope?", exact: true })).toHaveText("Answer queued");
        await page.getByRole("button", { name: "Apply and Rerun", exact: true }).click();
        await expect(page.locator("#phase-artifact-viewer")).toBeHidden();
        expect(attempts).toBe(2);
        expect(fixture.dispatchCount()).toBe(0);
    } finally { await page.close(); expect((await fixture.stop()).cleaned).toBe(true); }
});

test("Wizard automatically flushes all answered current questions as one real-command batch", async ({ page }) => {
    const fixture = await startFixture({ canvas: "wizard", markdown });
    const submitted = [];
    await page.route("**/api/phase/submit?*", async (route) => {
        submitted.push(route.request().postDataJSON());
        await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ queued: true }) });
    });
    try {
        await openReader(page, "wizard", fixture);
        for (const question of ["Which scope?", "Which tests?"]) {
            await page.getByRole("button", { name: `Clarify: ${question}`, exact: true }).click();
            await page.locator(".wizard-modal-textarea").fill(`Synthetic answer for ${question}`);
            await page.getByRole("button", { name: "Save answer", exact: true }).click();
        }
        await expect(page.locator("#phase-artifact-viewer")).toBeHidden();
        expect(submitted).toHaveLength(1);
        expect(submitted[0].commandName).toBe("speckit.specify");
        expect(submitted[0].review.answers).toHaveLength(2);
        expect(fixture.dispatchCount()).toBe(0);
        expect(fixture.workspaceChanged()).toBe(false);
    } finally { await page.close(); expect((await fixture.stop()).cleaned).toBe(true); }
});

test("Wizard preserves answers from an earlier revision until explicit current-source confirmation", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 900 });
    const fixture = await startFixture({ canvas: "wizard", markdown, allowMutations: true });
    const submitted = [];
    await page.route("**/api/phase/submit?*", async (route) => {
        submitted.push(route.request().postDataJSON());
        await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ queued: true }) });
    });
    try {
        await openReader(page, "wizard", fixture);
        const reader = page.locator("[data-reader-id]");
        const revision = await reader.getAttribute("data-revision");
        await page.getByRole("button", { name: "Clarify: Which scope?", exact: true }).click();
        await page.locator(".wizard-modal-textarea").fill("Retain this answer across revision changes.");
        await page.getByRole("button", { name: "Save answer", exact: true }).click();
        await fixture.mutateArtifact("spec.md", `${markdown}\nUpdated synthetic source.\n`);
        await expect(reader).not.toHaveAttribute("data-revision", revision);
        await expect(page.locator(".artifact-viewer-clarify-banner")).toContainText("earlier revision");
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await expect(page.getByRole("button", { name: "Apply and Rerun", exact: true })).toHaveCount(0);
        expect(submitted).toHaveLength(0);
        await page.getByRole("button", { name: "Review saved answer: Which scope?", exact: true }).click();
        await expect(page.locator(".wizard-modal-textarea")).toHaveValue("Retain this answer across revision changes.");
        await page.getByRole("button", { name: "Save answer", exact: true }).click();
        await page.getByRole("button", { name: "Apply and Rerun", exact: true }).click();
        await expect(page.locator("#phase-artifact-viewer")).toBeHidden();
        expect(submitted).toHaveLength(1);
        expect(submitted[0].review.expectedRevision).not.toBe(revision);
        expect(fixture.dispatchCount()).toBe(0);
    } finally { await page.close(); expect((await fixture.stop()).cleaned).toBe(true); }
});
