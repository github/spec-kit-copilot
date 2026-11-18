import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { isWindowsDeviceName } from "../generated-scaffold/files.mjs";

const exec = promisify(execFile);
const NAME = /^[a-z][a-z0-9-]{0,79}$/;
const KINDS = new Set(["designer.setting-definition",
    "designer.badges-settings-definition", "generated.badge-rule-definition",
    "generated.badge-rule-adapter", "designer.badge-input-control",
    "designer.badge-input-binding", "designer.badge-input-adapter",
    "generated.workflow-page-definition", "generated.phase-control-definition",
    "generated.workflow-page-adapter",
    "generated.phase-control-adapter",
    "generated.field-placement",
    "generated.added-page-definition", "generated.added-page-renderer",
    "generated.dialog-definition", "generated.dialog-adapter",
    "generated.phase-dialog-binding", "generated.button-control-definition",
    "generated.button-adapter", "generated.button-placement",
    "shared.control-definition", "designer.control-adapter", "generated.control-adapter",
    "generated.value-definition", "generated.computed-value-provider"]);
const HEADINGS = new Set(["Pages", "Additional Designer pages",
    "Canvas Design templates", "Additional Canvas Design templates"]);
const EXECUTABLE = new Set(["generated.badge-rule-adapter",
    "designer.badge-input-adapter",
    "generated.workflow-page-adapter", "generated.phase-control-adapter",
    "generated.added-page-renderer",
    "designer.control-adapter", "generated.control-adapter", "generated.computed-value-provider",
    "generated.dialog-adapter", "generated.button-adapter"]);

export function isInside(root, target) {
    const part = relative(root, target);
    return !!part && part !== ".." && !part.startsWith(`..${sep}`) && !isAbsolute(part);
}

export function declarations(command) {
    const result = new Map();
    let heading = "";
    for (const line of command.split(/\r?\n/)) {
        const title = line.match(/^## (.+?)\s*$/);
        if (title) { heading = title[1]; continue; }
        if (!HEADINGS.has(heading) || !/^\s*-\s/.test(line)) continue;
        const names = [...line.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
        const name = names[0];
        if (!NAME.test(name ?? "") || isWindowsDeviceName(name)) {
            throw new Error(`Invalid Canvas Design registration: ${line.trim()}`);
        }
        const page = heading === "Pages" || heading === "Additional Designer pages";
        const kind = page ? "designer.tab-definition" : names[1];
        const strategy = page ? "replace" : names[2];
        if ((!page && (names.length !== 3 || !KINDS.has(kind) || strategy !== "replace"))
            || (page && names.length !== 1
                && (names.length !== 3 || names[1] !== kind || names[2] !== strategy))) {
            throw new Error(`Invalid Canvas Design kind or strategy for ${name}.`);
        }
        const existing = result.get(name);
        if (existing && existing.kind !== kind) {
            throw new Error(`Conflicting Canvas Design registration for ${name}.`);
        }
        if (!existing) result.set(name, { name, kind, strategy: "replace" });
    }
    return [...result.values()];
}

async function cli(project, args, run) {
    const { stdout, stderr = "" } = await run(process.platform === "win32" ? "specify.exe" : "specify",
        args, { cwd: project, timeout: 10000, maxBuffer: 2 * 1024 * 1024,
            env: { ...process.env, COLUMNS: "8192", NO_COLOR: "1" } });
    if (stderr.trim()) {
        throw new Error(`Specify ${args.join(" ")} reported a warning or missing result: ${stdout} ${stderr}`);
    }
    return stdout;
}

export function inventoryEntries(output) {
    let items;
    try { items = JSON.parse(output); }
    catch (error) { throw new Error("Invalid Specify artifact inventory JSON.", { cause: error }); }
    if (!Array.isArray(items)) throw new Error("Specify artifact inventory is not an array.");
    const byId = new Map();
    for (const item of items) {
        if (!item || typeof item.id !== "string" || byId.has(item.id)) {
            throw new Error(`Duplicate or invalid Specify artifact ID: ${item?.id}`);
        }
        byId.set(item.id, item);
    }
    return byId;
}

export function templateWinner(inventory, name, executable) {
    const info = inventory.get(`template:${name}`);
    const layers = info?.stack;
    if (info?.id !== `template:${name}` || info.kind !== "template" || info.name !== name
        || !Array.isArray(layers) || !layers.length
        || layers.some((layer) => !layer || layer.strategy !== "replace")
        || layers.filter((layer) => layer.active === true).length !== 1) {
        throw new Error(`${name}: missing or ambiguous replace-only Specify template.`);
    }
    if (executable && inventory.has(`script:${name}`)) {
        throw new Error(`${name}: native script collision.`);
    }
    const winner = layers.find((layer) => layer.active === true);
    if (typeof winner.sourcePath !== "string" || !winner.sourcePath
        || typeof winner.sourceId !== "string"
        || !(winner.layer === "project" && winner.sourceId === "_"
            || winner.layer === "extension" && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(winner.sourceId)
            || winner.layer === "preset" && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(winner.sourceId))) {
        throw new Error(`${name}: invalid active Specify template layer.`);
    }
    return winner;
}

export async function verifyComposition(project, run = exec) {
    const child = await realpath(project);
    const skill = join(child, ".github", "skills", "speckit-extension-canvas-design-load-page", "SKILL.md");
    const entries = declarations(await readFile(skill, "utf8"));
    const pages = [], templates = [];
    const inventory = inventoryEntries(await cli(child, ["artifact", "list", "--json"], run));
    const root = await realpath(join(child, ".specify"));
    for (const entry of entries) {
        const winner = templateWinner(inventory, entry.name, EXECUTABLE.has(entry.kind));
        const requested = resolve(child, winner.sourcePath);
        if (!isInside(root, requested) || !isInside(root, await realpath(requested))) {
            throw new Error(`${entry.name}: invalid winning Specify template path.`);
        }
        const file = await open(requested, constants.O_RDONLY
            | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
        try {
            const [pathStat, fileStat] = await Promise.all([lstat(requested), file.stat()]);
            if (!pathStat.isFile() || pathStat.isSymbolicLink() || !fileStat.isFile()
                || pathStat.dev !== fileStat.dev || pathStat.ino !== fileStat.ino) {
                throw new Error(`${entry.name}: invalid winning Specify template file.`);
            }
        } finally {
            await file.close();
        }
        const path = await realpath(requested);
        const sourceId = winner.layer === "project" ? "project"
            : `${winner.layer === "extension" ? "extension:" : ""}${winner.sourceId}`;
        const verified = { ...entry, path };
        if (entry.kind === "designer.tab-definition") pages.push(verified);
        else templates.push({ ...verified, sourceId });
    }
    return { pages, templates };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try { console.log(JSON.stringify(await verifyComposition(process.argv[2] ?? process.cwd()))); }
    catch (error) {
        console.error(`Designer composition verification failed: ${error.message}`);
        process.exitCode = 1;
    }
}
