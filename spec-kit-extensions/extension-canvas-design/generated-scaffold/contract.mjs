import { isWindowsDeviceName, safePath, UserError } from "./files.mjs";
import { validateValue } from "./contracts/external-value-provider.mjs";
export { validateValue } from "./contracts/external-value-provider.mjs";

const outputs = {
    constitution: ".specify/memory/constitution.md",
    specify: "specs/<slug>/spec.md", clarify: "specs/<slug>/spec.md",
    plan: "specs/<slug>/plan.md", tasks: "specs/<slug>/tasks.md",
    implement: "specs/<slug>/tasks.md", checklist: "specs/<slug>/checklists/<name>.md",
};
function phaseLabel(id) {
    const short = id.replace(/^speckit\./, "");
    return short.split(/[._-]/)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}
export function phaseContract(config) {
    const ids = new Set();
    const artifacts = config.phaseArtifacts === undefined ? {} : config.phaseArtifacts;
    const descriptions = config.phaseDescriptions === undefined ? {} : config.phaseDescriptions;
    if (!descriptions || typeof descriptions !== "object" || Array.isArray(descriptions)
        || Object.entries(descriptions).some(([id, description]) =>
            !config.phases.includes(id) || typeof description !== "string"
            || !description.trim() || description.length > 240)) {
        throw new UserError("Invalid phase descriptions.");
    }
    if (!artifacts || typeof artifacts !== "object" || Array.isArray(artifacts)
        || Object.keys(artifacts).some((id) => !config.phases.includes(id))) throw new UserError("Invalid phase artifact configuration.");
    return config.phases.map((id) => {
        if (typeof id !== "string" || !/^(?:speckit\.)?[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(id) || ids.has(id)) {
            throw new UserError("Invalid or duplicate generated phase.");
        }

        ids.add(id);
        const short = id.replace(/^speckit\./, "");
        const command = `speckit.${short}`;
        const declared = config.phaseOutputs[id]?.outputPath;
        const configured = artifacts[id];
        if (configured && (typeof configured !== "object" || Array.isArray(configured)
            || Object.keys(configured).sort().join() !== "outputs,view"
            || !Array.isArray(configured.outputs) || configured.outputs.length > 100
            || (configured.view !== null && !configured.outputs.includes(configured.view)))) {
            throw new UserError("Invalid phase artifact outputs or viewer target.");
        }
        if (Object.hasOwn(artifacts, id) && !configured) throw new UserError("Invalid phase artifact configuration.");
        const mapping = short === "constitution" ? null : configured;
        const output = short === "constitution" ? outputs.constitution : mapping ? mapping.view
            : (config.phaseOutputs[id]?.expectsArtifact === false ? null : declared || outputs[short] || null);
        const paths = mapping?.outputs ?? (output ? [output] : []);
        const normalized = paths.map((path) => safePath(path, true));
        if (new Set(normalized.map((path) => path.toLowerCase())).size !== normalized.length) throw new UserError("Duplicate phase output path.");
        for (const path of normalized) {
            if (!path.endsWith(".md") || /^(?:\.git|\.github|node_modules|\.speckit-canvas)\//i.test(path)
                || /^\.specify\/(?:extensions|presets|templates)\//i.test(path)
                || (mapping && ([...path].length > 1000 || /\x7f/.test(path)))
                || (mapping && (path.includes("<name>") || path.startsWith("<slug>/")
                    || path.split("/").filter((part) => part === "<slug>").length > 1
                    || (short === "constitution" && path.includes("<slug>"))))) {
                throw new UserError("Phase outputs must be workflow Markdown artifacts.");
            }
        }
        return { id, label: phaseLabel(id), description: descriptions[id] ?? null,
            command, skill: command.replaceAll(".", "-"),
            output: output ? safePath(output, true) : null,
            outputs: normalized, configuredArtifacts: !!mapping,
            expectsArtifact: short === "constitution" ? true
                : mapping ? mapping.outputs.length > 0 : config.phaseOutputs[id]?.expectsArtifact,
            project: short === "constitution", first: short === "specify" };
    });
}

const fieldId = /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/;
const moduleId = /^[a-z][a-z0-9-]{0,79}$/;

export function valueContract(config) {
    const fields = config.valueSources ?? [];
    if (!Array.isArray(fields) || fields.length > 100) throw new UserError("Invalid generated value fields.");
    const readableIds = new Set((config.readOnlyFields ?? []).map(({ id }) => id));
    const ids = new Set([...readableIds,
        ...(config.generatedControls ?? []).map(({ id }) => id)]);
    const sections = new Map((config.readOnlyFields ?? []).filter(({ section }) => section)
        .map(({ section }) => [section.id, section.title]));
    for (const field of fields) {
        if (!field || typeof field !== "object" || Array.isArray(field)
            || Object.keys(field).some((key) => !["id", "label", "schema", "source", "presentation", "section", "provenance"].includes(key))
            || typeof field.id !== "string" || !fieldId.test(field.id) || ids.has(field.id)
            || typeof field.label !== "string" || !field.label.trim() || field.label.length > 120
            || !["stock.readonly", "stock.editable", "processing-only"].includes(field.presentation)
            || !field.schema || typeof field.schema !== "object" || Array.isArray(field.schema)
            || !field.source || typeof field.source !== "object" || Array.isArray(field.source)
            || (field.provenance !== undefined && (typeof field.provenance !== "string"
                || !/^[A-Za-z0-9_.:-]{1,160}$/.test(field.provenance)))
            || (field.section !== undefined && (!field.section || typeof field.section !== "object"
                || Array.isArray(field.section) || Object.keys(field.section).sort().join() !== "id,title"
                || typeof field.section.id !== "string" || !/^[a-z][a-z0-9.-]{0,79}$/.test(field.section.id)
                || typeof field.section.title !== "string" || !field.section.title.trim()
                || field.section.title.length > 120))) throw new UserError("Invalid generated value field.");
        ids.add(field.id);
        readableIds.add(field.id);
        if (field.section) {
            if (sections.has(field.section.id) && sections.get(field.section.id) !== field.section.title) {
                throw new UserError(`Conflicting generated value section ${field.section.id}.`);
            }
            sections.set(field.section.id, field.section.title);
        }
        const schema = field.schema;
        if (schema.type === "string") {
            if (Object.keys(schema).some((key) => !["type", "maxLength", "minLength", "pattern"].includes(key))
                || !Number.isInteger(schema.maxLength) || schema.maxLength < 1 || schema.maxLength > 1000
                || (schema.minLength !== undefined && (!Number.isInteger(schema.minLength)
                    || schema.minLength < 0 || schema.minLength > schema.maxLength))
                || (schema.pattern !== undefined && (typeof schema.pattern !== "string" || schema.pattern.length > 120
                    || (() => { try { new RegExp(schema.pattern); return false; } catch { return true; } })()))) {
                throw new UserError(`Invalid value schema for ${field.id}.`);
            }
        } else if (schema.type === "boolean") {
            if (Object.keys(schema).sort().join() !== "type") throw new UserError(`Invalid value schema for ${field.id}.`);
        } else if (schema.type === "object") {
            if (Object.keys(schema).sort().join() !== "properties,type"
                || !schema.properties || typeof schema.properties !== "object" || Array.isArray(schema.properties)
                || !Object.keys(schema.properties).length || Object.keys(schema.properties).length > 10
                || Object.entries(schema.properties).some(([key, options]) =>
                    !/^[a-z][A-Za-z0-9]{0,39}$/.test(key)
                    || !Array.isArray(options) || !options.length || options.length > 20
                    || new Set(options).size !== options.length
                    || options.some((option) => typeof option !== "string" || !option || option.length > 80))) {
                throw new UserError(`Invalid value schema for ${field.id}.`);
            }
        } else throw new UserError(`Invalid value schema for ${field.id}.`);
        const source = field.source;
        if (source.kind === "computed") {
            if (Object.keys(source).sort().join() !== "hash,kind,module"
                || typeof source.module !== "string" || !moduleId.test(source.module)
                || isWindowsDeviceName(source.module)
                || typeof source.hash !== "string" || !/^[a-f0-9]{64}$/.test(source.hash)
                || field.presentation === "stock.editable") {
                throw new UserError(`Invalid value provider for ${field.id}.`);
            }
        } else if (source.kind === "constant") {
            if (Object.keys(source).sort().join() !== "kind,value") {
                throw new UserError(`Invalid value source for ${field.id}.`);
            }
            validateValue(schema, source.value, field.id);
        } else throw new UserError(`Invalid value source for ${field.id}.`);
    }
    for (const page of config.generatedPages ?? []) {
        if (page.values !== undefined && (!Array.isArray(page.values) || page.values.length > 100
            || new Set(page.values).size !== page.values.length
            || page.values.some((id) => !readableIds.has(id)))) {
            throw new UserError(`Invalid declared values for page ${page.id}.`);
        }
    }
    return fields;
}
