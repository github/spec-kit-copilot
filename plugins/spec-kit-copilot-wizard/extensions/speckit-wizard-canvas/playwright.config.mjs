import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.SPECKIT_E2E_PORT || 4177);

export default defineConfig({
    testDir: "../../../../tests/e2e",
    fullyParallel: true,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? "github" : "list",
    use: {
        ...devices["Desktop Chrome"],
        baseURL: `http://127.0.0.1:${port}`,
        trace: "retain-on-failure",
    },
    webServer: {
        command: "node ../../../../tests/e2e/server.mjs",
        url: `http://127.0.0.1:${port}/api/state?token=e2e-token`,
        reuseExistingServer: false,
        timeout: 15_000,
    },
});
