export function validateDialogAdapter(definition, name, registration, module) {
    if (definition.id !== name || definition.adapter !== registration.adapter
        || module.dialogId !== "stock.dialog" || module.contractVersion !== 1
        || typeof module.mount !== "function") throw new Error(`Incompatible generated dialog: ${name}`);
}

export function validateDialogInstance(instance, name) {
    if (!instance || typeof instance.dispose !== "function" || !instance.result?.then) {
        throw new Error(`Invalid dialog adapter result: ${name}`);
    }
}

export function validateDialogDecision(result) {
    if (!["confirmed", "cancelled"].includes(result)) throw new Error("Invalid generated dialog decision");
}

export function validateButtonAdapter(module, control) {
    if (module.controlId !== control.id || module.contractVersion !== 1
        || typeof module.mount !== "function") throw new Error(`Incompatible button adapter: ${control.id}`);
}

export function validateButtonInstance(instance) {
    if (typeof instance?.dispose !== "function") throw new Error("Invalid button instance");
}

export function validateDialogAdapterSource(code, syntax, adapter) {
    if (syntax.status !== 0 || syntax.error
        || !/export\s+(?:async\s+)?function\s+mount\s*\(/.test(code)
        || !/export\s+const\s+dialogId\s*=\s*["']stock\.dialog["']/.test(code)
        || !/export\s+const\s+contractVersion\s*=\s*1\b/.test(code)) {
        throw new Error(`Incompatible frozen dialog adapter: ${adapter}`);
    }
}

export function validateButtonAdapterSource(code, syntax, id) {
    if (syntax.status !== 0 || syntax.error
        || !/export\s+(?:async\s+)?function\s+mount\s*\(/.test(code)
        || !code.includes(`controlId = "${id}"`)
            && !code.includes(`controlId = '${id}'`)
        || !/export\s+const\s+contractVersion\s*=\s*1\b/.test(code)) {
        throw new Error(`Incompatible frozen button adapter: ${id}`);
    }
}
