import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test, expect } from "./playwright.mjs";
import { collectArtifactEvidence, effectiveSource, readEvidenceCache } from "../../plugins/spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/artifact-evidence.mjs";
import { compositionActions } from "../../plugins/spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/canvas-runtime/actions/composition.mjs";
import { phaseActions } from "../../plugins/spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/canvas-runtime/actions/phase.mjs";
import { runFastComposition } from "../../plugins/spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/canvas-runtime/composition-apply.mjs";
import { runCatalogOperation } from "../../plugins/spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/canvas-runtime/catalog-operations.mjs";
import { runSpecify } from "../../plugins/spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/server/specify-command.mjs";
import { allInstances, fsDeps, getInstance, setSession } from "../../plugins/spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/canvas-runtime/instances.mjs";
import { attachOutputEvidence } from "../../plugins/spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/canvas-runtime/output-availability.mjs";
import { startServer } from "../../plugins/spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/server.mjs";
import { validateLocalSource } from "../../plugins/spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/server/designer-local-sources.mjs";
import { writeState } from "../../plugins/spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/state/store.mjs";

const presetPath = fileURLToPath(new URL("../fixtures/test-presets/copilot-wizard-layer-test/", import.meta.url));
const extensionPath = fileURLToPath(new URL("../fixtures/specify/extension-wizard-flow-test/", import.meta.url));
const preset = await validateLocalSource("presets", presetPath);
const extension = await validateLocalSource("extensions", extensionPath);
const review = "speckit.extension-wizard-flow-test.review";
const run = promisify(execFile);

async function withWizardCheckout(page, run, {
    setup: setupOverrides = {}, environment: environmentOverrides = {},
    reload, boot, depsError, beforeNavigate, send, startInference, packageCommand,
    generateCanvas = false,
    checkoutPrefix = join(tmpdir(), "wizard-flow-e2e-"),
} = {}) {
    const root = await mkdtemp(checkoutPrefix);
    const id = randomUUID();
    const inst = getInstance(id);
    const prompts = [];
    const setup = {
        pluginInstalled: true, cliInstalled: true, projectInitialized: true,
        skillsReloaded: true, defaultPresetsSkipped: true, ...setupOverrides,
    };
    const catalog = { presets: [], extensions: [], bundles: [] };
    let server;
    try {
        await mkdir(join(root, ".specify"), { recursive: true });
        inst.workspacePath = root;
        inst.generateCanvas = generateCanvas;
        inst.state = { currentPhase: "constitution", setup, pipeline: null, phases: {} };
        inst.boot = boot;
        inst.depsError = depsError;
        inst.environment = { pluginInstalled: true, cliInstalled: true,
            scaffoldedSkills: ["speckit-constitution"], ...environmentOverrides };
        await writeState(root, inst.state, fsDeps);
        inst.cachedComposition = { presets: [], extensions: [], artifacts: [] };
        const session = {
            send: ({ prompt }) => {
                prompts.push(prompt);
                return send ? send(prompt) : new Promise(() => {});
            },
            rpc: {
                skills: { reload: reload ?? (async () => ({ errors: [], warnings: [] })) },
                tasks: {
                    startAgent: ({ prompt }) => {
                        prompts.push(prompt);
                        return startInference ? startInference(prompt) : Promise.resolve({ agentId: randomUUID() });
                    },
                    cancel: async () => ({ cancelled: true }),
                },
            },
        };
        setSession(session);
        const getState = async () => ({
            featureFlags: { generateCanvas },
            workspacePath: root, projectInitialized: true, currentPhase: "constitution",
            setup: inst.state.setup, boot: inst.boot ?? { phase: "ready", steps: [] },
            depsError: inst.depsError,
            phases: inst.state.phases ?? {},
            commands: [{ id: "constitution", commandName: "speckit.constitution",
                shortLabel: "Constitution", status: inst.state.phases?.constitution?.status ?? "empty",
                artifactPath: inst.state.phases?.constitution?.artifactPath ?? null, locked: false }],
            pipeline: inst.state.pipeline,
            composition: inst.cachedComposition,
            catalog: { ...catalog, presets: inst.cachedPresetItems ?? catalog.presets,
                extensions: inst.cachedExtensionItems ?? catalog.extensions,
                bundles: inst.cachedBundleItems ?? catalog.bundles },
            environment: inst.environment,
            scaffoldedSkills: ["speckit-constitution"], skillsReload: inst.skillsReload,
            refreshStatus: inst.refreshStatus?.status ?? "ready",
            refreshId: inst.refreshStatus?.id ?? null,
            warnings: [],
        });
        server = await startServer(id, { session, log: async () => {}, getInstance: () => inst, getState,
            catalogOperation: packageCommand ? (instance, kind, payload) =>
                runCatalogOperation(instance, kind, payload, { command: packageCommand, session }) : undefined });
        inst.broadcast = (message) => server.broadcast(message.type === "state"
            ? { type: "invalidate", reason: "fixture state changed" } : message);
        await beforeNavigate?.({ root, id, inst, server });
        await page.goto(server.url);
        await run({ root, id, inst, prompts, catalog, server, getState });
    } finally {
        if (!page.isClosed()) await page.goto("about:blank");
        if (inst.outputInference?.timer) clearTimeout(inst.outputInference.timer);
        if (inst.refreshStatus?.timer) clearTimeout(inst.refreshStatus.timer);
        if (server) {
            for (const client of server.sseClients) client.end();
            await new Promise((resolve) => server.server.close(resolve));
        }
        allInstances().delete(id);
        setSession(null);
        await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
    }
}

async function initializePackageFixture({ root, inst }) {
    inst._verifiedCatalogFields = new Set(["cachedPresetItems", "cachedExtensionItems", "cachedBundleItems"]);
    await runSpecify(root, ["init", "--here", "--force", "--non-interactive",
        "--ignore-agent-tools", "--integration", "copilot", "--integration-options=--skills",
        "--script", process.platform === "win32" ? "ps" : "sh"]);
}

test("unchanged built-in outputs require no inference after real CLI initialization", async ({ page }) => {
    await withWizardCheckout(page, async ({ root, inst, prompts }) => {
        expect((await runFastComposition(inst, { reason: "core output fixture" })).ok).toBe(true);
        const outputs = await collectArtifactEvidence(root, { composition: inst.cachedComposition });
        expect(outputs.warnings).toEqual([]);
        expect(outputs.requests.map(({ commandId }) => commandId)).toEqual([]);
        expect(outputs.evidence.plan.candidates[0]).toMatchObject({
            path: "specs/<slug>/plan.md", source: "core",
        });
        expect(outputs.evidence.analyze.candidates[0].kind).toBe("none");
        expect(prompts).toEqual([]);
    }, { beforeNavigate: initializePackageFixture });
});

// Keep network acquisition out of the fixture benchmark; the real CLI still
// installs, composes, records ownership and removes every selected package.
async function fixturePackageCommand(project, args, _run, options) {
    if (args[1] === "add") {
        const path = args[0] === "preset" ? presetPath : extensionPath;
        const id = args[0] === "preset" ? preset.id : extension.id;
        expect(args[2]).toBe(id);
        expect(args.slice(3)).toEqual(["--from", `https://fixtures.invalid/${id}.zip`]);
        return runSpecify(project, args[0] === "preset"
            ? ["preset", "add", "--dev", path] : ["extension", "add", path, "--dev"]);
    }
    return runSpecify(project, args, undefined, options);
}

async function completePackageClick(page, button, kind) {
    const response = page.waitForResponse((res) => res.url().includes("/api/prompt")
        && res.request().method() === "POST" && res.request().postDataJSON()?.kind === kind);
    await button.click();
    const completed = await response;
    const result = await completed.json();
    expect(result, JSON.stringify(result)).toHaveProperty("ok", true);
    expect(completed.status()).toBe(200);
    expect(result.queued).toBeUndefined();
    return result;
}

test("environment Recheck adopts the latest probe without reopening the Wizard", async ({ page }) => {
    let checks = 0;
    await withWizardCheckout(page, async () => {
        const phases = page.getByRole("tab", { name: "Phases" });
        await expect(phases).toHaveAttribute("aria-disabled", "true");
        const recheck = page.locator('#environment-card [data-probe-source="cliInstalled"]');
        await recheck.click();
        await expect.poll(() => checks).toBe(1);
        await expect(phases).toHaveAttribute("aria-disabled", "true");
        await recheck.click();
        await expect.poll(() => checks).toBe(2);
        await expect(phases).toHaveAttribute("aria-disabled", "false");
        await phases.click();
        await expect(page.locator("#stepper")).toContainText("Constitution");
        await expect(page.getByRole("button", { name: "Generate canvas" })).toBeVisible();
    }, {
        generateCanvas: true,
        setup: { cliInstalled: false },
        environment: { cliInstalled: false },
        beforeNavigate: async ({ inst, server }) => {
            await page.route(/\/api\/env\/probe(?:\?|$)/, async (route) => {
                checks += 1;
                if (checks === 2) {
                    inst.environment.cliInstalled = true;
                    inst.state.setup.cliInstalled = true;
                }
                server.broadcast({ type: "invalidate", reason: "environment rechecked" });
                await route.fulfill({ status: 200, contentType: "application/json",
                    body: JSON.stringify({ ok: true, cliInstalled: inst.environment.cliInstalled }) });
            });
        },
    });
});

test("boot dependency failure exposes retry progress and returns to the ready Wizard", async ({ page }) => {
    const failedBoot = { phase: "failed", steps: [
        { id: "deps-install", label: "Installing dependencies", status: "failed",
            error: { title: "Dependency install failed" } },
    ] };
    const error = { timestamp: new Date().toISOString(), packageName: "js-yaml",
        code: "NPM_MISSING", hint: "Retry the install", canRetry: true };
    let releaseRetry;
    const retryPending = new Promise((resolve) => { releaseRetry = resolve; });
    let requested = 0;
    await withWizardCheckout(page, async () => {
        await expect(page.locator("#boot-overlay .boot-error-card")).toContainText("Retry the install");
        await page.locator("#boot-overlay").getByRole("button", { name: "Retry install" }).click();
        await expect.poll(() => requested).toBe(1);
        await expect(page.locator("#boot-overlay").getByRole("button", { name: "Retrying" })).toBeDisabled();
        releaseRetry();
        await expect(page.locator("#boot-overlay")).toHaveClass(/is-hidden/);
        await expect(page.getByRole("tab", { name: "Phases" })).toBeVisible();
    }, {
        boot: failedBoot, depsError: error,
        beforeNavigate: async ({ inst, server }) => {
            await page.route("**/api/deps/retry", async (route) => {
                requested += 1;
                await retryPending;
                inst.boot = { phase: "ready", steps: [{ id: "ready", label: "Ready", status: "ok" }] };
                inst.depsError = null;
                server.broadcast({ type: "boot.update", boot: inst.boot, depsError: null });
                await route.fulfill({ status: 200, contentType: "application/json",
                    body: JSON.stringify({ ok: true }) });
            });
        },
    });
});

test("failed skills reload keeps Setup locked and retry unlocks Phases", async ({ page }) => {
    let attempts = 0;
    await withWizardCheckout(page, async ({ inst }) => {
        const phases = page.getByRole("tab", { name: "Phases" });
        await expect(phases).toHaveAttribute("aria-disabled", "true");
        const reload = page.locator("#environment-card [data-setup-action='reload']");
        await expect(reload).toBeEnabled();
        await reload.click();
        await expect(page.locator("#environment-card")).toContainText("reload failed");
        await expect(phases).toHaveAttribute("aria-disabled", "true");
        await reload.click();
        await expect(phases).toHaveAttribute("aria-disabled", "false");
        await phases.click();
        await expect(page.locator("#stepper")).toContainText("Constitution");
        expect(attempts).toBe(2);
        expect(inst.state.setup.skillsReloaded).toBe(true);
    }, {
        setup: { skillsReloaded: false },
        reload: async () => (++attempts === 1
            ? { errors: ["fixture reload failure"], warnings: [] }
            : { errors: [], warnings: [] }),
    });
});

test("ready Wizard unlocks navigation and pipeline edits preserve the selected phase", async ({ page }) => {
    await withWizardCheckout(page, async ({ inst, server }) => {
        await expect(page.locator("#conn-status")).toContainText("live");
        await expect(page.getByRole("tab", { name: "Phases" })).toHaveAttribute("aria-disabled", "false");
        await page.getByRole("tab", { name: "Phases" }).click();
        const steps = page.locator("#stepper .step:not(.step-hook)");
        const initial = await steps.count();
        expect(initial).toBeGreaterThan(1);
        const selected = steps.first();
        await selected.click();
        await expect(selected).toHaveClass(/active/);
        await page.locator("#pipeline-banner .pipeline-clear").click();
        await page.getByRole("dialog").getByRole("button", { name: "Clear" }).click();
        await expect(page.locator("#stepper")).toContainText("Pipeline is empty");
        expect(inst.state.pipeline).toEqual([]);
        await page.locator("#more-commands [data-action='pipeline-add']").first().click();
        await expect(steps).toHaveCount(1);
        expect(inst.state.pipeline).toHaveLength(1);
        await page.locator("#pipeline-banner .pipeline-reset").click();
        await expect(steps).toHaveCount(initial);
        expect(inst.state.pipeline).toBeNull();
        server.broadcast({ type: "invalidate", reason: "pipeline verified" });
        await expect(page.locator("#stepper .step.active")).toHaveCount(1);
    });
});

test("installed Wizard preset replaces Plan and prepends Specify in the visible command pipeline", async ({ page }) => {
    test.setTimeout(180_000);
    await withWizardCheckout(page, async ({ root, inst, prompts }) => {
        const commands = page.locator('#comp-artifacts [data-subtab-panel="comp:command"]');
        const plan = commands.locator(".comp-artifact-row")
            .filter({ has: page.getByRole("button", { name: /commands\/speckit\.plan/ }) });
        const specify = commands.locator(".comp-artifact-row")
            .filter({ has: page.getByRole("button", { name: /commands\/speckit\.specify/ }) });

        await page.locator('#setup-stepper .step[data-substep="composition"]').click();
        await expect(page.locator("#comp-group-presets")).toContainText(preset.name);
        await expect(plan).toContainText("commands/speckit.plan");
        await expect(plan.locator(".comp-stack-layer").first()).toContainText(preset.name);
        await expect(plan.locator(".comp-stack-layer").first()).toContainText("Replace");
        await expect(plan.locator(".comp-stack-layer").first()).toHaveClass(/is-active/);
        await expect(plan.locator(".comp-stack-layer").last()).toContainText("Core");
        await expect(specify.locator(".comp-stack-layer").first()).toContainText(preset.name);
        await expect(specify.locator(".comp-stack-layer").first()).toContainText("Prepend");
        await expect(specify.locator(".comp-stack-layer").first()).toHaveClass(/is-active/);
        await expect(specify.locator(".comp-stack-layer").last()).toContainText("Core");

        const artifacts = inst.cachedComposition.artifacts;
        for (const name of ["speckit.plan", "speckit.specify"]) {
            expect(artifacts.filter((item) => item.id === `commands/${name}`)).toHaveLength(1);
        }
        expect(artifacts.find((item) => item.id === "commands/speckit.plan")
            .stack.find((layer) => layer.active)).toMatchObject({
            presetId: preset.id, strategy: "replace",
        });
        expect(artifacts.find((item) => item.id === "commands/speckit.specify")
            .stack.find((layer) => layer.active)).toMatchObject({
            presetId: preset.id, strategy: "prepend",
        });

        await page.getByRole("tab", { name: "Phases" }).click();
        const steps = page.locator("#stepper .step:not(.step-hook)");
        await expect(steps.filter({ hasText: "Specify" })).toHaveCount(1);
        await expect(steps.filter({ hasText: "Plan" })).toHaveCount(1);
        const labels = await steps.allTextContents();
        expect(labels.findIndex((label) => label.includes("Specify")))
            .toBeLessThan(labels.findIndex((label) => label.includes("Plan")));
        await steps.filter({ hasText: "Specify" }).click();
        await expect(page.locator("#phase-card")).toContainText(preset.name);
        await steps.filter({ hasText: "Plan" }).click();
        await expect(page.locator("#phase-card")).toContainText(preset.name);
        const submit = page.waitForResponse((response) =>
            response.url().includes("/api/phase/submit") && response.request().method() === "POST");
        await page.locator("#phase-card").getByRole("button", { name: "Run phase" }).click();
        expect((await submit).ok()).toBe(true);
        await expect.poll(() => prompts.length).toBe(1);
        expect(prompts[0]).toContain("speckit-plan");
        expect(await readFile(join(root, ".github", "skills", "speckit-plan", "SKILL.md"), "utf8"))
            .toContain("Wizard test Plan layer");
    }, {
        checkoutPrefix: fileURLToPath(new URL("./.wizard-layer-checkout-", import.meta.url)),
        beforeNavigate: async ({ root, inst }) => {
            const specifyCli = async (...args) => (await run("specify", args, {
                cwd: root, timeout: 90_000, maxBuffer: 2 * 1024 * 1024,
            })).stdout;
            await specifyCli("init", "--here", "--force", "--non-interactive",
                "--ignore-agent-tools", "--integration", "copilot",
                "--integration-options=--skills", "--script",
                process.platform === "win32" ? "ps" : "sh");
            const corePlan = await readFile(join(root, ".github", "skills", "speckit-plan", "SKILL.md"), "utf8");
            const coreSpecify = await readFile(join(root, ".github", "skills", "speckit-specify", "SKILL.md"), "utf8");
            expect(corePlan).not.toContain("Wizard test Plan layer");
            expect(coreSpecify).not.toContain("Wizard test Specify prelude");
            await specifyCli("preset", "add", "--dev", presetPath);
            const installed = JSON.parse(await specifyCli("preset", "list", "--json"));
            const item = installed.find((entry) => entry.id === preset.id);
            expect(item).toMatchObject({ id: preset.id, version: preset.version, enabled: true });
            inst.cachedPresetItems = installed.map((entry, cliOrder) => ({
                ...entry, installedId: entry.id, active: entry.enabled, cliOrder,
            }));
            const composedSpecify = await readFile(join(root, ".github", "skills", "speckit-specify", "SKILL.md"), "utf8");
            expect(composedSpecify).toContain("Wizard test Specify prelude");
            expect(composedSpecify).not.toBe(coreSpecify);
            expect((await runFastComposition(inst, { reason: "installed-wizard-preset" })).ok).toBe(true);
        },
    });
});

test("catalog choices update real fixture layers and retain their package identity", async ({ page }) => {
    test.setTimeout(120000);
    let reloads = 0;
    const measurements = [];
    await withWizardCheckout(page, async ({ inst, prompts, catalog, server }) => {
        const presetItem = { id: preset.id, name: preset.name, version: preset.version,
            source: "copilot", active: false, enabled: true,
            downloadUrl: `https://fixtures.invalid/${preset.id}.zip` };
        const extensionItem = { id: extension.id, name: extension.name, version: extension.version,
            source: "copilot", active: false, enabled: true,
            downloadUrl: `https://fixtures.invalid/${extension.id}.zip` };
        catalog.presets.push(presetItem);
        catalog.extensions.push(extensionItem);
        inst.cachedPresetItems = catalog.presets;
        inst.cachedExtensionItems = catalog.extensions;
        server.broadcast({ type: "invalidate", reason: "fixture catalog loaded" });
        await page.locator('#setup-stepper .step[data-substep="catalogs"]').click();
        const presetCard = page.locator("#catalog-grid .catalog-card")
            .filter({ has: page.locator("h3", { hasText: preset.name }) });
        measurements.push(await completePackageClick(page,
            presetCard.getByRole("button", { name: "Add" }), "preset.install"));
        await expect(presetCard.getByRole("button", { name: "Remove" })).toBeVisible();
        await page.locator('[data-subtab-group="catalogs"] .subtab[data-subtab="extensions"]').first().click();
        const extensionCard = page.locator("#extension-grid .catalog-card")
            .filter({ has: page.locator("h3", { hasText: extension.name }) });
        measurements.push(await completePackageClick(page,
            extensionCard.getByRole("button", { name: "Add" }), "extension.install"));
        await expect(extensionCard.getByRole("button", { name: "Remove" })).toBeVisible();
        await page.locator('#setup-stepper .step[data-substep="composition"]').click();
        await expect(page.locator("#comp-artifacts")).toContainText(preset.name);
        await expect(page.locator("#comp-artifacts")).toContainText(`commands/${review}`);
        await expect(page.locator("#comp-group-presets")).toContainText(preset.name);
        await expect(page.locator("#comp-group-extensions")).toContainText(extension.name);
        for (const kind of ["command", "template", "script", "hook"]) {
            await page.locator(`#comp-subtabs-host [data-subtab="comp:${kind}"]`).click();
            await expect(page.locator(`#comp-artifacts [data-subtab-panel="comp:${kind}"]`)).toBeVisible();
        }
        await expect(page.locator('#comp-artifacts [data-subtab-panel="comp:hook"]'))
            .toContainText("after_plan");
        expect(inst.cachedComposition.artifacts.some((item) => item.kind === "hook")).toBe(true);
        await page.locator('#setup-stepper .step[data-substep="catalogs"]').click();
        await page.locator('[data-subtab-panel][data-subtab-group="catalogs"]:not([hidden]) .subtab[data-subtab="presets"]').click();
        measurements.push(await completePackageClick(page,
            presetCard.getByRole("button", { name: "Remove" }), "preset.remove"));
        await expect(presetCard.getByRole("button", { name: "Add" })).toBeVisible();
        expect(inst.cachedComposition.presets.some((item) => item.id === preset.id)).toBe(false);
        expect(reloads).toBe(3);
        expect(prompts).toEqual([]);
        console.log("Direct package fixture timings (ms; acquisition is local):",
            JSON.stringify(measurements.map(({ kind, timings }) => ({ kind, ...timings }))));
    }, { packageCommand: fixturePackageCommand, beforeNavigate: initializePackageFixture,
        reload: async () => { reloads++; return { errors: [], warnings: [] }; } });
});

test("controlled community bundle confirmation preserves an overlapping direct choice", async ({ page }) => {
    test.setTimeout(120000);
    await withWizardCheckout(page, async ({ inst, prompts, catalog, server }) => {
        const direct = { id: preset.id, name: preset.name, version: preset.version,
            source: "copilot", active: true, enabled: true };
        const bundledExtension = { id: "bug", name: "Bug",
            version: inst.fixtureBugVersion, source: "default", active: false, enabled: true };
        const bundle = { id: "wizard-flow-bundle-test", name: "Wizard Flow Bundle Test",
            source: "community", active: false, installAllowed: false,
            bundleYml: `schema_version: "1.0"\nbundle:\n  id: wizard-flow-bundle-test\n  name: Wizard Flow Bundle Test\n  version: ${preset.version}\n  role: workflow\n  description: Controlled Wizard flow bundle\n  author: Spec Kit test fixtures\n  license: MIT\nrequires:\n  speckit_version: ">=1.0.7"\nprovides:\n  presets:\n    - id: ${preset.id}\n      version: ${preset.version}\n      priority: 10\n      strategy: replace\n  extensions:\n    - id: bug\n      version: ${inst.fixtureBugVersion}\n` };
        catalog.presets.push(direct);
        catalog.extensions.push(bundledExtension);
        catalog.bundles.push(bundle);
        inst.cachedPresetItems = catalog.presets;
        inst.cachedExtensionItems = catalog.extensions;
        inst.cachedBundleItems = catalog.bundles;
        server.broadcast({ type: "invalidate", reason: "controlled bundle loaded" });
        await page.locator('#setup-stepper .step[data-substep="catalogs"]').click();
        await page.locator('[data-subtab-panel][data-subtab-group="catalogs"]:not([hidden]) .subtab[data-subtab="bundles"]').click();
        const card = page.locator("#bundle-grid .catalog-card").filter({ hasText: bundle.name });
        await card.getByRole("button", { name: "Add" }).click();
        await expect(page.locator("#community-install-modal")).toBeVisible();
        await page.locator("#community-install-modal").getByRole("button", { name: "Cancel" }).click();
        expect(prompts).toHaveLength(0);
        await card.getByRole("button", { name: "Add" }).click();
        const installed = await completePackageClick(page,
            page.locator("#community-install-modal").getByRole("button", { name: "Install anyway" }), "bundle.install");
        expect(installed.skillsReloaded).toBe(true);
        await expect(card.getByRole("button", { name: "Remove" })).toBeVisible();
        const installedExtensions = JSON.parse(await runSpecify(inst.workspacePath, ["extension", "list", "--json"]));
        expect(installedExtensions.some((item) => item.id === "bug")).toBe(true);
        await completePackageClick(page, card.getByRole("button", { name: "Remove" }), "bundle.remove");
        await expect(card.getByRole("button", { name: "Add" })).toBeVisible();
        await page.locator('[data-subtab-panel][data-subtab-group="catalogs"]:not([hidden]) .subtab[data-subtab="presets"]').click();
        await expect(page.locator("#catalog-grid .catalog-card")
            .filter({ hasText: direct.name }).getByRole("button", { name: "Remove" })).toBeVisible();
        const extensions = JSON.parse(await runSpecify(inst.workspacePath, ["extension", "list", "--json"]));
        expect(extensions.some((item) => item.id === "bug")).toBe(false);
    }, { packageCommand: fixturePackageCommand,
        beforeNavigate: async (context) => {
            await initializePackageFixture(context);
            await runSpecify(context.root, ["preset", "add", "--dev", presetPath]);
            await runSpecify(context.root, ["extension", "add", "bug"]);
            const installed = JSON.parse(await runSpecify(context.root, ["extension", "list", "--json"]));
            context.inst.fixtureBugVersion = installed.find((item) => item.id === "bug").version;
            await runSpecify(context.root, ["extension", "remove", "bug", "--force"]);
        } });
});

test("package errors and incompatible queued acknowledgements clear pending controls for retry", async ({ page }) => {
    let attempts = 0;
    await withWizardCheckout(page, async ({ catalog, server }) => {
        catalog.extensions.push({ id: "retry-fixture", name: "Retry fixture", source: "default",
            active: false, installAllowed: true });
        server.broadcast({ type: "invalidate", reason: "retry fixture loaded" });
        await page.locator('#setup-stepper .step[data-substep="catalogs"]').click();
        await page.locator('[data-subtab-group="catalogs"] .subtab[data-subtab="extensions"]').first().click();
        const add = page.locator("#extension-grid .catalog-card")
            .filter({ hasText: "Retry fixture" }).getByRole("button", { name: "Add" });
        await add.click();
        await expect(page.getByRole("alert")).toContainText("fixture command failed");
        await expect(add).toBeEnabled();
        await add.click();
        await expect(page.getByRole("alert")).toContainText("Invalid catalog completion result");
        await expect(add).toBeEnabled();
        await completePackageClick(page, add, "extension.install");
        await expect(page.getByRole("alert")).toBeHidden();
        expect(attempts).toBe(3);
    }, { beforeNavigate: async () => {
        await page.route(/\/api\/prompt(?:\?|$)/, async (route) => {
            attempts++;
            const body = attempts === 1 ? { ok: false, error: "fixture command failed", changed: false, stage: "command" }
                : attempts === 2 ? { queued: true, kind: "extension.install" }
                    : { ok: true, id: "retry-fixture", kind: "extension.install",
                        outcome: "changed", skillsReloaded: true, timings: { total: 1 } };
            await route.fulfill({ status: attempts === 1 ? 500 : attempts === 2 ? 202 : 200,
                contentType: "application/json", body: JSON.stringify(body) });
        });
    } });
});

test("Setup awaits verified default installation and does not reload twice", async ({ page }) => {
    let releaseInstall;
    const installed = new Promise((resolve) => { releaseInstall = resolve; });
    let selection, reloads = 0;
    const downloadUrl = "https://fixtures.invalid/configured-default.zip";
    await withWizardCheckout(page, async () => {
        await expect.poll(() => selection?.priority).toBe(1);
        expect(selection).toMatchObject({ name: "copilot-sub-agents", source: "copilot", downloadUrl });
        await expect(page.locator("#environment-card")).toContainText("installing");
        expect(reloads).toBe(0);
        releaseInstall();
        await expect(page.getByRole("tab", { name: "Phases" })).toHaveAttribute("aria-disabled", "false");
        expect(reloads).toBe(0);
    }, { setup: { projectInitialized: false, skillsReloaded: false, defaultPresetsSkipped: false },
        beforeNavigate: async ({ inst, server }) => {
            inst.cachedPresetItems = [{ id: "copilot-sub-agents", name: "Copilot Sub-Agent Delegation",
                source: "copilot", downloadUrl, active: false, installAllowed: true }];
            await page.route(/\/api\/skills\/reload(?:\?|$)/, async (route) => {
                reloads++;
                await route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
            });
            await page.route(/\/api\/prompt(?:\?|$)/, async (route) => {
                const { kind, payload } = route.request().postDataJSON();
                if (kind === "setup.init") {
                    inst.state.setup.projectInitialized = true;
                    server.broadcast({ type: "invalidate", reason: "fixture initialized" });
                    return route.fulfill({ status: 202, contentType: "application/json",
                        body: JSON.stringify({ queued: true, kind }) });
                }
                expect(kind).toBe("preset.install");
                selection = payload;
                await installed;
                inst.state.setup.skillsReloaded = true;
                inst.cachedPresetItems[0].active = true;
                server.broadcast({ type: "invalidate", reason: "fixture defaults installed and reloaded" });
                return route.fulfill({ status: 200, contentType: "application/json",
                    body: JSON.stringify({ ok: true, id: "copilot-sub-agents", kind,
                        outcome: "changed", skillsReloaded: true, timings: { total: 1 } }) });
            });
        } });
});

test("phase status and execution report reach the stepper, then verified output opens in the viewer", async ({ page }) => {
    await withWizardCheckout(page, async ({ root, id, inst, prompts }) => {
        await page.getByRole("tab", { name: "Phases" }).click();
        await page.locator("#stepper .step").first().click();
        const submit = page.waitForResponse((res) => res.url().includes("/api/phase/submit")
            && res.request().method() === "POST");
        await page.locator("#phase-card").getByRole("button", { name: "Run phase" }).click();
        const response = await submit;
        const { runId } = await response.json();
        expect(runId).toBeTruthy();
        await expect.poll(() => prompts.length).toBe(1);
        expect(prompts[0]).toContain("speckit-constitution");
        await mkdir(join(root, ".specify", "memory"), { recursive: true });
        const artifactPath = ".specify/memory/constitution.md";
        await writeFile(join(root, artifactPath), "# Controlled constitution\n\nA verified output.\n");
        expect(await phaseActions[0].handler({ instanceId: id, input: {
            phase: "constitution", status: "done", artifactPath, runId,
        } })).toEqual({ ok: true });
        expect(await phaseActions[2].handler({ instanceId: id, input: {
            phase: "constitution", runId, artifacts: { templates: {}, scripts: {}, hooks: {} },
        } })).toMatchObject({ ok: true });
        expect(inst.cachedComposition.executionReports["commands/speckit.constitution"]).toBeTruthy();
        await page.reload();
        await page.getByRole("tab", { name: "Phases" }).click();
        await page.locator("#stepper .step").first().click();
        await expect(page.locator("#phase-card").getByRole("button", { name: "Rerun phase" })).toBeVisible();
        await page.locator("#phase-card").getByRole("button", { name: "View artifact" }).click();
        await expect(page.locator("#phase-artifact-viewer .artifact-viewer-md")).toContainText("A verified output.");
        await page.locator("#phase-artifact-viewer").getByRole("button", { name: /Wizard/ }).click();
        await expect(page.locator("#phase-artifact-viewer")).toBeHidden();
        await expect(page.locator("#phase-card").getByRole("button", { name: "View artifact" })).toBeVisible();
        const retry = page.waitForResponse((res) => res.url().includes("/api/phase/submit")
            && res.request().method() === "POST");
        await page.locator("#phase-card").getByRole("button", { name: "Rerun phase" }).click();
        await page.getByRole("dialog").getByRole("button", { name: "Yes" }).click();
        const { runId: retryRunId } = await (await retry).json();
        await expect.poll(() => prompts.length).toBe(2);
        expect(await phaseActions[0].handler({ instanceId: id, input: {
            phase: "constitution", status: "error", artifactPath, runId: retryRunId,
        } })).toEqual({ ok: true });
        await page.reload();
        await page.getByRole("tab", { name: "Phases" }).click();
        await expect(page.locator("#phase-card").getByRole("button", { name: "Rerun phase" })).toBeEnabled();
        await expect(page.locator("#phase-card").getByRole("button", { name: "View artifact" })).toBeEnabled();
    });
});

test("phase can be rerun while the first agent turn is unanswered", async ({ page }) => {
    await withWizardCheckout(page, async ({ prompts, inst }) => {
        await page.getByRole("tab", { name: "Phases" }).click();
        await page.locator("#stepper .step").first().click();
        const submit = page.waitForResponse((res) => res.url().includes("/api/phase/submit")
            && res.request().method() === "POST");
        await page.locator("#phase-card").getByRole("button", { name: "Run phase" }).click();
        const { runId } = await (await submit).json();
        await expect.poll(() => prompts.length).toBe(1);
        await expect(page.locator("#phase-card").getByRole("status")).toHaveText("Request sent");
        expect(inst.state.phases?.constitution?.status).not.toBe("done");

        const rerun = page.locator("#phase-card").getByRole("button", { name: "Rerun phase" });
        await expect(rerun).toBeEnabled();
        const retry = page.waitForResponse((res) => res.url().includes("/api/phase/submit")
            && res.request().method() === "POST");
        await rerun.click();
        await page.getByRole("dialog").getByRole("button", { name: "Yes" }).click();
        const { runId: retryRunId } = await (await retry).json();
        await expect.poll(() => prompts.length).toBe(2);
        expect(retryRunId).not.toBe(runId);
        expect(prompts[1]).toContain("speckit-constitution");
        expect(prompts[1]).toContain(`runId: "${retryRunId}"`);
        expect(inst.state.phases?.constitution?.status).not.toBe("done");
    });
});

test("failed composition inference exposes retry and starts a new refresh", async ({ page }, testInfo) => {
    let attempts = 0;
    await withWizardCheckout(page, async ({ root, inst, prompts }) => {
        await cp(presetPath, join(root, ".specify", "presets", preset.id), { recursive: true });
        await cp(extensionPath, join(root, ".specify", "extensions", extension.id), { recursive: true });
        inst.cachedPresetItems = [{ id: preset.id, name: preset.name, version: preset.version,
            active: true, enabled: true }];
        inst.cachedExtensionItems = [{ id: extension.id, name: extension.name,
            version: extension.version, active: true, enabled: true }];
        const skill = review.replaceAll(".", "-");
        await mkdir(join(root, ".github", "skills", skill), { recursive: true });
        await cp(join(extensionPath, "skills", skill, "SKILL.md"),
            join(root, ".github", "skills", skill, "SKILL.md"));
        await page.locator('#setup-stepper .step[data-substep="composition"]').click();
        const refresh = page.getByRole("button", { name: "Refresh composition" });
        await refresh.click();
        await expect(page.locator("#comp-meta-text")).toHaveText("Update incomplete");
        const status = page.locator("#comp-meta");
        await expect(status).toHaveAttribute("role", "status");
        await expect(status).toHaveAttribute("aria-live", "polite");
        await expect(status.locator("button")).toHaveCount(0);
        for (const [width, theme] of [[1280, "light"], [480, "dark"]]) {
            await page.setViewportSize({ width, height: 720 });
            await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, theme);
            const buttonBox = await refresh.boundingBox();
            const statusBox = await status.boundingBox();
            expect(buttonBox).toBeTruthy();
            expect(statusBox).toBeTruthy();
            expect(statusBox.y).toBeGreaterThanOrEqual(buttonBox.y + buttonBox.height);
            const color = (locator) => locator.evaluate((el) => getComputedStyle(el).color);
            expect(await color(refresh)).not.toBe(await color(status));
            await expect(refresh).toBeEnabled();
            await page.locator('.setup-substep-panel[data-substep="composition"] .panel-header').screenshot({
                path: testInfo.outputPath(`refresh-status-${width}-${theme}.png`),
            });
        }
        const failedId = inst.refreshStatus.id;
        await expect.poll(() => attempts).toBe(1);
        await refresh.click();
        await expect.poll(() => inst.refreshStatus.id).not.toBe(failedId);
        await expect(refresh).toHaveAttribute("aria-busy", "true");
        await expect.poll(() => prompts.length).toBe(2);
        expect(attempts).toBe(2);
    }, {
        startInference: () => (++attempts === 1 ? Promise.reject(new Error("fixture inference failed"))
            : new Promise(() => {})),
    });
});

test("catalog search and added filters follow the loaded inventory, not a fixed list", async ({ page }) => {
    await page.goto("/?token=e2e-token");
    const response = await page.request.get("/api/state?token=e2e-token");
    expect(response.ok()).toBe(true);
    const catalog = (await response.json()).catalog;
    await page.locator('#setup-stepper .step[data-substep="catalogs"]').click();
    for (const [tab, kind, inputId, gridId, onlyAddedId] of [
        ["Presets", "presets", "catalog-search", "catalog-grid", "catalog-only-added"],
        ["Extensions", "extensions", "extension-search", "extension-grid", "extension-only-added"],
        ["Bundles", "bundles", "bundle-search", "bundle-grid", "bundle-only-added"],
    ]) {
        await page.locator('[data-subtab-panel][data-subtab-group="catalogs"]:not([hidden]) .subtabs')
            .getByRole("tab", { name: tab }).click();
        const items = catalog[kind];
        const browsable = items.filter((item) => kind !== "presets" || item.source !== "builtin");
        const grid = page.locator(`#${gridId}`);
        if (browsable.length) {
            const search = browsable[0].id;
            await page.locator(`#${inputId}`).fill(search);
            const matching = items.filter((item) => `${item.name ?? ""} ${item.id ?? ""}`
                .toLowerCase().includes(search.toLowerCase()));
            await expect(grid.locator(".catalog-card")).toHaveCount(matching.length);
            await page.locator(`#${inputId}`).fill("");
            await page.locator(`#${onlyAddedId}`).check();
            await expect(grid.locator(".catalog-card")).toHaveCount(items.filter((item) => item.active).length);
            await page.locator(`#${onlyAddedId}`).uncheck();
        } else {
            await expect(grid.locator(".empty")).toBeVisible();
        }
    }
});

test("refresh completes pipeline ordering before phase Run retrieves output evidence", async ({ page }) => {
    const root = await mkdtemp(join(tmpdir(), "wizard-refresh-e2e-"));
    const id = randomUUID();
    const inst = getInstance(id);
    let server;
    const prompts = [];
    const finishTurns = [];
    const backgroundTasks = [];
    let foregroundTurns = 0;
    const setup = { pluginInstalled: true, cliInstalled: true, projectInitialized: true, skillsReloaded: true };
    try {
        inst.workspacePath = root;
        inst.state = { currentPhase: "constitution", setup, pipeline: null };
        inst.cachedComposition = {
            artifacts: [], presets: [], extensions: [],
            inferredPipeline: { shape: "standalone", pipeline: [
                "commands/speckit.constitution", "commands/speckit.plan",
                `commands/${review}`, "commands/speckit.tasks",
            ], unplaced: [], rationale: "Prior inferred order" },
        };
        await mkdir(join(root, ".specify", "presets"), { recursive: true });
        await mkdir(join(root, ".specify", "extensions"), { recursive: true });
        await cp(presetPath, join(root, ".specify", "presets", preset.id), { recursive: true });
        await cp(extensionPath, join(root, ".specify", "extensions", extension.id), { recursive: true });
        await writeFile(join(root, ".specify", "extensions.yml"),
            `hooks:\n  after_plan:\n    - extension: ${extension.id}\n      command: ${review.replace(".review", ".audit")}\n`);
        const skillPath = `.github/skills/${review.replaceAll(".", "-")}/SKILL.md`;
        await mkdir(join(root, ".github", "skills", review.replaceAll(".", "-")), { recursive: true });
        await writeFile(join(root, skillPath), await readFile(
            join(extensionPath, "skills", review.replaceAll(".", "-"), "SKILL.md")));
        const source = await effectiveSource(root, review);
        expect(source).toBeTruthy();
        inst.cachedPresetItems = [{ id: preset.id, name: preset.name, version: preset.version, active: true, enabled: true }];
        inst.cachedExtensionItems = [{ id: extension.id, name: extension.name, version: extension.version, active: true, enabled: true }];
        const session = {
            send: ({ prompt }) => {
                foregroundTurns++;
                prompts.push(prompt);
                return new Promise((resolve) => finishTurns.push(resolve));
            },
            rpc: {
                skills: { reload: async () => ({ errors: [], warnings: [] }) },
                tasks: {
                    startAgent: async ({ prompt }) => {
                        backgroundTasks.push(prompt);
                        prompts.push(prompt);
                        return { agentId: randomUUID() };
                    },
                    cancel: async () => ({ cancelled: true }),
                },
            },
        };
        setSession(session);
        const getState = async () => {
            const snap = {
                workspacePath: root, projectInitialized: true, currentPhase: "constitution",
                setup,
                boot: { phase: "ready", steps: [] }, phases: {},
                pipeline: inst.state?.pipeline ?? null,
                commands: [
                    { id: "constitution", commandName: "speckit.constitution",
                        shortLabel: "Constitution", status: "empty", locked: false },
                    ...(inst.cachedComposition?.artifacts ?? [])
                        .filter((artifact) => artifact.id === `commands/${review}` && artifact.kind === "command")
                        .map(() => ({ id: review, commandName: review,
                            shortLabel: "Review", status: "empty", locked: false })),
                ],
                composition: inst.cachedComposition ?? { presets: [], extensions: [], artifacts: [] },
                catalog: { presets: inst.cachedPresetItems, extensions: inst.cachedExtensionItems, bundles: [] },
                warnings: [], specsDir: null,
            };
            await attachOutputEvidence(inst, {}, snap, await collectArtifactEvidence(root, snap));
            return snap;
        };
        server = await startServer(id, { session, log: async () => {}, getInstance: () => inst, getState });
        inst.broadcast = (message) => server.broadcast(message.type === "state"
            ? { type: "invalidate", reason: "fixture state changed" } : message);
        await page.goto(server.url);
        await page.locator('#setup-stepper .step[data-substep="composition"]').click();
        const progress = page.locator("#comp-meta-text");
        const refresh = page.getByRole("button", { name: "Refresh composition" });
        await expect(refresh).toBeVisible();
        await refresh.click();
        await expect(refresh).toHaveAttribute("aria-busy", "true");
        await expect(progress).toHaveText("Updating…");
        await expect.poll(() => prompts.length).toBe(1);
        expect(prompts[0]).toContain("Infer pipeline");
        let pipelineRunId = prompts[0].match(/showInferredPipeline\(\{ runId: "([0-9a-f-]+)"/)?.[1];
        expect(pipelineRunId).toBe(inst.refreshStatus.id);
        expect(inst.outputInference).toBeFalsy();
        const oldPipelineRunId = pipelineRunId;
        const originalWrite = fsDeps.writeFile;
        let releaseWrite, writeEntered;
        const release = new Promise((resolve) => { releaseWrite = resolve; });
        const entered = new Promise((resolve) => { writeEntered = resolve; });
        let paused = false;
        try {
            fsDeps.writeFile = async (path, ...args) => {
                await originalWrite(path, ...args);
                if (!paused && path.startsWith(join(root, ".speckit-wizard", "state.json."))) {
                    paused = true;
                    writeEntered();
                    await release;
                }
            };
            const oldReply = compositionActions[0].handler({ instanceId: id, input: {
                runId: oldPipelineRunId,
                inferredPipeline: { shape: "standalone",
                    pipeline: [...inst.cachedComposition.inferredPipeline.pipeline].reverse(),
                    unplaced: [], rationale: "Reply paused during temporary-file preparation" },
            } });
            await entered;
            const replacement = page.request.post(new URL(`/api/prompt?token=${server.token}`, server.url).href,
                { data: { kind: "composition.refresh", payload: {} } });
            await expect.poll(() => inst.refreshStatus.id).not.toBe(oldPipelineRunId);
            releaseWrite();
            const rejected = await oldReply;
            expect(rejected.ok).toBe(false);
            expect(rejected.inferredPipelineStatus.reason).toContain("runId is no longer current");
            expect((await replacement).status()).toBe(202);
        } finally {
            releaseWrite();
            fsDeps.writeFile = originalWrite;
        }
        await expect.poll(() => prompts.length).toBe(2);
        pipelineRunId = prompts[1].match(/showInferredPipeline\(\{ runId: "([0-9a-f-]+)"/)?.[1];
        expect(pipelineRunId).toBe(inst.refreshStatus.id);
        expect(pipelineRunId).not.toBe(oldPipelineRunId);
        const compositionBefore = JSON.stringify(inst.cachedComposition);
        const stateBefore = await readFile(join(root, ".speckit-wizard", "state.json"), "utf8");
        const cacheBefore = await readEvidenceCache(root);
        const currentRefresh = inst.refreshStatus;
        const delayedPipeline = await compositionActions[0].handler({ instanceId: id, input: {
            runId: oldPipelineRunId,
            inferredPipeline: { shape: "standalone",
                pipeline: [...inst.cachedComposition.inferredPipeline.pipeline].reverse(),
                unplaced: [], rationale: "Delayed prior ordering" },
        } });
        expect(delayedPipeline.ok).toBe(false);
        expect(delayedPipeline.inferredPipelineStatus.reason).toContain("runId is no longer current");
        expect(JSON.stringify(inst.cachedComposition)).toBe(compositionBefore);
        expect(await readFile(join(root, ".speckit-wizard", "state.json"), "utf8")).toBe(stateBefore);
        expect(await readEvidenceCache(root)).toEqual(cacheBefore);
        expect(inst.refreshStatus).toBe(currentRefresh);
        expect(currentRefresh.status).toBe("refreshing");
        expect(currentRefresh.pipelinePending).toBe(true);
        expect(currentRefresh.outputsPending).toBe(false);
        expect(inst.outputInference).toBeFalsy();
        await expect(progress).toHaveText("Updating…");
        await expect(refresh).toHaveAttribute("aria-busy", "true");
        await page.getByRole("tab", { name: "Phases" }).click();
        await expect(page.locator("#pipeline-banner")).toContainText("Updating the pipeline to reflect your installed presets and extensions");
        await expect(page.locator("#pipeline-banner")).toContainText("large number of commands can take several minutes");
        await page.locator("#stepper .step").filter({ hasText: /review/i }).click();
        await page.locator('#more-commands [data-command-id="converge"]').click();
        await expect(page.locator("#stepper")).toContainText("Converge");
        await expect(page.locator("#stepper .step.active")).toContainText("Review");
        expect(inst.state.pipeline.some((item) => item.id === "converge")).toBe(true);
        await page.getByRole("tab", { name: "Setup" }).click();
        const result = await compositionActions[0].handler({ instanceId: id, input: {
            runId: pipelineRunId,
            inferredPipeline: {
                shape: "standalone",
                pipeline: ["commands/speckit.constitution", "commands/speckit.plan",
                    `commands/${review}`, "commands/speckit.tasks"],
                unplaced: [], rationale: "Review follows Plan and precedes Tasks",
            },
        } });
        expect(result.inferredPipelineStatus.accepted).toBe(true);
        await expect(progress).toHaveText("");
        await expect(refresh).not.toHaveAttribute("aria-busy", "true");
        expect(inst.refreshStatus.status).toBe("up-to-date");
        expect(foregroundTurns).toBe(0);
        expect(backgroundTasks).toHaveLength(2);
        await page.getByRole("tab", { name: "Phases" }).click();
        await page.locator("#stepper .step").filter({ hasText: /review/i }).click();
        await page.locator("#phase-card").getByRole("button", { name: "Run phase" }).click();
        await expect.poll(() => backgroundTasks.some((prompt) => prompt.includes("POST http://"))).toBe(true);
        expect(foregroundTurns).toBe(1);
        expect(backgroundTasks).toHaveLength(3);
        const outputPrompt = backgroundTasks.find((prompt) => prompt.includes("POST http://"));
        const artifactEndpoint = outputPrompt.match(/POST (http:\/\/\S+) with JSON/)?.[1];
        expect(new URL(artifactEndpoint).searchParams.get("runId")).toBeTruthy();
        await page.locator("#stepper .step").filter({ hasText: /review/i }).click();
        await expect(page.locator("#phase-card")).toContainText("Retrieving outputs");
        const evidence = {
            fingerprint: source.fingerprint, primaryIndex: 0,
            candidates: [
                { kind: "file", path: "specs/<slug>/reviews/review.md", source: "inference",
                    effect: "creates", evidence: "Review skill declares its primary report" },
                { kind: "file", path: "specs/<slug>/reviews/checklist.md", source: "inference",
                    effect: "creates", evidence: "Review skill declares an additional checklist" },
            ],
        };
        const response = await page.request.post(artifactEndpoint,
            { data: { entries: { [`commands/${review}`]: { outputEvidence: evidence } } } });
        expect(response.status(), await response.text()).toBe(200);
        expect(inst.refreshStatus.status).toBe("up-to-date");
        const completed = await getState();
        expect(completed.artifactInferenceRequests.map((request) => request.commandId)).toEqual([]);
        expect(completed.refreshStatus).toBe("up-to-date");
        expect(foregroundTurns).toBe(1);
        await expect(page.locator("#pipeline-banner")).toContainText("Pipeline updated");
        await expect(page.locator("#stepper")).toContainText(/review/i);
        await expect(page.locator("#stepper")).toContainText("Converge");
        await expect(page.locator("#stepper")).not.toContainText(/audit/i);
        await page.locator("#stepper .step").filter({ hasText: /review/i }).click();
        await expect(page.locator("#phase-card")).toContainText("specs/<slug>/reviews/review.md");
        await expect(page.locator("#phase-card").getByRole("button", { name: "View artifact" })).toHaveCount(0);
        await page.locator("#phase-card .phase-cust-chain-toggle")
            .filter({ hasText: "more" }).click();
        await expect(page.locator("#phase-card")).toContainText("specs/<slug>/reviews/checklist.md");
        expect(prompts.some((prompt) => prompt.includes("speckit-extension-wizard-flow-test-review"))).toBe(true);
        await expect(page.locator("#phase-card").getByRole("status")).toHaveText("Request sent");
        await expect(page.locator("#phase-card").getByRole("button", { name: "Rerun phase" })).toBeEnabled();
        expect(inst.cachedComposition.artifacts.some((artifact) =>
            artifact.id === `commands/${review}` && artifact.kind === "command")).toBe(true);
        expect(inst.cachedComposition.artifacts.some((artifact) =>
            artifact.id.endsWith(".audit") && artifact.kind === "hook")).toBe(true);
        const current = await getState();
        expect(current.artifactEvidence[review]?.candidates.map((item) => item.path))
            .toEqual(evidence.candidates.map((item) => item.path));
    } finally {
        for (const finish of finishTurns) finish();
        await page.goto("about:blank");
        if (inst.outputInference?.timer) clearTimeout(inst.outputInference.timer);
        if (inst.refreshStatus?.timer) clearTimeout(inst.refreshStatus.timer);
        if (server) {
            for (const client of server.sseClients) client.end();
            await new Promise((resolve) => server.server.close(resolve));
        }
        allInstances().delete(id);
        setSession(null);
        await rm(root, { recursive: true, force: true });
    }
});

test("core-only refresh finishes without dispatching an agent turn", async ({ page }) => {
    const root = await mkdtemp(join(tmpdir(), "wizard-core-e2e-"));
    const id = randomUUID();
    const inst = getInstance(id);
    const sent = [];
    let server;
    try {
        await mkdir(join(root, ".specify"), { recursive: true });
        inst.workspacePath = root;
        inst.state = { currentPhase: "constitution", pipeline: null };
        const getState = async () => ({
            workspacePath: root, projectInitialized: true, currentPhase: "constitution",
            setup: { pluginInstalled: true, cliInstalled: true, projectInitialized: true, skillsReloaded: true },
            boot: { phase: "ready", steps: [] }, phases: {}, commands: [], pipeline: null,
            composition: inst.cachedComposition ?? { presets: [], extensions: [], artifacts: [] },
            refreshStatus: inst.refreshStatus?.status ?? "ready",
            refreshId: inst.refreshStatus?.id ?? null,
            catalog: { presets: [], extensions: [], bundles: [] },
        });
        const session = {
            send: async (request) => { sent.push(request); },
            rpc: { skills: { reload: async () => ({ errors: [], warnings: [] }) } },
        };
        setSession(session);
        server = await startServer(id, { session, log: async () => {}, getInstance: () => inst, getState });
        inst.broadcast = (message) => server.broadcast(message.type === "state"
            ? { type: "invalidate", reason: "fixture state changed" } : message);
        await page.goto(server.url);
        await page.locator('#setup-stepper .step[data-substep="composition"]').click();
        const refresh = page.getByRole("button", { name: "Refresh composition" });
        await refresh.click();
        await expect.poll(() => inst.refreshStatus?.status).toBe("up-to-date");
        await expect(refresh).not.toHaveAttribute("aria-busy", "true");
        expect(sent).toEqual([]);
        await page.getByRole("tab", { name: "Phases" }).click();
        await expect(page.locator("#stepper")).toContainText("Plan");
    } finally {
        await page.goto("about:blank");
        if (inst.refreshStatus?.timer) clearTimeout(inst.refreshStatus.timer);
        if (server) {
            for (const client of server.sseClients) client.end();
            await new Promise((resolve) => server.server.close(resolve));
        }
        allInstances().delete(id);
        setSession(null);
        await rm(root, { recursive: true, force: true });
    }
});
