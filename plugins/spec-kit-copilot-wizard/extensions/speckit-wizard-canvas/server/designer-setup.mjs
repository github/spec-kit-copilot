import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, mkdtemp, open, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { load, JSON_SCHEMA } from "js-yaml";
import { readHandoff } from "../../speckit-canvas-designer/handoff.mjs";
import { designerOpenInputSchema } from "../../speckit-canvas-designer/contracts/host-open.mjs";
import { checkSchema } from "../../speckit-canvas-designer/contracts/external-design-contributions.mjs";
import { normalizeInstalledWorkflowInventory } from "../contracts/specify-inventory.mjs";
import { specifySpawnOptions } from "../env/specify-invocation.mjs";
import { runtimeSettings } from "../env/runtime-settings.mjs";
import { prepareHandoff, preflight, verifyHostedCanvasDesign, verifyLocalInstall } from "./designer-launch-check.mjs";
import { validateLocalSource } from "./designer-local-sources.mjs";
import { runSpecify, downloadBundle } from "./specify-command.mjs";
export { runSpecify } from "./specify-command.mjs";

const exec = promisify(execFile);
const BASE = "extension-canvas-design";
const CATALOGS = [
    ["extension", runtimeSettings.catalogs.copilot.extensions],
    ["preset", runtimeSettings.catalogs.copilot.presets],
];
const GROUP = { presets: "preset", extensions: "extension", bundles: "bundle" };

function elapsed(start) { return Math.round(performance.now() - start); }

async function readBoundedFile(path, limit, label) {
    const parent = dirname(path);
    const [folder, parentStat] = await Promise.all([realpath(parent), lstat(parent)]);
    const handle = await open(path, constants.O_RDONLY
        | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    try {
        const [file, current, currentFolder, currentParent] = await Promise.all([
            handle.stat(), lstat(path), realpath(parent), lstat(parent),
        ]);
        if (folder !== currentFolder || parentStat.dev !== currentParent.dev
            || parentStat.ino !== currentParent.ino || !file.isFile()
            || !current.isFile() || current.isSymbolicLink()
            || file.dev !== current.dev || file.ino !== current.ino) {
            throw new Error(`${label} changed while reading`);
        }
        if (file.size > limit) throw new Error(`Oversized ${label}`);
        const buffer = Buffer.alloc(limit + 1);
        let size = 0;
        while (size < buffer.length) {
            const { bytesRead } = await handle.read(buffer, size, buffer.length - size, null);
            if (!bytesRead) break;
            size += bytesRead;
        }
        if (size > limit) throw new Error(`Oversized ${label}`);
        const [after, afterFolder, afterParent] = await Promise.all([
            lstat(path), realpath(parent), lstat(parent),
        ]);
        if (afterFolder !== folder || afterParent.dev !== parentStat.dev
            || afterParent.ino !== parentStat.ino || after.dev !== file.dev
            || after.ino !== file.ino || !after.isFile() || after.isSymbolicLink()) {
            throw new Error(`${label} changed while reading`);
        }
        return buffer.subarray(0, size).toString("utf8");
    } finally {
        await handle.close();
    }
}

async function materializeDevSkills(project, approvedSource) {
    const approved = await realpath(approvedSource);
    const checkout = await realpath(project);
    for (const name of ["load-page", "generate", "open-generated"]) {
        const path = join(project, ".github", "skills",
            `speckit-extension-canvas-design-${name}`, "SKILL.md");
        let stat;
        try { stat = await lstat(path); }
        catch (error) {
            if (error.code === "ENOENT") continue;
            throw error;
        }
        if (!stat.isSymbolicLink()) continue;
        const target = await realpath(path);
        const inside = (root) => {
            const within = relative(root, target);
            return within && within !== ".." && !within.startsWith(`..${sep}`) && !isAbsolute(within);
        };
        if (!inside(approved) && !inside(checkout)) {
            throw new Error(`Generated Canvas Design ${name} skill is outside the approved source`);
        }
        const content = await readBoundedFile(target, 256 * 1024, `Canvas Design ${name} skill`);
        const temporary = join(dirname(path), `.SKILL.md-${process.pid}-${randomUUID()}`);
        try {
            await writeFile(temporary, content, { flag: "wx" });
            await rename(temporary, path);
        } finally {
            await rm(temporary, { force: true });
        }
    }
}
// Specify's Windows console entry point is an .exe; avoid interpreting approved URLs or paths in cmd.exe.
const directRun = (run) => (binary, args, options) => run(binary, args, {
    ...options, shell: process.platform === "win32" ? false : options.shell,
});

async function inventory(project, kind, command) {
    let data;
    try { data = JSON.parse(await command([GROUP[kind], "list", "--json"])); }
    catch (error) { throw new Error(`Invalid ${kind} inventory: ${error.message}`, { cause: error }); }
    return normalizeInstalledWorkflowInventory({
        presets: kind === "presets" ? data : [],
        extensions: kind === "extensions" ? data : [],
        bundles: kind === "bundles" ? data : [],
    })[kind];
}

function locatorFor(handoff, kind, item) {
    const locator = handoff.workflow.installLocators[kind].find((entry) => entry.installedId === item.id);
    if (!locator) throw new Error(`No frozen ${kind} source for ${item.id}`);
    return locator;
}

function standalone(handoff, kind) {
    const entries = new Map();
    for (const installed of handoff.workflow.installed[kind]) {
        if (kind === "extensions" && installed.id === BASE) continue;
        entries.set(installed.id, { installed, locator: locatorFor(handoff, kind, installed) });
    }
    for (const selected of handoff.selections[kind]) {
        if (kind === "extensions" && selected.id === BASE) continue;
        if ([...entries.values()].some((entry) => entry.locator.catalogId === selected.id
            && entry.locator.source === selected.source)) continue;
        if (!entries.has(selected.id)) {
            entries.set(selected.id, { selected, locator: {
                installedId: selected.id, source: selected.source, catalogId: selected.id,
                downloadUrl: selected.downloadUrl,
            } });
        }
    }
    for (const local of handoff.localSelections?.[kind] ?? []) {
        if (kind === "extensions" && local.id === BASE) continue;
        const previous = entries.get(local.id);
        entries.set(local.id, { ...previous, local, locator: {
            installedId: local.id, source: "local", path: local.path,
        } });
    }
    return [...entries.values()];
}

function selectedPackages(handoff, kind) {
    return standalone(handoff, kind).filter((item) => item.selected && !item.local);
}

function setupRecordPath(root, id) {
    return join(root, "speckit-canvas-designer", "handoffs", id, "setup-record.json");
}

async function writeSetupRecord(root, id, hash, selections) {
    const path = setupRecordPath(root, id);
    const parent = dirname(path);
    const [canonical, parentStat] = await Promise.all([realpath(parent), lstat(parent)]);
    const temporary = join(parent, `.setup-record-${randomUUID()}.json`);
    try {
        await writeFile(temporary, JSON.stringify({ schemaVersion: 1, handoffId: id,
            handoffHash: hash, selections }), { flag: "wx", mode: 0o600 });
        const [current, currentStat] = await Promise.all([realpath(parent), lstat(parent)]);
        if (current !== canonical || currentStat.dev !== parentStat.dev
            || currentStat.ino !== parentStat.ino) {
            throw new Error("Designer setup record directory changed");
        }
        await rename(temporary, path);
    } finally {
        await rm(temporary, { force: true });
    }
}

async function readSetupRecord(root, id, hash, handoff) {
    let record;
    try {
        record = JSON.parse(await readBoundedFile(setupRecordPath(root, id), 16384,
            "Designer setup record"));
    } catch (error) {
        if (error.code === "ENOENT") {
            throw new Error("Designer setup record is missing; rerun the install stage", { cause: error });
        }
        throw error;
    }
    if (record?.schemaVersion !== 1 || record.handoffId !== id || record.handoffHash !== hash
        || !record.selections || Object.keys(record.selections).sort().join() !== "extensions,presets") {
        throw new Error("Designer setup record does not match the frozen handoff");
    }
    for (const kind of ["extensions", "presets"]) {
        const expected = selectedPackages(handoff, kind);
        const entries = record.selections[kind];
        if (!Array.isArray(entries) || entries.length !== expected.length
            || entries.some((entry, index) => entry?.catalogId !== expected[index].locator.catalogId
                || entry.source !== expected[index].locator.source
                || typeof entry.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(entry.id)
                || typeof entry.version !== "string"
                || !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/.test(entry.version)
                || ![entry.source, ...(expected[index].locator.downloadUrl ? ["local"] : [])]
                    .includes(entry.installedSource))) {
            throw new Error(`Designer setup record has incompatible ${kind} selections`);
        }
    }
    return record.selections;
}

async function inspectPackage(project, kind, item, command, warnings) {
    const id = item.locator.installedId;
    const listed = (await inventory(project, kind, command)).find((entry) => entry.id === id);
    if (!listed) throw new Error(`Installed ${kind} ${id} is missing`);
    const path = join(project, ".specify", kind, id);
    const manifest = await validateLocalSource(kind, path);
    if (manifest.id !== id || manifest.version !== listed.version) {
        throw new Error(`Installed ${kind} ${id} manifest and inventory disagree`);
    }
    if (item.locator.source === "local" && listed.source !== "local") {
        throw new Error(`Approved local ${kind} ${id} is not a local installation`);
    }
    if (item.selected && !item.local && listed.source !== item.locator.source
        && !(item.locator.downloadUrl && listed.source === "local")) {
        throw new Error(`Selected ${kind} ${id} differs from the approved catalog source`);
    }
    if (item.locator.source === "default" && !item.locator.downloadUrl
        && listed.source !== "default") {
        throw new Error(`Installed ${kind} ${id} differs from the frozen default source`);
    }
    if (item.locator.source !== "local" && listed.source !== "local"
        && listed.source !== item.locator.source) {
        throw new Error(`Installed ${kind} ${id} differs from the frozen catalog source`);
    }
    const expected = item.local?.version ?? item.installed?.version ?? item.selected?.version;
    if (expected && listed.version !== expected) {
        warnings.push(`${kind} ${id} version drift: approved ${expected}, installed ${listed.version}.`);
    }
    return listed;
}

async function installPackage(project, kind, item, command, warnings, verifyLocal, reserved = new Set()) {
    const group = GROUP[kind];
    const { locator, installed } = item;
    let args;
    if (locator.source === "local") {
        const source = await validateLocalSource(kind, locator.path);
        if (source.id !== locator.installedId) throw new Error(`Local ${kind} ${locator.installedId} changed manifest ID`);
        args = kind === "extensions" ? [group, "add", source.path, "--dev", "--force"]
            : [group, "add", "--dev", source.path];
    } else {
        args = [group, "add", locator.catalogId];
        if (locator.downloadUrl) args.push("--from", locator.downloadUrl);
        if (kind === "extensions") args.push("--force");
    }
    if (installed) args.push("--priority", String(installed.priority));
    const before = !installed && !item.local ? await inventory(project, kind, command) : null;
    const resolveExisting = (error) => {
        const candidates = before.filter((entry) => !reserved.has(entry.id)
            && entry.version === item.selected?.version
            && error.message.includes(entry.id));
        if (candidates.length !== 1) {
            throw new Error(`Cannot identify installed ${kind} manifest for selected catalog ${locator.catalogId}`);
        }
        locator.installedId = candidates[0].id;
    };
    try { await command(args); }
    catch (error) {
        if (kind !== "presets" || !/already installed|already exists/i.test(error.message)) throw error;
        if (before) resolveExisting(error);
        await command(["preset", "remove", locator.installedId]);
        await command(args);
    }
    if (before) {
        const after = await inventory(project, kind, command);
        const previous = new Set(before.map((entry) => entry.id));
        const added = after.filter((entry) => !previous.has(entry.id));
        if (added.length === 1 && added[0].id !== locator.installedId) {
            locator.installedId = added[0].id;
        } else if (!added.length && !after.some((entry) => entry.id === locator.installedId)
            && !before.some((entry) => entry.id === locator.installedId)) {
            const candidates = after.filter((entry) => !reserved.has(entry.id)
                && (entry.source === locator.source
                    || (locator.downloadUrl && entry.source === "local"))
                && entry.version === item.selected?.version);
            if (candidates.length !== 1) {
                throw new Error(`Cannot identify installed ${kind} manifest for selected catalog ${locator.catalogId}`);
            }
            locator.installedId = candidates[0].id;
        }
    }
    const actual = await inspectPackage(project, kind, item, command, warnings);
    if (installed) {
        if (actual.priority !== installed.priority) {
            await command([group, "set-priority", installed.id, String(installed.priority)]);
        }
        if (actual.enabled !== installed.enabled) {
            await command([group, installed.enabled ? "enable" : "disable", installed.id]);
        }
        const restored = (await inventory(project, kind, command)).find((entry) => entry.id === installed.id);
        if (restored.priority !== installed.priority || restored.enabled !== installed.enabled) {
            throw new Error(`Cannot restore runtime ${kind} ${installed.id} priority or enabled state`);
        }
    }
    if (item.local) await verifyLocal(project, kind, item.local.id);
    return actual;
}

async function bundleSource(locator, download) {
    if (!locator.downloadUrl && !locator.bundleYml) return { path: locator.catalogId, dispose: async () => {} };
    const temp = await mkdtemp(join(tmpdir(), "speckit-designer-bundle-"));
    try {
        const path = locator.bundleYml ? join(temp, "bundle.yml") : join(temp, "bundle.zip");
        if (locator.bundleYml) await writeFile(path, locator.bundleYml, "utf8");
        else await download(locator.downloadUrl, path);
        return { path, dispose: async () => rm(temp, { recursive: true, force: true }) };
    } catch (error) {
        await rm(temp, { recursive: true, force: true });
        throw error;
    }
}

async function installBundles(project, handoff, command, warnings, download) {
    const entries = new Map(handoff.workflow.installed.bundles.map((bundle) =>
        [bundle.id, { bundle, locator: locatorFor(handoff, "bundles", bundle) }]));
    for (const selected of handoff.selections.bundles) {
        if ([...entries.values()].some((entry) => entry.locator.catalogId === selected.id
            && entry.locator.source === selected.source)) continue;
        if (!entries.has(selected.id)) entries.set(selected.id, { selected,
            locator: { installedId: selected.id, source: selected.source,
                catalogId: selected.id, downloadUrl: selected.downloadUrl } });
    }
    for (const { bundle, selected, locator } of entries.values()) {
        const before = selected && !bundle
            ? new Set((await inventory(project, "bundles", command)).map((entry) => entry.id)) : null;
        const source = await bundleSource(locator, download);
        try { await command(["bundle", "install", source.path],
            Boolean(locator.downloadUrl || locator.bundleYml)); }
        finally { await source.dispose(); }
        const listed = await inventory(project, "bundles", command);
        const added = before && listed.filter((item) => !before.has(item.id));
        const actual = listed.find((item) => item.id === locator.installedId)
            ?? (added?.length === 1 ? added[0] : undefined);
        if (!actual) throw new Error(`Installed bundle ${locator.installedId} is missing`);
        const expected = bundle?.version ?? selected?.version;
        if (expected && actual.version !== expected) {
            warnings.push(`Bundle ${actual.id} version drift: approved ${expected}, installed ${actual.version}.`);
        }
    }
    return entries.size;
}

async function verifyRuntime(project, handoff, command, warnings) {
    for (const kind of ["extensions", "presets"]) {
        if (!handoff.workflow.installed[kind].length) continue;
        const actual = await inventory(project, kind, command);
        for (const item of handoff.workflow.installed[kind]) {
            const locator = locatorFor(handoff, kind, item);
            const local = handoff.localSelections?.[kind]?.find((entry) => entry.id === item.id);
            const found = actual.find((entry) => entry.id === item.id);
            if (!found || found.priority !== item.priority || found.enabled !== item.enabled
                || (local && found.source !== "local")
                || (!(kind === "extensions" && item.id === BASE) && !local && locator.source !== "local"
                    && found.source !== "local" && found.source !== locator.source)) {
                throw new Error(`Runtime ${kind} ${item.id} does not match the frozen installation`);
            }
            await inspectPackage(project, kind, {
                installed: item, local,
                locator: kind === "extensions" && item.id === BASE && !local && handoff.canvasDesign
                    ? { installedId: BASE, source: "copilot",
                        catalogId: BASE, downloadUrl: handoff.canvasDesign.downloadUrl }
                    : locator,
            }, command, warnings);
        }
    }
    if (!handoff.workflow.installed.bundles.length) return;
    const bundles = await inventory(project, "bundles", command);
    for (const bundle of handoff.workflow.installed.bundles) {
        const actual = bundles.find((entry) => entry.id === bundle.id);
        if (!actual) throw new Error(`Runtime bundle ${bundle.id} is missing`);
        if (actual.version !== bundle.version) {
            warnings.push(`Bundle ${bundle.id} version drift: approved ${bundle.version}, installed ${actual.version}.`);
        }
    }
}

function uniqueWarnings(warnings) { return [...new Set(warnings)]; }

async function registerCatalog(project, kind, url, command) {
    const config = join(project, ".specify", `${kind}-catalogs.yml`);
    let text;
    try { text = await readBoundedFile(config, 65536, `${kind} catalog configuration`); }
    catch (error) {
        if (error.code !== "ENOENT") throw error;
    }
    if (text !== undefined) {
        const parsed = load(text, { schema: JSON_SCHEMA });
        if (!Array.isArray(parsed?.catalogs)) throw new Error(`Invalid ${kind} catalog configuration`);
        const existing = parsed.catalogs.find((entry) => entry.name === runtimeSettings.copilotCatalogName);
        if (existing) {
            if (existing.url !== url || existing.install_allowed !== true) {
                throw new Error(`Existing ${kind} catalog differs from the approved source`);
            }
            return;
        }
    }
    await command([kind, "catalog", "add", url, "--name", runtimeSettings.copilotCatalogName, "--install-allowed"]);
}

export async function verifyComposedLoadPage(project, command) {
    const skill = join(project, ".github", "skills", "speckit-extension-canvas-design-load-page", "SKILL.md");
    const contents = await readBoundedFile(skill, 256 * 1024, "generated Canvas Design load-page skill");
    if (!contents.trim()) throw new Error("Generated Canvas Design load-page skill is empty");
    let artifacts;
    try { artifacts = JSON.parse(await command(["artifact", "list", "--json"])); }
    catch (error) { throw new Error(`Invalid Specify command inventory: ${error.message}`, { cause: error }); }
    const name = "speckit.extension-canvas-design.load-page";
    const entry = Array.isArray(artifacts) && artifacts.find((artifact) =>
        artifact.id === `command:${name}` && artifact.kind === "command" && artifact.name === name);
    if (!entry || !Array.isArray(entry.stack) || !entry.stack.some((layer) => layer.active === true)) {
        throw new Error("Specify did not resolve the composed Canvas Design load-page command");
    }
    return { skill, stack: entry.stack };
}

async function verifyPresetRegistrations(project, handoff, commandStack, verifier, skill) {
    const firstReplacement = commandStack.findIndex((entry) => entry.strategy === "replace");
    const contributors = new Set(commandStack.slice(0, firstReplacement < 0
        ? commandStack.length : firstReplacement).filter((entry) =>
        entry.layer === "preset" && entry.strategy === "append").map((entry) => entry.sourceId));
    if (!contributors.size) return;
    const { declarations } = await import(pathToFileURL(verifier).href);
    const composed = new Map(declarations(await readBoundedFile(skill, 256 * 1024,
        "generated Canvas Design load-page skill")).map((entry) =>
        [entry.name, entry]));
    for (const id of contributors) {
        const folder = join(project, ".specify", "presets", id);
        const canonical = await realpath(folder);
        const locator = handoff.workflow.installLocators.presets.find((entry) => entry.installedId === id);
        const local = handoff.localSelections?.presets?.find((entry) => entry.id === id);
        const approved = local?.path ?? (locator?.source === "local" ? locator.path : undefined);
        if (canonical !== folder && (!approved || canonical !== await realpath(approved))) {
            throw new Error(`Canvas Design preset ${id} differs from its approved source`);
        }
        const text = await readBoundedFile(join(canonical, "preset.yml"), 65536, `preset manifest: ${id}`);
        const manifest = load(text, { schema: JSON_SCHEMA });
        const registrations = manifest?.provides?.templates?.filter((entry) =>
            entry.type === "command" && entry.name === "speckit.extension-canvas-design.load-page"
            && entry.strategy === "append");
        if (!registrations?.length) {
            throw new Error(`Specify reports an unregistered Canvas Design command layer from ${id}`);
        }
        for (const registration of registrations) {
            if (typeof registration.file !== "string" || isAbsolute(registration.file)) {
                throw new Error(`Invalid Canvas Design command path in preset ${id}`);
            }
            const source = resolve(canonical, registration.file);
            const rel = relative(canonical, source);
            if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)
                || await realpath(source) !== source) {
                throw new Error(`Canvas Design command path escapes preset ${id}`);
            }
            for (const entry of declarations(await readBoundedFile(source, 256 * 1024,
                `Canvas Design command in preset ${id}`))) {
                if (composed.get(entry.name)?.kind !== entry.kind) {
                    throw new Error(`Preset ${id} registration ${entry.name} is missing from Specify's composed command`);
                }
            }
        }
    }
}

export async function installDesignerSetup(project, root, id, hash, {
    run = exec, download = downloadBundle, prepare = prepareHandoff,
    check = preflight, verifyLocal = verifyLocalInstall, verifyBase = verifyHostedCanvasDesign,
} = {}) {
    const timings = {};
    const warnings = [];
    const command = (args, confirmApprovedSource = false) =>
        runSpecify(project, args, run, { confirmApprovedSource });
    const safeRun = directRun(run);
    let start = performance.now();
    await prepare(root, id, hash);
    let state;
    try { state = await check(project, root, id, hash, safeRun); }
    catch (error) {
        if (error.code === "ENOENT") throw new Error("Specify CLI is missing; invoke speckit-cli-setup and retry.", { cause: error });
        throw error;
    }
    timings.preflight = elapsed(start);
    const handoff = await readHandoff(root, id, undefined, hash);
    await rm(setupRecordPath(root, id), { force: true });
    if (!state.initialized) {
        start = performance.now();
        await command(["init", "--here", "--force", "--non-interactive", "--ignore-agent-tools",
            "--integration", "copilot", "--integration-options=--skills",
            "--script", process.platform === "win32" ? "ps" : "sh"]);
        if (!(await check(project, root, id, hash, safeRun)).initialized) {
            throw new Error("Specify init did not create the child project's .specify directory");
        }
        timings.init = elapsed(start);
    }
    start = performance.now();
    for (const [kind, url] of CATALOGS) {
        await registerCatalog(project, kind, url, command);
    }
    timings.catalogs = elapsed(start);
    const localBase = handoff.localSelections?.extensions?.find((entry) => entry.id === BASE);
    const base = { locator: localBase
        ? { installedId: BASE, source: "local", path: localBase.path }
        : { installedId: BASE, source: "copilot", catalogId: BASE,
            downloadUrl: handoff.canvasDesign.downloadUrl }, local: localBase,
        installed: handoff.workflow.installed.extensions.find((entry) => entry.id === BASE) };
    const verify = async (child, kind, localId) => verifyLocal(child, handoff, kind, localId, safeRun);
    start = performance.now();
    await installPackage(project, "extensions", base, command, warnings, verify);
    const initialBase = localBase ? null : await verifyBase(project, handoff, safeRun);
    warnings.push(...(initialBase?.warnings ?? []));
    timings.base = elapsed(start);
    start = performance.now();
    const bundleCount = await installBundles(project, handoff, command, warnings, download);
    if (bundleCount) {
        await installPackage(project, "extensions", base, command, warnings, verify);
    }
    const baseResult = bundleCount && !localBase
        ? await verifyBase(project, handoff, safeRun) : null;
    warnings.push(...(baseResult?.warnings ?? []));
    timings.bundles = elapsed(start);
    const selections = { extensions: [], presets: [] };
    for (const kind of ["extensions", "presets"]) {
        start = performance.now();
        if (kind === "presets" && localBase) await materializeDevSkills(project, localBase.path);
        const reserved = new Set();
        for (const item of standalone(handoff, kind)) {
            const actual = await installPackage(project, kind, item, command, warnings, verify, reserved);
            if (item.selected && !item.local) {
                if (reserved.has(actual.id)) {
                    throw new Error(`Selected ${kind} manifest ${actual.id} belongs to multiple catalog entries`);
                }
                reserved.add(actual.id);
                selections[kind].push({ catalogId: item.locator.catalogId,
                    source: item.locator.source, id: actual.id, version: actual.version,
                    installedSource: actual.source });
            }
        }
        timings[kind] = elapsed(start);
    }
    start = performance.now();
    await verifyRuntime(project, handoff, command, warnings);
    for (const kind of ["extensions", "presets"]) {
        for (const local of handoff.localSelections?.[kind] ?? []) {
            await verify(project, kind, local.id);
        }
    }
    await verifyComposedLoadPage(project, command);
    await writeSetupRecord(root, id, hash, selections);
    timings.inventory = elapsed(start);
    return { stage: "installed", timings, warnings: uniqueWarnings(warnings) };
}

export async function finalizeDesignerSetup(project, root, id, hash, {
    run = exec, check = preflight, verifyLocal = verifyLocalInstall,
    verifyBase = verifyHostedCanvasDesign,
} = {}) {
    const start = performance.now();
    const safeRun = directRun(run);
    await check(project, root, id, hash, safeRun);
    const handoff = await readHandoff(root, id, undefined, hash);
    const selections = await readSetupRecord(root, id, hash, handoff);
    const command = (args) => runSpecify(project, args, run);
    const warnings = [];
    await verifyRuntime(project, handoff, command, warnings);
    for (const kind of ["extensions", "presets"]) {
        for (const local of handoff.localSelections?.[kind] ?? []) {
            await verifyLocal(project, handoff, kind, local.id, safeRun);
        }
        for (const selected of selections[kind]) {
            const approved = handoff.selections[kind].find((entry) =>
                entry.id === selected.catalogId && entry.source === selected.source);
            const actual = await inspectPackage(project, kind, {
                selected: approved,
                locator: { installedId: selected.id, catalogId: selected.catalogId,
                    source: selected.source, downloadUrl: approved.downloadUrl },
            }, command, warnings);
            if (actual.version !== selected.version || actual.source !== selected.installedSource) {
                throw new Error(`Selected ${kind} ${selected.id} changed after installation`);
            }
        }
    }
    const base = handoff.localSelections?.extensions?.some((entry) => entry.id === BASE);
    if (!base) {
        const result = await verifyBase(project, handoff, safeRun);
        warnings.push(...result.warnings);
    }
    const composed = await verifyComposedLoadPage(project, command);
    const verifier = join(project, ".specify", "extensions", BASE, "scripts", "verify-launch.mjs");
    let verified;
    try { await access(verifier); verified = true; }
    catch (error) {
        if (error.code !== "ENOENT") throw error;
        verified = false;
    }
    if (!verified) {
        return { stage: "manual-resolution", timings: { finalize: elapsed(start) },
            warnings: uniqueWarnings(warnings) };
    }
    await verifyPresetRegistrations(project, handoff, composed.stack, verifier, composed.skill);
    const options = await specifySpawnOptions(project, {
        timeout: 120000, maxBuffer: 2 * 1024 * 1024,
        shell: false,
    });
    options.env = { ...options.env, COLUMNS: "8192", NO_COLOR: "1" };
    const { stdout, stderr = "" } = await run("node", [verifier, project], options);
    if (stderr.trim()) throw new Error(`Designer composition verification warning: ${stderr}`);
    const result = JSON.parse(stdout);
    if (!Array.isArray(result.pages) || !Array.isArray(result.templates)) {
        throw new Error("Designer composition verifier returned an incomplete open input");
    }
    const openInput = { handoffId: id, pages: result.pages, templates: result.templates };
    checkSchema(openInput, designerOpenInputSchema, "Designer open input");
    return { stage: "ready", openInput,
        timings: { finalize: elapsed(start) }, warnings: uniqueWarnings(warnings) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const [, , stage, project, root, id, hash] = process.argv;
        if (!["install", "finalize"].includes(stage) || !project || !root || !id || !hash) {
            throw new Error("Expected install|finalize <child-checkout> <session-root> <handoff-id> <sha256>.");
        }
        const result = stage === "install"
            ? await installDesignerSetup(project, root, id, hash)
            : await finalizeDesignerSetup(project, root, id, hash);
        console.log(JSON.stringify(result));
    } catch (error) {
        console.error(`Designer setup failed: ${error.message}`);
        process.exitCode = 1;
    }
}
