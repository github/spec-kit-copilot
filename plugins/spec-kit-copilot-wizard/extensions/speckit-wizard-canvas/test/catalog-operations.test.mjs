import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setImmediate as tick } from "node:timers/promises";
import { test } from "node:test";
import { catalogOperationKind, validateCatalogRequest, validateCatalogResult } from "../contracts/catalog-operation.mjs";
import { mutateCatalogPackage, readPackageInventories } from "../server/catalog-operations.mjs";
import { runSpecify } from "../server/specify-command.mjs";
import { runCatalogOperation } from "../canvas-runtime/catalog-operations.mjs";
import { dispatchKindPrompt } from "../canvas-runtime/dispatch.mjs";
import { handlePrompt } from "../server/handlers-phase.mjs";
import { createCatalogAddHandler } from "../canvas-runtime/actions/catalog.mjs";
import { allInstances, getInstance, setSession } from "../canvas-runtime/instances.mjs";

const item = (id = "sample", source = "default") => ({
    id, name: id, version: "1.0.0", enabled: true, priority: 10,
    source: { kind: "catalog", catalog: source },
});
const empty = () => ({ preset: [], extension: [], bundle: [] });

async function fixture(t, { source = "default", downloadUrl, bundleYml, allowed = true } = {}) {
    const root = await mkdtemp(join(tmpdir(), "wizard-package-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const inv = empty(), calls = [], events = [];
    const inst = { workspacePath: root, state: {}, url: "http://127.0.0.1:1234", token: "test",
        _verifiedCatalogFields: new Set(["cachedPresetItems", "cachedExtensionItems", "cachedBundleItems"]),
        broadcast: (event) => events.push(event) };
    for (const kind of ["Preset", "Extension", "Bundle"]) {
        inst[`cached${kind}Items`] = [{ id: "sample", name: "Sample", source, version: "1.0.0",
            downloadUrl, bundleYml, installAllowed: allowed }];
    }
    const command = async (project, args, _run, options) => {
        assert.equal(project, root);
        calls.push({ args, options });
        const [group, verb] = args;
        if (verb === "list") {
            if (args.includes("--json")) {
                const items = group === "bundle" ? inv[group] : [...inv[group]].sort((a, b) =>
                    (a.priority ?? 10) - (b.priority ?? 10) || a.id.localeCompare(b.id));
                return JSON.stringify(items);
            }
            assert.fail(`Expected JSON inventory for ${group} list`);
        }
        if (["add", "install"].includes(verb)) {
            inv[group].push(group === "bundle" ? { bundle_id: "sample", version: "1.0.0" }
                : { ...item("sample", source), priority: args.includes("--priority")
                    ? Number(args.at(-1)) : 10 });
        } else if (verb === "remove") inv[group] = [];
        else assert.fail(`Unexpected command ${args.join(" ")}`);
        return "";
    };
    return { root, inv, inst, calls, events, command };
}

test("catalog contract shares canonical kinds and rejects incompatible requests/results", () => {
    assert.equal(catalogOperationKind("composition.removePreset"), "preset.remove");
    assert.equal(catalogOperationKind("preset.update"), null);
    for (const [kind, payload] of [
        ["preset.install", { name: "--force" }],
        ["preset.install", { name: "../sample" }],
        ["preset.install", { name: "sample", source: null }],
        ["preset.install", { name: "sample", force: true }],
        ["preset.install", { name: "sample", downloadUrl: "file:///C:/bad.zip" }],
        ["preset.install", { name: "sample", downloadUrl: "https://user:pass@example.org/a.zip" }],
        ["preset.remove", { name: "sample", downloadUrl: "https://example.org/a.zip" }],
        ["bundle.install", { name: "sample", priority: 1 }],
        ["extension.install", { name: "sample", bundleYml: "schema: 1" }],
        ["extension.update", { name: "sample" }],
    ]) assert.throws(() => validateCatalogRequest(kind, payload));
    for (const value of [{ queued: true }, { ok: true, kind: "preset.install" },
        { ok: true, kind: "preset.install", id: "sample", outcome: "changed", skillsReloaded: true,
            timings: { total: -1 } }]) {
        assert.throws(() => validateCatalogResult(value));
    }
    assert.equal(validateCatalogRequest("extension.install", { name: "sample" }).group, "extension");
    assert.throws(() => validateCatalogResult({ ok: true, id: "sample", kind: "extension.remove",
        outcome: "changed", skillsReloaded: true, timings: { total: 1 } }, { kind: "preset.install" }));
});

test("reconciliation refreshes CLI precedence for existing and newly installed packages", async (t) => {
    const f = await fixture(t);
    f.inv.preset = [item("older")];
    f.inv.extension = [item("old-extension")];
    f.inst.cachedPresetItems.push({ id: "older", active: true, cliOrder: 0 });
    f.inst.cachedExtensionItems.push({ id: "old-extension", active: true, cliOrder: 0 });
    const command = async (project, args, ...rest) => {
        if (args[1] === "add") f.inv.extension.unshift(item("new-extension"));
        return f.command(project, args, ...rest);
    };
    await runCatalogOperation(f.inst, "preset.install", { name: "sample" }, {
        command, reload: async () => ({ ok: true }), finish: async () => ({}),
    });
    assert.deepEqual(f.inst.cachedPresetItems.map(({ id, cliOrder }) => [id, cliOrder]),
        [["sample", 1], ["older", 0]]);
    assert.equal(f.inst.cachedExtensionItems.find(({ id }) => id === "new-extension").cliOrder, 0);
    assert.equal(f.inst.cachedExtensionItems.find(({ id }) => id === "old-extension").cliOrder, 1);
});

test("unreadable CLI precedence reports failure without retaining stale order", async (t) => {
    const f = await fixture(t);
    f.inst.cachedPresetItems[0].cliOrder = 0;
    let reloaded = 0, composed = 0, presetLists = 0;
    await assert.rejects(runCatalogOperation(f.inst, "preset.install", { name: "sample" }, {
        command: async (project, args, ...rest) => {
            if (args[0] === "preset" && args[1] === "list" && args.includes("--json")
                && ++presetLists === 3) return "[]";
            return f.command(project, args, ...rest);
        },
        reload: async () => { reloaded++; return { ok: true }; },
        finish: async () => { composed++; },
    }), (error) => error.stage === "inventory" && error.changed && /ordering unavailable/.test(error.message));
    assert.equal(f.inst.cachedPresetItems[0].active, true);
    assert.equal(f.inst.cachedPresetItems[0].cliOrder, null);
    assert.equal(reloaded, 1);
    assert.equal(composed, 1);
});

for (const group of ["preset", "extension", "bundle"]) {
    test(`${group} installs and removes directly with exact CLI syntax`, async (t) => {
        const f = await fixture(t);
        const install = await mutateCatalogPackage(f.inst, `${group}.install`, {
            name: "sample", ...(group === "preset" ? { priority: 1 } : {}),
        }, { command: f.command });
        assert.equal(install.id, "sample");
        assert.deepEqual(f.calls.find(({ args }) => ["add", "install"].includes(args[1])).args,
            [group, group === "bundle" ? "install" : "add", "sample",
                ...(group === "preset" ? ["--priority", "1"] : [])]);
        const removed = await mutateCatalogPackage(f.inst, `${group}.remove`, { name: "sample" },
            { command: f.command });
        assert.equal(removed.after[group].length, 0);
        assert.deepEqual(f.calls.find(({ args }) => args[1] === "remove").args,
            [group, "remove", "sample", ...(group === "extension" ? ["--force"] : [])]);
        assert.ok(!f.calls.some(({ args }) => args.includes("--refresh")));
    });
}

test("community consent is bound to the exact server selection, never an arbitrary URL", async (t) => {
    const url = "https://example.org/sample.zip?x=1&y=%22a%22";
    const f = await fixture(t, { source: "community", downloadUrl: url, allowed: false });
    for (const payload of [
        { name: "sample" },
        { name: "sample", confirmed: true },
        { name: "sample", confirmed: true, downloadUrl: "https://attacker.example/a.zip" },
        { name: "sample", confirmed: false, downloadUrl: url },
    ]) {
        await assert.rejects(mutateCatalogPackage(f.inst, "extension.install", payload, { command: f.command }),
            /source|[Cc]onfirm/);
    }
    assert.equal(f.calls.length, 0);
    await mutateCatalogPackage(f.inst, "extension.install",
        { name: "sample", source: "community", downloadUrl: url, confirmed: true }, { command: f.command });
    const mutation = f.calls.find(({ args }) => args[1] === "add");
    assert.deepEqual(mutation.args, ["extension", "add", "sample", "--from", url]);
    assert.equal(mutation.options.confirmApprovedSource, true);
});

test("ID-only actions reject ambiguous and unapproved source selections", async (t) => {
    const f = await fixture(t, { source: "one", downloadUrl: "https://example.org/a.zip" });
    f.inst.cachedPresetItems.push({ ...f.inst.cachedPresetItems[0], source: "two" });
    await assert.rejects(mutateCatalogPackage(f.inst, "preset.install", { name: "sample" },
        { command: f.command }), /ambiguous/);
    assert.equal(f.calls.length, 0);
});

test("agent-pushed catalog data cannot authorize an installation", async (t) => {
    const f = await fixture(t);
    f.inst._verifiedCatalogFields.clear();
    await assert.rejects(mutateCatalogPackage(f.inst, "preset.install",
        { name: "sample" }, { command: f.command }), /configured source/);
    assert.equal(f.calls.length, 0);
});

test("resolved IDs are validated, and removal never follows advisory catalog identity mappings", async (t) => {
    const f = await fixture(t);
    f.inst.cachedPresetItems[0].installedId = "--force";
    await assert.rejects(mutateCatalogPackage(f.inst, "preset.install",
        { name: "sample" }, { command: f.command }), /Invalid catalog package request/);
    assert.equal(f.calls.length, 0);
    f.inst.cachedPresetItems[0].installedId = "unrelated";
    f.inst._verifiedCatalogFields.clear();
    f.inv.preset = [item(), item("unrelated")];
    const removed = await mutateCatalogPackage(f.inst, "preset.remove", { name: "sample" }, {
        command: async (project, args) => {
            if (args[1] !== "remove") return f.command(project, args);
            assert.deepEqual(args, ["preset", "remove", "sample"]);
            f.inv.preset = f.inv.preset.filter((entry) => entry.id !== args[2]);
            return "";
        },
    });
    assert.deepEqual(removed.after.preset.map((entry) => entry.id), ["unrelated"]);
});

test("retained legacy dispatch acknowledges only a queued prompt, not installation", async (t) => {
    const f = await fixture(t);
    const prompts = [];
    setSession({ send: ({ prompt }) => { prompts.push(prompt); return new Promise(() => {}); } });
    t.after(() => setSession(null));
    const start = performance.now();
    const result = await dispatchKindPrompt(f.inst, "extension.install", { name: "sample" });
    t.diagnostic(`Legacy prompt-dispatch acknowledgement: ${(performance.now() - start).toFixed(1)} ms; installation has not run`);
    await tick();
    assert.equal(result.kind, "extension.install");
    assert.equal(prompts.length, 1);
    assert.match(prompts[0], /specify extension add|Install exactly the named extension/);
    assert.equal(f.inv.extension.length, 0);
    assert.equal(f.calls.length, 0);
});

test("already satisfied installs are verified, and conflicts never remove or force-replace", async (t) => {
    const f = await fixture(t);
    f.inv.preset = [item()];
    const result = await mutateCatalogPackage(f.inst, "preset.install", { name: "sample" }, { command: f.command });
    assert.equal(result.changed, false);
    f.inv.preset[0].version = "9.0.0";
    await assert.rejects(mutateCatalogPackage(f.inst, "preset.install", { name: "sample" },
        { command: f.command }), /will not overwrite/);
    f.inv.preset[0] = { ...item(), source: { kind: "local" } };
    await assert.rejects(mutateCatalogPackage(f.inst, "preset.install", { name: "sample" },
        { command: f.command }), /source/);
    assert.ok(f.calls.every(({ args }) => args[1] === "list"));
});

test("verification resolves a catalog alias to the actual newly installed manifest ID", async (t) => {
    const f = await fixture(t);
    const command = async (...args) => {
        const result = await f.command(...args);
        if (args[1][1] === "add") f.inv.preset[0].id = "actual-manifest";
        return result;
    };
    const result = await mutateCatalogPackage(f.inst, "preset.install", { name: "sample" }, { command });
    assert.equal(result.id, "actual-manifest");
    f.inv.preset = [];
    await assert.rejects(mutateCatalogPackage(f.inst, "preset.install", { name: "sample" },
        { command: async (project, args) => args[1] === "list" ? f.command(project, args) : "" }),
    /expected package state/);
});

test("malformed inventories fail explicitly without invoking a mutation", async (t) => {
    const f = await fixture(t);
    for (const text of ["not json", "{}", JSON.stringify([item(), item()])]) {
        await assert.rejects(readPackageInventories(f.root, async () => text), /inventory/);
    }
});

for (const inline of [false, true]) {
    test(`approved bundle ${inline ? "manifest" : "archive"} is staged uniquely and cleaned on failure`, async (t) => {
        const f = await fixture(t, { source: "community", allowed: false,
            ...(inline ? { bundleYml: "bundle:\n  id: sample\n" }
                : { downloadUrl: "https://example.org/bundle.zip" }) });
        const selected = f.inst.cachedBundleItems[0];
        const paths = [];
        const command = async (project, args) => {
            if (args[1] === "install") {
                paths.push(args[2]);
                assert.equal(await readFile(args[2], "utf8"), inline ? selected.bundleYml : "zip");
                f.inv.extension = [item("partially-installed")];
                throw new Error("bundle installation failed after first component");
            }
            return f.command(project, args);
        };
        for (let attempt = 0; attempt < 2; attempt++) {
            await assert.rejects(mutateCatalogPackage(f.inst, "bundle.install", { name: "sample",
                source: "community", confirmed: true, downloadUrl: selected.downloadUrl,
                bundleYml: selected.bundleYml }, {
                command, download: async (url, path) => writeFile(path, "zip"),
            }), (error) => {
                assert.equal(error.changed, true);
                assert.equal(error.inventories.extension[0].id, "partially-installed");
                return /first component/.test(error.message);
            });
            await assert.rejects(access(dirname(paths.at(-1))), { code: "ENOENT" });
        }
        assert.notEqual(paths[0], paths[1]);
        assert.ok(!f.calls.some(({ args }) => args[1] === "remove"));
    });
}

test("shared subprocess execution bounds output/time and preserves diagnostics without a Windows shell", async (t) => {
    const f = await fixture(t);
    let confirmed;
    const run = (_binary, args, options) => {
        assert.equal(options.timeout, 120000);
        assert.equal(options.maxBuffer, 2 * 1024 * 1024);
        assert.equal(options.cwd, f.root);
        if (process.platform === "win32") assert.equal(options.shell, false);
        const promise = Promise.resolve({ stdout: "", stderr: "" });
        promise.child = { stdin: { end: (value) => { confirmed = value; } } };
        return promise;
    };
    await runSpecify(f.root, ["extension", "add", "sample", "--from", "https://example.org/a.zip"], run);
    assert.equal(confirmed, "y\n");
    await assert.rejects(runSpecify(f.root, ["preset", "add", "sample"], async () => {
        throw Object.assign(new Error("process timed out"), { stderr: "timed out: fixture" });
    }), /timed out: fixture/);
    await assert.rejects(runSpecify(f.root, ["preset", "add", "sample"], async () =>
        ({ stdout: "Composition warning: missing base", stderr: "" })), /composition warning/);
});

test("package completion does not dispatch output inference; reload and composition each run once", async (t) => {
    const f = await fixture(t);
    let reloads = 0, compositions = 0;
    const prompts = [];
    const session = {
        send: () => assert.fail("output inference must not use the foreground conversation"),
        rpc: { tasks: {
            startAgent: ({ prompt }) => { prompts.push(prompt); return new Promise(() => {}); },
            cancel: async () => ({ cancelled: true }),
        } },
    };
    const result = await runCatalogOperation(f.inst, "extension.install", { name: "sample" }, {
        command: f.command, session,
        reload: async () => { reloads++; return { ok: true }; },
        finish: async () => { compositions++; return { ok: true }; },
    });
    await tick();
    assert.equal(result.ok, true);
    assert.equal(result.skillsReloaded, true);
    assert.equal(reloads, 1);
    assert.equal(compositions, 1);
    assert.equal(prompts.length, 0);
    assert.equal(f.inst.outputInference, undefined);
    assert.equal(f.inst.cachedExtensionItems[0].active, true);
    assert.equal(f.inst._lastInstalledExtensionIds.has("sample"), true);
});

test("cached outputs dispatch no agent prompt and bundle reconciliation preserves other packages", async (t) => {
    const f = await fixture(t);
    f.inv.extension = [item("unowned")];
    let reloads = 0;
    await runCatalogOperation(f.inst, "bundle.install", { name: "sample" }, {
        command: f.command, session: { send: () => assert.fail("no output inference needed") },
        reload: async () => { reloads++; return { ok: true }; },
        finish: async () => ({ artifactInferenceRequests: [] }),
    });
    assert.equal(reloads, 0);
    assert.equal(f.inst.cachedExtensionItems.find((entry) => entry.id === "unowned").active, true);
    assert.equal(f.inst.cachedBundleItems[0].active, true);
});

test("partial bundle failure reconciles every inventory, reloads once, and never starts inference", async (t) => {
    const f = await fixture(t);
    f.inv.preset = [item("independent")];
    let reloads = 0, compositions = 0;
    await assert.rejects(runCatalogOperation(f.inst, "bundle.install", { name: "sample" }, {
        command: async (project, args) => {
            if (args[1] === "install") {
                f.inv.extension.push(item("partial"));
                throw new Error("bundle failed midway");
            }
            return f.command(project, args);
        },
        reload: async () => { reloads++; return { ok: true }; },
        finish: async (_inst, options) => {
            compositions++;
            return { artifactInferenceRequests: [] };
        },
        session: { send: () => assert.fail("failed operation must not enqueue inference") },
    }), (error) => error.stage === "command" && error.changed && /midway/.test(error.message));
    assert.equal(reloads, 1);
    assert.equal(compositions, 1);
    assert.equal(f.inst.cachedExtensionItems.find((entry) => entry.id === "partial").active, true);
    assert.equal(f.inst.cachedPresetItems.find((entry) => entry.id === "independent").active, true);
    assert.equal(f.inst.cachedBundleItems[0].active, false);
    assert.ok(!f.calls.some(({ args }) => args[1] === "remove"));
});

test("composition failures retain installed truth and release the guard without claiming rollback", async (t) => {
    const f = await fixture(t);
    await assert.rejects(runCatalogOperation(f.inst, "extension.install", { name: "sample" }, {
        command: f.command, reload: async () => ({ ok: true }),
        finish: async () => { throw new Error("composition unavailable"); },
    }), (error) => error.stage === "composition" && error.changed && /unavailable/.test(error.message));
    assert.equal(f.inst.cachedExtensionItems[0].active, true);
    const result = await runCatalogOperation(f.inst, "extension.remove", { name: "sample" }, {
        command: f.command, reload: async () => ({ ok: true }),
        finish: async () => ({ artifactInferenceRequests: [] }),
    });
    assert.equal(result.ok, true);
});

test("unreadable post-operation inventories never fall back to the old inventory as verified truth", async (t) => {
    const f = await fixture(t);
    let mutated = false, finishes = 0;
    await assert.rejects(runCatalogOperation(f.inst, "extension.install", { name: "sample" }, {
        command: async (project, args) => {
            if (args[1] === "add") {
                mutated = true;
                await f.command(project, args);
                throw new Error("process exited after a write");
            }
            if (mutated) throw new Error("inventory unreadable");
            return f.command(project, args);
        },
        finish: async () => { finishes++; return { artifactInferenceRequests: [] }; },
    }), (error) => error.changed && /reconciliation also failed:.*inventory unreadable/.test(error.message));
    assert.equal(finishes, 0);
    assert.equal(f.inst._catalogSkillsDirty, true);
    assert.ok(!f.events.some((event) => event.type === "extension-catalog"));
});

test("unverifiable bundle sources conflict instead of reinstalling or reporting an assumed success", async (t) => {
    const f = await fixture(t);
    f.inv.bundle.push({ bundle_id: "sample", version: "1.0.0" });
    await assert.rejects(mutateCatalogPackage(f.inst, "bundle.install", { name: "sample" },
        { command: f.command }), (error) => error.status === 409 && /cannot verify this source/.test(error.message));
    assert.ok(f.calls.every(({ args }) => args[1] === "list"));
});

test("failed reload retains installed truth, composes once, and can be retried without reinstalling", async (t) => {
    const f = await fixture(t);
    let attempts = 0, compositions = 0;
    const deps = { command: f.command,
        session: { rpc: { skills: { reload: async () => {
            attempts++;
            return { errors: attempts === 1 ? ["reload failure"] : [], warnings: [] };
        } } } },
        finish: async (_inst, options) => {
            compositions++;
            return { artifactInferenceRequests: [] };
        },
    };
    await assert.rejects(runCatalogOperation(f.inst, "extension.install", { name: "sample" }, deps),
        (error) => error.stage === "skills" && error.changed && /reload failed/.test(error.message));
    assert.equal(f.inst.cachedExtensionItems[0].active, true);
    assert.equal(compositions, 1);
    const retry = await runCatalogOperation(f.inst, "extension.install", { name: "sample" }, deps);
    assert.equal(retry.outcome, "already-satisfied");
    assert.equal(retry.skillsReloaded, true);
    assert.equal(f.calls.filter(({ args }) => args[1] === "add").length, 1);
});

test("overlapping mutations reject immediately, and reload timeouts release the checkout guard", async (t) => {
    const f = await fixture(t);
    let unblock, proceed, entered;
    const waiting = new Promise((resolve) => { unblock = resolve; });
    const mutationGate = new Promise((resolve) => { proceed = resolve; });
    const mutationStarted = new Promise((resolve) => { entered = resolve; });
    const first = runCatalogOperation(f.inst, "preset.install", { name: "sample" }, {
        mutate: async (...args) => {
            entered();
            await mutationGate;
            return mutateCatalogPackage(...args);
        },
        command: f.command, reloadTimeoutMs: 20,
        session: { rpc: { skills: { reload: () => waiting } } },
        finish: async () => ({ artifactInferenceRequests: [] }),
    });
    const timedOut = assert.rejects(first, /timed out/);
    await mutationStarted;
    await assert.rejects(runCatalogOperation(f.inst, "preset.remove", { name: "sample" }),
        (error) => error.status === 409 && error.stage === "busy");
    proceed();
    await timedOut;
    unblock({ errors: [], warnings: [] });
    const retry = await runCatalogOperation(f.inst, "preset.remove", { name: "sample" }, {
        command: f.command, reload: async () => ({ ok: true }),
        finish: async () => ({ artifactInferenceRequests: [] }),
    });
    assert.equal(retry.ok, true);
});

test("HTTP package kinds return terminal results, failures retain stage/change truth, other kinds stay queued", async (t) => {
    const f = await fixture(t);
    const res = () => ({ writeHead(code) { this.code = code; }, end(text) { this.body = JSON.parse(text); } });
    const deps = { getInstance: () => f.inst, catalogOperation: (inst, kind, payload) =>
        runCatalogOperation(inst, kind, payload, { command: f.command,
            reload: async () => ({ ok: true }), finish: async () => ({ artifactInferenceRequests: [] }) }) };
    for (const kind of ["preset.install", "composition.removePreset"]) {
        const response = res();
        await handlePrompt(response, { kind, payload: { name: "sample" } }, deps);
        assert.equal(response.code, 200);
        assert.equal(response.body.ok, true);
        assert.equal(response.body.queued, undefined);
    }
    const bad = res();
    await handlePrompt(bad, { kind: "extension.install", payload: { name: "../bad" } }, deps);
    assert.equal(bad.code, 400);
    assert.equal(bad.body.changed, false);
    assert.equal(bad.body.stage, "validation");
    const queued = res();
    const prompts = [];
    setSession({ send: ({ prompt }) => { prompts.push(prompt); return new Promise(() => {}); } });
    t.after(() => setSession(null));
    await handlePrompt(queued, { kind: "setup.init", payload: {} }, deps);
    await tick();
    assert.equal(queued.code, 202);
    assert.equal(queued.body.queued, true);
    assert.equal(prompts.length, 1);
});

test("existing canvas add actions validate ID-only requests and wait for terminal completion", async (t) => {
    const f = await fixture(t);
    const instanceId = `catalog-actions-${Date.now()}`;
    Object.assign(getInstance(instanceId), f.inst);
    t.after(() => allInstances().delete(instanceId));
    for (const group of ["preset", "extension"]) {
        let calls = 0;
        const handler = createCatalogAddHandler(group, async (inst, kind, payload) => {
            calls++;
            return runCatalogOperation(inst, kind, payload, { command: f.command,
                reload: async () => ({ ok: true }), finish: async () => ({ artifactInferenceRequests: [] }) });
        });
        const invalid = await handler({ instanceId, input: { id: "--force" } });
        assert.equal(invalid.ok, false);
        assert.equal(calls, 0);
        const result = await handler({ instanceId, input: { id: "sample" } });
        assert.equal(result.ok, true);
        assert.equal(result.kind, `${group}.install`);
        assert.equal(f.inv[group][0].id, result.id);
    }
    const incompatible = createCatalogAddHandler("preset", async () => ({ queued: true }));
    assert.equal((await incompatible({ instanceId, input: { id: "sample" } })).ok, false);
});
