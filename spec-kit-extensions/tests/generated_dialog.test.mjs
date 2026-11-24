import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { mount } from "../extension-canvas-design/generated-host/dialog/generated-dialog-adapter.mjs";
import * as dialogBoundary from "../extension-canvas-design/generated-scaffold/contracts/external-dialog-button.mjs";

function dialogRoot() {
    const document = { activeElement: null };
    const node = (tag) => ({
        tag, ownerDocument: document, children: [], listeners: new Map(),
        append(...children) { this.children.push(...children); for (const child of children) child.parent = this; },
        replaceChildren(...children) { this.children = []; this.append(...children); },
        remove() {
            this.parent.children = this.parent.children.filter((child) => child !== this);
        },
        setAttribute() {},
        addEventListener(event, listener) { this.listeners.set(event, listener); },
        focus() { document.activeElement = this; },
        querySelectorAll() {
            const descendants = (parent) => parent.children.flatMap((child) =>
                [child, ...descendants(child)]);
            return descendants(this).filter((child) => child.tag === "a" || child.tag === "button");
        },
    });
    document.createElement = node;
    return node("root");
}

test("dialog keyboard trap includes links before buttons and cleanup is idempotent", async () => {
    const root = dialogRoot();
    const original = { focus() { root.ownerDocument.activeElement = this; } };
    root.ownerDocument.activeElement = original;
    const decisions = [];
    const instance = mount({ root, definition: {
        title: "Confirmation",
        blocks: [{ type: "link", href: "https://example.org", text: "Documentation" }],
        buttons: { cancel: "Cancel", confirm: "Confirm" },
    }, onDecision: (decision) => decisions.push(decision) });
    const dialog = root.children[0].children[0];
    const [link, cancel, confirm] = dialog.querySelectorAll();
    assert.equal(root.ownerDocument.activeElement, cancel);
    const pressTab = (shiftKey) => {
        let prevented = false;
        dialog.listeners.get("keydown")({ key: "Tab", shiftKey,
            preventDefault() { prevented = true; } });
        return prevented;
    };
    assert.equal(pressTab(true), false);
    link.focus();
    assert.equal(pressTab(true), true);
    assert.equal(root.ownerDocument.activeElement, confirm);
    assert.equal(pressTab(false), true);
    assert.equal(root.ownerDocument.activeElement, link);
    cancel.listeners.get("click")();
    assert.equal(await instance.result, "cancelled");
    instance.dispose();
    assert.deepEqual(decisions, ["cancelled"]);
    assert.equal(root.children.length, 0);
    assert.equal(root.ownerDocument.activeElement, original);
});

test("generated host mounts synchronous and asynchronous dialog and button adapters", async () => {
    const source = await readFile(new URL("../extension-canvas-design/generated-scaffold/ui/app.js",
        import.meta.url), "utf8");
    const start = source.indexOf("async function showGeneratedDialog(");
    const end = source.indexOf("function renderSetup()", start);
    assert.ok(start >= 0 && end > start);
    const host = source.slice(start, end)
        .replace("await import(`/dialogs/${registration.adapter}.mjs?token=${encodeURIComponent(token)}`)",
            "await loadDialog(registration.adapter)")
        .replace("await import(`/buttons/${control.adapter}.mjs?token=${encodeURIComponent(token)}`)",
            "await loadButton(control.adapter)");
    assert.doesNotMatch(host, /await import\(/);

    for (const asynchronous of [false, true]) {
        let dialogDisposals = 0, buttonDisposals = 0, trigger;
        const messages = [];
        const dialog = { id: "review-dialog", adapter: "review-adapter" };
        const dialogRoot = { childElementCount: 0, replaceChildren() {} };
        const buttonsRoot = { append() {} };
        const dialogInstance = () => ({ result: Promise.resolve("confirmed"),
            dispose: () => { dialogDisposals++; } });
        const buttonInstance = () => ({ dispose: () => { buttonDisposals++; } });
        const context = {
            ...dialogBoundary,
            dialogs: [dialog], dialogCache: new Map(), dialogPending: false, dialogRoot, token: "test",
            buttons: [{ control: "dialog.trigger", page: "workflow", slot: "workflow.actions",
                order: 0, label: "Review", dialog: dialog.id }],
            buttonControls: [{ id: "dialog.trigger", adapter: "button-adapter" }],
            buttonMounts: [], setupBusy: false,
            $: (id) => id === "generated-dialog-root" ? dialogRoot : null,
            fetch: async () => ({ ok: true, json: async () => dialog }),
            loadDialog: async () => ({ dialogId: "stock.dialog", contractVersion: 1,
                mount: asynchronous ? async () => dialogInstance() : () => dialogInstance() }),
            loadButton: async () => ({ controlId: "dialog.trigger", contractVersion: 1,
                mount: asynchronous ? async ({ onTrigger }) => {
                    trigger = onTrigger; return buttonInstance();
                } : ({ onTrigger }) => { trigger = onTrigger; return buttonInstance(); } }),
            document: { createElement: () => ({}), querySelector: () => buttonsRoot },
            message: (text) => messages.push(text),
        };
        runInNewContext(`${host}\nthis.operations = { showGeneratedDialog, mountGeneratedButtons };`, context);
        await context.operations.mountGeneratedButtons();
        assert.equal(context.buttonMounts.length, 1);
        assert.equal(await context.operations.showGeneratedDialog(dialog.id), true);
        await trigger();
        assert.equal(dialogDisposals, 2);
        assert.deepEqual(messages, ["Review confirmed."]);
        context.buttonMounts[0].dispose();
        assert.equal(buttonDisposals, 1);
    }
});

test("generated host rejects overlapping dialog mounts and releases its reservation", async () => {
    const source = await readFile(new URL("../extension-canvas-design/generated-scaffold/ui/app.js",
        import.meta.url), "utf8");
    const start = source.indexOf("async function showGeneratedDialog(");
    const end = source.indexOf("async function mountGeneratedButtons()", start);
    assert.ok(start >= 0 && end > start);
    const host = source.slice(start, end)
        .replace("await import(`/dialogs/${registration.adapter}.mjs?token=${encodeURIComponent(token)}`)",
            "await loadDialog(registration.adapter)");
    assert.doesNotMatch(host, /await import\(/);

    const dialog = { id: "review-dialog", adapter: "review-adapter" };
    let entered, release, mounts = 0, disposals = 0;
    const started = new Promise((resolve) => { entered = resolve; });
    const gate = new Promise((resolve) => { release = resolve; });
    const root = { children: [], get childElementCount() { return this.children.length; },
        replaceChildren() { this.children = []; } };
    const context = {
        ...dialogBoundary,
        dialogs: [dialog], dialogCache: new Map(), dialogPending: false, token: "test",
        $: () => root,
        fetch: async () => ({ ok: true, json: async () => dialog }),
        loadDialog: async () => ({ dialogId: "stock.dialog", contractVersion: 1,
            mount: async () => {
                mounts++;
                if (mounts === 1) { entered(); await gate; }
                if (mounts === 3) {
                    root.children.push({});
                    throw new Error("mount failed");
                }
                return { result: Promise.resolve("cancelled"),
                    dispose: () => { disposals++; } };
            } }),
    };
    runInNewContext(`${host}\nthis.showGeneratedDialog = showGeneratedDialog;`, context);
    const first = context.showGeneratedDialog(dialog.id);
    await assert.rejects(context.showGeneratedDialog(dialog.id), /already open/);
    await started;
    await assert.rejects(context.showGeneratedDialog(dialog.id), /already open/);
    assert.equal(mounts, 1);
    release();
    assert.equal(await first, false);
    assert.equal(await context.showGeneratedDialog(dialog.id), false);
    await assert.rejects(context.showGeneratedDialog(dialog.id), /mount failed/);
    assert.equal(root.childElementCount, 0);
    assert.equal(await context.showGeneratedDialog(dialog.id), false);
    assert.equal(mounts, 4);
    assert.equal(disposals, 3);
});

test("generated phase confirmation rejects a switch between pending workflow IDs", async () => {
    const source = await readFile(new URL("../extension-canvas-design/generated-scaffold/ui/app.js",
        import.meta.url), "utf8");
    const start = source.indexOf("async function confirmGeneratedPhase(");
    const end = source.indexOf("async function mountGeneratedButtons()", start);
    assert.ok(start >= 0 && end > start);
    const model = { selected: "__new__:1" };
    let approve, dialogContext;
    const decision = new Promise((resolve) => { approve = resolve; });
    const context = { model, phaseDialogs: [{ phase: "speckit.plan", dialog: "confirm-plan" }],
        requireModel() {}, showGeneratedDialog: (_id, details) => {
            dialogContext = details; return decision;
        } };
    runInNewContext(`${source.slice(start, end)}\nthis.confirmGeneratedPhase = confirmGeneratedPhase;`, context);
    const selected = { id: "plan", label: "Plan" };
    const confirmation = context.confirmGeneratedPhase(selected);
    model.selected = "__new__:2";
    approve(true);
    await assert.rejects(confirmation, /Selected workflow or phase changed/);
    assert.deepEqual(JSON.parse(JSON.stringify(dialogContext)), { phase: selected });
    context.showGeneratedDialog = async () => true;
    assert.equal(await context.confirmGeneratedPhase(selected), true);
});
