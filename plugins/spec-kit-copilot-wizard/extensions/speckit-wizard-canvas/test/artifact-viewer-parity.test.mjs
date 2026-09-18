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
const baseline = (path) => execFileSync("git", ["show", `${baselineRef}:${prefix}/${path}`], { cwd: root, encoding: "utf8" });
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

test("artifact viewers match incumbent computed styles and pixels: desktop/mobile, light/dark", async (t) => {
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
                    page.on("pageerror", (error) => errors.push(error.message));
                    await page.route("**/*", async (route) => {
                        const url = new URL(route.request().url());
                        assert.equal(url.origin, "http://127.0.0.1:43219", "fixture must not access external services");
                        assert.equal(route.request().method(), "GET", "fixture must never dispatch a phase");
                        if (url.pathname === "/api/state") return route.fulfill({ json: snapshot });
                        if (url.pathname === "/api/artifact") return variant === "generated"
                            ? route.fulfill({ json: { content: source } })
                            : route.fulfill({ contentType: "text/plain", body: source });
                        if (url.pathname === "/api/events") return route.fulfill({ contentType: "text/event-stream", body: "\n" });
                        const path = url.pathname === "/" ? "ui/index.html" : url.pathname.slice(1);
                        let body;
                        if (variant === "generated") body = await readFile(join(target, ...path.split("/")), "utf8");
                        else body = variant === "baseline" && (path.endsWith(".css") || path === "ui/index.html" || path === "ui/modals.js")
                            ? baseline(path) : await readFile(join(root, ...path.split("/")), "utf8");
                        if (path === "ui/index.html" && variant !== "generated") body = body.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");
                        const contentType = path.endsWith(".html") ? "text/html" : path.endsWith(".css") ? "text/css" : "application/javascript";
                        await route.fulfill({ contentType, body });
                    });
                    await page.addInitScript(({ theme, key, value }) => {
                        localStorage.setItem("speckit-workflow-theme", theme);
                        localStorage.setItem(key, JSON.stringify(value));
                    }, { theme, key: `speckit-clarifications.v1:${JSON.stringify(["viewer-fixture", "alpha", step.instanceKey, artifactPath])}`,
                        value: { answers: [{ question: "Scope?", answer: "The viewer only." }], lastSubmitted: null } });
                    await page.goto("http://127.0.0.1:43219/");
                    await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, theme);
                    if (variant === "generated") await page.locator("#view-artifact").click();
                    else await page.evaluate(async ({ step, artifactPath }) => {
                        const { queueClarification } = await import("/ui/phase-runtime.js");
                        queueClarification(step.commandName, "Scope?", "The viewer only.");
                        const { openArtifactViewer } = await import("/ui/modals.js");
                        await openArtifactViewer({ ...step, shortLabel: step.label, artifactPath });
                    }, { step, artifactPath });
                    await page.locator(".artifact-viewer-md").waitFor();
                    assert.equal(await page.locator(".artifact-viewer-md table").count(), 1);
                    // Navigation and queue copy are deliberately application-specific.
                    await page.locator(".artifact-viewer-back").evaluate((element) => { element.textContent = "← Viewer"; });
                    await page.locator(".artifact-viewer-clarify-banner span").evaluate((element) => {
                        element.textContent = "1 clarification queued — 1 remaining.";
                    });
                    await page.locator(".artifact-viewer-clarify-banner button").evaluate((element) => {
                        element.textContent = "Apply answers";
                    });
                    assert.deepEqual(errors, []);
                    const content = await page.locator(".artifact-viewer-md").innerHTML();
                    const styles = await page.locator(".artifact-viewer").evaluate((viewer, properties) =>
                        [...viewer.querySelectorAll("*")].map((element) => ({
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
                    for (const selector of [".artifact-viewer-back", ".clarify-pill:not(.clarify-pill-answered)", ".clarify-pill-answered", ".artifact-viewer-md a", ".artifact-viewer-clarify-banner button"]) {
                        const control = page.locator(selector);
                        await control.hover();
                        await page.waitForTimeout(150);
                        interactionStyles[selector] = await control.evaluate((element, properties) =>
                            Object.fromEntries(properties.map((name) => [name, getComputedStyle(element)[name]])), properties);
                    }
                    const applyButton = page.locator(".artifact-viewer-clarify-banner button");
                    await applyButton.evaluate((element) => { element.disabled = true; });
                    await page.waitForTimeout(150);
                    interactionStyles.disabled = await applyButton.evaluate((element, properties) =>
                        Object.fromEntries(properties.map((name) => [name, getComputedStyle(element)[name]])), properties);
                    // Enter the same keyboard modality in both apps; generated opening used a click.
                    await page.keyboard.press("Tab");
                    await page.locator(".artifact-viewer-back").focus();
                    await page.waitForTimeout(150);
                    interactionStyles.focus = await page.locator(".artifact-viewer-back").evaluate((element) =>
                        ({ outline: getComputedStyle(element).outline, outlineOffset: getComputedStyle(element).outlineOffset }));
                    results[variant] = { content, styles, screenshot, lowerScreenshot, interactionStyles };
                    await page.locator(".artifact-viewer-back").click();
                    assert.equal(await page.locator(".artifact-viewer").isVisible(), false);
                    await page.close();
                }
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
