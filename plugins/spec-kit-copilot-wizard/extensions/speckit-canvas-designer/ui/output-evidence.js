export function markdownOutputError(outputs, phases, phase, path) {
    if (!phases.includes(phase) || phase.replace(/^speckit\./, "") === "constitution"
        || !outputs[phase] || !Array.isArray(outputs[phase].outputs)) {
        return "Choose a configurable evidence phase.";
    }
    if (typeof path !== "string" || !path || path.length > 1000 || !path.endsWith(".md")) {
        return "Enter a Markdown (.md) artifact path.";
    }
    const segments = path.split("/");
    if (/^(?:\.git|\.github|node_modules|\.speckit-canvas|\.speckit-wizard)(?:\/|$)/i.test(path)
        || /^\.specify\/(?:extensions|presets|templates)(?:\/|$)/i.test(path)
        || /[\\\x00-\x1f\x7f]/.test(path)
        || segments.some((part) => !part || part === "." || part === ".."
            || /[. ]$/.test(part) || (part !== "<slug>" && /[<>:"|?*]/.test(part))
            || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))
        || segments.filter((part) => part === "<slug>").length > 1
        || path.startsWith("<slug>/")) {
        return "Enter a safe relative artifact path.";
    }
    if (outputs[phase].outputs.some((item) => item.toLowerCase() === path.toLowerCase())) {
        return "This artifact is already listed.";
    }
    if (outputs[phase].outputs.length >= 100) return "A phase can list at most 100 artifacts.";
    return "";
}

export function declareMarkdownOutput(outputs, phases, phase, path) {
    const error = markdownOutputError(outputs, phases, phase, path);
    if (error) throw new Error(error);
    outputs[phase].outputs.push(path);
    return structuredClone(outputs);
}
