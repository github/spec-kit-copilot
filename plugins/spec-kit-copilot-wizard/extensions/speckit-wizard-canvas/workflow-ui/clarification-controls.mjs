import { applicableDrafts } from "./clarifications.mjs";

const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]);

export function selectedDrafts(view, queue) {
    return applicableDrafts(queue.list(view.context), view.marks).filter((entry) => !view.excluded?.has(entry.marker));
}

export function observationMessage(observed) {
    if (!observed) return "";
    if (observed.complete) return "Selected markers are no longer visible. Review the artifact to verify the edit.";
    if (observed.timedOut) return "Timed out waiting for an artifact update. Drafts retained; the agent may still be editing. Refresh and review before retrying.";
    return "Submitted; waiting for an artifact update. Drafts remain editable.";
}

export function refreshDraftControls(root, view, queue, { apply, refresh }) {
    const answers = queue.list(view.context);
    const applicable = applicableDrafts(answers, view.marks);
    const unmatched = answers.filter((entry) => !applicable.includes(entry));
    view.excluded ??= new Set();
    root.querySelectorAll("[data-clarify-idx]").forEach((button) => {
        const mark = view.marks[Number(button.dataset.clarifyIdx)];
        const draft = answers.find((entry) => entry.marker === mark?.marker);
        button.textContent = draft ? "Edit draft" : "Clarify";
        if (draft) button.title = draft.answer;
        else button.removeAttribute("title");
    });
    const banner = root.querySelector(".artifact-viewer-clarify-banner");
    const sending = queue.isSending(view.context);
    const pending = queue.isPending(view.context);
    const count = selectedDrafts(view, queue).length;
    banner.hidden = !answers.length && !view.message;
    if (banner.hidden) { banner.innerHTML = ""; return; }
    banner.innerHTML = `<span role="status">${esc(view.message || `${view.marks.length} open clarifications. ${applicable.length} draft${applicable.length === 1 ? "" : "s"} saved.`)}</span>
        ${applicable.length ? `<div class="clarify-draft-list">${applicable.map((entry, index) => `<label><input type="checkbox" data-draft-select="${index}" ${view.excluded.has(entry.marker) ? "" : "checked"}> Draft saved — ${esc(entry.question)}</label>`).join("")}</div>
        <button class="btn btn-primary btn-sm" id="apply-clarifications" type="button" ${pending || !count ? "disabled" : ""}>${sending ? "Submitting…" : `Apply answers (${count})`}</button>` : ""}
        ${unmatched.length ? `<details><summary>${unmatched.length} retained draft${unmatched.length === 1 ? "" : "s"} need review (marker missing or ambiguous)</summary>${unmatched.map((entry, index) => `<p>${esc(entry.question)}</p><pre class="clarify-retained-draft">${esc(entry.answer)}</pre><button class="btn btn-ghost btn-sm" data-draft-discard="${index}" type="button">Discard draft</button>`).join("")}</details>` : ""}
        ${view.message ? '<button class="btn btn-ghost btn-sm" data-draft-refresh type="button">Refresh artifact</button>' : ""}`;
    banner.querySelector("#apply-clarifications")?.addEventListener("click", apply);
    banner.querySelector("[data-draft-refresh]")?.addEventListener("click", refresh);
    banner.querySelectorAll("[data-draft-select]").forEach((input) => input.addEventListener("change", () => {
        const marker = applicable[Number(input.dataset.draftSelect)].marker;
        if (input.checked) view.excluded.delete(marker);
        else view.excluded.add(marker);
        refreshDraftControls(root, view, queue, { apply, refresh });
        banner.querySelector(`[data-draft-select="${input.dataset.draftSelect}"]`)?.focus();
    }));
    banner.querySelectorAll("[data-draft-discard]").forEach((button) => button.addEventListener("click", () => {
        queue.discard(view.context, unmatched[Number(button.dataset.draftDiscard)].marker);
        refreshDraftControls(root, view, queue, { apply, refresh });
    }));
}
