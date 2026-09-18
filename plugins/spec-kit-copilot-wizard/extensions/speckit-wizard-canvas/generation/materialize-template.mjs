#!/usr/bin/env node
// speckit-generated-canvas-materializer v1
import { cp, lstat, readFile, realpath, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function inside(root, child) {
    const rel = relative(root, child);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function substituteJavaScript(content, metadata) {
    return content
        .replaceAll("__EXTENSION_ID_JSON__", JSON.stringify(metadata.extensionId))
        .replaceAll("__DISPLAY_NAME_JSON__", JSON.stringify(metadata.displayName))
        .replaceAll("__DESCRIPTION_JSON__", JSON.stringify(metadata.description));
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
    })[character]);
}

function substituteHtml(content, metadata) {
    return content.replaceAll("__DISPLAY_NAME__", escapeHtml(metadata.displayName));
}

function substituteMarkdown(content, metadata) {
    return content
        .replaceAll("__DISPLAY_NAME__", metadata.displayName.replace(/\s+/g, " "))
        .replaceAll("__DESCRIPTION__", metadata.description.replace(/\s+/g, " "));
}

function validateSetupContract(blueprint) {
    const setup = blueprint?.setup;
    const steps = blueprint?.pipeline?.steps;
    if (blueprint?.schemaVersion !== 2 || !setup || !Array.isArray(steps)) {
        throw new Error("generated blueprint has no supported setup contract");
    }
    if (setup.integration?.id !== "copilot" || setup.integration?.skillsMode !== true) {
        throw new Error("generated setup contract must require Copilot skills mode");
    }
    if (setup.requireInstallationApproval !== undefined && typeof setup.requireInstallationApproval !== "boolean") {
        throw new Error("generated setup installation approval must be a boolean");
    }
    const expected = new Map();
    for (const step of steps) {
        if (!expected.has(step.skillName)) {
            expected.set(step.skillName, {
                name: step.skillName,
                invocation: step.invocation,
                commandName: step.commandName,
                provider: {
                    kind: step.source?.kind,
                    id: step.source?.id ?? null,
                },
            });
        }
    }
    const required = [...(setup.requiredSkills ?? [])].sort((a, b) => a.name.localeCompare(b.name));
    const expectedSkills = [...expected.values()].sort((a, b) => a.name.localeCompare(b.name));
    if (JSON.stringify(required) !== JSON.stringify(expectedSkills)) {
        throw new Error("generated setup requiredSkills do not match the selected pipeline");
    }
    for (const kind of ["preset", "extension"]) {
        const records = setup[`${kind}s`];
        if (!Array.isArray(records)) throw new Error(`generated setup ${kind}s must be an array`);
        const ids = new Set();
        for (const record of records) {
            if (record?.kind !== kind || !/^[a-z0-9][a-z0-9._-]*$/i.test(record.id ?? "")) {
                throw new Error(`generated setup contains an invalid ${kind}`);
            }
            if (ids.has(record.id)) throw new Error(`generated setup contains duplicate ${kind}: ${record.id}`);
            ids.add(record.id);
            if (record.source) {
                if (typeof record.source.name !== "string" || !/^https:\/\//i.test(record.source.url ?? "")) {
                    throw new Error(`generated setup contains an invalid ${kind} source`);
                }
            }
        }
    }
}

export async function verifyMaterializedFiles({ requestFile, targetDirectory, request }, fs = { readFile, lstat }) {
    const requestDir = dirname(resolve(requestFile));
    const target = resolve(targetDirectory);
    for (const file of request.template.protectedFiles) {
        const path = resolve(target, file.path);
        if (!inside(target, path)) throw new Error("protected file escapes target");
        const entry = await fs.lstat(path);
        if (!entry.isFile() || entry.isSymbolicLink()) throw new Error(`generated template file is not regular: ${file.path}`);
        const bytes = await fs.readFile(path);
        if (createHash("sha256").update(bytes).digest("hex") !== file.sha256) {
            throw new Error(`generated template file was modified: ${file.path}`);
        }
    }
    const substitutions = {
        "extension.mjs": substituteJavaScript,
        "README.md": substituteMarkdown,
        "ui/index.html": substituteHtml,
    };
    for (const path of request.template.templatedFiles) {
        if (!Object.hasOwn(substitutions, path)) throw new Error(`unsupported templated file: ${path}`);
        const entry = await fs.lstat(resolve(target, path));
        if (!entry.isFile() || entry.isSymbolicLink()) throw new Error(`generated template file is not regular: ${path}`);
        const source = await fs.readFile(resolve(requestDir, "template", path), "utf8");
        const generated = await fs.readFile(resolve(target, path), "utf8");
        if (generated !== substitutions[path](source, request.metadata)) {
            throw new Error(`generated template file was modified outside permitted metadata substitution: ${path}`);
        }
    }
    for (const path of ["pipeline.json", "workflow-config.json"]) {
        const entry = await fs.lstat(resolve(target, path));
        if (!entry.isFile() || entry.isSymbolicLink()) throw new Error(`generated data file is not regular: ${path}`);
    }
    const pipeline = JSON.parse(await fs.readFile(resolve(target, "pipeline.json"), "utf8"));
    if (JSON.stringify(pipeline) !== JSON.stringify(request.blueprint)) {
        throw new Error("generated pipeline.json does not match the deterministic blueprint");
    }
    return pipeline;
}

export async function validateMaterializedTemplate({ requestFile, targetDirectory, request }) {
    const target = resolve(targetDirectory);
    const pipeline = await verifyMaterializedFiles({ requestFile, targetDirectory, request });
    validateSetupContract(pipeline);
    // Load only captured validators, never generated executable code or the live Wizard.
    const template = resolve(dirname(resolve(requestFile)), "template");
    const [{ validateWorkflowConfig }, { validateWorkflowPaths }] = await Promise.all([
        import(pathToFileURL(resolve(template, "workflow-adapter.mjs")).href),
        import(pathToFileURL(resolve(template, "workspace-files.mjs")).href),
    ]);
    validateWorkflowPaths(pipeline);
    validateWorkflowConfig(JSON.parse(await readFile(resolve(target, "workflow-config.json"), "utf8")), pipeline,
        { resultLabels: request.metadata.resultLabels ?? [] });
    if (typeof pipeline.runtime?.userProvidesSlug !== "boolean") {
        throw new Error("generated runtime must declare whether users can provide a slug");
    }
    if (typeof pipeline.runtime?.multiInstance !== "boolean") {
        throw new Error("generated runtime must declare whether it supports multiple workflow instances");
    }
    if (pipeline.runtime.multiInstance && !String(pipeline.runtime.itemRoot ?? "").includes("<slug>")) {
        throw new Error("multi-instance generated runtime requires a slug-scoped item root");
    }
    const pipelineText = JSON.stringify(pipeline);
    if (pipelineText.includes(JSON.stringify(request.workspacePath).slice(1, -1)) || /token/i.test(pipelineText)) {
        throw new Error("generated pipeline.json contains workspace or token data");
    }
    const [extension, html] = await Promise.all([
        readFile(resolve(target, "extension.mjs"), "utf8"),
        readFile(resolve(target, "ui", "index.html"), "utf8"),
    ]);
    for (const requiredAction of ["list_items", "setup_workflow", "reloadSessionSkills", "run_phase"]) {
        if (!extension.includes(`name: "${requiredAction}"`)) throw new Error(`generated runtime is missing required action: ${requiredAction}`);
    }
    for (const forbidden of ["generate_canvas", "add_command", "remove_command", "clear_pipeline", "reset_pipeline", "reorder_phase"]) {
        if (extension.includes(forbidden) || html.includes(forbidden)) throw new Error(`generated extension contains forbidden capability: ${forbidden}`);
    }
    if (extension.includes("speckit-wizard-canvas") || extension.includes("../shared-workflow-ui")) {
        throw new Error("generated extension imports the live Wizard instead of its vendored template");
    }
    return { ok: true, validated: true };
}

export async function materialize({ requestFile, targetDirectory, request: suppliedRequest }) {
    const requestPath = resolve(requestFile);
    const requestDir = dirname(requestPath);
    const target = resolve(targetDirectory);
    const request = suppliedRequest ?? JSON.parse(await readFile(requestPath, "utf8"));
    const workspace = resolve(request.workspacePath ?? ".");
    if (!inside(workspace, target)) throw new Error("target escapes the workspace");
    const actualRelative = relative(workspace, target).replaceAll("\\", "/").replace(/\/+$/, "");
    const expectedRelative = String(request.target.relativeDirectory).replaceAll("\\", "/").replace(/\/+$/, "");
    if (actualRelative !== expectedRelative) {
        throw new Error("target does not match the deterministic request");
    }
    const entry = await lstat(target);
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error("target must be a regular scaffold directory");
    const [realWorkspace, realTarget] = await Promise.all([realpath(workspace), realpath(target)]);
    if (!inside(realWorkspace, realTarget)) throw new Error("target resolves outside the workspace");

    const templateDir = resolve(requestDir, request.template?.snapshotDirectory ?? "template");
    if (!inside(requestDir, templateDir)) throw new Error("template snapshot escapes the request");
    await cp(templateDir, target, { recursive: true, force: true });

    const extensionPath = resolve(target, "extension.mjs");
    await writeFile(extensionPath, substituteJavaScript(await readFile(extensionPath, "utf8"), request.metadata), "utf8");
    const readmePath = resolve(target, "README.md");
    await writeFile(readmePath, substituteMarkdown(await readFile(readmePath, "utf8"), request.metadata), "utf8");
    const htmlPath = resolve(target, "ui", "index.html");
    await writeFile(htmlPath, substituteHtml(await readFile(htmlPath, "utf8"), request.metadata), "utf8");
    await writeFile(resolve(target, "pipeline.json"), `${JSON.stringify(request.blueprint, null, 2)}\n`, "utf8");
    const configPath = resolve(target, "workflow-config.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    config.resultLabels = request.metadata.resultLabels ?? [];
    const { defaultPhaseInput } = await import(pathToFileURL(resolve(templateDir, "workflow-adapter.mjs")).href);
    config.phaseInputs = Object.fromEntries(request.blueprint.pipeline.steps.map((step) => [step.instanceKey, defaultPhaseInput(step)]));
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    return { ok: true, target: request.target.relativeDirectory, adapter: `${request.target.relativeDirectory}/workflow-config.json` };
}

function parse(argv) {
    const args = {};
    for (let index = 0; index < argv.length; index += 1) {
        const key = argv[index];
        if (key === "--validate") {
            args.validate = true;
            continue;
        }
        const value = argv[++index];
        if (!["--request", "--target"].includes(key) || !value || value.startsWith("--")) throw new Error("usage: materialize-template --request <request.json> --target <directory> [--validate]");
        args[key.slice(2)] = value;
    }
    return args;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
    const args = parse(process.argv.slice(2));
    if (!args.request || !args.target) throw new Error("request and target are required");
    const request = JSON.parse(await readFile(resolve(args.request), "utf8"));
    let result;
    if (args.validate) {
        result = await validateMaterializedTemplate({ requestFile: args.request, targetDirectory: args.target, request });
    } else {
        result = await materialize({ requestFile: args.request, targetDirectory: args.target, request });
    }
    process.stdout.write(`${JSON.stringify(result)}\n`);
}
