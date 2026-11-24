import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createContext, runInContext } from "node:vm";
import { UserError } from "../extension-canvas-design/generated-scaffold/files.mjs";
import { validateWorkflowAdapter, validateWorkflowMount, validateWorkflowPageDefinition,
    validatePhaseAdapter, validatePhaseMount, workflowItemName } from
    "../extension-canvas-design/generated-scaffold/contracts/external-host-adapter.mjs";
import { validateDialogAdapter, validateDialogInstance, validateDialogDecision,
    validateButtonAdapter, validateButtonInstance } from
    "../extension-canvas-design/generated-scaffold/contracts/external-dialog-button.mjs";
import { validateGeneratedControl, validatePlacedControl, validatePageRenderer,
    validateStockTextAdapter, validateStockImageAdapter } from
    "../extension-canvas-design/generated-scaffold/contracts/external-generated-controls.mjs";
import { validateBadgeEvaluator, badgeEvidence, validateBadgeEvaluatorResult } from
    "../extension-canvas-design/generated-scaffold/contracts/external-badge-evaluator.mjs";
import { providerEvaluationScript, validateProviderSerializedResult, validateValue } from
    "../extension-canvas-design/generated-scaffold/contracts/external-value-provider.mjs";

test("Workflow and phase checks retain distinct version, capability and handle requirements", () => {
    const mount = () => {};
    const page = { pageId: "workflow", contractVersion: 1, mount };
    assert.equal(validateWorkflowAdapter(page), undefined);
    assert.equal(validateWorkflowMount({ update() {}, dispose() {} }), undefined);
    for (const invalid of [{ ...page, pageId: "other" }, { ...page, contractVersion: 2 },
        { ...page, mount: undefined }]) {
        assert.throws(() => validateWorkflowAdapter(invalid),
            { message: "Incompatible Workflow page adapter" });
    }
    assert.throws(() => validateWorkflowMount({ update() {} }),
        { message: "Workflow page adapter must return update and dispose" });
    const phase = { controlId: "workflow-phases", contractVersion: 1, mount };
    assert.equal(validatePhaseAdapter(phase), mount);
    assert.equal(validatePhaseAdapter({ ...phase, requiredCapabilities: ["workflow.rows.v1"] }), mount);
    for (const requiredCapabilities of ["workflow.rows.v1", ["missing"], ["workflow.rows.v1", "workflow.rows.v1"]]) {
        assert.throws(() => validatePhaseAdapter({ ...phase, requiredCapabilities }),
            { message: "Phase control adapter requires unavailable host capabilities" });
    }
    const handle = { update() {}, dispose() {} };
    assert.equal(validatePhaseMount(handle), handle);
});

test("Workflow page item names accept legacy defaults and reject incompatible host payloads", () => {
    for (const canvas of [undefined, {}, { workflowItemName: "Bug" },
        { workflowItemName: "x".repeat(80) }]) {
        const definition = { id: "workflow", ...(canvas === undefined ? {} : { canvas }) };
        assert.equal(validateWorkflowPageDefinition(definition), definition);
    }
    assert.equal(workflowItemName(undefined), "Workflow");
    assert.equal(workflowItemName("Bug"), "Bug");
    for (const value of [null, 1, "", " ", " Bug", "Bug ", "Bug\nReport", "x".repeat(81)]) {
        assert.throws(() => validateWorkflowPageDefinition({
            id: "workflow", canvas: { workflowItemName: value },
        }), /Incompatible Workflow page definition/);
        assert.throws(() => workflowItemName(value), /Invalid workflow item name/);
    }
    for (const canvas of [null, "Bug", []]) {
        assert.throws(() => validateWorkflowPageDefinition({ id: "workflow", canvas }),
            /Incompatible Workflow page definition/);
    }
});

test("dialog and button boundaries accept asynchronous mounts but preserve decision and disposal checks", () => {
    const definition = { id: "confirm", adapter: "confirmation" };
    const module = { dialogId: "stock.dialog", contractVersion: 1, mount: async () => {} };
    assert.equal(validateDialogAdapter(definition, "confirm", definition, module), undefined);
    for (const invalid of [{ ...module, contractVersion: 2 }, { ...module, dialogId: "confirm" },
        { ...module, mount: undefined }]) {
        assert.throws(() => validateDialogAdapter(definition, "confirm", definition, invalid),
            { message: "Incompatible generated dialog: confirm" });
    }
    assert.doesNotThrow(() => validateDialogInstance({ dispose() {}, result: Promise.resolve("confirmed") }, "confirm"));
    assert.throws(() => validateDialogInstance({ result: Promise.resolve("confirmed") }, "confirm"),
        { message: "Invalid dialog adapter result: confirm" });
    for (const decision of ["confirmed", "cancelled"]) assert.doesNotThrow(() => validateDialogDecision(decision));
    for (const decision of [true, "approved", undefined]) {
        assert.throws(() => validateDialogDecision(decision), { message: "Invalid generated dialog decision" });
    }
    const control = { id: "dialog.trigger" };
    assert.doesNotThrow(() => validateButtonAdapter({ controlId: control.id, contractVersion: 1,
        mount: async () => {} }, control));
    assert.throws(() => validateButtonAdapter({ controlId: "other", contractVersion: 1, mount() {} }, control),
        { message: "Incompatible button adapter: dialog.trigger" });
    assert.doesNotThrow(() => validateButtonInstance({ dispose() {} }));
    assert.throws(() => validateButtonInstance({}), { message: "Invalid button instance" });
});

test("generated controls retain different legacy and placed value checks and optional lifecycle", () => {
    const schema = { type: "object", properties: { impact: ["low", "high"] } };
    const root = { dataset: { contract: JSON.stringify(schema), controlType: "risk" } };
    const mount = () => {};
    assert.doesNotThrow(() => validateGeneratedControl(mount, "risk", schema, root));
    assert.throws(() => validateGeneratedControl(undefined, "risk", schema, root),
        { message: "Missing mount export" });
    assert.throws(() => validateGeneratedControl(mount, "other", schema, root),
        { message: "Incompatible control ID or value contract" });
    const placement = { control: "risk", field: "impact" };
    assert.doesNotThrow(() => validatePlacedControl(mount, "risk", schema, placement, { schema }));
    assert.throws(() => validatePlacedControl(mount, "risk", { ...schema, properties: {} }, placement, { schema }),
        { message: "Incompatible generated adapter for impact" });
    assert.doesNotThrow(() => validatePlacedControl(mount, "text", { type: "string", extra: true },
        { control: "text", field: "title" }, { schema: { type: "string" } }));
    assert.doesNotThrow(() => validateStockTextAdapter("stock.text", { type: "string" }, mount));
    assert.throws(() => validateStockTextAdapter("stock.text", { type: "string", extra: true }, mount),
        { message: "Incompatible stock.text adapter" });
    const image = { type: "image", maxBytes: 32768,
        mimeTypes: ["image/png", "image/jpeg", "image/gif", "image/webp"] };
    assert.doesNotThrow(() => validateStockImageAdapter("stock.image", mount, image));
    assert.throws(() => validateStockImageAdapter("stock.image", mount, { ...image, maxBytes: 32769 }),
        { message: "Incompatible stock.image adapter" });
    assert.doesNotThrow(() => validatePageRenderer(() => {}, "extra"));
    assert.throws(() => validatePageRenderer(undefined, "extra"), { message: "Invalid renderer for extra" });
});

test("badge evidence retains references, async methods, undeclared results and evaluator bounds", async () => {
    assert.doesNotThrow(() => validateBadgeEvaluator({ contractVersion: 1, evaluate() {} }));
    assert.throws(() => validateBadgeEvaluator({ contractVersion: 2, evaluate() {} }),
        { message: "Incompatible badge evaluator" });
    const artifact = { state: "current" }, run = { status: "Complete" }, directory = { count: 2 };
    const key = JSON.stringify(["plan", "plan.md"]);
    const evidence = badgeEvidence({ files: { [key]: artifact }, runs: { plan: run },
        directories: { [key]: directory } });
    assert.equal(await evidence.readArtifact({ phase: "plan", output: "plan.md" }), artifact);
    assert.equal(await evidence.getRun("plan"), run);
    assert.equal(await evidence.countMarkdownFiles({ phase: "plan", output: "plan.md" }), directory);
    assert.equal(await evidence.getRun("missing"), null);
    assert.deepEqual(await evidence.readArtifact({ phase: "missing" }), {
        state: "unknown", diagnostic: "Artifact was not declared for badge evaluation.",
    });
    for (const result of [{ match: false }, { match: true, values: {}, diagnostics: [], summaryCount: 1_000_000 }]) {
        assert.doesNotThrow(() => validateBadgeEvaluatorResult(result));
    }
    for (const result of [null, { match: "true" }, { match: true, values: [] },
        { match: true, summaryCount: -1 }, { match: true, summaryCount: 1_000_001 },
        { match: true, diagnostics: [1] }]) {
        assert.throws(() => validateBadgeEvaluatorResult(result), { message: "Invalid badge evaluator result" });
    }
    assert.throws(() => validateBadgeEvaluatorResult({ match: true, values: { text: "x".repeat(8192) } }),
        { message: "Badge evaluator result exceeds limit" });
});

test("provider script preserves frozen workflow argument, synchronous execution and serialized bounds", () => {
    const workflow = { id: "specs/001-demo", slug: "001-demo", label: "Demo" };
    const execute = (source) => runInContext(providerEvaluationScript(source, workflow),
        createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } }),
        { timeout: 300 });
    assert.deepEqual(JSON.parse(execute(`export function provideValue({ workflow }) {
        return { frozen: Object.isFrozen(workflow), keys: Object.keys(workflow), id: workflow.id };
    }`)), { frozen: true, keys: ["id", "slug", "label"], id: workflow.id });
    assert.throws(() => execute("export const provideValue = 1;"), { message: "provideValue must be a function" });
    assert.throws(() => execute("export async function provideValue() { return true; }"),
        { message: "Async providers are not supported" });
    assert.doesNotThrow(() => validateProviderSerializedResult("x".repeat(8192)));
    for (const value of [undefined, 1, "x".repeat(8193)]) {
        assert.throws(() => validateProviderSerializedResult(value), { message: "Invalid provider result" });
    }
});

test("typed provider results preserve validation, cloning and UserError semantics", () => {
    const schema = { type: "object", properties: { impact: ["low", "high"] } };
    const value = { impact: "low" };
    const accepted = validateValue(schema, value, "risk");
    assert.deepEqual(accepted, value);
    assert.notEqual(accepted, value);
    assert.throws(() => validateValue(schema, { impact: "other" }, "risk"),
        (error) => error instanceof UserError && error.status === 400
            && error.name === "Error" && error.message === "Invalid value for risk.");
    assert.throws(() => validateValue({ type: "string", maxLength: 3 }, "long", "title"),
        { message: "Invalid value for title." });
});

test("browser external contracts stay environment-neutral and are included in generation", async () => {
    const generator = await readFile(new URL("../extension-canvas-design/scripts/generate.mjs", import.meta.url), "utf8");
    for (const name of ["external-host-adapter", "external-generated-controls", "external-dialog-button",
        "external-badge-evaluator", "external-value-provider"]) {
        const source = await readFile(new URL(`../extension-canvas-design/generated-scaffold/contracts/${name}.mjs`,
            import.meta.url), "utf8");
        if (["external-host-adapter", "external-generated-controls", "external-dialog-button"].includes(name)) {
            assert.doesNotMatch(source, /(?:from\s*|import\s*\()\s*["'](?:node:|.*files\.mjs)/);
        }
        assert.ok(generator.includes(`"contracts/${name}.mjs"`), `${name} is copied and syntax-checked`);
    }
});
