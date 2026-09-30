const token = new URL(location.href).searchParams.get("token");
const root = document.getElementById("settings-page");
const tabs = document.querySelector(".tabs");
const errorBox = document.getElementById("page-error");
const themeButton = document.getElementById("theme-toggle");
const THEME_KEY = "speckit-canvas-designer.theme";
let model, currentPage, draft;

function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
}

function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = !message;
    if (message) errorBox.focus();
}

function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    themeButton.textContent = theme === "dark" ? "\u263e" : "\u2600";
    themeButton.setAttribute("aria-label", theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
    themeButton.title = themeButton.getAttribute("aria-label");
}

let storedTheme;
try { storedTheme = localStorage.getItem(THEME_KEY); }
catch (error) { showError(`Theme preference could not be read: ${error.message}`); }
applyTheme(["dark", "light"].includes(storedTheme) ? storedTheme
    : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
themeButton.addEventListener("click", () => {
    const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(theme);
    try { localStorage.setItem(THEME_KEY, theme); }
    catch (error) { showError(`Theme changed, but its preference could not be saved: ${error.message}`); }
});

function renderPage(pageId) {
    const page = model.pages.find((entry) => entry.page === pageId);
    if (!page) throw new Error("Unknown Designer page");
    currentPage = pageId;
    for (const tab of tabs.children) {
        const active = tab.dataset.page === pageId;
        tab.setAttribute("aria-selected", String(active));
        tab.tabIndex = active ? 0 : -1;
    }
    root.setAttribute("aria-labelledby", `page-tab-${pageId}`);
    root.replaceChildren(element("h1", page.title), element("p", page.description ?? "", "muted"));
    const form = element("form");
    form.noValidate = true;
    form.addEventListener("submit", (event) => event.preventDefault());
    if (!page.fields.length) form.append(element("p", "This template defines no fields.", "settings-note"));
    for (const [index, field] of page.fields.entries()) {
        const rules = model.constraints[field.id];
        const checkbox = rules.type === "boolean";
        const wrapper = element("div", undefined, `settings-field${checkbox ? " settings-checkbox" : ""}`);
        const label = element("label", field.label);
        const input = element("input");
        input.id = `setting-field-${index}`;
        input.name = field.id;
        label.htmlFor = input.id;
        if (field.description) {
            label.title = field.description;
            input.setAttribute("aria-description", field.description);
        }
        if (checkbox) {
            input.type = "checkbox";
            input.checked = draft[field.id];
        } else {
            input.type = "text";
            input.value = draft[field.id];
            input.required = rules.minLength > 0;
            input.maxLength = rules.maxLength;
            if (rules.pattern) input.pattern = rules.pattern;
            if (input.required) label.append(element("span", " (required)", "muted"));
        }
        input.addEventListener("input", () => { draft[field.id] = checkbox ? input.checked : input.value; });
        wrapper.append(...(checkbox ? [input, label] : [label, input]));
        form.append(wrapper);
    }
    root.append(form);
    root.setAttribute("aria-busy", "false");
}

tabs.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-page]");
    if (tab) renderPage(tab.dataset.page);
});
tabs.addEventListener("keydown", (event) => {
    const buttons = [...tabs.children];
    const index = buttons.indexOf(document.activeElement);
    if (index < 0) return;
    let next;
    if (event.key === "ArrowRight") next = (index + 1) % buttons.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + buttons.length) % buttons.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = buttons.length - 1;
    else return;
    event.preventDefault();
    renderPage(buttons[next].dataset.page);
    buttons[next].focus();
});

const events = new EventSource(`/events?token=${encodeURIComponent(token)}`);
const status = document.getElementById("conn-status");
events.onopen = () => {
    status.className = "conn conn-live";
    status.textContent = "Live";
};
events.onerror = () => {
    status.className = "conn conn-lost";
    status.textContent = "Disconnected";
};
window.addEventListener("pagehide", () => events.close(), { once: true });

try {
    const response = await fetch(`/api/state?token=${encodeURIComponent(token)}`);
    if (!response.ok) throw new Error(`Designer settings request failed (${response.status})`);
    model = await response.json();
    draft = structuredClone(model.values);
    for (const page of model.pages) {
        const tab = element("button", page.title, "tab");
        tab.type = "button";
        tab.dataset.page = page.page;
        tab.id = `page-tab-${page.page}`;
        tab.setAttribute("role", "tab");
        tab.setAttribute("aria-controls", "settings-page");
        tabs.append(tab);
    }
    renderPage(model.pages.some((page) => page.page === "setup") ? "setup" : model.pages[0].page);
} catch (error) {
    root.setAttribute("aria-busy", "false");
    root.replaceChildren(element("h1", "Settings unavailable"));
    showError(error.message);
}
