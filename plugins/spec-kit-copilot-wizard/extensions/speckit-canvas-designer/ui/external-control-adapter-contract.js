const selectionContract = new URL("./badge-selection-contract.js", import.meta.url);
selectionContract.search = new URL(import.meta.url).search;
const { validBadgeSelections } = await import(selectionContract.href);

export function validateAdapterModule(adapter, controlId, expected, image, object) {
    if (typeof adapter.mount !== "function") throw new Error("Missing mount export");
    if (typeof adapter.validate !== "function") throw new Error("Missing validate export");
    const valueContract = adapter.valueContract;
    if (adapter.controlId !== controlId || valueContract?.type !== expected?.type
        || (image
            ? valueContract.maxBytes !== expected.maxBytes
                || JSON.stringify(valueContract.mimeTypes) !== JSON.stringify(expected.mimeTypes)
            : object
                ? JSON.stringify(Object.entries(valueContract.properties ?? {}).sort())
                    !== JSON.stringify(Object.entries(expected.properties).sort())
                : Object.keys(valueContract).sort().join() !== "type")) {
        throw new Error("Incompatible control ID or value contract");
    }
}

export function validateAdapterChange(value, rules, id) {
    if (rules.type === "image" ? typeof value !== "string"
        || value.length > Math.ceil(rules.maxBytes / 3) * 4 + 64
        : rules.type === "boolean" ? typeof value !== "boolean"
            : rules.type === "string" ? typeof value !== "string"
                : value !== null && (typeof value !== "object" || Array.isArray(value))) {
        throw new Error(`Invalid Designer setting: ${id}`);
    }
}

export function validateAdapterHandle(handle) {
    if (typeof handle?.isReady !== "function") throw new Error("Missing isReady handle");
}

export function validateBadgeInputAdapter(adapter, binding) {
    if (adapter.controlId !== binding.control || adapter.contractVersion !== 1
        || typeof adapter.mount !== "function") {
        throw new Error(`Incompatible Designer badge input adapter ${binding.adapter}`);
    }
}

export function validBadgePlacementState(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        && Object.keys(value).sort().join() === "phase,summary,workflow"
        && Object.values(value).every((item) => typeof item === "boolean");
}

export function mountBadgeInputAdapter(adapter, binding, context) {
    if (binding.capabilities !== undefined
        && (!Array.isArray(binding.capabilities) || binding.capabilities.length !== 1
            || binding.capabilities[0] !== "declare-markdown-output")) {
        throw new Error(`Incompatible Designer badge input capabilities ${binding.adapter}`);
    }
    const canDeclare = binding.capabilities?.includes("declare-markdown-output") === true;
    validateBadgeInputAdapter(adapter, binding);
    const selection = context.rule?.inputs?.some(({ type }) => type === "badge-selection");
    if (selection && (typeof context.selectionRoot?.replaceChildren !== "function"
        || !validBadgePlacementState(context.placements))) {
        throw new Error("Invalid Designer badge selection context.");
    }
    if (adapter.declaresMarkdownOutput !== (canDeclare ? true : undefined)) {
        throw new Error(`Incompatible Designer badge input adapter ${binding.adapter}`);
    }
    const { onDeclareFile: declareFile, ...options } = context;
    if (canDeclare && typeof declareFile !== "function") {
        throw new Error("Designer output declaration is unavailable in this host.");
    }
    let mounted = false;
    const onDeclareFile = canDeclare ? (phase, path) => {
        if (!mounted) throw new Error("File declaration is unavailable before control mount.");
        return declareFile(phase, path);
    } : undefined;
    const handle = adapter.mount(canDeclare ? { ...options, onDeclareFile } : options);
    if (selection && typeof handle?.updatePlacements !== "function") {
        context.root.replaceChildren();
        context.selectionRoot.replaceChildren();
        throw new Error(`Incompatible Designer badge selection handle ${binding.adapter}`);
    }
    if (handle?.handlesOutputDeclaration !== (canDeclare ? true : undefined)) {
        context.root.replaceChildren();
        throw new Error(`Incompatible Designer badge input declaration handle ${binding.adapter}`);
    }
    mounted = true;
    return handle;
}

export function hasDeclaredBadgeInputs(value, inputIds) {
    return value && typeof value === "object"
        && !Array.isArray(value) && Object.keys(value).sort().join() === inputIds;
}

export function badgeInputReady(isReady, control) {
    return isReady.call(control) === true;
}

export function jsonSafe(value) {
    const active = new Set();
    const stack = [[value, false, 0]];
    while (stack.length) {
        const [current, leaving, depth] = stack.pop();
        if (leaving) {
            active.delete(current);
            continue;
        }
        if (current === null || typeof current === "string" || typeof current === "boolean") continue;
        if (typeof current === "number" && Number.isFinite(current)) continue;
        if (typeof current !== "object" || depth > 16 || active.has(current)
            || !(Array.isArray(current)
                ? Object.getPrototypeOf(current) === Array.prototype
                : [Object.prototype, null].includes(Object.getPrototypeOf(current)))
            || Reflect.ownKeys(current).some((key) => typeof key !== "string")
            || Reflect.ownKeys(current).length !== Object.keys(current).length
                + (Array.isArray(current) ? 1 : 0)
            || Array.isArray(current) && (Object.keys(current).length !== current.length
                || !Array.from({ length: current.length }, (_, index) =>
                    Object.hasOwn(current, index)).every(Boolean))) return false;
        active.add(current);
        stack.push([current, true, depth]);
        for (const key of Object.keys(current)) {
            const property = Object.getOwnPropertyDescriptor(current, key);
            if (!property || !Object.hasOwn(property, "value") || !property.enumerable) return false;
            stack.push([property.value, false, depth + 1]);
        }
    }
    return true;
}

export function validBadgeInputDraft(inputs, rule, phases, outputs, placements) {
    const phase = (value) => value === "" || phases.includes(value);
    const artifact = (value) => value && typeof value === "object"
        && !Array.isArray(value) && Object.keys(value).sort().join() === "output,phase"
        && typeof value.phase === "string" && typeof value.output === "string"
        && (value.phase === "" && value.output === ""
            || phases.includes(value.phase)
                && (value.output === "" || outputs[value.phase]?.outputs?.includes(value.output)));
    return (rule.inputs ?? []).every(({ id, type }) => {
        const value = inputs[id];
        if (type === "phase") return typeof value === "string" && phase(value);
        if (type === "text") return typeof value === "string" && value.length <= 256
            && !/[\x00-\x1f\x7f]/.test(value);
        if (type === "badge-selection") return validBadgeSelections(value, placements, true);
        if (type === "artifact") return artifact(value);
        if (type === "ordered-artifacts") return Array.isArray(value) && value.length <= 100
            && value.every((entry) => artifact(entry) && entry.phase !== ""
                && entry.output !== "");
        if (type === "artifact-set") return Array.isArray(value) && value.length <= 100
            && value.every((entry) => entry && typeof entry === "object"
                && !Array.isArray(entry) && Object.keys(entry).sort().join() === "outputs,phase"
                && phases.includes(entry.phase) && Array.isArray(entry.outputs)
                && entry.outputs.length > 0 && entry.outputs.length <= 100
                && entry.outputs.every((path) => typeof path === "string"
                    && outputs[entry.phase]?.outputs?.includes(path)));
        return false;
    });
}

export function validBadgeInputComplete(inputs, rule, placements) {
    return (rule.inputs ?? []).every(({ id, type }) =>
        type !== "badge-selection" || validBadgeSelections(inputs[id], placements));
}
