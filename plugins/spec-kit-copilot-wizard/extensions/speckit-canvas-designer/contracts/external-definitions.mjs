import { PAGE_NAME, isWindowsDeviceName } from "./host-open.mjs";
import { RULES } from "./external-design-contributions.mjs";
import { validControlContract } from "./external-control-adapter.mjs";

const PAGE_PATTERN = new RegExp(PAGE_NAME);
const contractKeys = (document) => Object.keys(document).filter((key) => key !== "$schema");
function schemaMetadata(document, name) {
    if (document && typeof document === "object"
        && Object.hasOwn(document, "$schema") && typeof document.$schema !== "string") {
        throw new Error(`${name}: invalid $schema reference`);
    }
}
// The generated shell uses "workflow" for its built-in page navigation.
const RESERVED_GENERATED_PAGE_ID = "workflow";
export function validateContribution(document, name, slots, fieldOrigins) {
    schemaMetadata(document, name);
    const keys = ["schemaVersion", "id", "host", "slot", "order", "field", "requires",
        "generatedBinding"];
    if (!document || typeof document !== "object" || Array.isArray(document)
        || contractKeys(document).some((key) => !keys.includes(key))
        || document.schemaVersion !== 1 || typeof document.id !== "string"
        || !/^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(document.id)
        || document.host !== "designer" || !Number.isInteger(document.order)
        || document.order < -100000 || document.order > 100000
        || typeof document.slot !== "string") {
        throw new Error(`${name}: invalid Canvas Design contribution`);
    }
    const field = document.field;
    if (!field || typeof field !== "object" || Array.isArray(field)
        || Object.keys(field).some((key) =>
            !["id", "label", "description", "type", "default", "control", "maxLength", "required"].includes(key))
        || typeof field.id !== "string" || !/^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(field.id)
        || typeof field.label !== "string" || !field.label || field.label.length > 120
        || (field.description !== undefined
            && (typeof field.description !== "string" || field.description.length > 1000))
        || !["string", "boolean", "object", "image"].includes(field.type)
        || (Object.hasOwn(RULES, field.id) && RULES[field.id].type !== field.type)
        || (field.type === "object"
            ? !PAGE_PATTERN.test(field.control)
            : field.control !== (field.type === "boolean" ? "stock.checkbox"
                : field.type === "image" ? "stock.image" : "stock.text"))
        || (field.maxLength !== undefined && (field.type !== "string"
            || !Number.isInteger(field.maxLength) || field.maxLength < 1
            || field.maxLength > 1000))
        || (field.required !== undefined && (field.type !== "string" || field.required !== true))
        || (Object.hasOwn(field, "default")
            && (field.type !== "boolean" || typeof field.default !== "boolean"))) {
        throw new Error(`${name}: incompatible field or control definition`);
    }
    if (document.requires !== undefined
        && (!Array.isArray(document.requires)
            || document.requires.length !== 1
            || typeof document.requires[0] !== "string")) {
        throw new Error(`${name}: requires must name exactly one control definition template`);
    }
    const binding = document.generatedBinding;
    if (field.type === "image" && binding === undefined) {
        throw new Error(`${name}: image asset requires a generated placement`);
    }
    if (binding !== undefined
        && (!binding
            || typeof binding !== "object" || Array.isArray(binding)
            || (["object", "image"].includes(field.type)
                ? (field.type === "image"
                    ? Object.keys(binding).sort().join() !== (binding.page === undefined
                        ? "presentation,slot" : "page,presentation,slot")
                        || (binding.page !== undefined && !PAGE_PATTERN.test(binding.page))
                    : Object.keys(binding).sort().join() !== "presentation,slot")
                    || binding.presentation !== (field.type === "image" ? "asset" : "control")
                    || (field.type === "image"
                        ? binding.page === undefined
                            ? !["header.brand", "workflow.intro"].includes(binding.slot)
                            : typeof binding.slot !== "string"
                                || !/^[a-z][a-z0-9.-]{0,79}$/.test(binding.slot)
                        : binding.slot !== "details.content")
                : field.type !== "string"
                    || !(binding.presentation === "stock.readonly"
                        && Object.keys(binding).every((key) => ["presentation", "section"].includes(key))
                        || binding.presentation === "text"
                        && Object.keys(binding).sort().join() === "presentation,slot"
                        && ((field.id === "canvas.description" && binding.slot === "workflow.description")
                            || (field.id === "canvas.workflowListName" && binding.slot === "workflow.heading"))))
            || (binding.section !== undefined
                && (!binding.section || typeof binding.section !== "object"
                    || Array.isArray(binding.section)
                    || Object.keys(binding.section).sort().join() !== "id,title"
                    || typeof binding.section.id !== "string"
                    || !/^[a-z][a-z0-9.-]{0,79}$/.test(binding.section.id)
                    || typeof binding.section.title !== "string"
                    || !binding.section.title.trim() || binding.section.title.length > 120)))) {
        throw new Error(`${name}: incompatible generated binding`);
    }
    if (!slots.get(document.slot)?.slot) {
        throw new Error(`${name}: unknown Designer slot ${document.slot}`);
    }
    if (fieldOrigins.has(field.id)) {
        throw new Error(`${name}: duplicate field ${field.id} also defined by ${fieldOrigins.get(field.id)}`);
    }
    fieldOrigins.set(field.id, name);
}

export function validateControl(document, name) {
    schemaMetadata(document, name);
    const properties = document?.value?.properties;
    const image = document?.value?.type === "image";
    const scalar = document?.value?.type === "string"
        || document?.value?.type === "boolean";
    const checkbox = document?.id === "stock.checkbox";
    if (!document || typeof document !== "object" || Array.isArray(document)
        || contractKeys(document).sort().join() !== "adapters,id,schemaVersion,value"
        || document.schemaVersion !== 1
        || (image ? document.id !== "stock.image"
            : scalar ? document.id !== (checkbox ? "stock.checkbox" : "stock.text")
                : !PAGE_PATTERN.test(document.id) || isWindowsDeviceName(document.id))
        || !document.value || (image
            ? Object.keys(document.value).sort().join() !== "maxBytes,mimeTypes,type"
                || document.value.maxBytes !== 32 * 1024
                || JSON.stringify(document.value.mimeTypes)
                    !== '["image/png","image/jpeg","image/gif","image/webp"]'
            : scalar
                ? Object.keys(document.value).sort().join() !== "type"
                    || document.value.type !== (checkbox ? "boolean" : "string")
                : !validControlContract(document.value))
        || !document.adapters || Object.keys(document.adapters).sort().join() !== "designer,generated"
            && !(checkbox && Object.keys(document.adapters).sort().join() === "designer")
        || !PAGE_PATTERN.test(document.adapters.designer)
        || (!checkbox && !PAGE_PATTERN.test(document.adapters.generated))) {
        throw new Error(`${name}: invalid shared control value contract or adapter references`);
    }
}

export function validateGeneratedPage(document, name) {
    schemaMetadata(document, name);
    if (!document || typeof document !== "object" || Array.isArray(document)
        || contractKeys(document).some((key) => !["id", "renderer", "schemaVersion", "title", "order", "values", "slots"].includes(key))
        || document.schemaVersion !== 1 || document.id !== name
        || [RESERVED_GENERATED_PAGE_ID, "setup"].includes(document.id) || isWindowsDeviceName(document.id)
        || typeof document.title !== "string" || !document.title.trim()
        || (document.order !== undefined && (!Number.isInteger(document.order)
            || document.order < -100000 || document.order > 100000))
        || document.title.length > 120 || typeof document.renderer !== "string"
        || !PAGE_PATTERN.test(document.renderer)
        || isWindowsDeviceName(document.renderer)
        || (document.values !== undefined && (!Array.isArray(document.values)
            || document.values.length > 100 || new Set(document.values).size !== document.values.length
            || document.values.some((id) => typeof id !== "string"
                || !/^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(id))))
        || (document.slots !== undefined && (!Array.isArray(document.slots)
            || document.slots.length > 30
            || new Set(document.slots.map((slot) => slot?.id)).size !== document.slots.length
            || document.slots.some((slot) => !slot || typeof slot !== "object"
                || Array.isArray(slot) || Object.keys(slot).join() !== "id"
                || typeof slot.id !== "string" || !/^[a-z][a-z0-9.-]{0,79}$/.test(slot.id)
                || slot.id === "workflow.phases")))) {
        throw new Error(`${name}: invalid generated page definition`);
    }
}

export function validateWorkflowPage(document, name) {
    schemaMetadata(document, name);
    if (!document || typeof document !== "object" || Array.isArray(document)
        || !["id,order,schemaVersion,slots,title",
            "adapter,badgeDestinations,id,order,schemaVersion,slots,title"].includes(
            contractKeys(document).sort().join())
        || document.schemaVersion !== (document.adapter ? 2 : 1)
        || (document.adapter !== undefined && (typeof document.adapter !== "string"
            || !PAGE_PATTERN.test(document.adapter) || isWindowsDeviceName(document.adapter)
            || !Array.isArray(document.badgeDestinations)
            || document.badgeDestinations.length > 4
            || new Set(document.badgeDestinations).size !== document.badgeDestinations.length
            || document.badgeDestinations.some((destination) =>
                !["workflow.list", "workflow.summary", "phase.card", "phase.output"].includes(destination))))
        || document.id !== "workflow" || name !== "generated-workflow"
        || typeof document.title !== "string" || !document.title.trim()
        || document.title.length > 120 || document.order !== 0
        || !Array.isArray(document.slots) || document.slots.length < 1 || document.slots.length > 30
        || document.slots[0]?.id !== "workflow.phases"
        || new Set(document.slots.map((slot) => slot?.id)).size !== document.slots.length
        || document.slots.some((slot) => !slot || typeof slot !== "object"
            || Array.isArray(slot) || Object.keys(slot).join() !== "id"
            || typeof slot.id !== "string" || !/^[a-z][a-z0-9.-]{0,79}$/.test(slot.id))) {
        throw new Error(`${name}: invalid Workflow page definition`);
    }
}

export function validateFieldPlacement(document, name) {
    schemaMetadata(document, name);
    if (!document || typeof document !== "object" || Array.isArray(document)
        || contractKeys(document).some((key) =>
            !["schemaVersion", "id", "page", "slot", "field", "order", "control"].includes(key))
        || document.schemaVersion !== 1 || document.id !== name
        || typeof document.page !== "string" || !PAGE_PATTERN.test(document.page)
        || typeof document.slot !== "string" || !/^[a-z][a-z0-9.-]{0,79}$/.test(document.slot)
        || document.page === "workflow"
            && ["workflow.phases", "workflow.list", "workflow.summary"].includes(document.slot)
        || typeof document.field !== "string" || !/^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(document.field)
        || !Number.isInteger(document.order) || document.order < -100000 || document.order > 100000
        || (document.control !== undefined && (typeof document.control !== "string"
            || !/^[a-z][a-z0-9.-]{0,79}$/.test(document.control)))) {
        throw new Error(`${name}: invalid generated field placement`);
    }
}

export function validatePhaseControl(document, name) {
    schemaMetadata(document, name);
    if (!document || typeof document !== "object" || Array.isArray(document)
        || contractKeys(document).some((key) =>
            !["adapter", "id", "managedRun", "placement", "schemaVersion", "slots", "viewLabels"].includes(key))
        || (document.managedRun !== undefined && typeof document.managedRun !== "boolean")
        || document.schemaVersion !== 1 || document.id !== "workflow-phases"
        || typeof document.adapter !== "string" || !PAGE_PATTERN.test(document.adapter)
        || isWindowsDeviceName(document.adapter)
        || !document.placement || typeof document.placement !== "object"
        || Array.isArray(document.placement)
        || Object.keys(document.placement).sort().join() !== "page,slot"
        || document.placement.page !== "workflow"
        || document.placement.slot !== "workflow.phases"
        || (document.viewLabels !== undefined && (
            !document.viewLabels || typeof document.viewLabels !== "object" || Array.isArray(document.viewLabels)
            || Object.keys(document.viewLabels).length > 40
            || Object.entries(document.viewLabels).some(([id, label]) =>
                !/^(?:speckit\.)?[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(id)
                || typeof label !== "string" || !label.trim() || label.length > 80
                || /[\x00-\x1f\x7f]/.test(label))))
        || (document.slots !== undefined
            && (!Array.isArray(document.slots) || document.slots.length !== 2
                || new Set(document.slots.map((slot) => slot?.id)).size !== 2
                || document.slots.some((slot) => !slot || typeof slot !== "object"
                    || Array.isArray(slot) || Object.keys(slot).join() !== "id"
                    || !["phase.card", "phase.output"].includes(slot.id))))) {
        throw new Error(`${name}: invalid phase control definition`);
    }
}

function validLabel(value, max = 500) {
    return typeof value === "string" && !!value.trim() && value.length <= max;
}

export function validateDialog(document, name) {
    schemaMetadata(document, name);
    if (!document || typeof document !== "object" || Array.isArray(document)
        || contractKeys(document).sort().join() !== "adapter,blocks,buttons,id,schemaVersion,title"
        || document.schemaVersion !== 1 || document.id !== name
        || !PAGE_PATTERN.test(document.adapter) || isWindowsDeviceName(document.adapter)
        || !validLabel(document.title)
        || !Array.isArray(document.blocks) || document.blocks.length < 1 || document.blocks.length > 20
        || !document.buttons || typeof document.buttons !== "object"
        || Array.isArray(document.buttons)
        || Object.keys(document.buttons).sort().join() !== "cancel,confirm"
        || !validLabel(document.buttons.cancel) || !validLabel(document.buttons.confirm)) {
        throw new Error(`${name}: invalid generated dialog definition`);
    }
    const slots = new Set();
    for (const block of document.blocks) {
        if (!block || typeof block !== "object" || Array.isArray(block)) {
            throw new Error(`${name}: invalid dialog block`);
        }
        const keys = Object.keys(block).sort().join();
        if (["heading", "paragraph", "warning"].includes(block.type)
            ? keys !== "text,type" || !validLabel(block.text)
            : block.type === "list" ? keys !== "items,type"
                || !Array.isArray(block.items) || !block.items.length || block.items.length > 20
                || block.items.some((item) => !validLabel(item))
                : block.type === "link" ? keys !== "href,text,type"
                    || !validLabel(block.text) || typeof block.href !== "string"
                    || block.href.length > 2048 || !/^https:\/\/[^\s]+$/.test(block.href)
                    : block.type === "slot" ? keys !== "name,type"
                        || !["pending-packages", "phase"].includes(block.name)
                        || slots.has(block.name)
                        : true) {
            throw new Error(`${name}: invalid dialog block`);
        }
        if (block.type === "slot") slots.add(block.name);
    }
    if (name === "generated-setup-dialog" && !slots.has("pending-packages")) {
        throw new Error(`${name}: setup dialog must show all pending packages`);
    }
}

export function validatePhaseDialogBinding(document, name) {
    schemaMetadata(document, name);
    if (!document || typeof document !== "object" || Array.isArray(document)
        || contractKeys(document).sort().join() !== "dialog,id,phase,schemaVersion"
        || document.schemaVersion !== 1 || document.id !== name
        || !/^speckit\.[a-z][a-z0-9.-]{0,79}$/.test(document.phase)
        || document.phase === "speckit.constitution"
        || !PAGE_PATTERN.test(document.dialog)) {
        throw new Error(`${name}: invalid phase dialog binding`);
    }
}

export function validateButtonControl(document, name) {
    schemaMetadata(document, name);
    if (!document || typeof document !== "object" || Array.isArray(document)
        || contractKeys(document).sort().join() !== "adapter,id,schemaVersion"
        || document.schemaVersion !== 1
        || !((name === "generated-setup-button-control" && document.id === "project.setup-button")
            || (document.id === "dialog.trigger" && PAGE_PATTERN.test(name)))
        || !PAGE_PATTERN.test(document.adapter)) {
        throw new Error(`${name}: invalid generated button control`);
    }
}

export function validateButtonPlacement(document, name) {
    schemaMetadata(document, name);
    if (!document || typeof document !== "object" || Array.isArray(document)
        || contractKeys(document).sort().join() !== "action,control,dialog,id,label,order,page,presentation,schemaVersion,slot"
        || document.schemaVersion !== 1 || document.id !== name
        || !["workflow", "setup"].includes(document.page)
        || document.slot !== `${document.page}.actions`
        || document.control !== (name === "generated-setup-button" ? "project.setup-button" : "dialog.trigger")
        || !Number.isInteger(document.order) || document.order < -100000 || document.order > 100000
        || !validLabel(document.label, 120)
        || !["primary", "secondary"].includes(document.presentation)
        || !PAGE_PATTERN.test(document.dialog)
        || !document.action || typeof document.action !== "object"
        || Array.isArray(document.action) || Object.keys(document.action).join() !== "type"
        || document.action.type !== (name === "generated-setup-button" ? "project.setup" : "dialog.result")
        || (name === "generated-setup-button") !== (document.page === "setup")) {
        throw new Error(`${name}: invalid generated button placement`);
    }
}

export function validateValueSource(document, name, fieldOrigins) {
    schemaMetadata(document, name);
    const schema = document?.schema;
    const source = document?.source;
    const section = document?.section;
    if (!document || typeof document !== "object" || Array.isArray(document)
        || contractKeys(document).some((key) => !["schemaVersion", "id", "label", "schema",
            "source", "presentation", "section"].includes(key))
        || document.schemaVersion !== 1
        || typeof document.id !== "string" || !/^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(document.id)
        || typeof document.label !== "string" || !document.label.trim() || document.label.length > 120
        || !schema || typeof schema !== "object" || Array.isArray(schema)
        || !(schema.type === "string"
            && Object.keys(schema).every((key) => ["type", "maxLength"].includes(key))
            && Number.isInteger(schema.maxLength) && schema.maxLength >= 1 && schema.maxLength <= 1000
            || schema.type === "boolean" && Object.keys(schema).sort().join() === "type"
            || schema.type === "object" && Object.keys(schema).sort().join() === "properties,type"
                && schema.properties && typeof schema.properties === "object"
                && !Array.isArray(schema.properties)
                && Object.keys(schema.properties).length >= 1 && Object.keys(schema.properties).length <= 10
                && Object.entries(schema.properties).every(([key, allowed]) =>
                    /^[a-z][A-Za-z0-9]{0,39}$/.test(key)
                    && Array.isArray(allowed) && allowed.length >= 1 && allowed.length <= 20
                    && new Set(allowed).size === allowed.length
                    && allowed.every((value) => typeof value === "string" && value.length >= 1 && value.length <= 80)))
        || !source || typeof source !== "object" || Array.isArray(source)
        || !(source.kind === "constant" && Object.keys(source).sort().join() === "kind,value"
            || source.kind === "computed" && Object.keys(source).sort().join() === "kind,module"
                && PAGE_PATTERN.test(source.module) && !isWindowsDeviceName(source.module))
        || !["stock.readonly", "stock.editable", "processing-only"].includes(document.presentation)
        || (source.kind === "computed" && document.presentation === "stock.editable")
        || (section !== undefined && (!section || typeof section !== "object"
            || Object.keys(section).sort().join() !== "id,title"
            || typeof section.id !== "string" || !/^[a-z][a-z0-9.-]{0,79}$/.test(section.id)
            || typeof section.title !== "string" || !section.title.trim() || section.title.length > 120))) {
        throw new Error(`${name}: invalid Canvas Design value source`);
    }
    if (source.kind === "constant") {
        const value = source.value;
        if (schema.type === "string" && (typeof value !== "string" || value.length > schema.maxLength)
            || schema.type === "boolean" && typeof value !== "boolean"
            || schema.type === "object" && (!value || typeof value !== "object" || Array.isArray(value)
                || Object.keys(value).sort().join() !== Object.keys(schema.properties).sort().join()
                || Object.entries(schema.properties).some(([key, allowed]) => !allowed.includes(value[key])))) {
            throw new Error(`${name}: invalid typed constant value`);
        }
    }
    if (fieldOrigins.has(document.id)) {
        throw new Error(`${name}: duplicate field ${document.id} also defined by ${fieldOrigins.get(document.id)}`);
    }
    fieldOrigins.set(document.id, name);
}
