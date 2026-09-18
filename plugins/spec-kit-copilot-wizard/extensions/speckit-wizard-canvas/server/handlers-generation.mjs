// Handle Wizard generation requests, protected snapshots, and completion callbacks.
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { compileBlueprint, BlueprintValidationError } from "../generation/compiler.mjs";
import { generationTarget, validateGenerationMetadata } from "../generation/naming.mjs";
import {
    generationFs,
    readGenerationRequest,
    validateGeneratedTemplate,
    writeGenerationRequest,
    writeGenerationResult,
} from "../generation/storage.mjs";
import { buildGenerationPrompt } from "../generation/prompt.mjs";
import { inspectGenerationExample } from "../generation/examples.mjs";
import { dispatchPromptToSession } from "../canvas-runtime/dispatch.mjs";
import { jsonError, jsonRes } from "./http-utils.mjs";

async function targetExists(path, fs) {
    try {
        await fs.stat(path);
        return true;
    } catch {
        return false;
    }
}

async function inspectSafeTarget(workspacePath, target, fs) {
    const segments = [
        workspacePath,
        join(workspacePath, ".github"),
        join(workspacePath, ".github", "extensions"),
        target.directory,
    ];
    for (const path of segments) {
        try {
            const entry = await fs.lstat(path);
            if (entry.isSymbolicLink()) {
                return { ok: false, error: { code: "target_symlink", message: `Generation target path contains a symbolic link: ${path}` } };
            }
        } catch {
            // Missing directories are valid during preflight and are created by scaffolding.
        }
    }
    return { ok: true };
}

export async function preflightGeneration(body, { getState, getInstance, fs = generationFs }, { captureExample = false } = {}) {
    const inst = getInstance();
    const workspacePath = inst?.workspacePath;
    const validation = validateGenerationMetadata(body);
    const errors = [...validation.errors];
    let target = null;
    let blueprint = null;
    let example = null;
    if (!workspacePath) {
        errors.push({ code: "workspace_unavailable", message: "Workspace path is unavailable." });
    } else if (!errors.length) {
        try {
            const snapshot = await getState();
            const setup = snapshot?.setup ?? {};
            const env = snapshot?.environment ?? {};
            const ready = (setup.pluginInstalled || env.pluginInstalled)
                && (setup.cliInstalled || env.cliInstalled)
                && setup.projectInitialized
                && setup.skillsReloaded;
            if (!ready) {
                errors.push({
                    code: "setup_incomplete",
                    message: "Complete Wizard setup and reload skills before generating a canvas.",
                });
            }
            target = generationTarget(workspacePath, validation.metadata.extensionId);
            if (!errors.length) blueprint = compileBlueprint(snapshot, validation.metadata, {
                userProvidesSlug: body?.userProvidesSlug === true,
                requireInstallationApproval: body?.requireInstallationApproval,
            });
            const safe = await inspectSafeTarget(workspacePath, target, fs);
            if (!safe.ok) errors.push(safe.error);
            if (blueprint && !errors.length) example = await inspectGenerationExample(workspacePath, snapshot, blueprint, { capture: captureExample });
        } catch (err) {
            if (err instanceof BlueprintValidationError) errors.push(...err.errors);
            else errors.push({ code: "preflight_failed", message: err?.message ?? String(err) });
        }
    }
    const exists = target ? await targetExists(target.directory, fs) : false;
    const result = {
        ok: errors.length === 0,
        errors,
        warnings: [...validation.warnings, ...(blueprint?.warnings ?? [])],
        metadata: validation.metadata,
        target,
        targetExists: exists,
        blueprint,
        example,
    };
    return result;
}

export async function handleGenerationPreflight(res, body, deps) {
    const result = await preflightGeneration(body, deps);
    return jsonRes(res, 200, result);
}

function publish(inst, generation, broadcast) {
    if (inst) inst.generation = generation;
    broadcast?.({ type: "generation", generation });
}

export async function handleGenerationStart(res, body, deps) {
    const inst = deps.getInstance();
    if (inst?.generation?.state === "queued" || inst?.generation?.state === "generating") {
        return jsonError(res, 409, "a canvas generation request is already active");
    }
    const preflight = await preflightGeneration(body, deps, { captureExample: true });
    if (!preflight.ok) return jsonRes(res, 400, preflight);
    if (preflight.targetExists && body?.overwrite !== true) {
        return jsonError(res, 409, "target exists; explicit overwrite confirmation is required");
    }

    const requestId = randomUUID();
    const createdAt = new Date().toISOString();
    const requestFile = `.speckit-wizard/generated-canvases/${requestId}/request.json`;
    const request = {
        schemaVersion: 1,
        requestId,
        createdAt,
        workspacePath: inst.workspacePath,
        overwrite: body?.overwrite === true,
        metadata: preflight.metadata,
        target: preflight.target,
        requestFile,
        blueprint: preflight.blueprint,
        example: preflight.example,
    };
    await writeGenerationRequest(inst.workspacePath, request, deps.generationFs ?? generationFs);
    const queued = {
        requestId,
        state: "queued",
        target: preflight.target.relativeDirectory,
        startedAt: createdAt,
    };
    publish(inst, queued, deps.broadcast);

    const prompt = buildGenerationPrompt({ request, callbackUrl: deps.callbackUrl });
    await dispatchPromptToSession({
        prompt,
        onError: async (err) => {
            const failed = {
                schemaVersion: 1,
                requestId,
                state: "failed",
                error: err?.message ?? String(err),
                completedAt: new Date().toISOString(),
            };
            try {
                await writeGenerationResult(inst.workspacePath, failed, deps.generationFs ?? generationFs);
            } catch { /* recovery still sees the request */ }
            if (inst?.generation?.requestId === requestId) {
                publish(inst, { ...failed, target: preflight.target.relativeDirectory }, deps.broadcast);
            }
        },
    });
    const generating = { ...queued, state: "generating" };
    publish(inst, generating, deps.broadcast);
    return jsonRes(res, 202, { requestId, target: preflight.target.relativeDirectory, generation: generating });
}

export async function handleGenerationReport(res, body, deps) {
    const requestId = body?.requestId;
    if (body?.state !== "succeeded" && body?.state !== "failed") {
        return jsonError(res, 400, "state must be succeeded or failed");
    }
    const inst = deps.getInstance();
    let request;
    try {
        request = await readGenerationRequest(inst?.workspacePath, requestId, deps.generationFs ?? generationFs);
    } catch (err) {
        return jsonError(res, 400, err?.message ?? String(err));
    }
    if (!request) return jsonError(res, 404, "generation request not found");
    if (
        inst?.generation?.requestId
        && inst.generation.requestId !== requestId
        && (inst.generation.state === "queued" || inst.generation.state === "generating")
    ) {
        return jsonError(res, 409, "generation report does not match the active request");
    }
    const fs = deps.generationFs ?? generationFs;
    if (body.state === "succeeded") {
        if (!(await targetExists(request.target?.directory, fs))) {
            return jsonError(res, 409, "generated extension target does not exist");
        }
        for (const required of ["extension.mjs", "pipeline.json", "README.md"]) {
            try {
                const entry = await fs.lstat(join(request.target.directory, required));
                if (entry.isSymbolicLink() || !entry.isFile()) throw new Error("not a regular file");
            } catch {
                return jsonError(res, 409, `generated extension is missing required file: ${required}`);
            }
        }
        try {
            await validateGeneratedTemplate(request, fs);
        } catch (err) {
            return jsonError(res, 409, err?.message ?? String(err));
        }
    }
    const result = {
        schemaVersion: 1,
        requestId,
        state: body.state,
        message: typeof body?.message === "string" ? body.message.slice(0, 1000) : null,
        error: typeof body?.error === "string" ? body.error.slice(0, 2000) : null,
        completedAt: new Date().toISOString(),
    };
    if (result.state === "failed" && !result.error) return jsonError(res, 400, "failed reports require an error");
    if (result.state === "succeeded" && request.template?.version >= 20) {
        const config = JSON.parse(await fs.readFile(join(request.target.directory, "workflow-config.json"), "utf8"));
        const note = config.artifactReview
            ? "Example-informed final-phase status labels are enabled."
            : "Standard artifact and clarification indicators retained; no tailored final-phase status labels were generated.";
        result.message = `${note}${result.message ? ` ${result.message}` : ""}`.slice(0, 1000);
    }
    await writeGenerationResult(inst.workspacePath, result, fs);
    const generation = { ...result, target: request.target?.relativeDirectory ?? null };
    publish(inst, generation, deps.broadcast);
    return jsonRes(res, 200, { ok: true, generation });
}
