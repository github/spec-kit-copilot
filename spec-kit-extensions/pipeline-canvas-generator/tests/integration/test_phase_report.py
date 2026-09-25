"""Original-turn phase reporting is scoped to one configured run."""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

PACKAGE = Path(__file__).resolve().parents[2]
FIXTURES = PACKAGE / "tests" / "fixtures" / "composition"
sys.path.insert(0, str(PACKAGE / "scripts" / "lib"))

from compiler import compile_blueprint  # noqa: E402
from experience import default_document  # noqa: E402
from request import prepare_request  # noqa: E402
from staging import read_json  # noqa: E402


def captured_experience() -> dict:
    return {
        "schemaVersion": 1,
        "presentation": default_document(PACKAGE, "canvas-presentation"),
        "interactions": default_document(PACKAGE, "canvas-interactions"),
        "setup": default_document(PACKAGE, "canvas-setup"),
        "results": default_document(PACKAGE, "canvas-results"),
    }


class PhaseReportJourney(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.workspace = Path(directory.name)
        shutil.copytree(FIXTURES / "installed", self.workspace / ".specify")
        (self.workspace / ".specify" / "init-options.json").write_text(
            json.dumps({"integration": "copilot", "integrationOptions": "--skills"}), encoding="utf-8",
        )
        inventory = {
            "artifacts": read_json(FIXTURES / "mixed-stack.json"),
            "presets": read_json(FIXTURES / "installed-presets.json"),
            "extensions": read_json(FIXTURES / "installed-extensions.json"),
        }
        with patch("request._preflight"):
            request = prepare_request(
                self.workspace, ["speckit.plan", "speckit.analyze"],
                "my-canvas", "My Canvas", False, inventory=inventory,
                phase_outputs=[
                    {"commandName": "speckit.plan", "expectsArtifact": True, "outputPath": "specs/<slug>/plan.md"},
                    {"commandName": "speckit.analyze", "expectsArtifact": None, "outputPath": None},
                ],
            )
        self.target = self.workspace / "isolated-canvas"
        shutil.copytree(PACKAGE / "templates" / "generated-canvas", self.target)
        for name, content in {
            "pipeline.json": compile_blueprint(read_json(request)),
            "workflow-config.json": {
                "version": 1, "itemLabels": {}, "phaseArguments": {},
                "resultLabels": [], "clarificationTag": False,
            },
        }.items():
            (self.target / name).write_text(json.dumps(content), encoding="utf-8")
        for phase in ("plan", "analyze"):
            skill = self.workspace / ".github" / "skills" / f"speckit-{phase}" / "SKILL.md"
            skill.parent.mkdir(parents=True)
            skill.write_text(f"# {phase}\n", encoding="utf-8")
        source = (self.target / "extension.mjs").read_text(encoding="utf-8")
        source = source.replace('"@github/copilot-sdk/extension"', '"./mock-sdk.mjs"')
        for placeholder, replacement in (
            ("__EXTENSION_ID_JSON__", json.dumps("my-canvas")),
            ("__DISPLAY_NAME_JSON__", json.dumps("My Canvas")),
            ("__DESCRIPTION_JSON__", json.dumps("My Canvas workflow canvas.")),
        ):
            source = source.replace(placeholder, replacement)
        (self.target / "extension.mjs").write_text(source, encoding="utf-8")
        (self.target / "mock-sdk.mjs").write_text("""
globalThis.sent = [];
globalThis.events = [];
globalThis.handlers = {};
export const createCanvas = (definition) => { globalThis.canvas = definition; return definition; };
export const joinSession = async () => ({
    sessionId: "test-session",
    on(name, callback) { globalThis.handlers[name] = callback; },
    log: async () => {},
    send: async (input) => {
        if (globalThis.failNextSend) {
            globalThis.failNextSend = false;
            throw new Error('dispatch rejected');
        }
        globalThis.sent.push(input);
        if (globalThis.beforeSendResolve) await globalThis.beforeSendResolve(input);
        return `message-${globalThis.sent.length}`;
    },
    getEvents: async () => globalThis.events,
    rpc: { skills: { reload: async () => ({ errors: [], warnings: [] }) } },
});
""", encoding="utf-8")

    def run_node(self, script: str) -> subprocess.CompletedProcess[str]:
        result = subprocess.run(
            ["node", "--input-type=module", "-e", script],
            cwd=self.target, capture_output=True, text=True, timeout=30,
            env={**os.environ, "CANVAS_WORKSPACE": str(self.workspace)},
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return result

    def test_original_turn_only_for_report_source_and_bound_evidence(self) -> None:
        experience = captured_experience()
        experience["results"]["phases"] = {
            "speckit.plan": {
                "label": "Outcome", "values": [
                    {"id": "ready", "label": "Ready", "tone": "positive"},
                    {"id": "blocked", "label": "Blocked", "tone": "attention"},
                ], "source": {"kind": "phase-report"}, "summary": True,
            },
            "speckit.analyze": {
                "label": "Assessment", "values": [
                    {"id": "complete", "label": "Complete", "tone": "neutral"},
                ], "source": {"kind": "artifact-field", "field": "status"}, "summary": False,
            },
        }
        (self.target / "canvas-experience.json").write_text(json.dumps(experience), encoding="utf-8")
        result = self.run_node("""
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
await import('./extension.mjs');
const action = (name) => globalThis.canvas.actions.find((entry) => entry.name === name);
const inst = { instanceId: 'reporting-1', input: { cwd: process.env.CANVAS_WORKSPACE } };
const opened = await globalThis.canvas.open(inst);
const stateUrl = new URL('/api/state', opened.url);
stateUrl.searchParams.set('token', new URL(opened.url).searchParams.get('token'));
globalThis.beforeSendResolve = async ({ prompt }) => {
    const runId = /"phaseRunId":"([^"]+)"/.exec(prompt)?.[1];
    if (!runId) throw Error('Reporting run ID missing during dispatch');
    await action('report_phase_result').handler({
        instanceId: inst.instanceId, input: { phaseRunId: runId, resultId: 'ready' },
    });
    globalThis.beforeSendResolve = null;
};
const plan = await action('run_phase').handler({
    instanceId: inst.instanceId, input: { phase: '0:plan', itemId: '__new__', args: 'Original input' },
});
if (!plan.ok || !action('report_phase_result')) throw Error(`Phase/report action unavailable: ${JSON.stringify(plan)}`);
if (!globalThis.sent.length) throw Error(`Phase did not dispatch: ${JSON.stringify(plan)}`);
const prompt = globalThis.sent.at(-1).prompt;
if (!prompt.startsWith('/skill:speckit-plan Original input')
    || !prompt.includes('invoke_canvas_action') || !prompt.includes('report_phase_result')
    || !prompt.includes('reporting-1') || !prompt.includes('"ready"') || !prompt.includes('"blocked"')) {
    throw Error(`Incomplete original-turn context: ${prompt}`);
}
const statePath = join(process.env.CANVAS_WORKSPACE, '.speckit-canvas', 'phase-runs');
const stored = async () => JSON.parse(await readFile(join(statePath, (await readdir(statePath))[0]), 'utf8'));
let run = (await stored()).pending[0].runs[0];
const input = { phaseRunId: run.runId, resultId: 'ready' };
const report = (value, instanceId = inst.instanceId) =>
    action('report_phase_result').handler({ instanceId, input: value });
const repeated = await Promise.allSettled([report(input), report(input)]);
if (repeated.filter((entry) => entry.status === 'fulfilled').length !== 0) {
    throw Error('A second report for the same run was accepted');
}
await globalThis.canvas.open({ instanceId: 'another-instance', input: { cwd: process.env.CANVAS_WORKSPACE } });
try { await report(input, 'another-instance'); throw Error('Wrong canvas instance accepted'); }
catch (error) { if (error.message === 'Wrong canvas instance accepted') throw error; }
for (const value of [{ ...input, resultId: 'blocked' }, { ...input, resultId: 'unknown' }]) {
    try { await report(value); throw Error('Invalid report was accepted'); }
    catch (error) { if (error.message === 'Invalid report was accepted') throw error; }
}
run = (await stored()).pending[0].runs[0];
if (run.reporting.settledId !== null || run.reporting.resultId !== 'ready') {
    throw Error('Result settled before phase success');
}
const events = (id, success, summary = success ? 'Done' : '') => [
    { type: 'user.message', data: { messageId: id, interactionId: id } },
    { type: 'assistant.turn_start', data: { interactionId: id, turnId: id } },
    { type: 'session.task_complete', data: { success, summary } },
];
globalThis.events = events('message-1', true);
globalThis.handlers['session.idle']();
try { await report(input); throw Error('Idle session accepted a late report'); }
catch (error) { if (error.message === 'Idle session accepted a late report') throw error; }
if (!(await fetch(stateUrl)).ok) throw Error('State refresh failed');
run = (await stored()).pending[0].runs[0];
if (!run.completed || run.reporting.settledId !== 'ready'
    || !run.reporting.inputs || Object.keys(run.reporting.inputs).length !== 0) {
    throw Error(`Successful report was not settled with its input snapshot: ${JSON.stringify(run)}`);
}
try { await report(input); throw Error('Completed run accepted a repeat report'); }
catch (error) { if (error.message === 'Completed run accepted a repeat report') throw error; }
globalThis.failNextSend = true;
try {
    await action('run_phase').handler({
        instanceId: inst.instanceId, input: { phase: '0:plan', itemId: '__new__', args: 'Rejected rerun' },
    });
    throw Error('Rejected dispatch was accepted');
} catch (error) {
    if (error.message !== 'dispatch rejected') throw error;
}
if ((await stored()).pending[0].runs[0].runId !== input.phaseRunId) {
    throw Error('Failed dispatch lost the previous successful run');
}
const analyze = await action('run_phase').handler({
    instanceId: inst.instanceId, input: { phase: '1:analyze', itemId: '__new__', args: 'Inspect' },
});
if (!analyze.ok || !globalThis.sent.at(-1).prompt.startsWith('/skill:speckit-analyze Inspect')
    || globalThis.sent.at(-1).prompt.includes('report_phase_result')) {
    throw Error('Artifact-field phase received reporting context');
}
const rerun = await action('run_phase').handler({
    instanceId: inst.instanceId, input: { phase: '0:plan', itemId: '__new__', args: 'Rerun' },
});
if (!rerun.ok) throw Error('Rerun was not dispatched');
try { await report(input); throw Error('Stale report accepted'); }
catch (error) { if (error.message === 'Stale report accepted') throw error; }
run = (await stored()).pending[0].runs.find((entry) => entry.phase === '0:plan');
if (run.reporting.resultId !== null || run.reporting.settledId !== null) {
    throw Error('Old result carried into rerun');
}
await report({ phaseRunId: run.runId, resultId: 'blocked' });
globalThis.events = events('message-3', false);
globalThis.handlers['session.idle']();
if (!(await fetch(stateUrl)).ok) throw Error('State refresh failed');
run = (await stored()).pending[0].runs.find((entry) => entry.phase === '0:plan');
if (run.reporting.settledId !== null || run.error === null) throw Error('Failed phase settled result');
const missing = await action('run_phase').handler({
    instanceId: inst.instanceId, input: { phase: '0:plan', itemId: '__new__', args: 'No result' },
});
if (!missing.ok) throw Error('Missing-evidence phase was not dispatched');
globalThis.events = events('message-4', true, '');
globalThis.handlers['session.idle']();
if (!(await fetch(stateUrl)).ok) throw Error('State refresh failed');
run = (await stored()).pending[0].runs.find((entry) => entry.phase === '0:plan');
if (!run.completed || run.error !== null || run.reporting.settledId !== null) {
    throw Error('Missing evidence incorrectly failed or tagged a successful phase');
}
if (globalThis.sent.length !== 4) throw Error('Unexpected classification turn dispatched');
await globalThis.canvas.onClose({ instanceId: 'another-instance' });
const interrupted = await action('run_phase').handler({
    instanceId: inst.instanceId, input: { phase: '0:plan', itemId: '__new__', args: 'Interrupted' },
});
if (!interrupted.ok) throw Error('Final pending run was not dispatched');
const stale = (await stored()).pending[0].runs.find((entry) => entry.phase === '0:plan').runId;
await globalThis.canvas.onClose({ instanceId: inst.instanceId });
await globalThis.canvas.open(inst);
try {
    await report({ phaseRunId: stale, resultId: 'ready' });
    throw Error('A closed canvas instance accepted a stale report');
} catch (error) {
    if (error.message === 'A closed canvas instance accepted a stale report') throw error;
}
await globalThis.canvas.onClose({ instanceId: inst.instanceId });
""")
        self.assertIn("phase-result-missing", result.stderr)

    def test_unconfigured_phases_have_no_reporting_action_or_prompt(self) -> None:
        (self.target / "canvas-experience.json").write_text(json.dumps(captured_experience()), encoding="utf-8")
        self.run_node("""
await import('./extension.mjs');
if (globalThis.canvas.actions.some((action) => action.name === 'report_phase_result')) {
    throw Error('Unconfigured reporting action was registered');
}
const opened = await globalThis.canvas.open({
    instanceId: 'default-1', input: { cwd: process.env.CANVAS_WORKSPACE },
});
const run = globalThis.canvas.actions.find((action) => action.name === 'run_phase');
const result = await run.handler({
    instanceId: 'default-1', input: { phase: '0:plan', itemId: '__new__', args: 'Plain' },
});
if (!result.ok || globalThis.sent.at(-1).prompt !== '/skill:speckit-plan Plain') {
    throw Error('Unconfigured phase changed its original prompt');
}
await globalThis.canvas.onClose({ instanceId: 'default-1' });
""")

    def test_report_invalidates_when_declared_input_file_changes(self) -> None:
        experience = captured_experience()
        experience["results"]["phases"] = {
            "speckit.analyze": {
                "label": "Assessment", "values": [
                    {"id": "ready", "label": "Ready", "tone": "positive"},
                ], "source": {"kind": "phase-report"}, "summary": True,
            },
        }
        (self.target / "canvas-experience.json").write_text(json.dumps(experience), encoding="utf-8")
        self.run_node("""
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
await import('./extension.mjs');
const dir = join(process.env.CANVAS_WORKSPACE, 'specs', 'demo');
await mkdir(dir, { recursive: true });
const plan = join(dir, 'plan.md');
await writeFile(plan, '# Initial plan');
const inst = { instanceId: 'analyze-inputs', input: { cwd: process.env.CANVAS_WORKSPACE } };
const opened = await globalThis.canvas.open(inst);
const url = new URL('/api/state', opened.url);
url.searchParams.set('token', new URL(opened.url).searchParams.get('token'));
const action = (name) => globalThis.canvas.actions.find((entry) => entry.name === name);
const first = await (await fetch(url)).json();
if (!first.interactions?.progression) throw Error('Runtime interaction policy was not exposed to the UI');
const item = first.items.find((entry) => entry.slug === 'demo');
if (!item) throw Error('Declared plan artifact did not produce a workflow');
globalThis.beforeSendResolve = async ({ prompt }) => {
    const phaseRunId = /"phaseRunId":"([^"]+)"/.exec(prompt)?.[1];
    if (!phaseRunId) throw Error('Missing Analyze run ID');
    await action('report_phase_result').handler({
        instanceId: inst.instanceId, input: { phaseRunId, resultId: 'ready' },
    });
    globalThis.beforeSendResolve = null;
};
const sent = await action('run_phase').handler({
    instanceId: inst.instanceId, input: { phase: '1:analyze', itemId: item.id, args: 'Assess' },
});
if (!sent.ok) throw Error('Analyze did not dispatch');
globalThis.events = [
    { type: 'user.message', data: { messageId: 'message-1', interactionId: 'message-1' } },
    { type: 'assistant.turn_start', data: { interactionId: 'message-1', turnId: 'message-1' } },
    { type: 'session.task_complete', data: { success: true, summary: 'Ready' } },
];
globalThis.handlers['session.idle']();
const current = (await (await fetch(url)).json()).items.find((entry) => entry.slug === 'demo');
if (current.phases['1:analyze'].result?.id !== 'ready' || current.phases['1:analyze'].status !== 'completed') {
    throw Error(`Analyze did not settle: ${JSON.stringify(current.phases['1:analyze'])}`);
}
await writeFile(plan, '# Revised plan');
const changed = (await (await fetch(url)).json()).items.find((entry) => entry.slug === 'demo');
if (changed.phases['1:analyze'].status !== 'stale' || changed.phases['1:analyze'].result
    || changed.results.length) throw Error('Edited input retained the Analyze report');
await globalThis.canvas.onClose({ instanceId: inst.instanceId });
""")

    def test_unknown_artifact_is_run_bound_verified_and_suppressed_when_transient(self) -> None:
        (self.target / "canvas-experience.json").write_text(json.dumps(captured_experience()), encoding="utf-8")
        self.run_node("""
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
await import('./extension.mjs');
const dir = join(process.env.CANVAS_WORKSPACE, 'specs', 'demo');
await mkdir(dir, { recursive: true });
await writeFile(join(dir, 'plan.md'), '# Plan');
const artifact = 'specs/demo/analysis.md';
const inst = { instanceId: 'hint-1', input: { cwd: process.env.CANVAS_WORKSPACE } };
const opened = await globalThis.canvas.open(inst);
const url = new URL('/api/state', opened.url);
url.searchParams.set('token', new URL(opened.url).searchParams.get('token'));
const action = (name) => globalThis.canvas.actions.find((entry) => entry.name === name);
const item = (await (await fetch(url)).json()).items.find((entry) => entry.slug === 'demo');
if (!item || !action('report_phase_artifact')) throw Error('Hint reporting not available');
let runId;
globalThis.beforeSendResolve = async ({ prompt }) => {
    runId = /"phaseRunId":"([^"]+)"/.exec(prompt)?.[1];
    if (!prompt.includes('report_phase_artifact') || !runId) throw Error('Missing original-turn artifact instructions');
    const report = (path) => action('report_phase_artifact').handler({
        instanceId: inst.instanceId, input: { phaseRunId: runId, path },
    });
    for (const path of ['specs/other/analysis.md', artifact]) {
        try { await report(path); throw Error('Unverified artifact was accepted'); }
        catch (error) { if (error.message === 'Unverified artifact was accepted') throw error; }
    }
    await writeFile(join(dir, 'analysis.md'), '# Analyzed');
    await report(artifact);
    try { await report(artifact); throw Error('Duplicate artifact was accepted'); }
    catch (error) { if (error.message === 'Duplicate artifact was accepted') throw error; }
    globalThis.beforeSendResolve = null;
};
const dispatched = await action('run_phase').handler({
    instanceId: inst.instanceId, input: { phase: '1:analyze', itemId: item.id, args: 'Inspect' },
});
if (!dispatched.ok) throw Error(`Hint phase did not dispatch: ${JSON.stringify(dispatched)}`);
const state = async () => (await (await fetch(url)).json()).items.find((entry) => entry.id === item.id);
if ((await state()).phases['1:analyze'].artifact) throw Error('Artifact exposed before phase success');
globalThis.events = [
    { type: 'user.message', data: { messageId: 'message-1', interactionId: 'message-1' } },
    { type: 'assistant.turn_start', data: { interactionId: 'message-1', turnId: 'message-1' } },
    { type: 'session.task_complete', data: { success: true, summary: 'Done' } },
];
globalThis.handlers['session.idle']();
const settled = (await state()).phases['1:analyze'];
if (settled.artifact !== artifact) throw Error(`Verified artifact not shown after success: ${JSON.stringify(settled)}`);
const view = new URL('/api/artifact', url);
view.searchParams.set('token', url.searchParams.get('token'));
view.searchParams.set('path', artifact);
view.searchParams.set('phase', '1:analyze');
view.searchParams.set('itemId', item.id);
if ((await (await fetch(view)).json()).content !== '# Analyzed') throw Error('Reported artifact not viewable');
await unlink(join(dir, 'analysis.md'));
if ((await state()).phases['1:analyze'].artifact) throw Error('Deleted artifact still viewable');
if ((await fetch(view)).ok) throw Error('Deleted artifact endpoint succeeded');
await globalThis.canvas.onClose({ instanceId: inst.instanceId });
""")

        pipeline = json.loads((self.target / "pipeline.json").read_text(encoding="utf-8"))
        pipeline["pipeline"]["steps"][1]["artifact"] = {
            "outputPath": None, "persistent": False, "completionSignal": "transient",
        }
        (self.target / "pipeline.json").write_text(json.dumps(pipeline), encoding="utf-8")
        self.run_node("""
await import('./extension.mjs');
if (globalThis.canvas.actions.some((entry) => entry.name === 'report_phase_artifact')) {
    throw Error('Explicit no-artifact phase registered an artifact reporting action');
}
""")


if __name__ == "__main__":
    unittest.main()
