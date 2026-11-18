export function provideValue({ workflow }) {
    return `${workflow.label} (${workflow.slug})`;
}
