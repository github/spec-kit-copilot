import { realpath } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { checkSchema } from "./external-design-contributions.mjs";
import { designerOpenInputSchema, handoffIdSchema, validateDesignerOpenInput } from "./host-open.mjs";

export const BOOTSTRAP_TOOL = "speckit_designer_bootstrap";
export const DESIGNER_PROVIDER = "plugin:spec-kit-copilot-wizard:speckit-canvas-designer";
export const DESIGNER_CANVAS = "speckit-canvas-designer";
export const DIAGNOSTIC_LIMIT = 16 * 1024 * 1024;
export const DIAGNOSTIC_ERROR_RESERVE = 16 * 1024;
export const launchReferenceSchema = {
    type: "object", additionalProperties: false,
    required: ["sourceSessionId", "sourceRoot", "handoffId", "sha256"],
    properties: {
        sourceSessionId: handoffIdSchema,
        sourceRoot: { type: "string", minLength: 1, maxLength: 4096 },
        handoffId: handoffIdSchema,
        sha256: { type: "string", pattern: "^[a-f0-9]{64}$", minLength: 64, maxLength: 64 },
    },
};
export const bootstrapInputSchema = {
    type: "object", additionalProperties: false,
    required: ["schemaVersion", "stage", "launchRef"],
    properties: {
        schemaVersion: { const: 1 },
        stage: { type: "string", enum: ["install", "finalize-open"] },
        launchRef: launchReferenceSchema,
    },
};
const TIMINGS = ["preflight", "init", "catalogs", "base", "bundles", "extensions",
    "presets", "inventory", "finalize"];
export const bootstrapOutputSchema = {
    type: "object", additionalProperties: false,
    required: ["schemaVersion", "status"],
    properties: {
        schemaVersion: { const: 1 },
        status: { type: "string", enum: ["installed", "shell-opened", "failure"] },
        handoffId: handoffIdSchema,
        instanceId: { type: "string", minLength: 1, maxLength: 160 },
        warningCount: { type: "integer", minimum: 0, maximum: 10000 },
        diagnosticsPath: { type: "string", minLength: 1, maxLength: 4096 },
        timings: { type: "object", additionalProperties: false,
            properties: Object.fromEntries(TIMINGS.map((name) =>
                [name, { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER }])) },
        error: { type: "object", additionalProperties: false, required: ["code", "message"],
            properties: {
                code: { type: "string", pattern: "^[a-z][a-z0-9_]+$", maxLength: 100 },
                message: { type: "string", minLength: 1, maxLength: 2048 },
            } },
    },
};

export class BootstrapError extends Error {
    constructor(code, message, { knownOutcome = false, cause } = {}) {
        super(message, { cause });
        this.code = code;
        this.knownOutcome = knownOutcome;
    }
}

export function validateLaunchReference(value) {
    checkSchema(value, launchReferenceSchema, "Designer launch reference");
    if (!isAbsolute(value.sourceRoot) || /[\x00-\x1f]/.test(value.sourceRoot)
        || basename(value.sourceRoot) !== value.sourceSessionId) {
        throw new BootstrapError("designer_launch_reference_invalid",
            "Designer source must be the identified session-state root, not files/ or a checkout.");
    }
    return value;
}

export function validateBootstrapInput(value) {
    checkSchema(value, bootstrapInputSchema, "Designer bootstrap");
    validateLaunchReference(value.launchRef);
    return value;
}

export function validateBootstrapOutput(value) {
    checkSchema(value, bootstrapOutputSchema, "Designer bootstrap result");
    if ((value.status === "failure") !== Object.hasOwn(value, "error")
        || (value.status !== "failure" && (!value.handoffId || !value.diagnosticsPath
            || value.warningCount === undefined || !value.timings))
        || (value.status === "shell-opened" && !value.instanceId)) {
        throw new Error("Incomplete Designer bootstrap result");
    }
    return value;
}

export function validateSetupStageResult(result, stage) {
    if (!result || result.stage !== stage || !Array.isArray(result.warnings)
        || result.warnings.some((warning) => typeof warning !== "string")
        || !result.timings || typeof result.timings !== "object" || Array.isArray(result.timings)) {
        throw new BootstrapError("designer_setup_result_invalid", `Invalid Designer ${stage} result.`);
    }
    validateBootstrapOutput({ schemaVersion: 1, status: "installed", handoffId: "check",
        warningCount: result.warnings.length, timings: result.timings, diagnosticsPath: "check" });
}

export function validateBootstrapRecord(record, reference) {
    if (!record || record.schemaVersion !== 1 || !isDeepStrictEqual(record.launchRef, reference)
        || typeof record.skillsReloaded !== "boolean" || typeof record.opening !== "boolean"
        || Object.keys(record).some((name) => !["schemaVersion", "launchRef", "skillsReloaded",
            "opening", "install", "reload", "reloadPending", "finalize", "nativeResult", "openSnapshot", "error"].includes(name))
        || (Object.hasOwn(record, "reloadPending") && record.reloadPending !== true)
        || (record.reloadPending && (!record.install || record.skillsReloaded))
        || (record.skillsReloaded && (!record.install
            || !Array.isArray(record.reload?.errors) || record.reload.errors.length
            || !Array.isArray(record.reload?.warnings)
            || record.reload.warnings.some((warning) => typeof warning !== "string")))
        || ((record.opening || record.nativeResult || record.openSnapshot)
            && (!record.skillsReloaded || record.finalize?.stage !== "ready"))) {
        throw new BootstrapError("designer_bootstrap_record_invalid",
            "Designer bootstrap record does not match this frozen launch or its stage prerequisites.");
    }
    if (record.install) validateSetupStageResult(record.install, "installed");
    return record;
}

export function assertBootstrapCapabilities(rpc) {
    if (typeof rpc?.tools?.execute !== "function"
        || typeof rpc?.canvas?.listOpen !== "function"
        || typeof rpc?.metadata?.snapshot !== "function"
        || typeof rpc?.skills?.reload !== "function") {
        throw new BootstrapError("designer_native_bridge_unavailable",
            "Designer bootstrap requires native tool invocation, canvas snapshots, session metadata, and skill reload. Update Copilot and retry.");
    }
}

export async function bootstrapSessionContext(session, invocation) {
    const metadata = await session?.rpc?.metadata?.snapshot?.();
    if (!metadata || metadata.sessionId !== session.sessionId
        || (invocation && invocation.sessionId !== metadata.sessionId)
        || !isAbsolute(metadata.workingDirectory ?? "")
        || !isAbsolute(session.workspacePath ?? "")
        || metadata.workspacePath !== session.workspacePath
        || metadata.workingDirectory === session.workspacePath) {
        throw new BootstrapError("designer_session_metadata_invalid",
            "Designer checkout and session-state root are unavailable or conflicting in native session metadata.");
    }
    let root, project;
    try {
        [root, project] = await Promise.all([
            realpath(session.workspacePath), realpath(metadata.workingDirectory),
        ]);
    } catch (cause) {
        throw new BootstrapError("designer_session_metadata_invalid",
            "Designer checkout and session-state root could not be resolved.", { cause });
    }
    if (root === project) {
        throw new BootstrapError("designer_session_metadata_invalid",
            "Designer checkout and session-state root resolve to the same directory.");
    }
    return { sessionId: metadata.sessionId, root, project };
}

export function validateFinalizeInput(input, id) {
    checkSchema(input, designerOpenInputSchema, "Designer open input");
    validateDesignerOpenInput(input);
    if (input.handoffId !== id || !Array.isArray(input.pages) || !Array.isArray(input.templates)) {
        throw new BootstrapError("designer_finalize_invalid", "Finalize did not return the complete requested Designer inventory.");
    }
    return input;
}

export function assertDiagnosticSize(value, limit = DIAGNOSTIC_LIMIT) {
    let remaining = limit;
    const ancestors = new Set();
    const invalid = () => {
        throw new BootstrapError("designer_diagnostic_invalid",
            "Designer bootstrap diagnostics must contain bounded plain JSON data.");
    };
    const take = (bytes) => {
        remaining -= bytes;
        if (remaining < 0) {
            throw new BootstrapError("designer_diagnostic_limit",
                "Designer bootstrap diagnostics exceed 16 MiB or its reserved failure budget.");
        }
    };
    const string = (text) => {
        take(Buffer.byteLength(text) + 2);
        // JSON escaping adds bytes beyond UTF-8, including for lone surrogates.
        for (const [character] of text.matchAll(/["\\\u0000-\u001f\uD800-\uDFFF]/gu)) {
            const code = character.charCodeAt(0);
            take(code >= 0xD800 ? 3 : code < 0x20 && !"\b\t\n\f\r".includes(character) ? 5 : 1);
        }
    };
    const visit = (item, depth = 0) => {
        if (typeof item === "string") return string(item);
        if (item === null || typeof item === "boolean"
            || (typeof item === "number" && Number.isFinite(item))) {
            return take(String(item).length);
        }
        if (!item || typeof item !== "object" || depth > 100 || ancestors.has(item)
            || (!Array.isArray(item) && ![Object.prototype, null].includes(Object.getPrototypeOf(item)))) {
            invalid();
        }
        const toJSON = Object.getOwnPropertyDescriptor(item, "toJSON");
        if (toJSON && (!Object.hasOwn(toJSON, "value") || typeof toJSON.value === "function")) invalid();
        ancestors.add(item);
        take(2);
        let first = true;
        const array = Array.isArray(item);
        const keys = array ? Array.prototype.keys.call(item) : Object.keys(item);
        for (const key of keys) {
            if (!first) take(1);
            first = false;
            const descriptor = Object.getOwnPropertyDescriptor(item, key);
            if (!descriptor || !Object.hasOwn(descriptor, "value")) invalid();
            if (!array) { string(key); take(1); }
            visit(descriptor.value, depth + 1);
        }
        ancestors.delete(item);
    };
    visit(value);
    return limit - remaining;
}

export function normalizeNativeOpenResult(result) {
    try {
        if (typeof result !== "string" && (!result || typeof result !== "object"
            || !["success", "failure", "timeout", "rejected", "denied"].includes(result.resultType)
            || (result.resultType === "success" && typeof result.textResultForLlm !== "string")
            || (result.textResultForLlm !== undefined && typeof result.textResultForLlm !== "string")
            || (result.error !== undefined && typeof result.error !== "string"))) {
            throw new Error("Invalid native result shape");
        }
        assertDiagnosticSize(result);
        return JSON.parse(JSON.stringify(result));
    } catch (cause) {
        throw new BootstrapError("designer_native_result_invalid",
            "Native Designer opening returned invalid or oversized JSON data.", { cause });
    }
}

export function nativeOpenText(result) {
    let text;
    if (typeof result === "string") text = result;
    else if (result && typeof result === "object"
        && ["success", "failure", "timeout", "rejected", "denied"].includes(result.resultType)) {
        if (result.resultType !== "success") {
            throw new BootstrapError(`designer_native_open_${result.resultType}`,
                String(result.error || result.textResultForLlm || "Native Designer opening failed."),
                { knownOutcome: result.resultType !== "timeout" });
        }
        text = result.textResultForLlm;
    }
    if (typeof text !== "string" || Buffer.byteLength(text) > DIAGNOSTIC_LIMIT) {
        throw new BootstrapError("designer_native_result_invalid", "Native Designer opening returned an invalid or oversized result.");
    }
    return text;
}

export function nativeOpenSnapshot(result) {
    const text = nativeOpenText(result);
    try { return JSON.parse(text); }
    catch (cause) {
        throw new BootstrapError("designer_native_result_invalid", "Native Designer opening did not return a complete JSON snapshot.", { cause });
    }
}

export function validateOpenSnapshot(snapshot, id, input) {
    if (!snapshot || snapshot.canvasId !== DESIGNER_CANVAS
        || snapshot.extensionId !== DESIGNER_PROVIDER
        || snapshot.instanceId !== `designer-${id}`
        || !isDeepStrictEqual(snapshot.input, input)) {
        throw new BootstrapError("designer_native_result_mismatch",
            "Native Designer opening returned a different provider, canvas, instance, or complete handoff input.");
    }
    return snapshot;
}
