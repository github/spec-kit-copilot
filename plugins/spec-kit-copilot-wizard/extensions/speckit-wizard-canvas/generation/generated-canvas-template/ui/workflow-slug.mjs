// Portable workflow-slug validation shared by standalone browser and server code.
export function validateWorkflowSlug(value) {
    const slug = String(value ?? "").trim();
    let error = "";
    if (slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
        error = "Use lowercase letters, numbers, and single hyphens only.";
    } else if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(slug)) {
        error = "This name is reserved on Windows. Choose another workflow slug.";
    }
    return { slug, error };
}
