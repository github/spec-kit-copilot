// Fixed-shell structure shared by the Wizard and generated artifact viewers.
export function mountArtifactViewerShell(root, { label, path, returnLabel, onReturn }) {
    document.body.classList.add("artifact-review-open");
    root.hidden = false;
    root.innerHTML = `
        <div class="artifact-viewer-header">
            <button type="button" class="btn btn-ghost btn-sm artifact-viewer-back"></button>
            <div class="artifact-viewer-title">
                <h2></h2>
                <code class="muted"></code>
            </div>
        </div>
        <div class="artifact-viewer-clarify-banner" hidden></div>
        <div class="artifact-viewer-body">
            <p class="muted">Loading…</p>
        </div>
    `;
    const back = root.querySelector(".artifact-viewer-back");
    if (back) {
        back.textContent = `← ${returnLabel}`;
        back.addEventListener("click", onReturn);
    }

    const title = root.querySelector(".artifact-viewer-title h2");
    const file = root.querySelector(".artifact-viewer-title code");
    const setTitle = (label, path) => {
        if (title) title.textContent = label;
        if (file) file.textContent = path;
    };
    setTitle(label, path);
    return { body: root.querySelector(".artifact-viewer-body"), setTitle };
}

export function captureViewerReturn(trigger = document.activeElement) {
    const scroll = [];
    for (let ancestor = trigger; ancestor; ancestor = ancestor.parentElement) {
        scroll.push({ element: ancestor, top: ancestor.scrollTop, left: ancestor.scrollLeft });
    }
    const scopeId = trigger?.closest?.("[id]")?.id;
    const markers = [...trigger?.attributes ?? []]
        .filter(({ name }) => name.startsWith("data-") || name === "href" || name === "name")
        .map(({ name, value }) => ({ name, value }));
    return () => {
        for (const { element, top, left } of scroll) {
            if (!element.isConnected) continue;
            element.scrollTop = top;
            element.scrollLeft = left;
        }
        let target = trigger;
        if (trigger && !trigger.isConnected) {
            const scope = document.getElementById(scopeId);
            target = trigger.id ? document.getElementById(trigger.id)
                : [...scope?.getElementsByTagName(trigger.tagName) ?? []].find((element) => markers.length
                    ? markers.every(({ name, value }) => element.getAttribute(name) === value)
                    : element.textContent === trigger.textContent);
        }
        if (target?.isConnected) target.focus({ preventScroll: true });
    };
}
