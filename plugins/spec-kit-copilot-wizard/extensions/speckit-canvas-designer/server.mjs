import { randomBytes, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { readResolvedHandoff } from "./bootstrap-artifacts.mjs";
import { validateBadges } from "./contracts/external-badges.mjs";
import { validateBadgeImport } from "./contracts/badge-import.mjs";
import { BADGE_IMPORT_REQUEST_LIMIT, validateBadgeImportRequest, validateBadgeImportResponse }
    from "./ui/badge-import-contract.js";
import { GENERATION_EXISTS, GENERATION_PENDING, generationAvailability,
    validateGenerateSubmission } from "./contracts/generation-request.mjs";
import { readFrozenAsset } from "./pages.mjs";
import { validateConfirmedOutputs } from "./handoff.mjs";
import { SAVE_REQUEST_LIMIT, SETTINGS_LIMIT, initialOutputs,
    loadDesignerSettings, saveDesignerSettings } from "./settings.mjs";
import { freezeGeneration, generationBlockers, readCurrentInstalledVersions } from "./generation.mjs";
import { generatedOutput, validateOutputAction } from "./contracts/generated-output.mjs";
import { validateOutputStatusResponse, validateRevealResponse, validateOpenResponse,
    validateOutputError, validateGenerateResponse } from "./ui/generated-output-state.js";

export function shellHtml() {
    return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Canvas Designer</title>
<style>
    body { margin: 0; background: var(--background-color-default, #fff);
        color: var(--text-color-default, #1f2328);
        font: var(--text-body-medium, 14px)/var(--leading-body-medium, 20px)
            var(--font-sans, system-ui, sans-serif); }
    main { padding: 28px; max-width: 560px; }
    h1 { font-size: var(--text-title-large, 26px); line-height: var(--leading-title-large, 32px); }
    p { color: var(--text-color-muted, #59636e); }
</style>
</head>
<body><main><h1>Canvas Designer</h1>
<p>No Wizard handoff is attached yet.</p>
<p>Launch Designer from the Wizard to prepare a project and load its settings pages.</p>
</main></body></html>`;
}

const ASSETS = {
    "/": ["index.html", "text/html"],
    "/ui/styles.css": ["styles.css", "text/css"],
    "/ui/app.js": ["app.js", "text/javascript"],
    "/ui/generation-state.js": ["generation-state.js", "text/javascript"],
    "/ui/generated-output-state.js": ["generated-output-state.js", "text/javascript"],
    "/ui/identity-control.js": ["identity-control.js", "text/javascript"],
    "/ui/output-evidence.js": ["output-evidence.js", "text/javascript"],
    "/ui/external-control-adapter-contract.js": ["external-control-adapter-contract.js", "text/javascript"],
    "/ui/badge-selection-contract.js": ["badge-selection-contract.js", "text/javascript"],
    "/ui/badges-control.js": ["badges-control.js", "text/javascript"],
    "/ui/badge-duplicates.js": ["badge-duplicates.js", "text/javascript"],
    "/ui/badge-import-contract.js": ["badge-import-contract.js", "text/javascript"],
};
const GENERATE_SKILL = "speckit-extension-canvas-design-generate";
const OPEN_SKILL = "speckit-extension-canvas-design-open-generated";
const GENERATE_UNAVAILABLE = "Canvas Design does not provide Generate in this session. Launch a new Designer session with a compatible Canvas Design extension or the current local source.";
const SPLIT_UNAVAILABLE = "Canvas Design does not provide separate Generate and Open commands in this session. Install the current local Canvas Design source before generating.";

async function hasProjectSkill(project, name) {
    try {
        return (await stat(join(project, ".github", "skills", name, "SKILL.md"))).isFile();
    } catch (error) {
        if (error.code === "ENOENT") return false;
        throw error;
    }
}

function queueChildPrompt(response, session, prompt, action) {
    response.once("finish", () => setImmediate(() => {
        void Promise.resolve().then(() => session.send({ prompt })).catch(async (error) => {
            const message = `Canvas Designer ${action} dispatch failed: ${error.message}`;
            if (!session.log) {
                console.error(message);
                return;
            }
            try { await session.log(message, { level: "error" }); }
            catch (logError) { console.error(message, logError); }
        });
    }));
}

export async function startShell(handoff = null, model = null,
    { project, workspace, session, preview = false, launchFolder = spawn } = {}) {
    if (preview && (handoff || !model)) {
        throw new Error("Designer preview requires a sample model and no Wizard handoff");
    }
    if (handoff && !model) throw new Error("Designer pages must be validated before opening");
    if (handoff && (typeof workspace !== "string" || !workspace.trim())) {
        throw new Error("Designer session workspace is required to save settings");
    }
    const assets = (handoff || preview)
        ? new Map(await Promise.all(Object.entries(ASSETS).map(async ([path, [file, type]]) =>
            [path, { type, content: await readFile(new URL(`./ui/${file}`, import.meta.url), "utf8") }])))
        : new Map([["/", { type: "text/html", content: shellHtml() }]]);
    if (model) {
        const adapters = Object.values(model.adapters ?? {});
        const badgeAdapters = [...new Set((model.badgeInputControls ?? [])
            .map((item) => item.adapter))];
        if ((adapters.length || badgeAdapters.length) && !project && !preview) {
            throw new Error("Designer project is required for adapters");
        }
        const specify = project && (adapters.length || badgeAdapters.length)
            ? join(await realpath(project), ".specify") : null;
        for (const name of adapters) {
            const adapter = model.templates.find((item) => item.name === name
                && item.kind === "designer.control-adapter");
            if (!adapter) throw new Error(`${name}: Designer adapter is unavailable`);
            assets.set(`/adapters/${name}.mjs`, {
                type: "text/javascript", content: await readFrozenAsset(adapter, specify),
            });
        }
        for (const name of badgeAdapters) {
            if (preview && name === "preview-badge-input") {
                assets.set(`/adapters/${name}.mjs`, { type: "text/javascript",
                    content: await readFile(new URL("./ui/preview-badge-input.js",
                        import.meta.url), "utf8") });
                continue;
            }
            const adapter = model.templates.find((item) => item.name === name
                && item.kind === "designer.badge-input-adapter");
            if (!adapter) throw new Error(`${name}: Designer badge input adapter is unavailable`);
            assets.set(`/adapters/${name}.mjs`, {
                type: "text/javascript", content: await readFrozenAsset(adapter, specify),
            });
        }
    }
    const token = randomBytes(24).toString("hex");
    const generateSkillAvailable = project ? await hasProjectSkill(project, GENERATE_SKILL) : false;
    const openSkillAvailable = project ? await hasProjectSkill(project, OPEN_SKILL) : false;
    const skillAvailable = generateSkillAvailable && openSkillAvailable;
    const generationError = handoff?.workflow?.installed && project && !skillAvailable
        ? generateSkillAvailable ? SPLIT_UNAVAILABLE : GENERATE_UNAVAILABLE : null;
    const assertCurrentHandoff = async (action) => {
        const current = await readResolvedHandoff(workspace, handoff.handoffId);
        if (current.sourceFingerprint !== handoff.sourceFingerprint) {
            throw new Error(`Designer handoff changed; reopen before ${action}`);
        }
        if (current.outputResultHash !== handoff.outputResultHash) {
            throw new Error(`Designer inferred outputs changed; reopen before ${action}`);
        }
    };
    const state = async () => {
        const availability = generationAvailability(generating, false);
        return { ...model, badges: model?.badges ?? [],
            generationBlockers: model ? generationBlockers(model) : [],
            phases: handoff?.workflow.selectedPhases ?? model?.phases ?? [],
            pipelineOutputs: handoff ? initialOutputs(handoff) : model?.pipelineOutputs ?? {},
            handoffId: handoff?.handoffId,
            preview,
            generationAvailable: !!handoff?.workflow?.installed && !!session?.send
                && !!project && skillAvailable && availability.available
                && generationBlockers(model).length === 0,
            generationError: generationError ?? availability.error };
    };
    let generating = false;
    const server = createServer(async (req, res) => {
        let url;
        try {
            url = new URL(req.url, "http://127.0.0.1");
        } catch {
            res.writeHead(404).end();
            return;
        }
        const supplied = url.searchParams.get("token");
        const actual = typeof supplied === "string" ? Buffer.from(supplied) : Buffer.alloc(0);
        const expected = Buffer.from(token);
        if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
            res.writeHead(404).end();
            return;
        }
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Content-Security-Policy",
            "default-src 'none'; script-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'none'");
        if (preview && req.method === "POST"
            && ["/api/save", "/api/generate", "/api/reveal-output", "/api/open-generated",
                "/api/validate-badge-import"].includes(url.pathname)) {
            res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" })
                .end(JSON.stringify({ error: "Preview cannot save settings or generate a canvas" }));
            return;
        }
        if (handoff && project && req.method === "POST" && url.pathname === "/api/validate-badge-import") {
            const send = (status, body) => res.writeHead(status,
                { "Content-Type": "application/json; charset=utf-8" }).end(JSON.stringify(body));
            if (!req.headers["content-type"]?.startsWith("application/json")) {
                send(415, { error: "Expected application/json" });
                return;
            }
            try {
                const chunks = [];
                let size = 0;
                for await (const chunk of req) {
                    size += chunk.length;
                    if (size > BADGE_IMPORT_REQUEST_LIMIT) {
                        send(413, { error: "Designer badge import request is too large" });
                        return;
                    }
                    chunks.push(chunk);
                }
                const input = validateBadgeImportRequest(JSON.parse(Buffer.concat(chunks).toString("utf8")));
                if (input.modelRevision !== model.revision) {
                    send(409, { error: "Designer pages changed; reopen before importing badges" });
                    return;
                }
                const outputs = validateConfirmedOutputs(input.outputs,
                    handoff.workflow.selectedPhases, initialOutputs(handoff));
                const badges = validateBadgeImport(input.config, input.badges,
                    { ...model, phases: handoff.workflow.selectedPhases, outputs });
                const specify = await realpath(join(project, ".specify"));
                for (const name of new Set(input.config.badges.rules.map((rule) => rule.adapter))) {
                    await readFrozenAsset(model.templates.find((item) =>
                        item.kind === "generated.badge-rule-adapter" && item.name === name), specify);
                }
                send(200, validateBadgeImportResponse({ schemaVersion: 1, badges },
                    [...input.badges, ...input.config.badges.instances]));
            } catch (error) {
                send(422, { error: error instanceof SyntaxError
                    ? "Invalid badge import JSON" : error.message });
            }
            return;
        }
        if (handoff && workspace && req.method === "POST" && url.pathname === "/api/save") {
            const sendError = (status, message) => {
                res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
                res.end(JSON.stringify({ error: message }));
            };
            if (!req.headers["content-type"]?.startsWith("application/json")) {
                sendError(415, "Expected application/json");
                return;
            }
            try {
                if (!model.pages.length) throw new Error("Invalid Designer save: no pages are registered");
                const chunks = [];
                let size = 0;
                for await (const chunk of req) {
                    size += chunk.length;
                    if (size > SAVE_REQUEST_LIMIT) {
                        sendError(413, "Designer save request is too large");
                        return;
                    }
                    chunks.push(chunk);
                }
                const request = JSON.parse(Buffer.concat(chunks).toString("utf8"));
                await assertCurrentHandoff("saving");
                model = await saveDesignerSettings(workspace, handoff, model, request);
                res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
                res.end(JSON.stringify(await state()));
            } catch (error) {
                const invalid = error instanceof SyntaxError
                    || /Invalid Designer|Invalid outputs for phase|unexpected or missing fields|Pipeline artifacts cannot be changed|Constitution output is fixed/.test(error.message);
                const conflict = [
                    "Designer handoff changed; reopen before saving",
                    "Designer inferred outputs changed; reopen before saving",
                    "Designer settings changed elsewhere. Copy any unsaved edits, then close and reopen Designer before saving.",
                    "Saved Designer settings do not match the current handoff or pages",
                ].includes(error.message);
                const oversized = error.message === "Designer settings exceed the size limit";
                sendError(conflict ? 409 : oversized ? 413 : invalid ? 422 : 500, error.message);
            }
            return;
        }
        if (handoff && req.method === "GET" && url.pathname === "/api/output-status") {
            try {
                const result = await generatedOutput(project,
                    url.searchParams.get("canvasId"), handoff.handoffId);
                res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" })
                    .end(JSON.stringify(validateOutputStatusResponse(result,
                        url.searchParams.get("canvasId"))));
            } catch (error) {
                res.writeHead(error.code ? 500 : 422, { "Content-Type": "application/json; charset=utf-8" })
                    .end(JSON.stringify(validateOutputError({ error: error.message })));
            }
            return;
        }
        if (handoff && req.method === "POST"
            && ["/api/reveal-output", "/api/open-generated"].includes(url.pathname)) {
            try {
                if (req.headers.origin && req.headers.origin !== `http://127.0.0.1:${server.address().port}`) {
                    throw new Error("Untrusted generated canvas request origin");
                }
                if (!req.headers["content-type"]?.startsWith("application/json")) {
                    throw new Error("Expected JSON generated canvas action");
                }
                const chunks = [];
                let size = 0;
                for await (const chunk of req) {
                    size += chunk.length;
                    if (size > 1024) throw new Error("Generated canvas action exceeds 1 KiB");
                    chunks.push(chunk);
                }
                const input = validateOutputAction(JSON.parse(Buffer.concat(chunks).toString("utf8")));
                const output = await generatedOutput(project, input.canvasId, handoff.handoffId);
                if (url.pathname === "/api/open-generated") {
                    if (output.status !== "ready") {
                        throw new Error(`Cannot open canvas: target is ${output.status}. Generate the canvas files first.`);
                    }
                    if (!session?.send) throw new Error("Generated canvas opening is unavailable in this session");
                    if (!await hasProjectSkill(project, OPEN_SKILL)) {
                        throw new Error("Canvas Design does not provide Open in this child session. Install the current local Canvas Design source before opening.");
                    }
                    const accepted = validateOpenResponse(
                        { status: "opening", target: output.target }, input.canvasId);
                    queueChildPrompt(res, session,
                        `Invoke the installed speckit-extension-canvas-design-open-generated skill with handoffId "${handoff.handoffId}", requestId "${output.requestId}" and canvasId "${input.canvasId}" in this child checkout. Reload extensions, verify and open only that generated project canvas. Do not regenerate files. Report success or the exact failure to the user in chat.`,
                        "Open");
                    res.writeHead(202, { "Content-Type": "application/json; charset=utf-8" })
                        .end(JSON.stringify(accepted));
                } else {
                    const root = await realpath(project);
                    const github = join(root, ".github");
                    await mkdir(github, { recursive: true });
                    if (await realpath(github) !== github) {
                        throw new Error("Generated extension folder escapes the checkout");
                    }
                    const parent = join(github, "extensions");
                    await mkdir(parent, { recursive: true });
                    if (await realpath(parent) !== parent) {
                        throw new Error("Generated extension folder escapes the checkout");
                    }
                    if (output.status === "foreign") {
                        throw new Error("Generated canvas folder is not safe to reveal");
                    }
                    const target = output.status === "absent" ? parent : join(parent, input.canvasId);
                    const command = process.platform === "win32" ? "explorer.exe"
                        : process.platform === "darwin" ? "open" : "xdg-open";
                    const child = launchFolder(command, [target], { detached: true, stdio: "ignore" });
                    await new Promise((resolve, reject) => {
                        child.once("error", reject);
                        child.once("spawn", resolve);
                    });
                    child.unref();
                    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" })
                        .end(JSON.stringify(validateRevealResponse({
                            target: output.status === "absent" ? ".github/extensions/" : output.target,
                        }, input.canvasId)));
                }
            } catch (error) {
                res.writeHead(422, { "Content-Type": "application/json; charset=utf-8" })
                    .end(JSON.stringify(validateOutputError({ error: error.message })));
            }
            return;
        }
        if (handoff && req.method === "POST" && url.pathname === "/api/generate") {
            if (!session?.send || !project || !workspace) {
                res.writeHead(503, { "Content-Type": "application/json; charset=utf-8" })
                    .end(JSON.stringify({ error: "Generation dispatch is unavailable" }));
                return;
            }
            if (generating) {
                res.writeHead(409, { "Content-Type": "application/json; charset=utf-8" })
                    .end(JSON.stringify({ error: GENERATION_PENDING }));
                return;
            }
            generating = true;
            try {
                if (req.headers.origin && req.headers.origin !== `http://127.0.0.1:${server.address().port}`) {
                    throw new Error("Untrusted generation request origin");
                }
                if (!req.headers["content-type"]?.startsWith("application/json")) {
                    throw new Error("Expected JSON Designer settings");
                }
                const blockers = generationBlockers(model);
                if (blockers.length) throw new Error(`Cannot generate: ${blockers.join("; ")}`);
                const chunks = [];
                let size = 0;
                for await (const chunk of req) {
                    size += chunk.length;
                    if (size > SETTINGS_LIMIT) throw new Error("Generation request exceeds 1 MiB");
                    chunks.push(chunk);
                }
                const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
                validateGenerateSubmission(input, model);
                await assertCurrentHandoff("generating");
                const currentGenerateSkill = await hasProjectSkill(project, GENERATE_SKILL);
                if (!currentGenerateSkill || !await hasProjectSkill(project, OPEN_SKILL)) {
                    res.writeHead(409, { "Content-Type": "application/json; charset=utf-8" })
                        .end(JSON.stringify({ error: currentGenerateSkill ? SPLIT_UNAVAILABLE
                            : GENERATE_UNAVAILABLE }));
                    return;
                }
                const current = await loadDesignerSettings(workspace, handoff, model);
                if (input.settingsRevision !== current.settingsRevision) {
                    throw new Error("Designer settings changed elsewhere. Copy any unsaved edits, then close and reopen Designer before generating.");
                }
                if (!current.persisted || !isDeepStrictEqual(input.values, current.values)
                    || (Object.hasOwn(input, "outputs") && !isDeepStrictEqual(input.outputs, current.outputs))
                    || (Object.hasOwn(input, "badges") && !isDeepStrictEqual(input.badges, current.badges))) {
                    throw new Error("Designer settings changed elsewhere. Save the current settings before generating.");
                }
                const output = await generatedOutput(project, current.values["canvas.id"], handoff.handoffId);
                const authorized = output.status === "absent"
                    ? input.replaceExisting !== true
                    : output.status === "ready" && input.replaceExisting === true
                        && input.replaceRequestId === output.requestId;
                if (!authorized) {
                    res.writeHead(409, { "Content-Type": "application/json; charset=utf-8" })
                        .end(JSON.stringify({ error: output.status === "absent"
                            ? "Canvas is absent; refresh its status and generate without replacement."
                            : output.status === "ready"
                                ? input.replaceExisting === true
                                    ? "Canvas changed since replacement was confirmed; review and confirm again."
                                    : GENERATION_EXISTS
                                : `Cannot replace ${output.status} canvas output; inspect the target folder first.` }));
                    return;
                }
                validateBadges(current.badges, { ...current, phases: handoff.workflow.selectedPhases });
                const providers = (model.templates ?? []).filter((item) => item.kind === "generated.computed-value-provider")
                    .map(({ name, sourceId, hash }) => ({ name, sourceId, hash }));
                if (providers.length) {
                    if (!Array.isArray(input.approvedProviders)
                        || JSON.stringify(input.approvedProviders) !== JSON.stringify(providers)) {
                        throw new Error("Provider approval does not match the resolved names, sources and hashes; review and confirm again");
                    }
                    const specify = join(await realpath(project), ".specify");
                    for (const item of (model.templates ?? []).filter((entry) => entry.kind === "generated.computed-value-provider")) {
                        await readFrozenAsset(item, specify);
                    }
                }
                let runtimeInventory, inventoryWarning;
                try {
                    const observed = await readCurrentInstalledVersions(project, handoff.workflow.installed);
                    runtimeInventory = observed.inventory;
                    inventoryWarning = observed.warnings.length
                        ? `${observed.warnings.join(" ")} Affected versions will be marked unverified.` : undefined;
                } catch (error) {
                    runtimeInventory = { presets: [], extensions: [], bundles: [] };
                    inventoryWarning = `Could not read the installed Specify packages: ${error.message}. Generated package versions will be marked unverified.`;
                }
                const result = validateGenerateResponse(await freezeGeneration({ model: current, values: current.values,
                    outputs: current.outputs, badges: current.badges,
                    handoff, project, workspace, runtimeInventory, inventoryWarning,
                    replaceExisting: input.replaceExisting === true }), current.values["canvas.id"]);
                queueChildPrompt(res, session,
                    `Invoke the installed speckit-extension-canvas-design-generate skill with handoffId "${handoff.handoffId}" and requestId "${result.requestId}". ${input.replaceExisting === true ? `The user explicitly confirmed replacing the existing same-handoff canvas folder, including manual edits, with prior requestId "${input.replaceRequestId}"; pass --replace-existing=${input.replaceRequestId} to the generator and stop if the prior request changed.` : "Do not replace any existing target."} Follow its entire composed command. The prepared request is immutable; do not change settings or substitute another checkout. Report file creation or the exact failure to the user; do not reload extensions or open the canvas.`,
                    "Generate");
                res.writeHead(202, { "Content-Type": "application/json; charset=utf-8" })
                    .end(JSON.stringify(result));
            } catch (error) {
                const status = error.code ? 500 : error.message.startsWith("Designer settings changed elsewhere.")
                        || error.message === "Designer handoff changed; reopen before generating"
                        || error.message === "Designer inferred outputs changed; reopen before generating"
                        || error.message.startsWith("Canvas already exists:") ? 409 : 422;
                res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" })
                    .end(JSON.stringify(validateOutputError({ error: error.message })));
            } finally {
                generating = false;
            }
            return;
        }
        if (req.method !== "GET") { res.writeHead(404).end(); return; }
        if ((handoff || preview) && url.pathname === "/api/state") {
            try {
                const current = await state();
                res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
                res.end(JSON.stringify(current));
            } catch (error) {
                res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" })
                    .end(JSON.stringify({ error: `Could not check generated canvas: ${error.message}` }));
            }
        } else if (assets.has(url.pathname)) {
            const { type, content } = assets.get(url.pathname);
            res.writeHead(200, { "Content-Type": `${type}; charset=utf-8` });
            res.end(url.pathname === "/" ? content.replaceAll("__TOKEN__", token) : content);
        } else {
            res.writeHead(404).end();
        }
    });
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    return {
        url: `http://127.0.0.1:${server.address().port}/?token=${token}`,
        close: () => new Promise((resolve, reject) => {
            server.close((error) => error ? reject(error) : resolve());
            server.closeAllConnections();
        }),
    };
}
