import { withInstance, fsDeps } from "../instances.mjs";
import { snapshot } from "../snapshot.mjs";
import { applyPatch, readState, writeState } from "../../state/store.mjs";
import { effectivePipelinePhases, stripCommandsPrefix } from "../../pipeline/effective-phases.mjs";
import { isCanonical } from "../../pipeline/canonical.mjs";

export function addPipelinePhases(state, additions) {
    if (!Array.isArray(additions) || !additions.length) {
        throw new Error("Provide at least one phase to add.");
    }
    const artifacts = state.composition?.artifacts ?? [];
    const available = new Set(artifacts.filter((a) => a.kind === "command").map((a) => stripCommandsPrefix(a.id)));
    const hookTargets = new Set(artifacts.filter((a) => a.kind === "hook").flatMap((a) => {
        const bindings = a.hookBindings?.length ? a.hookBindings : (a.hookBinding ? [a.hookBinding] : []);
        return bindings.map((b) => b.targetCommand).filter(Boolean).map(stripCommandsPrefix);
    }));
    const items = effectivePipelinePhases(state);
    const added = [];
    const alreadyPresent = [];
    const lastInsertedAfter = new Map();
    for (const addition of additions) {
        if (!addition || typeof addition.id !== "string" || !addition.id.trim()) {
            throw new Error("Each phase needs a command id.");
        }
        const id = stripCommandsPrefix(addition.id);
        if ((!isCanonical(id) && !available.has(id)) || hookTargets.has(id)) {
            throw new Error(`"${addition.id}" is not an available, manually runnable command.`);
        }
        const after = addition.after == null ? null : stripCommandsPrefix(addition.after);
        if (after !== null && (typeof after !== "string" || !after.trim())) {
            throw new Error(`Invalid insertion point for "${addition.id}".`);
        }
        const anchor = after === null ? null : (lastInsertedAfter.get(after) ?? after);
        let anchorIndex = -1;
        if (after !== null) {
            anchorIndex = items.findIndex((item) => stripCommandsPrefix(item.id) === anchor);
            if (anchorIndex < 0) throw new Error(`Insertion point "${addition.after}" is not in the pipeline.`);
        }
        const existingIndex = items.findIndex((item) => stripCommandsPrefix(item.id) === id);
        if (existingIndex >= 0) {
            alreadyPresent.push(id);
            if (after !== null && existingIndex > anchorIndex) lastInsertedAfter.set(after, id);
            continue;
        }
        items.splice(after === null ? items.length : anchorIndex + 1, 0, { id });
        if (after !== null) {
            for (const [key, tail] of lastInsertedAfter) {
                if (tail === anchor) lastInsertedAfter.set(key, id);
            }
            lastInsertedAfter.set(anchor, id);
            lastInsertedAfter.set(after, id);
        }
        added.push(id);
    }
    return { pipeline: items, added, alreadyPresent };
}

export const pipelineActions = [
    {
        name: "addPipelinePhases",
        description: "Add ordered, manually runnable commands to the Phases pipeline. For a README workflow, read the linked README first and supply only the relevant explicit commands; automatic hook commands appear on their own. Each phase can specify `after` to insert after a phase already in the pipeline (or an earlier addition); omitting it appends. Existing phases are never removed or reordered.",
        inputSchema: {
            type: "object",
            required: ["phases"],
            properties: {
                phases: {
                    type: "array",
                    minItems: 1,
                    items: {
                        type: "object",
                        required: ["id"],
                        properties: {
                            id: { type: "string", description: "Installed command id, e.g. commands/speckit.cosmosdb.model." },
                            after: { type: "string", description: "Existing pipeline command id after which to insert this phase; omit to append." },
                        },
                    },
                },
            },
        },
        handler: (ctx) => withInstance(ctx, async (inst) => {
            if (!inst.workspacePath) throw new Error("Wizard workspace is unavailable.");
            const { present, state, warnings } = await readState(inst.workspacePath, fsDeps);
            if (!present || warnings.length) throw new Error(`Cannot read Wizard state: ${warnings.join("; ") || "state.json is missing"}`);
            const result = addPipelinePhases(state, ctx.input?.phases);
            if (result.added.length) {
                const next = applyPatch(state, { pipeline: result.pipeline });
                await writeState(inst.workspacePath, next, fsDeps);
                inst.state = next;
                inst.broadcast({ type: "state", data: await snapshot(inst) });
            }
            return { ok: true, ...result };
        }),
    },
];
