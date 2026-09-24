const escape = (value) => String(value ?? "").replace(/[&<>"']/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

function sourceLink(source) {
    try {
        const url = new URL(source?.url);
        return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
    } catch {
        return null;
    }
}

export function installationDisclosure(components, copy) {
    if (!Array.isArray(components) || !components.length) {
        throw new TypeError("Installation review requires the complete captured package list");
    }
    const items = components.map((entry) => {
        const source = entry.installedSource;
        const url = sourceLink(source);
        const kind = entry.kind === "preset" ? "Preset" : "Extension";
        return `<li class="installation-component">
            <div class="installation-component-main">
                <div class="installation-component-name"><strong>${escape(entry.id)}</strong><span class="installation-tag">${kind}</span></div>
                <p>Version: <code>${escape(entry.version)}</code> · Priority: <code>${escape(entry.priority)}</code> · ${entry.installed ? "Installed" : "Requires installation"}</p>
                <p>Captured source: <code>${escape(source?.kind ?? "unavailable")}</code> · Manifest SHA-256: <code>${escape(entry.manifestSha256 ?? "unavailable")}</code></p>
                <p>Trust: Not verified by this canvas. Executable content: presets and extensions may provide commands, templates, or hooks. Review the package before installing it.</p>
            </div>
            ${url ? `<p class="installation-source">Source URL: <a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(url)}</a></p>` : '<p class="installation-source-unavailable muted">No portable HTTPS source captured; provide this package externally.</p>'}
        </li>`;
    });
    return `<p class="installation-warning" role="note"><strong>Community package warning:</strong> These components are not verified by this canvas. Installation can introduce executable commands and hooks. Check the publisher and source before approving the entire set.</p>
        <p class="installation-custom-copy">${escape(copy)}</p>
        <ul class="installation-components" aria-label="Required presets and extensions">${items.join("")}</ul>`;
}
