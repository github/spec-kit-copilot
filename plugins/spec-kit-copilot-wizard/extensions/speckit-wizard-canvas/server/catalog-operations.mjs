import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { CatalogOperationError, validateCatalogRequest } from "../contracts/catalog-operation.mjs";
import { runSpecify, downloadBundle } from "./specify-command.mjs";

export const CATALOG_FIELDS = {
    preset: "cachedPresetItems", extension: "cachedExtensionItems", bundle: "cachedBundleItems",
};
const GROUPS = Object.keys(CATALOG_FIELDS);
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export async function readPackageInventories(project, command = runSpecify) {
    const inventories = {};
    await Promise.all(GROUPS.map(async (group) => {
        let items;
        try { items = JSON.parse(await command(project, [group, "list", "--json"])); }
        catch (cause) {
            throw new CatalogOperationError(`Cannot read ${group} inventory: ${cause.message}`,
                { stage: "inventory", status: 502, cause });
        }
        if (!Array.isArray(items)) throw new CatalogOperationError(`Invalid ${group} inventory`, { status: 502 });
        const seen = new Set();
        inventories[group] = items.map((item) => {
            const id = group === "bundle" ? item?.bundle_id : item?.id;
            if (typeof id !== "string" || !ID.test(id) || seen.has(id)
                || typeof item.version !== "string" || !item.version
                || (group !== "bundle" && (typeof item.enabled !== "boolean"
                    || !Number.isSafeInteger(item.priority)
                    || !["local", "catalog"].includes(item.source?.kind)
                    || (item.source.kind === "catalog" && typeof item.source.catalog !== "string")))) {
                throw new CatalogOperationError(`Invalid ${group} inventory identity/state`, { status: 502 });
            }
            seen.add(id);
            return { ...item, id };
        });
    }));
    return inventories;
}

function selectPackage(inst, request) {
    if (request.action === "remove") {
        return { id: request.name, installedId: request.name, source: "local" };
    }
    if (!inst._verifiedCatalogFields?.has(CATALOG_FIELDS[request.group])) {
        throw new CatalogOperationError("Package catalog has not been loaded from its configured source; reopen the Wizard before installing");
    }
    let matches = (inst[CATALOG_FIELDS[request.group]] ?? []).filter((item) =>
        item.id === request.name
        && (request.source === undefined || item.source === request.source));
    if (request.downloadUrl != null) matches = matches.filter((item) => item.downloadUrl === request.downloadUrl);
    if (request.bundleYml != null) matches = matches.filter((item) => item.bundleYml === request.bundleYml);
    if (request.source === undefined && request.downloadUrl == null && request.bundleYml == null) {
        const defaults = matches.filter((item) => item.source === "default");
        if (defaults.length) matches = defaults;
    }
    if (matches.length !== 1) {
        throw new CatalogOperationError("Package source is missing, ambiguous, or changed; refresh the catalog and select it again");
    }
    const item = matches[0];
    validateCatalogRequest(request.kind, { name: request.name, downloadUrl: item.downloadUrl, bundleYml: item.bundleYml });
    if (item.source !== "default" && !item.downloadUrl && !item.bundleYml) {
        throw new CatalogOperationError("This source needs an explicit catalog download URL or bundle manifest");
    }
    if (item.installAllowed === false
        && request.downloadUrl == null && request.bundleYml == null) {
        throw new CatalogOperationError("Confirm the exact community download or manifest in the Wizard", { status: 403 });
    }
    if (item.installAllowed === false && request.confirmed !== true) {
        throw new CatalogOperationError("Confirm this community package in the Wizard before installing", { status: 403 });
    }
    return { ...item };
}

export async function mutateCatalogPackage(inst, kind, payload, {
    command = runSpecify, download = downloadBundle, inventories = readPackageInventories,
    observe = () => {},
} = {}) {
    const request = validateCatalogRequest(kind, payload);
    const selected = selectPackage(inst, request);
    const project = await realpath(inst.workspacePath);
    const timings = {};
    let stage = "inventory", changed = false, before, after, directory, failure;
    let id = selected.installedId ?? selected.id;
    validateCatalogRequest(request.kind, { name: id });
    const measure = async (name, fn) => {
        const start = performance.now();
        try { return await fn(); }
        finally { timings[name] = performance.now() - start; }
    };
    try {
        before = await measure("inventoryBefore", () => inventories(project, command));
        observe(before);
        const existing = before[request.group].find((item) => item.id === id);
        if ((request.action === "install" && existing) || (request.action === "remove" && !existing)) {
            if (request.action === "install" && request.group === "bundle") {
                throw new CatalogOperationError("Bundle already installed; its receipt cannot verify this source. Nothing was reinstalled or replaced", { status: 409 });
            }
            if (request.action === "install"
                && ((request.group !== "bundle" && !existing.enabled)
                    || (selected.version && existing.version !== selected.version)
                    || (request.priority !== undefined && existing.priority !== request.priority)
                    || (existing.source?.kind === "catalog" && existing.source.catalog !== selected.source)
                    || (existing.source?.kind === "local" && selected.source !== "local"))) {
                throw new CatalogOperationError("A different version, source, or priority is already installed; installation will not overwrite it", { status: 409 });
            }
            return { request, selected, id, before, after: before, changed: false, timings };
        }
        const args = [request.group, request.action === "install"
            ? request.group === "bundle" ? "install" : "add" : "remove", request.action === "remove" ? id : selected.id];
        if (request.action === "install") {
            if (request.group === "bundle" && (selected.downloadUrl || selected.bundleYml)) {
                stage = "source";
                directory = await mkdtemp(join(tmpdir(), "speckit-catalog-"));
                args[2] = join(directory, selected.bundleYml ? "bundle.yml" : "bundle.zip");
                await measure("source", () => selected.bundleYml
                    ? writeFile(args[2], selected.bundleYml, { flag: "wx" })
                    : download(selected.downloadUrl, args[2]));
            } else if (selected.downloadUrl) {
                validateCatalogRequest(kind, { name: request.name, downloadUrl: selected.downloadUrl });
                args.push("--from", selected.downloadUrl);
            }
            if (request.priority !== undefined) args.push("--priority", String(request.priority));
        } else if (request.group === "extension") {
            // This flag confirms the requested removal; it never authorizes install replacement.
            args.push("--force");
        }
        stage = "command";
        changed = true; // A failed command may still have changed a bundle's components.
        await measure("command", () => command(project, args, undefined,
            { confirmApprovedSource: request.action === "remove" || !!(selected.downloadUrl || selected.bundleYml) }));
        stage = "verification";
        after = await measure("inventoryAfter", () => inventories(project, command));
        observe(after);
        if (request.action === "install") {
            const added = after[request.group].filter((item) =>
                !before[request.group].some((previous) => previous.id === item.id));
            const actual = after[request.group].find((item) => item.id === id)
                ?? (added.length === 1 ? added[0] : null);
            if (!actual || (request.group !== "bundle" && (!actual.enabled
                || (request.priority !== undefined && actual.priority !== request.priority)))) {
                throw new Error("Specify did not install the expected package state");
            }
            id = actual.id;
            if (selected.version && actual.version !== selected.version) {
                throw new Error(`Catalog version ${selected.version} differs from installed version ${actual.version}`);
            }
        } else if (after[request.group].some((item) => item.id === id)) {
            throw new Error("Specify still reports the removed package");
        }
        return { request, selected, id, before, after, changed: true, timings };
    } catch (cause) {
        let error = cause;
        if (changed) {
            try { after = await inventories(project, command); observe(after); }
            catch (reconcile) { error = new Error(`${cause.message}; inventory reconciliation also failed: ${reconcile.message}`, { cause }); }
        }
        failure = new CatalogOperationError(error.message,
            { status: cause.status ?? 500, stage: cause.stage ?? stage, changed, cause: error });
        failure.inventories = after;
        failure.operation = { request, selected, id };
        failure.timings = timings;
        throw failure;
    } finally {
        if (directory) {
            try { await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
            catch (cause) {
                const error = new CatalogOperationError(`${failure ? `${failure.message}; ` : ""}Package temporary-file cleanup failed: ${cause.message}`,
                    { status: 500, stage: "cleanup", changed, cause });
                Object.assign(error, { inventories: after, operation: { request, selected, id }, timings });
                throw error;
            }
        }
    }
}
