// Scanner ⇄ preset-loader ⇄ renderer.buildStateSnapshot integration.
// Also: env-probe → state-store setup slice.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { scanWorkspace } from "../project-scanner.mjs";
import { buildStateSnapshot } from "../canvas-runtime/snapshot-builder.mjs";
import { summarizeResults } from "../env/probe.mjs";
import { applyPatch, normalizeState } from "../state/store.mjs";

// --- helpers --------------------------------------------------------------

async function realFsDeps() {
    const fsp = await import("node:fs/promises");
    return {
        pathExists: async (p) => { try { await fsp.access(p); return true; } catch { return false; } },
        readFile: (p) => fsp.readFile(p, "utf8"),
        stat: (p) => fsp.stat(p),
        readdir: (p, opts) => fsp.readdir(p, opts),
    };
}

function tmpWs() { return mkdtempSync(join(tmpdir(), "speckit-scan-")); }

// -------- S6: preset-loader → scanner.phaseGraph ordering -----------------

test("S6: .specify/presets/.registry order flows through preset-loader into scanner.phaseGraph", async () => {
    // The registry declares which presets are installed. loadPresetGraph
    // parses the registry, resolves each preset's commands, and hands the
    // result to the scanner as scan.phaseGraph. If installed presets don't
    // survive that pipeline, the phase list is rendered from the wrong
    // command set. Precedence/winner selection is the CLI's job, not the
    // loader's — so we only assert reachability + merge here.
    const ws = tmpWs();
    try {
        mkdirSync(join(ws, ".specify", "presets", "alpha", "commands"), { recursive: true });
        mkdirSync(join(ws, ".specify", "presets", "beta", "commands"), { recursive: true });
        writeFileSync(
            join(ws, ".specify", "presets", ".registry"),
            JSON.stringify([
                { id: "alpha", priority: 100, enabled: true },
                { id: "beta", priority: 50, enabled: true },
            ]),
        );
        writeFileSync(
            join(ws, ".specify", "presets", "alpha", "preset.yml"),
            [
                "preset:",
                "  name: Alpha",
                "  version: 1.0.0",
                "provides:",
                "  templates:",
                "    - type: command",
                "      name: speckit.a1",
                "      file: commands/a1.md",
                "",
            ].join("\n"),
        );
        writeFileSync(
            join(ws, ".specify", "presets", "alpha", "commands", "a1.md"),
            "---\nhandoffs: []\n---\n# A1\n",
        );
        writeFileSync(
            join(ws, ".specify", "presets", "beta", "preset.yml"),
            [
                "preset:",
                "  name: Beta",
                "  version: 1.0.0",
                "provides:",
                "  templates:",
                "    - type: command",
                "      name: speckit.b1",
                "      file: commands/b1.md",
                "",
            ].join("\n"),
        );
        writeFileSync(
            join(ws, ".specify", "presets", "beta", "commands", "b1.md"),
            "---\nhandoffs: []\n---\n# B1\n",
        );

        const scan = await scanWorkspace(ws, await realFsDeps());
        // No scan failure warnings from the loader — otherwise loader failed
        // and we're testing the fallback path, not the real integration.
        assert.equal(
            scan.warnings.filter((w) => w.includes("loadPresetGraph failed")).length,
            0,
            `preset loader failed: ${scan.warnings.join(" | ")}`,
        );
        // The registry-declared presets must reach scan.phaseGraph.presets.
        const presetIds = scan.phaseGraph.presets.map((p) => p.id);
        assert.ok(presetIds.includes("alpha"), `phaseGraph.presets missing 'alpha': ${presetIds.join(",")}`);
        assert.ok(presetIds.includes("beta"), `phaseGraph.presets missing 'beta': ${presetIds.join(",")}`);
        // The commands sourced from each preset must appear in the merged
        // command graph.
        const commandNames = scan.phaseGraph.commands.map((c) => c.name);
        assert.ok(commandNames.includes("speckit.a1"), `command 'speckit.a1' missing: ${commandNames.join(",")}`);
        assert.ok(commandNames.includes("speckit.b1"), `command 'speckit.b1' missing: ${commandNames.join(",")}`);
    } finally {
        rmSync(ws, { recursive: true, force: true });
    }
});

// -------- S7: scanner → buildStateSnapshot lock/gate ----------------------

test("S7: buildStateSnapshot derives per-phase locked from durable setup completion", async () => {
    // The snapshot's lock/gate flags drive the UI's greyed-out state.
    // We assert only the JS-visible fields, never HTML — that keeps this
    // test resilient to renderer refactors while catching the actual
    // derivation regression (setup-gate rule).
    // Case A: setup incomplete → all downstream phases are locked.
    const scanIncomplete = {
        workspacePath: "/ws",
        projectInitialized: false,
        setup: { pluginInstalled: false, cliInstalled: false, projectInitialized: false, skillsReloaded: false, catalogsLoaded: false },
        preset: "core",
        currentPhase: "setup",
        phases: {},
        composition: { presets: [], extensions: [] },
        catalog: { presets: [] },
        warnings: [],
    };
    const snapA = buildStateSnapshot(scanIncomplete);
    // Setup itself is never locked.
    assert.notEqual(snapA.phases.setup?.locked, true);
    // Everything else is.
    for (const [id, phase] of Object.entries(snapA.phases)) {
        if (id === "setup") continue;
        assert.equal(phase.locked, true, `phase ${id} must be locked when setup incomplete`);
    }
    // Case B: setup complete → downstream phases unlock.
    const scanComplete = {
        ...scanIncomplete,
        projectInitialized: true,
        setup: {
            ...scanIncomplete.setup,
            pluginInstalled: true,
            cliInstalled: true,
            projectInitialized: true,
            skillsReloaded: true,
        },
    };
    const snapB = buildStateSnapshot(scanComplete);
    for (const [id, phase] of Object.entries(snapB.phases)) {
        if (id === "setup") continue;
        assert.equal(phase.locked, false, `phase ${id} must be unlocked when setup complete`);
    }
    // Case C: taskstoissues stays gated until a provider is in composition.
    assert.equal(snapB.phases.taskstoissues?.gated, true, "no taskstoissues provider → gated=true");
    // Add a matching layer, re-snapshot: gated flips.
    const scanWithProvider = {
        ...scanComplete,
        composition: { presets: [], extensions: [{ name: "speckit-taskstoissues", source: "catalog" }] },
    };
    const snapC = buildStateSnapshot(scanWithProvider);
    assert.equal(snapC.phases.taskstoissues?.gated, false, "taskstoissues provider in composition → gated=false");
});

// -------- S8: env-probe → state-store setup slice → derived phase ---------

test("S8: env-probe output composes with applyPatch → phases.setup.status flips as sub-flags flip", async () => {
    // The summarizer produces { cliInstalled, pluginInstalled, ... }; the
    // state store consumes those into state.setup and derives
    // phases.setup.status. Neither test proves the composition in
    // isolation. Here we walk from mock probe stdout to derived status.
    // Initial: neither CLI nor plugin present.
    const s0 = summarizeResults([]);
    let state = applyPatch(normalizeState({}), { setup: s0 });
    assert.equal(state.phases.setup.status, "empty");

    // CLI installed alone → still in_progress (not all four sub-flags true).
    const s1 = summarizeResults([{ name: "specify", exitCode: 0, stdout: "specify 0.1.0" }]);
    assert.equal(s1.cliInstalled, true);
    state = applyPatch(state, { setup: s1 });
    assert.equal(state.phases.setup.status, "in_progress");

    // CLI + plugin present → still in_progress until projectInitialized +
    // skillsReloaded flip.
    const s2 = summarizeResults([
        { name: "specify", exitCode: 0, stdout: "specify 0.1.0" },
        {
            name: "spec-kit-plugin",
            exitCode: 0,
            stdout: "  • spec-kit-copilot@spec-kit-marketplace (v0.11.8)",
        },
    ]);
    assert.equal(s2.cliInstalled, true);
    assert.equal(s2.pluginInstalled, true);
    state = applyPatch(state, { setup: s2 });
    assert.equal(state.phases.setup.status, "in_progress");

    // Manually flip the two remaining sub-flags — projectInitialized and
    // skillsReloaded aren't probe outputs, they're written by the setup
    // sub-step handlers. Verify the derived phase status flips to "done"
    // when all four are true (catalogsLoaded doesn't count).
    state = applyPatch(state, { setup: { projectInitialized: true, skillsReloaded: true } });
    assert.equal(state.phases.setup.status, "done");
});
