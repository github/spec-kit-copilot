export function renderPage({ root, canvas }) {
    const heading = document.createElement("h2");
    heading.textContent = "Logo gallery";
    const description = document.createElement("p");
    description.textContent = `Logo for ${canvas.displayName}`;
    const hero = document.createElement("div");
    hero.dataset.assetSlot = "hero.logo";
    hero.style.maxWidth = "240px";
    hero.style.margin = "2rem auto";
    root.append(heading, description, hero);
}
