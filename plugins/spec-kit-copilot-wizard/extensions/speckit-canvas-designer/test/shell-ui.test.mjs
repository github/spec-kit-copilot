import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { GENERATION_EXISTS, GENERATION_PENDING } from "../ui/generation-state.js";
import { validateCanvasId, validateOutputStatusResponse, validateGenerateResponse,
    validateOutputError } from "../ui/generated-output-state.js";

const source = await readFile(new URL("../ui/app.js", import.meta.url), "utf8");
const generationGuidance = "Opening requested. Check the child-session chat. If you want to keep using Designer in this session, reopen it after the canvas opens.";

test("overlapping output polls return their own validated snapshot without replacing newer UI state", async () => {
    const start = source.indexOf("async function refreshOutputStatus(");
    const end = source.indexOf("function updateGenerate()", start);
    let releaseFirst;
    const context = {
        outputCheck: 0, outputIdentity: "", outputStatus: "absent",
        pendingReplacement: null,
        outputRequestId: null, draft: { "canvas.id": "first-canvas" },
        token: "test", encodeURIComponent, AbortSignal,
        validateCanvasId, validateOutputStatusResponse, validateOutputError,
        updateOutputDisplay: () => {}, updateGenerate: () => {},
        fetch: async (url) => {
            const id = new URL(url, "http://localhost").searchParams.get("canvasId");
            if (id === "first-canvas") return new Promise((resolve) => { releaseFirst = resolve; });
            return { ok: true, json: async () => ({
                status: "ready", target: ".github/extensions/second-canvas/",
                requestId: "second-request",
            }) };
        },
    };
    const refresh = runInNewContext(`${source.slice(start, end)}\nrefreshOutputStatus`, context);
    const first = refresh("first-canvas");
    const second = await refresh("second-canvas");
    assert.equal(second.requestId, "second-request");
    releaseFirst({ ok: true, json: async () => ({
        status: "ready", target: ".github/extensions/first-canvas/",
        requestId: "first-request",
    }) });
    assert.equal((await first).requestId, "first-request");
    assert.equal(context.outputIdentity, "second-canvas");
    assert.equal(context.outputRequestId, "second-request");
});

test("superseded output-status failures and successes cannot change the current page error", async () => {
    const start = source.indexOf("async function refreshOutputStatus(");
    const end = source.indexOf("function updateGenerate()", start);
    const statusStart = source.indexOf("async function checkOutputStatus(");
    const statusEnd = source.indexOf("async function checkConnection(", statusStart);
    const errorBox = { textContent: "" };
    const pending = [];
    const context = {
        outputCheck: 0, outputIdentity: "", outputStatus: "absent",
        outputRequestId: null, pendingReplacement: null,
        draft: { "canvas.id": "new-canvas" }, token: "test",
        validateCanvasId, validateOutputStatusResponse, validateOutputError,
        updateOutputDisplay: () => {}, updateGenerate: () => {},
        encodeURIComponent, AbortSignal, errorBox, outputStatusError: "",
        setMessage: (slot, text) => { slot.textContent = text; },
        fetch: (url) => new Promise((resolve) => {
            pending.push({ id: new URL(url, "http://localhost").searchParams.get("canvasId"), resolve });
        }),
    };
    const { checkOutputStatus } = runInNewContext(
        `${source.slice(start, end)}\n${source.slice(statusStart, statusEnd)}\n({ checkOutputStatus })`, context);
    const oldFailure = checkOutputStatus("old-canvas");
    const current = checkOutputStatus("new-canvas");
    pending[1].resolve({ ok: true, json: async () => ({
        status: "absent", target: ".github/extensions/new-canvas/",
    }) });
    await current;
    pending[0].resolve({ ok: false, json: async () => ({ error: "Old canvas failed" }) });
    await oldFailure;
    assert.equal(errorBox.textContent, "");
    assert.equal(context.outputIdentity, "new-canvas");

    const oldSuccess = checkOutputStatus("old-canvas");
    const currentFailure = checkOutputStatus("new-canvas");
    pending[3].resolve({ ok: false, json: async () => ({ error: "New canvas failed" }) });
    await currentFailure;
    assert.equal(errorBox.textContent, "New canvas failed");
    pending[2].resolve({ ok: true, json: async () => ({
        status: "absent", target: ".github/extensions/old-canvas/",
    }) });
    await oldSuccess;
    assert.equal(errorBox.textContent, "New canvas failed");
});

test("Share offers the current folder only after its output is verified", () => {
    const start = source.indexOf("function outputPath(id)");
    const end = source.indexOf("async function refreshOutputStatus(", start);
    const elements = new Map(["output-target", "share-project-copy",
        "share-project-path", "share-target-note",
        "generation-status"].map((id) => [id, { textContent: "" }]));
    const context = {
        document: { getElementById: (id) => elements.get(id) },
        draft: { "canvas.id": "new-id" }, requestedCanvasId: "old-id",
        requestedRequestId: null, outputRequestId: null, outputIdentity: "",
        outputStatus: "absent", pendingReplacement: null,
    };
    const update = runInNewContext(`${source.slice(start, end)}
updateOutputDisplay`, context);
    update();
    assert.equal(elements.get("output-target").textContent, ".github/extensions/new-id/");
    assert.equal(elements.get("share-project-copy").hidden, true);
    assert.equal(elements.get("share-project-path").textContent, "");
    assert.match(elements.get("share-target-note").textContent, /verify the current Canvas ID/);
    context.outputIdentity = "new-id";
    context.outputStatus = "ready";
    update();
    assert.equal(elements.get("share-project-copy").hidden, false);
    assert.equal(elements.get("share-project-path").textContent, ".github/extensions/new-id/");
    assert.equal(elements.get("share-target-note").textContent, "");
    context.pendingReplacement = { canvasId: "new-id", requestId: "new-request" };
    update();
    assert.equal(elements.get("share-project-copy").hidden, true);
    assert.equal(elements.get("share-project-path").textContent, "");
    assert.match(elements.get("share-target-note").textContent, /Wait for regeneration/);
});

test("a successful earlier Generate retry stays openable, but replacement waits for its own output", async () => {
    const start = source.indexOf("function outputPath(id)");
    const end = source.indexOf("function confirmReplacement(", start);
    const elements = new Map(["output-target", "share-project-copy",
        "share-project-path", "share-target-note", "generation-status"]
        .map((id) => [id, { textContent: "" }]));
    const generate = { disabled: false };
    const openGenerated = { disabled: true };
    let publishedRequestId = "request-a";
    const context = {
        document: { getElementById: (id) => elements.get(id) },
        draft: { "canvas.id": "first-canvas" }, draftOutputs: {},
        model: { handoffId: "handoff-1", generationAvailable: true,
            pages: [{ page: "designer-essentials", fields: [
                { id: "canvas.id" }, { id: "canvas.displayName" },
            ] }] },
        requestedCanvasId: "first-canvas", requestedRequestId: "request-b",
        pendingReplacement: null, requestedAt: Date.now(),
        outputIdentity: "", outputStatus: "absent", outputRequestId: null, outputCheck: 0,
        generate, openGenerated, generationNote: { textContent: "" },
        generationError: { textContent: "" }, token: "test",
        saving: false, generating: false, opening: false, openingRequested: false,
        activeUploads: new Set(), connectionError: "", GENERATION_PENDING,
        required: ["canvas.id", "canvas.displayName"], outputPathsReady: () => true,
        updateOpenStatus: () => {}, setMessage: (slot, message) => { slot.textContent = message; },
        validateCanvasId, validateOutputStatusResponse, validateOutputError,
        fetch: async () => ({ ok: true, json: async () => ({
            status: "ready", target: ".github/extensions/first-canvas/",
            requestId: publishedRequestId,
        }) }), AbortSignal, encodeURIComponent,
    };
    const { refreshOutputStatus, updateGenerate } = runInNewContext(
        `${source.slice(start, end)}\n({ refreshOutputStatus, updateGenerate })`, context);
    await refreshOutputStatus("first-canvas");
    assert.equal(openGenerated.disabled, false);
    assert.equal(generate.textContent, "Regenerate canvas");
    assert.equal(elements.get("generation-status").textContent, "Canvas files created.");
    assert.equal(elements.get("share-project-path").textContent, ".github/extensions/first-canvas/");

    context.pendingReplacement = { canvasId: "first-canvas", requestId: "request-c" };
    updateGenerate();
    assert.equal(openGenerated.disabled, true);
    assert.equal(elements.get("share-project-copy").hidden, true);
    await refreshOutputStatus("first-canvas");
    assert.equal(openGenerated.disabled, true);
    assert.deepEqual({ ...context.pendingReplacement },
        { canvasId: "first-canvas", requestId: "request-c" });

    publishedRequestId = "request-c";
    await refreshOutputStatus("first-canvas");
    assert.equal(context.pendingReplacement, null);
    assert.equal(openGenerated.disabled, false);
    assert.equal(elements.get("share-project-copy").hidden, false);

    context.pendingReplacement = { canvasId: "first-canvas", requestId: "failed-request" };
    publishedRequestId = "request-c";
    await refreshOutputStatus("first-canvas");
    assert.equal(openGenerated.disabled, true);
    const reopened = { ...context, pendingReplacement: null, outputCheck: 0,
        outputIdentity: "", outputStatus: "absent", outputRequestId: null };
    const recovered = runInNewContext(
        `${source.slice(start, end)}\nrefreshOutputStatus`, reopened);
    await recovered("first-canvas");
    assert.equal(openGenerated.disabled, false);
});

test("Designer shows only one message bar across repeated errors and generation guidance", () => {
    const names = ["page-error", "generation-note", "generation-error",
        "composition-error", "action-message"];
    const slots = Object.fromEntries(names.map((name) =>
        [name, { textContent: "", hidden: true }]));
    const start = source.indexOf("const messageSlots = ");
    const end = source.indexOf("let model,", start);
    const setMessage = runInNewContext(`${source.slice(start, end)}\nsetMessage`, {
        errorBox: slots["page-error"],
        generationNote: slots["generation-note"],
        generationError: slots["generation-error"],
        compositionError: slots["composition-error"],
        messageBox: slots["action-message"],
    });
    const visible = () => names.filter((name) => !slots[name].hidden);
    setMessage(slots["generation-note"], GENERATION_EXISTS);
    setMessage(slots["page-error"], GENERATION_EXISTS);
    assert.deepEqual(visible(), ["page-error"]);
    setMessage(slots["page-error"], "");
    assert.deepEqual(visible(), ["generation-note"]);
    setMessage(slots["generation-note"], generationGuidance);
    setMessage(slots["action-message"], "Settings saved.");
    assert.deepEqual(visible(), ["generation-note"]);
    setMessage(slots["action-message"], "Warning: Check the generated page.");
    assert.deepEqual(visible(), ["generation-note"]);
    setMessage(slots["action-message"], "");
    setMessage(slots["generation-note"], "");
    setMessage(slots["generation-error"], "Cannot generate.");
    setMessage(slots["composition-error"], "Cannot generate.");
    assert.deepEqual(visible(), ["generation-error"]);
    setMessage(slots["generation-error"], "");
    assert.deepEqual(visible(), ["composition-error"]);
});

test("Designer fixed-shell theme toggle follows preference, persists choice and remains accessible", async () => {
    const html = await readFile(new URL("../ui/index.html", import.meta.url), "utf8");
    const css = await readFile(new URL("../ui/styles.css", import.meta.url), "utf8");
    assert.match(html, /id="theme-toggle"[^>]*aria-label="Toggle theme"/);
    assert.match(css, /\[data-theme="dark"\]\s*\{/);
    const start = source.indexOf('const themeKey = "speckit-designer.theme";');
    const end = source.indexOf("function outputPathsReady()", start);
    assert.ok(start >= 0 && end > start);

    let theme = null;
    let click;
    const attributes = new Map();
    const button = {
        addEventListener: (_name, handler) => { click = handler; },
        setAttribute: (name, value) => attributes.set(name, value),
        getAttribute: (name) => attributes.get(name),
    };
    const document = {
        documentElement: {
            getAttribute: () => theme,
            setAttribute: (_name, value) => { theme = value; },
        },
        getElementById: () => button,
    };
    let saved = null;
    let prefersDark = true;
    let onColorChange;
    const preference = { get matches() { return prefersDark; },
        addEventListener: (_name, handler) => { onColorChange = handler; } };
    const localStorage = {
        getItem: () => saved,
        setItem: (_key, value) => { saved = value; },
    };
    const run = () => runInNewContext(source.slice(start, end), {
        document, window: { matchMedia: () => preference }, localStorage,
    });
    run();
    assert.equal(theme, "dark");
    assert.equal(attributes.get("aria-label"), "Switch to light theme");
    prefersDark = false;
    onColorChange({ matches: false });
    assert.equal(theme, "light");
    click();
    assert.equal(theme, "dark");
    assert.equal(saved, "dark");
    assert.equal(button.title, "Switch to light theme");
    onColorChange({ matches: true });
    onColorChange({ matches: false });
    assert.equal(theme, "dark");
    theme = null;
    run();
    assert.equal(theme, "dark");
});

test("dark badge text and accent buttons meet small-text contrast", async () => {
    const css = await readFile(new URL("../ui/styles.css", import.meta.url), "utf8");
    assert.match(css, /\.badge-preview\s*\{[^}]*border:\s*1px solid currentColor;/);
    assert.match(css, /\.badge-preview\.badge-preview-empty\s*\{[^}]*border-style:\s*dashed;/);
    assert.match(css, /\.badge-color-preview-row\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*flex-end;/);
    const dark = css.match(/\[data-theme="dark"\]\s*\{([^}]+)\}/)?.[1];
    assert.ok(dark);
    const systemDark = css.match(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme\]\)\s*\{([^}]+)\}/)?.[1];
    assert.ok(systemDark);
    const value = (name) => dark.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`))?.[1];
    const luminance = (hex) => {
        const channels = hex.slice(1).match(/../g).map((part) => {
            const channel = Number.parseInt(part, 16) / 255;
            return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
        });
        return channels.reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
    };
    const contrast = (foreground, background) => {
        const [lighter, darker] = [luminance(foreground), luminance(background)]
            .sort((a, b) => b - a);
        return (lighter + .05) / (darker + .05);
    };
    for (const color of ["purple", "pink", "orange"]) {
        assert.ok(contrast(value(`badge-${color}`), value("background-color-secondary")) >= 4.5, color);
        assert.match(css, new RegExp(`\\.badge-preview\\[data-color="${color}"\\] \\{ color: var\\(--badge-${color}\\)`));
        assert.match(systemDark, new RegExp(`--badge-${color}:\\s*${value(`badge-${color}`)}`, "i"));
    }
    assert.ok(contrast(value("accent-contrast"), value("accent-color")) >= 4.5);
    assert.match(css, /\.badge-toolbar > \.badge-add[^}]+color: var\(--accent-contrast\)/);
    assert.match(css, /\.badge-editor \.badge-actions button:first-child[^}]+color: var\(--accent-contrast\)/);
});

test("Generate saves a snapshot and dispatches with the returned revision", async () => {
    const start = source.indexOf('generate.addEventListener("click"');
    const end = source.indexOf('openGenerated.addEventListener("click"', start);
    assert.ok(start >= 0 && end > start);
    const draft = { "canvas.id": "first-canvas" };
    let click, release, submitted;
    const calls = [];
    const context = {
        generate: { disabled: false, addEventListener: (_name, handler) => { click = handler; } },
        model: { preview: false, templates: [], revision: "model-1", settingsRevision: 0 },
        draft, draftOutputs: {}, draftBadges: [{ id: "legacy", phaseText: "old" }], requestedCanvasId: null, token: "test",
        outputStatus: "absent", requestedRequestId: null,
        GENERATION_EXISTS,
        generating: false, status: {}, messageBox: {}, checkReady: () => true,
        validateGenerateResponse, validateOutputError,
        showError: () => {}, updateSave: () => {},
        checkConnection: async (force) => { calls.push(["availability", force]); },
        refreshOutputStatus: async () => ({ status: "absent", requestId: null }),
        updateOutputDisplay: () => {},
        setMessage: (slot, text) => { slot.textContent = text; slot.hidden = !text; },
        showFieldError: (message) => { throw new Error(message); },
        persistSettings: async (input) => {
            calls.push(["save", input.values["canvas.id"]]);
            return { revision: "model-1", settingsRevision: 1, badges: [{ id: "legacy" }] };
        },
        fetch: (_url, options) => {
            const body = JSON.parse(options.body);
            submitted = body.values["canvas.id"];
            assert.equal(body.settingsRevision, 1);
            assert.deepEqual(body.badges, [{ id: "legacy" }]);
            calls.push(["generate", submitted]);
            return new Promise((resolve) => { release = resolve; });
        },
        structuredClone, encodeURIComponent,
    };
    runInNewContext(source.slice(start, end), context);
    const request = click();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(submitted, "first-canvas");
    draft["canvas.id"] = "second-canvas";
    release({ ok: true, json: async () => ({
        target: ".github/extensions/first-canvas/", requestId: "request-1",
    }) });
    await request;
    assert.deepEqual(calls, [["save", "first-canvas"], ["generate", "first-canvas"],
        ["availability", true]]);
    assert.equal(context.requestedCanvasId, "first-canvas");
    assert.equal(context.requestedRequestId, "request-1");
});

test("Generate does not dispatch or disable future attempts when the implicit save fails", async () => {
    const start = source.indexOf('generate.addEventListener("click"');
    const end = source.indexOf('openGenerated.addEventListener("click"', start);
    let click, reported = "";
    const context = {
        generate: { disabled: false, addEventListener: (_name, handler) => { click = handler; } },
        model: { preview: false, templates: [], revision: "model-1", settingsRevision: 0 },
        draft: { "canvas.id": "first-canvas" }, draftOutputs: {}, draftBadges: [],
        GENERATION_EXISTS,
        requestedCanvasId: null, token: "test", generating: false, messageBox: {},
        outputStatus: "absent", requestedRequestId: null,
        checkReady: () => true, showError: () => {}, updateSave: () => {},
        checkConnection: async () => {},
        setMessage: (slot, text) => { slot.textContent = text; slot.hidden = !text; },
        refreshOutputStatus: async () => ({ status: "absent", requestId: null }),
        updateOutputDisplay: () => {},
        showFieldError: (message) => { reported = message; },
        persistSettings: async () => { throw new Error("stale settings revision"); },
        fetch: () => { throw new Error("Generate must not be dispatched"); },
        structuredClone, encodeURIComponent,
    };
    runInNewContext(source.slice(start, end), context);
    await click();
    assert.match(reported, /Could not save settings: stale settings revision/);
    assert.equal(context.requestedCanvasId, null);
    assert.equal(context.generating, false);
});

test("replacement uses the confirmed output identity even when status changes during confirmation", async () => {
    const start = source.indexOf('generate.addEventListener("click"');
    const end = source.indexOf('openGenerated.addEventListener("click"', start);
    let click, submitted;
    const context = {
        generate: { disabled: false, addEventListener: (_name, handler) => { click = handler; } },
        model: { preview: false, templates: [], revision: "model-1", settingsRevision: 0 },
        draft: { "canvas.id": "first-canvas" }, draftOutputs: {}, draftBadges: [],
        requestedCanvasId: null, requestedRequestId: null, requestedAt: 0,
        outputStatus: "ready", outputRequestId: "original-request",
        generating: false, messageBox: {}, token: "test",
        checkReady: () => true, updateSave: () => {}, showError: () => {},
        checkConnection: async () => {},
        refreshOutputStatus: async () => ({ status: "ready", requestId: "original-request" }),
        confirmReplacement: async () => { context.outputRequestId = "newer-request"; return true; },
        persistSettings: async () => ({ revision: "model-1", settingsRevision: 1 }),
        fetch: async (_url, options) => {
            submitted = JSON.parse(options.body);
            return { ok: false, status: 409,
                json: async () => ({ error: "Canvas changed since replacement was confirmed" }) };
        },
        showFieldError: () => {}, setMessage: () => {}, updateOutputDisplay: () => {},
        validateOutputError,
        structuredClone, encodeURIComponent,
    };
    runInNewContext(source.slice(start, end), context);
    await click();
    assert.equal(submitted.replaceExisting, true);
    assert.equal(submitted.replaceRequestId, "original-request");
});

test("Generate reports valid errors and rejects incompatible error responses", async () => {
    const start = source.indexOf('generate.addEventListener("click"');
    const end = source.indexOf('openGenerated.addEventListener("click"', start);
    for (const [body, expected] of [
        [{ error: "Generation unavailable" }, "Generation unavailable"],
        [{ error: "", extra: true }, "Invalid generated canvas error response"],
    ]) {
        let click, reported;
        runInNewContext(source.slice(start, end), {
            generate: { disabled: false, addEventListener: (_name, handler) => { click = handler; } },
            model: { preview: false, templates: [] },
            draft: { "canvas.id": "first-canvas" }, draftOutputs: {}, draftBadges: [],
            generating: false, messageBox: {}, requestedCanvasId: null,
            checkReady: () => true, updateSave: () => {}, setMessage: () => {},
            checkConnection: async () => {},
            showError: () => {}, refreshOutputStatus: async () => ({ status: "absent" }),
            persistSettings: async () => ({ revision: "model-1", settingsRevision: 1 }),
            fetch: async () => ({ ok: false, status: 422, json: async () => body }),
            showFieldError: (message) => { reported = message; },
            validateOutputError, structuredClone, encodeURIComponent, token: "test",
        });
        await click();
        assert.equal(reported, expected);
    }
});

test("Designer health check reports failed and restored connections without replacing drafts", async () => {
    const start = source.indexOf('const status = document.getElementById("conn-status");');
    const end = source.lastIndexOf("try {", source.indexOf("    [{ mountIdentity", start));
    assert.ok(start >= 0 && end > start);
    const status = {};
    const errorBox = { textContent: "" };
    const generationNote = { textContent: "", hidden: true };
    const draft = { "canvas.displayName": "Unsaved title" };
    let response = { ok: true, json: async () => ({ generationAvailable: true, generationError: null }) };
    const requests = [];
    let polls;
    let reloaded = false;
    const { checkConnection: check, setOpening } = runInNewContext(`${source.slice(start, end)}
({ checkConnection, setOpening: () => { openingRequested = true; } })`, {
        document: { getElementById: (id) =>
            id === "generation-note" ? generationNote : status },
        errorBox,
        generationNote,
        token: "test",
        model: {},
        draft,
        requestedCanvasId: null, openingRequested: false, currentPage: "designer-essentials",
        generationGuidance,
        generating: false,
        fetch: async (url) => { requests.push(url); return response; },
        refreshOutputStatus: async () => {},
        updateGenerate: () => {},
        AbortSignal,
        encodeURIComponent,
        showError: (message) => { errorBox.textContent = message; },
        setMessage: (slot, text) => { slot.textContent = text; slot.hidden = !text; },
        setInterval: (handler) => { polls = handler; return 1; },
        clearInterval: () => {},
        window: { addEventListener: () => {} },
        location: { reload: () => { reloaded = true; } },
    });
    assert.equal(status.textContent, undefined);
    await check();
    assert.equal(status.textContent, "Live");
    assert.match(requests.at(-1), /^\/ui\/styles\.css\?/);
    response = { ok: false, status: 503 };
    polls();
    await check();
    assert.equal(status.textContent, "Disconnected");
    assert.equal(errorBox.textContent, "");
    assert.match(generationNote.textContent, /connection interrupted.*503.*Unsaved edits remain/);
    assert.match(generationNote.textContent, /restart Designer \(close this panel and open Designer again\)/);
    assert.equal(draft["canvas.displayName"], "Unsaved title");
    errorBox.textContent = "Unrelated field error";
    response = { ok: true, json: async () => ({ generationAvailable: true, generationError: null }) };
    await check();
    assert.equal(status.textContent, "Live");
    assert.equal(generationNote.textContent, "");
    assert.equal(generationNote.hidden, true);
    assert.equal(errorBox.textContent, "Unrelated field error");
    assert.equal(reloaded, false);
    setOpening();
    response = { ok: false, status: 503 };
    await check();
    assert.equal(status.textContent, "Disconnected");
    assert.equal(errorBox.textContent, "Unrelated field error");
    assert.equal(generationNote.textContent, "");
    response = { ok: true, json: async () => ({
        generationAvailable: false, generationError: GENERATION_PENDING,
    }) };
    await check();
    assert.equal(status.textContent, "Live");
    assert.equal(generationNote.textContent, "");
});

test("output status failures keep the Designer live and clear only their own error on recovery", async () => {
    const start = source.indexOf('const status = document.getElementById("conn-status");');
    const end = source.lastIndexOf("try {", source.indexOf("    [{ mountIdentity", start));
    const status = {};
    const errorBox = { textContent: "" };
    const generationNote = { textContent: "" };
    let failure = new Error("Output status unavailable");
    const context = {
        document: { getElementById: () => status }, errorBox, generationNote,
        token: "test", model: {}, draft: { "canvas.id": "first-canvas" },
        requestedCanvasId: "first-canvas", openingRequested: false, currentPage: "designer-generate",
        outputCheck: 0,
        fetch: async () => ({ ok: true }), refreshOutputStatus: async () => {
            context.outputCheck++;
            if (failure) throw failure;
        },
        updateGenerate: () => {}, setMessage: (slot, text) => { slot.textContent = text; },
        setInterval: () => 1, clearInterval: () => {}, window: { addEventListener: () => {} },
        AbortSignal, encodeURIComponent,
    };
    const { checkConnection: check } = runInNewContext(`${source.slice(start, end)}
({ checkConnection })`, context);
    await check();
    assert.equal(status.textContent, "Live");
    assert.equal(errorBox.textContent, "Output status unavailable");
    assert.equal(generationNote.textContent, "");
    failure = null;
    await check();
    assert.equal(errorBox.textContent, "");
    failure = new Error("Output status unavailable");
    errorBox.textContent = "Unrelated field error";
    await check();
    assert.equal(errorBox.textContent, "Unrelated field error");
    failure = null;
    await check();
    assert.equal(status.textContent, "Live");
    assert.equal(errorBox.textContent, "Unrelated field error");
});

test("health checks use a small authenticated asset, but periodically refresh generation availability", async () => {
    const start = source.indexOf('const status = document.getElementById("conn-status");');
    const end = source.lastIndexOf("try {", source.indexOf("    [{ mountIdentity", start));
    const status = {};
    const note = { textContent: "" };
    const errorBox = { textContent: "" };
    const requests = [];
    let updates = 0;
    const model = { generationAvailable: false, generationError: GENERATION_PENDING };
    const { checkConnection } = runInNewContext(`${source.slice(start, end)}
({ checkConnection })`, {
        document: { getElementById: () => status },
        errorBox, generationNote: note, token: "test", model,
        requestedCanvasId: null, openingRequested: false, currentPage: "designer-essentials",
        generating: false, generationGuidance,
        fetch: async (url) => {
            requests.push(url);
            return url.startsWith("/api/state")
                ? { ok: true, json: async () => ({
                    generationAvailable: false, generationError: GENERATION_EXISTS,
                }) }
                : { ok: true, json: () => { throw new Error("Asset is not JSON"); } };
        },
        updateGenerate: () => { updates++; }, refreshOutputStatus: async () => {},
        AbortSignal, encodeURIComponent,
        showError: () => {}, setMessage: () => {},
        setInterval: () => 1, clearInterval: () => {},
        window: { addEventListener: () => {} },
    });
    for (let i = 0; i < 6; i++) await checkConnection();
    assert.equal(requests.filter((url) => url.startsWith("/api/state")).length, 1);
    assert.equal(requests.filter((url) => url.startsWith("/ui/styles.css")).length, 5);
    assert.equal(model.generationError, GENERATION_EXISTS);
    assert.equal(updates, 1);
    assert.equal(status.textContent, "Live");
});

test("submission refresh supersedes an older pending availability poll", async () => {
    const start = source.indexOf('const status = document.getElementById("conn-status");');
    const end = source.lastIndexOf("try {", source.indexOf("    [{ mountIdentity", start));
    const model = { generationAvailable: true, generationError: null };
    const status = {};
    let releasePending;
    let requests = 0;
    const { checkConnection } = runInNewContext(`${source.slice(start, end)}
({ checkConnection })`, {
        document: { getElementById: () => status },
        errorBox: {}, generationNote: { textContent: "" }, token: "test", model,
        requestedCanvasId: null, openingRequested: false, currentPage: "designer-essentials",
        fetch: async (url) => {
            if (url.startsWith("/ui/")) return { ok: true };
            requests++;
            if (requests === 1) return new Promise((resolve) => { releasePending = resolve; });
            return { ok: true, json: async () => ({
                generationAvailable: true, generationError: null,
            }) };
        },
        updateGenerate: () => {}, refreshOutputStatus: async () => {},
        setMessage: () => {}, setInterval: () => 1, clearInterval: () => {},
        window: { addEventListener: () => {} }, AbortSignal, encodeURIComponent,
    });
    const stale = checkConnection(true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(requests, 1);
    await checkConnection(true);
    releasePending({ ok: true, json: async () => ({
        generationAvailable: false, generationError: GENERATION_PENDING,
    }) });
    await stale;
    assert.equal(model.generationAvailable, true);
    assert.equal(model.generationError, null);
    assert.equal(status.textContent, "Live");
});

test("stale health-check results cannot overwrite the latest connection state", async () => {
    const start = source.indexOf('const status = document.getElementById("conn-status");');
    const end = source.lastIndexOf("try {", source.indexOf("    [{ mountIdentity", start));
    const status = {};
    const generationNote = { textContent: "", hidden: true };
    let release;
    let nextResponse = { ok: true };
    const { checkConnection } = runInNewContext(`${source.slice(start, end)}
({ checkConnection })`, {
        document: { getElementById: () => status },
        errorBox: {}, generationNote, token: "test", model: {},
        requestedCanvasId: null, openingRequested: false, currentPage: "designer-essentials",
        fetch: () => nextResponse === null
            ? new Promise((resolve) => { release = resolve; }) : Promise.resolve(nextResponse),
        refreshOutputStatus: async () => {}, updateGenerate: () => {},
        setMessage: (slot, text) => { slot.textContent = text; slot.hidden = !text; },
        setInterval: () => 1, clearInterval: () => {},
        window: { addEventListener: () => {} }, AbortSignal, encodeURIComponent,
    });
    nextResponse = null;
    const olderFailure = checkConnection();
    nextResponse = { ok: true };
    await checkConnection();
    release({ ok: false, status: 503 });
    await olderFailure;
    assert.equal(status.textContent, "Live");
    assert.equal(generationNote.textContent, "");
    nextResponse = null;
    const olderSuccess = checkConnection();
    nextResponse = { ok: false, status: 503 };
    await checkConnection();
    release({ ok: true });
    await olderSuccess;
    assert.equal(status.textContent, "Disconnected");
    assert.match(generationNote.textContent, /connection interrupted/);
});

test("Generate locks editing only during submission, not for an agent turn", () => {
    const start = source.indexOf("function updateSave()");
    const end = source.indexOf("async function persistSettings(", start);
    const evaluate = (generating) => {
        const saveButton = {
            disabled: false, setAttribute: () => {}, removeAttribute: () => {},
        };
        const root = { inert: false };
        const tabs = { children: [{ disabled: false }] };
        const help = { title: "" };
        const update = runInNewContext(`${source.slice(start, end)}\nupdateSave`, {
            model: { preview: false, persisted: true, values: { "canvas.id": "first" },
                outputs: {}, badges: [], pages: [{}] },
            draft: { "canvas.id": "second" }, draftOutputs: {}, draftBadges: [],
            saveButton, root, tabs, saving: false, generating,
            activeUploads: new Set(), outputPathsReady: () => true,
            updateGenerate: () => {},
            document: { getElementById: () => help },
        });
        update();
        return { saveButton, root, tabs };
    };
    const submitting = evaluate(true);
    assert.equal(submitting.saveButton.disabled, true);
    assert.equal(submitting.root.inert, true);
    assert.equal(submitting.tabs.children[0].disabled, true);
    const submitted = evaluate(false);
    assert.equal(submitted.saveButton.disabled, false);
    assert.equal(submitted.root.inert, false);
    assert.equal(submitted.tabs.children[0].disabled, false);
});

test("Generate stays reachable after files are created and shows Regenerate", () => {
    const start = source.indexOf("function updateGenerate()");
    const end = source.indexOf("function confirmReplacement(", start);
    assert.ok(start >= 0 && end > start);
    const generate = { disabled: false };
    const openGenerated = { disabled: false };
    const generationError = { textContent: "", hidden: true };
    const generationNote = { textContent: "", hidden: true };
    const model = {
        pages: [{ page: "designer-essentials", fields: [
            { id: "canvas.id" }, { id: "canvas.displayName" },
        ] }],
        values: { "canvas.id": "first-canvas" },
        handoffId: "handoff-1",
        generationAvailable: true,
        generationError: null,
        generationBlockers: [],
    };
    const draft = { "canvas.id": "first-canvas" };
    const context = {
        model, draft, draftOutputs: {}, generate, openGenerated, generationNote, generationError,
        saving: false, generating: false, opening: false, openingRequested: false, connectionError: "",
        requestedCanvasId: "first-canvas", requestedRequestId: "request-1",
        pendingReplacement: null,
        outputIdentity: "first-canvas", outputStatus: "ready", outputRequestId: "request-1",
        activeUploads: new Set(), GENERATION_PENDING,
        outputPathsReady: () => true, updateOutputDisplay: () => {}, updateOpenStatus: () => {},
        setMessage: (slot, text) => {
            slot.textContent = text;
            const selected = generationNote.textContent ? generationNote
                : generationError.textContent ? generationError : null;
            for (const item of [generationNote, generationError]) item.hidden = item !== selected;
        },
        required: ["canvas.id", "canvas.displayName"],
    };
    const update = runInNewContext(`${source.slice(start, end)}\nupdateGenerate`, context);
    context.generating = true;
    update();
    assert.equal(generate.disabled, true);
    assert.equal(generate.textContent, "Submitting...");
    context.generating = false;
    update();
    assert.equal(generate.disabled, false);
    assert.equal(generate.textContent, "Regenerate canvas");
    assert.equal(openGenerated.disabled, false);
    assert.equal(generationError.hidden, true);
    context.requestedRequestId = "new-request";
    update();
    assert.equal(openGenerated.disabled, false);
    assert.equal(generate.textContent, "Regenerate canvas");
    context.pendingReplacement = { canvasId: "first-canvas", requestId: "new-request" };
    update();
    assert.equal(openGenerated.disabled, true);
    context.pendingReplacement = null;
    context.requestedCanvasId = "other-canvas";
    update();
    assert.equal(openGenerated.disabled, false);
    context.requestedCanvasId = "first-canvas";
    context.requestedRequestId = "request-1";
    draft["canvas.id"] = "second-canvas";
    update();
    assert.equal(generate.disabled, false);
    assert.equal(openGenerated.disabled, true);
    assert.equal(generate.textContent, "Generate canvas");
    draft["canvas.id"] = "first-canvas";
    context.openingRequested = true;
    update();
    assert.equal(generate.disabled, true);
    assert.equal(openGenerated.disabled, true);
    context.openingRequested = false;
    model.generationAvailable = false;
    model.generationError = "Canvas Design does not provide Generate in this session.";
    update();
    assert.equal(generate.disabled, true);
    assert.equal(generationError.textContent, model.generationError);
});

test("a missing Generate capability cannot be bypassed by changing an existing Canvas ID", () => {
    const start = source.indexOf("function updateGenerate()");
    const end = source.indexOf("function confirmReplacement(", start);
    const unavailable = "Canvas Design does not provide Generate in this session.";
    const model = {
        pages: [{ page: "designer-essentials", fields: [
            { id: "canvas.id" }, { id: "canvas.displayName" },
        ] }],
        values: { "canvas.id": "existing" }, handoffId: "handoff-1",
        generationAvailable: false, generationError: unavailable,
        generationBlockers: [],
    };
    const draft = { "canvas.id": "existing" };
    const generate = { disabled: false };
    const openGenerated = { disabled: false };
    const generationError = { textContent: "" };
    const generationNote = { textContent: "" };
    const context = {
        model, draft, draftOutputs: {}, generate, openGenerated, generationNote, generationError,
        saving: false, generating: false, opening: false, openingRequested: false,
        connectionError: "", requestedCanvasId: null, pendingReplacement: null,
        outputIdentity: "", outputStatus: "absent", requestedRequestId: null,
        outputRequestId: null, activeUploads: new Set(), GENERATION_PENDING,
        outputPathsReady: () => true, updateOutputDisplay: () => {}, updateOpenStatus: () => {},
        setMessage: (slot, text) => { slot.textContent = text; },
        required: ["canvas.id", "canvas.displayName"],
    };
    const update = runInNewContext(`${source.slice(start, end)}
updateGenerate`, context);
    update();
    assert.equal(generate.disabled, true);
    assert.equal(generationError.textContent, unavailable);
    context.connectionError = "Designer connection interrupted";
    generationNote.textContent = context.connectionError;
    update();
    assert.equal(generationNote.textContent, context.connectionError);
    draft["canvas.id"] = "unique";
    update();
    assert.equal(generate.disabled, true);
    assert.equal(generationError.textContent, unavailable);
});
