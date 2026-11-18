import assert from "node:assert/strict";
import { test } from "node:test";
import * as setup from "../extension-canvas-design/generated-host/setup-button-control/generated-setup-button-adapter.mjs";
import * as trigger from "../../tests/fixtures/test-presets/copilot-dialog-buttons-test/generated/dialog-trigger-adapter.mjs";

function buttonRoot() {
    const root = {
        ownerDocument: {
            createElement: () => ({
                addEventListener(_event, callback, options) {
                    this.activate = () => { if (!options.signal.aborted) callback(); };
                },
            }),
        },
        replaceChildren(button) { this.button = button; },
    };
    return root;
}

test("setup control delegates only the fixed setup action to its callback", () => {
    const root = buttonRoot();
    let calls = 0;
    const definition = { control: "project.setup-button", action: { type: "project.setup" },
        label: "Initialize project", presentation: "secondary" };
    const mounted = setup.mount({ root, definition, onSetup: () => { calls++; } });
    assert.equal(setup.controlId, "project.setup-button");
    assert.equal(root.button.textContent, "Initialize project");
    assert.equal(root.button.className, "btn btn-secondary");
    root.button.activate();
    assert.equal(calls, 1);
    mounted.dispose();
    root.button.activate();
    assert.equal(calls, 1);
    assert.throws(() => setup.mount({ root, definition: {
        ...definition, action: { type: "dialog.result" },
    }, onSetup: () => {} }), /Invalid project setup button context/);
});

test("dialog trigger cannot invoke the project setup callback", () => {
    const root = buttonRoot();
    let calls = 0;
    const definition = { control: "dialog.trigger", action: { type: "dialog.result" },
        label: "Review", presentation: "primary" };
    trigger.mount({ root, definition, onTrigger: () => { calls++; } });
    assert.equal(trigger.controlId, "dialog.trigger");
    root.button.activate();
    assert.equal(calls, 1);
    assert.throws(() => trigger.mount({ root, definition: {
        ...definition, action: { type: "project.setup" },
    }, onTrigger: () => {} }), /Invalid dialog trigger context/);
});
