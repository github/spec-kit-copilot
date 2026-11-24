import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { validatePendingOutputs, validatePhaseOutputs } from "./wizard-handoff.mjs";

export const INFERENCE_SKILL_LIMIT = 512 * 1024;
export const INFERENCE_INPUT_LIMIT = 4 * 1024 * 1024;
export const INFERENCE_RESULT_LIMIT = 1024 * 1024;

const HASH = /^[a-f0-9]{64}$/;
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const digest = (value) => createHash("sha256").update(value).digest("hex");

const candidateSchema = {
    type: "object", additionalProperties: false,
    required: ["kind", "source", "effect", "evidence"],
    properties: {
        kind: { type: "string", enum: ["file", "folder", "none", "unknown"] },
        source: { const: "inference" },
        effect: { type: "string", enum: ["creates", "updates", "unknown"] },
        evidence: { type: "string", minLength: 1, maxLength: 500 },
        path: { type: "string", maxLength: 1000 },
        relativeTo: { const: "feature" },
        root: { type: "object", additionalProperties: false, required: ["name"],
            properties: { name: { type: "string", maxLength: 64 },
                path: { type: "string", maxLength: 1000 } } },
        contributors: { type: "array", maxItems: 6, items: {
            type: "object", additionalProperties: false, required: ["layer"],
            properties: { layer: { type: "string", enum: ["core", "preset", "extension"] },
                id: { type: "string", maxLength: 100 } },
        } },
    },
};

export const inferenceSubmissionSchema = {
    type: "object", additionalProperties: false, required: ["entries"],
    properties: {
        entries: { type: "array", minItems: 1, maxItems: 30, items: {
            type: "object", additionalProperties: false,
            required: ["commandId", "fingerprint", "candidates", "primaryIndex"],
            properties: {
                commandId: { type: "string", minLength: 1, maxLength: 100 },
                fingerprint: { type: "string", pattern: "^[a-f0-9]{64}$", minLength: 64, maxLength: 64 },
                candidates: { type: "array", minItems: 1, maxItems: 12, items: candidateSchema },
                primaryIndex: { anyOf: [{ type: "integer", minimum: 0, maximum: 11 }, { type: "null" }] },
            },
        } },
    },
};

export function validateInferenceInput(input, handoff) {
    const pending = handoff.workflow.pendingOutputs;
    validatePendingOutputs(pending, handoff.workflow);
    if (!record(input) || Object.keys(input).sort().join() !== "commands,schemaVersion,workspacePath"
        || input.schemaVersion !== 1 || typeof input.workspacePath !== "string"
        || !isAbsolute(input.workspacePath) || input.workspacePath.length > 4096
        || /[\x00-\x1f\x7f]/.test(input.workspacePath)
        || !Array.isArray(input.commands) || input.commands.length !== pending.commands.length
        || Buffer.byteLength(JSON.stringify(input)) > INFERENCE_INPUT_LIMIT) {
        throw new Error("Invalid Designer inference inputs");
    }
    let skillBytes = 0;
    for (const [index, item] of input.commands.entries()) {
        const expected = pending.commands[index];
        if (!record(item)
            || Object.keys(item).sort().join() !== "commandId,fingerprint,phase,skillPath,sources,text"
            || item.phase !== expected.phase || item.commandId !== expected.commandId
            || item.fingerprint !== expected.fingerprint
            || typeof item.skillPath !== "string"
            || item.skillPath !== `.github/skills/${item.commandId.replaceAll(".", "-")}/SKILL.md`
            || typeof item.text !== "string" || !Array.isArray(item.sources)
            || !item.sources.length || item.sources.length > 25) {
            throw new Error("Invalid Designer inference inputs");
        }
        skillBytes += Buffer.byteLength(item.text);
        const paths = new Set();
        for (const [sourceIndex, source] of item.sources.entries()) {
            if (!record(source) || Object.keys(source).sort().join() !== "path,sha256"
                || typeof source.path !== "string" || paths.has(source.path)
                || (sourceIndex === 0 ? source.path !== item.skillPath
                    : !/^\.specify\/scripts\/[\w./-]+\.(?:ps1|sh|py)$/.test(source.path))
                || source.path.split("/").some((part) => !part || part === "." || part === "..")
                || (source.sha256 !== null && !HASH.test(source.sha256 ?? ""))
                || (sourceIndex === 0 && source.sha256 !== digest(item.text))) {
                throw new Error("Invalid Designer inference source");
            }
            paths.add(source.path);
        }
        if (digest(JSON.stringify({ version: 1, sources: item.sources })) !== item.fingerprint) {
            throw new Error(`Designer inference source fingerprint mismatch for ${item.commandId}`);
        }
    }
    if (skillBytes > INFERENCE_SKILL_LIMIT) throw new Error("Designer inference skill text exceeds 512 KiB");
    return input;
}

export async function validateInferenceSubmission(submission, handoff) {
    const pending = handoff.workflow.pendingOutputs;
    validatePendingOutputs(pending, handoff.workflow);
    if (!record(submission) || Object.keys(submission).join() !== "entries"
        || !Array.isArray(submission.entries) || submission.entries.length !== pending.commands.length
        || Buffer.byteLength(JSON.stringify(submission)) > INFERENCE_RESULT_LIMIT) {
        throw new Error("Invalid Designer inference result");
    }
    const { validateAgentArtifactEvidence } = await import("../../speckit-wizard-canvas/contracts/agent-artifacts.mjs");
    const entries = new Map();
    for (const item of submission.entries) {
        if (!record(item) || Object.keys(item).sort().join() !== "candidates,commandId,fingerprint,primaryIndex"
            || typeof item.commandId !== "string" || entries.has(item.commandId)) {
            throw new Error("Invalid Designer inference result");
        }
        const expected = pending.commands.find((command) => command.commandId === item.commandId);
        if (!expected || item.fingerprint !== expected.fingerprint) {
            throw new Error(`Unexpected command or fingerprint in Designer inference result: ${item.commandId}`);
        }
        const evidence = validateAgentArtifactEvidence(item, expected.fingerprint);
        entries.set(item.commandId, { commandId: item.commandId, ...evidence });
    }
    if (entries.size !== pending.commands.length) throw new Error("Missing Designer inference results");
    return { entries: pending.commands.map(({ commandId }) => entries.get(commandId)) };
}

export function outputsFromEvidence(evidence) {
    const candidates = evidence?.candidates ?? [];
    const paths = candidates.map((candidate) => {
        if (candidate?.kind !== "file" || typeof candidate.path !== "string") return null;
        if (candidate.relativeTo === "feature") return `specs/<slug>/${candidate.path}`;
        if (candidate.root) return candidate.root.path
            ? `${candidate.root.path}/${candidate.path}` : null;
        return candidate.path;
    });
    const seen = new Set();
    const outputs = paths.filter((path) => {
        if (!path || seen.has(path.toLowerCase())) return false;
        seen.add(path.toLowerCase());
        return true;
    });
    const preferred = paths[evidence?.primaryIndex];
    return { outputs,
        view: outputs.find((path) => path.toLowerCase() === preferred?.toLowerCase())
            ?? outputs[0] ?? null };
}

export async function mergeInferenceOutputs(handoff, submission) {
    const validated = await validateInferenceSubmission(submission, handoff);
    const entries = new Map(validated.entries.map((entry) => [entry.commandId, entry]));
    const outputs = { ...handoff.workflow.outputEvidence };
    for (const { phase, commandId } of handoff.workflow.pendingOutputs.commands) {
        outputs[phase] = outputsFromEvidence(entries.get(commandId));
    }
    return validatePhaseOutputs(outputs, handoff.workflow.selectedPhases);
}
