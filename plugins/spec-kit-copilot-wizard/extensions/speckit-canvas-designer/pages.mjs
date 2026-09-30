import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readFile, realpath, rename, rm } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fingerprint, handoffDirectory } from "./handoff.mjs";
import { readDesignSource } from "./source.mjs";

export const PAGE_NAME = "^[a-z][a-z0-9-]{0,79}$";
const FILE_LIMIT = 256 * 1024;
const MODEL_LIMIT = 2 * 1024 * 1024;
const RULES = {
    "canvas.id": { type: "string", minLength: 1, maxLength: 100, pattern: "^[a-z0-9][a-z0-9-]*$" },
    "canvas.displayName": { type: "string", minLength: 1, maxLength: 120 },
    "canvas.description": { type: "string", maxLength: 240 },
    "canvas.workflowListName": { type: "string", maxLength: 80 },
    "workflowSlug.userProvided": { type: "boolean" },
};

function inside(root, path) {
    const rel = relative(root, path);
    return rel && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

async function boundedJson(path, root, limit, openFile = open) {
    const target = await realpath(path);
    if (!inside(root, target)) throw new Error(`Designer file escapes its allowed directory: ${path}`);
    const file = await openFile(target, constants.O_RDONLY
        | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    try {
        const before = await file.stat();
        const stat = await lstat(target);
        if (!before.isFile() || !stat.isFile() || stat.isSymbolicLink()
            || stat.dev !== before.dev || stat.ino !== before.ino || before.size > limit
            || await realpath(path) !== target || await realpath(target) !== target) {
            throw new Error(`Invalid or oversized Designer file: ${path}`);
        }
        const buffer = Buffer.alloc(limit + 1);
        let length = 0;
        while (length < buffer.length) {
            const { bytesRead } = await file.read(buffer, length, buffer.length - length, length);
            if (!bytesRead) break;
            length += bytesRead;
        }
        const after = await file.stat();
        const current = await lstat(target);
        if (length > limit || before.size !== after.size || before.mtimeMs !== after.mtimeMs
            || before.ctimeMs !== after.ctimeMs || current.dev !== before.dev || current.ino !== before.ino
            || await realpath(path) !== target || await realpath(target) !== target) {
            throw new Error(`Designer file changed during loading or exceeds its size limit: ${path}`);
        }
        const bytes = buffer.subarray(0, length);
        let document;
        try { document = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
        catch (error) { throw new Error(`Invalid Designer JSON in ${path}: ${error.message}`); }
        return { document, path: target, hash: createHash("sha256").update(bytes).digest("hex") };
    } finally {
        await file.close();
    }
}

function checkSchema(value, schema, location) {
    if (Object.hasOwn(schema, "const") && value !== schema.const) {
        throw new Error(`${location}: unsupported schema version`);
    }
    if (schema.enum && !schema.enum.includes(value)) throw new Error(`${location}: unsupported value`);
    const type = schema.type;
    const valid = type === undefined || (type === "array" ? Array.isArray(value)
        : type === "object" ? value !== null && typeof value === "object" && !Array.isArray(value)
        : type === "integer" ? Number.isInteger(value) : typeof value === type);
    if (!valid) throw new Error(`${location}: expected ${type}`);
    if (type === "object") {
        for (const key of schema.required ?? []) {
            if (!Object.hasOwn(value, key)) throw new Error(`${location}: missing ${key}`);
        }
        for (const [key, entry] of Object.entries(value)) {
            if (!Object.hasOwn(schema.properties, key)) throw new Error(`${location}: unsupported property ${key}`);
            checkSchema(entry, schema.properties[key], `${location}.${key}`);
        }
    } else if (type === "array") {
        if (value.length > schema.maxItems) throw new Error(`${location}: too many items`);
        value.forEach((item, i) => checkSchema(item, schema.items, `${location}[${i}]`));
    } else if (type === "string") {
        if (value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? FILE_LIMIT)
            || (schema.pattern && !new RegExp(schema.pattern).test(value))) {
            throw new Error(`${location}: invalid text length or identifier`);
        }
    } else if (type === "integer" && (value < schema.minimum || value > schema.maximum)) {
        throw new Error(`${location}: out of range`);
    }
}

function buildModel(entries, schema) {
    if (!Array.isArray(entries) || !entries.length || entries.length > 100) {
        throw new Error("Designer requires between 1 and 100 pages");
    }
    const pages = [], constraints = Object.create(null), values = Object.create(null), names = new Set();
    for (const entry of entries) {
        const { name, document, path, hash } = entry;
        if (typeof name !== "string" || !new RegExp(PAGE_NAME).test(name) || names.has(name)) {
            throw new Error(`Invalid or duplicate Designer page name: ${name}`);
        }
        names.add(name);
        checkSchema(document, schema, name);
        if (document.id !== name) throw new Error(`${name}: page id does not match template name`);
        if (typeof path !== "string" || !isAbsolute(path) || path.length > 4096
            || typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash)) {
            throw new Error(`${name}: invalid page source metadata`);
        }
        const ids = new Set();
        for (const field of document.fields) {
            const type = field.type ?? "string";
            if (ids.has(field.id) || (Object.hasOwn(field, "default") && type !== "boolean")
                || (Object.hasOwn(RULES, field.id) && RULES[field.id].type !== type)) {
                throw new Error(`${name}: duplicate or invalid field ${field.id}`);
            }
            ids.add(field.id);
            if (document.enabled === false) continue;
            if (Object.hasOwn(constraints, field.id)) throw new Error(`Duplicate enabled field: ${field.id}`);
            constraints[field.id] = Object.hasOwn(RULES, field.id) ? RULES[field.id]
                : { type, ...(type === "string" ? { maxLength: 1000 } : {}) };
            values[field.id] = type === "boolean" ? (field.default ?? false) : "";
        }
        if (document.enabled !== false) {
            pages.push({ ...document, page: name, provenance: { template: name, path, fingerprint: hash } });
        }
    }
    if (!Object.hasOwn(constraints, "canvas.id") || !Object.hasOwn(constraints, "canvas.displayName")) {
        throw new Error("Enabled pages must contain Canvas ID and Title");
    }
    pages.sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return { pages, constraints, values };
}

async function context(handoff, workspace, project) {
    const checkout = await realpath(project);
    const source = await readDesignSource();
    if (fingerprint(source) !== fingerprint(handoff.requiredExtension)) {
        throw new Error("Canvas Design source changed; launch a new Designer session");
    }
    const folder = handoffDirectory(await realpath(workspace), handoff.handoffId);
    if (await realpath(folder) !== folder) throw new Error("Designer page state escapes session artifacts");
    const schema = JSON.parse(await readFile(join(source.path, "schemas", "page.schema.json"), "utf8"));
    return { checkout, folder, schema };
}

export async function assertPageCommand(project) {
    const checkout = await realpath(project);
    const registry = await boundedJson(join(checkout, ".specify", "extensions", ".registry"),
        checkout, FILE_LIMIT);
    if (registry.document.extensions?.["canvas-design"]?.enabled !== true) {
        throw new Error("Canvas Design is not enabled; install it through the Spec Kit extension skill");
    }
    const skill = join(checkout, ".github", "skills", "speckit-canvas-design-load-page", "SKILL.md");
    const path = await realpath(skill);
    if (!inside(checkout, path) || !(await lstat(path)).isFile()) {
        throw new Error("The generated speckit-canvas-design-load-page skill is unavailable");
    }
}

export async function storeDesignerPages(handoff, workspace, project, input, isCurrent = () => true) {
    const { checkout, folder, schema } = await context(handoff, workspace, project);
    if (!Array.isArray(input) || !input.length || input.length > 100) {
        throw new Error("Designer requires between 1 and 100 resolved page paths");
    }
    const specify = join(checkout, ".specify");
    if (await realpath(specify) !== specify) throw new Error("Designer .specify directory escapes the project");
    const entries = [];
    let size = 0;
    for (const item of input) {
        if (!item || Object.keys(item).some((key) => !["name", "path"].includes(key))
            || typeof item.name !== "string" || !new RegExp(PAGE_NAME).test(item.name)
            || typeof item.path !== "string" || !item.path || item.path.length > 4096
            || /[\x00-\x1f\x7f]/.test(item.path)) throw new Error("Invalid Designer page name/path");
        const path = resolve(checkout, item.path);
        if (extname(path).toLowerCase() !== ".json"
            || extname(await realpath(path)).toLowerCase() !== ".json") {
            throw new Error(`${item.name}: Designer pages must be .json files; use a local preset for overrides`);
        }
        const loaded = await boundedJson(path, specify, FILE_LIMIT);
        entries.push({ name: item.name, ...loaded });
        size += Buffer.byteLength(JSON.stringify(entries.at(-1)));
        if (size > MODEL_LIMIT - 8192) throw new Error("Designer page model exceeds its size limit");
    }
    const model = buildModel(entries, schema);
    const snapshot = { schemaVersion: 1, loadId: randomUUID(), handoffId: handoff.handoffId,
        sourceFingerprint: handoff.sourceFingerprint, checkout, entries };
    const revision = fingerprint(snapshot);
    const temporary = join(folder, `.pages-${randomUUID()}.tmp`);
    try {
        await usingFile(temporary, folder, JSON.stringify(snapshot));
        if (!isCurrent()) throw new Error("Designer page load was superseded; reload pages again");
        if (await realpath(folder) !== folder) throw new Error("Designer page state escapes session artifacts");
        await rename(temporary, join(folder, "pages.json"));
    } finally {
        if (await realpath(folder) === folder) await rm(temporary, { force: true });
    }
    return { ...model, revision };
}

async function usingFile(path, folder, text) {
    if (await realpath(folder) !== folder) throw new Error("Designer page state escapes session artifacts");
    const file = await open(path, "wx", 0o600);
    try {
        const stat = await file.stat();
        const current = await lstat(path);
        if (await realpath(folder) !== folder || await realpath(path) !== path
            || !current.isFile() || current.dev !== stat.dev || current.ino !== stat.ino) {
            throw new Error("Designer page state changed while opening its snapshot");
        }
        await file.writeFile(text, "utf8");
    }
    finally { await file.close(); }
}

export async function loadDesignerPages(handoff, workspace, project) {
    const { checkout, folder, schema } = await context(handoff, workspace, project);
    let saved;
    try { saved = (await boundedJson(join(folder, "pages.json"), folder, MODEL_LIMIT)).document; }
    catch (error) {
        if (error.code === "ENOENT") {
            throw new Error("Designer pages have not been loaded; run speckit-canvas-design-load-page first");
        }
        throw error;
    }
    if (saved.schemaVersion !== 1 || typeof saved.loadId !== "string"
        || !/^[a-f0-9-]{36}$/.test(saved.loadId) || saved.handoffId !== handoff.handoffId
        || saved.sourceFingerprint !== handoff.sourceFingerprint || saved.checkout !== checkout) {
        throw new Error("Designer page model belongs to another handoff or project; reload pages");
    }
    return { ...buildModel(saved.entries, schema), revision: fingerprint(saved) };
}
