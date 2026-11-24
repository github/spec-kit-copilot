import assert from "node:assert/strict";
import { test } from "node:test";
import { init, parse } from "es-module-lexer/minimal";
import { requiredExecutableExport, validateExecutableExports, validateExecutableImports } from
    "../contracts/external-executable-modules.mjs";

await init();

test("static module contracts inspect exports without executing contributor code", () => {
    for (const [kind, code] of [
        ["designer.control-adapter", "export function mount() {} export function validate() {}"],
        ["generated.control-adapter", "export function mount() {}"],
        ["generated.added-page-renderer", "export function renderPage() {}"],
        ["generated.badge-rule-adapter", "export const contractVersion = 1; export function evaluate() {}"],
        ["generated.workflow-page-adapter", "export const pageId = 'workflow'; export const contractVersion = 1; export function mount() {}"],
        ["generated.phase-control-adapter", "export const controlId = 'workflow-phases'; export const contractVersion = 1; export function mount() {}"],
        ["designer.badge-input-adapter", "export const controlId = 'custom'; export const contractVersion = 1; export function mount() {}"],
        ["generated.dialog-adapter", "export const dialogId = 'stock.dialog'; export const contractVersion = 1; export function mount() {}"],
        ["generated.button-adapter", "export const controlId = 'dialog.trigger'; export const contractVersion = 1; export function mount() {}"],
        ["generated.computed-value-provider", "export function provideValue() { throw new Error('must not execute'); }"],
    ]) {
        const item = { kind, name: "sample" }, [imports, exports] = parse(code);
        assert.doesNotThrow(() => validateExecutableImports(item, imports));
        assert.doesNotThrow(() => validateExecutableExports(item, code, exports, requiredExecutableExport(kind)));
        assert.throws(() => validateExecutableExports(item, code, [], requiredExecutableExport(kind)),
            /missing .* export/);
    }
});

test("static module contracts preserve self-contained and direct-provider-export requirements", () => {
    const item = { name: "provider", kind: "generated.computed-value-provider" };
    const [imports] = parse("import 'node:fs'; export function provideValue() {}");
    assert.throws(() => validateExecutableImports(item, imports),
        { message: "provider: computed value provider must be self-contained; module imports are not packaged" });
    const source = "function provideValue() {} export { provideValue };";
    const [, exports] = parse(source);
    assert.throws(() => validateExecutableExports(item, source, exports, "provideValue"),
        /must use a direct export/);
});
