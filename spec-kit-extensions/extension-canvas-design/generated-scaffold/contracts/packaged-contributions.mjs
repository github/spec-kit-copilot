import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { phaseControlInterface } from "./external-host-adapter.mjs";

const imageValueContract = { type: "image", maxBytes: 32768,
    mimeTypes: ["image/png", "image/jpeg", "image/gif", "image/webp"] };

export function readFieldPlacement(placement, readPackagedFile) {
    const bytes = readPackagedFile(new URL(`../pages/${placement.id}.json`, import.meta.url));
    const { $schema, ...definition } = JSON.parse(bytes);
    if (createHash("sha256").update(bytes).digest("hex") !== placement.hash
        || !isDeepStrictEqual(definition, { schemaVersion: 1,
            id: placement.id, page: placement.page, slot: placement.slot,
            field: placement.field, order: placement.order,
            ...(definition.control === undefined ? {} : { control: placement.control }) })) {
        throw new Error(`Packaged field placement ${placement.id} differs from its frozen contract`);
    }
}

export function readPlacementControl(item, readPackagedFile) {
    const bytes = readPackagedFile(new URL(`../controls/${item.adapter}.mjs`, import.meta.url));
    const definition = readPackagedFile(new URL(`../controls/${item.definition}.json`, import.meta.url));
    const { $schema, ...document } = JSON.parse(definition);
    if (createHash("sha256").update(bytes).digest("hex") !== item.adapterHash
        || createHash("sha256").update(definition).digest("hex") !== item.definitionHash
        || document.id !== item.control || document.adapters?.generated !== item.adapter
        || !isDeepStrictEqual(document.value, item.schema)) {
        throw new Error(`Packaged placement control ${item.control} differs from its frozen contract`);
    }
    return bytes;
}

export function readWorkflowPage(page, readPackagedFile) {
    const definition = readPackagedFile(new URL("../pages/workflow.json", import.meta.url));
    if (createHash("sha256").update(definition).digest("hex") !== page.definitionHash) {
        throw new Error("Packaged Workflow page definition does not match its frozen hash");
    }
    const parsed = JSON.parse(definition);
    if (parsed.schemaVersion !== 1 || parsed.id !== "workflow"
        || Object.keys(parsed).filter((key) => key !== "$schema").sort().join() !== "id,order,schemaVersion,slots,title"
        || parsed.title !== page.title || parsed.order !== page.order
        || JSON.stringify(parsed.slots) !== JSON.stringify(page.slots)) {
        throw new Error("Packaged Workflow page definition differs from its frozen contract");
    }
    const control = readPackagedFile(new URL("../pages/phase-control.json", import.meta.url));
    if (createHash("sha256").update(control).digest("hex") !== page.controlHash) {
        throw new Error("Packaged phase control definition does not match its frozen hash");
    }
    const registration = JSON.parse(control);
    if (registration.schemaVersion !== 1 || registration.id !== phaseControlInterface.controlId
        || registration.adapter !== page.adapter
        || Object.keys(registration).filter((key) => key !== "$schema")
            .some((key) => !["adapter", "id", "managedRun", "placement", "schemaVersion", "slots", "viewLabels"].includes(key))
        || (registration.managedRun !== undefined && typeof registration.managedRun !== "boolean")
        || page.managedRun !== (registration.managedRun === true)
        || !registration.placement || Object.keys(registration.placement).sort().join() !== "page,slot"
        || registration.placement.page !== "workflow" || registration.placement.slot !== "workflow.phases"
        || !isDeepStrictEqual(registration.placement, page.placement)
        || !isDeepStrictEqual(registration.viewLabels ?? {}, page.viewLabels)
        || !isDeepStrictEqual(registration.slots ?? [], page.phaseSlots)) {
        throw new Error("Packaged phase control definition differs from its frozen contract");
    }
    const bytes = readPackagedFile(new URL(`../pages/${page.adapter}.mjs`, import.meta.url));
    if (!bytes.length || bytes.length > 32 * 1024
        || createHash("sha256").update(bytes).digest("hex") !== page.hash) {
        throw new Error("Packaged phase control adapter does not match its frozen hash");
    }
    return bytes;
}
export function readImageAsset(asset, readPackagedFile) {
    const bytes = readPackagedFile(new URL(`../assets/${asset.file}`, import.meta.url));
    if (!bytes.length || bytes.length > 32 * 1024
        || createHash("sha256").update(bytes).digest("hex") !== asset.hash) {
        throw new Error("Packaged image does not match its frozen hash");
    }
    return bytes;
}

export function readImageControl(control, readPackagedFile) {
    const bytes = readPackagedFile(new URL(`../controls/${control.adapter}.mjs`, import.meta.url));
    if (!bytes.length || bytes.length > 32 * 1024
        || createHash("sha256").update(bytes).digest("hex") !== control.hash) {
        throw new Error("Packaged stock.image adapter does not match its frozen hash");
    }
    const definition = readPackagedFile(new URL(`../controls/${control.definition}.json`, import.meta.url));
    const parsed = JSON.parse(definition);
    if (createHash("sha256").update(definition).digest("hex") !== control.definitionHash
        || parsed.id !== "stock.image" || parsed.adapters?.generated !== control.adapter
        || JSON.stringify(Object.entries(parsed.value ?? {}).sort())
            !== JSON.stringify(Object.entries(imageValueContract).sort())) {
        throw new Error("Packaged stock.image definition does not match its frozen contract");
    }
    return bytes;
}
export function readTextControl(control, readPackagedFile) {
    const bytes = readPackagedFile(new URL(`../controls/${control.adapter}.mjs`, import.meta.url));
    if (!bytes.length || bytes.length > 32 * 1024
        || createHash("sha256").update(bytes).digest("hex") !== control.hash) {
        throw new Error("Packaged stock.text adapter does not match its frozen hash");
    }
    const definition = readPackagedFile(new URL(`../controls/${control.definition}.json`, import.meta.url));
    const parsed = JSON.parse(definition);
    if (createHash("sha256").update(definition).digest("hex") !== control.definitionHash
        || parsed.id !== "stock.text" || parsed.adapters?.generated !== control.adapter
        || JSON.stringify(parsed.value) !== JSON.stringify({ type: "string" })) {
        throw new Error("Packaged stock.text definition does not match its frozen contract");
    }
    return bytes;
}
