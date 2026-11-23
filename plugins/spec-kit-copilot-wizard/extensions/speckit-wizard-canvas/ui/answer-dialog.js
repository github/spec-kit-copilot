const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

// Module-scoped singleton so closeWizardModal() from anywhere shuts the
// current modal — same behavior as the original app.js-level `let`.
let __wizardModalCloser = null;

export function closeWizardModal() {
    if (typeof __wizardModalCloser === "function") {
        try { __wizardModalCloser(); } catch { /* ignore */ }
    }
    __wizardModalCloser = null;
}

export function openWizardModal(opts) {
    closeWizardModal();
    const root = document.getElementById("wizard-modal-root");
    if (!root) return;

    const {
        title, description = "", questionBox = "", textareaLabel = "Input",
        placeholder = "", initialValue = "", required = false,
        cancelLabel = "Cancel", confirmLabel, extraButtons = [], onConfirm,
    } = opts || {};

    const backdrop = document.createElement("div");
    backdrop.className = "wizard-modal-backdrop";
    backdrop.innerHTML = `
        <div class="wizard-modal" role="dialog" aria-modal="true" aria-labelledby="wm-title">
            <header class="wizard-modal-head">
                <h3 id="wm-title">${escapeHtml(title || "")}</h3>
                <button class="btn-icon wizard-modal-close" aria-label="Close">✕</button>
            </header>
            <div class="wizard-modal-body">
                ${description ? `<p class="wizard-modal-desc">${escapeHtml(description)}</p>` : ""}
                ${questionBox ? `<div class="wizard-modal-question">${escapeHtml(questionBox)}</div>` : ""}
                <label class="wizard-modal-field">
                    <span class="wizard-modal-field-label">${escapeHtml(textareaLabel)}</span>
                    <textarea class="wizard-modal-textarea" placeholder="${escapeHtml(placeholder)}"></textarea>
                </label>
            </div>
            <footer class="wizard-modal-foot">
                <button class="btn btn-secondary btn-sm wizard-modal-cancel">${escapeHtml(cancelLabel)}</button>
                <span class="wizard-modal-extras"></span>
                <button class="btn btn-primary btn-sm wizard-modal-confirm">${escapeHtml(confirmLabel || "Confirm")}</button>
            </footer>
        </div>
    `;
    root.appendChild(backdrop);

    const ta = backdrop.querySelector(".wizard-modal-textarea");
    const confirmBtn = backdrop.querySelector(".wizard-modal-confirm");
    const cancelBtn = backdrop.querySelector(".wizard-modal-cancel");
    const closeBtn = backdrop.querySelector(".wizard-modal-close");
    const extrasHost = backdrop.querySelector(".wizard-modal-extras");

    if (ta) {
        ta.value = initialValue;
        setTimeout(() => ta.focus(), 0);
    }

    // Extra buttons between Cancel and Confirm.
    for (const btn of extraButtons) {
        const b = document.createElement("button");
        b.className = btn.className || "btn btn-ghost btn-sm";
        b.type = "button";
        b.textContent = btn.label || "";
        b.addEventListener("click", () => btn.onClick?.(close));
        extrasHost.appendChild(b);
    }

    const syncConfirmDisabled = () => {
        if (!required) return;
        confirmBtn.disabled = !ta?.value.trim();
    };
    syncConfirmDisabled();
    ta?.addEventListener("input", syncConfirmDisabled);

    let closed = false;
    const close = () => {
        if (closed) return;
        closed = true;
        document.removeEventListener("keydown", onKey);
        backdrop.remove();
        if (__wizardModalCloser === close) __wizardModalCloser = null;
    };
    const onKey = (e) => {
        if (e.key === "Escape") { e.preventDefault(); close(); }
    };
    document.addEventListener("keydown", onKey);

    cancelBtn.addEventListener("click", close);
    closeBtn.addEventListener("click", close);
    backdrop.addEventListener("click", (e) => {
        if (e.target === backdrop) close();
    });
    confirmBtn.addEventListener("click", async () => {
        if (confirmBtn.disabled) return;
        const value = ta?.value ?? "";
        confirmBtn.disabled = true;
        try {
            await onConfirm?.(value, close);
        } finally {
            // If handler didn't close, re-enable so user can retry.
            if (!closed) confirmBtn.disabled = false;
        }
    });

    __wizardModalCloser = close;
}
