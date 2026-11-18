import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHandler } from "../../plugins/spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/server.mjs";
import releaseCatalog from "../../spec-kit-extensions/catalog.json" with { type: "json" };

const repoPath = fileURLToPath(new URL("../../", import.meta.url));
const releasedBase = releaseCatalog.extensions["extension-canvas-design"];
if (!releasedBase?.version || !releasedBase.download_url) {
    throw new Error("Canvas Design release catalog entry is missing a version or download URL");
}
const snapshot = {
    featureFlags: { generateCanvas: true },
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
        presets: [
            { id: "design-preset", name: "Design preset", source: "community", description: 'Preset with "quoted" settings', tags: ["canvas-design"] },
            { id: "foreign-preset", name: "Copilot preset", source: "copilot", tags: ["canvas-design"] },
            { id: "other-preset", name: "Other preset", source: "copilot", tags: ["other"] },
            { id: "unlisted-preset", name: "Unlisted preset", source: "copilot" },
        ],
        extensions: [
            { id: releasedBase.id, name: releasedBase.name, source: "copilot",
                version: releasedBase.version, downloadUrl: releasedBase.download_url,
                tags: releasedBase.tags },
            { id: "design-extension", name: "Design extension", source: "community", description: "Extends the designer behavior", tags: ["canvas-design"] },
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
    stageDesignerHandoff: async (_session, handoff) => ({
        sourceSessionId: "e2e-source", sourceRoot: join(tmpdir(), "e2e-source"),
        handoffId: handoff.handoffId,
        sha256: createHash("sha256").update(JSON.stringify(handoff)).digest("hex"),
    }),
    getState: async () => snapshot,
    getInstance: () => ({ workspacePath: repoPath, generateCanvas: true }),
    broadcast: () => {},
    registerSse: (_req, res) => { res.on("close", () => {}); },
    inspectBundle: async (id) => ({
        source: id === "default-bundle" ? "default" : "community",
        members: members[id] ?? [],
    }),
});

createServer((req, res) => { void handler(req, res); })
    .listen(Number(process.env.SPECKIT_E2E_PORT || 4177), "127.0.0.1");
