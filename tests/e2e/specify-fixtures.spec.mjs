import { strict as assert } from "node:assert";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { test } from "./playwright.mjs";
import { assembleComposition } from "../../plugins/spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/composition/assembler.mjs";
import { effectiveSource } from "../../plugins/spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/artifact-evidence.mjs";
import { addLoopbackSpecifyExtension, serveSpecifyPackages } from "./specify-packages.mjs";

const require = createRequire(new URL(
    "../../plugins/spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/package.json",
    import.meta.url,
));
const { load } = require("js-yaml");
const run = promisify(execFile);
const presetPath = fileURLToPath(new URL("../fixtures/test-presets/copilot-wizard-layer-test/", import.meta.url));
const extensionPath = fileURLToPath(new URL("../fixtures/specify/extension-wizard-flow-test/", import.meta.url));

test("Specify installs both Wizard fixtures and resolves their commands and review skill", async () => {
    test.setTimeout(120_000);
    const root = await mkdtemp(join(tmpdir(), "wizard-specify-install-"));
    let packages;
    const specify = async (...args) => (await run("specify", args, {
        cwd: root, timeout: 90_000, maxBuffer: 2 * 1024 * 1024,
    })).stdout;
    try {
        const presetManifest = load(await readFile(join(presetPath, "preset.yml"), "utf8")).preset;
        const extensionManifest = load(await readFile(join(extensionPath, "extension.yml"), "utf8")).extension;
        packages = await serveSpecifyPackages(root, {
            [presetManifest.id]: presetPath, [extensionManifest.id]: extensionPath,
        });
        await specify("init", "--here", "--force", "--non-interactive",
            "--ignore-agent-tools", "--integration", "copilot", "--integration-options=--skills");
        await specify("preset", "add", "--from", packages.url(presetManifest.id));
        await addLoopbackSpecifyExtension(root, extensionManifest.id, packages.url(extensionManifest.id));

        const presets = JSON.parse(await specify("preset", "list", "--json"));
        const extensions = JSON.parse(await specify("extension", "list", "--json"));
        assert.equal(presets.find((item) => item.id === presetManifest.id)?.version, presetManifest.version);
        assert.equal(extensions.find((item) => item.id === extensionManifest.id)?.version, extensionManifest.version);

        const composition = await assembleComposition({
            workspaceRoot: root,
            presetItems: presets.map((item, cliOrder) => ({
                ...item, installedId: item.id, active: item.enabled, cliOrder,
            })),
            extensionItems: extensions.map((item, cliOrder) => ({
                ...item, installedId: item.id, active: item.enabled, cliOrder,
            })),
        });
        const artifact = (id) => composition.artifacts.find((item) => item.id === `commands/${id}`);
        assert.ok(artifact("speckit.plan")?.stack.some((layer) =>
            layer.active && layer.presetId === presetManifest.id));
        assert.ok(artifact("speckit.specify")?.stack.some((layer) =>
            layer.active && layer.strategy === "prepend" && layer.presetId === presetManifest.id));
        const review = "speckit.extension-wizard-flow-test.review";
        assert.equal(artifact(review)?.kind, "command");
        assert.ok(artifact(review)?.stack.some((layer) =>
            layer.active && layer.layer === "extension" && layer.presetId === extensionManifest.id));
        assert.equal(artifact("speckit.extension-wizard-flow-test.audit")?.kind, "hook");
        const skill = await readFile(join(root, ".github", "skills",
            "speckit-extension-wizard-flow-test-review", "SKILL.md"), "utf8");
        assert.match(skill, /specs\/<slug>\/reviews\/review\.md/);
        assert.ok(await effectiveSource(root, review));
    } finally {
        await packages?.close();
        await rm(root, { recursive: true, force: true });
    }
});
