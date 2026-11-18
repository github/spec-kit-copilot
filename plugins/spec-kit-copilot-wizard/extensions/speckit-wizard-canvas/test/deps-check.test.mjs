import assert from "node:assert/strict";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

test("runtime lockfiles do not pin Microsoft feed URLs", async () => {
    for (const url of [new URL("../package-lock.json", import.meta.url),
        new URL("../../speckit-canvas-designer/package-lock.json", import.meta.url)]) {
        const lock = await readFile(url, "utf8");
        assert.doesNotMatch(lock, /ms-feed|packagefeedproxy|pkgs\.visualstudio\.com/i);
    }
    const wizard = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url)));
    assert.equal(wizard.packages["node_modules/@playwright/test"].dev, true);
});

test("Wizard setup installs both extension dependencies without dev packages", async (t) => {
    const root = await mkdtemp(join(tmpdir(), "speckit-wizard-deps-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const env = join(root, "speckit-wizard-canvas", "env");
    const designer = join(root, "speckit-canvas-designer");
    const bin = join(root, "bin");
    await mkdir(env, { recursive: true });
    await mkdir(designer);
    await mkdir(bin);
    for (const name of ["deps-check.mjs", "deps-error-classifier.mjs"]) {
        await copyFile(new URL(`../env/${name}`, import.meta.url), join(env, name));
    }
    const fakeNpm = join(bin, "fake-npm.mjs");
    await writeFile(fakeNpm, `
        import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
        import { basename, join } from "node:path";
        const name = basename(process.cwd()) === "speckit-canvas-designer"
            ? "es-module-lexer" : "js-yaml";
        appendFileSync(process.env.FAKE_NPM_LOG, JSON.stringify({
            name, cwd: process.cwd(), args: process.argv.slice(2),
        }) + "\\n");
        if (process.env.FAKE_NPM_FAIL === name) {
            console.error("E403: registry rejected " + name);
            process.exit(1);
        }
        const path = join(process.cwd(), "node_modules", name);
        mkdirSync(path, { recursive: true });
        writeFileSync(join(path, "package.json"), JSON.stringify({ name }));
    `);
    await writeFile(join(bin, "npm.cmd"), '@echo off\r\nnode "%~dp0fake-npm.mjs" %*\r\n');
    await writeFile(join(bin, "npm"), '#!/bin/sh\nexec node "$(dirname "$0")/fake-npm.mjs" "$@"\n');
    await chmod(join(bin, "npm"), 0o755);
    const { checkDeps, installDeps } = await import(pathToFileURL(join(env, "deps-check.mjs")).href);
    const originalPath = process.env.PATH;
    process.env.PATH = bin + delimiter + originalPath;
    process.env.FAKE_NPM_LOG = join(root, "npm.log");
    try {
        const missing = await checkDeps();
        assert.deepEqual(missing.missing, ["js-yaml", "es-module-lexer"]);
        assert.equal((await installDeps(missing.missing)).ok, true);
        assert.equal((await checkDeps()).ready, true);
        const calls = (await readFile(process.env.FAKE_NPM_LOG, "utf8")).trim().split("\n")
            .map((line) => JSON.parse(line));
        assert.deepEqual(calls.map((call) => [call.name, call.cwd]), [
            ["js-yaml", join(root, "speckit-wizard-canvas")],
            ["es-module-lexer", designer],
        ]);
        for (const call of calls) {
            assert.deepEqual(call.args, ["ci", "--omit=dev", "--no-audit", "--no-fund", "--silent"]);
        }
        await rm(join(designer, "node_modules", "es-module-lexer", "package.json"));
        process.env.FAKE_NPM_FAIL = "es-module-lexer";
        const failed = await installDeps((await checkDeps()).missing);
        assert.equal(failed.ok, false);
        assert.equal(failed.packageName, "es-module-lexer");
        assert.equal(failed.extDir, designer);
        assert.equal(failed.classified.code, "HTTP_403");
    } finally {
        process.env.PATH = originalPath;
        delete process.env.FAKE_NPM_LOG;
        delete process.env.FAKE_NPM_FAIL;
    }
});
