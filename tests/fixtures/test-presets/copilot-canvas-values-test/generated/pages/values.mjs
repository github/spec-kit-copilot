export function renderPage({ root, values }) {
    root.textContent = values?.["demo.processing"] ?? "";
}
