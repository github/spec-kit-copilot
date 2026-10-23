import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { createBuildMetadata } from "../../../../../../scripts/canvas-reader/sync-assets.mjs";

export default defineConfig({
    base: "./",
    define: {
        "process.env.NODE_ENV": JSON.stringify("production"),
    },
    plugins: [{
        name: "reader-build-provenance",
        async generateBundle(_options, bundle) {
            const modules = Object.values(bundle).flatMap((output) => output.type === "chunk" ? Object.keys(output.modules) : []);
            const metadata = await createBuildMetadata(modules);
            this.emitFile({ type: "asset", fileName: "build-metadata.json", source: JSON.stringify(metadata, null, 2) });
        },
    }],
    build: {
        target: "es2022",
        outDir: "dist",
        emptyOutDir: true,
        sourcemap: false,
        lib: {
            entry: fileURLToPath(new URL("./src/bundle.ts", import.meta.url)),
            formats: ["es"],
            fileName: () => "markdown-reader.js",
            cssFileName: "markdown-reader",
        },
        rolldownOptions: {
            external: [],
        },
    },
});
