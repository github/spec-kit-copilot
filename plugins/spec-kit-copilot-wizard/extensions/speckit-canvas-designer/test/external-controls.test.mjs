import assert from "node:assert/strict";
import { test } from "node:test";
import { validateAdapterModule, validateAdapterChange, validateAdapterHandle,
    validateBadgeInputAdapter } from
    "../ui/external-control-adapter-contract.js";

test("Designer browser control checks preserve optional methods and exact failure messages", () => {
    const expected = { type: "string" };
    const adapter = { controlId: "stock.text", valueContract: expected,
        mount() {}, validate() {} };
    assert.equal(validateAdapterModule(adapter, "stock.text", expected, false, false), undefined);
    assert.equal(validateAdapterHandle({ isReady() {} }), undefined);
    for (const [change, message] of [
        [{ mount: undefined }, "Missing mount export"],
        [{ validate: undefined }, "Missing validate export"],
        [{ controlId: "other" }, "Incompatible control ID or value contract"],
        [{ valueContract: { type: "string", extra: true } }, "Incompatible control ID or value contract"],
    ]) {
        assert.throws(() => validateAdapterModule({ ...adapter, ...change },
            "stock.text", expected, false, false), { message });
    }
    assert.throws(() => validateAdapterHandle({ update() {}, dispose() {} }),
        { message: "Missing isReady handle" });
});

test("Designer badge editors retain version and mount requirements without requiring a handle", () => {
    const binding = { control: "custom.inputs", adapter: "custom-input-adapter" };
    const adapter = { controlId: binding.control, contractVersion: 1, mount() {} };
    assert.doesNotThrow(() => validateBadgeInputAdapter(adapter, binding));
    for (const invalid of [{ ...adapter, controlId: "other" }, { ...adapter, contractVersion: 2 },
        { ...adapter, mount: undefined }]) {
        assert.throws(() => validateBadgeInputAdapter(invalid, binding),
            { message: "Incompatible Designer badge input adapter custom-input-adapter" });
    }
});

test("Designer change checks retain structural-only object and image acceptance", () => {
    for (const [rule, valid, invalid] of [
        [{ type: "string" }, "text", 1],
        [{ type: "boolean" }, false, "false"],
        [{ type: "object" }, null, []],
        [{ type: "image", maxBytes: 3 }, "12345678", "x".repeat(69)],
    ]) {
        assert.equal(validateAdapterChange(valid, rule, "sample"), undefined);
        assert.throws(() => validateAdapterChange(invalid, rule, "sample"),
            { message: "Invalid Designer setting: sample" });
    }
    assert.doesNotThrow(() => validateAdapterChange({ arbitrary: "value" },
        { type: "object" }, "sample"));
});
