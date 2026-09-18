// Shared safe Markdown rendering and visible clarification-marker presentation.
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
})[character]);

export function renderMarkdown(source, { clarifications } = {}) {
    const lines = String(source ?? "")
        .replace(/\r\n?/g, "\n")
        // Separate fragments so hiding comments cannot recreate markup; esc still handles HTML safety.
        .replace(/<!--[\s\S]*?-->/g, " ")
        .split("\n");
    const html = [];
    let index = 0;

    const emphasis = (text) => {
        let rendered = esc(text);
        rendered = rendered.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
        rendered = rendered.replace(/__([^_\n]+)__/g, "<strong>$1</strong>");
        rendered = rendered.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
        rendered = rendered.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, "$1<em>$2</em>");
        return rendered;
    };
    const marked = (text) => {
        if (!clarifications) return emphasis(text);
        let result = "", cursor = 0;
        for (const match of text.matchAll(/\[NEEDS CLARIFICATION:\s*([\s\S]*?)\]/gi)) {
            const marker = { question: match[1].trim(), marker: match[0], startIdx: match.index, endIdx: match.index + match[0].length };
            result += emphasis(text.slice(cursor, marker.startIdx));
            const index = clarifications.push(marker) - 1;
            result += `<mark class="clarify-marker">${esc(text.slice(marker.startIdx, marker.endIdx))}</mark> <button type="button" class="clarify-pill" data-clarify-idx="${index}">Clarify</button>`;
            cursor = marker.endIdx;
        }
        return result + emphasis(text.slice(cursor));
    };
    const inline = (text) => {
        let result = "", cursor = 0;
        // Tokenize before inserting HTML: markers inside code or links are never controls.
        for (const token of text.matchAll(/(`+)([\s\S]*?)\1|\[((?:[^\[\]\n]|\[[^\]\n]*\])+)\]\(([^)\s]+)\)|\[NEEDS CLARIFICATION:\s*[\s\S]*?\]/gi)) {
            result += marked(text.slice(cursor, token.index));
            if (token[1]) result += `<code>${esc(token[2])}</code>`;
            else if (token[3] !== undefined) {
                const href = /^(https?:|mailto:|#)/i.test(token[4]) ? esc(token[4]) : "#";
                result += `<a href="${href}" target="_blank" rel="noopener noreferrer">${emphasis(token[3])}</a>`;
            } else result += marked(token[0]);
            cursor = token.index + token[0].length;
        }
        return result + marked(text.slice(cursor));
    };

    const renderList = (tag, items) => {
        html.push(`<${tag}>${items.map((item) => `<li>${inline(item)}</li>`).join("")}</${tag}>`);
    };

    while (index < lines.length) {
        const line = lines[index];
        const fence = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
        if (fence) {
            const language = fence[2].trim();
            const closing = new RegExp(`^\\s{0,3}${fence[1][0]}{${fence[1].length},}\\s*$`);
            const body = [];
            index += 1;
            while (index < lines.length && !closing.test(lines[index])) body.push(lines[index++]);
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
            && !/^\s{0,3}(?:`{3,}|~{3,})/.test(lines[index])
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
