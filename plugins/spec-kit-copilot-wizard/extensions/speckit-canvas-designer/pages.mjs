import { requiredExecutableExport, validateExecutableExports,
    validateExecutableImports } from "./contracts/external-executable-modules.mjs";
import { validateContribution, validateControl, validateGeneratedPage, validateWorkflowPage, validateFieldPlacement, validatePhaseControl, validateDialog, validatePhaseDialogBinding, validateButtonControl, validateButtonPlacement, validateValueSource } from "./contracts/external-definitions.mjs";
export { validateDialog, validatePhaseDialogBinding, validateButtonControl,
    validateButtonPlacement } from "./contracts/external-definitions.mjs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fingerprint } from "./handoff.mjs";
import { specifySpawnOptions } from "../speckit-wizard-canvas/env/specify-invocation.mjs";
import { PAGE_NAME, isWindowsDeviceName } from "./contracts/host-open.mjs";
import { RULES, resolvedField, checkSchema, validateTemplateRegistration } from "./contracts/external-design-contributions.mjs";
import { validateBadgeText, validateBadgeSettings, validateBadgeRule } from "./contracts/external-badge-definitions.mjs";
import { validateBadgeInputBinding, validateBadgeInputControl,
    resolveBadgeInputControls, validateBadgeInputAdapterIdentity } from "./contracts/external-badge-input-control.mjs";
export { validateBadgeRule } from "./contracts/external-badge-definitions.mjs";

export { PAGE_NAME, isWindowsDeviceName } from "./contracts/host-open.mjs";
const DEFAULT_PAGES = ["designer-essentials", "designer-badges", "designer-appearance"];
const FIXED_PAGE_CONTROLS = {
    "designer-essentials": "designer.identity",
    "designer-badges": "designer.badges",
};
const FILE_LIMIT = 256 * 1024;
const MODEL_LIMIT = 2 * 1024 * 1024;
const PAGE_PATTERN = new RegExp(PAGE_NAME);
const DIALOG_KINDS = ["generated.dialog-definition", "generated.dialog-adapter",
    "generated.phase-dialog-binding", "generated.button-control-definition",
    "generated.button-adapter", "generated.button-placement"];
const ERROR_LIMIT = 512;
class PageContentError extends Error {}
class ContributionCollisionError extends Error {}

function inside(root, path) {
    const rel = relative(root, path);
    return rel && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

async function boundedJson(path, root, limit, openFile = open, parse = true) {
    const target = await realpath(path);
    if (!inside(root, target)) throw new Error(`Designer file escapes its allowed directory: ${path}`);
    const file = await openFile(target, constants.O_RDONLY
        | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    try {
        const before = await file.stat();
        const stat = await lstat(target);
        if (!before.isFile() || !stat.isFile() || stat.isSymbolicLink()
            || stat.dev !== before.dev || stat.ino !== before.ino
            || await realpath(path) !== target || await realpath(target) !== target) {
            throw new Error(`Invalid Designer file: ${path}`);
        }
        if (before.size > limit) throw new PageContentError(`Designer file exceeds its size limit: ${path}`);
        const buffer = Buffer.alloc(limit + 1);
        let length = 0;
        while (length < buffer.length) {
            const { bytesRead } = await file.read(buffer, length, buffer.length - length, length);
            if (!bytesRead) break;
            length += bytesRead;
        }
        const after = await file.stat();
        const current = await lstat(target);
        if (before.size !== after.size || before.mtimeMs !== after.mtimeMs
            || before.ctimeMs !== after.ctimeMs || current.dev !== before.dev || current.ino !== before.ino
            || await realpath(path) !== target || await realpath(target) !== target) {
            throw new Error(`Designer file changed during loading: ${path}`);
        }
        if (length > limit) throw new PageContentError(`Designer file exceeds its size limit: ${path}`);
        const bytes = buffer.subarray(0, length);
        let document;
        try {
            const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
            if (parse) document = JSON.parse(text);
            else document = text;
        }
        catch (error) {
            throw new PageContentError(`Invalid Designer ${parse ? "JSON" : "UTF-8"} in ${path}: ${error.message}`);
        }
        return { document, ...(parse ? {} : { bytes }), path: target, size: length,
            hash: createHash("sha256").update(bytes).digest("hex") };
    } finally {
        await file.close();
    }
}

export async function readFrozenAsset(item, root) {
    if (await realpath(root) !== root) {
        throw new Error("Designer .specify directory changed since opening");
    }
    const result = await boundedJson(item.path, root, 32 * 1024, open, false);
    if (result.path !== item.path || await realpath(dirname(item.path)) !== dirname(item.path)
        || await realpath(root) !== root || result.hash !== item.hash) {
        throw new Error(`${item.name}: generated asset changed since Designer opened; reopen Designer`);
    }
    return result.bytes;
}

function buildModel(entries, schema) {
    const pages = [], constraints = Object.create(null), values = Object.create(null);
    const fieldOrigins = new Map();
    for (const [index, entry] of entries.entries()) {
        const { name, path, document, hash, error } = entry;
        const fallbackOrder = DEFAULT_PAGES.includes(name)
            ? (DEFAULT_PAGES.indexOf(name) + 1) * 10 : 100001 + index;
        const fail = (reason) => {
            pages.push({ page: name, title: name, order: fallbackOrder,
                error: { name, path, reason: reason.slice(0, ERROR_LIMIT) } });
        };
        if (error) { fail(error); continue; }
        if (document?.enabled === false) continue;
        try {
            checkSchema(document, schema, name);
            if (document.id !== name) throw new Error(`${name}: page id does not match template name`);
            const fixedControl = FIXED_PAGE_CONTROLS[name];
            if (document.fixedControl !== undefined && document.fixedControl !== fixedControl
                || name === "designer-essentials" && ["canvas.id", "canvas.displayName"].some((id) => {
                    const field = document.fields.filter((entry) => entry.id === id);
                    return field.length !== 1 || field[0].label !== (id === "canvas.id" ? "Canvas ID" : "Title")
                        || (field[0].type ?? "string") !== "string"
                        || field[0].control !== "stock.text";
                })) {
                throw new Error(`${name}: required fixed Designer control is missing or changed`);
            }
            const ids = new Set();
            for (const field of document.fields) {
                const type = field.type ?? "string";
                const scalarControl = type === "boolean" ? "stock.checkbox" : "stock.text";
                if (ids.has(field.id) || (Object.hasOwn(field, "default") && type !== "boolean")
                    || (Object.hasOwn(RULES, field.id) && RULES[field.id].type !== type)
                    || (field.control !== undefined && field.control !== scalarControl)
                    || (field.required !== undefined && (type !== "string" || field.required !== true))) {
                    throw new Error(`${name}: duplicate or invalid field ${field.id}`);
                }
                ids.add(field.id);
                if (fieldOrigins.has(field.id)) {
                    throw new ContributionCollisionError(`${name}: duplicate enabled field ${field.id} also defined by ${fieldOrigins.get(field.id)}`);
                }
            }
            const slotIds = new Set();
            for (const slot of document.slots ?? []) {
                if (!slot || typeof slot !== "object" || Array.isArray(slot)
                    || Object.keys(slot).join() !== "id" || slotIds.has(slot.id)) {
                    throw new Error(`${name}: invalid or duplicate slot ${slot?.id}`);
                }
                slotIds.add(slot.id);
            }
        } catch (cause) {
            if (cause instanceof ContributionCollisionError) throw cause;
            fail(cause.message);
            continue;
        }
        for (const field of document.fields) {
            const type = field.type ?? "string";
            constraints[field.id] = Object.hasOwn(RULES, field.id) ? RULES[field.id]
                : { type, ...(type === "string"
                    ? { maxLength: 1000, ...(field.required ? { required: true } : {}) } : {}) };
            values[field.id] = type === "boolean" ? (field.default ?? false) : "";
            fieldOrigins.set(field.id, name);
        }
        pages.push({ ...document, ...(FIXED_PAGE_CONTROLS[name]
            ? { fixedControl: FIXED_PAGE_CONTROLS[name] } : {}),
            fields: document.fields.map((field) => resolvedField({
            ...field, control: field.control ?? (field.type === "boolean"
                ? "stock.checkbox" : "stock.text") }, constraints[field.id])),
            page: name, provenance: { template: name, path, fingerprint: hash } });
    }
    pages.sort((a, b) => a.order - b.order || a.page.localeCompare(b.page));
    return { pages, constraints, values, fieldOrigins };
}

async function specifyInventory(project) {
    const options = await specifySpawnOptions(project, { encoding: "utf8", timeout: 10000,
        maxBuffer: 2 * 1024 * 1024 });
    options.env.NO_COLOR = "1";
    const result = spawnSync("specify", ["artifact", "list", "--json"], options);
    if (result.error || result.status !== 0 || result.stderr?.trim()) {
        throw new Error(`Cannot verify Specify artifact inventory: ${result.stderr || result.error || result.stdout}`);
    }
    let items;
    try { items = JSON.parse(result.stdout); }
    catch (error) { throw new Error("Invalid Specify artifact inventory JSON", { cause: error }); }
    if (!Array.isArray(items)) throw new Error("Specify artifact inventory is not an array");
    const byId = new Map();
    for (const item of items) {
        if (!item || typeof item.id !== "string" || byId.has(item.id)) {
            throw new Error(`Duplicate or invalid Specify artifact ID: ${item?.id}`);
        }
        byId.set(item.id, item);
    }
    return byId;
}

async function verifyWinner(inventory, checkout, root, item, executable = false) {
    const winner = validateTemplateRegistration(inventory, item, executable);
    const expected = resolve(checkout, winner.sourcePath);
    const submitted = resolve(checkout, item.path);
    if (!inside(root, expected) || !inside(root, submitted) || expected !== submitted) {
        throw new Error(`${item.name}: submitted path does not match the active Specify template`);
    }
    let parent = dirname(expected);
    while (parent !== root) {
        try {
            const actual = await realpath(parent);
            if (!inside(root, actual)) {
                throw new Error(`${item.name}: Designer file escapes its allowed directory: ${expected}`);
            }
            break;
        } catch (error) {
            if (error.code !== "ENOENT") throw error;
            parent = dirname(parent);
        }
    }
    const target = await realpath(expected);
    if (!inside(root, target)) {
        throw new Error(`${item.name}: Designer file escapes its allowed directory: ${expected}`);
    }
    if (target !== expected || await realpath(root) !== root) {
        throw new Error(`${item.name}: submitted path does not match the active Specify template`);
    }
}

async function loadTemplates(templates, pageEntries, pageNames, fieldOrigins, specify, remainingBytes,
    inventory) {
    if (!Array.isArray(templates) || templates.length > 100) {
        throw new Error("Invalid Canvas Design template inventory");
    }
    if (templates.filter((item) => item?.kind === "generated.added-page-definition").length > 30) {
        throw new Error("Designer supports at most 30 generated pages");
    }
    const names = new Set(pageNames);
    const loaded = [];
    const compositionErrors = [];
    const slots = new Map();
    for (const page of pageEntries.filter((entry) => !entry.error)) {
        for (const slot of page.slots ?? []) {
            if (slots.has(slot.id)) {
                throw new Error(`${page.page}: duplicate Designer slot ${slot.id} also defined by ${slots.get(slot.id).page.page}`);
            }
            slots.set(slot.id, { page, slot });
        }
    }
    const ids = new Set();
    let size = 0;
    for (const item of templates) {
        if (!item || typeof item !== "object" || Array.isArray(item)
            || Object.keys(item).some((key) => !["name", "path", "sourceId", "kind", "strategy"].includes(key))
            || typeof item.name !== "string" || !PAGE_PATTERN.test(item.name)
            || isWindowsDeviceName(item.name)
            || names.has(item.name) || typeof item.path !== "string"
            || !item.path || item.path.length > 4096 || /[\x00-\x1f\x7f]/.test(item.path)
            || typeof item.sourceId !== "string"
            || !/^[A-Za-z0-9_.:-]{1,160}$/.test(item.sourceId)
            || !["designer.setting-definition", "generated.added-page-definition", "generated.added-page-renderer",
                "generated.workflow-page-definition", "generated.workflow-page-adapter",
                "generated.phase-control-definition",
                "generated.phase-control-adapter",
                "designer.badges-settings-definition", "generated.badge-rule-definition",
                "generated.badge-rule-adapter", "designer.badge-input-control",
                "designer.badge-input-binding", "designer.badge-input-adapter",
                "generated.field-placement",
                "shared.control-definition", "designer.control-adapter", "generated.control-adapter",
                "generated.value-definition", "generated.computed-value-provider",
                ...DIALOG_KINDS].includes(item.kind)
            || item.strategy !== "replace") {
            throw new Error(`Invalid or duplicate Canvas Design template: ${item?.name ?? ""}`);
        }
        names.add(item.name);
        const path = resolve(dirname(specify), item.path);
        const extension = extname(path).toLowerCase();
        const executable = ["generated.added-page-renderer", "generated.phase-control-adapter",
            "generated.workflow-page-adapter",
            "designer.control-adapter", "generated.control-adapter",
            "generated.computed-value-provider", "generated.dialog-adapter",
            "generated.button-adapter", "generated.badge-rule-adapter",
            "designer.badge-input-adapter"].includes(item.kind);
        const expected = executable ? ".mjs" : ".json";
        if (!inside(specify, path) || extension !== expected) {
            throw new Error(`${item.name}: ${item.kind} must be a ${expected} replace-only template inside .specify`);
        }
        await verifyWinner(inventory, dirname(specify), specify, item, executable);
        let content;
        try {
            content = await boundedJson(path, specify, FILE_LIMIT, open, !executable);
        } catch (error) {
            if (!(error instanceof PageContentError)) throw error;
            compositionErrors.push(`${item.name} (from ${item.sourceId}): ${error.message.slice(0, ERROR_LIMIT)}`);
            continue;
        }
        const { document, hash, size: bytes } = content;
        size += bytes;
        if (size > remainingBytes) throw new Error("Designer template inventory exceeds its size limit");
        if (item.kind === "designer.setting-definition") {
            try {
                validateContribution(document, item.name, slots, fieldOrigins);
            } catch (error) {
                if (error?.constructor !== Error
                    || !error.message.startsWith(`${item.name}: unknown Designer slot `)) throw error;
                compositionErrors.push(`${item.name} (from ${item.sourceId}): ${error.message}`);
                continue;
            }
            if (ids.has(document.id)) throw new Error(`${item.name}: duplicate contribution item ${document.id}`);
            ids.add(document.id);
        } else if (item.kind === "generated.value-definition") {
            validateValueSource(document, item.name, fieldOrigins);
        }
        if (item.kind !== "designer.setting-definition") {
            if (item.kind === "generated.added-page-definition") {
                validateGeneratedPage(document, item.name);
                if (bytes > 32 * 1024) throw new Error(`${item.name}: generated page definition exceeds 32 KiB`);
            } else if (item.kind === "generated.workflow-page-definition") {
                validateWorkflowPage(document, item.name);
                if (bytes > 32 * 1024) throw new Error(`${item.name}: Workflow page definition exceeds 32 KiB`);
            } else if (item.kind === "generated.phase-control-definition") {
                validatePhaseControl(document, item.name);
                if (bytes > 32 * 1024) throw new Error(`${item.name}: phase control definition exceeds 32 KiB`);
            } else if (item.kind === "generated.field-placement") {
                validateFieldPlacement(document, item.name);
                if (bytes > 32 * 1024) throw new Error(`${item.name}: field placement exceeds 32 KiB`);
            } else if (item.kind === "generated.dialog-definition") {
                validateDialog(document, item.name);
                if (bytes > 32 * 1024) throw new Error(`${item.name}: dialog definition exceeds 32 KiB`);
            } else if (item.kind === "generated.phase-dialog-binding") {
                validatePhaseDialogBinding(document, item.name);
                if (bytes > 32 * 1024) throw new Error(`${item.name}: phase binding exceeds 32 KiB`);
            } else if (item.kind === "generated.button-control-definition") {
                validateButtonControl(document, item.name);
                if (bytes > 32 * 1024) throw new Error(`${item.name}: button control exceeds 32 KiB`);
            } else if (item.kind === "generated.button-placement") {
                validateButtonPlacement(document, item.name);
                if (bytes > 32 * 1024) throw new Error(`${item.name}: button placement exceeds 32 KiB`);
            } else if (item.kind === "shared.control-definition") {
                validateControl(document, item.name);
                if (bytes > 32 * 1024) throw new Error(`${item.name}: control definition exceeds 32 KiB`);
            } else if (item.kind === "generated.value-definition") {
                if (bytes > 32 * 1024) throw new Error(`${item.name}: value definition exceeds 32 KiB`);
            } else if (item.kind === "designer.badges-settings-definition") {
                validateBadgeSettings(document, item.name);
                if (bytes > 32 * 1024) throw new Error(`${item.name}: badges settings exceed 32 KiB`);
            } else if (item.kind === "generated.badge-rule-definition") {
                validateBadgeRule(document, item.name);
                if (bytes > 32 * 1024) throw new Error(`${item.name}: badge rule exceeds 32 KiB`);
            } else if (item.kind === "designer.badge-input-control") {
                validateBadgeInputControl(document, item.name);
                if (bytes > 32 * 1024) throw new Error(`${item.name}: badge input control exceeds 32 KiB`);
            } else if (item.kind === "designer.badge-input-binding") {
                validateBadgeInputBinding(document, item.name);
                if (bytes > 32 * 1024) throw new Error(`${item.name}: badge input binding exceeds 32 KiB`);
            } else {
                if (bytes > 32 * 1024) throw new Error(`${item.name}: executable module exceeds 32 KiB`);
                const { init, parse } = await import("es-module-lexer/minimal");
                await init();
                let imports, exports;
                try {
                    [imports, exports] = parse(document);
                } catch (error) {
                    throw new Error(`${item.name}: invalid ${item.kind === "generated.added-page-renderer"
                        ? "generated renderer" : item.kind}: ${error.message}`, { cause: error });
                }
                validateExecutableImports(item, imports);
                const requiredExport = requiredExecutableExport(item.kind);
                const check = spawnSync("node", ["--check", "--input-type=module"],
                    { input: document, encoding: "utf8", timeout: 5000, maxBuffer: 128 * 1024 });
                if (check.error || check.status !== 0) {
                    throw new Error(`${item.name}: invalid ${item.kind === "generated.added-page-renderer"
                        ? "generated renderer" : item.kind}: ${check.stderr || check.error || "module validation failed"}`);
                }
                validateExecutableExports(item, document, exports, requiredExport);
            }
        }
        loaded.push({ ...item, path, hash, ...(document === undefined ? {} : { document }) });
    }
    for (const entry of loaded.filter((item) => item.kind === "generated.added-page-definition")) {
        const renderer = loaded.find((item) => item.name === entry.document.renderer);
        if (!renderer || renderer.kind !== "generated.added-page-renderer") {
            compositionErrors.push(`${entry.name} (from ${entry.sourceId}):`
                + ` missing generated renderer ${entry.document.renderer}`);
        }
    }
    for (const entry of loaded.filter((item) => item.kind === "generated.added-page-renderer")) {
        const uses = loaded.filter((item) => item.kind === "generated.added-page-definition"
            && item.document.renderer === entry.name);
        if (uses.length !== 1) {
            throw new Error(`${entry.name}: generated renderer must belong to exactly one page`);
        }
    }
    const badgeSettings = loaded.filter((item) => item.kind === "designer.badges-settings-definition");
    if (badgeSettings.length > 1 || badgeSettings.length === 1
        && badgeSettings[0].name !== "badges-settings") {
        throw new Error("At most one badges-settings definition is allowed");
    }
    const badgeTypes = (badgeSettings[0]?.document.types ?? []).map((document) =>
        ({ ...badgeSettings[0], document }));
    const badgeRules = loaded.filter((item) => item.kind === "generated.badge-rule-definition");
    const badgeAdapters = loaded.filter((item) => item.kind === "generated.badge-rule-adapter");
    if (badgeTypes.length > 30 || badgeRules.length > 30 || badgeAdapters.length > 30) {
        throw new Error("Designer badge definitions exceed their size limit");
    }
    for (const [group, label] of [[badgeTypes, "type"], [badgeRules, "rule"]]) {
        const ids = new Set();
        for (const entry of group) {
            if (ids.has(entry.document.id)) throw new Error(`${entry.name}: duplicate badge ${label} ID`);
            ids.add(entry.document.id);
        }
    }
    for (const entry of badgeTypes) {
        const rule = badgeRules.find((item) => item.document.id === entry.document.rule);
        if (!rule) throw new Error(`${entry.name}: missing badge rule ${entry.document.rule}`);
        if (entry.document.replacementGroup && !rule.document.placementPhaseInput) {
            throw new Error(`${entry.name}: replacement group requires a target phase artifact`);
        }
        validateBadgeText(entry.document.defaultText, rule.document.textPlaceholders, entry.name);
    }
    for (const entry of badgeRules) {
        if (!badgeAdapters.some((item) => item.name === entry.document.adapter)) {
            throw new Error(`${entry.name}: missing registered badge adapter ${entry.document.adapter}`);
        }
    }
    for (const entry of badgeAdapters) {
        if (!badgeRules.some((item) => item.document.adapter === entry.name)) {
            throw new Error(`${entry.name}: unreferenced badge adapter`);
        }
    }
    const badgeInputControls = resolveBadgeInputControls(loaded, badgeTypes, badgeRules);
    for (const binding of badgeInputControls.filter((item, index) =>
        badgeInputControls.findIndex((other) => other.adapter === item.adapter) === index)) {
        const entry = loaded.find((item) => item.name === binding.adapter
            && item.kind === "designer.badge-input-adapter");
        const { init, parse } = await import("es-module-lexer/minimal");
        await init();
        const [, exports] = parse(entry.document);
        validateBadgeInputAdapterIdentity(entry, binding, exports);
    }
    const workflowPages = loaded.filter((item) => item.kind === "generated.workflow-page-definition");
    if (!workflowPages.length) compositionErrors.push("Generated Workflow page is not registered");
    else if (workflowPages.length !== 1) throw new Error("Exactly one generated Workflow page definition is required");
    const workflowAdapters = loaded.filter((item) => item.kind === "generated.workflow-page-adapter");
    if (workflowPages[0]?.document.adapter
        ? workflowAdapters.length !== 1 || workflowAdapters[0].name !== workflowPages[0].document.adapter
        : workflowAdapters.length !== 0) {
        compositionErrors.push(`${workflowPages[0]?.name ?? "Workflow page"}`
            + `${workflowPages[0] ? ` (from ${workflowPages[0].sourceId})` : ""}:`
            + " missing or unreferenced presentation adapter"
            + `${workflowPages[0]?.document.adapter ? ` ${workflowPages[0].document.adapter}` : ""}`);
    }
    const phaseControls = loaded.filter((item) => item.kind === "generated.phase-control-definition");
    if (!phaseControls.length) compositionErrors.push("Generated phase control is not registered");
    else if (phaseControls.length !== 1 || phaseControls[0].name !== "generated-phase-control") {
        throw new Error("Missing or unreferenced phase control definition");
    }
    const phaseAdapters = loaded.filter((item) => item.kind === "generated.phase-control-adapter");
    if (phaseControls[0] && !phaseAdapters.some((entry) => entry.name === phaseControls[0].document.adapter)) {
        compositionErrors.push(`${phaseControls[0].name} (from ${phaseControls[0].sourceId}):`
            + ` missing or unreferenced phase control adapter ${phaseControls[0].document.adapter}`);
    }
    if (workflowPages[0]?.document.adapter && phaseControls[0]
        && workflowPages[0].document.adapter === phaseControls[0].document.adapter
        || loaded.some((entry) => entry.kind === "generated.added-page-definition"
            && entry.document.renderer === workflowPages[0]?.document.adapter)) {
        throw new Error("Workflow page adapter collides with another generated page module");
    }
    const dialogs = loaded.filter((entry) => entry.kind === "generated.dialog-definition");
    const dialogAdapters = loaded.filter((entry) => entry.kind === "generated.dialog-adapter");
    for (const dialog of dialogs) {
        if (!dialogAdapters.some((entry) => entry.name === dialog.document.adapter)) {
            throw new Error(`${dialog.name}: missing registered dialog adapter ${dialog.document.adapter}`);
        }
    }
    for (const adapter of dialogAdapters) {
        if (!dialogs.some((entry) => entry.document.adapter === adapter.name)) {
            throw new Error(`${adapter.name}: unreferenced dialog adapter`);
        }
    }
    const phaseBindings = loaded.filter((entry) => entry.kind === "generated.phase-dialog-binding");
    const boundPhases = new Set();
    for (const binding of phaseBindings) {
        if (boundPhases.has(binding.document.phase)) {
            throw new Error(`${binding.name}: duplicate phase dialog binding ${binding.document.phase}`);
        }
        boundPhases.add(binding.document.phase);
        const dialog = dialogs.find((entry) => entry.name === binding.document.dialog);
        if (!dialog) {
            throw new Error(`${binding.name}: missing registered dialog ${binding.document.dialog}`);
        }
        if (dialog.document.blocks.some((block) =>
            block.type === "slot" && block.name !== "phase")) {
            throw new Error(`${binding.name}: phase dialog cannot use package slots`);
        }
    }
    const buttons = loaded.filter((entry) => entry.kind === "generated.button-placement");
    const buttonControls = loaded.filter((entry) => entry.kind === "generated.button-control-definition");
    const buttonAdapters = loaded.filter((entry) => entry.kind === "generated.button-adapter");
    if ((buttons.length || buttonControls.length || buttonAdapters.length)
        && (buttonControls.length < 1 || buttonControls.length > 2
            || new Set(buttonControls.map((entry) => entry.document.id)).size !== buttonControls.length
            || new Set(buttonControls.map((entry) => entry.document.adapter)).size !== buttonControls.length
            || !buttonControls.some((entry) => entry.name === "generated-setup-button-control")
            || !buttons.some((entry) => entry.name === "generated-setup-button")
            || buttonControls.some((entry) => !buttonAdapters.some((adapter) =>
                adapter.name === entry.document.adapter))
            || buttonControls.some((entry) => !buttons.some((button) =>
                button.document.control === entry.document.id))
            || buttons.some((entry) => !buttonControls.some((control) =>
                control.document.id === entry.document.control)))) {
        throw new Error("Generated buttons require registered controls and compatible adapters");
    }
    const occupiedButtons = new Set();
    for (const button of buttons) {
        const { page, slot, order, dialog } = button.document;
        if (page === "workflow" && !workflowPages[0]?.document.slots.some((entry) => entry.id === slot)) {
            throw new Error(`${button.name}: missing Workflow action slot ${slot}`);
        }
        const resolvedDialog = dialogs.find((entry) => entry.name === dialog);
        if (!resolvedDialog) {
            throw new Error(`${button.name}: missing registered dialog ${dialog}`);
        }
        const slots = resolvedDialog.document.blocks.filter((entry) => entry.type === "slot")
            .map((entry) => entry.name);
        if (page === "setup" && (slots.length !== 1 || slots[0] !== "pending-packages")) {
            throw new Error(`${button.name}: setup dialog requires only the pending packages slot`);
        }
        if (page === "workflow" && slots.length) {
            throw new Error(`${button.name}: Workflow dialog cannot use dynamic slots`);
        }
        const key = `${page}:${slot}:${order}`;
        if (occupiedButtons.has(key)) throw new Error(`${button.name}: conflicting button placement ${key}`);
        occupiedButtons.add(key);
    }
    const sources = loaded.filter((entry) => entry.kind === "generated.value-definition");
    const addedPages = loaded.filter((entry) => entry.kind === "generated.added-page-definition");
    const fieldPlacements = loaded.filter((entry) => entry.kind === "generated.field-placement");
    const placed = new Set();
    const placementIds = new Set();
    const placementControls = new Map();
    const invalidPlacements = new Set();
    for (const entry of fieldPlacements) {
        const { page: pageId, slot, field: fieldId, control: controlId } = entry.document;
        if (placementIds.has(entry.document.id)) {
            throw new Error(`${entry.name}: duplicate generated field placement ID ${entry.document.id}`);
        }
        placementIds.add(entry.document.id);
        const page = pageId === "workflow" ? workflowPages[0]
            : addedPages.find((candidate) => candidate.document.id === pageId);
        if (pageId === "workflow" && slot === "workflow.actions") {
            throw new Error(`${entry.name}: generated field slot is reserved for actions`);
        }
        const key = `${pageId}:${slot}:${fieldId}`;
        if (placed.has(key)) throw new Error(`${entry.name}: duplicate generated field placement ${key}`);
        placed.add(key);
        if (!page?.document.slots?.some((candidate) => candidate.id === slot)) {
            compositionErrors.push(`${entry.name} (from ${entry.sourceId}):`
                + ` unknown generated page slot ${pageId}.${slot}`);
            invalidPlacements.add(entry.name);
            continue;
        }
        const setting = loaded.find((candidate) =>
            candidate.kind === "designer.setting-definition" && candidate.document.field.id === fieldId);
        const baseField = pageEntries.filter((candidate) => !candidate.error)
            .flatMap((candidate) => candidate.fields ?? []).find((candidate) => candidate.id === fieldId);
        const value = sources.find((candidate) => candidate.document.id === fieldId);
        if (!setting && !baseField && !value) {
            compositionErrors.push(`${entry.name} (from ${entry.sourceId}): missing generated field ${fieldId}`);
            invalidPlacements.add(entry.name);
            continue;
        }
        if (value?.document.presentation === "processing-only") {
            throw new Error(`${entry.name}: processing-only value cannot be placed`);
        }
        const field = setting?.document.field ?? baseField;
        const type = field ? field.type ?? "string" : value.document.schema.type;
        const requiredControl = controlId ?? field?.control
            ?? (type === "string" ? "stock.text" : type === "boolean" ? "stock.checkbox"
                : type === "image" ? "stock.image" : undefined);
        if (!requiredControl || type === "object" && !controlId
            || field && controlId && controlId !== field.control) {
            throw new Error(`${entry.name}: incompatible generated field control`);
        }
        const shared = loaded.find((candidate) => candidate.kind === "shared.control-definition"
            && candidate.document.id === requiredControl);
        if (!shared || shared.document.value.type !== type
            || type === "object" && !field
                && !isDeepStrictEqual(shared.document.value.properties, value.document.schema.properties)
            || requiredControl !== "stock.checkbox" && !shared.document.adapters.generated) {
            compositionErrors.push(`${entry.name} (from ${entry.sourceId}):`
                + ` missing or incompatible shared generated control ${requiredControl}`);
            invalidPlacements.add(entry.name);
            continue;
        }
        placementControls.set(entry.name, requiredControl);
    }
    for (const entry of sources) {
        const module = entry.document.source.kind === "computed" && entry.document.source.module;
        if (module && !loaded.some((item) => item.name === module && item.kind === "generated.computed-value-provider")) {
            throw new Error(`${entry.name}: missing registered value provider ${module}`);
        }
    }
    for (const entry of loaded.filter((item) => item.kind === "generated.computed-value-provider")) {
        if (!sources.some((source) => source.document.source.module === entry.name)) {
            throw new Error(`${entry.name}: unreferenced value provider`);
        }
    }
    const generatedIds = new Set([
        ...sources.map((entry) => entry.document.id),
        ...loaded.filter((entry) => entry.kind === "designer.setting-definition"
            && entry.document.generatedBinding?.presentation === "stock.readonly")
            .map((entry) => entry.document.field.id),
    ]);
    for (const page of loaded.filter((entry) => entry.kind === "generated.added-page-definition")) {
        for (const id of page.document.values ?? []) {
            if (!generatedIds.has(id)) throw new Error(`${page.name}: undeclared generated value ${id}`);
        }
    }
    const occupiedAssetSlots = new Set();
    for (const entry of loaded.filter((item) => item.kind === "designer.setting-definition"
        && item.document.generatedBinding?.presentation === "asset")) {
        const binding = entry.document.generatedBinding;
        if (binding.page) {
            const page = loaded.find((item) => item.kind === "generated.added-page-definition"
                && item.document.id === binding.page);
            if (!page?.document.slots?.some((slot) => slot.id === binding.slot)) {
                throw new Error(`${entry.name}: unknown generated page asset slot ${binding.page}.${binding.slot}`);
            }
        }
        const key = `${binding.page ?? "workflow"}:${binding.slot}`;
        if (occupiedAssetSlots.has(key)) {
            throw new Error(`${entry.name}: duplicate generated asset slot ${key}`);
        }
        occupiedAssetSlots.add(key);
    }
    for (const entry of fieldPlacements) {
        const { page, slot } = entry.document;
        if (occupiedAssetSlots.has(`${page}:${slot}`)) {
            throw new Error(`${entry.name}: generated field slot is reserved for an image asset`);
        }
    }
    const occupiedTextSlots = new Set();
    for (const entry of loaded.filter((item) => item.kind === "designer.setting-definition"
        && item.document.generatedBinding?.presentation === "text")) {
        const slot = entry.document.generatedBinding.slot;
        if (occupiedTextSlots.has(slot)) {
            throw new Error(`${entry.name}: duplicate generated text slot ${slot}`);
        }
        occupiedTextSlots.add(slot);
    }
    const controls = loaded.filter((entry) => entry.kind === "shared.control-definition");
    const adapterOwners = new Map();
    for (const control of controls) {
        const fields = loaded.filter((entry) => entry.kind === "designer.setting-definition"
            && entry.document.field.control === control.document.id);
        const pageFields = pageEntries.filter((page) => !page.error)
            .flatMap((page) => page.fields ?? [])
            .filter((field) => field.control === control.document.id);
        const placedFields = fieldPlacements.filter((entry) =>
            entry.document.control === control.document.id);
        if ((!fields.length && !pageFields.length && !placedFields.length
            && !["stock.text", "stock.checkbox"].includes(control.document.id))
            || controls.some((other) => other !== control
            && other.document.id === control.document.id)) {
            throw new Error(`${control.name}: unreferenced or duplicate control definition`);
        }
        for (const [host, name] of Object.entries(control.document.adapters)) {
            const kind = host === "designer" ? "designer.control-adapter"
                : "generated.control-adapter";
            const adapter = loaded.find((item) => item.name === name);
            if (!adapter || adapter.kind !== kind) {
                compositionErrors.push(`${control.name} (from ${control.sourceId}):`
                    + ` missing ${host} adapter ${name}`);
                continue;
            }
            const owner = adapterOwners.get(adapter.name);
            if (owner) {
                throw new Error(`${adapter.name}: ${host} adapter belongs to both ${owner} and ${control.document.id}`);
            }
            adapterOwners.set(adapter.name, control.document.id);
        }
        for (const field of fields) {
            if (field.document.field.type !== control.document.value.type
                || (["object", "image"].includes(field.document.field.type)
                    && !field.document.generatedBinding)
                || (field.document.generatedBinding?.presentation === "control"
                    && !control.document.adapters.generated)) {
                throw new Error(`${field.name}: incompatible shared control value or generated placement`);
            }
        }
    }
    for (const entry of loaded.filter((item) => ["designer.control-adapter", "generated.control-adapter"].includes(item.kind))) {
        if (!controls.some((control) => Object.values(control.document.adapters).includes(entry.name))) {
            throw new Error(`${entry.name}: unreferenced control adapter`);
        }
    }
    const invalidContributions = new Set();
    for (const entry of loaded.filter((item) => item.kind === "designer.setting-definition")) {
        const { field, requires } = entry.document;
        const control = controls.find((item) => item.document.id === field.control);
        if (!control || control.document.id !== field.control
            || control.document.value.type !== field.type
            || (requires && control.name !== requires[0])) {
            compositionErrors.push(`${entry.name} (from ${entry.sourceId}):`
                + ` missing or incompatible shared control definition ${field.control}`);
            invalidContributions.add(entry.name);
        }
    }
    for (const page of pageEntries.filter((entry) => !entry.error)) {
        for (const field of page.fields ?? []) {
            if (!controls.some((control) => control.document.id === field.control
                && control.document.value.type === (field.type ?? "string"))) {
                compositionErrors.push(`${page.page}: missing shared control definition for ${field.id}`);
            }
        }
    }
    const ordered = loaded.filter((entry) => entry.kind === "designer.setting-definition"
        && !invalidContributions.has(entry.name));
    const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
    ordered.sort((a, b) => a.document.order - b.document.order
        || compare(a.sourceId.split(":").at(-1), b.sourceId.split(":").at(-1))
        || compare(a.document.id, b.document.id));
    const sections = new Map();
    for (const entry of [...ordered, ...sources]) {
        const section = entry.kind === "generated.value-definition"
            ? entry.document.section : entry.document.generatedBinding?.section;
        if (!section) continue;
        if (sections.has(section.id) && sections.get(section.id) !== section.title) {
            throw new Error(`${entry.name}: conflicting generated section ${section.id}`);
        }
        sections.set(section.id, section.title);
    }
    return { loaded, ordered, controls, placementControls, invalidPlacements,
        badgeInputControls, compositionErrors };
}

async function context(project) {
    const checkout = await realpath(project);
    const specify = join(checkout, ".specify");
    if (await realpath(specify) !== specify) throw new Error("Designer .specify directory escapes the project");
    const schemaPath = join(specify, "extensions", "extension-canvas-design", "schemas",
        "external-designer.tab-definition.schema.json");
    let schema;
    try {
        // Presets replace page content; the installed extension supplies the evolving validation contract.
        ({ document: schema } = await boundedJson(schemaPath, specify, FILE_LIMIT));
        if (schema?.type !== "object" || !Array.isArray(schema.required)
            || !schema.required.includes("fields") || !schema.required.includes("id")
            || schema.properties?.fields?.type !== "array"
            || schema.properties.fields.items?.type !== "object"
            || !schema.properties.fields.items.properties) {
            throw new Error("Invalid shared Designer page schema");
        }
        checkSchema({ schemaVersion: 1, id: "designer-essentials", title: "Essentials",
            order: 10, fields: [{ id: "canvas.id", label: "Canvas ID" }] }, schema, "Designer page schema");
    } catch (error) {
        throw new Error(`Cannot load Canvas Design page schema at ${schemaPath}: ${error.message}. `
            + "Repair or reinstall extension-canvas-design and try again.", { cause: error });
    }
    return { checkout, schema };
}

export async function assertPageCommand(project) {
    const checkout = await realpath(project);
    const registry = await boundedJson(join(checkout, ".specify", "extensions", ".registry"),
        checkout, FILE_LIMIT);
    if (registry.document.extensions?.["extension-canvas-design"]?.enabled !== true) {
        throw new Error("Canvas Design is not enabled; install it through the Spec Kit extension skill");
    }
    const skill = join(checkout, ".github", "skills",
        "speckit-extension-canvas-design-load-page", "SKILL.md");
    const path = await realpath(skill);
    if (!inside(checkout, path) || !(await lstat(path)).isFile()) {
        throw new Error("The generated speckit-extension-canvas-design-load-page skill is unavailable");
    }
}

export async function loadResolvedDesignerPages(handoff, project, input, templates = [],
    inventoryReader = specifyInventory) {
    const { checkout, schema } = await context(project);
    if (!Array.isArray(input) || input.length > 100) {
        throw new Error("Designer requires at most 100 resolved page paths");
    }
    const specify = join(checkout, ".specify");
    if (await realpath(specify) !== specify) throw new Error("Designer .specify directory escapes the project");
    const inventory = await inventoryReader(checkout);
    const names = new Set();
    const paths = input.map((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)
            || Object.keys(item).some((key) => !["name", "path", "kind", "strategy"].includes(key))
            || typeof item.name !== "string" || !PAGE_PATTERN.test(item.name)
            || item.kind !== "designer.tab-definition"
            || item.strategy !== "replace"
            || typeof item.path !== "string" || !item.path || item.path.length > 4096
            || /[\x00-\x1f\x7f]/.test(item.path)) throw new Error("Invalid Designer page name/path");
        if (names.has(item.name)) throw new Error(`Invalid or duplicate Designer page name: ${item.name}`);
        names.add(item.name);
        const path = resolve(checkout, item.path);
        if (!inside(specify, path) || extname(path).toLowerCase() !== ".json") {
            throw new Error(`${item.name}: Designer pages must be .json files inside .specify`);
        }
        return { name: item.name, path };
    });
    for (const entry of paths) await verifyWinner(inventory, checkout, specify, entry);
    const entries = [];
    let size = 0;
    for (const { name, path } of paths) {
        let parent = dirname(path);
        while (true) {
            try {
                const actual = await realpath(parent);
                if (actual !== specify && !inside(specify, actual)) {
                    throw new Error(`${name}: Designer file escapes its allowed directory: ${path}`);
                }
                break;
            } catch (error) {
                if (error.code !== "ENOENT" || parent === specify) throw error;
                parent = dirname(parent);
            }
        }
        let entry;
        try {
            if (extname(await realpath(path)).toLowerCase() !== ".json") {
                throw new Error(`${name}: Designer pages must be .json files; use a local preset for overrides`);
            }
            entry = { name, ...await boundedJson(path, specify, FILE_LIMIT) };
        } catch (error) {
            if (!(error instanceof PageContentError) && error.code !== "ENOENT") throw error;
            entry = { name, path, error: error.code === "ENOENT"
                ? `${name}: resolved page file is missing` : error.message };
        }
        entries.push(entry);
        size += Buffer.byteLength(JSON.stringify(entries.at(-1)));
        if (size > MODEL_LIMIT - 8192) throw new Error("Designer page model exceeds its size limit");
    }
    const { fieldOrigins, ...model } = buildModel(entries, schema);
    const { loaded, ordered, controls, placementControls, invalidPlacements,
        badgeInputControls, compositionErrors } = await loadTemplates(
        templates, model.pages, names, fieldOrigins, specify, MODEL_LIMIT - size - 8192, inventory);
    model.contributions = ordered.map(({ name, sourceId, document }) =>
        ({ name, sourceId, ...document }));
    model.generatedPages = loaded.filter((entry) => entry.kind === "generated.added-page-definition")
        .map(({ name, document }) => ({ name, ...document }));
    const workflowPage = loaded.find((entry) => entry.kind === "generated.workflow-page-definition");
    model.workflowPage = workflowPage ? { name: workflowPage.name, ...workflowPage.document,
        managedRun: loaded.find((entry) => entry.kind === "generated.phase-control-definition")?.document.managedRun === true }
        : null;
    model.compositionErrors = compositionErrors;
    model.dialogDefinitions = loaded.filter((entry) => entry.kind === "generated.dialog-definition")
        .map(({ name, sourceId, document }) => ({ name, sourceId, ...document }));
    model.phaseDialogBindings = loaded.filter((entry) => entry.kind === "generated.phase-dialog-binding")
        .map(({ name, sourceId, document }) => ({ name, sourceId, ...document }));
    if (model.phaseDialogBindings.length) {
        const selected = new Set((handoff.workflow?.selectedPhases ?? []).map((id) =>
            id.startsWith("speckit.") ? id : `speckit.${id}`));
        for (const binding of model.phaseDialogBindings) {
            if (!selected.has(binding.phase) || binding.phase === "speckit.constitution") {
                throw new Error(`${binding.name}: phase ${binding.phase} cannot use a generated phase dialog`);
            }
        }
    }
    model.buttonControls = loaded.filter((entry) => entry.kind === "generated.button-control-definition")
        .map(({ name, document }) => ({ name, ...document }));
    model.buttonPlacements = loaded.filter((entry) => entry.kind === "generated.button-placement")
        .map(({ name, sourceId, document }) => ({ name, sourceId, ...document }))
        .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    model.fieldPlacements = loaded.filter((entry) => entry.kind === "generated.field-placement"
        && !invalidPlacements.has(entry.name))
        .map(({ name, sourceId, document }) =>
            ({ name, sourceId, ...document, control: placementControls.get(name) }))
        .sort((a, b) => a.order - b.order || a.sourceId.localeCompare(b.sourceId)
            || a.id.localeCompare(b.id));
    model.valueSources = loaded.filter((entry) => entry.kind === "generated.value-definition")
        .map(({ name, sourceId, document }) => ({ name, sourceId, ...document }));
    model.badgeTypes = loaded.filter((entry) => entry.kind === "designer.badges-settings-definition")
        .flatMap(({ name, sourceId, document }) =>
            document.types.map((type) => ({ name, sourceId, schemaVersion: 1, ...type })));
    model.badgeRules = loaded.filter((entry) => entry.kind === "generated.badge-rule-definition")
        .map(({ name, sourceId, document }) => ({ name, sourceId, ...document }));
    model.badgeInputControls = badgeInputControls;
    model.controls = controls.map(({ name, document }) => ({ ...document, template: name }));
    model.adapters = Object.fromEntries(controls.map(({ document }) =>
        [document.id, document.adapters.designer]));
    for (const page of model.pages) {
        if (page.error) continue;
        for (const slot of page.slots ?? []) {
            for (const { document } of ordered.filter((entry) => entry.document.slot === slot.id)) {
                if (page.fields.length >= 100) throw new Error(`${page.page}: too many resolved fields`);
                const field = document.field;
                model.constraints[field.id] = Object.hasOwn(RULES, field.id)
                    ? { ...RULES[field.id], ...(field.required ? { required: true } : {}) }
                    : { type: field.type, ...(field.type === "string"
                        ? { maxLength: field.maxLength ?? 1000,
                            ...(field.required ? { required: true } : {}) } : field.type === "object"
                            ? { properties: controls.find((item) =>
                                item.document.id === field.control).document.value.properties }
                            : field.type === "image" ? {
                                maxBytes: controls.find((item) =>
                                    item.document.id === field.control).document.value.maxBytes,
                                mimeTypes: controls.find((item) =>
                                    item.document.id === field.control).document.value.mimeTypes,
                            } : {}) };
                page.fields.push(resolvedField(field, model.constraints[field.id]));
                model.values[field.id] = field.type === "boolean" ? (field.default ?? false)
                    : field.type === "object" ? null : "";
            }
        }
    }
    for (const placement of model.fieldPlacements) {
        const field = model.pages.flatMap((page) => page.fields ?? [])
            .find((entry) => entry.id === placement.field);
        placement.label = field?.label ?? model.valueSources.find((entry) =>
            entry.id === placement.field)?.label;
        if (!placement.label) throw new Error(`${placement.name}: missing resolved field label`);
    }
    model.templates = loaded.map(({ name, path, hash, sourceId, kind, strategy }) =>
        ({ name, path, hash, sourceId, kind, strategy }));
    const result = { ...model, revision: fingerprint({
        handoffId: handoff.handoffId, sourceFingerprint: handoff.sourceFingerprint, checkout, entries,
        templates: loaded,
    }) };
    if (Buffer.byteLength(JSON.stringify(result)) > MODEL_LIMIT) {
        throw new Error("Designer page model exceeds its size limit");
    }
    return result;
}
