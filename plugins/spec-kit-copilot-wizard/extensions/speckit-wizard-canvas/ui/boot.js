// Boot overlay module. Renders a live checklist of the wizard backend's
// startup steps, updated over SSE. Self-contained; no dependency on the
// main app modules — bootstraps and tears down before the app takes over.
//
// Wire-in points:
//   - ui/index.html has <div id="boot-overlay"></div> + <link boot.css>.
//   - ui/app.js imports installBootOverlay() and calls it before any
//     other module initialization; the overlay hides itself once the
//     backend reports `boot.phase === "ready"`.
//   - ui/client.js dispatches `boot.update` messages here via
//     handleBootMessage() (registered by installBootOverlay).

const STEP_LABELS = {
    workspace: "Resolving project",
    "deps-check": "Checking dependencies",
    "deps-install": "Installing dependencies",
    "env-probe": "Probing environment",
    catalog: "Loading catalogs",
    composition: "Building composition",
    ready: "Ready",
};

// SSE token needed for /api/deps/{diagnose,retry} POST. app.js sets it.
let __token = null;
let __root = null;
let __state = { phase: null, steps: [] };
let __depsError = null;
let __appRootEl = null;
let __banner = null;
// Module-level pending state so re-renders (which reset the DOM every SSE
// tick) preserve the "button was clicked, response pending" visual state.
// Otherwise a snapshot broadcast a few ms after the click re-enables the
// button and the user can double-fire retry/diagnose.
let __pending = { retry: false, diagnose: false };
// Once the user dismisses the in-app banner for a given error timestamp,
// remember it so subsequent SSE ticks don't re-open it. A new failure
// (different timestamp) will still surface.
let __bannerDismissedFor = null;
// User elected to bypass the frozen boot dialog (deps still failed but they
// want to try the wizard anyway). Keyed by timestamp so a fresh failure
// re-freezes the boot dialog instead of silently reusing this decision.
let __continueAnywayFor = null;
// Timestamp (performance.now) at which the overlay first painted. Used to
// enforce a minimum visible time so a very-fast boot doesn't skip the
// overlay entirely — on a warm cache the `/api/state` fetch returns
// `boot.phase === "ready"` within a single paint frame, and without this
// guard the browser composites overlay-populated + overlay-hidden into
// one frame and the user sees a blank body flip straight to the app.
let __overlayShownAt = 0;
let __minVisibleTimer = null;
// Minimum time the overlay stays visible once first rendered. Long enough
// for the user to register that boot is happening; short enough not to
// feel like padding.
const MIN_OVERLAY_MS = 450;

// Runtime dependencies the extension needs to fully function. Surfaced in
// the in-wizard banner as a copy/paste-friendly install command. Keep in
// sync with package.json.
const RUNTIME_DEP_PACKAGES = ["js-yaml"];

export function installBootOverlay({ token }) {
    __token = token || null;
    __root = document.getElementById("boot-overlay");
    if (!__root) return { handleBootMessage: () => {}, setInitialSnapshot: () => {} };
    __appRootEl = document.querySelector("main.app-body");
    if (__appRootEl) __appRootEl.style.visibility = "hidden";
    __overlayShownAt = performance.now();
    render();
    return {
        handleBootMessage,
        setInitialSnapshot,
        setDepsError,
    };
}

// Called by app.js after the first REST snapshot arrives, so the overlay
// reflects whatever progress the server has already made (avoids a
// blank frame while we wait for the first SSE tick).
export function setInitialSnapshot(snapshot) {
    if (!snapshot) return;
    if (snapshot.boot) __state = snapshot.boot;
    if (snapshot.depsError) __depsError = snapshot.depsError;
    render();
}

export function setDepsError(err) {
    __depsError = err ?? null;
    render();
}

export function handleBootMessage(msg) {
    if (!msg || typeof msg !== "object") return;
    if (msg.type !== "boot.update") return;
    if (msg.boot) __state = msg.boot;
    if (msg.depsError !== undefined) __depsError = msg.depsError;
    render();
}

function render() {
    if (!__root) return;

    // Ready → normally fade the overlay out. BUT when a deps error is
    // active we freeze the boot dialog so the user can troubleshoot with
    // the agent, retry, or explicitly opt into continuing. Once they click
    // "Continue" (which sets __continueAnywayFor for this error
    // timestamp), the overlay dismisses regardless of the boot phase —
    // the pipeline can be stuck at deps-install and never reach "ready",
    // but the user has explicitly chosen to move on. A prominent in-wizard
    // banner then spells out the manual fix.
    const errTs = __depsError?.timestamp ?? null;
    const bypassed = __depsError && __continueAnywayFor === errTs;
    const shouldHideOverlay = bypassed || (__state?.phase === "ready" && !__depsError);

    if (shouldHideOverlay) {
        // Enforce a minimum visible time. Without this, a warm-cache boot
        // completes before the browser has a chance to paint the overlay
        // content at all — the user sees a blank body flip straight to the
        // loaded app with no boot indicator. See comment on
        // MIN_OVERLAY_MS.
        const elapsed = performance.now() - __overlayShownAt;
        if (elapsed < MIN_OVERLAY_MS) {
            if (!__minVisibleTimer) {
                __minVisibleTimer = setTimeout(() => {
                    __minVisibleTimer = null;
                    render();
                }, MIN_OVERLAY_MS - elapsed);
            }
            return;
        }
        if (!__root.classList.contains("is-hidden")) {
            __root.classList.add("is-hidden");
            setTimeout(() => {
                // Recompute the guard inside the timeout — if a fresh error
                // arrived during the fade we need to snap back into the
                // frozen overlay instead of hiding it out from under the user.
                const stillBypassed = __depsError && __continueAnywayFor === __depsError.timestamp;
                const stillReady = __state?.phase === "ready" && !__depsError;
                if (__root && (stillBypassed || stillReady)) {
                    __root.style.display = "none";
                    if (__appRootEl) __appRootEl.style.visibility = "visible";
                }
            }, 320);
        }
        renderBanner();
        return;
    }
    // Overlay still owning the screen: keep the banner hidden.
    hideBanner();

    __root.style.display = "";
    __root.classList.remove("is-hidden");
    __root.className = "boot-overlay";
    __root.innerHTML = "";

    const panel = document.createElement("div");
    panel.className = "boot-panel";

    const title = document.createElement("h1");
    title.className = "boot-title";
    title.innerHTML = '<span class="boot-title-mark" aria-hidden="true">◈</span>Starting Spec Kit Wizard - Dev';
    panel.appendChild(title);

    const subtitle = document.createElement("p");
    subtitle.className = "boot-subtitle";
    subtitle.textContent = "Preparing your project…";
    panel.appendChild(subtitle);

    const list = document.createElement("ul");
    list.className = "boot-steps";
    for (const step of __state?.steps ?? []) {
        list.appendChild(renderStep(step));
    }
    panel.appendChild(list);

    if (__depsError) {
        panel.appendChild(renderErrorCard(__depsError));
    }

    __root.appendChild(panel);
}

// Prominent in-wizard alert shown once the user has explicitly bypassed the
// boot dialog (Continue anyway) or after a fresh error while the overlay is
// mid-fade. Includes an actionable manual-install command + extension path
// so the user can fix it themselves in a terminal. Dismiss × drops it for
// this error instance only.
function renderBanner() {
    if (!__depsError || __bannerDismissedFor === __depsError.timestamp) {
        hideBanner();
        return;
    }
    if (!__banner) {
        __banner = document.createElement("div");
        __banner.className = "deps-error-banner";
        __banner.setAttribute("role", "alert");
        const host = __appRootEl?.parentNode ?? document.body;
        host.insertBefore(__banner, __appRootEl ?? null);
    }
    __banner.innerHTML = "";

    const icon = document.createElement("span");
    icon.className = "deps-error-banner-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "⚠";
    __banner.appendChild(icon);

    const body = document.createElement("div");
    body.className = "deps-error-banner-body";

    const title = document.createElement("div");
    title.className = "deps-error-banner-title";
    title.textContent = "Missing dependency: " + RUNTIME_DEP_PACKAGES.join(", ");
    body.appendChild(title);

    const msg = document.createElement("div");
    msg.className = "deps-error-banner-msg";
    msg.textContent = "Some wizard features (catalog parsing, preset details) may not work. To fix, install the package manually and reload this canvas.";
    body.appendChild(msg);

    const steps = document.createElement("ol");
    steps.className = "deps-error-banner-steps";

    const step1 = document.createElement("li");
    step1.textContent = "Open a terminal in the extension folder:";
    const path = document.createElement("code");
    path.className = "deps-error-banner-path";
    path.textContent = __depsError.extDir || "(extension folder)";
    step1.appendChild(document.createElement("br"));
    step1.appendChild(path);
    steps.appendChild(step1);

    const step2 = document.createElement("li");
    const cmdWrap = document.createElement("span");
    cmdWrap.textContent = "Run: ";
    const cmd = document.createElement("code");
    cmd.className = "deps-error-banner-cmd";
    cmd.textContent = "npm install " + RUNTIME_DEP_PACKAGES.join(" ");
    cmdWrap.appendChild(cmd);
    step2.appendChild(cmdWrap);
    steps.appendChild(step2);

    const step3 = document.createElement("li");
    step3.textContent = "Close and reopen this canvas panel.";
    steps.appendChild(step3);

    body.appendChild(steps);
    __banner.appendChild(body);

    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "deps-error-banner-dismiss";
    dismiss.setAttribute("aria-label", "Dismiss");
    dismiss.title = "Dismiss";
    dismiss.textContent = "×";
    dismiss.addEventListener("click", () => {
        __bannerDismissedFor = __depsError?.timestamp ?? "dismissed";
        hideBanner();
    });
    __banner.appendChild(dismiss);

    __banner.style.display = "";
}

function hideBanner() {
    if (__banner) __banner.style.display = "none";
}

function renderStep(step) {
    const li = document.createElement("li");
    li.className = "boot-step";
    li.dataset.status = step.status || "pending";
    li.dataset.step = step.id;

    const icon = document.createElement("span");
    icon.className = "boot-step-icon";
    icon.setAttribute("aria-hidden", "true");
    li.appendChild(icon);

    const label = document.createElement("div");
    const labelText = document.createElement("span");
    labelText.className = "boot-step-label";
    labelText.textContent = STEP_LABELS[step.id] || step.id;
    label.appendChild(labelText);

    // Prefer `output` (live per-line updates written by tracker.tick()) and
    // fall back to `detail` for compatibility with any callers that set it
    // directly. Without this, the throttled live npm output emitted over
    // SSE would never render in the checklist.
    const detailText = step.output || step.detail || "";
    if (detailText) {
        const detail = document.createElement("span");
        detail.className = "boot-step-detail";
        detail.textContent = detailText;
        label.appendChild(detail);
    }
    li.appendChild(label);

    return li;
}

function renderErrorCard(err) {
    const card = document.createElement("div");
    card.className = "boot-error-card";

    const title = document.createElement("h2");
    title.className = "boot-error-title";
    title.textContent = err.title || "Dependency install failed";
    card.appendChild(title);

    const hint = document.createElement("p");
    hint.className = "boot-error-hint";
    hint.textContent = err.hint || "The Copilot agent can help diagnose the failure.";
    card.appendChild(hint);

    if (err.stderrTail) {
        const pre = document.createElement("pre");
        pre.className = "boot-error-stderr";
        pre.textContent = err.stderrTail;
        card.appendChild(pre);
    }

    const actions = document.createElement("div");
    actions.className = "boot-error-actions";

    const diagnose = document.createElement("button");
    diagnose.type = "button";
    diagnose.className = "boot-btn boot-btn-primary";
    if (__pending.diagnose) {
        diagnose.disabled = true;
        diagnose.textContent = "Dispatching to agent…";
    } else {
        diagnose.textContent = "Diagnose and fix with the agent";
    }
    diagnose.addEventListener("click", () => {
        if (__pending.diagnose) return;
        __pending.diagnose = true;
        diagnose.disabled = true;
        diagnose.textContent = "Dispatching to agent…";
        callDeps("/api/deps/diagnose", { errorCode: err.code }).finally(() => {
            __pending.diagnose = false;
            // Force a re-render so any concurrently disabled UI unlocks.
            render();
        });
    });
    actions.appendChild(diagnose);

    if (err.canRetry !== false) {
        const retry = document.createElement("button");
        retry.type = "button";
        retry.className = "boot-btn boot-btn-secondary";
        if (__pending.retry) {
            retry.disabled = true;
            retry.textContent = "Retrying…";
        } else {
            retry.textContent = "Retry install";
        }
        retry.addEventListener("click", () => {
            if (__pending.retry) return;
            __pending.retry = true;
            retry.disabled = true;
            retry.textContent = "Retrying…";
            callDeps("/api/deps/retry", {}).finally(() => {
                __pending.retry = false;
                render();
            });
        });
        actions.appendChild(retry);
    }

    // Escape hatch: user has read the failure and wants to try the wizard
    // anyway. Marks this specific error timestamp as bypassed so render()
    // will finally hide the overlay — regardless of whether the backend's
    // boot pipeline ever reached "ready" (installDeps re-runs npm install
    // and can stay stuck on network errors indefinitely, so we can't gate
    // on phase). The in-wizard banner will spell out the manual fix. A
    // fresh failure (new timestamp) re-freezes.
    //
    // This button is intentionally NEVER disabled, even mid-dispatch of
    // Diagnose or Retry — it's the user's only guaranteed way out of the
    // frozen dialog.
    const proceed = document.createElement("button");
    proceed.type = "button";
    proceed.className = "boot-btn boot-btn-tertiary";
    proceed.textContent = "Continue";
    proceed.title = "Open the wizard without installing dependencies. Some features may not work.";
    proceed.addEventListener("click", () => {
        __continueAnywayFor = err.timestamp ?? "bypassed";
        render();
    });
    actions.appendChild(proceed);

    const proceedNote = document.createElement("p");
    proceedNote.className = "boot-error-proceed-note";
    proceedNote.textContent = "If you continue, you'll need to run `npm install " + RUNTIME_DEP_PACKAGES.join(" ") + "` manually and reload the canvas for full functionality.";
    card.appendChild(proceedNote);

    card.appendChild(actions);
    return card;
}

async function callDeps(path, body) {
    const headers = { "Content-Type": "application/json" };
    if (__token) headers["X-Canvas-Token"] = __token;
    const res = await fetch(path, {
        method: "POST",
        headers,
        body: JSON.stringify(body || {}),
    });
    return res.json().catch(() => ({}));
}

