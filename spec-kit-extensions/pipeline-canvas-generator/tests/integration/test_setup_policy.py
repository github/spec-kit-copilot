"""Recipient setup must verify the captured package, not just its id."""

import hashlib
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
FIXTURE = PACKAGE / "tests" / "fixtures" / "composition" / "installed" / "extensions" / "runtime-assess"
FIXTURES = PACKAGE / "tests" / "fixtures" / "composition"

import sys  # noqa: E402

sys.path.insert(0, str(PACKAGE / "scripts" / "lib"))
from compiler import compile_blueprint  # noqa: E402
from contracts.handoff import default_profile, prepare_request  # noqa: E402
from staging import read_json  # noqa: E402


@unittest.skipUnless(shutil.which("node"), "Node.js is required for setup checks")
class RecipientSetupPolicyContracts(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.workspace = Path(temporary.name)
        (self.workspace / ".specify" / "extensions").mkdir(parents=True)
        (self.workspace / ".specify" / "init-options.json").write_text(
            json.dumps({"ai": "copilot", "ai_skills": True}), encoding="utf-8",
        )
        shutil.copytree(FIXTURE, self.workspace / ".specify" / "extensions" / "runtime-assess")
        (self.workspace / ".specify" / "extensions" / ".registry").write_text(json.dumps({
            "schema_version": "1.0",
            "extensions": {"runtime-assess": {
                "version": "0.1.0", "source": "local", "enabled": True, "priority": 10,
            }},
        }), encoding="utf-8")
        skill = self.workspace / ".github" / "skills" / "speckit-bug-assess" / "SKILL.md"
        skill.parent.mkdir(parents=True)
        skill.write_text("# Bug assess\n", encoding="utf-8")

    def test_version_source_priority_and_partial_installation_block_readiness(self) -> None:
        script = """
import { inspectSetup, buildSetupPrompt } from './setup-runtime.mjs';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
const cwd = process.env.SETUP_WORKSPACE;
const manifest = join(cwd, '.specify', 'extensions', 'runtime-assess', 'extension.yml');
const setup = {
    requireInstallationApproval: true, requiresSpecKit: true,
    requiredSkills: [{ name: 'speckit-bug-assess', sha256: process.env.SETUP_SKILL_SHA }],
    presets: [], extensions: [{
        kind: 'extension', id: 'runtime-assess', version: '0.1.0', enabled: true,
        priority: 10, precedence: 0, installedSource: { kind: 'local' },
        manifestSha256: process.env.SETUP_MANIFEST_SHA,
    }],
};
let records = [{
    id: 'runtime-assess', version: '0.1.0', enabled: true, priority: 10,
    source: { kind: 'local' },
}];
const probe = async () => inspectSetup({
    cwd, setup, refresh: true, reloadAvailable: true,
    runSpecify: async (args) => {
        if (args.join(' ') === '--version') return 'specify 1.0.7';
        if (args.join(' ') === 'extension list --json') return JSON.stringify(records);
        throw Error(`Unexpected Specify call: ${args.join(' ')}`);
    },
    runCopilot: async () => JSON.stringify([
        { name: 'spec-kit-copilot', version: '0.15.0', enabled: true },
    ]),
});
const baseline = await probe();
if (!baseline.diskReady) throw Error(`Captured package blocked: ${JSON.stringify(baseline)}`);
const prompt = buildSetupPrompt({ setup, instanceId: 'test', installationApproved: true });
if (!prompt.includes('Do not install a missing local-only or unavailable source by id')
    || !prompt.includes('0.1.0') || !prompt.includes(process.env.SETUP_MANIFEST_SHA)) {
    throw Error('Setup prompt permits a source substitution or omits captured provenance');
}
const unapproved = buildSetupPrompt({
    setup: { ...setup, requireInstallationApproval: false }, instanceId: 'test',
});
if (!unapproved.includes('No runtime package installation was authorized')
    || unapproved.includes('administrator already approved')) {
    throw Error('Standalone setup falsely inferred Wizard administrator approval');
}
records[0].version = '0.2.0';
if ((await probe()).diskReady) throw Error('Wrong package version passed');
records[0].version = '0.1.0';
records[0].source = { kind: 'git', url: 'https://example.org/other' };
const substituted = await probe();
if (substituted.diskReady || substituted.contributions[0].identityReady) {
    throw Error('Substituted package source passed');
}
records[0].source = { kind: 'local' };
const original = await readFile(manifest, 'utf8');
await writeFile(manifest, original + '\\n# changed source\\n');
if ((await probe()).diskReady) throw Error('Changed installed manifest passed');
await writeFile(manifest, original);
records[0].priority = 20;
const reprioritize = await probe();
if (reprioritize.diskReady || !reprioritize.contributions[0].identityReady) {
    throw Error('Priority mismatch incorrectly changed package identity');
}
records[0].priority = 10;
const skill = join(cwd, '.github', 'skills', 'speckit-bug-assess', 'SKILL.md');
const skillContent = await readFile(skill, 'utf8');
await writeFile(skill, '# Different skill\\n');
if ((await probe()).diskReady) throw Error('Modified required skill passed');
await writeFile(skill, skillContent);
records = [];
const inconsistent = await probe();
if (inconsistent.contributions[0].installationState !== 'unverified') {
    throw Error('Registry/CLI disagreement was treated as a missing install');
}
await unlink(manifest);
await writeFile(join(cwd, '.specify', 'extensions', '.registry'),
    JSON.stringify({ schema_version: '1.0', extensions: {} }));
const missing = await probe();
if (missing.diskReady || missing.contributions[0].installationState !== 'missing') {
    throw Error(`Missing package was not reported: ${JSON.stringify(missing)}`);
}
"""
        result = subprocess.run(
            ["node", "--input-type=module", "-e", script], cwd=TEMPLATE,
            capture_output=True, text=True, check=False, timeout=30,
            env={
                **os.environ, "SETUP_WORKSPACE": str(self.workspace),
                "SETUP_MANIFEST_SHA": hashlib.sha256((
                    self.workspace / ".specify/extensions/runtime-assess/extension.yml"
                ).read_bytes()).hexdigest(),
                "SETUP_SKILL_SHA": hashlib.sha256((
                    self.workspace / ".github/skills/speckit-bug-assess/SKILL.md"
                ).read_bytes()).hexdigest(),
            },
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_external_prompt_and_automatic_dispatch_boundaries(self) -> None:
        shutil.copytree(FIXTURES / "installed", self.workspace / ".specify", dirs_exist_ok=True)
        inventory = {
            "artifacts": read_json(FIXTURES / "mixed-stack.json"),
            "presets": read_json(FIXTURES / "installed-presets.json"),
            "extensions": read_json(FIXTURES / "installed-extensions.json"),
        }
        with patch("request._preflight"):
            request = prepare_request(
                self.workspace, ["speckit.bug.assess"], "policy-canvas", "Policy Canvas",
                False, inventory=inventory,
            )
        blueprint = compile_blueprint(read_json(request))
        blueprint["setup"]["extensions"][0]["installedSource"] = {
            "kind": "archive", "url": "https://example.org/runtime-assess.zip",
        }
        second = json.loads(json.dumps(blueprint["setup"]["extensions"][0]))
        second.update({
            "id": "runtime-second", "precedence": 1,
            "manifestPath": ".specify/extensions/runtime-second/extension.yml",
            "installedSource": {
                "kind": "archive", "url": "https://example.org/runtime-second.zip",
            },
        })
        blueprint["setup"]["extensions"].append(second)
        (self.workspace / ".specify" / "extensions" / ".registry").write_text(
            json.dumps({"schema_version": "1.0", "extensions": {}}), encoding="utf-8",
        )
        shutil.rmtree(self.workspace / ".specify" / "extensions" / "runtime-assess")
        for mode in ("external", "prompt", "automatic", "drift", "unportable"):
            with self.subTest(mode=mode):
                if mode == "drift":
                    shutil.copytree(FIXTURE, self.workspace / ".specify/extensions/runtime-assess")
                    (self.workspace / ".specify/extensions/.registry").write_text(
                        json.dumps({"schema_version": "1.0", "extensions": {
                            "runtime-assess": {
                                "version": "0.1.0", "source": "local",
                                "enabled": True, "priority": 10,
                            },
                        }}), encoding="utf-8",
                    )
                target = self.workspace / f"canvas-{mode}"
                shutil.copytree(TEMPLATE, target)
                mode_blueprint = json.loads(json.dumps(blueprint))
                if mode == "unportable":
                    mode_blueprint["setup"]["extensions"][0]["installedSource"] = {
                        "kind": "local",
                    }
                    (self.workspace / ".specify/extensions/.registry").write_text(
                        json.dumps({"schema_version": "1.0", "extensions": {}}),
                        encoding="utf-8",
                    )
                    shutil.rmtree(self.workspace / ".specify/extensions/runtime-assess")
                (target / "pipeline.json").write_text(json.dumps(mode_blueprint), encoding="utf-8")
                experience = default_profile(PACKAGE)
                experience["setup"]["installationMode"] = (
                    "automatic" if mode in ("drift", "unportable") else mode
                )
                (target / "canvas-experience.json").write_text(
                    json.dumps(experience), encoding="utf-8",
                )
                (target / "workflow-config.json").write_text(json.dumps({
                    "version": 1, "itemLabels": {}, "phaseArguments": {},
                    "resultLabels": [], "clarificationTag": False,
                }), encoding="utf-8")
                source = (target / "extension.mjs").read_text(encoding="utf-8")
                source = source.replace('"@github/copilot-sdk/extension"', '"./mock-sdk.mjs"')
                for token, value in (
                    ("__EXTENSION_ID_JSON__", "policy-canvas"),
                    ("__DISPLAY_NAME_JSON__", "Policy Canvas"),
                    ("__DESCRIPTION_JSON__", "Policy Canvas workflow."),
                ):
                    source = source.replace(token, json.dumps(value))
                (target / "extension.mjs").write_text(source, encoding="utf-8")
                (target / "mock-sdk.mjs").write_text("""
globalThis.sent = [];
export const createCanvas = (definition) => { globalThis.canvas = definition; return definition; };
export const joinSession = async () => ({
    on() {}, log: async () => {},
    send: async (input) => {
        globalThis.sent.push(input);
        if (process.env.HOST_DENY === '1') throw Error('Host denied dispatch');
        return 'message-id';
    },
    rpc: { skills: { reload: async () => ({ errors: [], warnings: [] }) } },
});
""", encoding="utf-8")
                script = """
await import('./extension.mjs');
const mode = process.env.INSTALL_MODE;
const opened = await globalThis.canvas.open({
    instanceId: 'policy-test', input: { cwd: process.env.SETUP_WORKSPACE },
});
const url = new URL('/api/state', opened.url);
url.searchParams.set('token', new URL(opened.url).searchParams.get('token'));
const state = async () => (await (await fetch(url)).json()).setup;
const setupAction = globalThis.canvas.actions.find((entry) => entry.name === 'setup_workflow');
if (mode === 'external') {
    if (globalThis.sent.length) throw Error('External mode dispatched on open');
    const outcome = await setupAction.handler({ instanceId: 'policy-test', input: {} });
    if (outcome.ok || globalThis.sent.length) throw Error(`External mode installed: ${JSON.stringify(outcome)}`);
} else if (mode === 'prompt') {
    const status = await state();
    if (!status.approval?.required || status.approval.components?.length !== 2 || globalThis.sent.length) {
        throw Error(`Prompt mode skipped approval: ${JSON.stringify(status)}`);
    }
    const approval = new URL('/api/installation-approval', url);
    approval.searchParams.set('token', url.searchParams.get('token'));
    const partial = await fetch(approval, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            action: 'accept', fingerprint: status.approval.fingerprint,
            challenge: status.approval.challenge, selectedComponents: ['runtime-assess'],
        }),
    });
    if (partial.status !== 400 || globalThis.sent.length) {
        throw Error('A partial component approval dispatched setup');
    }
    const declined = await fetch(approval, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            action: 'defer', fingerprint: status.approval.fingerprint,
            challenge: status.approval.challenge,
        }),
    });
    if (declined.status !== 200 || globalThis.sent.length) {
        throw Error('Declining complete installation dispatched setup');
    }
    const accepted = await fetch(approval, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            action: 'accept', fingerprint: status.approval.fingerprint,
            challenge: status.approval.challenge,
        }),
    });
    if (accepted.status !== 200 || globalThis.sent.length !== 1
        || !globalThis.sent[0].prompt.includes('runtime-assess')
        || !globalThis.sent[0].prompt.includes('runtime-second')
        || (await state()).ready) {
        throw Error(`Prompt approval did not dispatch once: ${accepted.status}, ${globalThis.sent.length}`);
    }
} else if (mode === 'drift') {
    const outcome = await setupAction.handler({ instanceId: 'policy-test', input: {} });
    if (outcome.ok || outcome.code !== 'setup_provenance_mismatch' || globalThis.sent.length) {
        throw Error(`Source drift dispatched setup: ${JSON.stringify(outcome)}`);
    }
} else if (mode === 'unportable') {
    const outcome = await setupAction.handler({ instanceId: 'policy-test', input: {} });
    if (outcome.ok || outcome.code !== 'setup_source_unavailable' || globalThis.sent.length) {
        throw Error(`Unportable source dispatched setup: ${JSON.stringify(outcome)}`);
    }
} else {
    for (let attempt = 0; attempt < 40 && !globalThis.sent.length; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const status = await state();
    if (globalThis.sent.length !== 1 || !status.state.match(/failed/)
        || !status.message.includes('Host denied dispatch')) {
        throw Error(`Automatic mode did not surface denied host dispatch: ${JSON.stringify({ status, sent: globalThis.sent.length })}`);
    }
}
await globalThis.canvas.onClose({ instanceId: 'policy-test' });
"""
                result = subprocess.run(
                    ["node", "--input-type=module", "-e", script], cwd=target,
                    capture_output=True, text=True, check=False, timeout=45,
                    env={
                        **os.environ, "SETUP_WORKSPACE": str(self.workspace),
                        "INSTALL_MODE": mode, "HOST_DENY": str(int(mode == "automatic")),
                    },
                )
                self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
