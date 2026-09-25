import { specifyRun } from "../catalog/shared.mjs";

const GROUPS = Object.freeze({
    artifacts: "artifact",
    presets: "preset",
    extensions: "extension",
});

export function compositionFromSpecify(inventory) {
    for (const key of Object.keys(GROUPS)) {
        if (!Array.isArray(inventory?.[key])) {
            throw new TypeError(`Specify ${key} list --json must return an array`);
        }
    }
    const installed = new Map([
        ...inventory.presets.map((item) => [`preset:${item.id}`, item]),
        ...inventory.extensions.map((item) => [`extension:${item.id}`, item]),
    ]);
    return {
        presets: inventory.presets,
        extensions: inventory.extensions,
        artifacts: inventory.artifacts.map((artifact) => {
            if (typeof artifact.id !== "string" || !Array.isArray(artifact.stack)) {
                throw new TypeError("Specify artifact list returned an invalid effective stack");
            }
            const prefix = `${artifact.kind}:`;
            const id = artifact.id.startsWith(prefix) ? artifact.id.slice(prefix.length) : artifact.id;
            return {
                ...artifact,
                id: artifact.kind === "command" || artifact.kind === "hook"
                    ? `commands/${id}` : id,
                specifyId: artifact.id,
                stack: artifact.stack.map((layer) => {
                    const provider = layer.sourceId ?? layer.presetId;
                    const source = installed.get(`${layer.layer}:${provider}`);
                    return {
                        ...layer,
                        presetId: provider ?? undefined,
                        presetName: source?.name ?? layer.presetName ?? undefined,
                    };
                }),
            };
        }),
    };
}

export async function readSpecifySnapshot(inst, { refresh = false } = {}) {
    if (!inst?.workspacePath) throw new Error("Specify composition requires a workspace");
    if (refresh || !inst.specifySnapshot) {
        const inventory = {};
        for (const [key, kind] of Object.entries(GROUPS)) {
            const output = await specifyRun([kind, "list", "--json"], inst.workspacePath);
            if (!output) throw new Error(`Unable to read Specify ${kind} list --json`);
            try {
                inventory[key] = JSON.parse(output);
            } catch (error) {
                throw new Error(`Invalid Specify ${kind} list --json: ${error.message}`);
            }
        }
        const composition = compositionFromSpecify(inventory);
        inst.specifySnapshot = { inventory, composition };
    }
    return inst.specifySnapshot;
}

export function invalidateSpecifySnapshot(inst) {
    if (inst) inst.specifySnapshot = null;
}
