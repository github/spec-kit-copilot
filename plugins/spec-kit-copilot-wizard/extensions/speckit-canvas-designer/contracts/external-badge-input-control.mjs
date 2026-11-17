const idPattern = /^[a-z][a-z0-9-]{0,79}$/;
const controlPattern = /^[a-z][a-z0-9.-]{0,79}$/;
const inputTypes = new Set(["artifact", "artifact-set", "ordered-artifacts", "phase", "text", "badge-selection"]);
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const keys = (value, names) => Object.keys(value).filter((key) => key !== "$schema")
    .sort().join() === [...names].sort().join();

export function validateBadgeInputControl(value, name) {
    if (!record(value) || !keys(value, ["schemaVersion", "id", "adapter", "inputTypes",
        ...(value.capabilities === undefined ? [] : ["capabilities"])])
        || value.schemaVersion !== 1 || !controlPattern.test(value.id)
        || !idPattern.test(value.adapter) || !Array.isArray(value.inputTypes)
        || value.inputTypes.length < 1 || value.inputTypes.length > inputTypes.size
        || new Set(value.inputTypes).size !== value.inputTypes.length
        || value.inputTypes.some((type) => !inputTypes.has(type))
        || value.capabilities !== undefined && (!Array.isArray(value.capabilities)
            || value.capabilities.length !== 1
            || value.capabilities[0] !== "declare-markdown-output")) {
        throw new Error(`${name}: invalid Designer badge input control`);
    }
}

export function validateBadgeInputBinding(value, name) {
    if (!record(value) || !keys(value, ["schemaVersion", "id", "rule", "control"])
        || value.schemaVersion !== 1 || !idPattern.test(value.id)
        || !idPattern.test(value.rule) || !controlPattern.test(value.control)
        || value.id !== value.rule) {
        throw new Error(`${name}: invalid Designer badge rule/control binding`);
    }
}

export function validateBadgeInputAdapterIdentity(entry, binding, exports) {
    const literalExport = (name, pattern) => {
        const declaration = exports.find((item) => item.n === name);
        if (!declaration || !/(?:^|\n)[ \t]*export[ \t]+const[ \t]+$/
            .test(entry.document.slice(0, declaration.s))) return null;
        return entry.document.slice(declaration.e).match(pattern)?.[1] ?? null;
    };
    const id = literalExport("controlId",
        /^\s*=\s*["']([a-z][a-z0-9.-]{0,79})["']\s*;/);
    const version = literalExport("contractVersion", /^\s*=\s*(1)\s*;/);
    const declares = exports.some((item) => item.n === "declaresMarkdownOutput");
    const expected = binding.capabilities?.includes("declare-markdown-output") === true;
    if (id !== binding.control || version !== "1" || declares !== expected
        || (expected
            && literalExport("declaresMarkdownOutput", /^\s*=\s*(true)\s*;/) !== "true")) {
        throw new Error(`${entry.name}: incompatible Designer badge input adapter for ${binding.rule}`);
    }
}

export function resolveBadgeInputControls(loaded, types, rules) {
    const controls = loaded.filter((item) => item.kind === "designer.badge-input-control");
    const bindings = loaded.filter((item) => item.kind === "designer.badge-input-binding");
    const adapters = loaded.filter((item) => item.kind === "designer.badge-input-adapter");
    if (controls.length > 30 || bindings.length > 30 || adapters.length > 30) {
        throw new Error("Designer badge input controls exceed their limit");
    }
    const unique = (entries, key, label) => {
        const seen = new Map();
        for (const entry of entries) {
            const id = entry.document[key];
            if (seen.has(id)) throw new Error(`${entry.name}: duplicate ${label} ${id} also defined by ${seen.get(id)}`);
            seen.set(id, entry.name);
        }
    };
    unique(controls, "id", "badge input control");
    unique(bindings, "rule", "badge rule/control binding");
    unique(controls, "adapter", "badge input adapter assignment");
    const resolved = [];
    const requiredRules = new Set([
        ...bindings.map((binding) => binding.document.rule),
        ...types.filter((type) => type.document.enabled).map((type) => type.document.rule),
    ]);
    for (const rule of rules.filter((entry) => requiredRules.has(entry.document.id))) {
        const binding = bindings.find((item) => item.document.rule === rule.document.id);
        if (!binding) throw new Error(`${rule.name}: missing Designer badge input binding for ${rule.document.id}`);
        const control = controls.find((item) => item.document.id === binding.document.control);
        if (!control) throw new Error(`${binding.name}: missing Designer badge input control ${binding.document.control}`);
        const adapter = adapters.find((item) => item.name === control.document.adapter);
        if (!adapter) throw new Error(`${control.name}: missing Designer badge input adapter ${control.document.adapter}`);
        for (const input of rule.document.inputs) {
            if (!control.document.inputTypes.includes(input.type)) {
                throw new Error(`${binding.name}: ${control.document.id} does not support ${rule.document.id}.${input.id} (${input.type})`);
            }
        }
        resolved.push({ rule: rule.document.id, control: control.document.id,
            adapter: adapter.name, binding: binding.name, definition: control.name,
            sourceId: binding.sourceId,
            ...(control.document.capabilities
                ? { capabilities: [...control.document.capabilities] } : {}) });
    }
    for (const binding of bindings) {
        if (!rules.some((rule) => rule.document.id === binding.document.rule)) {
            throw new Error(`${binding.name}: unreferenced Designer badge input binding ${binding.document.rule}`);
        }
    }
    for (const control of controls) {
        if (!bindings.some((binding) => binding.document.control === control.document.id)) {
            throw new Error(`${control.name}: unreferenced Designer badge input control ${control.document.id}`);
        }
    }
    for (const adapter of adapters) {
        if (!controls.some((control) => control.document.adapter === adapter.name)) {
            throw new Error(`${adapter.name}: unreferenced Designer badge input adapter`);
        }
    }
    for (const type of types.filter((entry) => entry.document.enabled)) {
        if (!resolved.some((entry) => entry.rule === type.document.rule)) {
            throw new Error(`${type.name}: missing badge input control for ${type.document.rule}`);
        }
    }
    return resolved;
}
