// Live-CLI integration tests for the artifact adapter.
//
// These tests invoke the real `specify` binary and assert the wizard-shape
// contract holds. They complement the fixture-based unit tests in
// artifact-cli.test.mjs by catching drift if the CLI's output shape changes
// underneath the wizard.
//
// Both tests skip cleanly when `specify` is not on PATH (CI without the CLI
// installed). Local dev and any CI job that installs the CLI will run them.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCompositionFromCli } from "../composition/artifact-cli.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "fixtures");

function hasSpecifyCli() {
    try {
        execFileSync("specify", ["--version"], {
            shell: process.platform === "win32",
            stdio: "ignore",
        });
        return true;
    } catch {
        return false;
    }
}

const skipLive = !hasSpecifyCli();

describe("artifact-cli — live CLI", { skip: skipLive }, () => {
    test("builds composition from real `specify artifact` output on a scaffolded workspace", async () => {
        const root = mkdtempSync(join(tmpdir(), "speckit-live-"));
        try {
            mkdirSync(join(root, ".specify"), { recursive: true });
            writeFileSync(join(root, ".specify", "config.yml"), "version: 1\n");

            const comp = await buildCompositionFromCli({
                workspaceRoot: root,
                presetItems: [],
                extensionItems: [],
            });

            assert.ok(Array.isArray(comp.artifacts));
            assert.ok(comp.artifacts.length > 0, "expected at least one built-in artifact");

            for (const a of comp.artifacts) {
                assert.ok(typeof a.id === "string" && a.id.length > 0, "id");
                assert.ok(["command", "template", "script", "hook"].includes(a.kind), `kind=${a.kind}`);
                assert.ok(Array.isArray(a.stack) && a.stack.length > 0, "stack");
                for (const layer of a.stack) {
                    assert.ok(
                        ["core", "project", "preset", "extension"].includes(layer.layer),
                        `layer=${layer.layer}`,
                    );
                    assert.equal(typeof layer.active, "boolean");
                    assert.equal(typeof layer.hidden, "boolean");
                }
                // CLI top-of-stack invariant: exactly one active per artifact.
                assert.equal(
                    a.stack.filter((l) => l.active).length,
                    1,
                    `expected exactly one active layer on ${a.id}`,
                );
            }
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});

// Fixture drift detection — separate from the live test above so it can run
// even without `specify` on PATH, so long as a captured snapshot exists.
// Regenerate the snapshot with:
//   specify artifact list --json > test/fixtures/live-cli-list.json
//   specify artifact info <id> --json (see capture note in that dir)
describe("artifact-cli — fixture drift", () => {
    const listPath = join(FIXTURES_DIR, "live-cli-list.json");
    const infoPath = join(FIXTURES_DIR, "live-cli-info.json");
    const snapshotAvailable = existsSync(listPath) && existsSync(infoPath);

    test("captured list rows match the field set our shape mapper reads", { skip: !snapshotAvailable }, () => {
        const rows = JSON.parse(readFileSync(listPath, "utf8"));
        assert.ok(Array.isArray(rows) && rows.length > 0);
        const requiredListFields = ["id", "name", "kind", "description"];
        for (const row of rows) {
            for (const f of requiredListFields) {
                assert.ok(Object.hasOwn(row, f), `list row ${row.id ?? "?"} missing field ${f}`);
            }
            assert.ok(["command", "template", "script"].includes(row.kind), `unexpected kind ${row.kind}`);
        }
    });

    test("captured info rows carry the fields the wizard reads (id/name/kind/description/stack[])", { skip: !snapshotAvailable }, () => {
        const infoMap = JSON.parse(readFileSync(infoPath, "utf8"));
        const infoRows = Object.values(infoMap);
        assert.ok(infoRows.length > 0, "expected at least one captured info row");

        const requiredInfoFields = ["id", "name", "kind", "description", "stack"];
        const requiredStackFields = [
            "id",
            "layer",
            "sourceId",
            "presetId",
            "presetName",
            "strategy",
            "active",
            "hidden",
            "manifestPath",
            "lookupId",
        ];
        for (const info of infoRows) {
            for (const f of requiredInfoFields) {
                assert.ok(Object.hasOwn(info, f), `info ${info.id ?? "?"} missing field ${f}`);
            }
            assert.ok(Array.isArray(info.stack) && info.stack.length > 0);
            for (const layer of info.stack) {
                for (const f of requiredStackFields) {
                    assert.ok(Object.hasOwn(layer, f), `stack layer on ${info.id} missing field ${f}`);
                }
                // `layer` may be null (built-in) or a string. Guard vocabulary either way.
                if (layer.layer !== null) {
                    assert.ok(
                        ["preset", "extension", "project"].includes(layer.layer),
                        `unexpected non-null layer value ${layer.layer}`,
                    );
                }
                assert.equal(typeof layer.active, "boolean");
                assert.equal(typeof layer.hidden, "boolean");
            }
            // Same top-of-stack invariant as the live test.
            assert.equal(
                info.stack.filter((l) => l.active).length,
                1,
                `expected exactly one active layer on ${info.id}`,
            );
        }
    });
});
