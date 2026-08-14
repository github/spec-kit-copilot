// Consolidated Setup tab: state helpers, actions, and rendering.

import { state, SETUP_STEPS, SETUP_TAB_PHASE_KEYS } from "./state.js";
import { escapeHtml, dispatchKind, waitForSnapshot } from "./client.js";

// -------- Section: setup/state.js --------

// -------- Setup sub-steps --------
export function wireSetupSteps() {
    // Sub-step chain is rendered dynamically by renderSetupStepper(); the
    // click handler is attached there. Nothing to wire at boot.
}

export function selectSetupStep(name) {
    if (!SETUP_STEPS.includes(name)) return;
    // Gate Catalogs and Composition sub-steps until Environment is complete.
    if ((name === "catalogs" || name === "composition") && !isSetupComplete()) return;
    state.activeSetupStep = name;
    for (const panel of document.querySelectorAll(".setup-substep-panel")) {
        panel.classList.toggle("active", panel.dataset.substep === name);
    }
    renderSetupStepper();
}

export function renderSetupStepper() {
    const el = document.getElementById("setup-stepper");
    if (!el) return;
    const locked = !isSetupComplete();
    const labels = {
        environment: "Environment",
        catalogs: "Catalogs",
        composition: "Composition",
    };
    el.innerHTML = "";
    SETUP_STEPS.forEach((id, idx) => {
        if (idx > 0) {
            const sep = document.createElement("li");
            sep.className = "step-sep";
            sep.setAttribute("aria-hidden", "true");
            el.appendChild(sep);
        }
        const li = document.createElement("li");
        li.className = "step";
        const stepLocked = (id === "catalogs" || id === "composition") && locked;
        if (id === state.activeSetupStep) li.classList.add("active");
        if (id === "environment" && !locked) li.classList.add("done");
        if (stepLocked) li.classList.add("locked");
        li.dataset.substep = id;
        li.innerHTML = `<span class="step-index">${idx + 1}</span><span class="step-label"><span class="step-name">${escapeHtml(labels[id])}</span></span>`;
        li.addEventListener("click", () => {
            if (stepLocked) return;
            selectSetupStep(id);
        });
        el.appendChild(li);
    });
}

export function isSetupComplete() {
    // Setup is a durable project milestone. Once the prerequisite checks and
    // init/reload sequence have succeeded, reopening the canvas must not
    // replay the workflow or relock the project because a transient SSE
    // diagnostic is absent.
    //
    // Plugin / CLI presence: accept EITHER the live env probe (source of
    // truth for the checklist rows via `isStepDone`) OR the persisted
    // `setup.*` flag. The env probe is authoritative — if the binaries are
    // on PATH they're installed — but the persisted flag lets us stay
    // unlocked before the first probe returns after a reload. Without this
    // OR, the setup checklist can show both rows ✓ (from env) while the
    // Phases/Catalogs/Composition tabs stay locked (state.json's
    // `setup.pluginInstalled` / `setup.cliInstalled` are never written by
    // any flow — the env probe result is cached in-memory only).
    const setup = state.snapshot?.setup ?? {};
    const env = state.snapshot?.environment ?? {};
    const pluginOk = !!env.pluginInstalled || !!setup.pluginInstalled;
    const cliOk = !!env.cliInstalled || !!setup.cliInstalled;
    return pluginOk &&
        cliOk &&
        (!!state.snapshot?.projectInitialized || !!setup.projectInitialized) &&
        !!setup.skillsReloaded &&
        !state.setupRowRunning;
}

export function refreshTabLock() {
    const locked = !isSetupComplete();
    for (const tab of document.querySelectorAll(".tab")) {
        if (tab.dataset.tab === "phases") {
            tab.classList.toggle("locked", locked);
            tab.setAttribute("aria-disabled", locked ? "true" : "false");
            tab.title = locked ? "Complete setup to unlock phases" : "";
        }
    }
    // Deliberately no auto-bounce here. If the gate flips locked while the
    // user is on Phases or a gated sub-step (e.g. the env probe transiently
    // regressed after an extension reload, or state.json's setup.* flags
    // aren't populated yet), we surface the lock via the tab's `locked`
    // class + `aria-disabled` and let the user decide whether to navigate.
    // The old auto-`selectTab("setup")` + `selectSetupStep("environment")`
    // calls were hijacking the user's context on every transient probe
    // failure, including right after a phase completed successfully.
}


// -------- Section: setup/actions.js --------

let __render = () => {};
let __postJson = async () => ({ ok: false });

export function setSetupActionsDeps({ render, postJson }) {
    if (typeof render === "function") __render = render;
    if (typeof postJson === "function") __postJson = postJson;
}

export async function runInit(values = null) {
    if (state.setupRowRunning) return;
    const args = values ?? collectSetupValues();
    state.setupRowRunning = "init";
    __render();
    try {
        await dispatchKind("setup.init", args);
    } catch (err) {
        console.error(`setup.init did not complete: ${err?.message ?? err}`);
    }
    state.setupRowRunning = null;
    __render();
}

export async function runReload() {
    if (state.setupRowRunning) return;
    state.setupRowRunning = "reload";
    __render();
    await performReload();
    state.setupRowRunning = null;
    __render();
}

// One-time auto-chain: init → install defaults → reload skills. Fired
// exactly once per wizard load, only when plugin+CLI are already detected
// but init hasn't happened yet. Guarded by state.autoChainAttempted so it
// never re-fires silently — subsequent runs require explicit button clicks.
export async function runSetupAutoChain() {
    if (state.autoChainAttempted) return;
    if (state.setupRowRunning) return;
    const snap = state.snapshot ?? {};
    const setup = snap.setup ?? {};
    const env = snap.environment ?? {};
    const pluginOk = !!env.pluginInstalled;
    const cliOk = !!env.cliInstalled;
    const initDone = !!setup.projectInitialized;
    // Only chain when prereqs are met and init hasn't run.
    if (!pluginOk || !cliOk || initDone) return;
    state.autoChainAttempted = true;
    const args = collectSetupValues();
    state.setupRowRunning = "init";
    __render();
    try {
        await dispatchKind("setup.init", args);
        await waitForSnapshot(
            (s) => !!s?.setup?.projectInitialized || !!s?.projectInitialized,
        );
    } catch (err) {
        console.error(`Auto-chain setup.init did not complete: ${err?.message ?? err}`);
        state.setupRowRunning = null;
        __render();
        return;
    }
    // Install default preset (row 4), then reload skills (row 5).
    const catalogPresets = state.snapshot?.catalog?.presets ?? [];
    const already = catalogPresets.find((p) => (p?.id ?? p?.name) === "copilot-sub-agents")?.active;
    if (!already) {
        state.setupRowRunning = "installDefaults";
        __render();
        await performInstallDefaults();
    }
    state.setupRowRunning = "reload";
    __render();
    await performReload();
    state.setupRowRunning = null;
    __render();
}

// Direct SDK-driven skills reload. Called both as a standalone action
// (runReload) and as the auto-chained second step of runInit. Failures
// (including `unavailable`) are logged and surfaced via
// state.snapshot.skillsReload — the row 4 chip and inline note render them.
export async function performReload() {
    try {
        const result = await __postJson("/api/skills/reload", {});
        if (!result?.ok) {
            console.warn(`skills reload: failed (errors=${result?.errors ?? "?"}, warnings=${result?.warnings ?? "?"})`);
        }
    } catch (err) {
        console.error(`skills reload dispatch failed: ${err?.message ?? err}`);
    }
}

// Force a fresh env probe on demand. Called from the row 1 & 2 "↻ Recheck"
// links so a user who just manually installed the plugin or CLI can see the
// wizard reflect the new state without reloading the extension. The
// server-side handler runs `ensureEnvProbe(inst, { force: true })` (which
// re-verifies BOTH plugin AND CLI in one pass — they share a probe run) and
// broadcasts a fresh snapshot; we track WHICH row triggered the click on
// `state.envProbeRunning` so only that row's button shows the spinner,
// matching the user's mental model of a per-row action.
export async function performEnvProbe(sourceKey) {
    if (state.envProbeRunning) return;
    state.envProbeRunning = sourceKey || true;
    __render();
    try {
        await __postJson("/api/env/probe", {});
    } catch (err) {
        console.error(`env probe dispatch failed: ${err?.message ?? err}`);
    } finally {
        state.envProbeRunning = null;
        __render();
    }
}

// Shared preset-install helper — used by both the Presets catalog "Add"
// button (line ~4534) and the Setup row 4 "Install / Re-install" button.
// Same code path, same broadcast handling, same 90s safety timeout.
//
// Fire-and-forget: returns after queueing the prompt; the
// `preset-catalog` broadcast flips `p.active` and clears the pending
// marker. Callers that need to await installation (e.g. runInit's
// auto-chain) should follow this with `waitForSnapshot(...)`.
export function installCatalogPreset({ presetId, name, downloadUrl }) {
    if (state.pendingPresetActions?.[presetId]) return;
    state.pendingPresetActions ??= {};
    state.pendingPresetActions[presetId] = "install";
    __render();
    // Safety timeout — clear pending after 90s so the user is never
    // permanently locked out if a broadcast is missed. Same value the
    // catalog button uses.
    setTimeout(() => {
        if (state.pendingPresetActions?.[presetId] === "install") {
            delete state.pendingPresetActions[presetId];
            __render();
        }
    }, 90000);
    dispatchKind("preset.install", { name, downloadUrl });
}

// Default preset auto-install (used by runInit's chain). Uses the
// shared installCatalogPreset() so it flows through the identical
// dispatch + broadcast pipeline as the Presets tab. Then waits up to
// 10 min for the catalog broadcast to reflect active=true so the
// chain can proceed to the skills-reload step.
export async function performInstallDefaults() {
    const DEFAULT_PRESET_ID = "copilot-sub-agents";
    const DEFAULT_PRESET_DOWNLOAD_URL =
        "https://github.com/github/spec-kit-copilot/releases/download/copilot-sub-agents-v1.0.0/copilot-sub-agents.zip";
    try {
        installCatalogPreset({
            presetId: DEFAULT_PRESET_ID,
            name: DEFAULT_PRESET_ID,
            downloadUrl: DEFAULT_PRESET_DOWNLOAD_URL,
        });
        await waitForSnapshot(
            (s) => {
                const items = s?.catalog?.presets ?? [];
                return !!items.find((p) => (p?.id ?? p?.name) === DEFAULT_PRESET_ID)?.active;
            },
            { timeoutMs: 10 * 60 * 1000 },
        );
    } catch (err) {
        console.error(`default preset install failed: ${err?.message ?? err}`);
    }
}


// -------- Section: setup/render.js --------

export function renderSetupBody(_p) {
    const setup = state.snapshot?.setup ?? {};
    const env = state.snapshot?.environment ?? {};
    const projectInitialized = !!state.snapshot?.projectInitialized || !!setup.projectInitialized;
    const reload = state.snapshot?.skillsReload;
    const reloadUnavailable = reload?.unavailable === true;
    const running = state.setupRowRunning; // null | "init" | "reload" | "installDefaults"

    // Row 5 truth: is the "Copilot Sub-Agent Delegation" preset installed?
    // Derived from the live catalog snapshot so external installs/removals
    // are reflected without a sticky flag.
    const DEFAULT_PRESET_ID = "copilot-sub-agents";
    const DEFAULT_PRESET_DISPLAY = "Copilot Sub-Agent Delegation";
    const DEFAULT_PRESET_DOWNLOAD_URL =
        "https://github.com/github/spec-kit-copilot/releases/download/copilot-sub-agents-v1.0.0/copilot-sub-agents.zip";
    const catalogPresets = state.snapshot?.catalog?.presets ?? [];
    const defaultPreset = catalogPresets.find(
        (p) => (p?.id ?? p?.name) === DEFAULT_PRESET_ID,
    );
    const defaultPresetInstalled = !!defaultPreset?.active;
    const defaultPresetSkipped = !!setup.defaultPresetsSkipped;

    const envScaffolded = Array.isArray(env.scaffoldedSkills)
        ? env.scaffoldedSkills.filter((s) => /^speckit-/.test(s))
        : [];
    const fsScaffolded = Array.isArray(state.snapshot?.scaffoldedSkills)
        ? state.snapshot.scaffoldedSkills.filter((s) => /^speckit-/.test(s))
        : [];
    // Prefer FS truth (durable across extension reloads); fall back to the
    // cached env probe (populated by showEnvReport).
    const scaffolded = fsScaffolded.length ? fsScaffolded : envScaffolded;

    const prereqsOk = !!env.pluginInstalled && !!env.cliInstalled;
    // Row 4 truth: live SDK reload OR the persisted sticky flag. Either
    // proves the registry has been refreshed since scaffolding.
    const skillsReloaded = reload?.ok === true || !!setup.skillsReloaded;

    // Right-side status chip per row. Each row has exactly ONE chip; action
    // buttons live in a sibling `.setup-row-actions` div (see rowActions).
    const chipHtml = (key) => {
        switch (key) {
            case "pluginInstalled":
                return env.pluginInstalled
                    ? `<code class="setup-chip">${escapeHtml("v" + (env.pluginVersion || "?"))}</code>`
                    : `<span class="setup-chip missing">not installed</span>`;
            case "cliInstalled": {
                if (!env.cliInstalled) return `<span class="setup-chip missing">not installed</span>`;
                const ver = `<code class="setup-chip">${escapeHtml("v" + (env.cliVersion || "?"))}</code>`;
                const upgrade = env.upgradeAvailable
                    ? ` <span class="setup-chip badge">upgrade to ${escapeHtml(env.upgradeAvailable)}</span>`
                    : "";
                return ver + upgrade;
            }
            case "projectInitialized":
                if (!projectInitialized) return `<span class="setup-chip missing">not initialized</span>`;
                return `<a class="setup-chip setup-path" href="#" data-reveal-sub=".specify" title="Open .specify in file explorer">
                    <span class="setup-path-text">.specify</span>
                    <span class="setup-path-open" aria-hidden="true">↗</span>
                </a>`;
            case "skillsReloaded": {
                if (!projectInitialized || scaffolded.length === 0) {
                    return `<span class="setup-chip missing">not scaffolded</span>`;
                }
                if (skillsReloaded) {
                    const title = "Open .github/skills in file explorer";
                    return `<a class="setup-chip setup-path" href="#" data-reveal-sub=".github/skills" title="${escapeHtml(title)}">
                        <span class="setup-path-text">.github/skills</span>
                        <span class="setup-path-open" aria-hidden="true">↗</span>
                    </a>`;
                }
                if (reloadUnavailable) {
                    return `<span class="setup-chip missing" title="Automatic reload unavailable in this Copilot CLI">reload unavailable</span>`;
                }
                if (reload && reload.ok === false) {
                    return `<span class="setup-chip missing" title="errors=${reload.errors ?? 0}, warnings=${reload.warnings ?? 0}">reload failed</span>`;
                }
                return `<span class="setup-chip missing">skills not loaded</span>`;
            }
            case "defaultPresetsInstalled": {
                if (!projectInitialized) return `<span class="setup-chip missing">waiting for init</span>`;
                if (running === "installDefaults") {
                    return `<span class="setup-chip" title="Installing default presets — this can take several minutes">installing…</span>`;
                }
                if (defaultPresetInstalled) {
                    return `<span class="setup-chip">installed</span>`;
                }
                if (defaultPresetSkipped) {
                    return `<span class="setup-chip missing">skipped</span>`;
                }
                return `<span class="setup-chip missing">not installed</span>`;
            }
            default:
                return "";
        }
    };

    // Per-row action button (rendered next to the chip).
    //   • Rows 1 & 2 (plugin, CLI): "↻ Recheck" — force a fresh env probe.
    //     Useful when the tool was just installed manually and the wizard
    //     hasn't observed it yet. Rendered on BOTH the pending and done
    //     states so users always have a way to re-verify presence/version.
    //   • Row 3 (init): "Initialize" when pending, "↻ Initialize" when done.
    //   • Row 4 (defaults): auto-runs on init; when done, "↻ Re-install".
    //   • Row 5 (skills reload): "↻ Reload skills".
    const rowActionsHtml = (key, done) => {
        if (key === "pluginInstalled" || key === "cliInstalled") {
            // `state.envProbeRunning` is either falsy, `"pluginInstalled"`,
            // or `"cliInstalled"` — track the source row so only the clicked
            // button spins even though a single probe re-verifies both.
            // The other button stays enabled: clicking it during an in-flight
            // probe is a harmless no-op (`performEnvProbe` guards on
            // `state.envProbeRunning`), and users read a disabled sibling as
            // "something is broken" more than as "wait for the other one".
            const isRunning = state.envProbeRunning === key;
            // Second row's Recheck stays disabled until the plugin row is
            // green — checking for the CLI before confirming the plugin is
            // installed doesn't make sense in this checklist's flow.
            const blockedByPrereq = key === "cliInstalled" && !env.pluginInstalled;
            const label = isRunning
                ? `<span class="btn-spinner" aria-hidden="true"></span> Rechecking…`
                : "↻ Recheck";
            let title;
            if (blockedByPrereq) title = "Install the plugin first.";
            else if (key === "pluginInstalled") title = "Re-run the environment probe to detect a newly installed plugin.";
            else title = "Re-run the environment probe to detect a newly installed Specify CLI.";
            const disabled = isRunning || blockedByPrereq;
            return `<button type="button" class="setup-link-btn" data-setup-action="probe-env" data-probe-source="${key}" ${disabled ? "disabled" : ""} title="${escapeHtml(title)}">${label}</button>`;
        }
        if (key === "projectInitialized") {
            // Always render the text link (setup-link-btn) — never the oval
            // pill — so this row matches the Recheck / Reload skills /
            // Re-install affordances. Prereq gating is handled purely by
            // `disabled` + tooltip.
            const isRunning = running === "init";
            const prereqBlocked = !prereqsOk;
            // Stay disabled through the entire post-init chain (running ===
            // "installDefaults", "reload", etc.) — matching the Install
            // Default Presets button's `!!running` guard below — so
            // Initialize doesn't re-enable itself mid-flow.
            const disabled = isRunning || prereqBlocked || !!running;
            const label = isRunning
                ? `<span class="btn-spinner" aria-hidden="true"></span> Initializing…`
                : done
                    ? "↻ Initialize"
                    : "↻ Initialize";
            let title;
            if (prereqBlocked) title = "Install the plugin and Specify CLI first.";
            else if (done) title = "Run speckit-init to scaffold .specify/ and .github/skills/.";
            else title = "Scaffolds .specify/ and .github/skills/ via speckit-init, then reloads skills.";
            return `<button type="button" class="setup-link-btn" data-setup-action="init" ${disabled ? "disabled" : ""} title="${escapeHtml(title)}">${label}</button>`;
        }
        if (key === "skillsReloaded") {
            // Reload is the escape hatch, not the primary path — render it as
            // a subtle text link (matching the header "Recheck environment"
            // affordance) so the .github/skills chip stays the visual anchor.
            if (!projectInitialized) return "";
            const isRunning = running === "reload";
            // Gate: default presets ship their own SKILL.md files, so a
            // reload triggered before init finishes and before defaults
            // finish installing would miss those skills. Block the button
            // (and explain via tooltip) until the prereq rows are done.
            const defaultsPending =
                running === "installDefaults" ||
                state.pendingPresetActions?.["copilot-sub-agents"] === "install";
            const defaultsDone = defaultPresetInstalled || defaultPresetSkipped;
            const disabled =
                isRunning ||
                running === "init" ||
                defaultsPending ||
                !defaultsDone ||
                reloadUnavailable;
            const label = isRunning
                ? `<span class="btn-spinner" aria-hidden="true"></span> Reloading…`
                : "↻ Reload skills";
            let shortTitle;
            if (reloadUnavailable) shortTitle = "Reload unavailable";
            else if (running === "init") shortTitle = "Waiting for initialization to finish.";
            else if (defaultsPending) shortTitle = "Waiting for default presets to finish installing.";
            else if (!defaultsDone) shortTitle = "Install (or skip) the default presets first.";
            else shortTitle = "Reload skills";
            return `<button type="button" class="setup-link-btn" data-setup-action="reload" ${disabled ? "disabled" : ""} title="${escapeHtml(shortTitle)}">${label}</button>`;
        }
        if (key === "defaultPresetsInstalled") {
            // Auto-runs on init. Once init is done, always expose an inline
            // install action so users can (re)install without going to the
            // Presets tab. Uses the same code path as the Presets Add
            // button via installCatalogPreset().
            if (!projectInitialized) return "";
            const pending = state.pendingPresetActions?.["copilot-sub-agents"] === "install";
            const isRunning = pending || running === "installDefaults";
            const label = isRunning
                ? `<span class="btn-spinner" aria-hidden="true"></span> Installing…`
                : "↓ Install";
            // Also block while init is running — presets scaffold on top
            // of the .specify/ tree that init creates.
            const disabled = isRunning || !!running;
            const title = isRunning
                ? "Installing default presets — this can take several minutes."
                : running === "init"
                    ? "Waiting for initialization to finish."
                    : "Install the default preset(s).";
            return `<button type="button" class="setup-link-btn" data-setup-action="reinstall-defaults" ${disabled ? "disabled" : ""} title="${escapeHtml(title)}">${label}</button>`;
        }
        return "";
    };

    const row = (title, sub, done, key, subHtml) => {
        const actions = rowActionsHtml(key, done);
        const noteHtml = key === "skillsReloaded" && reloadUnavailable
            ? `<div class="setup-row-note">Automatic reload unavailable — run <code>/skills reload</code> in chat, or restart the session.</div>`
            : "";
        // Every actionable row stacks chip above button so the chip stays
        // the visual anchor and the text-link action reads as secondary.
        // (pluginInstalled/cliInstalled now expose a ↻ Recheck link.)
        const stackedKeys = new Set([
            "pluginInstalled",
            "cliInstalled",
            "projectInitialized",
            "skillsReloaded",
            "defaultPresetsInstalled",
        ]);
        const statusInner = stackedKeys.has(key)
            ? `<div class="setup-chip-stack">${chipHtml(key)}${actions}</div>`
            : `${chipHtml(key)}${actions}`;
        return `
        <div class="setup-row ${done ? "done" : "pending"}">
            <span class="status-indicator" aria-label="${done ? "completed" : "not completed"}">${done ? "✓" : "▶"}</span>
            <div class="setup-row-main">
                <div class="row-title">${escapeHtml(title)}</div>
                <div class="row-sub">${subHtml ?? escapeHtml(sub)}</div>
                ${noteHtml}
            </div>
            <div class="setup-row-status">
                ${statusInner}
            </div>
        </div>`;
    };

    const steps = [
        {
            key: "pluginInstalled",
            title: "Install Spec Kit Copilot plugin",
            sub: "This step only verifies the plugin is present and reports its version. Manual install required: install the spec-kit-marketplace and spec-kit-copilot skills plugin. See installation instructions ↗.",
            subHtml: `<p>This step only verifies the plugin is present and reports its version.</p><p><strong>Manual install required:</strong> install the <strong>spec-kit-marketplace</strong> and <strong>spec-kit-copilot</strong> skills plugin, then <strong>restart the GitHub Copilot app</strong>. <a href="https://github.com/github/spec-kit-copilot#installation" target="_blank" rel="noopener noreferrer">See installation instructions ↗</a>.</p>`,
        },
        {
            key: "cliInstalled",
            title: "Install the Specify CLI from Spec Kit",
            sub: "This step only verifies the CLI is present and reports its version. Manual install required: install the Specify CLI via the speckit-cli-setup skill ↗.",
            subHtml: `<p>This step only verifies the CLI is present and reports its version.</p><p><strong>Manual install required:</strong> install the <strong>Specify CLI</strong> via the <a href="https://github.com/github/spec-kit-copilot#core-skills-plugin" target="_blank" rel="noopener noreferrer"><strong>speckit-cli-setup</strong> skill ↗</a>.</p>`,
        },
        {
            key: "projectInitialized",
            title: "Initialize the project",
            sub: "Runs the speckit-init skill to enable the project with Spec Kit by invoking `specify init` to scaffold `.specify/` and `.github/skills/`.",
            subHtml: `Runs the <strong>speckit-init</strong> skill to enable the project with Spec Kit by invoking <code>specify init</code> to scaffold <code>.specify/</code> and <code>.github/skills/</code>.`,
        },
        {
            key: "defaultPresetsInstalled",
            title: "Install default presets",
            sub: "Adds a starter set of presets that tailor Spec Kit's behavior. Takes a few minutes. View them on the Presets tab when done.",
            subHtml: `Adds a starter set of presets that tailor Spec Kit's behavior. Takes a few minutes. View them on the <strong>Presets</strong> tab when done.`,
        },
        {
            key: "skillsReloaded",
            title: "Reload skills",
            sub: "Reloads the Copilot skill registry so newly scaffolded /speckit-* commands appear in this session.",
            subHtml: `<p>Reloads the Copilot skill registry so newly scaffolded <code>/speckit-*</code> commands appear in this session.</p>`,
        },
    ];

    // Row completion is derived from live truth (FS + env probe + live reload
    // result) so external changes (deleting .specify, uninstalling the CLI,
    // reload failure) are reflected immediately.
    const isOwnStepDone = (key) => {
        if (key === "pluginInstalled") return !!env.pluginInstalled;
        if (key === "cliInstalled") return !!env.cliInstalled;
        if (key === "projectInitialized") return projectInitialized;
        if (key === "skillsReloaded") return projectInitialized && skillsReloaded;
        if (key === "defaultPresetsInstalled") return projectInitialized && (defaultPresetInstalled || defaultPresetSkipped);
        return false;
    };

    // Sequential gating: a row shows the green ✓ only when its own condition
    // is met AND every prior row is also done. This keeps the checklist
    // visually monotonic — you never see a later step lit green while an
    // earlier one is still pending.
    let priorAllDone = true;
    const doneByKey = {};
    for (const s of steps) {
        const own = isOwnStepDone(s.key);
        doneByKey[s.key] = priorAllDone && own;
        priorAllDone = priorAllDone && own;
    }

    return `
    <div class="setup-rows">
        ${steps.map((s) => row(s.title, s.sub, doneByKey[s.key], s.key, s.subHtml)).join("")}
    </div>`;
}

export function collectSetupValues() {
    // Read the setup form fields from the Setup phase's declared schema.
    // If they're not on the DOM (setup uses row-based UI, not a form),
    // fall back to defaults from the last known formValues.
    const p = state.snapshot?.phases?.setup;
    const vals = { ...(p?.formValues || {}) };
    // Integration is always Copilot for this wizard; downstream callers
    // (e.g. speckit-init) still expect the field, so seed it here.
    vals.integration = "copilot";
    if (vals.here === undefined) vals.here = true;
    return vals;
}

