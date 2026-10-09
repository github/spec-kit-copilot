import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(new URL("../../plugins/spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/ui/markdown-reader/package.json", import.meta.url));
const { defineConfig } = require("@playwright/test");

export default defineConfig({
    testDir: fileURLToPath(new URL("./test", import.meta.url)),
    testMatch: "*.spec.mjs",
    outputDir: fileURLToPath(new URL("../../test-results/canvas-reader", import.meta.url)),
    fullyParallel: false,
    workers: 1,
    retries: 0,
    timeout: 45_000,
    expect: { timeout: 10_000 },
    reporter: "line",
    use: {
        browserName: "chromium",
        channel: process.platform === "win32" ? "msedge" : undefined,
        headless: true,
        trace: "off",
        screenshot: "off",
        video: "off",
    },
});
