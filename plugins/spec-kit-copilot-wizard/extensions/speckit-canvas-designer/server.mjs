import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

export function shellHtml(handoff = null) {
    const summary = handoff
        ? `<div class="summary" role="status">Wizard handoff received · ${handoff.workflow.selectedPhases.length} phases · ${
            ["presets", "extensions", "bundles"].reduce((total, kind) =>
                total + handoff.selections[kind].length, 0)
        } design customizations queued for future installation</div>`
        : '<p>No Wizard handoff is attached yet.</p>';
    return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Canvas Designer</title>
<style>
    body { margin: 0; background: var(--background-color-default, #fff);
        color: var(--text-color-default, #1f2328);
        font: var(--text-body-medium, 14px)/var(--leading-body-medium, 20px)
            var(--font-sans, system-ui, sans-serif); }
    main { padding: 28px; max-width: 560px; }
    h1 { font-size: var(--text-title-large, 26px); line-height: var(--leading-title-large, 32px); }
    p { color: var(--text-color-muted, #59636e); }
    .summary { margin-top: 24px; border: 1px solid var(--border-color-default, #d1d9e0);
        border-radius: 8px; padding: 16px; }
</style>
</head>
<body><main><h1>Canvas Designer</h1>
<p>Your Designer session is ready. Design pages will be added in a later update.</p>
${summary}
</main></body></html>`;
}

export async function startShell(handoff = null) {
    const token = randomBytes(24).toString("hex");
    const server = createServer((req, res) => {
        let url;
        try {
            url = new URL(req.url, "http://127.0.0.1");
        } catch {
            res.writeHead(404).end();
            return;
        }
        const supplied = url.searchParams.get("token");
        const actual = typeof supplied === "string" ? Buffer.from(supplied) : Buffer.alloc(0);
        const expected = Buffer.from(token);
        if (actual.length !== expected.length || !timingSafeEqual(actual, expected)
            || req.method !== "GET" || url.pathname !== "/") {
            res.writeHead(404).end();
            return;
        }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
        res.end(shellHtml(handoff));
    });
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    return {
        url: `http://127.0.0.1:${server.address().port}/?token=${token}`,
        close: () => new Promise((resolve, reject) => server.close((error) =>
            error ? reject(error) : resolve())),
    };
}
