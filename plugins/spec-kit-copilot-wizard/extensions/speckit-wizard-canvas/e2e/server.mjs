import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { createHandler } from "../server.mjs";
import { readFile } from "node:fs/promises";
import { readDesignSource } from "../../speckit-canvas-designer/source.mjs";
import { startShell } from "../../speckit-canvas-designer/server.mjs";

const repoPath = fileURLToPath(new URL("../../../../../", import.meta.url));
const snapshot = {
    workspacePath: process.cwd(),
    currentPhase: "constitution",
    setup: {
        pluginInstalled: true,
        cliInstalled: true,
        projectInitialized: true,
        skillsReloaded: true,
    },
    boot: { phase: "ready", steps: [] },
    phases: {},
    commands: [],
    catalog: {
        designerFingerprint: "e2e-catalog",
        designerSource: { available: true, extension: await readDesignSource() },
        presets: [
            { id: "design-preset", name: "Design preset", source: "community", tags: ["canvas-design"],
                downloadUrl: "https://example.org/preset.zip" },
            { id: "foreign-preset", name: "Copilot preset", source: "copilot", tags: ["canvas-design"],
                downloadUrl: "https://example.org/foreign.zip" },
            { id: "other-preset", name: "Other preset", source: "copilot", tags: ["other"] },
            { id: "unlisted-preset", name: "Unlisted preset", source: "copilot" },
        ],
        extensions: [
            { id: "design-extension", name: "Design extension", source: "community", tags: ["canvas-design"],
                downloadUrl: "https://example.org/extension.zip" },
            { id: "unlisted-extension", name: "Unlisted extension", source: "copilot", tags: ["other"] },
        ],
        bundles: [
            { id: "design-bundle", name: "Design bundle", source: "community", tags: ["canvas-design"] },
            { id: "default-bundle", name: "Default bundle", source: "default", tags: ["canvas-design"] },
            { id: "community-bundle", name: "Community bundle", source: "community", tags: ["canvas-design"] },
            { id: "other-bundle", name: "Other bundle", source: "default", tags: ["design"] },
        ],
    },
};

const members = {
    "design-bundle": [
        { kind: "presets", id: "design-preset" },
        { kind: "presets", id: "foreign-preset" },
        { kind: "presets", id: "unlisted-preset" },
        { kind: "extensions", id: "design-extension" },
    ],
    "default-bundle": [],
    "community-bundle": [],
};

const handler = createHandler({
    token: "e2e-token",
    session: {
        send: async () => {},
        rpc: {
            extensions: { list: async () => ({ extensions: [{
                id: "plugin:spec-kit-copilot-wizard:speckit-canvas-designer",
                source: "plugin", status: "running",
            }] }) },
            canvas: { list: async () => ({ canvases: [{
                extensionId: "plugin:spec-kit-copilot-wizard:speckit-canvas-designer",
                canvasId: "speckit-canvas-designer",
            }] }) },
        },
    },
    log: async (message) => { console.error(message); },
    getState: async () => snapshot,
    getInstance: () => ({ workspacePath: repoPath }),
    broadcast: () => {},
    registerSse: (_req, res) => { res.on("close", () => {}); },
    inspectBundle: async (id) => ({
        source: id === "default-bundle" ? "default" : "community",
        members: members[id] ?? [],
    }),
});

const pages = await Promise.all(["setup", "artifacts", "appearance", "results"].map(async (page) => ({
    ...JSON.parse(await readFile(new URL(
        `../../../../../spec-kit-extensions/canvas-design/pages/${page}.json`, import.meta.url), "utf8")),
    page,
})));
const designerModel = {
    revision: "initial",
    pages,
    constraints: {
        "canvas.id": { type: "string", minLength: 1, maxLength: 100, pattern: "^[a-z0-9][a-z0-9-]*$" },
        "canvas.displayName": { type: "string", minLength: 1, maxLength: 120 },
        "canvas.description": { type: "string", maxLength: 240 },
        "canvas.workflowListName": { type: "string", maxLength: 80 },
        "workflowSlug.userProvided": { type: "boolean" },
    },
    values: Object.fromEntries(pages[0].fields.map((field) =>
        [field.id, field.type === "boolean" ? false : ""])),
};

async function createDesigner(mode) {
    let version = 0;
    const designer = await startShell({ handoffId: "e2e-designer" }, structuredClone(designerModel), {
        reload: async (retry) => {
            designer.update(undefined, { pending: true, error: "" });
            if (mode === "pending" && !retry) return { queued: true };
            setTimeout(() => {
                if (mode === "fail") {
                    designer.update(undefined, { pending: false, error: "canvas-settings-extra: not found" });
                } else {
                    designer.update({ ...structuredClone(designerModel), revision: `reload-${++version}`,
                        pages: [...pages, { id: "canvas-settings-accessibility", page: "accessibility",
                            title: "Accessibility", fields: [] }] }, { pending: false, error: "" });
                }
            }, 100);
            return { queued: true };
        },
    });
    return designer;
}

createServer((req, res) => {
    if (req.url === "/designer" || req.url.startsWith("/designer?")) {
        void createDesigner(new URL(req.url, "http://127.0.0.1").searchParams.get("reload"))
            .then((designer) => res.writeHead(302, { Location: designer.url }).end())
            .catch((error) => { console.error(error); res.writeHead(500).end(error.message); });
        return;
    }
    void handler(req, res);
}).listen(4177, "127.0.0.1");
