import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";

export function shellHtml() {
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
</style>
</head>
<body><main><h1>Canvas Designer</h1>
<p>No Wizard handoff is attached yet.</p>
<p>Launch Designer from the Wizard to prepare a project and load its settings pages.</p>
</main></body></html>`;
}

const ASSETS = {
    "/": ["index.html", "text/html"],
    "/ui/styles.css": ["styles.css", "text/css"],
    "/ui/app.js": ["app.js", "text/javascript"],
};

export async function startShell(handoff = null, model = null) {
    if (handoff && (!Array.isArray(model?.pages) || !model.pages.length)) {
        throw new Error("Designer pages must be resolved before opening");
    }
    const assets = handoff
        ? new Map(await Promise.all(Object.entries(ASSETS).map(async ([path, [file, type]]) =>
            [path, { type, content: await readFile(new URL(`./ui/${file}`, import.meta.url), "utf8") }])))
        : new Map([["/", { type: "text/html", content: shellHtml() }]]);
    const token = randomBytes(24).toString("hex");
    const clients = new Set();
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
            || req.method !== "GET") {
            res.writeHead(404).end();
            return;
        }
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");
        if (handoff && url.pathname === "/api/state") {
            res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ ...model, handoffId: handoff.handoffId }));
        } else if (handoff && url.pathname === "/events") {
            res.writeHead(200, { "Content-Type": "text/event-stream", Connection: "keep-alive" });
            res.write(": connected\n\n");
            clients.add(res);
            res.on("close", () => clients.delete(res));
        } else if (assets.has(url.pathname)) {
            const { type, content } = assets.get(url.pathname);
            res.writeHead(200, { "Content-Type": `${type}; charset=utf-8` });
            res.end(url.pathname === "/" ? content.replaceAll("__TOKEN__", token) : content);
        } else {
            res.writeHead(404).end();
        }
    });
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    const heartbeat = setInterval(() => {
        for (const client of clients) client.write(": heartbeat\n\n");
    }, 15_000);
    heartbeat.unref();
    return {
        url: `http://127.0.0.1:${server.address().port}/?token=${token}`,
        close: () => {
            clearInterval(heartbeat);
            for (const client of clients) client.end();
            clients.clear();
            return new Promise((resolve, reject) => server.close((error) =>
                error ? reject(error) : resolve()));
        },
    };
}
