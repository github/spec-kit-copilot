// Compare Wizard and standalone artifact viewers in a mocked browser environment.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import { compileBlueprint } from "../generation/compiler.mjs";
import { writeGenerationRequest } from "../generation/storage.mjs";
import { materialize } from "../generation/materialize-template.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const gitRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: root, encoding: "utf8" }).trim();
const prefix = root.slice(gitRoot.length + 1).replaceAll("\\", "/").replace(/\/$/, "");
const baselineRef = process.env.VIEWER_BASELINE_REF ?? "HEAD";
const baselineSharedDirectory = execFileSync("git", ["ls-tree", baselineRef, `${prefix}/shared-workflow-ui`],
    { cwd: root, encoding: "utf8" }).trim() ? "shared-workflow-ui" : "workflow-ui";
const baseline = (path) => {
    const baselinePath = path.replace(/^shared-workflow-ui\//, `${baselineSharedDirectory}/`);
    return execFileSync("git", ["show", `${baselineRef}:${prefix}/${baselinePath}`], { cwd: root, encoding: "utf8" })
        .replace(/(?<!shared-)workflow-ui\//g, "shared-workflow-ui/");
};
const artifactPath = "specs/alpha/spec.md";
const source = [
    "# Artifact title", "A paragraph with **bold**, *italic*, `inline code` and [a link](https://example.test).",
    "## Second heading", "### Third heading", "#### Fourth heading", "##### Fifth heading", "###### Sixth heading",
    "- First item\n- Second item", "1. First ordered\n2. Second ordered",
    "```js\nconst greeting = '<safe>'; // code\n```", "> A quotation\n> with another line.",
    "| Column | Status |\n| --- | ---|\n| `value` | **Ready** |", "---",
    "[NEEDS CLARIFICATION: Scope?]", "[NEEDS CLARIFICATION: Tests?]",
].join("\n\n");

const properties = [
    "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "color", "backgroundColor",
    "backgroundImage", "margin", "padding", "border", "borderRadius", "boxShadow", "textAlign",
    "textDecoration", "whiteSpace", "overflow", "overflowWrap", "verticalAlign", "display",
    "gap", "alignItems", "justifyContent", "maxWidth", "minHeight", "cursor", "transition", "opacity", "outline",
];

test("artifact viewers share left-aligned layout and incumbent formatting: desktop/mobile, light/dark", async (t) => {
    let chromium;
    try {
        ({ chromium } = await import(process.env.PLAYWRIGHT_MODULE
            ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright"));
    } catch (error) {
        if (process.env.PLAYWRIGHT_MODULE) throw error;
        t.skip("Optional browser check: install Playwright or set PLAYWRIGHT_MODULE to its index.mjs");
        return;
    }
    const workspace = join(dirname(fileURLToPath(import.meta.url)), `.viewer-parity-${randomUUID()}`);
    const target = join(workspace, ".github", "extensions", "viewer-fixture");
    const metadata = { extensionId: "viewer-fixture", displayName: "Viewer fixture", description: "Mock artifact viewer" };
    const blueprint = compileBlueprint({ pipeline: [{ id: "specify" }, { id: "plan" }] }, metadata);
    const step = blueprint.pipeline.steps[0];
    const snapshot = {
        pipeline: blueprint, clarificationScope: "viewer-fixture", selectedItemId: "alpha", setup: { ready: true },
        items: [{ id: "alpha", slug: "alpha", label: "Alpha", phases: { [step.instanceKey]: { artifact: artifactPath } } }],
    };
    let browser;
    try {
        await mkdir(target, { recursive: true });
        const request = { requestId: randomUUID(), workspacePath: workspace, metadata, blueprint,
            target: { relativeDirectory: ".github/extensions/viewer-fixture" } };
        const requestDir = await writeGenerationRequest(workspace, request);
        await materialize({ requestFile: join(requestDir, "request.json"), targetDirectory: target, request });
        browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
        if (process.env.VIEWER_SCREENSHOT_DIR) await mkdir(process.env.VIEWER_SCREENSHOT_DIR, { recursive: true });
        const failures = [];
        for (const viewport of [{ width: 1280, height: 1100 }, { width: 390, height: 844 }]) {
            for (const theme of ["light", "dark"]) {
                const results = {};
                for (const variant of ["baseline", "wizard", "generated"]) {
                    const page = await browser.newPage({ viewport, colorScheme: theme, deviceScaleFactor: 1 });
                    const errors = [];
                    const posts = [];
                    let content = source;
                    page.on("pageerror", (error) => errors.push(error.message));
                    await page.route("**/*", async (route) => {
                        const url = new URL(route.request().url());
                        assert.equal(url.origin, "http://127.0.0.1:43219", "fixture must not access external services");
                        if (route.request().method() === "POST") {
                            assert.equal(url.pathname, "/api/artifact/amend", "fixture must never invoke a phase");
                            const input = route.request().postDataJSON();
                            posts.push(input);
                            return route.fulfill({ status: 202, json: { ok: true, phase: input.phase, artifact: input.artifact } });
                        }
                        if (url.pathname === "/api/state") return route.fulfill({ json: snapshot });
                        if (url.pathname === "/api/artifact") return variant === "generated"
                            ? route.fulfill({ json: { content } })
                            : route.fulfill({ contentType: "text/plain", body: content });
                        if (url.pathname === "/api/events") return route.fulfill({ contentType: "text/event-stream", body: "\n" });
                        const path = url.pathname === "/" ? "ui/index.html" : url.pathname.slice(1);
                        let body;
                        if (variant === "generated") body = await readFile(join(target, ...path.split("/")), "utf8");
                        else body = variant === "baseline" && (path.endsWith(".css") || path === "ui/index.html" || path === "ui/modals.js" || path === "ui/phase-runtime.js")
                            ? baseline(path) : await readFile(join(root, ...path.split("/")), "utf8");
                        // Only layout is intentionally changed; preserve the incumbent
                        // formatting comparison and verify the new geometry independently.
                        if (variant === "baseline" && path === "shared-workflow-ui/workflow-theme.css") {
                            body += "\n.artifact-viewer-body { padding: 1.25rem 1.5rem; }\n"
                                + ".artifact-viewer-md { max-width: none; margin: 0; text-align: left; }\n"
                                + "@media (max-width: 640px) { .artifact-viewer-body { padding-inline: 1rem; } }\n";
                        }
                        if (path === "ui/index.html" && variant !== "generated") body = body.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");
                        const contentType = path.endsWith(".html") ? "text/html" : path.endsWith(".css") ? "text/css" : "application/javascript";
                        await route.fulfill({ contentType, body });
                    });
                    await page.addInitScript(({ theme, key, value }) => {
                        localStorage.setItem("speckit-workflow-theme", theme);
                        localStorage.setItem(key, JSON.stringify(value));
                    }, { theme, key: `speckit-clarifications.v1:${JSON.stringify(["viewer-fixture", "alpha", step.instanceKey, artifactPath])}`,
                        value: { answers: [] } });
                    await page.goto("http://127.0.0.1:43219/");
                    await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, theme);
                    const openViewer = async () => {
                        if (variant === "generated") return page.locator("#view-artifact").click();
                        return page.evaluate(async ({ step, artifactPath }) => {
                        const { state } = await import("/ui/state.js");
                        state.snapshot = { workspacePath: "wizard-fixture" };
                        const { openArtifactViewer, setViewersDeps } = await import("/ui/modals.js");
                        setViewersDeps({ postJson: async (url, input) => (await fetch(url, {
                            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
                        })).json() });
                        await openArtifactViewer({ ...step, shortLabel: step.label, artifactPath });
                        }, { step, artifactPath });
                    };
                    await openViewer();
                    await page.locator(".artifact-viewer-md").waitFor();
                    assert.equal(await page.locator(".artifact-viewer-md table").count(), 1);
                    const geometry = await page.locator(".artifact-viewer-body").evaluate((body) => {
                        const content = body.querySelector(".artifact-viewer-md");
                        const rect = content.getBoundingClientRect();
                        const style = getComputedStyle(body);
                        return {
                            inset: rect.left - body.getBoundingClientRect().left,
                            width: rect.width,
                            available: body.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
                            alignment: getComputedStyle(content).textAlign,
                        };
                    });
                    assert.equal(geometry.inset, viewport.width <= 640 ? 16 : 24, `${variant}: compact left gutter`);
                    assert.ok(Math.abs(geometry.width - geometry.available) < 1, `${variant}: use the available viewer width`);
                    assert.equal(geometry.alignment, "left");
                    // Navigation and queue copy are deliberately application-specific.
                    await page.locator(".artifact-viewer-back").evaluate((element) => { element.textContent = "← Viewer"; });
                    assert.deepEqual(errors, []);
                    const renderedContent = await page.locator(".artifact-viewer-md").innerHTML();
                    const styles = await page.locator(".artifact-viewer").evaluate((viewer, properties) =>
                        // The new neutral draft banner is compared between both current
                        // viewers below; its hidden legacy colors are not visual authority.
                        [...viewer.querySelectorAll("*")].filter((element) => !element.closest(".artifact-viewer-clarify-banner")).map((element) => ({
                            tag: element.tagName,
                            styles: Object.fromEntries(properties.map((name) => [name, getComputedStyle(element)[name]])),
                        })), properties);
                    const screenshotPath = (position) => process.env.VIEWER_SCREENSHOT_DIR
                        ? join(process.env.VIEWER_SCREENSHOT_DIR, `${variant}-${viewport.width}-${theme}-${position}.png`) : undefined;
                    const screenshot = await page.screenshot({ animations: "disabled", path: screenshotPath("top") });
                    // The scroller must render the lower code/table/marker section too.
                    await page.locator(".artifact-viewer-body").evaluate((element) => { element.scrollTop = element.scrollHeight; });
                    const lowerScreenshot = await page.screenshot({ animations: "disabled", path: screenshotPath("bottom") });
                    const interactionStyles = {};
                    for (const selector of [".artifact-viewer-back", '[data-clarify-idx="0"]', '[data-clarify-idx="1"]', ".artifact-viewer-md a"]) {
                        const control = page.locator(selector);
                        await control.hover();
                        await page.waitForTimeout(150);
                        interactionStyles[selector] = await control.evaluate((element, properties) =>
                            Object.fromEntries(properties.map((name) => [name, getComputedStyle(element)[name]])), properties);
                    }
                    const applyButton = page.locator(".artifact-viewer-back");
                    await applyButton.evaluate((element) => { element.disabled = true; });
                    await page.waitForTimeout(150);
                    interactionStyles.disabled = await applyButton.evaluate((element, properties) =>
                        Object.fromEntries(properties.map((name) => [name, getComputedStyle(element)[name]])), properties);
                    await applyButton.evaluate((element) => { element.disabled = false; });
                    // Enter the same keyboard modality in both apps; generated opening used a click.
                    await page.keyboard.press("Tab");
                    await page.locator(".artifact-viewer-back").focus();
                    await page.waitForTimeout(150);
                    interactionStyles.focus = await page.locator(".artifact-viewer-back").evaluate((element) =>
                        ({ outline: getComputedStyle(element).outline, outlineOffset: getComputedStyle(element).outlineOffset }));
                    results[variant] = { content: renderedContent, styles, screenshot, lowerScreenshot, interactionStyles };
                    if (variant !== "baseline") {
                        const save = async (index, value) => {
                            await page.locator(`[data-clarify-idx="${index}"]`).click();
                            await page.locator(variant === "generated" ? "#clarification-answer" : ".wizard-modal-textarea").fill(value);
                            await page.getByRole("button", { name: "Save draft", exact: true }).click();
                        };
                        await save(0, "The viewer only.");
                        await save(1, "Focused tests.");
                        const contrast = await page.locator(".artifact-viewer-clarify-banner").evaluate((element) => {
                            const luminance = (color) => color.match(/[\d.]+/g).slice(0, 3).map(Number)
                                .map((channel) => channel / 255)
                                .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
                                .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
                            const style = getComputedStyle(element);
                            const foreground = luminance(style.color), background = luminance(style.backgroundColor);
                            return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
                        });
                        assert.ok(contrast >= 4.5, `${variant} ${theme} draft banner contrast: ${contrast}`);
                        assert.equal(posts.length, 0, "drafting all answers never auto-submits");
                        assert.equal(await page.locator(".clarify-pill-answered").count(), 0);
                        assert.equal(await page.getByRole("button", { name: "Edit draft", exact: true }).count(), 2);
                        await page.locator('[data-draft-select="1"]').uncheck();
                        await page.locator(".artifact-viewer-body").evaluate((element) => { element.scrollTop = 0; });
                        results[variant].drafts = await page.locator(".artifact-viewer").screenshot({ animations: "disabled", path: screenshotPath("drafts") });
                        await page.getByRole("button", { name: "Apply answers (1)", exact: true }).click();
                        await page.getByRole("status").filter({ hasText: "Submitted; waiting" }).waitFor();
                        assert.equal(posts.length, 1);
                        assert.equal(posts[0].answers.length, 1);
                        assert.equal(await page.locator(".clarify-pill").count(), 2, "ACK is not marker resolution");
                        assert.equal(await page.locator("#apply-clarifications").isEnabled(), true);
                        assert.equal(await page.getByRole("button", { name: "Refresh artifact", exact: true }).count(), 0);
                        content = `${source}\n\nPlease name the included features.`;
                        await page.getByText("Please name the included features.", { exact: true }).waitFor();
                        await save(0, "Include intake and research only.");
                        assert.equal(await page.locator("#apply-clarifications").isEnabled(), true);
                        await page.locator("#apply-clarifications").click();
                        await page.getByRole("status").filter({ hasText: "Submitted; waiting" }).waitFor();
                        assert.equal(posts.length, 2);
                        assert.deepEqual(posts[1].answers, [{
                            question: "Scope?", marker: "[NEEDS CLARIFICATION: Scope?]",
                            answer: "Include intake and research only.",
                        }]);
                        await save(0, "Newer scope draft");
                        await page.locator(".artifact-viewer-back").click();
                        await openViewer();
                        assert.equal(await page.locator('[data-clarify-idx="0"]').getAttribute("title"), "Newer scope draft");
                        content = source.replace("[NEEDS CLARIFICATION: Scope?]", "Scope: the viewer only.");
                        await page.waitForFunction(() => document.querySelectorAll(".clarify-pill").length === 1);
                        await page.waitForFunction(() => document.querySelector(".artifact-viewer-clarify-banner")?.textContent.includes("Selected markers are no longer visible"));
                        assert.match(await page.locator(".artifact-viewer-clarify-banner").textContent(), /retained draft.*need review/s);
                        assert.match(await page.locator(".clarify-retained-draft").textContent(), /Newer scope draft/);
                        assert.equal(posts.length, 2);
                        assert.deepEqual(errors, []);
                    }
                    await page.locator(".artifact-viewer-back").click();
                    assert.equal(await page.locator(".artifact-viewer").isVisible(), false);
                    await page.close();
                }
                assert.ok(results.wizard.drafts.equals(results.generated.drafts), `neutral draft viewer parity: ${viewport.width}px ${theme}`);
                for (const variant of ["wizard", "generated"]) {
                    for (const field of ["content", "styles", "screenshot", "lowerScreenshot", "interactionStyles"]) {
                        try {
                            const label = `${variant} ${viewport.width}px ${theme} ${field}`;
                            if (field.endsWith("Screenshot") || field === "screenshot") {
                                assert.ok(results[variant][field].equals(results.baseline[field]), label);
                            } else if (field === "styles") {
                                const differences = [];
                                results[variant].styles.forEach((element, index) => {
                                    const expected = results.baseline.styles[index];
                                    for (const property of properties) {
                                        if (element.styles[property] !== expected?.styles[property]) differences.push(
                                            `${index} ${element.tag} ${property}: ${element.styles[property]} != ${expected?.styles[property]}`,
                                        );
                                    }
                                });
                                assert.equal(differences.length, 0, `${label}\n${differences.join("\n")}`);
                            } else assert.deepEqual(results[variant][field], results.baseline[field], label);
                        } catch (error) {
                            failures.push(error.message);
                        }
                    }
                }
            }
        }
        assert.equal(failures.length, 0, failures.join("\n\n"));
    } finally {
        await browser?.close();
        await rm(workspace, { recursive: true, force: true });
    }
});
