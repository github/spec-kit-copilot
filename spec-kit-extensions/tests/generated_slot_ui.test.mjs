import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { UserError } from "../extension-canvas-design/generated-scaffold/files.mjs";
import { errorPayload } from "../extension-canvas-design/generated-scaffold/server.mjs";
import * as controlBoundary from "../extension-canvas-design/generated-scaffold/contracts/external-generated-controls.mjs";

const source = await readFile(new URL("../extension-canvas-design/generated-scaffold/ui/app.js",
    import.meta.url), "utf8").then((text) => text.replaceAll("\r\n", "\n"));
const serverSource = await readFile(new URL("../extension-canvas-design/generated-scaffold/server.mjs",
    import.meta.url), "utf8");
const runtimeSource = await readFile(new URL("../extension-canvas-design/generated-scaffold/runtime.mjs",
    import.meta.url), "utf8");
const themeSource = await readFile(new URL("../extension-canvas-design/generated-scaffold/ui/workflow-theme.css",
    import.meta.url), "utf8");
const runtimeCss = await readFile(new URL("../extension-canvas-design/generated-scaffold/ui/runtime.css",
    import.meta.url), "utf8");

test("generated host supplies badge slots to the initial phase adapter mount", () => {
    const initial = section("const initialState = {", "if (workflowRoot.dataset.pageModule)");
    assert.match(initial, /badgeSlots:\s*phaseBadgeSlots/);
    assert.match(initial, /badgeModels:\s*\[\]/);
});

test("workflow actions share a fixed-width column and failures render inline without a popup", () => {
    assert.match(themeSource, /\.instance-delete\s*\{[^}]*flex:\s*0 0 7rem/s);
    assert.doesNotMatch(serverSource, /id="canvas-message"/);
    assert.doesNotMatch(serverSource, /id="canvas-message-dismiss"/);
    assert.match(serverSource, /id="workflow-action-error"[^>]*role="alert"/);
    assert.match(serverSource, /id="generated-page-error"[^>]*role="alert"/);
    assert.match(serverSource, /id="canvas-fatal-error"[^>]*role="alert"/);
    const notice = { hidden: true, textContent: "", attributes: {}, classList: { toggle() {} },
        setAttribute(name, value) { this.attributes[name] = value; } };
    const message = runInNewContext(`${section("function message(", "function displayValue(")}
        message`, {
        $: (id) => ({ "workflow-action-error": notice })[id],
        mountedPage: "workflow",
    });
    message("Saved");
    assert.equal(notice.hidden, true);
    message("An error", "canvas-message", true);
    assert.equal(notice.hidden, false);
    assert.equal(notice.attributes.role, "alert");
    assert.equal(notice.textContent, "An error");
    message("", "workflow-action-error");
    assert.equal(notice.hidden, true);
    assert.doesNotMatch(source, /canvas-message-dismiss|messageTimer/);
});

function section(start, end) {
    const first = source.indexOf(start), last = source.indexOf(end, first + start.length);
    assert.ok(first >= 0 && last > first, `Missing UI section ${start}`);
    return source.slice(first, last);
}

test("a timed-out Run clears the in-flight guard without automatically resubmitting", async () => {
    let attempts = 0;
    const messages = [];
    const actions = runInNewContext(`let sending = false;
        ${section("async function api(", "async function retryRevision(")}
        ${section("async function send(", "async function refreshArtifact(")}
        ({ send, pending: () => Boolean(sending) })`, {
        token: "test", model: { constitutionReady: true, userProvidesSlug: false,
            selected: "specs/demo", statuses: {} },
        selectedPending: () => false, renderStatus() {}, flush: async () => {},
        refresh: async () => {}, message: (text) => messages.push(text),
        AbortSignal: { timeout() {
            const controller = new AbortController();
            setTimeout(() => controller.abort(), 5);
            return controller.signal;
        } },
        fetch: (_path, options) => {
            if (++attempts === 2) return Promise.resolve({ ok: true, json: async () => ({}) });
            return new Promise((_, reject) => options.signal.addEventListener("abort",
                () => reject(new Error("aborted")), { once: true }));
        },
    });
    await actions.send({ id: "specify", project: false }, "");
    assert.equal(actions.pending(), false);
    assert.match(messages.at(-1), /timed out.*check chat before trying again/i);
    assert.equal(attempts, 1);
    await actions.send({ id: "specify", project: false }, "");
    assert.equal(attempts, 2);
    assert.equal(actions.pending(), false);
});

test("named badge colors meet small-text contrast in light, dark and automatic dark themes", () => {
    assert.match(runtimeCss, /\.canvas-badge\s*\{[^}]*border:\s*1px solid currentColor;/);
    const theme = (selector) => {
        const start = themeSource.indexOf(selector);
        assert.ok(start >= 0);
        const block = themeSource.slice(start, themeSource.indexOf("}", start));
        return (name) => {
            const value = block.match(new RegExp(`--${name}: (#[0-9a-f]{6});`));
            assert.ok(value, `${name} is defined in ${selector}`);
            return value[1];
        };
    };
    const luminance = (hex) => [0, 2, 4].map((offset) =>
        parseInt(hex.slice(offset + 1, offset + 3), 16) / 255)
        .map((channel) => channel <= 0.04045 ? channel / 12.92
            : ((channel + 0.055) / 1.055) ** 2.4)
        .reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index], 0);
    const badge = /\.canvas-badge\[data-color="([^"]+)"\]\s*\{\s*color:\s*color-mix\(in srgb, var\(--text-color-default\) (\d+)%, (var\(--([a-z-]+)\)|#[0-9a-f]{6})\);/g;
    const matches = [...runtimeCss.matchAll(badge)];
    assert.deepEqual(matches.map((match) => match[1]),
        ["green", "amber", "red", "blue", "purple", "pink", "orange"]);
    for (const selector of [":root {", '[data-theme="dark"] {', ":root:not([data-theme]) {"]) {
        const color = theme(selector);
        const text = color("text-color-default");
        const background = luminance(color("background-color-secondary"));
        for (const [, name, percentage, hue, variable] of matches) {
            const base = variable ? color(variable) : hue;
            const proportion = Number(percentage) / 100;
            const mixed = `#${[1, 3, 5].map((offset) =>
                Math.round(parseInt(text.slice(offset, offset + 2), 16) * proportion
                    + parseInt(base.slice(offset, offset + 2), 16) * (1 - proportion))
                    .toString(16).padStart(2, "0")).join("")}`;
            const foreground = luminance(mixed);
            const contrast = (Math.max(foreground, background) + 0.05)
                / (Math.min(foreground, background) + 0.05);
            assert.ok(contrast >= 4.5, `${name} in ${selector} has ${contrast.toFixed(2)}:1 contrast`);
        }
    }
});

test("a stale revision refreshes internally and retries a workflow action once", async () => {
    const calls = [];
    const model = { revision: 3 };
    const context = {
        model,
        api: async (path, input) => {
            calls.push({ path, input });
            if (calls.length === 1) throw Object.assign(new Error("Stale revision"),
                { status: 409, code: "STALE_REVISION" });
            return { revision: 5 };
        },
        refreshCurrent: async () => { model.revision = 4; },
    };
    const retry = runInNewContext(`${section("async function retryRevision(", "const workflowPhases =")}
        retryRevision`, context);
    assert.equal((await retry("/api/workflow/new", {})).revision, 5);
    assert.deepEqual(calls.map(({ input }) => input.revision), [3, 4]);
    assert.ok(calls.every(({ path }) => path === "/api/workflow/new"));
});

test("first open creates a workflow only when no workflow exists and phases are configured", async () => {
    const startup = section("await refreshCurrent().then(async () => {",
        "for (const root of document.querySelectorAll(\"[data-control-id]\"))");
    for (const [items, phases, expected] of [
        [[], [{ id: "specify", project: false }], 1],
        [[{ id: "__new__:1", pending: true }], [{ id: "specify", project: false }], 0],
        [[{ id: "specs/demo" }], [{ id: "specify", project: false }], 0],
        [[], [{ id: "constitution", project: true }], 0],
    ]) {
        const calls = [];
        const context = {
            model: null,
            refreshCurrent: async () => { context.model = { items, phases }; },
            workflowPhases: () => context.model.phases.filter((phase) => !phase.project),
            createWorkflow: async (initial) => { calls.push(initial); },
            message: (text) => { throw new Error(text); },
        };
        await runInNewContext(`(async () => { ${startup} })()`, context);
        assert.deepEqual(calls, Array(expected).fill(true));
    }
});

test("first open uses the existing workflow endpoint and selects the new pending row", async () => {
    const calls = [];
    const context = {
        model: null, workflowQuery: "", slugTouched: false, current: 0,
        flush: async () => {},
        refresh: async () => {
            context.model = { revision: calls.length, phases: [{ id: "specify", project: false }],
                items: calls.length ? [{ id: "__new__:1", pending: true }] : [] };
        },
        refreshCurrent: async () => context.refresh(),
        workflowPhases: () => context.model.phases.filter((phase) => !phase.project),
        api: async (path, input) => {
            calls.push({ path, revision: input.revision });
            return { revision: 1, id: "__new__:1" };
        },
        message: (text) => { assert.equal(text, ""); },
    };
    await runInNewContext(`(async () => {
        ${section("async function retryRevision(", "const workflowPhases =")}
        ${section("async function createWorkflow(", "async function deleteFeature(")}
        ${section("await refreshCurrent().then(async () => {",
            "for (const root of document.querySelectorAll(\"[data-control-id]\"))")}
    })()`, context);
    assert.deepEqual(calls, [{ path: "/api/workflow/new", revision: 0 }]);
    assert.equal(context.model.items[0].id, "__new__:1");
});

test("first-open workflow creation does not duplicate one created by another panel", async () => {
    const calls = [];
    const context = {
        model: { revision: 0, items: [] },
        flush: async () => {},
        api: async (path, input) => {
            calls.push({ path, revision: input.revision });
            throw Object.assign(new Error("Stale revision"), { status: 409, code: "STALE_REVISION" });
        },
        refreshCurrent: async () => { context.model = { revision: 1, items: [{ id: "__new__:1" }] }; },
        message: () => { throw new Error("Unexpected message"); },
    };
    const create = runInNewContext(`${section("async function retryRevision(", "const workflowPhases =")}
        ${section("async function createWorkflow(", "async function deleteFeature(")}
        createWorkflow`, context);
    await create(true);
    assert.deepEqual(calls, [{ path: "/api/workflow/new", revision: 0 }]);
    await create(true);
    assert.equal(calls.length, 1);
});

test("first open waits for an applied snapshot when an SSE refresh supersedes its request", async () => {
    const requests = [];
    let creations = 0;
    const context = {
        refreshSequence: 0, model: null, workflowPage: {}, mountedPage: "workflow",
        timer: null, saveFailure: null, constitution: () => null,
        workflowPhases: () => context.model?.phases.filter((phase) => !phase.project) ?? [],
        renderPhase() {}, syncFieldMounts: async () => {}, $: () => null, document: {},
        api: () => new Promise((resolve) => requests.push(resolve)),
        createWorkflow: async () => { creations++; },
        message: (text) => { throw new Error(text); },
    };
    const actions = runInNewContext(`
        ${section("async function refresh(reconcile = false) {", "async function selectPhase(")}
        ({ start: async () => {
            ${section("await refreshCurrent().then(async () => {",
                "for (const root of document.querySelectorAll(\"[data-control-id]\"))")}
        }, refresh })`, context);
    const existing = { revision: 1, items: [{ id: "__new__:1", pending: true }],
        phases: [{ id: "specify", project: false }], statuses: {} };
    const start = actions.start();
    const eventRefresh = actions.refresh();
    requests[0]({ revision: 0, items: [], phases: existing.phases });
    await new Promise(setImmediate);
    assert.equal(requests.length, 3);
    requests[1](existing);
    requests[2](existing);
    await Promise.all([start, eventRefresh]);
    assert.equal(creations, 0);
    assert.equal(context.model.items[0].id, "__new__:1");
});

test("stale-revision recovery waits for an applied snapshot before retrying creation", async () => {
    let attempts = 0, refreshes = 0;
    const context = {
        model: { revision: 0, items: [] },
        api: async () => {
            attempts++;
            throw Object.assign(new Error("Stale revision"), { status: 409, code: "STALE_REVISION" });
        },
        refresh: async () => {
            if (++refreshes === 1) return false;
            context.model = { revision: 1, items: [{ id: "__new__:1", pending: true }] };
            return true;
        },
    };
    const retry = runInNewContext(`${section("async function retryRevision(", "const workflowPhases =")}
        ${section("let currentRefresh;", "async function selectPhase(")}
        retryRevision`, context);
    assert.equal(await retry("/api/workflow/new", {}, () => !context.model.items.length), null);
    assert.equal(refreshes, 2);
    assert.equal(attempts, 1);
});

test("overlapping stale actions share one applied refresh instead of superseding each other", async () => {
    const snapshots = [], attempts = [];
    const context = {
        refreshSequence: 0, model: { revision: 0, items: [] },
        workflowPage: {}, mountedPage: "workflow", timer: null, saveFailure: null,
        constitution: () => null, renderPhase() {}, syncFieldMounts: async () => {},
        $: () => null, document: {},
        api: (path, input) => {
            if (path === "/api/state") return new Promise((resolve) => snapshots.push(resolve));
            attempts.push(input.revision);
            if (input.revision === 0) return Promise.reject(
                Object.assign(new Error("Stale revision"), { status: 409, code: "STALE_REVISION" }));
            return Promise.resolve({ revision: 2 });
        },
    };
    const retry = runInNewContext(`${section("async function retryRevision(", "const workflowPhases =")}
        ${section("async function refresh(reconcile = false) {", "async function selectPhase(")}
        retryRevision`, context);
    const first = retry("/api/workflow/new", {});
    const second = retry("/api/workflow/new", {});
    await new Promise(setImmediate);
    assert.equal(snapshots.length, 1);
    snapshots[0]({ revision: 1, items: [{ id: "__new__:1" }], statuses: {} });
    await Promise.all([first, second]);
    assert.deepEqual(attempts, [0, 0, 1, 1]);
    assert.equal(context.model.revision, 1);
});

test("SSE bursts share a state read and an older read cannot overwrite selection", async () => {
    const requests = [];
    const saves = [];
    const context = {
        refreshSequence: 0, model: { selected: "specs/beta", revision: 0, items: [] },
        workflowPage: {}, mountedPage: "workflow", timer: null, constitutionTimer: null,
        saveFailure: null, saving: Promise.resolve(), viewer: null,
        constitution: () => null, renderPhase() {}, syncFieldMounts: async () => {},
        $: () => null, document: {},
        flush: async () => {}, persist: async (patch) => {
            saves.push(patch);
            context.model.revision++;
        },
        api: () => new Promise((resolve) => requests.push(resolve)),
        message: (text) => { throw new Error(text); },
    };
    const actions = runInNewContext(`
        ${section("async function refresh(reconcile = false) {", "async function selectPhase(")}
        ${section("async function selectFeature(", "async function createWorkflow(")}
        const events = {};
        ${section("events.onmessage = () => {", "events.onerror =")}
        ({ events, selectFeature })`, context);
    for (let count = 0; count < 3; count++) actions.events.onmessage();
    await new Promise(setImmediate);
    assert.equal(requests.length, 1);
    const selecting = actions.selectFeature("specs/alpha");
    await new Promise(setImmediate);
    assert.equal(requests.length, 2);
    assert.equal(saves.length, 1);
    assert.equal(saves[0].selected, "specs/alpha");
    requests[1]({ selected: "specs/alpha", revision: 1, items: [], statuses: {} });
    await selecting;
    requests[0]({ selected: "specs/beta", revision: 0, items: [], statuses: {} });
    await new Promise(setImmediate);
    assert.equal(context.model.selected, "specs/alpha");
    assert.equal(requests.length, 3);
    requests[2]({ selected: "specs/alpha", revision: 1, items: [], statuses: {} });
    await new Promise(setImmediate);
    assert.equal(context.model.selected, "specs/alpha");
});

test("SSE notifications during a state read get one trailing read", async () => {
    const requests = [];
    const context = {
        refreshSequence: 0, model: { revision: 0, items: [] },
        workflowPage: {}, mountedPage: "workflow", timer: null, constitutionTimer: null,
        saveFailure: null, saving: Promise.resolve(), viewer: null,
        constitution: () => null, renderPhase() {}, syncFieldMounts: async () => {},
        $: () => null, document: {},
        api: () => new Promise((resolve) => requests.push(resolve)),
        message: (text) => { throw new Error(text); },
    };
    const events = runInNewContext(`
        ${section("async function refresh(reconcile = false) {", "async function selectPhase(")}
        const events = {};
        ${section("events.onmessage = () => {", "events.onerror =")}
        events`, context);
    events.onmessage();
    await new Promise(setImmediate);
    assert.equal(requests.length, 1);
    events.onmessage();
    events.onmessage();
    requests[0]({ revision: 0, items: [], statuses: {} });
    await new Promise(setImmediate);
    assert.equal(requests.length, 2);
    requests[1]({ revision: 1, items: [], statuses: {} });
    await new Promise(setImmediate);
    assert.equal(context.model.revision, 1);
    assert.equal(requests.length, 2);
});

test("terminal run changes invalidate badges after commit and before notification", async () => {
    const notifications = [];
    const context = {
        state: { revision: 0, runs: [{ runId: "run-1", status: "Running" }] },
        writes: Promise.resolve(), badgeRevision: 0, workspace: "workspace", statePath: "state.json",
        Buffer, structuredClone, UserError,
        atomicJson: async () => {},
        invalidateBadges() { context.badgeRevision++; },
        notify() { notifications.push(context.badgeRevision); },
    };
    const start = runtimeSource.indexOf("const update = (");
    const update = runInNewContext(`${runtimeSource.slice(start,
        runtimeSource.indexOf("if (state.autopilot &&", start))} update`, context);
    await update((next) => { next.runs[0].status = "Completed"; });
    assert.equal(context.badgeRevision, 1);
    assert.deepEqual(notifications, [1]);
    await update((next) => { next.runs[0].completedAt = "2026-11-12T00:00:00Z"; });
    assert.equal(context.badgeRevision, 2);
    assert.deepEqual(notifications, [1, 2]);
    await update((next) => { next.revision++; });
    assert.equal(context.badgeRevision, 2);
    await update((next) => { next.runs[0].status = "Failed"; });
    assert.equal(context.badgeRevision, 3);
    await update((next) => { next.runs[0].status = "Run output unconfirmed"; });
    assert.equal(context.badgeRevision, 4);
    context.atomicJson = async () => { throw new Error("Write failed"); };
    await assert.rejects(update((next) => { next.runs[0].status = "Completed"; }), /Write failed/);
    assert.equal(context.badgeRevision, 4);
});

test("a persistent revision conflict asks for another attempt, not a manual refresh", async () => {
    const model = { revision: 3 };
    let attempts = 0, refreshes = 0;
    const context = {
        model,
        api: async () => {
            attempts++;
            throw Object.assign(new Error("Stale revision"), { status: 409, code: "STALE_REVISION" });
        },
        refreshCurrent: async () => { model.revision++; refreshes++; },
    };
    const retry = runInNewContext(`${section("async function retryRevision(", "const workflowPhases =")}
        retryRevision`, context);
    await assert.rejects(retry("/api/workflow/new", {}),
        /Canvas state is still changing. Try this action again./);
    assert.equal(attempts, 2);
    assert.equal(refreshes, 2);
});

test("non-revision conflicts keep their error without refreshing or replaying the action", async () => {
    for (const detail of ["A workflow operation is in progress.", "Workflow or confirmation does not match."]) {
        const conflict = Object.assign(new Error(detail), { status: 409 });
        let attempts = 0, refreshes = 0;
        const retry = runInNewContext(`${section("async function retryRevision(", "const workflowPhases =")}
            retryRevision`, {
            model: { revision: 3 },
            api: async () => { attempts++; throw conflict; },
            refreshCurrent: async () => { refreshes++; },
        });
        await assert.rejects(retry("/api/workflow/delete", { itemId: "demo", confirmation: "demo" }),
            (error) => error === conflict);
        assert.equal(attempts, 1);
        assert.equal(refreshes, 0);
    }
});

test("a different conflict after a stale revision retry preserves its original error", async () => {
    const conflict = Object.assign(new Error("This workflow has an unfinished phase."), { status: 409 });
    let attempts = 0, refreshes = 0;
    const retry = runInNewContext(`${section("async function retryRevision(", "const workflowPhases =")}
        retryRevision`, {
        model: { revision: 3 },
        api: async () => {
            if (++attempts === 1) throw Object.assign(new Error("Stale revision"),
                { status: 409, code: "STALE_REVISION" });
            throw conflict;
        },
        refreshCurrent: async () => { refreshes++; },
    });
    await assert.rejects(retry("/api/workflow/delete", { itemId: "demo", confirmation: "demo" }),
        (error) => error === conflict);
    assert.equal(attempts, 2);
    assert.equal(refreshes, 1);
});

test("server exposes only revision conflicts as coded and UI retains that code", async () => {
    const staleRevision = runInNewContext(runtimeSource.slice(runtimeSource.indexOf("function staleRevision("),
        runtimeSource.indexOf("export async function existingOutputFolder("))
        + "staleRevision", { UserError });
    const stale = staleRevision("Canvas state changed.");
    assert.equal(stale.status, 409);
    assert.deepEqual(errorPayload(stale), { error: "Canvas state changed.", code: "STALE_REVISION" });
    const busy = new UserError("A workflow operation is in progress.", 409);
    assert.deepEqual(errorPayload(busy), { error: "A workflow operation is in progress." });
    let responseError = stale;
    const api = runInNewContext(`${section("async function api(", "async function retryRevision(")}
        api`, {
        token: "test",
        fetch: async () => ({ ok: false, status: 409, json: async () => errorPayload(responseError) }),
    });
    await assert.rejects(api("/api/state", { revision: 1 }),
        (error) => error.status === 409 && error.code === "STALE_REVISION"
            && error.message === "Canvas state changed.");
    responseError = busy;
    await assert.rejects(api("/api/workflow/delete", { revision: 1 }),
        (error) => error.status === 409 && error.code === undefined
            && error.message === busy.message);
});

test("all pending run buttons share the Running label, including Constitution", () => {
    const model = { selected: "demo", statuses: {
        specify: { status: "Request sent" }, constitution: { status: "Running" },
    } };
    const context = { model, sending: false };
    const label = runInNewContext(`${section("function pendingLabel(", "function renderStatus(")}
        pendingLabel`, context);
    assert.equal(label({ id: "specify", project: false }), "Running");
    assert.equal(label({ id: "constitution", project: true }), "Running");
    model.statuses.specify.status = "Completed";
    assert.equal(label({ id: "specify", project: false }), null);
    context.sending = { phase: "specify", item: "demo" };
    assert.equal(label({ id: "specify", project: false }), "Running");
});

test("rerunning a phase or Constitution requires overwrite confirmation, but first runs and pending retries do not", async () => {
    const model = { selected: "demo", constitutionReady: true, userProvidesSlug: false,
        items: [{ id: "demo", pending: false }], statuses: {
            specify: { status: "Not run" }, constitution: { status: "Completed",
                artifactAvailability: "available" },
        } };
    let confirmations = 0, submissions = 0, approved = false;
    const context = {
        model, sending: false, window: { confirm: () => { confirmations++; return approved; } },
        selectedPending: () => false, slugError: () => null,
        message: () => {}, renderStatus: () => {}, flush: async () => {},
        api: async () => { submissions++; }, refresh: async () => {},
        $: () => null, AbortSignal: { timeout: () => new AbortController().signal },
    };
    const send = runInNewContext(`${section("async function send(", "async function refreshArtifact(")}
        send`, context);
    const phase = { id: "specify", project: false };
    const constitution = { id: "constitution", project: true };
    await send(phase, "First run");
    assert.equal(confirmations, 0);
    assert.equal(submissions, 1);
    model.statuses.specify.status = "Request sent";
    await send(phase, "Retry while pending");
    assert.equal(confirmations, 0);
    assert.equal(submissions, 2);
    await send(constitution, "Updated principles");
    assert.equal(confirmations, 1);
    assert.equal(submissions, 2);
    approved = true;
    await send(constitution, "Updated principles");
    assert.equal(confirmations, 2);
    assert.equal(submissions, 3);
    model.statuses.specify = { status: "Completed" };
    await send(phase, "Run again");
    assert.equal(confirmations, 3);
    assert.equal(submissions, 4);
});

test("a not-yet-created output browses its parent without opening the artifact viewer", async () => {
    const calls = [];
    let viewerOpened = false;
    const context = {
        model: { selected: "specs/demo" },
        URLSearchParams,
        api: async (path, input) => {
            calls.push({ path, input });
            if (path.startsWith("/api/artifact")) throw Object.assign(new Error("Not found"), { status: 404 });
        },
        $: () => { viewerOpened = true; throw new Error("Viewer should stay closed"); },
    };
    const openArtifact = runInNewContext(`${section("async function openArtifact(", 'document.addEventListener("input"')}
        openArtifact`, context);
    await openArtifact({ id: "specify", project: false }, "specs/<slug>/notes.md");
    assert.equal(viewerOpened, false);
    assert.equal(calls.length, 2);
    assert.match(calls[0].path, /^\/api\/artifact\?/);
    assert.equal(calls[1].path, "/api/reveal");
    assert.equal(calls[1].input.phase, "specify");
    assert.equal(calls[1].input.itemId, "specs/demo");
    assert.equal(calls[1].input.output, "specs/<slug>/notes.md");
    context.api = async () => { throw Object.assign(new Error("Access denied"), { status: 403 }); };
    await assert.rejects(openArtifact({ id: "specify" }), /Access denied/);
    assert.equal(viewerOpened, false);
});

class Element {
    constructor(tag = "div", dataset = {}) {
        this.tagName = tag;
        this.dataset = dataset;
        this.children = [];
        this.parent = null;
        this.listeners = new Map();
        this.attributes = new Map();
        this.style = {};
        this.classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
        this.textContent = "";
        this.value = "";
        this.checked = false;
    }

    get isConnected() { return Boolean(this.parent && (this.parent.isConnected || this.parent.tagName === "document")); }
    get firstElementChild() { return this.children[0] ?? null; }
    set textContent(value) { this._text = value; if (this.children) this.replaceChildren(); }
    get textContent() { return this._text; }
    append(...nodes) {
        for (const node of nodes) {
            node.parent?.children.splice(node.parent.children.indexOf(node), 1);
            node.parent = this;
            this.children.push(node);
        }
    }
    replaceChildren(...nodes) {
        for (const node of this.children) node.parent = null;
        this.children = [];
        this.append(...nodes);
    }
    remove() {
        if (!this.parent) return;
        this.parent.children.splice(this.parent.children.indexOf(this), 1);
        this.parent = null;
    }
    contains(node) { return this === node || this.children.some((child) => child.contains(node)); }
    querySelectorAll(selector) {
        const key = { "[data-workflow-slot]": "workflowSlot", "[data-field-slot]": "fieldSlot" }[selector];
        return this.children.flatMap((child) => [
            ...(key && key in child.dataset ? [child] : []), ...child.querySelectorAll(selector),
        ]);
    }
    querySelector(selector) {
        if (selector === "input") return this.children.find((child) => child.tagName === "input") ?? null;
        const matches = (node) => selector === "strong" ? node.tagName === "strong"
            : selector === "code" ? node.tagName === "code"
                : selector.startsWith(".") && node.className?.split(" ").includes(selector.slice(1));
        for (const child of this.children) {
            if (matches(child)) return child;
            const nested = child.querySelector(selector);
            if (nested) return nested;
        }
        return null;
    }
    setAttribute(key, value) { this.attributes.set(key, value); }
    removeAttribute(key) { this.attributes.delete(key); }
    addEventListener(type, callback) { this.listeners.set(type, callback); }
    click() { return this.listeners.get("click")?.(); }
    change() { return this.listeners.get("change")?.(); }
}

test("workflow badges render text nodes rather than HTML", () => {
    const context = { document: { createElement: (tag) => new Element(tag) } };
    const create = runInNewContext(`${section("function readableBadgeForeground(", "function filterWorkflowList(")}
        badgeList([{ text: "<unsafe>", color: "amber" },
            { text: "White", color: "#ffffff" },
            { text: "Black", color: "#000000" }]);`, context);
    assert.equal(create.children[0].textContent, "<unsafe>");
    assert.equal(create.children[0].dataset.color, "amber");
    assert.deepEqual({ ...create.children[1].style },
        { backgroundColor: "#ffffff", color: "#111" });
    assert.deepEqual({ ...create.children[2].style },
        { backgroundColor: "#000000", color: "#fff" });
    assert.equal(create.children[0].children.length, 0);
});

test("summary displays runtime-provided zero count without a selected workflow", () => {
    const nodes = new Map([
        ["workflow-count", new Element()],
        ["workflow-identity", new Element()],
        ["workflow-list", new Element()],
        ["workflow-rows", new Element()],
        ["workflow-pipeline", new Element()],
        ["workflow-constitution-note", new Element()],
        ["new-workflow", new Element()],
        ["workflow-badge-summary", new Element()],
        ["workflow-badge-diagnostics", new Element()],
        ["workflow-empty", new Element()],
        ["workflow-search-field", new Element()],
        ["workflow-search", new Element()],
    ]);
    const summary = nodes.get("workflow-badge-summary");
    const context = { document: { createElement: (tag) => new Element(tag) },
        $: (id) => nodes.get(id), model: { selected: "__new__", items: [],
            badges: { selected: [], summary: [{ text: "Workflows with checklists (0)", color: "amber" }] } },
        workflowQuery: "", previousBadgeRows: undefined, workflowIdentity: new Element(), workflowPhases: () => [],
        hasSelectedWorkflow: () => false, selectedPending: () => false, filterWorkflowList() {} };
    runInNewContext(`${section("function renderCollection()", "function readableBadgeForeground(")}
        ${section("function readableBadgeForeground(", "function filterWorkflowList(")}
        renderCollection();`, context);
    assert.equal(summary.hidden, false);
    assert.equal(summary.firstElementChild.firstElementChild.textContent, "Workflows with checklists (0)");
});

test("workflow row badges update when evidence changes without changing workflow IDs", () => {
    const nodes = new Map([
        ["workflow-count", new Element()],
        ["workflow-list", new Element()],
        ["workflow-rows", new Element("div", { badgeSlot: "workflow.list" })],
        ["workflow-pipeline", new Element()],
        ["workflow-constitution-note", new Element()],
        ["new-workflow", new Element()],
        ["workflow-empty", new Element()],
        ["workflow-search-field", new Element()],
        ["workflow-search", new Element()],
    ]);
    const model = { items: [{ id: "alpha", label: "Alpha", slug: "alpha" }],
        selected: "alpha", constitutionReady: true,
        badges: { items: { alpha: [{ text: "One", color: "blue", showIn: ["workflow-list"] }] } } };
    const context = { document: { createElement: (tag) => new Element(tag) },
        $: (id) => nodes.get(id), model, workflowQuery: "", previousBadgeRows: undefined,
        workflowIdentity: new Element(), workflowPhases: () => [{}],
        hasSelectedWorkflow: () => true, selectedPending: () => false, filterWorkflowList() {} };
    const render = `${section("function renderCollection()", "function readableBadgeForeground(")}
        ${section("function readableBadgeForeground(", "function filterWorkflowList(")}
        renderCollection();`;
    runInNewContext(render, context);
    const first = nodes.get("workflow-rows").firstElementChild;
    assert.equal(first.querySelector(".canvas-badge").textContent, "One");
    model.badges.items.alpha[0].text = "Two";
    runInNewContext("renderCollection();", context);
    assert.equal(nodes.get("workflow-rows").firstElementChild.querySelector(".canvas-badge").textContent, "Two");
});

function harness({ placements, fields = [], pageSlots = [], adapter = null }) {
    const nodes = new Map();
    const page = new Element("section");
    const workflow = new Element("main");
    const notice = new Element("p");
    const registration = new Element("span", { placements: JSON.stringify(placements) });
    const pageRegistration = new Element("span", { generatedRenderer: "extra", module: "extra",
        values: "{}", assetSlots: "[]", assets: "[]" });
    const workflowButton = new Element("button", { canvasPage: "workflow" });
    const pageButton = new Element("button", { canvasPage: "extra" });
    for (const [key, value] of [
        ["generated-field-placements", registration], ["generated-page", page],
        ["workflow-content", workflow], ["canvas-message", notice],
    ]) nodes.set(key, value);
    const document = {
        tagName: "document",
        activeElement: null,
        createElement: (tag) => new Element(tag),
        getElementById: (id) => nodes.get(id) ?? null,
        querySelector: () => null,
        querySelectorAll: (selector) => selector === "[data-canvas-page]"
            ? [workflowButton, pageButton] : selector === "[data-generated-renderer]" ? [pageRegistration] : [],
    };
    for (const node of [workflow, page, notice, workflowButton, pageButton]) node.parent = document;
    const errors = [], saved = [], images = [];
    const state = { revision: 1, valueFields: fields, valueErrors: {}, pageValues: {},
        phases: [], statuses: {}, items: [], selected: "__new__", drafts: {} };
    const context = {
        ...controlBoundary,
        document, JSON, Map, Set, Object, Boolean, String, Promise,
        token: "test", renderStockImage: async (root, field, asset) => {
            images.push({ field, asset });
            root.textContent = `packaged:${asset.file}`;
        }, mountPageAssets: async () => {},
        loadPage: async () => ({ renderPage: ({ root }) => {
            for (const slot of pageSlots) root.append(new Element("div", { fieldSlot: slot }));
        } }),
        loadControl: async () => adapter,
        api: async (path, input) => {
            if (path === "/api/values") {
                if (state.saveError) throw state.saveError;
                saved.push(input);
                const field = state.valueFields.find((entry) => entry.id === input.id);
                field.value = input.value;
                return { revision: ++state.revision };
            }
            return state;
        },
        message: (text, id, error) => {
            errors.push({ text, id, error });
            notice.textContent = text;
            if (error) notice.setAttribute("role", "alert");
        },
        renderCollection() {}, renderValues() {}, renderPhase() {}, renderSetup() {},
        constitution: () => null, workflowPhases: () => [],
        saveInputs() {},
    };
    const program = [
        "const $ = (id) => document.getElementById(id);",
        section("let phaseControl;", "function currentTheme()"),
        section("function editValue(element)", "async function api("),
        section("async function retryRevision(", "const workflowPhases ="),
        section("async function refresh(reconcile", "async function selectPhase("),
    ].join("\n")
        .replaceAll("await import(`${registration.dataset.module}?token=${encodeURIComponent(token)}`)",
            "await loadPage(registration.dataset.module)")
        .replaceAll("await import(\n                `/controls/${placement.adapter}.mjs?token=${encodeURIComponent(token)}`)",
            "await loadControl(placement.adapter)");
    assert.doesNotMatch(program, /await import\(/);
    runInNewContext(`${program}\nthis.ui = { refresh, wireGeneratedPages, mountedFields };`, context);
    return { ...context, ui: context.ui, workflow, page, notice, workflowButton, pageButton,
        errors, saved, images, state };
}

const placement = (id, page, slot, field, control, extras = {}) =>
    ({ id, page, slot, field, control, order: 0, ...extras });

test("Workflow slots mount readonly text and editable checkbox, saving via values revision", async () => {
    const ui = harness({ placements: [
        placement("heading", "workflow", "heading", "title", "stock.text", { value: "Frozen", label: "Title" }),
        placement("toggle", "workflow", "options", "enabled", "stock.checkbox"),
    ], fields: [{ id: "enabled", label: "Enabled", value: false, schema: { type: "boolean" },
        editable: true }] });
    const heading = new Element("section", { workflowSlot: "heading" });
    const options = new Element("section", { workflowSlot: "options" });
    ui.workflow.append(heading, options);
    await ui.ui.refresh();
    assert.equal(heading.firstElementChild.textContent, "Frozen");
    const checkbox = options.firstElementChild.querySelector("input");
    assert.equal(checkbox.type, "checkbox");
    checkbox.checked = true;
    await checkbox.change();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(ui.saved.length, 1);
    assert.equal(ui.saved[0].revision, 1);
    assert.equal(ui.saved[0].value, true);
    assert.equal(ui.state.revision, 2);
});

test("Unconfigured image leaves its slot empty; configured image uses its packaged asset", async () => {
    const asset = { file: "brand.webp", hash: "a".repeat(64), mime: "image/webp" };
    const ui = harness({ placements: [
        placement("empty", "workflow", "empty", "unset-logo", "stock.image",
            { schema: { type: "image" } }),
        placement("image", "workflow", "image", "logo", "stock.image",
            { schema: { type: "image" }, asset }),
    ] });
    const empty = new Element("div", { workflowSlot: "empty" });
    const image = new Element("div", { workflowSlot: "image" });
    ui.workflow.append(empty, image);
    await ui.ui.refresh();
    assert.equal(empty.firstElementChild.textContent, "");
    assert.equal(empty.firstElementChild.children.length, 0);
    assert.equal(empty.firstElementChild.attributes.has("role"), false);
    assert.equal(image.firstElementChild.textContent, "packaged:brand.webp");
    assert.equal(ui.images.length, 1);
    assert.equal(JSON.stringify(ui.images[0].asset), JSON.stringify(asset));
    assert.deepEqual(ui.errors, []);
});

for (const slots of [[], ["target", "target"]]) {
    test(`Added page reports ${slots.length ? "duplicate" : "missing"} target visibly`, async () => {
        const ui = harness({ placements: [placement("x", "extra", "target", "name", "stock.text",
            { value: "Hi" })], pageSlots: slots });
        ui.ui.wireGeneratedPages();
        await ui.pageButton.click();
        assert.match(ui.page.textContent,
            slots.length ? /Duplicate generated field slot target/ : /did not render field slot target/);
    });
}

test("Shared field refreshes separate stock mounts without replacing a focused edit", async () => {
    const field = { id: "name", label: "Name", value: "first",
        schema: { type: "string", maxLength: 30 }, editable: true };
    const ui = harness({ placements: [
        placement("first", "workflow", "left", "name", "stock.text"),
        placement("second", "workflow", "right", "name", "stock.text"),
    ], fields: [field] });
    const left = new Element("div", { workflowSlot: "left" });
    const right = new Element("div", { workflowSlot: "right" });
    ui.workflow.append(left, right);
    await ui.ui.refresh();
    const first = left.firstElementChild.querySelector("input");
    const second = right.firstElementChild.querySelector("input");
    first.value = "draft";
    ui.document.activeElement = first;
    field.value = "server update";
    await ui.ui.refresh();
    assert.equal(first.value, "draft");
    assert.equal(second.value, "server update");
    await first.change();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(second.value, "draft");
    assert.equal(ui.saved.at(-1).value, "draft");
    assert.equal(left.firstElementChild.querySelector("input"), first);
});

test("Custom adapter updates per placement and disposes on page navigation", async () => {
    const calls = [];
    const adapter = { controlId: "custom.choice", valueContract: { type: "object",
        properties: { mode: ["a", "b"] } },
    mount: ({ field, value, readValues, onChange }) => {
        calls.push(["mount", field.id, value.mode, readValues(), typeof onChange]);
        return { update: ({ value: next }) => calls.push(["update", field.id, next.mode]),
            dispose: () => calls.push(["dispose", field.id]) };
    } };
    const schema = { type: "object", properties: { mode: ["a", "b"] } };
    const fields = ["one", "two"].map((id) =>
        ({ id, label: id, value: { mode: "a" }, schema, editable: true }));
    const ui = harness({ adapter, fields, placements: [
        placement("a", "workflow", "choices", "one", "custom.choice", { adapter: "choice" }),
        placement("b", "workflow", "choices", "two", "custom.choice", { adapter: "choice", order: 1 }),
    ] });
    ui.workflow.append(new Element("div", { workflowSlot: "choices" }));
    await ui.ui.refresh();
    assert.deepEqual(calls.filter(([action]) => action === "mount").map(([, id]) => id), ["one", "two"]);
    fields[0].value = { mode: "b" };
    await ui.ui.refresh();
    assert.ok(calls.some((call) => call[0] === "update" && call[1] === "one" && call[2] === "b"));
    ui.ui.wireGeneratedPages();
    await ui.pageButton.click();
    assert.deepEqual(calls.filter(([action]) => action === "dispose").map(([, id]) => id), ["one", "two"]);
});

test("Editable object adapter onChange saves through /api/values, syncs both mounts and reports failures", async () => {
    const handlers = [], updates = [];
    const schema = { type: "object", properties: {
        impact: ["low", "high"], likelihood: ["low", "high"],
    } };
    const adapter = {
        controlId: "custom.risk", valueContract: schema,
        mount: ({ onChange, field, editable }) => {
            assert.equal(field.id, "risk");
            assert.equal(editable, true);
            handlers.push(onChange);
            return { update: ({ value }) => updates.push(JSON.stringify(value)), dispose() {} };
        },
    };
    const field = { id: "risk", label: "Risk", schema, editable: true,
        value: { impact: "low", likelihood: "low" } };
    const ui = harness({ adapter, fields: [field], placements: [
        placement("risk-a", "workflow", "first", "risk", "custom.risk", { adapter: "risk" }),
        placement("risk-b", "workflow", "second", "risk", "custom.risk", { adapter: "risk" }),
    ] });
    ui.workflow.append(new Element("div", { workflowSlot: "first" }),
        new Element("div", { workflowSlot: "second" }));
    await ui.ui.refresh();
    assert.equal(handlers.length, 2);
    const edited = { impact: "high", likelihood: "low" };
    await handlers[0](edited);
    assert.equal(ui.saved.length, 1);
    assert.equal(ui.saved[0].id, "risk");
    assert.equal(ui.saved[0].revision, 1);
    assert.equal(JSON.stringify(ui.saved[0].value), JSON.stringify(edited));
    assert.equal(ui.state.revision, 2);
    assert.equal(JSON.stringify(field.value), JSON.stringify(edited));
    assert.ok(updates.filter((value) => value === JSON.stringify(edited)).length >= 2);
    assert.equal(ui.ui.mountedFields.size, 2);

    ui.state.saveError = new Error("Value rejected");
    const failed = { impact: "high", likelihood: "high" };
    await handlers[1](failed);
    assert.equal(ui.saved.length, 1);
    assert.equal(ui.state.revision, 2);
    assert.match(ui.notice.textContent, /Value could not be saved: Value rejected/);
    assert.equal(ui.notice.attributes.get("role"), "alert");
    assert.equal(ui.errors.at(-1).error, true);
    await ui.ui.refresh();
    assert.ok(updates.filter((value) => value === JSON.stringify(failed)).length >= 2);
});
