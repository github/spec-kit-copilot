"""Transferred canvases must not confuse disk files with foundation readiness."""

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


PACKAGE = Path(__file__).resolve().parents[2]
TEMPLATE = PACKAGE / "templates" / "generated-canvas"
FIXTURES = PACKAGE / "tests" / "fixtures" / "composition"

import sys  # noqa: E402

sys.path.insert(0, str(PACKAGE / "scripts" / "lib"))
from compiler import compile_blueprint  # noqa: E402
from contracts.handoff import default_profile, prepare_request  # noqa: E402
from staging import read_json  # noqa: E402


@unittest.skipUnless(shutil.which("node"), "Node.js is required for foundation checks")
class RecipientFoundationContracts(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.workspace = Path(directory.name)
        (self.workspace / ".specify").mkdir()
        (self.workspace / ".specify" / "init-options.json").write_text(
            json.dumps({"ai": "copilot", "ai_skills": True}), encoding="utf-8",
        )
        skill = self.workspace / ".github" / "skills" / "speckit-plan" / "SKILL.md"
        skill.parent.mkdir(parents=True)
        skill.write_text("# Plan skill\n", encoding="utf-8")

    def node(self, script: str) -> None:
        result = subprocess.run(
            ["node", "--input-type=module", "-e", script],
            cwd=TEMPLATE, capture_output=True, text=True, check=False, timeout=30,
            env={**os.environ, "FOUNDATION_WORKSPACE": str(self.workspace)},
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_compatible_versions_init_and_skills_all_required(self) -> None:
        self.node("""
import { inspectSetup } from './setup-runtime.mjs';
const setup = { requiresSpecKit: true, requiredSkills: [{ name: 'speckit-plan' }],
    presets: [], extensions: [] };
let version = 'specify 1.0.7';
let plugins = [{ name: 'spec-kit-copilot', version: '0.15.0', enabled: true }];
let reloadAvailable = true;
const probe = (refresh = true) => inspectSetup({
    cwd: process.env.FOUNDATION_WORKSPACE, setup, refresh,
    runSpecify: async (args) => {
        if (args.join(' ') !== '--version') throw Error('Unexpected Specify command');
        return version;
    },
    runCopilot: async (args) => {
        if (args.join(' ') !== 'plugin list --json') throw Error('Unexpected Copilot command');
        return JSON.stringify(plugins);
    },
    reloadAvailable,
});
const ready = await probe();
if (!ready.diskReady || !ready.checks.find((entry) => entry.id === 'specify-cli')?.ready
    || !ready.checks.find((entry) => entry.id === 'copilot-plugin')?.ready) {
    throw Error(`Compatible foundation blocked: ${JSON.stringify(ready)}`);
}
plugins.push({ name: 'spec-kit-copilot', version: '0.15.0', enabled: true, source: 'live' });
if (!(await probe()).diskReady) throw Error('Identical installed/live plugin records were rejected');
plugins.push({ name: 'spec-kit-copilot', version: '0.16.0', enabled: true });
if ((await probe()).diskReady) throw Error('Conflicting enabled plugin versions passed');
plugins = [{ name: 'spec-kit-copilot', version: '0.15.0', enabled: true }];
version = 'specify 0.11.0';
if ((await probe()).diskReady) throw Error('Incompatible Specify version passed');
version = 'specify 1.0.7';
plugins = [{ name: 'spec-kit-copilot', version: '0.14.0', enabled: true }];
if ((await probe()).diskReady) throw Error('Incompatible plugin passed');
plugins = [{ name: 'spec-kit-copilot', version: '0.15.0', enabled: false }];
if ((await probe()).diskReady) throw Error('Disabled plugin passed');
plugins = [{ name: 'spec-kit-copilot', version: '0.15.0', enabled: true }];
reloadAvailable = false;
if ((await probe()).diskReady) throw Error('Unavailable reload capability passed');
""")

    def test_invalid_init_and_missing_skills_block_without_mutation(self) -> None:
        self.node("""
import { inspectSetup, buildSetupPrompt } from './setup-runtime.mjs';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
const cwd = process.env.FOUNDATION_WORKSPACE;
const setup = { requiresSpecKit: true, requiredSkills: [{ name: 'speckit-plan' }],
    presets: [], extensions: [], requireInstallationApproval: false };
const options = join(cwd, '.specify', 'init-options.json');
const skill = join(cwd, '.github', 'skills', 'speckit-plan', 'SKILL.md');
const inspect = () => inspectSetup({
    cwd, setup, refresh: true, reloadAvailable: true,
    runSpecify: async () => 'specify 1.0.7',
    runCopilot: async () => JSON.stringify([
        { name: 'spec-kit-copilot', version: '0.15.0', enabled: true },
    ]),
});
await writeFile(options, '{bad json');
const invalid = await inspect();
if (invalid.diskReady || !invalid.checks.find((entry) => entry.id === 'spec-kit-init').message.includes('JSON')) {
    throw Error('Malformed init-options was silently treated as ready');
}
await writeFile(options, JSON.stringify({ ai: 'copilot', ai_skills: false }));
if ((await inspect()).diskReady) throw Error('Non-skills Copilot init passed');
await writeFile(options, JSON.stringify({ ai: 'copilot', ai_skills: true }));
await unlink(skill);
if ((await inspect()).diskReady) throw Error('Missing required skill passed');
const prompt = buildSetupPrompt({ setup, instanceId: 'example' });
if (!prompt.includes('explicit destination-user confirmation')
    || !prompt.includes('--force --integration copilot --integration-options="--skills"')
    || !prompt.includes('If confirmation is denied, stop without initializing')) {
    throw Error('Initialization warning/cancellation is missing');
}
if ((await readFile(options, 'utf8')).includes('initialized by test')) throw Error('Inspection mutated init');
""")

    def test_init_requires_protected_destination_confirmation(self) -> None:
        (self.workspace / ".specify" / "init-options.json").unlink()
        shutil.copytree(FIXTURES / "installed", self.workspace / ".specify", dirs_exist_ok=True)
        inventory = {
            "artifacts": read_json(FIXTURES / "mixed-stack.json"),
            "presets": read_json(FIXTURES / "installed-presets.json"),
            "extensions": read_json(FIXTURES / "installed-extensions.json"),
        }
        with patch("request._preflight"):
            request = prepare_request(
                self.workspace, ["speckit.plan"], "my-canvas", "My Canvas",
                False, inventory=inventory,
            )
        target = self.workspace / "isolated-canvas"
        shutil.copytree(TEMPLATE, target)
        (target / "pipeline.json").write_text(
            json.dumps(compile_blueprint(read_json(request))), encoding="utf-8",
        )
        (target / "canvas-experience.json").write_text(
            json.dumps(default_profile(PACKAGE)), encoding="utf-8",
        )
        (target / "workflow-config.json").write_text(
            json.dumps({"version": 1, "itemLabels": {}, "phaseArguments": {},
                        "resultLabels": [], "clarificationTag": False}), encoding="utf-8",
        )
        source = (target / "extension.mjs").read_text(encoding="utf-8")
        source = source.replace('"@github/copilot-sdk/extension"', '"./mock-sdk.mjs"')
        for token, value in (
            ("__EXTENSION_ID_JSON__", "my-canvas"),
            ("__DISPLAY_NAME_JSON__", "My Canvas"),
            ("__DESCRIPTION_JSON__", "My Canvas workflow canvas."),
        ):
            source = source.replace(token, json.dumps(value))
        (target / "extension.mjs").write_text(source, encoding="utf-8")
        (target / "mock-sdk.mjs").write_text("""
globalThis.sent = [];
export const createCanvas = (definition) => { globalThis.canvas = definition; return definition; };
export const joinSession = async () => ({
    on() {}, log: async () => {},
    send: async (input) => { globalThis.sent.push(input); return 'message-id'; },
    rpc: { skills: { reload: async () => ({ errors: [], warnings: [] }) } },
});
""", encoding="utf-8")
        script = """
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
await import('./extension.mjs');
const opened = await globalThis.canvas.open({
    instanceId: 'init-test', input: { cwd: process.env.FOUNDATION_WORKSPACE },
});
if (globalThis.sent.length) throw Error('Setup dispatched before init confirmation');
const stateUrl = new URL('/api/state', opened.url);
stateUrl.searchParams.set('token', new URL(opened.url).searchParams.get('token'));
const state = async () => (await (await fetch(stateUrl)).json()).setup;
let status = await state();
if (!status.initialization?.required || !status.initialization?.challenge
    || !status.initialization.message.includes('--force')) {
    throw Error(`Missing protected initialization warning: ${JSON.stringify(status)}`);
}
const phase = globalThis.canvas.actions.find((entry) => entry.name === 'run_phase');
const blocked = await phase.handler({
    instanceId: 'init-test', input: { phase: '0:plan', itemId: '__new__', args: 'No init' },
});
if (blocked.ok || blocked.code !== 'initialization_confirmation_required') {
    throw Error(`Phase bypassed init confirmation: ${JSON.stringify(blocked)}`);
}
const confirm = async (action, challenge) => {
    const url = new URL('/api/init-confirmation', stateUrl);
    url.searchParams.set('token', stateUrl.searchParams.get('token'));
    const response = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, challenge }),
    });
    return { status: response.status, body: await response.json() };
};
const deferred = await confirm('defer', status.initialization.challenge);
const afterDecline = await state();
if (globalThis.sent.length || afterDecline.initialization?.state !== 'deferred') {
    throw Error(`Declining initialization dispatched setup: ${JSON.stringify({
        deferred, afterDecline, sent: globalThis.sent.length,
    })}`);
}
if ((await confirm('accept', status.initialization.challenge)).status !== 400
    || globalThis.sent.length) throw Error('Stale init confirmation was accepted');
status = await state();
const accepted = await confirm('accept', status.initialization.challenge);
if (accepted.status !== 200 || globalThis.sent.length !== 1
    || !globalThis.sent[0].prompt.includes('--integration-options="--skills"')
    || globalThis.sent[0].prompt.includes('require explicit destination-user confirmation before invoking')) {
    throw Error(`Approved init did not dispatch once: ${JSON.stringify(accepted)}`);
}
await writeFile(join(process.env.FOUNDATION_WORKSPACE, '.specify', 'init-options.json'),
    JSON.stringify({ ai: 'copilot', ai_skills: true }));
const reloaded = await globalThis.canvas.actions.find((entry) => entry.name === 'reloadSessionSkills')
    .handler({ instanceId: 'init-test', input: {} });
if (!reloaded.ok || !(await state()).ready) {
    throw Error(`Reprobe after approved initialization did not become ready: ${JSON.stringify(reloaded)}`);
}
await globalThis.canvas.onClose({ instanceId: 'init-test' });
"""
        result = subprocess.run(
            ["node", "--input-type=module", "-e", script],
            cwd=target, capture_output=True, text=True, check=False, timeout=45,
            env={**os.environ, "FOUNDATION_WORKSPACE": str(self.workspace)},
        )
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
