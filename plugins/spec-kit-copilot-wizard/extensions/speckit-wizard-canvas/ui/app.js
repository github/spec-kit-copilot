// Consolidated app.js entrypoint + log + cwd renderers.

import { parseClarifications } from "../pipeline/canonical.mjs";
import {
    state,
    TOKEN,
    SETUP_TAB_PHASE_KEYS,
    currentFilter,
    currentExtensionFilter,
    currentBundleFilter,
} from "./state.js";
import {
    createClient,
    escapeHtml,
    setPostJson,
    setMessagesDeps,
    handleServerMessage,
    renderCwd,
} from "./client.js";
import { installBootOverlay } from "./boot.js";
import {
    setViewersDeps,
    openArtifactViewer,
    openCommandViewer,
    openCatalogViewer,
} from "./modals.js";
import {
    setCatalogDeps,
    renderCatalog,
    renderExtensionCatalog,
    renderExtensionCatalogItems,
    renderBundleCatalog,
    renderBundleCatalogItems,
} from "./catalog.js";
import {
    wireSetupSteps,
    isSetupComplete,
    refreshTabLock,
    renderSetupStepper,
    setSetupActionsDeps,
    runSetupAutoChain,
    installCatalogPreset,
} from "./setup.js";
import {
    setCompositionDeps,
    renderComposition,
    setCompositionMetaDeps,
    wireCompositionRefresh,
} from "./composition.js";
import {
    setPhaseCardDeps,
    synthesizeCanonicalPhase,
    renderPhaseCard,
    renderCommandCardHintsHtml,
    setGraphPhaseCardDeps,
    renderGraphPhaseCard,
    setStepperDeps,
    renderStepper,
    renderEnvironmentCard,
    setEnvDeps,
} from "./phase-card.js";
import {
    setRunLockDeps,
    setPipelineDeps,
    renderPipelineBanner,
    setExtensionCardDeps,
    setInferenceDeps,
    observePhaseProgress,
} from "./phase-runtime.js";

// -------- Section: app.js --------

const client = createClient({
    token: TOKEN,
    onError: (path, err) => {
        console.error(`${path}: ${err?.message ?? err}`);
    },
    onMessage: handleServerMessage,
    onConnectionChange: (status) => {
        const conn = document.getElementById("conn-status");
        if (!conn) return;
        conn.textContent = status === "live" ? "live" : "reconnecting…";
        conn.className = status === "live" ? "conn conn-live" : "conn conn-lost";
    },
});
const { headers: HEADERS, postJson, connectSse } = client;
setPostJson(postJson);
setCatalogDeps({ openCatalogViewer, installCatalogPreset });
setCompositionDeps({ openArtifactViewer });
setRunLockDeps({ render });
setPipelineDeps({ postJson });
setExtensionCardDeps({ openCommandViewer, renderCommandCardHintsHtml, synthesizeCanonicalPhase });
setInferenceDeps({ TOKEN });
setCompositionMetaDeps({ postJson, renderComposition });
setSetupActionsDeps({ render, postJson });
setStepperDeps({ renderPhaseCard });
setPhaseCardDeps({ renderGraphPhaseCard });
setGraphPhaseCardDeps({ postJson, openArtifactViewer, openCommandViewer, renderPhaseCard, renderStepper });
setEnvDeps({ postJson });
setViewersDeps({ postJson, HEADERS });
const boot = installBootOverlay({ token: TOKEN });
setMessagesDeps({ render, refreshState, onBoot: boot.handleBootMessage });

// -------- Boot --------
// init() runs at the bottom of the module to avoid TDZ errors when init
// touches module-level `const`/`let` declared later in the file.

async function init() {
    wireTabs();
    wireSetupSteps();
    wireThemeToggle();
    wireCompositionRefresh();
    connectSse();
    await refreshState();
    // Composition refresh is intentionally NOT auto-dispatched. Users click
    // "Refresh now" in the Composition tab to run the expensive prompt.
}

// -------- Tabs --------
function wireTabs() {
    for (const tab of document.querySelectorAll(".tab")) {
        tab.addEventListener("click", () => selectTab(tab.dataset.tab));
    }
}

function selectTab(name) {
    if (!name) return;
    // Gate access to Phases until setup (Environment) is complete.
    if (name === "phases" && !isSetupComplete()) return;
    state.activeTab = name;
    for (const tab of document.querySelectorAll(".tab")) {
        tab.setAttribute("aria-selected", tab.dataset.tab === name ? "true" : "false");
    }
    for (const panel of document.querySelectorAll(".tab-panel")) {
        panel.classList.toggle("active", panel.dataset.panel === name);
    }
    // Re-render the panel we just switched to.
    render();
}

// -------- Theme --------
const THEME_STORAGE_KEY = "speckit-wizard.theme";

function currentTheme() {
    const explicit = document.documentElement.getAttribute("data-theme");
    if (explicit === "dark" || explicit === "light") return explicit;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    const btn = document.getElementById("theme-toggle");
    if (btn) {
        btn.textContent = theme === "dark" ? "☾" : "☀";
        btn.setAttribute("aria-label", theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
        btn.setAttribute("title", theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
    }
}

function wireThemeToggle() {
    let stored = null;
    try { stored = localStorage.getItem(THEME_STORAGE_KEY); } catch { /* ignore */ }
    applyTheme(stored === "dark" || stored === "light" ? stored : currentTheme());
    const btn = document.getElementById("theme-toggle");
    btn?.addEventListener("click", () => {
        const next = currentTheme() === "dark" ? "light" : "dark";
        applyTheme(next);
        try { localStorage.setItem(THEME_STORAGE_KEY, next); } catch { /* ignore */ }
    });
}


// Add-catalog and remove-catalog functionality has been removed — the wizard
// always shows the built-in `default` and `community` catalogs and never
// modifies `.specify/preset-catalogs.yml`.

// Wire the catalog search input (previously wired inside wireCatalogAddSource).
document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("catalog-search")?.addEventListener("input", (e) => {
        renderCatalog(state.snapshot, e.target.value.toLowerCase());
    });
    document.getElementById("catalog-only-added")?.addEventListener("change", () => {
        renderCatalog(state.snapshot, currentFilter());
    });
    document.getElementById("extension-search")?.addEventListener("input", () => {
        renderExtensionCatalogItems(state.snapshot, currentExtensionFilter());
    });
    document.getElementById("extension-only-added")?.addEventListener("change", () => {
        renderExtensionCatalogItems(state.snapshot, currentExtensionFilter());
    });
    document.getElementById("bundle-search")?.addEventListener("input", () => {
        renderBundleCatalogItems(state.snapshot, currentBundleFilter());
    });
    document.getElementById("bundle-only-added")?.addEventListener("change", () => {
        renderBundleCatalogItems(state.snapshot, currentBundleFilter());
    });
    // Subtabs: switch between panels within the SAME `data-subtab-group`.
    // The group scoping lets multiple subtab bars coexist on the page
    // (Catalogs uses group "catalogs"; Compositions uses "composition").
    document.querySelectorAll('.subtabs .subtab[data-subtab]').forEach((btn) => {
        btn.addEventListener("click", () => {
            const which = btn.dataset.subtab;
            const nav = btn.closest('.subtabs');
            const group = nav?.dataset.subtabGroup || null;
            const selector = group
                ? `.subtabs[data-subtab-group="${group}"] .subtab[data-subtab]`
                : '.subtabs .subtab[data-subtab]';
            document.querySelectorAll(selector).forEach((b) => {
                const active = b.dataset.subtab === which;
                b.classList.toggle("is-active", active);
                b.setAttribute("aria-selected", active ? "true" : "false");
            });
            const panelSelector = group
                ? `[data-subtab-panel][data-subtab-group="${group}"]`
                : '[data-subtab-panel]';
            document.querySelectorAll(panelSelector).forEach((panel) => {
                const active = panel.dataset.subtabPanel === which;
                panel.classList.toggle("is-active", active);
                panel.hidden = !active;
            });
            if (group === "composition") {
                state.compositionActiveKind = which;
                return;
            }
            if (which === "extensions") {
                renderExtensionCatalog(state.snapshot, currentExtensionFilter());
            } else if (which === "bundles") {
                renderBundleCatalog(state.snapshot, currentBundleFilter());
            } else {
                renderCatalog(state.snapshot, currentFilter());
            }
        });
    });
});


async function refreshState() {
    try {
        const res = await fetch(`/api/state?token=${encodeURIComponent(TOKEN)}`, { headers: HEADERS });
        if (!res.ok) throw new Error(`state ${res.status}`);
        const snap = await res.json();
        state.snapshot = snap;
        // Seed boot overlay from initial snapshot so the panel reflects
        // any progress the backend has made between server-start and
        // this first REST fetch (avoids a blank frame before SSE ticks).
        boot.setInitialSnapshot(snap);
        const cp = snap.currentPhase || "constitution";
        state.currentPhase = SETUP_TAB_PHASE_KEYS.has(cp) ? "constitution" : cp;
        observePhaseProgress();
        render();
        // Kick the one-time auto-chain once we have real state to evaluate.
        // Fires only when plugin+CLI are already installed but init hasn't
        // run yet. The function is idempotent — state.autoChainAttempted
        // gates any further attempts.
        runSetupAutoChain();
    } catch (err) {
        console.error(`state fetch failed: ${err?.message ?? err}`);
    }
}

// -------- Render --------
function render() {
    renderSetupStepper();
    renderEnvironmentCard();
    renderStepper();
    renderPipelineBanner();
    renderPhaseCard();
    renderComposition();
    renderCatalog(state.snapshot, "");
    renderExtensionCatalog(state.snapshot, "");
    renderBundleCatalog(state.snapshot, "");
    renderCwd();
    refreshTabLock();
}

// Expose parseClarifications for ad-hoc console debugging.
if (typeof window !== "undefined") window.__speckitParseClarifications = parseClarifications;

// Kick off the app now that every module-level `const`/`let` above is
// initialized (avoids TDZ when init touches later declarations).
init();
