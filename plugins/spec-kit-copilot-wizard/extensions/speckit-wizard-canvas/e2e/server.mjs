import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { createHandler } from "../server.mjs";

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
        presets: [
            { id: "design-preset", name: "Design preset", source: "community", tags: ["canvas-design"] },
            { id: "foreign-preset", name: "Copilot preset", source: "copilot", tags: ["canvas-design"] },
            { id: "other-preset", name: "Other preset", source: "copilot", tags: ["other"] },
            { id: "unlisted-preset", name: "Unlisted preset", source: "copilot" },
        ],
        extensions: [
            { id: "design-extension", name: "Design extension", source: "community", tags: ["canvas-design"] },
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
    session: { send: async () => {} },
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

createServer((req, res) => { void handler(req, res); }).listen(4177, "127.0.0.1");
