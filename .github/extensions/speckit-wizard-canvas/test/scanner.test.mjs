// Tests for project-scanner.mjs — uses an injected in-memory fs bag; no real disk.
import { test } from "node:test";
import assert from "node:assert/strict";
import { scanWorkspace, readMarkdownArtifact, _internal } from "../project-scanner.mjs";

// Simple in-memory filesystem.
// Files map: { "abs/path" → string content, "abs/path/DIR" → true (marker) }.
function makeFs(files) {
    const norm = (p) => p.replace(/\\/g, "/");
    const store = new Map(Object.entries(files).map(([k, v]) => [norm(k), v]));
    const isDir = (p) => {
        const np = norm(p);
        if (store.get(np) === "__DIR__") return true;
        // Directory if any file lives under it.
        for (const k of store.keys()) {
            if (k.startsWith(np + "/")) return true;
        }
        return false;
    };
    return {
        _store: store,
        pathExists: async (p) => {
            const np = norm(p);
            return store.has(np) || isDir(np);
        },
        stat: async (p) => {
            const np = norm(p);
            if (isDir(np) && !store.has(np))
                return { isFile: () => false, isDirectory: () => true, size: 0, mtimeMs: 1 };
            const v = store.get(np);
            if (v === undefined) throw new Error(`ENOENT: ${p}`);
            const size = typeof v === "string" ? v.length : 0;
            return { isFile: () => v !== "__DIR__", isDirectory: () => v === "__DIR__", size, mtimeMs: 2 };
        },
        readFile: async (p) => {
            const v = store.get(norm(p));
            if (typeof v !== "string" || v === "__DIR__") throw new Error(`ENOENT: ${p}`);
            return v;
        },
        readdir: async (p) => {
            const np = norm(p) + "/";
            const names = new Set();
            for (const k of store.keys()) {
                if (!k.startsWith(np)) continue;
                const rest = k.slice(np.length);
                const first = rest.split("/")[0];
                if (!first) continue;
                names.add(first);
            }
            return Array.from(names).map((name) => ({
                name,
                isFile: () => !isDir(np + name),
                isDirectory: () => isDir(np + name),
            }));
        },
    };
}

test("scanWorkspace with empty workspace returns un-initialized state", async () => {
    const fs = makeFs({});
    const scan = await scanWorkspace("/proj", fs);
    assert.equal(scan.projectInitialized, false);
    assert.equal(scan.setup.projectInitialized, false);
    assert.equal(scan.currentPhase, "setup");
    // Composition scanner emits { presets, extensions } — empty when
    // no .specify/*.json files exist. The synthetic "core" bottom layer
    // is added by consumers via deriveLayers (ui/composition.js).
    assert.deepEqual(scan.composition.presets, []);
    assert.deepEqual(scan.composition.extensions, []);
});

test("scanWorkspace picks up constitution.md and sets phase status", async () => {
    const fs = makeFs({
        "/proj/.specify": "__DIR__",
        "/proj/.specify/memory/constitution.md": "<!-- speckit:constitution v1 -->\nprinciples...",
    });
    const scan = await scanWorkspace("/proj", fs);
    assert.equal(scan.projectInitialized, true);
    assert.equal(scan.constitutionPath, ".specify/memory/constitution.md");
    assert.equal(scan.phases.constitution.status, "done");
});

test("scanWorkspace keeps constitution done when Sync Impact Report contains bracket tokens in an HTML comment", async () => {
    // The constitution SKILL prescribes an HTML-comment Sync Impact Report at
    // the top of constitution.md that intentionally includes bracket-token
    // breadcrumbs like `[PRINCIPLE_1_NAME] → I. Clarity`. Those must not
    // trip the unfilled-template heuristic and downgrade status back to empty.
    const filled = [
        "<!--",
        "Sync Impact Report",
        "- [PRINCIPLE_1_NAME] → I. Clarity Over Cleverness",
        "- [PRINCIPLE_2_NAME] → II. Small, Reviewable Changes",
        "- [SECTION_2_NAME] → Engineering Standards",
        "- [SECTION_3_NAME] → Governance",
        "-->",
        "# Project Constitution",
        "",
        "## I. Clarity Over Cleverness",
        "Prefer readable code.",
    ].join("\n");
    const fs = makeFs({
        "/proj/.specify": "__DIR__",
        "/proj/.specify/memory/constitution.md": filled,
    });
    const scan = await scanWorkspace("/proj", fs);
    assert.equal(scan.phases.constitution.status, "done");
    assert.equal(scan.phases.constitution.artifactPath, ".specify/memory/constitution.md");
});

test("scanWorkspace still flags a genuinely unfilled constitution template", async () => {
    // Two or more distinct bracket tokens OUTSIDE any HTML comment should
    // still downgrade the phase — this is the whole point of the heuristic.
    const unfilled = [
        "# [PROJECT_NAME] Constitution",
        "",
        "## I. [PRINCIPLE_1_NAME]",
        "[PRINCIPLE_1_DESCRIPTION]",
    ].join("\n");
    const fs = makeFs({
        "/proj/.specify": "__DIR__",
        "/proj/.specify/memory/constitution.md": unfilled,
    });
    const scan = await scanWorkspace("/proj", fs);
    assert.equal(scan.phases.constitution.status, "empty");
});

test("scanWorkspace hydrates specs/<slug>/ artifacts and picks most recent slug", async () => {
    const fs = makeFs({
        "/proj/.specify": "__DIR__",
        "/proj/specs/older-slug/spec.md": "<!-- speckit:specify v1 -->\n",
        "/proj/specs/newer-slug/spec.md": "<!-- speckit:specify v1 -->\n",
        "/proj/specs/newer-slug/plan.md": "<!-- speckit:plan v1 -->\n",
        "/proj/specs/newer-slug/tasks.md": "<!-- speckit:tasks v1 -->\n",
    });
    // Force different mtimes: newer-slug last.
    const origStat = fs.stat;
    fs.stat = async (p) => {
        const s = await origStat(p);
        if (String(p).includes("newer-slug")) return { ...s, mtimeMs: 999 };
        return s;
    };
    const scan = await scanWorkspace("/proj", fs);
    assert.equal(scan.slug, "newer-slug");
    assert.equal(scan.phases.specify.status, "done");
    assert.equal(scan.phases.plan.status, "done");
    assert.equal(scan.phases.tasks.status, "done");
});

test("scanWorkspace defensively normalizes malformed state.json", async () => {
    const fs = makeFs({
        "/proj/.specify": "__DIR__",
        "/proj/.speckit-wizard": "__DIR__",
        // Malformed JSON — should not throw, should not corrupt state.
        "/proj/.speckit-wizard/state.json": "{ not json",
    });
    const scan = await scanWorkspace("/proj", fs);
    // Should default currentPhase to 'setup', phases populated with empty slices
    assert.equal(scan.currentPhase, "setup");
    assert.equal(scan.phases.constitution.status, "empty");
});

test("scanWorkspace ignores alias status strings gracefully", async () => {
    const fs = makeFs({
        "/proj/.specify": "__DIR__",
        "/proj/.speckit-wizard": "__DIR__",
        "/proj/.speckit-wizard/state.json": JSON.stringify({
            $schema: "speckit-wizard/v1",
            currentPhase: "plan",
            preset: "core",
            setup: { cliInstalled: true, projectInitialized: true, skillsReloaded: true },
            phases: {
                constitution: { status: "COMPLETED" },
                specify: { status: "in-progress" },
                plan: { status: "running" },
                clarify: { status: "skip", optionalSkipped: true },
            },
        }),
    });
    const scan = await scanWorkspace("/proj", fs);
    assert.equal(scan.phases.constitution.status, "done");
    assert.equal(scan.phases.specify.status, "in_progress");
    assert.equal(scan.phases.plan.status, "in_progress");
    assert.equal(scan.phases.clarify.status, "skipped");
    assert.equal(scan.phases.clarify.optionalSkipped, true);
    assert.equal(scan.currentPhase, "plan");
});

test("scanWorkspace drops malformed composition entries defensively", async () => {
    const fs = makeFs({
        "/proj/.specify": "__DIR__",
        "/proj/.specify/presets.json": JSON.stringify([
            { name: "lean" },
            { source: "no name" }, // dropped (no name)
            null, // dropped
            "string", // dropped
        ]),
    });
    const scan = await scanWorkspace("/proj", fs);
    const names = scan.composition.presets.map((p) => p.name);
    assert.ok(names.includes("lean"));
    // 3 malformed entries should not appear
    assert.equal(scan.composition.presets.length, 1);
});

test("readMarkdownArtifact: detects provenance marker and returns null for missing paths", async () => {
    const fs = makeFs({
        "/proj/.specify/memory/constitution.md": "<!-- speckit:constitution v1 -->\nbody",
    });
    const r = await readMarkdownArtifact("/proj", ".specify/memory/constitution.md", fs);
    assert.deepEqual(r.marker, { phase: "constitution", version: 1 });
    const missing = await readMarkdownArtifact("/proj", "does/not/exist.md", fs);
    assert.equal(missing, null);
});

test("scanWorkspace tolerates missing artifact-targets.json (no cache = no extension entries)", async () => {
    const fs = makeFs({
        "/proj/.specify": "__DIR__",
        "/proj/.specify/extensions/assess/commands/speckit.assess.intake.md": "# skill",
        "/proj/.specify/assessments/foo/intake.md": "some content",
    });
    const scan = await scanWorkspace("/proj", fs);
    // Without a cache, we don't guess. Extension command has no phase entry.
    assert.equal(scan.phases["commands/speckit.assess.intake"], undefined);
    assert.deepEqual(scan.warnings, []);
});

test("scanWorkspace leaves writesTo template as-is when there is no slug", async () => {
    const fs = makeFs({
        "/proj/.specify": "__DIR__",
        // Extension command file must exist so pruning doesn't drop the entry.
        "/proj/.specify/extensions/assess/commands/speckit.assess.intake.md": "# intake skill",
        "/proj/.speckit-wizard/artifact-targets.json": JSON.stringify({
            version: 1,
            entries: {
                "commands/speckit.assess.intake": {
                    writesTo: ".specify/assessments/<slug>/intake.md",
                    source: "manual",
                },
            },
        }),
    });
    const scan = await scanWorkspace("/proj", fs);
    // No specs/<slug>/ folder → slug is null → template stays literal so the
    // UI can still surface "where this will eventually write".
    assert.equal(
        scan.phases["commands/speckit.assess.intake"]?.artifactPath,
        ".specify/assessments/<slug>/intake.md",
    );
    assert.equal(scan.phases["commands/speckit.assess.intake"]?.status, "empty");
});

test("scanWorkspace ignores malformed cache entries", async () => {
    const fs = makeFs({
        "/proj/.specify": "__DIR__",
        // Only .shape is installed; the others would be pruned as orphans even if
        // present in cache, but the test is really about MALFORMED entries — so
        // include the installed file for the well-formed one.
        "/proj/.specify/extensions/assess/commands/speckit.assess.shape.md": "# shape skill",
        "/proj/.speckit-wizard/artifact-targets.json": JSON.stringify({
            version: 1,
            entries: {
                "commands/speckit.assess.intake": { writesTo: null }, // bad
                "commands/speckit.assess.define": {},                  // missing
                "not-a-command/foo": { writesTo: ".specify/foo.md" },   // wrong prefix
                "commands/speckit.assess.shape": { writesTo: ".specify/assessments/x/concept.md" }, // good
            },
        }),
    });
    const scan = await scanWorkspace("/proj", fs);
    assert.equal(scan.phases["commands/speckit.assess.intake"], undefined);
    assert.equal(scan.phases["commands/speckit.assess.define"], undefined);
    assert.equal(scan.phases["not-a-command/foo"], undefined);
    assert.equal(
        scan.phases["commands/speckit.assess.shape"]?.artifactPath,
        ".specify/assessments/x/concept.md",
    );
});


test("scanWorkspace prunes orphan cache entries whose extension is no longer installed", async () => {
    // Two branches collapsed: (a) extensions dir exists but is empty (user
    // uninstalled everything), (b) extensions dir doesn't exist at all
    // (never installed). Both must produce the same behavior: every
    // commands/* entry in the cache is pruned as an orphan.
    for (const extDirPresent of [true, false]) {
        const files = {
            "/proj/.specify": "__DIR__",
            "/proj/.speckit-wizard/artifact-targets.json": JSON.stringify({
                version: 1,
                entries: {
                    "commands/speckit.assess.intake": { writesTo: ".specify/assessments/<slug>/intake.md", source: "llm" },
                    "commands/speckit.assess.decide": { writesTo: ".specify/assessments/<slug>/decision.md", source: "llm" },
                },
            }),
        };
        if (extDirPresent) files["/proj/.specify/extensions"] = "__DIR__";
        const fs = makeFs(files);
        const scan = await scanWorkspace("/proj", fs);
        assert.equal(scan.phases["commands/speckit.assess.intake"], undefined, `extDirPresent=${extDirPresent}`);
        assert.equal(scan.phases["commands/speckit.assess.decide"], undefined, `extDirPresent=${extDirPresent}`);
    }
});

test("scanWorkspace keeps entries that match installed extension commands, prunes only the rest", async () => {
    const fs = makeFs({
        "/proj/.specify": "__DIR__",
        // Only `intake` is currently installed.
        "/proj/.specify/extensions/assess/commands/speckit.assess.intake.md": "# intake skill",
        "/proj/.speckit-wizard/artifact-targets.json": JSON.stringify({
            version: 1,
            entries: {
                "commands/speckit.assess.intake":   { writesTo: ".specify/assessments/<slug>/intake.md",   source: "llm" },
                // Orphan — its skill was removed but cache still has it.
                "commands/speckit.assess.research": { writesTo: ".specify/assessments/<slug>/research.md", source: "llm" },
            },
        }),
    });
    const scan = await scanWorkspace("/proj", fs);
    assert.equal(scan.phases["commands/speckit.assess.intake"]?.artifactPath, ".specify/assessments/<slug>/intake.md");
    assert.equal(scan.phases["commands/speckit.assess.research"], undefined);
});

test("scanWorkspace: empty workspace (no extensions, no cache) doesn't create phase entries or errors", async () => {
    // The "first launch, nothing installed" case — a canary for the trigger
    // timing. Nothing to hydrate, nothing to prune, no warnings.
    const fs = makeFs({});
    const scan = await scanWorkspace("/proj", fs);
    // No commands/* keys in phases.
    const cmdKeys = Object.keys(scan.phases).filter((k) => k.startsWith("commands/"));
    assert.deepEqual(cmdKeys, []);
    assert.deepEqual(scan.warnings, []);
});
