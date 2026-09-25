"""Default generated-canvas and mandatory request-bound override journey."""

import hashlib
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
TEMPLATE = PACKAGE / "templates" / "generated-canvas"
sys.path.insert(0, str(PACKAGE / "scripts" / "lib"))

from compiler import compile_blueprint  # noqa: E402
from experience import default_document  # noqa: E402
from contracts.handoff import handoff  # noqa: E402
from request import prepare_request  # noqa: E402
from category_contracts import bound_documents, stage_documents  # noqa: E402
from staging import atomic_json, materialize_candidate, read_json, stage_canvas_scaffold  # noqa: E402
from override import prepare_override, validate_final_override  # noqa: E402


class DefaultCanvasJourney(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.workspace = Path(directory.name)
        shutil.copytree(FIXTURES / "installed", self.workspace / ".specify")
        self.inventory = {
            "artifacts": json.loads((FIXTURES / "mixed-stack.json").read_text(encoding="utf-8")),
            "presets": json.loads((FIXTURES / "installed-presets.json").read_text(encoding="utf-8")),
            "extensions": json.loads((FIXTURES / "installed-extensions.json").read_text(encoding="utf-8")),
        }
        with patch("request._preflight"):
            self.request_path = prepare_request(
                self.workspace, ["speckit.plan"], "my-canvas", "My Canvas",
                False, inventory=self.inventory, phase_outputs=handoff(["speckit.plan"]),
            )
        stage_documents(self.request_path)
        self.draft = self.request_path.with_name("command-override-draft.json")
        self.final = self.request_path.with_name("command-override.json")

    def test_default_draft_is_finalized_against_exact_request_bytes(self) -> None:
        atomic_json(self.draft, {"categories": {}})
        result = prepare_override(self.request_path)
        self.assertEqual(result, self.final)
        self.assertEqual(read_json(result), {
            "schemaVersion": 1,
            "requestSha256": hashlib.sha256(self.request_path.read_bytes()).hexdigest(),
            "categories": {},
        })
        self.assertEqual(validate_final_override(self.request_path), read_json(result))
        blueprint = compile_blueprint(read_json(self.request_path))
        self.assertEqual(blueprint["pipeline"]["steps"][0]["invocation"], "/skill:speckit-plan")
        self.assertEqual(blueprint["pipeline"]["steps"][0]["artifact"]["outputPath"],
                         "specs/<slug>/plan.md")

    def test_missing_draft_only_and_mismatched_final_never_materialize(self) -> None:
        with self.assertRaisesRegex(ValueError, "finalized override"):
            validate_final_override(self.request_path)
        atomic_json(self.draft, {"categories": {}})
        with self.assertRaisesRegex(ValueError, "finalized override"):
            validate_final_override(self.request_path)
        prepare_override(self.request_path)
        atomic_json(self.final, {
            "schemaVersion": 1, "requestSha256": "0" * 64, "categories": {},
        })
        with self.assertRaisesRegex(ValueError, "request digest"):
            validate_final_override(self.request_path)
        self.assertFalse((self.workspace / ".github" / "extensions" / "my-canvas").exists())

    def test_finalized_override_rejects_changed_request(self) -> None:
        atomic_json(self.draft, {"categories": {}})
        prepare_override(self.request_path)
        altered = read_json(self.request_path)
        altered["canvas"]["displayName"] = "Changed name"
        atomic_json(self.request_path, altered)
        with self.assertRaisesRegex(ValueError, "request digest"):
            validate_final_override(self.request_path)

    def test_prepare_override_cli_uses_request_path(self) -> None:
        atomic_json(self.draft, {"categories": {}})
        result = subprocess.run(
            [sys.executable, str(PACKAGE / "scripts" / "python" / "canvas_generate.py"),
             "prepare-override", "--request", str(self.request_path)],
            capture_output=True, text=True, check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["overridePath"], str(self.final))
        self.assertEqual(validate_final_override(self.request_path)["categories"], {})

    def test_candidate_requires_finalized_override_and_scaffold_without_target_mutation(self) -> None:
        scaffold = PACKAGE / "tests" / "fixtures" / "scaffold"
        with self.assertRaisesRegex(ValueError, "finalized override"):
            materialize_candidate(self.request_path, scaffold)
        atomic_json(self.draft, {"categories": {}})
        with self.assertRaisesRegex(ValueError, "finalized override"):
            materialize_candidate(self.request_path, scaffold)
        prepare_override(self.request_path)
        with self.assertRaisesRegex(ValueError, "scaffold"):
            materialize_candidate(self.request_path, self.workspace / "missing-scaffold")
        self.assertFalse((self.workspace / ".github" / "extensions" / "my-canvas").exists())
        candidate = materialize_candidate(self.request_path, scaffold)
        self.assertEqual(candidate, self.request_path.parent / "staging")
        self.assertEqual(read_json(candidate / "pipeline.json"),
                         compile_blueprint(read_json(self.request_path)))
        self.assertEqual(set(read_json(candidate / "canvas-experience.json")),
                         {"schemaVersion", "presentation", "interactions", "setup", "results"})
        self.assertFalse((candidate / "renderer").exists())
        app = (candidate / "ui" / "app.js").read_text(encoding="utf-8")
        presentation = json.loads(app.split("const presentation = ", 1)[1].split(";", 1)[0])
        self.assertEqual(read_json(candidate / "pipeline.json")["metadata"]["description"],
                         "My Canvas workflow canvas.")
        self.assertEqual(presentation["canvas-presentation"]["colors"]["accent"], "#7356c5")
        self.assertNotIn("rendererHost", app)
        self.assertNotIn("selectedRenderer", app)
        self.assertIn('renderPhaseNavigation();', app)
        self.assertNotRegex(app, r'id="run-phase"[^>]*\bdisabled\b')
        self.assertIn("Create or update the project Constitution above before running this phase.", app)
        self.assertIn("Rerunning this phase is disabled by the canvas interaction settings.", app)
        self.assertNotIn("__PRESENTATION_JSON__", app)
        self.assertNotIn("speckit-wizard", app)
        self.assertNotIn("__EXTENSION_ID_JSON__",
                         (candidate / "extension.mjs").read_text(encoding="utf-8"))
        self.assertFalse((candidate / "README.md").exists())
        self.assertFalse((self.workspace / ".github" / "extensions" / "my-canvas").exists())

    def test_authoring_scaffold_is_snapshotted_once_under_request(self) -> None:
        self.request_path.with_name("design-documents.json").unlink()
        source = self.workspace / "authoring"
        shutil.copytree(PACKAGE / "tests" / "fixtures" / "scaffold", source)
        staged = stage_canvas_scaffold(self.request_path, source)
        self.assertEqual(staged, self.request_path.parent / "authoring-scaffold")
        original = (staged / "extension.mjs").read_bytes()
        (source / "extension.mjs").write_text("changed after staging", encoding="utf-8")
        self.assertEqual((staged / "extension.mjs").read_bytes(), original)
        with self.assertRaisesRegex(ValueError, "already has a staged"):
            stage_canvas_scaffold(self.request_path, PACKAGE / "tests" / "fixtures" / "scaffold")
        atomic_json(self.draft, {"categories": {}})
        prepare_override(self.request_path)
        self.assertTrue(materialize_candidate(self.request_path, staged).is_dir())
        self.assertFalse((self.workspace / ".github" / "extensions" / "my-canvas").exists())

    def test_native_presentation_keeps_nondefault_design_choices(self) -> None:
        document = self.workspace / ".specify/extensions/pipeline-canvas-generator/config/canvas-presentation.json"
        changed = read_json(document)
        changed["colors"]["accent"] = "#176a81"
        atomic_json(document, changed)
        self.request_path.with_name("design-documents.json").unlink()
        stage_documents(self.request_path)
        atomic_json(self.draft, {"categories": {}})
        prepare_override(self.request_path)
        candidate = materialize_candidate(
            self.request_path, PACKAGE / "tests" / "fixtures" / "scaffold"
        )
        app = (candidate / "ui" / "app.js").read_text(encoding="utf-8")
        presentation = json.loads(app.split("const presentation = ", 1)[1].split(";", 1)[0])
        self.assertEqual(presentation["canvas-presentation"]["colors"]["accent"], "#176a81")
        self.assertEqual(read_json(candidate / "pipeline.json")["metadata"]["description"],
                         "My Canvas workflow canvas.")
        if shutil.which("node"):
            result = subprocess.run(
                ["node", "--check", str(candidate / "ui" / "app.js")],
                capture_output=True, text=True, check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_materialize_cli_stages_once_and_does_not_publish(self) -> None:
        atomic_json(self.draft, {"categories": {}})
        prepare_override(self.request_path)
        args = [
            sys.executable, str(PACKAGE / "scripts" / "python" / "canvas_generate.py"),
            "materialize", "--request", str(self.request_path), "--scaffold",
            str(PACKAGE / "tests" / "fixtures" / "scaffold"),
        ]
        result = subprocess.run(args, capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["candidatePath"],
                         str(self.request_path.parent / "staging"))
        self.assertTrue(Path(json.loads(result.stdout)["receiptPath"]).is_file())
        again = subprocess.run(args, capture_output=True, text=True, check=False)
        self.assertNotEqual(again.returncode, 0)
        self.assertIn("already has a staged candidate", again.stderr)
        self.assertFalse((self.workspace / ".github" / "extensions" / "my-canvas").exists())

    @unittest.skipUnless(shutil.which("node"), "Node.js is required for generated-runtime checks")
    def test_scaffold_refinement_starts_generated_runtime(self) -> None:
        atomic_json(self.draft, {"categories": {}})
        prepare_override(self.request_path)
        candidate = materialize_candidate(
            self.request_path, PACKAGE / "tests" / "fixtures" / "scaffold"
        )
        smoke = self.workspace / "scaffold-smoke"
        shutil.copytree(candidate, smoke)
        entry = smoke / "extension.mjs"
        source = entry.read_text(encoding="utf-8")
        self.assertIn("joinSession({", source)
        self.assertIn("createCanvas(generatedCanvasOptions({ createServer }))", source)
        self.assertNotIn("Hello from a local canvas server", source)
        entry.write_text(
            source.replace('"@github/copilot-sdk/extension"', '"./mock-sdk.mjs"'),
            encoding="utf-8",
        )
        (smoke / "mock-sdk.mjs").write_text("""
export const createCanvas = (value) => { globalThis.canvas = value; return value; };
export const joinSession = async () => ({
    on() {}, log: async () => {}, send: async () => 'message-id',
    rpc: { skills: { reload: async () => ({ errors: [], warnings: [] }) } },
});
""", encoding="utf-8")
        script = """
await import('./extension.mjs');
if (globalThis.canvas.id !== 'my-canvas') throw Error('Wrong generated canvas');
if (!globalThis.canvas.actions.some(({name}) => name === 'run_phase')) throw Error('Missing phase action');
const opened = await globalThis.canvas.open({
    instanceId: 'refined-1', input: { cwd: process.env.CANVAS_WORKSPACE },
});
const response = await fetch(opened.url);
if (!response.ok || !(await response.text()).includes('My Canvas')) throw Error('Canvas did not open');
await globalThis.canvas.onClose({ instanceId: 'refined-1' });
"""
        result = subprocess.run(
            ["node", "--input-type=module", "-e", script],
            cwd=smoke, capture_output=True, text=True, check=False, timeout=30,
            env={**os.environ, "CANVAS_WORKSPACE": str(self.workspace)},
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_draft_rejects_unknown_and_protected_values(self) -> None:
        for draft in (
            {"categories": {}, "requestSha256": "0" * 64},
            {"categories": {"unknown": {}}},
            {"categories": {"canvas-presentation": {"schemaVersion": 1}}},
            {"categories": {"canvas-presentation": {"copy": None}}},
            {"categories": {"canvas-presentation": {"protectedBackend": {"extension": "x"}}}},
            {"categories": {"canvas-presentation": {"colors": {"accent": float("nan")}}}},
        ):
            with self.subTest(draft=draft):
                atomic_json(self.draft, draft)
                with self.assertRaises(ValueError):
                    prepare_override(self.request_path)
                self.assertFalse(self.final.exists())

    @unittest.skipUnless(shutil.which("node"), "Node.js is required for generated-runtime checks")
    def test_standalone_runtime_artifact_path_and_local_ui(self) -> None:
        blueprint = compile_blueprint(read_json(self.request_path))
        artifact = self.workspace / "specs" / "example" / "plan.md"
        artifact.parent.mkdir(parents=True)
        artifact.write_bytes(b"# Example plan\n")
        script = """
import { validateWorkflowPaths, readWorkflowArtifact } from './runtime/workspace-files.mjs';
const pipeline = JSON.parse(process.env.CANVAS_BLUEPRINT);
validateWorkflowPaths(pipeline);
const content = await readWorkflowArtifact(process.env.CANVAS_WORKSPACE, 'specs/example/plan.md', pipeline);
if (content !== '# Example plan\\n') throw Error('Artifact viewer read failed');
await import('./ui/markdown.mjs');
await import('./ui/clarifications.mjs');
"""
        result = subprocess.run(
            ["node", "--input-type=module", "-e", script],
            cwd=TEMPLATE, capture_output=True, text=True, check=False,
            env={**os.environ, "CANVAS_BLUEPRINT": json.dumps(blueprint),
                 "CANVAS_WORKSPACE": str(self.workspace)},
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        for path in TEMPLATE.rglob("*.mjs"):
            self.assertNotIn("../../../shared-workflow-ui/", path.read_text(encoding="utf-8"))

    @unittest.skipUnless(shutil.which("node"), "Node.js is required for generated-runtime checks")
    def test_portable_canvas_starts_with_declared_actions_and_local_artifact_viewer(self) -> None:
        target = self.workspace / "isolated-canvas"
        shutil.copytree(TEMPLATE, target)
        (self.workspace / ".specify" / "init-options.json").write_text(
            json.dumps({"integration": "copilot", "integrationOptions": "--skills"}),
            encoding="utf-8",
        )
        skill = self.workspace / ".github" / "skills" / "speckit-plan" / "SKILL.md"
        skill.parent.mkdir(parents=True)
        skill.write_text("# Plan skill\n", encoding="utf-8")
        artifact = self.workspace / "specs" / "example" / "plan.md"
        artifact.parent.mkdir(parents=True)
        artifact.write_bytes(b"# Example plan\n")
        source = (target / "extension.mjs").read_text(encoding="utf-8")
        source = source.replace('"@github/copilot-sdk/extension"', '"./mock-sdk.mjs"')
        for placeholder, replacement in (
            ("__EXTENSION_ID_JSON__", json.dumps("my-canvas")),
            ("__DISPLAY_NAME_JSON__", json.dumps("My Canvas")),
            ("__DESCRIPTION_JSON__", json.dumps("My Canvas workflow canvas.")),
        ):
            source = source.replace(placeholder, replacement)
        (target / "extension.mjs").write_text(source, encoding="utf-8")
        (target / "pipeline.json").write_text(json.dumps(compile_blueprint(read_json(self.request_path))), encoding="utf-8")
        (target / "workflow-config.json").write_text(json.dumps({
            "version": 1, "itemLabels": {}, "phaseArguments": {},
            "resultLabels": [], "clarificationTag": True,
        }), encoding="utf-8")
        documents = bound_documents(self.request_path)
        (target / "canvas-experience.json").write_text(json.dumps({
            "schemaVersion": 1,
            "presentation": documents["canvas-presentation"]["document"],
            "interactions": default_document(PACKAGE, "canvas-interactions"),
            "setup": default_document(PACKAGE, "canvas-setup"),
            "results": documents["canvas-results"]["document"],
        }), encoding="utf-8")
        (target / "mock-sdk.mjs").write_text("""
globalThis.sent = [];
export const createCanvas = (definition) => { globalThis.canvas = definition; return definition; };
export const joinSession = async () => ({
    on() {}, log: async () => {}, send: async (input) => { globalThis.sent.push(input); return "message-id"; },
    rpc: { skills: { reload: async () => ({ errors: [], warnings: [] }) } },
});
""", encoding="utf-8")
        script = """
await import('./extension.mjs');
const names = globalThis.canvas.actions.map(({name}) => name);
for (const name of ['list_items', 'setup_workflow', 'reloadSessionSkills', 'run_phase']) {
    if (!names.includes(name)) throw Error(`Missing required action: ${name}`);
}
for (const name of ['report_artifact_review', 'report_phase_result', 'install_extension']) {
    if (names.includes(name)) throw Error(`Unexpected default action: ${name}`);
}
const opened = await globalThis.canvas.open({ instanceId: 'test-1', input: { cwd: process.env.CANVAS_WORKSPACE } });
const page = await fetch(opened.url);
if (!page.ok || !(await page.text()).includes('/ui/artifact-viewer.css')) throw Error('Viewer failed to start');
const base = new URL(opened.url);
const ui = new URL('/ui/app.js', base);
ui.searchParams.set('token', base.searchParams.get('token'));
if (!(await (await fetch(ui)).text()).includes('renderPhaseNavigation();')) {
    throw Error('Horizontal phase UI unavailable');
}
for (const path of ['/api/renderer/config', '/api/renderer/state', '/renderer/mount.mjs']) {
    const url = new URL(path, base);
    url.searchParams.set('token', base.searchParams.get('token'));
    if ((await fetch(url)).status !== 404) throw Error(`Alternate renderer route remains: ${path}`);
}
const denied = await fetch(new URL('/api/run', base), {
    method: 'POST', headers: { Origin: 'null', 'Content-Type': 'application/json' },
    body: JSON.stringify({ phase: '0:plan', itemId: '__new__', args: 'Scope the design' }),
});
if (denied.status !== 403) throw Error('Cross-origin phase dispatch was allowed');
const artifact = new URL('/api/artifact', opened.url);
artifact.searchParams.set('path', 'specs/example/plan.md');
artifact.searchParams.set('token', new URL(opened.url).searchParams.get('token'));
const viewed = await fetch(artifact);
if (!viewed.ok || (await viewed.json()).content !== '# Example plan\\n') throw Error('Artifact view failed');
const actionUrl = new URL('/api/run', opened.url);
actionUrl.searchParams.set('token', new URL(opened.url).searchParams.get('token'));
const dispatch = await fetch(actionUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        phase: '0:plan', itemId: '__new__', args: 'Scope the design',
    }),
});
const result = await dispatch.json();
if (!result.ok || result.queued || !result.hasRun) {
    const rawState = new URL('/api/state', opened.url);
    rawState.searchParams.set('token', new URL(opened.url).searchParams.get('token'));
    const state = await (await fetch(rawState)).json();
    throw Error(`Phase not dispatched: ${JSON.stringify(result)}; setup: ${JSON.stringify(state.setup)}`);
}
if (globalThis.sent.filter((entry) => entry.prompt?.startsWith('/skill:speckit-plan Scope the design')).length !== 1) {
    throw Error('Phase must dispatch exactly once with original input');
}
await globalThis.canvas.onClose({ instanceId: 'test-1' });
"""
        result = subprocess.run(
            ["node", "--input-type=module", "-e", script],
            cwd=target, capture_output=True, text=True, check=False, timeout=30,
            env={**os.environ, "CANVAS_WORKSPACE": str(self.workspace)},
        )
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
