import { dirname } from "node:path/posix";

function itemRoot(pathTemplate) {
    if (typeof pathTemplate !== "string" || !pathTemplate.includes("<slug>")) return null;
    const marker = pathTemplate.indexOf("<slug>");
    return pathTemplate.slice(0, marker + "<slug>".length);
}

export function assessVisualizationApplicability(steps, workflowSteps = steps) {
    const errors = [];
    const itemRoots = new Set();

    for (const step of steps) {
        const expected = step.index === 0 ? [] : [step.index - 1];
        if (JSON.stringify(step.predecessors) !== JSON.stringify(expected)) {
            errors.push({
                code: "visualization_unsupported",
                path: `pipeline[${step.index}].predecessors`,
                message: `Phase "${step.label}" is not part of a simple linear predecessor chain.`,
            });
        }
        const artifact = step.artifact?.pathTemplate;
        if (artifact && !artifact.toLowerCase().endsWith(".md")) {
            errors.push({
                code: "visualization_unsupported",
                path: `pipeline[${step.index}].artifact`,
                message: `Phase "${step.label}" requires a non-Markdown artifact viewer.`,
            });
        }
        const root = workflowSteps.includes(step) ? itemRoot(artifact) : null;
        if (root) itemRoots.add(root);
    }

    if (itemRoots.size > 1) {
        errors.push({
            code: "visualization_unsupported",
            path: "pipeline",
            message: "The pipeline uses multiple independent item roots that the standard workflow canvas cannot represent.",
        });
    }

    const root = [...itemRoots][0] ?? null;
    return {
        ok: errors.length === 0,
        errors,
        workflowMode: root ? "item" : "project",
        itemRoot: root,
        itemDirectory: root ? dirname(root) : null,
    };
}
