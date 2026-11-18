import { Script } from "node:vm";

export function requiredExecutableExport(kind) {
    return kind === "generated.added-page-renderer" ? "renderPage"
        : kind === "generated.badge-rule-adapter" ? "evaluate"
        : kind === "generated.phase-control-adapter" ? "mount"
        : kind === "generated.computed-value-provider" ? "provideValue" : "mount";
}

export function validateExecutableImports(item, imports) {
    if (imports.some((entry) => entry.d !== -2)) {
        throw new Error(`${item.name}: ${item.kind === "generated.added-page-renderer"
            ? "generated renderer" : item.kind === "generated.computed-value-provider"
                ? "computed value provider" : "control adapter"} must be self-contained; module imports are not packaged`);
    }
}

export function validateExecutableExports(item, document, exports, requiredExport) {
    if (!exports.some((entry) => entry.n === requiredExport)) {
        throw new Error(`${item.name}: invalid ${item.kind === "generated.added-page-renderer"
            ? "generated renderer" : item.kind}: missing ${requiredExport} export`);
    }
    if (["generated.dialog-adapter", "generated.button-adapter"].includes(item.kind)
        && (!exports.some((entry) => entry.n === "contractVersion")
            || !exports.some((entry) => entry.n === (item.kind === "generated.dialog-adapter"
                ? "dialogId" : "controlId")))) {
        throw new Error(`${item.name}: adapter is missing contractVersion or identity export`);
    }
    if (item.kind === "generated.workflow-page-adapter"
        && (!exports.some((entry) => entry.n === "pageId")
            || !exports.some((entry) => entry.n === "contractVersion"))) {
        throw new Error(`${item.name}: Workflow page adapter is missing pageId or contractVersion export`);
    }
    if (item.kind === "generated.phase-control-adapter"
        && (!exports.some((entry) => entry.n === "controlId")
            || !exports.some((entry) => entry.n === "contractVersion"))) {
        throw new Error(`${item.name}: phase control adapter is missing controlId or contractVersion export`);
    }
    if (item.kind === "designer.control-adapter"
        && !exports.some((entry) => entry.n === "validate")) {
        throw new Error(`${item.name}: Designer adapter is missing validate export`);
    }
    if (item.kind === "generated.badge-rule-adapter"
        && !exports.some((entry) => entry.n === "contractVersion")) {
        throw new Error(`${item.name}: badge adapter is missing contractVersion export`);
    }
    if (item.kind === "designer.badge-input-adapter"
        && (!exports.some((entry) => entry.n === "contractVersion")
            || !exports.some((entry) => entry.n === "controlId"))) {
        throw new Error(`${item.name}: Designer badge input adapter is missing contractVersion or controlId export`);
    }
    if (item.kind === "generated.computed-value-provider") {
        const declarations = [...document.matchAll(/(^|\n)\s*export\s+(?:(?:async\s+)?function|const)\s+provideValue\b/g)];
        if (exports.length !== 1 || declarations.length !== 1
            || declarations[0].index + declarations[0][0].lastIndexOf("provideValue")
                !== exports[0].s) {
            throw new Error(`${item.name}: value provider must use a direct export function provideValue or export const provideValue declaration; named re-exports are not supported`);
        }
        const body = document.replace(
            /(^|\n)\s*export\s+(?=(?:async\s+)?function\s+provideValue\b|const\s+provideValue\b)/g, "$1");
        try {
            new Script(`"use strict"; const workflow = null;\nconst provide = (() => {\n${body}\n`
                + "return provideValue;\n})();\n"
                + "if (typeof provide !== 'function') throw new Error('provideValue must be a function');\n"
                + "const result = provide({ workflow });\n"
                + "if (result && typeof result.then === 'function') throw new Error('Async providers are not supported');\n"
                + "JSON.stringify(result);");
        } catch (error) {
            throw new Error(`${item.name}: value provider cannot run as a generated script: ${error.message}`,
                { cause: error });
        }
    }
}
