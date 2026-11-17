import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test, expect } from "./playwright.mjs";
import { validateLocalSource } from "../../plugins/spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/server/designer-local-sources.mjs";

const ui = new URL("../../plugins/spec-kit-copilot-wizard/extensions/speckit-canvas-designer/ui/",
    import.meta.url);
const extension = new URL("../../spec-kit-extensions/extension-canvas-design/", import.meta.url);
const stockControls = new URL("../../spec-kit-extensions/extension-canvas-design/shared-controls/",
    import.meta.url);
const subAgents = await validateLocalSource("presets", fileURLToPath(
    new URL("../../spec-kit-presets/copilot-sub-agents/", import.meta.url)));

async function openDesigner(page, fields, extraPage, warnings = [], templates = [],
    outputStatusFailure = false) {
    const controls = await Promise.all(["stock-text", "stock-checkbox"].map(async (name) =>
        JSON.parse(await readFile(new URL(`${name}/control.json`, stockControls), "utf8"))));
    const constraints = {
        "canvas.id": { type: "string", minLength: 1, maxLength: 100,
            pattern: "^(?!(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$)[a-z0-9][a-z0-9-]*$" },
        "canvas.displayName": { type: "string", minLength: 1, maxLength: 120 },
        "canvas.description": { type: "string", maxLength: 240 },
        "canvas.workflowListName": { type: "string", maxLength: 80 },
        "canvas.workflowItemName": { type: "string", maxLength: 80,
            pattern: "^[^\\x00-\\x1f\\x7f]*$" },
        "workflowSlug.userProvided": { type: "boolean" },
        "billing.costCode": { type: "string", maxLength: 64 },
    };
    const values = { "canvas.id": "", "canvas.displayName": "",
        "canvas.description": "", "canvas.workflowListName": "", "canvas.workflowItemName": "",
        "workflowSlug.userProvided": false, "billing.costCode": "" };
    const ids = [...fields, ...(extraPage?.fields ?? [])].map((field) => field.id);
    for (const field of [...fields, ...(extraPage?.fields ?? [])]) {
        field.validation = { ...constraints[field.id],
            ...(field.id === "canvas.id" ? { forbiddenValues: [
                "speckit-canvas-designer", "speckit-wizard", "speckit-canvas-generator",
            ] } : {}) };
    }
    const state = { handoffId: "test", revision: "test", generationAvailable: true,
        generationError: null,
        settingsRevision: 0, persisted: false, templates, controls,
        adapters: { "stock.text": "designer-control-adapter-text",
            "stock.checkbox": "designer-control-adapter-checkbox" },
        pages: [{ page: "designer-essentials", title: "Essentials", order: 10,
            description: "Configure your canvas.", fields },
        ...(extraPage ? [extraPage] : [])],
        constraints: Object.fromEntries(ids.map((id) => [id, constraints[id]])),
        values: Object.fromEntries(ids.map((id) => [id, values[id]])) };
    if (outputStatusFailure) state.values["canvas.id"] = "blocked-canvas";
    const requests = [];
    const saved = [];
    const revealed = [];
    const opened = [];
    await page.route("**/*", async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === "/api/state") {
            await route.fulfill({ json: state });
        } else if (path === "/api/output-status") {
            if (outputStatusFailure) {
                await route.fulfill({ status: 500, json: { error: "Cannot inspect this canvas folder" } });
                return;
            }
            const canvasId = new URL(route.request().url()).searchParams.get("canvasId");
            await route.fulfill({ json: { status: requests.ready ? "ready" : "absent",
                target: `.github/extensions/${canvasId}/`, ...(requests.ready
                    ? { requestId: requests.readyRequestId ?? "test-generation" } : {}) } });
        } else if (path === "/api/reveal-output" || path === "/api/open-generated") {
            const action = route.request().postDataJSON();
            if (path === "/api/open-generated" && !requests.ready) {
                await route.fulfill({ status: 422, json: {
                    error: "Cannot open canvas: target is absent. Generate the canvas files first.",
                } });
                return;
            }
            (path === "/api/reveal-output" ? revealed : opened).push(action);
            await route.fulfill({ status: path === "/api/open-generated" ? 202 : 200,
                json: { ...(path === "/api/open-generated" ? { status: "opening" } : {}),
                    target: path === "/api/reveal-output" && !requests.ready
                        ? ".github/extensions/" : `.github/extensions/${action.canvasId}/` } });
        } else if (path === "/api/save") {
            const request = route.request().postDataJSON();
            saved.push(request);
            state.values = request.values;
            state.settingsRevision += 1;
            state.persisted = true;
            await route.fulfill({ json: state });
        } else if (path === "/api/generate") {
            const request = route.request().postDataJSON();
            expect(request.settingsRevision).toBe(state.settingsRevision);
            expect(request.values).toEqual(state.values);
            requests.push(request);
            const invalid = !/^(?!(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$)[a-z0-9][a-z0-9-]*$/.test(request.values["canvas.id"])
                ? "Canvas ID (canvas.id)"
                : !request.values["canvas.displayName"]?.trim() ? "Title (canvas.displayName)"
                    : request.values["billing.costCode"]?.length > 64
                        ? "Cost code (billing.costCode)" : null;
            await route.fulfill(invalid
                ? { status: 400, json: { error: `Invalid ${invalid}` } }
                : { status: 202, json: { target: `.github/extensions/${request.values["canvas.id"]}/`,
                    requestId: request.replaceExisting ? "replacement-generation" : "test-generation",
                    warnings } });
        } else if (path === "/adapters/designer-control-adapter-text.mjs"
            || path === "/adapters/designer-control-adapter-checkbox.mjs") {
            const name = path.includes("checkbox") ? "stock-checkbox" : "stock-text";
            await route.fulfill({ body: await readFile(new URL(`shared-controls/${name}/designer.mjs`, extension)),
                contentType: "text/javascript" });
        } else if (path === "/" || path === "/ui/app.js" || path === "/ui/styles.css"
            || path === "/ui/generation-state.js"
            || path === "/ui/generated-output-state.js"
            || path === "/ui/identity-control.js" || path === "/ui/output-evidence.js"
            || path === "/ui/external-control-adapter-contract.js"
            || path === "/ui/badges-control.js" || path === "/ui/badge-duplicates.js"
            || path === "/ui/badge-selection-contract.js" || path === "/ui/badge-import-contract.js") {
            const file = path === "/" ? "index.html" : path.slice(4);
            await route.fulfill({ body: await readFile(new URL(file, ui)), contentType:
                file.endsWith(".html") ? "text/html" : file.endsWith(".css")
                    ? "text/css" : "text/javascript" });
        } else await route.continue();
    });
    await page.goto("/?token=designer-essentials-test");
    await expect(page.getByRole("heading", { name: "Essentials" })).toBeVisible();
    requests.saved = saved;
    requests.revealed = revealed;
    requests.opened = opened;
    return requests;
}

async function generateFromTab(page) {
    await page.getByRole("tab", { name: "Generate" }).click();
    await page.locator("#generate-canvas").click();
}

const core = [{ id: "canvas.id", label: "Canvas ID" },
    { id: "canvas.displayName", label: "Title" }];
const stock = [{ id: "canvas.description", label: "Description" },
    { id: "canvas.workflowListName", label: "Header text" },
    { id: "canvas.workflowItemName", label: "Workflow item name" },
    { id: "workflowSlug.userProvided", label: "Allow custom slug", type: "boolean" }];

test("output status errors leave the Designer form available on initial load", async ({ page }) => {
    await openDesigner(page, core, undefined, [], [], true);
    await expect(page.locator("#conn-status")).toHaveText("Live");
    await expect(page.locator("#page-error")).toHaveText("Cannot inspect this canvas folder");
    await expect(page.getByRole("heading", { name: "Essentials" })).toBeVisible();
    await page.getByRole("textbox", { name: /Canvas ID/ }).fill("different-canvas");
    await expect(page.getByRole("textbox", { name: /Canvas ID/ })).toHaveValue("different-canvas");
});

test("incompatible Generate response reports an error without recording a request", async ({ page }) => {
    await openDesigner(page, core);
    await page.route("**/api/generate?*", (route) => route.fulfill({ status: 202,
        json: { target: ".github/extensions/broken-response/", requestId: "request-1",
            warnings: "Wrong type" } }));
    await page.getByRole("textbox", { name: /Canvas ID/ }).fill("broken-response");
    await page.getByRole("textbox", { name: /Title/ }).fill("Broken response");
    await generateFromTab(page);
    await expect(page.locator("#page-error")).toHaveText("Invalid generated canvas submission response");
    await expect(page.locator("#generation-status")).toHaveText("Not generated");
    await expect(page.locator("#generate-canvas")).toBeEnabled();
});

test("Generate remains creating files and displays installed-version warnings", async ({ page }) => {
    const warning = `presets ${subAgents.id}: Wizard version ${subAgents.version}, installed version unverified.`;
    const requests = await openDesigner(page, core, undefined,
        [warning]);
    await page.getByRole("textbox", { name: /Canvas ID/ }).fill("stock-canvas");
    await page.getByRole("textbox", { name: /Title/ }).fill("Stock Canvas");
    await generateFromTab(page);
    await expect(page.locator("#action-message"))
        .toContainText(`Warning: ${warning}`);
    await expect(page.locator("#generation-status")).toHaveText("Creating canvas files.");
    expect(requests).toHaveLength(1);
});

test("a failed implicit Save leaves the draft editable and never dispatches Generate", async ({ page }) => {
    const requests = await openDesigner(page, core);
    await page.getByRole("textbox", { name: /Canvas ID/ }).fill("retry-canvas");
    await page.getByRole("textbox", { name: /Title/ }).fill("Retry Canvas");
    const rejectSave = (route) => route.fulfill({ status: 409,
        json: { error: "Designer settings changed elsewhere" } });
    await page.route("**/api/save?*", rejectSave);
    await generateFromTab(page);
    await expect(page.locator("#page-error")).toContainText(
        "Could not save settings: Designer settings changed elsewhere");
    await page.getByRole("tab", { name: "Essentials" }).click();
    await expect(page.getByRole("textbox", { name: /Canvas ID/ })).toHaveValue("retry-canvas");
    await page.getByRole("tab", { name: "Generate" }).click();
    await expect(page.locator("#generate-canvas")).toBeEnabled();
    expect(requests).toHaveLength(0);
    await page.unroute("**/api/save?*", rejectSave);
    await generateFromTab(page);
    await expect.poll(() => requests.length).toBe(1);
    await expect(page.locator("#generation-status")).toHaveText("Creating canvas files.");
    await expect(page.locator("#generate-canvas")).toBeEnabled();
});

test("computed provider approval cancels without sending and submits the approved source and hash", async ({ page }) => {
    const provider = await readFile(new URL(
        "../fixtures/test-presets/copilot-canvas-values-test/values/workflow.mjs", import.meta.url));
    const approved = { name: "canvas-value-workflow-provider",
        sourceId: "copilot-canvas-values-test",
        hash: createHash("sha256").update(provider).digest("hex") };
    const requests = await openDesigner(page, core, undefined, [], [
        { ...approved, kind: "generated.computed-value-provider" },
    ]);
    await page.getByRole("textbox", { name: /Canvas ID/ }).fill("provider-canvas");
    await page.getByRole("textbox", { name: /Title/ }).fill("Provider Canvas");
    await page.getByRole("tab", { name: "Generate" }).click();
    const generate = page.locator("#generate-canvas");
    await generate.click();
    const dialog = page.getByRole("dialog", { name: "Approve generated value providers" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveClass("designer-dialog");
    await expect(dialog).toContainText(approved.name);
    await expect(dialog).toContainText(`Source: ${approved.sourceId}`);
    await expect(dialog).toContainText(`SHA-256: ${approved.hash}`);
    await expect(generate).toBeDisabled();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).not.toBeVisible();
    await expect(generate).toBeEnabled();
    expect(requests).toHaveLength(0);
    await generate.click();
    await dialog.getByRole("button", { name: "Approve and Generate" }).click();
    await expect.poll(() => requests.length).toBe(1);
    expect(requests.saved).toHaveLength(1);
    expect(requests.saved[0].values["canvas.id"]).toBe("provider-canvas");
    expect(requests[0].approvedProviders).toEqual([approved]);
    await expect(generate).toBeEnabled();
    await expect(page.locator("#generation-status")).toContainText("Creating canvas files");
    await expect(page.locator("#open-generated-canvas")).toBeDisabled();
    await expect(page.locator("#conn-status")).toHaveText("Live");
});

test("stock Essentials keep ordered controls and Generate submits all enabled values", async ({ page }) => {
    const requests = await openDesigner(page, [...core, ...stock]);
    await expect(page.locator(".settings-field label")).toHaveText([
        "Canvas ID (required)", "Title (required)", "Description",
        "Header text", "Workflow item name", "Allow custom slug",
    ]);
    await generateFromTab(page);
    await expect(page.locator("#page-error")).toContainText("Invalid Canvas ID (canvas.id)");
    await page.getByRole("tab", { name: "Essentials" }).click();
    await page.getByRole("textbox", { name: /Canvas ID/ }).fill("stock-canvas");
    await page.getByRole("textbox", { name: /Title/ }).fill("Stock Canvas");
    await page.getByRole("textbox", { name: "Description" }).fill("A description");
    await page.getByRole("textbox", { name: "Header text" }).fill("My workflows");
    await page.getByRole("textbox", { name: "Workflow item name" }).fill("Issue");
    await page.getByRole("checkbox", { name: "Allow custom slug" }).check();
    await generateFromTab(page);
    await expect.poll(() => requests.length).toBe(2);
    expect(requests[1].values).toEqual({
        "canvas.id": "stock-canvas", "canvas.displayName": "Stock Canvas",
        "canvas.description": "A description", "canvas.workflowListName": "My workflows",
        "canvas.workflowItemName": "Issue",
        "workflowSlug.userProvided": true,
    });
});

test("minimal Essentials work, while an invalid additional page visibly blocks Generate", async ({ page }) => {
    const requests = await openDesigner(page, core, { page: "canvas-settings-billing",
        title: "Billing", order: 20, error: { name: "canvas-settings-billing",
            path: "billing.json", reason: "Invalid Designer JSON" } });
    await expect(page.locator(".settings-field")).toHaveCount(2);
    await expect(page.locator("#generate-canvas")).toBeDisabled();
    await expect(page.locator("#generation-error"))
        .toContainText("Cannot generate: canvas-settings-billing could not load. Invalid Designer JSON");
    await page.getByRole("tab", { name: /Billing/ }).click();
    await expect(page.locator("#generate-canvas")).toBeHidden();
    await expect(page.locator("#open-generated-canvas")).toBeHidden();
    await expect(page.getByText("Could not load canvas-settings-billing")).toBeVisible();
    expect(requests).toHaveLength(0);
});

test("minimal Essentials submit only identity and invalid enabled Billing values block Generate", async ({ page }) => {
    const requests = await openDesigner(page, core, { page: "canvas-settings-billing",
        title: "Billing", order: 20, fields: [{ id: "billing.costCode", label: "Cost code" }] });
    await page.getByRole("textbox", { name: /Canvas ID/ }).fill("minimal-canvas");
    await page.getByRole("textbox", { name: /Title/ }).fill("Minimal Canvas");
    await page.getByRole("tab", { name: "Billing" }).click();
    await page.locator('[name="billing.costCode"]').evaluate((input) => {
        input.maxLength = 100;
        input.value = "x".repeat(65);
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await generateFromTab(page);
    await expect(page.locator("#page-error")).toContainText("Invalid Cost code (billing.costCode)");
    expect(requests).toHaveLength(1);
    await page.getByRole("textbox", { name: "Cost code" }).fill("CC-481");
    await generateFromTab(page);
    await expect.poll(() => requests.length).toBe(2);
    expect(requests[1].values).toEqual({
        "canvas.id": "minimal-canvas", "canvas.displayName": "Minimal Canvas",
        "billing.costCode": "CC-481",
    });
});

test("Generate focuses a field whose label contains parentheses", async ({ page }) => {
    await openDesigner(page, core, { page: "canvas-settings-billing",
        title: "Billing", order: 20, fields: [{ id: "billing.costCode", label: "Risk (high)" }] });
    await page.route("**/api/generate?*", (route) => route.fulfill({
        status: 400, json: { error: "Invalid Risk (high) (billing.costCode)" },
    }));
    await page.getByRole("textbox", { name: /Canvas ID/ }).fill("risk-canvas");
    await page.getByRole("textbox", { name: /Title/ }).fill("Risk Canvas");
    await generateFromTab(page);
    await expect(page.getByRole("tab", { name: "Billing" })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".settings-field-error")).toBeVisible();
    await expect(page.locator(".settings-field")).toBeFocused();
    await expect(page.locator("#page-error")).toHaveText("Invalid Risk (high) (billing.costCode)");
});

test("Generate tab follows Canvas ID, then verifies files and offers guarded regeneration and Open", async ({ page }) => {
    const requests = await openDesigner(page, core);
    await expect(page.getByRole("tab", { name: "Outputs" })).toHaveCount(0);
    await expect(page.getByRole("tab")).toHaveText(["Essentials", "Generate"]);
    await expect(page.locator("#generate-canvas")).toBeHidden();
    await expect(page.locator("#open-generated-canvas")).toBeHidden();
    await page.getByRole("textbox", { name: /Canvas ID/ }).fill("first-canvas");
    await page.getByRole("textbox", { name: /Title/ }).fill("First Canvas");
    await page.getByRole("tab", { name: "Generate" }).click();
    await expect(page.getByRole("heading", { name: "Create and open your canvas" })).toBeVisible();
    const steps = page.locator(".generate-step");
    await expect(steps).toHaveCount(3);
    await expect(steps.nth(0).getByRole("heading", { name: "Generate" })).toBeVisible();
    await expect(steps.nth(1).getByRole("heading", { name: "Open" })).toBeVisible();
    await expect(steps.nth(2).getByRole("heading", { name: "Share", exact: true })).toBeVisible();
    await expect(steps.locator(".step-index")).toHaveText(["1", "2", "3"]);
    await expect(steps.nth(1)).toContainText("Open your generated canvas in this session.");
    await expect(page.locator("#open-status")).toHaveText("Generate the canvas first.");
    const buttonStyles = await page.locator("#generate-canvas, #open-generated-canvas").evaluateAll(
        (buttons) => buttons.map((button) => {
            const style = getComputedStyle(button);
            return [style.backgroundColor, style.color, style.fontWeight, style.padding];
        }));
    expect(buttonStyles[0]).toEqual(buttonStyles[1]);
    await expect(page.locator("#output-target")).toHaveText(".github/extensions/first-canvas/");
    await expect(page.locator("#open-output-folder")).toHaveText(".github/extensions/first-canvas/");
    await expect(page.locator("#share-project-copy")).toBeHidden();
    await expect(page.locator("#share-target-note")).toContainText("Generate and verify");
    await expect(page.getByRole("heading", { name: "Share", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Personal extension" })).toBeVisible();
    await expect(page.locator("#generation-status")).toHaveText("Not generated");
    await expect(page.locator("#open-generated-canvas")).toBeDisabled();
    expect(requests.opened).toEqual([]);
    await page.locator("#open-output-folder").click();
    await expect.poll(() => requests.revealed).toEqual([{ canvasId: "first-canvas" }]);
    await expect(page.locator("#page-error")).toBeHidden();
    await page.getByRole("tab", { name: "Essentials" }).click();
    await expect(page.locator("#generate-canvas")).toBeHidden();
    await expect(page.locator("#open-generated-canvas")).toBeHidden();
    await page.getByRole("textbox", { name: /Canvas ID/ }).fill("second-canvas");
    await page.getByRole("tab", { name: "Generate" }).click();
    await expect(page.locator("#output-target")).toHaveText(".github/extensions/second-canvas/");
    await expect(page.locator("#share-project-copy")).toBeHidden();
    await page.locator("#generate-canvas").click();
    await expect.poll(() => requests.length).toBe(1);
    await expect(page.locator("#generation-status")).toContainText("Creating canvas files");
    await expect(page.locator("#open-generated-canvas")).toBeDisabled();
    requests.ready = true;
    await page.reload();
    await page.getByRole("tab", { name: "Generate" }).click();
    await expect(page.locator("#generation-status")).toContainText("Canvas files created");
    await expect(page.locator("#share-project-path")).toHaveText(".github/extensions/second-canvas/");
    await expect(page.locator("#share-project-copy")).toBeVisible();
    await expect(page.locator("#generate-canvas")).toHaveText("Regenerate canvas");
    await expect(page.locator("#generate-canvas")).toBeEnabled();
    await expect(page.locator("#open-generated-canvas")).toBeEnabled();
    await expect(page.locator("#open-status")).toHaveText(
        "Ready to open. Opening will disconnect Designer. If you want to keep using Designer in this session, reopen it after the canvas opens.");
    await page.locator("#generate-canvas").click();
    const confirm = page.getByRole("dialog", { name: "Replace generated canvas?" });
    await expect(confirm).toContainText("removes any manual edits");
    const dialogStyle = await confirm.evaluate((element) => {
        const dialog = getComputedStyle(element);
        const footer = getComputedStyle(element.querySelector("form"));
        const button = getComputedStyle(element.querySelector("button.primary"));
        const swatch = document.createElement("span");
        swatch.style.color = "var(--accent-color)";
        element.append(swatch);
        const accentColor = getComputedStyle(swatch).color;
        swatch.remove();
        return {
            font: dialog.fontFamily,
            bodyFont: getComputedStyle(document.body).fontFamily,
            width: element.getBoundingClientRect().width,
            radius: dialog.borderRadius,
            footerDisplay: footer.display,
            buttonColor: button.backgroundColor,
            accentColor,
        };
    });
    expect(dialogStyle.font).toBe(dialogStyle.bodyFont);
    expect(dialogStyle.width).toBeLessThanOrEqual(560);
    expect(dialogStyle.radius).not.toBe("0px");
    expect(dialogStyle.footerDisplay).toBe("flex");
    expect(dialogStyle.buttonColor).toBe(dialogStyle.accentColor);
    await confirm.getByRole("button", { name: "Cancel" }).click();
    expect(requests).toHaveLength(1);
    await page.locator("#generate-canvas").click();
    await confirm.getByRole("button", { name: "Replace all files" }).click();
    await expect.poll(() => requests.length).toBe(2);
    expect(requests[1].replaceExisting).toBe(true);
    await expect(page.locator("#open-generated-canvas")).toBeDisabled();
    await expect(page.locator("#share-project-copy")).toBeHidden();
    requests.readyRequestId = "replacement-generation";
    await expect(page.locator("#open-generated-canvas")).toBeEnabled({ timeout: 15000 });
    await expect(page.locator("#share-project-path")).toHaveText(".github/extensions/second-canvas/");
    await page.locator("#open-generated-canvas").click();
    await expect.poll(() => requests.opened).toEqual([{ canvasId: "second-canvas" }]);
    await expect(page.locator("#open-status")).toContainText("Opening requested. Check the child-session chat.");
    await expect(page.locator("#generate-canvas")).toBeDisabled();
    await expect(page.locator("#open-generated-canvas")).toBeDisabled();
});

test("submission is briefly disabled and a failed Generate remains recoverable", async ({ page }) => {
    const requests = await openDesigner(page, core);
    await page.getByRole("textbox", { name: /Canvas ID/ }).fill("retry-canvas");
    await page.getByRole("textbox", { name: /Title/ }).fill("Retry Canvas");
    let release;
    const waiting = new Promise((resolve) => { release = resolve; });
    await page.route("**/api/generate?*", async (route) => {
        await waiting;
        await route.fulfill({ status: 503, json: { error: "Generation service unavailable" } });
    });
    await page.getByRole("tab", { name: "Generate" }).click();
    await page.locator("#generate-canvas").click();
    await expect(page.locator("#generate-canvas")).toHaveText("Submitting...");
    await expect(page.locator("#generate-canvas")).toBeDisabled();
    release();
    await expect(page.locator("#page-error")).toContainText("Generation service unavailable");
    await expect(page.locator("#generate-canvas")).toBeEnabled();
    await expect(page.locator("#generation-status")).toHaveText("Not generated");
    expect(requests).toHaveLength(0);
    await page.unroute("**/api/generate?*");
    await page.locator("#generate-canvas").click();
    await expect.poll(() => requests.length).toBe(1);
    await expect(page.locator("#generation-status")).toContainText("Creating canvas files");
});

test("incompatible Open responses leave Designer usable and do not claim acceptance", async ({ page }) => {
    const requests = await openDesigner(page, core);
    await page.getByRole("textbox", { name: /Canvas ID/ }).fill("ready-canvas");
    requests.ready = true;
    await page.getByRole("tab", { name: "Generate" }).click();
    let release;
    const waiting = new Promise((resolve) => { release = resolve; });
    const wrongProvider = async (route) => { await waiting; return route.fulfill({ status: 202,
        json: { status: "opening", target: ".github/extensions/another-canvas/" } });
    };
    await page.route("**/api/open-generated?*", wrongProvider);
    await page.locator("#open-generated-canvas").click();
    await expect(page.locator("#open-status")).toContainText("Opening requested.");
    await expect(page.locator("#open-status")).toContainText(
        "If you want to keep using Designer in this session, reopen it after the canvas opens.");
    await expect(page.locator("#generate-canvas")).toBeDisabled();
    await expect(page.locator("#open-generated-canvas")).toBeDisabled();
    release();
    await expect(page.locator("#page-error")).toHaveText("Invalid generated canvas opening response");
    await expect(page.locator("#open-status")).toContainText("Ready to open. Opening will disconnect Designer.");
    await expect(page.locator("#generate-canvas")).toBeEnabled();
    await expect(page.locator("#open-generated-canvas")).toBeEnabled();
    await page.unroute("**/api/open-generated?*", wrongProvider);
    await page.locator("#open-generated-canvas").click();
    await expect(page.locator("#open-status")).toContainText("Opening requested. Check the child-session chat.");
    await expect(page.locator("#generate-canvas")).toBeDisabled();
    await expect(page.locator("#open-generated-canvas")).toBeDisabled();
    await expect.poll(() => requests.opened.length).toBe(1);
    expect(requests.opened).toEqual([{ canvasId: "ready-canvas" }]);
});
