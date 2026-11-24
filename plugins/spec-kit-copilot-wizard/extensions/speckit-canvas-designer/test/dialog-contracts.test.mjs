import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { declarations } from "../../../../../spec-kit-extensions/extension-canvas-design/scripts/verify-launch.mjs";
import {
    validateButtonControl, validateButtonPlacement, validateDialog, validatePhaseDialogBinding,
} from "../pages.mjs";

const base = new URL("../../../../../spec-kit-extensions/extension-canvas-design/", import.meta.url);
const preset = new URL("../../../../../tests/fixtures/test-presets/copilot-dialog-buttons-test/", import.meta.url);
const json = async (root, path) => JSON.parse(await readFile(new URL(path, root), "utf8"));

test("stock named dialog and button contracts are registered and valid", async () => {
    const names = declarations(await readFile(new URL("commands/load-page.md", base), "utf8"));
    const kinds = new Map(names.map(({ name, kind }) => [name, kind]));
    for (const [name, kind] of [
        ["designer-essentials-show-setup", "designer.setting-definition"],
        ["generated-setup-dialog", "generated.dialog-definition"],
        ["generated-dialog-adapter", "generated.dialog-adapter"],
        ["generated-setup-button-control", "generated.button-control-definition"],
        ["generated-setup-button-adapter", "generated.button-adapter"],
        ["generated-setup-button", "generated.button-placement"],
    ]) assert.equal(kinds.get(name), kind);
    const dialog = await json(base, "generated-host/dialog/setup.json");
    const control = await json(base, "generated-host/setup-button-control/control.json");
    const button = await json(base, "generated-host/setup-button-control/setup.json");
    assert.doesNotThrow(() => validateButtonPlacement({
        ...button, label: "Initialize project", presentation: "secondary",
    }, button.id));
    assert.doesNotThrow(() => validateDialog(dialog, "generated-setup-dialog"));
    assert.doesNotThrow(() => validateButtonControl(control, "generated-setup-button-control"));
    assert.doesNotThrow(() => validateButtonPlacement(button, "generated-setup-button"));
    assert.equal(dialog.blocks.filter(({ name }) => name === "pending-packages").length, 1);
    assert.equal(button.action.type, "project.setup");
    const option = await json(base, "designer-host/essentials-settings/show-setup.json");
    assert.equal(option.field.id, "setup.show");
    assert.equal(option.field.default, false);
    const page = await json(base, "generated-host/workflow-page/workflow.json");
    assert.deepEqual(page.slots.map(({ id }) => id),
        ["workflow.phases", "workflow.actions", "workflow.list", "workflow.summary"]);
});

test("fixture binds exactly one phase and adds a dialog-result button without replacing Workflow", async () => {
    const names = declarations(`${await readFile(new URL("commands/load-page.md", base), "utf8")}
${await readFile(new URL("commands/load-page.md", preset), "utf8")}`);
    assert.deepEqual(names.slice(-6).map(({ kind }) => kind), [
        "generated.dialog-definition", "generated.dialog-definition",
        "generated.button-control-definition", "generated.button-adapter",
        "generated.phase-dialog-binding", "generated.button-placement",
    ]);
    const dialog = await json(preset, "generated/dialog.json");
    const buttonDialog = await json(preset, "generated/button-dialog.json");
    const binding = await json(preset, "generated/phase-binding.json");
    const button = await json(preset, "generated/button.json");
    const trigger = await json(preset, "generated/dialog-trigger-control.json");
    validateDialog(dialog, dialog.id);
    validateDialog(buttonDialog, buttonDialog.id);
    validatePhaseDialogBinding(binding, binding.id);
    validateButtonPlacement(button, button.id);
    validateButtonControl(trigger, "canvas-dialog-trigger-control");
    assert.equal(button.control, trigger.id);
    assert.equal(binding.dialog, dialog.id);
    assert.equal(button.dialog, buttonDialog.id);
    assert.equal(binding.phase, "speckit.implement");
    assert.equal(button.action.type, "dialog.result");
});

test("rejects unsafe or ambiguous dialog and button definitions", async () => {
    const dialog = await json(base, "generated-host/dialog/setup.json");
    const button = await json(base, "generated-host/setup-button-control/setup.json");
    const control = await json(base, "generated-host/setup-button-control/control.json");
    const binding = await json(preset, "generated/phase-binding.json");
    assert.throws(() => validateDialog({ ...dialog, blocks: [{ type: "html", text: "<script>" }] },
        dialog.id), /invalid dialog block/);
    assert.throws(() => validateDialog({ ...dialog, blocks: [{ type: "paragraph", text: "Hidden" }] },
        dialog.id), /pending packages/);
    assert.throws(() => validateDialog({ ...dialog, blocks: [{ type: "link", text: "Bad", href: "javascript:alert(1)" }] },
        dialog.id), /invalid dialog block/);
    assert.throws(() => validateButtonPlacement({ ...button, action: { type: "dialog.result" } },
        button.id), /invalid generated button placement/);
    assert.throws(() => validateButtonControl({ ...control, id: "stock.button" },
        "generated-setup-button-control"), /invalid generated button control/);
    assert.throws(() => validateButtonPlacement({ ...button, control: "dialog.trigger" },
        button.id), /invalid generated button placement/);
    assert.throws(() => validateButtonPlacement({ ...button, slot: "workflow.actions" },
        button.id), /invalid generated button placement/);
    assert.throws(() => validatePhaseDialogBinding({ ...binding, phase: "implement" },
        binding.id), /invalid phase dialog binding/);
    assert.throws(() => validatePhaseDialogBinding({ ...binding, phase: "speckit.constitution" },
        binding.id), /invalid phase dialog binding/);
});
