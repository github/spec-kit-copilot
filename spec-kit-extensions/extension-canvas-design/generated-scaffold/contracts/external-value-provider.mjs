export function providerEvaluationScript(source, workflow) {
    const body = source.replace(/(^|\n)\s*export\s+(?=(?:async\s+)?function\s+provideValue\b|const\s+provideValue\b)/g, "$1");
    return `"use strict"; const workflow = Object.freeze(JSON.parse(${JSON.stringify(JSON.stringify(workflow))}));\n`
        + "const provide = (() => {\n"
        + `${body}\n`
        + "return provideValue;\n})();\n"
        + "if (typeof provide !== 'function') throw new Error('provideValue must be a function');\n"
        + "const result = provide({ workflow });\n"
        + "if (result && typeof result.then === 'function') throw new Error('Async providers are not supported');\n"
        + "JSON.stringify(result);";
}

export function validateProviderSerializedResult(serialized) {
    if (typeof serialized !== "string" || serialized.length > 8192) throw new Error("Invalid provider result");
}

export function validateValue(schema, value, id) {
    const invalid = () => { throw new UserError(`Invalid value for ${id}.`); };
    if (schema.type === "string") {
        if (typeof value !== "string" || value.length > schema.maxLength
            || value.length < (schema.minLength ?? 0)
            || (schema.pattern && !new RegExp(schema.pattern).test(value))) invalid();
    } else if (schema.type === "boolean") {
        if (typeof value !== "boolean") invalid();
    } else if (schema.type === "object") {
        if (!value || typeof value !== "object" || Array.isArray(value)
            || Object.keys(value).sort().join() !== Object.keys(schema.properties).sort().join()
            || Object.entries(schema.properties).some(([key, options]) => !options.includes(value[key]))) invalid();
    } else invalid();
    return structuredClone(value);
}
import { UserError } from "../files.mjs";
