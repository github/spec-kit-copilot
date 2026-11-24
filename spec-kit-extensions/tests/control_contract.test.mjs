import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { validControlContract, validControlValue } from "../extension-canvas-design/generated-scaffold/external-control-contract.mjs";
import * as designer from "../../plugins/spec-kit-copilot-wizard/extensions/speckit-canvas-designer/external-control-contract.mjs";

const source = new URL("../extension-canvas-design/generated-scaffold/external-control-contract.mjs", import.meta.url);
const packaged = new URL("../../plugins/spec-kit-copilot-wizard/extensions/speckit-canvas-designer/external-control-contract.mjs",
    import.meta.url);

test("Designer and generated control contract packages retain identical source", async () => {
    assert.deepEqual(await readFile(packaged), await readFile(source));
});

test("all hosts accept the same contracts and typed values", () => {
    const valid = { type: "object", properties: { impact: ["low", "medium", "high"] } };
    const value = { impact: "medium" };
    const contracts = [
        valid,
        { ...valid, properties: Object.fromEntries(Array.from({ length: 11 },
            (_, index) => [`key${index}`, ["low"]])) },
        { ...valid, properties: { impact: ["low", "low"] } },
        { ...valid, properties: { impact: ["low", 1] } },
        { ...valid, properties: { impact: [null] } },
        { ...valid, properties: { impact: [""] } },
        { ...valid, properties: { impact: ["x".repeat(81)] } },
        { ...valid, properties: { impact: Array.from({ length: 21 }, (_, index) => `${index}`) } },
        { ...valid, properties: { "bad-key": ["low"] } },
    ];
    for (const [index, contract] of contracts.entries()) {
        for (const host of [{ validControlContract, validControlValue }, designer]) {
            assert.equal(host.validControlContract(contract), index === 0);
            assert.equal(host.validControlValue(value, contract), index === 0);
        }
    }
    for (const invalid of [{ impact: 1 }, { impact: "other" }, { impact: "low", extra: "low" }, {}]) {
        assert.equal(validControlValue(invalid, valid), false);
        assert.equal(designer.validControlValue(invalid, valid), false);
    }
});
