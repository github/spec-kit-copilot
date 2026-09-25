"""Result and progress are derived from settled current runs, not event totals."""

import shutil
import subprocess
import unittest
from pathlib import Path


PACKAGE = Path(__file__).resolve().parents[2]
TEMPLATE = PACKAGE / "templates" / "generated-canvas"


@unittest.skipUnless(shutil.which("node"), "Node.js is required for result contracts")
class CurrentResultSummary(unittest.TestCase):
    def node(self, cwd: Path, script: str) -> None:
        result = subprocess.run(
            ["node", "--input-type=module", "-e", script], cwd=cwd,
            capture_output=True, text=True, check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_reported_result_rerun_staleness_and_artifact_field(self) -> None:
        self.node(TEMPLATE, """
import { currentPhaseSummary } from './runtime/phase-runs.mjs';
import { phaseResult } from './runtime/phase-results.mjs';
const steps = [
    { instanceKey: '0:plan', commandName: 'speckit.plan', artifact: { outputPath: 'plan.md' } },
    { instanceKey: '1:tasks', commandName: 'speckit.tasks', artifact: { outputPath: 'tasks.md' } },
];
const config = { results: {
    phases: {
        'speckit.plan': { source: { kind: 'phase-report' }, summary: true,
            values: [{ id: 'good', label: 'Ready', tone: 'positive' }] },
        'speckit.tasks': { source: { kind: 'artifact-field', field: 'taskStatus' },
            summary: true, values: [{ id: 'done', label: 'Complete', tone: 'positive' }] },
    },
} };
const bindings = new Map(steps.map((step) => [step.instanceKey, phaseResult(config, step.commandName)]));
const evidence = {
    '0:plan': { artifact: 'plan.md', content: '# Plan', mtimeMs: 1100, clarificationCount: 0 },
    '1:tasks': { artifact: 'tasks.md', content: '---\\ntaskStatus: done\\n---\\n- [x] One\\n- [ ] Two\\n',
        mtimeMs: 2000, clarificationCount: 0 },
};
const plan = { phase: '0:plan', runId: 'plan', sequence: 1, completed: true,
    error: null, startedAt: 1000, reporting: { settledId: 'good' } };
const tasks = { phase: '1:tasks', runId: 'tasks', sequence: 2, completed: true,
    error: null, startedAt: 1900 };
const report = () => currentPhaseSummary(steps, evidence, [plan, tasks], bindings, { showProgress: true });
let result = report();
if (result.results.length !== 2 || result.progress.total !== 2 || result.progress.complete !== 1
    || result.phases['1:tasks'].result.id !== 'done') throw Error('Evidence not summarized');
plan.sequence = 3;
result = report();
if (result.phases['1:tasks'].status !== 'stale' || result.results.length !== 1)
    throw Error('Upstream rerun retained stale downstream result');
tasks.sequence = 4;
evidence['1:tasks'].clarificationCount = 1;
result = report();
if (result.results.length !== 1 || result.clarificationCount !== 1
    || result.phases['1:tasks'].result !== null) throw Error('Unresolved clarification retained result');
evidence['1:tasks'].clarificationCount = 0;
evidence['1:tasks'].content = '---\\ntaskStatus: unknown\\n---\\n- [x] One';
if (report().phases['1:tasks'].result !== null) throw Error('Unknown artifact field inferred a result');
evidence['1:tasks'].content = '---\\ntaskStatus: done\\n---\\n';
evidence['1:tasks'].mtimeMs = 100;
if (report().phases['1:tasks'].result !== null) throw Error('Old artifact reported as current');
plan.reporting.settledId = null;
if (report().phases['0:plan'].result !== null) throw Error('Missing report invented a tag');
""")

    def test_native_phase_ui_preserves_result_and_confirmation(self) -> None:
        app = (TEMPLATE / "ui" / "app.js").read_text(encoding="utf-8")
        self.assertIn("renderPhaseNavigation();", app)
        self.assertIn('interactionPolicy?.phaseRunConfirmations?.[step.commandName]', app)
        self.assertIn("await confirmRerun(step, false, confirmation)", app)
        self.assertNotIn("renderer-frame", app)
        self.assertIn("item.results?.length", app)
        self.assertIn("item?.phases?.[step.instanceKey]?.result", app)
        self.assertIn("clarificationLabel()", app)
        self.assertIn('`${progress.complete} of ${progress.total} tasks complete`', app)
        self.assertIn('const visual = presentation["canvas-presentation"] ?? presentation', app)
        self.assertIn('state.snapshot?.interactions', app)
        self.assertIn("Checking Spec Kit and session skills.", app)
        self.assertIn('presentation["canvas-setup"]?.workflowSlug', app)
        for former in ('category("canvas-theme")', 'category("canvas-content")',
                       'category("canvas-layout")'):
            self.assertNotIn(former, app)
        runtime = (TEMPLATE / "extension.mjs").read_text(encoding="utf-8")
        self.assertIn("copy: setupPolicy.installationReviewMessage", runtime)
        self.assertIn("clarificationLabel: runtimeResults.clarification.label", runtime)
        self.assertNotIn("experience.categories", runtime)

    def test_declared_input_artifact_changes_invalidate_analyze(self) -> None:
        self.node(TEMPLATE, """
import { currentPhaseSummary, declaredInputFingerprints } from './runtime/phase-runs.mjs';
const steps = [
    { instanceKey: '0:specify', commandName: 'speckit.specify', artifact: { outputPath: 'spec.md' } },
    { instanceKey: '1:analyze', commandName: 'speckit.analyze', artifact: { outputPath: null } },
    { instanceKey: '2:tasks', commandName: 'speckit.tasks', artifact: { outputPath: 'tasks.md' } },
];
const evidence = {
    '0:specify': { artifact: 'spec.md', content: '# Spec', mtimeMs: 100 },
    '2:tasks': { artifact: 'tasks.md', content: '- [ ] One', mtimeMs: 200 },
};
const run = { phase: '1:analyze', runId: 'analyze', sequence: 3, completed: true,
    startedAt: 300, error: null, reporting: { settledId: 'ready',
        inputs: declaredInputFingerprints(steps, steps[1], evidence) } };
const config = new Map([['1:analyze', { source: { kind: 'phase-report' },
    summary: true, values: [{ id: 'ready', label: 'Ready', tone: 'positive' }] }]]);
const summarize = () => currentPhaseSummary(steps, evidence, [run], config);
if (summarize().phases['1:analyze'].result?.id !== 'ready') throw Error('Fresh report missing');
evidence['0:specify'].content = '# Changed spec';
if (summarize().phases['1:analyze'].status !== 'stale' || summarize().results.length) {
    throw Error('Edited spec did not invalidate Analyze');
}
evidence['0:specify'].content = '# Spec';
evidence['2:tasks'].content = '- [x] One';
if (summarize().phases['1:analyze'].status !== 'stale') {
    throw Error('Edited tasks did not invalidate Analyze');
}
""")


if __name__ == "__main__":
    unittest.main()
