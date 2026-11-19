import js from "@eslint/js";
import tseslint from "typescript-eslint";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../../../../../", import.meta.url));
const readerPath = "plugins/spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/ui/markdown-reader";

export default [
    {
        ignores: ["**/node_modules/**", "**/dist/**", "**/build/**", "**/coverage/**", "**/test-results/**", "**/playwright-report/**", "**/vendor/**"],
    },
    {
        basePath: repositoryRoot,
        files: [`${readerPath}/**/*.mjs`, "scripts/canvas-reader/**/*.mjs"],
        ...js.configs.recommended,
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
            globals: {
                Buffer: "readonly",
                URL: "readonly",
                console: "readonly",
                process: "readonly",
                setTimeout: "readonly",
                clearTimeout: "readonly",
                clearInterval: "readonly",
                fetch: "readonly",
                AbortController: "readonly",
            },
        },
    },
    {
        basePath: repositoryRoot,
        files: ["scripts/canvas-reader/test/*.spec.mjs"],
        languageOptions: {
            globals: {
                window: "readonly",
                document: "readonly",
                location: "readonly",
                MutationObserver: "readonly",
                performance: "readonly",
                requestAnimationFrame: "readonly",
                getComputedStyle: "readonly",
                structuredClone: "readonly",
            },
        },
    },
    {
        basePath: repositoryRoot,
        files: ["scripts/canvas-reader/test/sdd-shell.spec.mjs"],
        languageOptions: {
            globals: {
                STATE: "readonly",
                render: "readonly",
                reviewConnected: "readonly",
            },
        },
    },
    ...tseslint.configs.recommended.map((config) => ({
        ...config,
        basePath: repositoryRoot,
        files: [`${readerPath}/**/*.{ts,tsx}`],
    })),
];
