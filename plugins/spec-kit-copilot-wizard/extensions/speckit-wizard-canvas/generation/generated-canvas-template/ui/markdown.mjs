const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
})[character]);

export function renderMarkdown(source) {
    const lines = String(source ?? "")
        .replace(/\r\n?/g, "\n")
        .replace(/<!--[\s\S]*?-->/g, "")
        .split("\n");
    const html = [];
    let index = 0;

    const inline = (text) => {
        let rendered = esc(text);
        rendered = rendered.replace(/`([^`\n]+)`/g, "<code>$1</code>");
        rendered = rendered.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
        rendered = rendered.replace(/__([^_\n]+)__/g, "<strong>$1</strong>");
        rendered = rendered.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
        rendered = rendered.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, "$1<em>$2</em>");
        return rendered.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_match, label, url) => {
            const href = /^(https?:|mailto:|#)/i.test(url) ? url : "#";
            return `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
        });
    };

    const renderList = (tag, items) => {
        html.push(`<${tag}>${items.map((item) => `<li>${inline(item)}</li>`).join("")}</${tag}>`);
    };

    while (index < lines.length) {
        const line = lines[index];
        if (/^```/.test(line)) {
            const language = line.slice(3).trim();
            const body = [];
            index += 1;
            while (index < lines.length && !/^```/.test(lines[index])) body.push(lines[index++]);
            if (index < lines.length) index += 1;
            const className = language ? ` class="language-${esc(language)}"` : "";
            html.push(`<pre><code${className}>${esc(body.join("\n"))}</code></pre>`);
            continue;
        }
        const heading = /^(#{1,6})\s+(.*)$/.exec(line);
        if (heading) {
            const level = heading[1].length;
            html.push(`<h${level}>${inline(heading[2].trim())}</h${level}>`);
            index += 1;
            continue;
        }
        if (/^\s*(?:-{3,}|_{3,}|\*{3,})\s*$/.test(line)) {
            html.push("<hr />");
            index += 1;
            continue;
        }
        if (/^>\s?/.test(line)) {
            const quote = [];
            while (index < lines.length && /^>\s?/.test(lines[index])) {
                quote.push(lines[index++].replace(/^>\s?/, ""));
            }
            html.push(`<blockquote>${inline(quote.join("\n"))}</blockquote>`);
            continue;
        }
        if (/^\s*[-*+]\s+/.test(line)) {
            const items = [];
            while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) {
                items.push(lines[index++].replace(/^\s*[-*+]\s+/, ""));
            }
            renderList("ul", items);
            continue;
        }
        if (/^\s*\d+\.\s+/.test(line)) {
            const items = [];
            while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
                items.push(lines[index++].replace(/^\s*\d+\.\s+/, ""));
            }
            renderList("ol", items);
            continue;
        }
        if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?\s*:?-+:?(\s*\|\s*:?-+:?)+\|?\s*$/.test(lines[index + 1] ?? "")) {
            const cells = (row) => row.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
            const headers = cells(line);
            const rows = [];
            index += 2;
            while (index < lines.length && /^\s*\|.*\|\s*$/.test(lines[index])) rows.push(cells(lines[index++]));
            html.push(`<table><thead><tr>${headers.map((cell) => `<th>${inline(cell)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
            continue;
        }
        if (/^\s*$/.test(line)) {
            index += 1;
            continue;
        }
        const paragraph = [];
        while (
            index < lines.length
            && !/^\s*$/.test(lines[index])
            && !/^(#{1,6})\s+/.test(lines[index])
            && !/^```/.test(lines[index])
            && !/^\s*[-*+]\s+/.test(lines[index])
            && !/^\s*\d+\.\s+/.test(lines[index])
            && !/^>\s?/.test(lines[index])
            && !/^\s*(?:-{3,}|_{3,}|\*{3,})\s*$/.test(lines[index])
        ) {
            paragraph.push(lines[index++]);
        }
        html.push(`<p>${inline(paragraph.join("\n"))}</p>`);
    }
    return html.join("\n");
}
