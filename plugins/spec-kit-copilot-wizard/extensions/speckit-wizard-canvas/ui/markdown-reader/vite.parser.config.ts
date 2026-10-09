import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { createBuildMetadata } from "../../../../../../scripts/canvas-reader/sync-assets.mjs";

export default defineConfig({
    resolve: { conditions: ["node", "module", "production"], mainFields: ["module", "main"] },
    ssr: { target: "node", noExternal: true },
    plugins: [{
        name: "clarification-parser-provenance",
        async generateBundle(_options, bundle) {
            const modules = Object.values(bundle).flatMap((output) => output.type === "chunk" ? Object.keys(output.modules) : []);
            this.emitFile({ type: "asset", fileName: "build-metadata.json", source: JSON.stringify(await createBuildMetadata(modules), null, 2) });
        },
    }],
    build: {
        target: "es2022", ssr: true, outDir: "build/parser", emptyOutDir: true, sourcemap: false,
        lib: { entry: fileURLToPath(new URL("./src/clarificationParser.ts", import.meta.url)), formats: ["es"], fileName: () => "artifact-clarifications.mjs" },
        rolldownOptions: { external: [], output: { entryFileNames: "artifact-clarifications.mjs" } },
    },
});
