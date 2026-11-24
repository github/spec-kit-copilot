import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";

const source = new URL("../extension-canvas-design/", import.meta.url);

export async function addDesignerAdapterFixture(project, model) {
    model.templates ??= [];
    model.controls ??= [];
    model.adapters ??= {};
    const kinds = new Set(Object.values(model.constraints).map(({ type }) =>
        type === "image" ? "image" : type === "boolean" ? "checkbox" : "text"));
    for (const kind of kinds) {
        const definition = JSON.parse(await readFile(new URL(`shared-controls/stock-${kind}/control.json`, source)));
        const existing = model.controls.find((item) => item.id === definition.id);
        if (existing) Object.assign(existing, { ...definition, adapters: { ...definition.adapters, ...existing.adapters } });
        else model.controls.push(definition);
        const name = definition.adapters.designer;
        model.adapters[definition.id] = name;
        const bytes = await readFile(new URL(`shared-controls/stock-${kind}/designer.mjs`, source));
        const path = join(project, ".specify", "templates", `${name}.mjs`);
        await mkdir(join(project, ".specify", "templates"), { recursive: true });
        await writeFile(path, bytes);
        const asset = { name, kind: "designer.control-adapter",
            sourceId: "extension:extension-canvas-design", strategy: "replace",
            path: await realpath(path), hash: createHash("sha256").update(bytes).digest("hex") };
        const index = model.templates.findIndex((entry) => entry.name === name
            && entry.kind === "designer.control-adapter");
        if (index < 0) model.templates.push(asset);
        else model.templates[index] = asset;
    }
    resolveFixtureFields(model);
}

export function resolveFixtureFields(model) {
    const fields = model.pages.flatMap((page) => page.fields ?? []);
    for (const [id, validation] of Object.entries(model.constraints)) {
        let field = fields.find((entry) => entry.id === id);
        if (!field) {
            field = { id, label: model.contributions?.find((item) => item.field.id === id)?.field.label ?? id };
            model.pages[0].fields.push(field);
        }
        field.control ??= validation.type === "image" ? "stock.image"
            : validation.type === "boolean" ? "stock.checkbox" : "stock.text";
        field.label ??= id;
        field.validation = { ...validation,
            ...(id === "canvas.id" ? { forbiddenValues: [
                "speckit-canvas-designer", "speckit-wizard", "speckit-canvas-generator",
            ] } : {}) };
    }
}
