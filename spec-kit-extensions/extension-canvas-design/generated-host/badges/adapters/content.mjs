export const contractVersion = 1;

function outsideFences(text) {
    const lines = [];
    let fence = null;
    for (const line of text.split(/\r?\n/)) {
        const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line);
        if (marker) {
            const current = marker[1];
            if (!fence) {
                fence = current;
                continue;
            }
            if (current[0] === fence[0] && current.length >= fence.length
                && line.slice(marker[0].length).trim() === "") {
                fence = null;
                continue;
            }
        }
        if (!fence) lines.push(line);
    }
    return lines;
}

function checklist(text) {
    let completed = 0;
    let total = 0;
    for (const line of outsideFences(text)) {
        const item = /^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\](?:\s|$)/.exec(line);
        if (!item) continue;
        total++;
        if (item[1] !== " ") completed++;
    }
    return { completed, total, percent: total ? Math.round(completed * 100 / total) : 0 };
}

async function currentChecklist(inputs, evidence) {
    let previous;
    for (const descriptor of [...inputs.prerequisites, inputs.artifact]) {
        const file = await evidence.readArtifact(descriptor);
        if (file.state === "unknown") {
            return { match: false, diagnostics: [file.diagnostic] };
        }
        if (file.state === "missing") return { match: false };
        if (!Number.isFinite(file.mtimeMs)) {
            return { match: false, diagnostics: ["Checklist currentness timestamp is unavailable."] };
        }
        if (previous !== undefined && file.mtimeMs < previous) return { match: false };
        previous = file.mtimeMs;
        if (descriptor === inputs.artifact) {
            if (typeof file.text !== "string") {
                return { match: false, diagnostics: ["Checklist content is unavailable."] };
            }
            return { match: true, values: checklist(file.text) };
        }
    }
    return { match: false };
}

export async function evaluate({ ruleId, inputs, evidence }) {
    if (ruleId === "value-match") {
        const file = await evidence.readArtifact(inputs.artifact);
        if (file.state === "unknown") {
            return { match: false, diagnostics: [file.diagnostic] };
        }
        if (file.state === "missing") return { match: false };
        const content = file.text.toLowerCase();
        const selected = inputs.choices.find((choice) =>
            content.includes(choice.value.toLowerCase()));
        return selected ? { match: true, selection: selected.id } : { match: false };
    }
    if (ruleId === "markdown-file-count") {
        const directory = await evidence.countMarkdownFiles(inputs.artifact);
        if (directory.state === "unknown") {
            return { match: false, diagnostics: [directory.diagnostic] };
        }
        const count = directory.count;
        return { match: count > 0, values: { count } };
    }
    if (!["checklist-progress", "checklist-complete"].includes(ruleId)) {
        throw new Error(`Unsupported content badge rule: ${ruleId}`);
    }
    const current = await currentChecklist(inputs, evidence);
    if (!current.match) return current;
    const values = current.values;
    if (!values.total) return { match: false };
    return ruleId === "checklist-progress"
        ? { match: true, values }
        : { match: values.completed === values.total };
}
