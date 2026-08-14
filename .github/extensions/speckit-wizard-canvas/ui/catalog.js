// Catalog tab: presets, extensions, bundles tiles + install/remove.

import { escapeHtml, safeExternalHref, dispatchKind } from "./client.js";
import { openCommunityInstallModal } from "./modals.js";
import {
    state,
    TOKEN,
    toRawUrl,
    capitalize,
    currentFilter,
    currentAddedOnly,
    currentExtensionFilter,
    currentExtensionAddedOnly,
    currentBundleFilter,
    currentBundleAddedOnly,
} from "./state.js";

// -------- Section: catalog/tiles.js --------

let __openCatalogViewer = null;
let __installCatalogPreset = null;

export function setCatalogDeps({ openCatalogViewer, installCatalogPreset }) {
    __openCatalogViewer = openCatalogViewer;
    __installCatalogPreset = installCatalogPreset;
}

export function renderCatalog(snapshot, filter) {
    renderCatalogSources(snapshot);
    renderCatalogItems(snapshot, filter);
}

function renderCatalogSources(snapshot) {
    const el = document.getElementById("catalog-sources");
    if (!el) return;
    const sources = snapshot?.catalog?.sources ?? [];
    if (!sources.length) {
        el.innerHTML = `<div class="empty empty-inline">No sources configured. Add one above to browse presets.</div>`;
        return;
    }
    el.innerHTML = sources
        .map((s, i) => {
            const pending = s.pending ? `<span class="badge pending">adding…</span>` : "";
            const url = s.url ?? "";
            const rawUrl = toRawUrl(url);
            const urlLink = /^https?:\/\//i.test(url)
                ? `<a class="src-url src-url-link" href="#" data-catalog-url="${escapeHtml(url)}" data-catalog-name="${escapeHtml(capitalize(s.name ?? "source"))}" title="View cached catalog JSON">${escapeHtml(rawUrl)}</a>`
                : `<span class="src-url" title="${escapeHtml(url)}">${escapeHtml(url)}</span>`;
            // Rendering: all preset sources are treated as static/built-in
            // (no user-facing controls). The canonical `default` source is
            // labelled "Built-in" inline instead of wearing a separate pill;
            // extra bootstrap catalogs (copilot, community) are visually plain.
            const statusBadge = "";
            const controls = "";
            const nameLabel = s.name === "default"
                ? "Built-in"
                : escapeHtml(capitalize(s.name ?? "source"));
            const nameEl = /^https?:\/\//i.test(url)
                ? `<a class="src-name src-name-link" href="#" data-catalog-url="${escapeHtml(url)}" data-catalog-name="${nameLabel}" title="View cached catalog JSON">${nameLabel}</a>`
                : `<span class="src-name">${nameLabel}</span>`;
            return `<div class="source-row">
                <div class="src-main">
                    <div class="src-title-line">
                        ${nameEl}
                        ${statusBadge} ${pending}
                    </div>
                    ${s.description ? `<div class="src-desc">${escapeHtml(s.description)}</div>` : ""}
                    ${urlLink}
                </div>
                <div class="src-controls">
                    ${controls}
                </div>
            </div>`;
        })
        .join("");
    el.querySelectorAll("a[data-catalog-url]").forEach((a) => {
        a.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            __openCatalogViewer(a.dataset.catalogUrl, a.dataset.catalogName);
        });
    });
}

export function renderPresetLinks() {
    // No longer used — repo link is now on the preset name.
    return "";
}

// Items auto-installed by the Setup tab's "Install default presets" row.
// Matches DEFAULT_PRESET_ID / performInstallDefaults(). Kept in sync manually
// — if the setup chain grows to install more items, add their ids here so
// they get the "Default" pill on their catalog tile.
export const DEFAULT_INSTALL_PRESET_IDS = new Set(["copilot-sub-agents"]);
const DEFAULT_INSTALL_EXTENSION_IDS = new Set();
const DEFAULT_INSTALL_BUNDLE_IDS = new Set();

// Build the meta pills row (source + Default) with tooltips explaining
// each pill's meaning. Also returns the "added" pill separately since it
// renders in the heading, not the meta row.
function catalogTileBadges(p, defaultIdSet) {
    const pid = p.id ?? p.name;
    const isBuiltin = p.source === "default";
    const sourceLabel = isBuiltin ? "Built-in" : capitalize(p.source ?? "");
    const sourceTitle = isBuiltin
        ? "Ships with Spec Kit."
        : `From the '${sourceLabel}' catalog.`;
    const sourceBadge = p.source
        ? `<span class="badge source" title="${escapeHtml(sourceTitle)}">${escapeHtml(sourceLabel)}</span>`
        : "";
    const isDefaultInstall = defaultIdSet.has(pid);
    const defaultBadge = isDefaultInstall
        ? `<span class="badge default-install" title="Installed by default during setup.">Default</span>`
        : "";
    const activeBadge = p.active
        ? `<span class="badge active" title="Installed in this project.">added</span>`
        : "";
    return { activeBadge, sourceBadge, defaultBadge };
}

function renderCatalogItems(snapshot, filter) {
    const el = document.getElementById("catalog-grid");
    if (!el) return;
    const presets = snapshot?.catalog?.presets ?? [];
    const hasSources = (snapshot?.catalog?.sources ?? []).length > 0;
    // Presets with source === "builtin" (i.e. core) don't count as "browsable"
    // items for the empty-state decision.
    const browsable = presets.filter((p) => p.source !== "builtin");
    const addedOnly = currentAddedOnly();
    let list = filter
        ? presets.filter((p) => `${p.name ?? ""} ${p.id ?? ""}`.toLowerCase().includes(filter))
        : presets;
    if (addedOnly) list = list.filter((p) => p.active);

    if (!browsable.length) {
        el.innerHTML = `<div class="empty empty-inline">No presets available yet. Catalog data is fetched automatically when the wizard opens.</div>`;
        return;
    }

    if (!list.length) {
        el.innerHTML = `<div class="empty empty-inline">No presets match your filter.</div>`;
        return;
    }

    el.innerHTML = list
        .map((p) => {
            const pid = p.id ?? p.name;
            const pending = state.pendingPresetActions[pid];
            const { activeBadge, sourceBadge, defaultBadge } = catalogTileBadges(p, DEFAULT_INSTALL_PRESET_IDS);
            const requiresConfirm = p.installAllowed === false ? "1" : "0";
            let primary;
            if (pending === "install") {
                primary = `<button class="btn btn-primary btn-xs" disabled aria-busy="true"><span class="spinner" aria-hidden="true"></span> Installing…</button>`;
            } else if (pending === "remove") {
                primary = `<button class="btn btn-secondary btn-xs" disabled aria-busy="true"><span class="spinner" aria-hidden="true"></span> Removing…</button>`;
            } else if (p.active) {
                primary = `<button class="btn btn-secondary btn-xs" data-preset-action="remove" data-preset-id="${escapeHtml(pid)}" data-name="${escapeHtml(p.installedId ?? p.name)}">Remove</button>`;
            } else {
                primary = `<button class="btn btn-primary btn-xs" data-preset-action="install" data-preset-id="${escapeHtml(pid)}" data-name="${escapeHtml(p.id ?? p.name)}" data-source="${escapeHtml(p.source ?? "")}" data-download-url="${escapeHtml(p.downloadUrl ?? "")}" data-requires-confirm="${requiresConfirm}" data-display-name="${escapeHtml(p.name ?? p.id ?? "")}">Add</button>`;
            }
            const repoUrl = p.repository || p.homepage || null;
            const safeRepoHref = safeExternalHref(repoUrl);
            const heading = safeRepoHref
                ? `<a class="cc-title-link" href="${safeRepoHref}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(repoUrl)}">${escapeHtml(p.name)}</a>`
                : escapeHtml(p.name);
            return `<div class="catalog-card${pending ? " pending" : ""}">
                <h3>${heading} ${activeBadge}</h3>
                <div class="cc-meta">${sourceBadge} ${defaultBadge} ${p.version ? `<span class="cc-version">v${escapeHtml(p.version)}</span>` : ""}${p.author ? ` <span class="cc-author">by ${escapeHtml(p.author)}</span>` : ""}</div>
                <p>${escapeHtml(p.description ?? "")}</p>
                <div class="cc-actions">${primary}</div>
            </div>`;
        })
        .join("");
    el.querySelectorAll("button[data-preset-action]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const action = btn.dataset.presetAction;
            const name = btn.dataset.name;
            const presetId = btn.dataset.presetId || name;
            // Guard against double-clicks / spam clicks while an action is
            // in-flight. The pending state is cleared by the next
            // `preset-catalog` broadcast (or the safety timeout below).
            if (state.pendingPresetActions[presetId]) return;
            const markPending = (kind) => {
                state.pendingPresetActions[presetId] = kind;
                renderCatalogItems(state.snapshot, currentFilter());
                // Safety timeout — clear pending after 90s so the user is
                // never permanently locked out if a broadcast is missed.
                setTimeout(() => {
                    if (state.pendingPresetActions[presetId] === kind) {
                        delete state.pendingPresetActions[presetId];
                        renderCatalogItems(state.snapshot, currentFilter());
                    }
                }, 90000);
            };
            if (action === "install") {
                const requiresConfirm = btn.dataset.requiresConfirm === "1";
                const downloadUrl = btn.dataset.downloadUrl || null;
                const displayName = btn.dataset.displayName || name;
                const doInstall = () => {
                    // Use the same shared helper the Setup row 4 button
                    // uses. It handles markPending + safety timeout +
                    // dispatchKind identically for both entry points.
                    __installCatalogPreset({ presetId, name, downloadUrl });
                };
                if (requiresConfirm) {
                    openCommunityInstallModal({ displayName, onConfirm: doInstall, kind: "preset" });
                } else {
                    doInstall();
                }
            } else {
                markPending("remove");
                dispatchKind(`preset.${action}`, { name });
            }
        });
    });
}

// -------- Extension Catalog --------
export function renderExtensionCatalog(snapshot, filter) {
    renderExtensionCatalogSources(snapshot);
    renderExtensionCatalogItems(snapshot, filter);
}

function renderExtensionCatalogSources(snapshot) {
    const el = document.getElementById("extension-sources");
    if (!el) return;
    const sources = snapshot?.catalog?.extensionSources ?? [];
    if (!sources.length) {
        el.innerHTML = `<div class="empty empty-inline">No sources configured. Extension catalogs are loaded automatically when the wizard opens.</div>`;
        return;
    }
    el.innerHTML = sources
        .map((s) => {
            const url = s.url ?? "";
            const rawUrl = toRawUrl(url);
            // The canonical `default` catalog is labelled "Built-in" inline
            // (no separate pill); community and other bootstrapped catalogs
            // are shown without one so users don't confuse "we ship this URL"
            // with "GitHub built this catalog".
            const nameLabel = s.name === "default"
                ? "Built-in"
                : escapeHtml(capitalize(s.name ?? "source"));
            const statusBadge = "";
            const urlLink = /^https?:\/\//i.test(url)
                ? `<a class="src-url src-url-link" href="#" data-catalog-url="${escapeHtml(url)}" data-catalog-name="${nameLabel}" title="View catalog JSON">${escapeHtml(rawUrl)}</a>`
                : `<span class="src-url" title="${escapeHtml(url)}">${escapeHtml(url)}</span>`;
            const nameEl = /^https?:\/\//i.test(url)
                ? `<a class="src-name src-name-link" href="#" data-catalog-url="${escapeHtml(url)}" data-catalog-name="${nameLabel}" title="View catalog JSON">${nameLabel}</a>`
                : `<span class="src-name">${nameLabel}</span>`;
            return `<div class="source-row">
                <div class="src-main">
                    <div class="src-title-line">
                        ${nameEl}
                        ${statusBadge}
                    </div>
                    ${s.description ? `<div class="src-desc">${escapeHtml(s.description)}</div>` : ""}
                    ${urlLink}
                </div>
                <div class="src-controls"></div>
            </div>`;
        })
        .join("");
    el.querySelectorAll("a[data-catalog-url]").forEach((a) => {
        a.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            __openCatalogViewer(a.dataset.catalogUrl, a.dataset.catalogName);
        });
    });
}

export function renderExtensionCatalogItems(snapshot, filter) {
    const el = document.getElementById("extension-grid");
    if (!el) return;
    const items = snapshot?.catalog?.extensions ?? [];
    const addedOnly = currentExtensionAddedOnly();
    let list = filter
        ? items.filter((p) => `${p.name ?? ""} ${p.id ?? ""}`.toLowerCase().includes(filter))
        : items;
    if (addedOnly) list = list.filter((p) => p.active);

    if (!items.length) {
        el.innerHTML = `<div class="empty empty-inline">No extensions available yet. Catalog data is fetched automatically when the wizard opens.</div>`;
        return;
    }

    if (!list.length) {
        el.innerHTML = `<div class="empty empty-inline">No extensions match your filter.</div>`;
        return;
    }

    el.innerHTML = list
        .map((p) => {
            const pid = p.id ?? p.name;
            const pending = state.pendingExtensionActions[pid];
            const { activeBadge, sourceBadge, defaultBadge } = catalogTileBadges(p, DEFAULT_INSTALL_EXTENSION_IDS);
            const requiresConfirm = p.installAllowed === false ? "1" : "0";
            let primary;
            if (pending === "install") {
                primary = `<button class="btn btn-primary btn-xs" disabled aria-busy="true"><span class="spinner" aria-hidden="true"></span> Installing…</button>`;
            } else if (pending === "remove") {
                primary = `<button class="btn btn-secondary btn-xs" disabled aria-busy="true"><span class="spinner" aria-hidden="true"></span> Removing…</button>`;
            } else if (p.active) {
                primary = `<button class="btn btn-secondary btn-xs" data-extension-action="remove" data-extension-id="${escapeHtml(pid)}" data-name="${escapeHtml(p.installedId ?? p.name)}">Remove</button>`;
            } else {
                primary = `<button class="btn btn-primary btn-xs" data-extension-action="install" data-extension-id="${escapeHtml(pid)}" data-name="${escapeHtml(p.id ?? p.name)}" data-source="${escapeHtml(p.source ?? "")}" data-download-url="${escapeHtml(p.downloadUrl ?? "")}" data-requires-confirm="${requiresConfirm}" data-display-name="${escapeHtml(p.name ?? p.id ?? "")}">Add</button>`;
            }
            const repoUrl = p.repository || p.homepage || null;
            const safeRepoHref = safeExternalHref(repoUrl);
            const heading = safeRepoHref
                ? `<a class="cc-title-link" href="${safeRepoHref}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(repoUrl)}">${escapeHtml(p.name)}</a>`
                : escapeHtml(p.name);
            return `<div class="catalog-card${pending ? " pending" : ""}">
                <h3>${heading} ${activeBadge}</h3>
                <div class="cc-meta">${sourceBadge} ${defaultBadge} ${p.version ? `<span class="cc-version">v${escapeHtml(p.version)}</span>` : ""}${p.author ? ` <span class="cc-author">by ${escapeHtml(p.author)}</span>` : ""}</div>
                <p>${escapeHtml(p.description ?? "")}</p>
                <div class="cc-actions">${primary}</div>
            </div>`;
        })
        .join("");
    el.querySelectorAll("button[data-extension-action]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const action = btn.dataset.extensionAction;
            const name = btn.dataset.name;
            const extId = btn.dataset.extensionId || name;
            if (state.pendingExtensionActions[extId]) return;
            const markPending = (kind) => {
                state.pendingExtensionActions[extId] = kind;
                renderExtensionCatalogItems(state.snapshot, currentExtensionFilter());
                setTimeout(() => {
                    if (state.pendingExtensionActions[extId] === kind) {
                        delete state.pendingExtensionActions[extId];
                        renderExtensionCatalogItems(state.snapshot, currentExtensionFilter());
                    }
                }, 90000);
            };
            if (action === "install") {
                const requiresConfirm = btn.dataset.requiresConfirm === "1";
                const downloadUrl = btn.dataset.downloadUrl || null;
                const displayName = btn.dataset.displayName || name;
                const doInstall = () => {
                    markPending("install");
                    dispatchKind("extension.install", { name, downloadUrl });
                };
                if (requiresConfirm) {
                    openCommunityInstallModal({ displayName, onConfirm: doInstall, kind: "extension" });
                } else {
                    doInstall();
                }
            } else {
                markPending("remove");
                dispatchKind(`extension.${action}`, { name });
            }
        });
    });
}

// ---- Bundles (mirror of the Extensions trio above) ------------------------

export function renderBundleCatalog(snapshot, filter) {
    renderBundleCatalogSources(snapshot);
    renderBundleCatalogItems(snapshot, filter);
}

function renderBundleCatalogSources(snapshot) {
    const el = document.getElementById("bundle-sources");
    if (!el) return;
    const sources = snapshot?.catalog?.bundleSources ?? [];
    if (!sources.length) {
        el.innerHTML = `<div class="empty empty-inline">No sources configured. Bundle catalogs are loaded automatically when the wizard opens.</div>`;
        return;
    }
    el.innerHTML = sources
        .map((s) => {
            const url = s.url ?? "";
            const rawUrl = toRawUrl(url);
            const nameLabel = s.name === "default"
                ? "Built-in"
                : escapeHtml(capitalize(s.name ?? "source"));
            const statusBadge = "";
            const urlLink = /^https?:\/\//i.test(url)
                ? `<a class="src-url src-url-link" href="#" data-catalog-url="${escapeHtml(url)}" data-catalog-name="${nameLabel}" title="View catalog JSON">${escapeHtml(rawUrl)}</a>`
                : `<span class="src-url" title="${escapeHtml(url)}">${escapeHtml(url)}</span>`;
            const nameEl = /^https?:\/\//i.test(url)
                ? `<a class="src-name src-name-link" href="#" data-catalog-url="${escapeHtml(url)}" data-catalog-name="${nameLabel}" title="View catalog JSON">${nameLabel}</a>`
                : `<span class="src-name">${nameLabel}</span>`;
            return `<div class="source-row">
                <div class="src-main">
                    <div class="src-title-line">
                        ${nameEl}
                        ${statusBadge}
                    </div>
                    ${s.description ? `<div class="src-desc">${escapeHtml(s.description)}</div>` : ""}
                    ${urlLink}
                </div>
                <div class="src-controls"></div>
            </div>`;
        })
        .join("");
    el.querySelectorAll("a[data-catalog-url]").forEach((a) => {
        a.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            __openCatalogViewer(a.dataset.catalogUrl, a.dataset.catalogName);
        });
    });
}

export function renderBundleCatalogItems(snapshot, filter) {
    const el = document.getElementById("bundle-grid");
    if (!el) return;
    const items = snapshot?.catalog?.bundles ?? [];
    const addedOnly = currentBundleAddedOnly();
    let list = filter
        ? items.filter((p) => `${p.name ?? ""} ${p.id ?? ""}`.toLowerCase().includes(filter))
        : items;
    if (addedOnly) list = list.filter((p) => p.active);

    if (!items.length) {
        el.innerHTML = `<div class="empty empty-inline">No bundles available yet. Catalog data is fetched automatically when the wizard opens.</div>`;
        return;
    }

    if (!list.length) {
        el.innerHTML = `<div class="empty empty-inline">No bundles match your filter.</div>`;
        return;
    }

    el.innerHTML = list
        .map((p) => {
            const pid = p.id ?? p.name;
            const pending = state.pendingBundleActions[pid];
            const { activeBadge, sourceBadge, defaultBadge } = catalogTileBadges(p, DEFAULT_INSTALL_BUNDLE_IDS);
            const requiresConfirm = p.installAllowed === false ? "1" : "0";
            let primary;
            if (pending === "install") {
                primary = `<button class="btn btn-primary btn-xs" disabled aria-busy="true"><span class="spinner" aria-hidden="true"></span> Installing…</button>`;
            } else if (pending === "remove") {
                primary = `<button class="btn btn-secondary btn-xs" disabled aria-busy="true"><span class="spinner" aria-hidden="true"></span> Removing…</button>`;
            } else if (p.active) {
                primary = `<button class="btn btn-secondary btn-xs" data-bundle-action="remove" data-bundle-id="${escapeHtml(pid)}" data-name="${escapeHtml(p.installedId ?? p.name)}">Remove</button>`;
            } else {
                primary = `<button class="btn btn-primary btn-xs" data-bundle-action="install" data-bundle-id="${escapeHtml(pid)}" data-name="${escapeHtml(p.id ?? p.name)}" data-source="${escapeHtml(p.source ?? "")}" data-download-url="${escapeHtml(p.downloadUrl ?? "")}" data-requires-confirm="${requiresConfirm}" data-display-name="${escapeHtml(p.name ?? p.id ?? "")}">Add</button>`;
            }
            const repoUrl = p.repository || p.homepage || null;
            const safeRepoHref = safeExternalHref(repoUrl);
            const heading = safeRepoHref
                ? `<a class="cc-title-link" href="${safeRepoHref}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(repoUrl)}">${escapeHtml(p.name)}</a>`
                : escapeHtml(p.name);
            return `<div class="catalog-card${pending ? " pending" : ""}">
                <h3>${heading} ${activeBadge}</h3>
                <div class="cc-meta">${sourceBadge} ${defaultBadge} ${p.version ? `<span class="cc-version">v${escapeHtml(p.version)}</span>` : ""}${p.author ? ` <span class="cc-author">by ${escapeHtml(p.author)}</span>` : ""}</div>
                <p>${escapeHtml(p.description ?? "")}</p>
                <div class="cc-actions">${primary}</div>
            </div>`;
        })
        .join("");
    el.querySelectorAll("button[data-bundle-action]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const action = btn.dataset.bundleAction;
            const name = btn.dataset.name;
            const bundleId = btn.dataset.bundleId || name;
            if (state.pendingBundleActions[bundleId]) return;
            const markPending = (kind) => {
                state.pendingBundleActions[bundleId] = kind;
                renderBundleCatalogItems(state.snapshot, currentBundleFilter());
                setTimeout(() => {
                    if (state.pendingBundleActions[bundleId] === kind) {
                        delete state.pendingBundleActions[bundleId];
                        renderBundleCatalogItems(state.snapshot, currentBundleFilter());
                    }
                }, 90000);
            };
            if (action === "install") {
                const requiresConfirm = btn.dataset.requiresConfirm === "1";
                const downloadUrl = btn.dataset.downloadUrl || null;
                const displayName = btn.dataset.displayName || name;
                // TODO: temp only — the `test` catalog embeds bundle.yml
                // inline. Look up the current item to pass it through.
                const bundleItem = (state.snapshot?.catalog?.bundles ?? []).find(
                    (b) => (b?.id ?? b?.name) === bundleId,
                );
                const bundleYml = bundleItem?.bundleYml || null;
                const doInstall = () => {
                    markPending("install");
                    dispatchKind("bundle.install", { name, downloadUrl, bundleYml });
                };
                if (requiresConfirm) {
                    openCommunityInstallModal({ displayName, onConfirm: doInstall, kind: "bundle" });
                } else {
                    doInstall();
                }
            } else {
                markPending("remove");
                dispatchKind(`bundle.${action}`, { name });
            }
        });
    });
}

