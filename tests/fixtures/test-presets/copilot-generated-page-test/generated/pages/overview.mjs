export function renderPage({ root, canvas }) {
    const heading = document.createElement("h2");
    heading.textContent = "Overview";
    const description = document.createElement("p");
    description.textContent = `${canvas.displayName} has a generated-only Overview page.`;
    root.append(heading, description);
}
