import { createServer } from "node:http";
import { createHandler } from "../server.mjs";

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
        presets: [
            { id: "design-preset", name: "Design preset", source: "copilot", tags: ["canvas-design"] },
            { id: "foreign-preset", name: "Community preset", source: "community", tags: ["canvas-design"] },
            { id: "other-preset", name: "Other preset", source: "copilot", tags: ["other"] },
            { id: "unlisted-preset", name: "Unlisted preset", source: "copilot" },
        ],
        extensions: [
            { id: "design-extension", name: "Design extension", source: "copilot", tags: ["canvas-design"] },
            { id: "unlisted-extension", name: "Unlisted extension", source: "copilot", tags: ["other"] },
        ],
        bundles: [
            { id: "design-bundle", name: "Design bundle", source: "copilot", tags: ["canvas-design"] },
            { id: "community-bundle", name: "Community bundle", source: "community", tags: ["canvas-design"] },
            { id: "other-bundle", name: "Other bundle", source: "copilot", tags: ["design"] },
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
    "community-bundle": [],
};

const handler = createHandler({
    token: "e2e-token",
    session: { send: async () => { throw new Error("E2E fixture must not dispatch a session"); } },
    log: async (message) => { console.error(message); },
    getState: async () => snapshot,
    getInstance: () => ({ workspacePath: process.cwd() }),
    broadcast: () => {},
    registerSse: (_req, res) => { res.on("close", () => {}); },
    inspectBundle: async (id) => ({
        source: id === "community-bundle" ? "community" : "copilot",
        members: members[id] ?? [],
    }),
});

createServer((req, res) => { void handler(req, res); }).listen(4177, "127.0.0.1");
