import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, test } from "node:test";
import { compileBlueprint } from "../generation/compiler.mjs";

const globals = Object.fromEntries(["document", "EventSource", "fetch", "localStorage"].map((key) => [key, globalThis[key]]));
const directories = [];
afterEach(async () => {
    Object.assign(globalThis, globals);
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});
const tick = () => new Promise((resolve) => setImmediate(resolve));

function element() {
    const listeners = new Map(), selectors = new Map();
    let html = "", markers = [];
    return {
        dataset: {}, value: "", hidden: false, disabled: false,
        get innerHTML() { return html; },
        set innerHTML(value) {
            html = value;
            markers = Array.from(value.matchAll(/data-clarify-idx="(\d+)"/g), (match) => {
                const button = element();
                button.dataset.clarifyIdx = match[1];
                return button;
            });
        },
        addEventListener(type, handler) { listeners.set(type, handler); },
        emit(type, event = {}) { return listeners.get(type)?.(event); },
        focus() { globalThis.document.activeElement = this; },
        querySelector(selector) {
            if (!selectors.has(selector)) selectors.set(selector, element());
            return selectors.get(selector);
        },
        querySelectorAll(selector) { return selector === "[data-clarify-idx]" ? markers : []; },
        insertAdjacentHTML(_position, value) { this.innerHTML += value; },
    };
}

async function fixture() {
    const elements = new Map(), values = new Map(), posts = [];
    const get = (id) => {
        if (!elements.has(id)) elements.set(id, element());
        return elements.get(id);
    };
    globalThis.document = { documentElement: { dataset: {} }, getElementById: get };
    globalThis.localStorage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
    let events;
    globalThis.EventSource = class { constructor() { events = this; } };
    const pipeline = compileBlueprint({ pipeline: [{ id: "specify" }, { id: "plan" }, { id: "constitution" }] },
        { extensionId: "clarification-ui", displayName: "Test", description: "Isolated renderer fixture" },
        { userProvidesSlug: true, multiInstance: true });
    pipeline.runtime.multiInstance = true;
    const [specify, plan, constitution] = pipeline.pipeline.steps;
    const snapshot = {
        clarificationScope: "isolated-workspace-canvas",
        pipeline, setup: { ready: true }, selectedItemId: "alpha",
        projectArtifacts: { constitution: { state: "ready", ready: true, viewable: true, path: constitution.artifact.pathTemplate } },
        items: ["alpha", "beta"].map((id) => ({
            id, slug: id, label: id, phases: {
                [specify.instanceKey]: { artifact: `specs/${id}/spec.md` },
                [plan.instanceKey]: { artifact: `specs/${id}/plan.md` },
            },
        })),
    };
    let send = async (input) => ({ ok: true, phase: input.phase });
    let readArtifact = async () => ({ content: "# Artifact\n[NEEDS CLARIFICATION: Which <scope>?]\n\n[NEEDS CLARIFICATION: Tests?]" });
    globalThis.fetch = async (url, options) => {
        let result;
        if (options) {
            const input = JSON.parse(options.body);
            posts.push({ url, input });
            result = await send(input);
        } else result = url.startsWith("/api/artifact") ? await readArtifact(url) : structuredClone(snapshot);
        return { ok: true, json: async () => result };
    };
    const directory = join(dirname(fileURLToPath(import.meta.url)), `.clarification-ui-${randomUUID()}`);
    directories.push(directory);
    await mkdir(directory);
    await Promise.all(["app.js", "markdown.mjs", "clarifications.mjs", "command-views.mjs", "workflow-slug.mjs"].map((name) => (
        copyFile(new URL(`../generation/generated-canvas-template/ui/${name}`, import.meta.url), join(directory, name === "app.js" ? "app.mjs" : name))
    )));
    await import(pathToFileURL(join(directory, "app.mjs")).href);
    await tick();
    const buttons = () => get("artifact-viewer").querySelectorAll("[data-clarify-idx]");
    const answer = async (text, index = 0) => {
        await buttons()[index].emit("click");
        get("clarification-answer").value = text;
        await get("clarification-answer").emit("input");
        await get("queue-clarification").emit("click");
    };
    const decide = (value) => get("modal-root").querySelector(`[data-answer="${value}"]`).emit("click");
    const select = (id) => get("instance-collection").emit("click", {
        target: { closest: (selector) => selector === "[data-instance]" ? { dataset: { instance: id } } : null },
    });
    return { get, snapshot, specify, plan, constitution, posts, buttons, answer, decide, select,
        refresh: async () => { events.onmessage(); await tick(); },
        setSend: (callback) => { send = callback; },
        setRead: (callback) => { readArtifact = callback; },
    };
}

test("viewer stages, edits and cancels answers without dispatch; Back, workflows and phases isolate drafts", async () => {
    const f = await fixture();
    await f.get("view-artifact").emit("click");
    assert.equal(f.buttons().length, 2);
    await f.buttons()[0].emit("click");
    assert.match(f.get("modal-root").innerHTML, /Which &lt;scope&gt;\?/);
    f.get("clarification-answer").value = "Discard unsaved";
    await f.get("cancel-clarification").emit("click");
    assert.equal(f.get("clarification-banner").hidden, true);
    await f.answer("Alpha only");
    await f.answer("Focused tests", 1);
    assert.equal(f.buttons()[0].textContent, "Answered ✓");
    assert.equal(f.posts.length, 0, "even answering all markers must not dispatch");
    await f.refresh();
    assert.equal(f.posts.length, 0, "polling must not dispatch");
    await f.get("close-artifact").emit("click");
    await f.get("view-artifact").emit("click");
    assert.equal(f.buttons()[0].title, "Alpha only");
    await f.get("close-artifact").emit("click");
    await f.select("beta");
    await f.get("view-artifact").emit("click");
    assert.equal(f.buttons()[0].textContent, "Clarify");
    await f.answer("Beta only");
    await f.get("close-artifact").emit("click");
    await f.select("alpha");
    await f.get("next-phase").emit("click");
    await f.get("view-artifact").emit("click");
    assert.equal(f.buttons()[0].textContent, "Clarify");
    await f.get("close-artifact").emit("click");
    await f.get("previous-phase").emit("click");
    await f.get("view-artifact").emit("click");
    assert.equal(f.buttons()[0].title, "Alpha only");
    const cancelled = f.get("apply-clarifications").emit("click");
    await f.decide("cancel");
    await cancelled;
    assert.equal(f.posts.length, 0);
    assert.equal(f.buttons()[0].title, "Alpha only");
});

test("captured dispatch survives selection changes and preserves concurrent edits/additions with running acknowledgement", async () => {
    const f = await fixture();
    await f.get("view-artifact").emit("click");
    await f.answer("Initial");
    let release;
    f.setSend(() => new Promise((resolve) => { release = resolve; }));
    const sending = f.get("apply-clarifications").emit("click");
    await f.decide("confirm");
    await tick();
    assert.equal(f.posts.length, 1);
    assert.deepEqual(Object.keys(f.posts[0].input), ["phase", "itemId", "args"]);
    assert.equal(f.posts[0].input.phase, f.specify.instanceKey);
    assert.equal(f.posts[0].input.itemId, "alpha");
    assert.match(f.posts[0].input.args, /Clarifications for artifact: specs\/alpha\/spec.md/);
    assert.match(f.posts[0].input.args, /Clarification — Which <scope>\?\nAnswer: Initial/);
    await f.answer("Edited in flight");
    await f.answer("Added in flight", 1);
    await f.get("close-artifact").emit("click");
    await f.select("beta");
    await f.get("view-artifact").emit("click");
    release({ ok: true, phase: f.specify.instanceKey });
    await sending;
    assert.equal(f.buttons()[0].textContent, "Clarify", "alpha completion must not repaint beta");
    await f.get("close-artifact").emit("click");
    await f.select("alpha");
    await f.get("view-artifact").emit("click");
    assert.equal(f.buttons()[0].title, "Edited in flight");
    assert.equal(f.buttons()[1].title, "Added in flight");
    await f.get("apply-clarifications").emit("click");
    assert.equal(f.posts.length, 1, "running acknowledgement prevents a duplicate");
});

test("failed/gated sends keep answers and Constitution dispatch stays project-scoped", async () => {
    const f = await fixture();
    await f.get("view-constitution").emit("click");
    await f.answer("Project testing rules");
    for (const response of [
        new Error("offline"),
        { ok: false, approvalRequired: true },
        { ok: false, code: "constitution_required" },
    ]) {
        f.setSend(async () => { if (response instanceof Error) throw response; return response; });
        const submission = f.get("apply-clarifications").emit("click");
        assert.match(f.get("modal-root").innerHTML, /Existing project Constitution content/);
        assert.doesNotMatch(f.get("modal-root").innerHTML, /downstream/);
        await f.decide("confirm");
        await submission;
        assert.equal(f.buttons()[0].title, "Project testing rules");
        assert.match(f.get("clarification-banner").innerHTML, /preserved/);
    }
    await f.select("beta");
    f.setSend(async (input) => ({ ok: true, queued: true, phase: input.phase }));
    const queued = f.get("apply-clarifications").emit("click");
    await f.decide("confirm");
    await queued;
    assert.equal(f.buttons()[0].title, "Project testing rules");
    assert.match(f.get("clarification-banner").innerHTML, /queued for setup/);
    for (const { url, input } of f.posts) {
        assert.equal(url, "/api/run");
        assert.equal(input.phase, f.constitution.instanceKey);
        assert.equal(Object.hasOwn(input, "itemId"), false);
        assert.equal(Object.hasOwn(input, "slug"), false);
    }
});

test("late artifact reads cannot replace the newly selected artifact context", async () => {
    const f = await fixture();
    let release;
    f.setRead((url) => url.includes("alpha") ? new Promise((resolve) => { release = resolve; }) : Promise.resolve({ content: "[NEEDS CLARIFICATION: Beta?]" }));
    const first = f.get("view-artifact").emit("click");
    await f.select("beta");
    await f.get("view-artifact").emit("click");
    release({ content: "[NEEDS CLARIFICATION: Alpha?]" });
    await first;
    assert.match(f.get("artifact-viewer").innerHTML, /Beta\?/);
    assert.doesNotMatch(f.get("artifact-viewer").innerHTML, /Alpha\?/);
    assert.equal(f.posts.length, 0);
});
