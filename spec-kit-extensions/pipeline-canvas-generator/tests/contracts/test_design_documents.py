"""Explicit handoff and post-scaffold Specify resolution contracts."""

import json
import shutil
import subprocess
import sys
import unittest
import uuid
from pathlib import Path

PACKAGE = Path(__file__).resolve().parents[2]
FIXTURES = PACKAGE / "tests" / "fixtures" / "composition"
sys.path.insert(0, str(PACKAGE / "scripts" / "lib"))

from category_contracts import bound_documents  # noqa: E402
from compiler import compile_blueprint  # noqa: E402
from experience import validate_complete_category  # noqa: E402
from phase_output import bind_phase_outputs  # noqa: E402
from request import prepare_request  # noqa: E402
from staging import atomic_json, read_json, stage_canvas_scaffold  # noqa: E402
from staging import materialize_candidate  # noqa: E402
from override import prepare_override  # noqa: E402
from receipt import write_receipt  # noqa: E402
from publication import publish_candidate, record_outcome  # noqa: E402
from specify_cli.presets import PresetRegistry, PresetResolver  # noqa: E402


class DesignDocumentContracts(unittest.TestCase):
    def test_bundled_canvas_studio_preset_replaces_complete_presentation(self):
        preset = PACKAGE.parents[1] / "spec-kit-presets" / "copilot-canvas-studio"
        manifest = (preset / "preset.yml").read_text(encoding="utf-8")
        self.assertIn("name: canvas-presentation", manifest)
        self.assertIn("file: config/canvas-presentation.json", manifest)
        presentation = read_json(preset / "config" / "canvas-presentation.json")
        validate_complete_category("canvas-presentation", presentation, PACKAGE)
        self.assertEqual(presentation["typography"], "serif")
        self.assertEqual(presentation["colors"]["accent"], "#315f82")

    def test_request_module_imports_without_cycle(self):
        result = subprocess.run(
            [sys.executable, "-c", (
                "import sys; sys.path.insert(0, sys.argv[1]); "
                "from request import prepare_request; print(prepare_request.__name__)"
            ), str(PACKAGE / "scripts/lib")],
            capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "prepare_request")

    def setUp(self):
        root = PACKAGE.parents[1] / ".canvas-test"
        self.addCleanup(lambda: root.rmdir() if root.is_dir() and not any(root.iterdir()) else None)
        self.workspace = root / str(uuid.uuid4())
        self.workspace.mkdir(parents=True)
        self.addCleanup(shutil.rmtree, self.workspace)
        shutil.copytree(FIXTURES / "installed", self.workspace / ".specify")
        self.generator = self.workspace / ".specify/extensions/pipeline-canvas-generator"
        self.inventory = {
            "artifacts": json.loads((FIXTURES / "mixed-stack.json").read_text()),
            "presets": json.loads((FIXTURES / "installed-presets.json").read_text()),
            "extensions": json.loads((FIXTURES / "installed-extensions.json").read_text()),
        }
        manifest = self.generator / "extension.yml"
        manifest.write_text((PACKAGE / "extension.yml").read_text(encoding="utf-8"),
                            encoding="utf-8")
        for name in ("canvas-presentation", "canvas-results", "phase-outputs"):
            shutil.copyfile(PACKAGE / "config" / f"{name}.json",
                            self.generator / "config" / f"{name}.json")
        self.handoff = [
            {"commandName": "speckit.plan", "expectsArtifact": True,
             "outputPath": "specs/<slug>/plan.md"},
            {"commandName": "speckit.analyze", "expectsArtifact": False, "outputPath": None},
        ]

    def request(self):
        return prepare_request(self.workspace, ["speckit.plan", "speckit.analyze"],
                               "sample", "Sample", False, inventory=self.inventory,
                               phase_outputs=self.handoff)

    def test_requires_ordered_explicit_handoff_without_skill_inference(self):
        with self.assertRaisesRegex(TypeError, "phase_outputs"):
            prepare_request(self.workspace, ["speckit.plan"], "sample", "Sample",
                            False, inventory=self.inventory)
        with self.assertRaisesRegex(ValueError, "null path"):
            self.handoff[1]["outputPath"] = "specs/<slug>/analysis.md"
            self.request()

    def test_cli_accepts_ordered_json_handoff(self):
        cli = PACKAGE / "scripts/python/canvas_generate.py"
        result = subprocess.run([
            sys.executable, str(cli), "prepare-request",
            "--workspace", str(self.workspace), "--canvas-id", "sample",
            "--display-name", "Sample", "--phase", "speckit.plan",
            "--phase", "speckit.analyze",
            "--phase-outputs-json", json.dumps(self.handoff), "--inventory-stdin",
        ], input=json.dumps(self.inventory), capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        request = read_json(Path(json.loads(result.stdout)["requestPath"]))
        self.assertEqual(request["workflow"]["phaseOutputs"], self.handoff)

    def test_post_scaffold_resolves_and_binds_self_contained_docs(self):
        request = self.request()
        self.assertNotIn("categoryTemplates", read_json(request)["workflow"])
        stage_canvas_scaffold(request, PACKAGE / "tests/fixtures/scaffold")
        bound = bound_documents(request)
        self.assertEqual(set(bound), {"canvas-presentation", "canvas-results",
                                      "phase-outputs", "canvas-interactions", "canvas-setup"})
        self.assertEqual(bound["phase-outputs"]["document"]["byCommand"], {
            item["commandName"]: {key: item[key] for key in ("expectsArtifact", "outputPath")}
            for item in self.handoff
        })
        effective = bind_phase_outputs(
            self.handoff, bound["phase-outputs"]["document"],
            ["speckit.plan", "speckit.analyze"], self.workspace,
        )
        blueprint = compile_blueprint(read_json(request), effective)
        self.assertEqual(blueprint["pipeline"]["steps"][1]["artifact"]["completionSignal"], "transient")

    def test_candidate_profile_receipt_and_ui_injection(self):
        request = self.request()
        scaffold = stage_canvas_scaffold(request, PACKAGE / "tests/fixtures/scaffold")
        atomic_json(request.with_name("command-override-draft.json"), {"categories": {}})
        prepare_override(request)
        candidate = materialize_candidate(request, scaffold)
        receipt = write_receipt(request, scaffold)
        profile = read_json(candidate / "canvas-experience.json")
        self.assertEqual(set(profile), {"schemaVersion", "presentation", "interactions",
                                        "setup", "results"})
        self.assertEqual(profile["presentation"]["colors"]["accent"], "#7356c5")
        self.assertEqual(set(profile["setup"]),
                         {"schemaVersion", "workflowSlug", "installationMode", "installationReviewMessage"})
        self.assertEqual(set(profile["setup"]["workflowSlug"]),
                         {"userProvided", "label", "helperText"})
        self.assertNotIn("onboarding", profile["presentation"])
        injected = (candidate / "ui/app.js").read_text(encoding="utf-8")
        self.assertIn('"canvas-presentation": {"', injected)
        self.assertIn('"canvas-interactions": {"', injected)
        self.assertIn('"canvas-setup": {"', injected)
        self.assertIn('"colors": {"accent": "#7356c5"', injected)
        self.assertIn('"label": "Workflow name"', injected)
        self.assertNotIn('"helpCopy"', injected)
        receipt_data = read_json(receipt)
        self.assertEqual(set(receipt_data["categories"]),
                         {"canvas-presentation", "phase-outputs", "canvas-results",
                          "canvas-interactions", "canvas-setup"})
        self.assertEqual([row["name"] for row in receipt_data["provenance"]],
                         ["canvas-presentation", "phase-outputs", "canvas-results",
                          "canvas-interactions", "canvas-setup"])
        self.assertEqual(read_json(candidate / "pipeline.json")["pipeline"]["steps"][1]
                         ["artifact"]["completionSignal"], "transient")
        target = publish_candidate(request, scaffold)
        self.assertTrue((target / "canvas-experience.json").exists())
        outcome = record_outcome(request, provider_id="project:sample", opened_instance="run-1")
        self.assertEqual(read_json(outcome)["status"], "succeeded")

    def test_nonempty_sparse_command_draft_fails_without_merging(self):
        for category in (
            "canvas-presentation", "canvas-results", "phase-outputs",
            "canvas-interactions", "canvas-setup",
        ):
            with self.subTest(category=category):
                request = self.request()
                atomic_json(request.with_name("command-override-draft.json"), {
                    "categories": {category: {}},
                })
                with self.assertRaisesRegex(ValueError, "Sparse command overrides are unsupported"):
                    prepare_override(request)
                self.assertFalse(request.with_name("command-override.json").exists())

    def test_missing_named_document_fails_after_scaffold(self):
        for name in ("canvas-presentation", "canvas-results"):
            with self.subTest(name=name):
                path = self.generator / "config" / f"{name}.json"
                original = path.read_bytes()
                try:
                    request = self.request()
                    path.unlink()
                    with self.assertRaisesRegex(ValueError, "Missing required named"):
                        stage_canvas_scaffold(request, PACKAGE / "tests/fixtures/scaffold")
                finally:
                    path.write_bytes(original)

    def test_project_markdown_override_is_not_accepted_as_json(self):
        override = self.workspace / ".specify/templates/overrides/canvas-presentation.md"
        override.parent.mkdir(parents=True)
        override.write_bytes((PACKAGE / "config/canvas-presentation.json").read_bytes())
        request = self.request()
        with self.assertRaisesRegex(ValueError, "non-JSON Specify template winner"):
            stage_canvas_scaffold(request, PACKAGE / "tests/fixtures/scaffold")

    def test_derived_phase_outputs_ignore_empty_builtin_template(self):
        path = self.generator / "config/phase-outputs.json"
        atomic_json(path, {"schemaVersion": 1, "byCommand": {
            "speckit.plan": {"expectsArtifact": False, "outputPath": None},
            "speckit.constitution": {"expectsArtifact": True,
                                     "outputPath": ".specify/memory/constitution.md"},
        }})
        request = self.request()
        stage_canvas_scaffold(request, PACKAGE / "tests/fixtures/scaffold")
        effective = bind_phase_outputs(
            self.handoff, bound_documents(request)["phase-outputs"]["document"],
            ["speckit.plan", "speckit.analyze"], self.workspace,
        )
        self.assertEqual(effective[0], self.handoff[0])
        self.assertIsNone(effective[1]["outputPath"])

    def test_wrong_version_extra_field_unknown_command_and_invalid_pair(self):
        for name, changes, message in (
            ("canvas-presentation", {"schemaVersion": 2}, "constant"),
            ("canvas-presentation", {"unused": 1}, "Unknown"),
            ("canvas-results", {"schemaVersion": 3}, "constant"),
            ("canvas-results", {"unknown": True}, "Unknown"),
            ("canvas-results", {"phases": {"speckit.nonexistent": {"disabled": True}}},
             "unknown Specify commands"),
        ):
            with self.subTest(name=name, changes=changes):
                path = self.generator / "config" / f"{name}.json"
                original = path.read_bytes()
                try:
                    atomic_json(path, {**json.loads(original), **changes})
                    request = self.request()
                    with self.assertRaisesRegex(ValueError, message):
                        stage_canvas_scaffold(request, PACKAGE / "tests/fixtures/scaffold")
                finally:
                    path.write_bytes(original)

    def test_duplicate_json_keys_are_rejected(self):
        from category_contracts import parse_document_json

        with self.assertRaisesRegex(ValueError, "Duplicate key"):
            parse_document_json(b'{"schemaVersion":1,"byCommand":{},"byCommand":{}}',
                                "phase-outputs")

    def test_staged_document_change_is_detected(self):
        request = self.request()
        stage_canvas_scaffold(request, PACKAGE / "tests/fixtures/scaffold")
        path = request.with_name("design-documents.json")
        bindings = read_json(path)
        bindings["canvas-presentation"]["document"]["colors"]["accent"] = "#123456"
        atomic_json(path, bindings)
        with self.assertRaisesRegex(ValueError, "documents changed"):
            bound_documents(request)

    def test_complete_preset_replacement_wins_after_request(self):
        preset = self.workspace / ".specify/presets/customer-canvas-design"
        manifest = preset / "preset.yml"
        manifest.write_text(manifest.read_text(encoding="utf-8").replace(
            "    - name: design-marker\n      file: config/design-marker.json",
            "    - name: canvas-presentation\n      type: template\n      file: config/canvas-presentation.json"
        ).replace("  version: \"0.1.0\"\n", "  version: \"0.1.0\"\n"
                  "  description: Test design preset\nrequires:\n"
                  "  speckit_version: \">=1.0.7\"\n"), encoding="utf-8")
        PresetRegistry(self.workspace / ".specify/presets").add(
            "customer-canvas-design", {"priority": 10, "enabled": True}
        )
        presentation = json.loads((PACKAGE / "config/canvas-presentation.json").read_text())
        presentation["colors"]["accent"] = "#123456"
        atomic_json(preset / "config/canvas-presentation.json", presentation)
        row = next(row for row in self.inventory["artifacts"]
                   if row["kind"] == "template" and row["name"] == "canvas-presentation")
        owner = json.loads(json.dumps(row["stack"][0]))
        owner.update({"layer": "preset", "sourceId": "customer-canvas-design",
                      "manifestPath": ".specify/presets/customer-canvas-design/preset.yml",
                      "sourcePath": ".specify/presets/customer-canvas-design/config/canvas-presentation.json",
                      "lookupId": "preset:customer-canvas-design:template:canvas-presentation"})
        row["stack"][0]["active"] = False
        row["stack"][0]["hidden"] = True
        row["stack"].insert(0, owner)
        manifest.write_text(manifest.read_text(encoding="utf-8").replace(
            "      file: config/canvas-presentation.json",
            "      file: config/canvas-presentation.json\n"
            "    - name: phase-outputs\n"
            "      type: template\n"
            "      file: config/phase-outputs.json",
        ), encoding="utf-8")
        outputs = {"schemaVersion": 1, "byCommand": {
            item["commandName"]: {key: item[key] for key in ("expectsArtifact", "outputPath")}
            for item in self.handoff
        }}
        outputs["byCommand"]["speckit.analyze"]["expectsArtifact"] = None
        atomic_json(preset / "config/phase-outputs.json", outputs)
        phase_row = next(row for row in self.inventory["artifacts"]
                         if row["kind"] == "template" and row["name"] == "phase-outputs")
        phase_owner = json.loads(json.dumps(phase_row["stack"][0]))
        phase_owner.update({"layer": "preset", "sourceId": "customer-canvas-design",
                            "manifestPath": ".specify/presets/customer-canvas-design/preset.yml",
                            "sourcePath": ".specify/presets/customer-canvas-design/config/phase-outputs.json",
                            "lookupId": "preset:customer-canvas-design:template:phase-outputs"})
        phase_row["stack"][0]["active"] = False
        phase_row["stack"][0]["hidden"] = True
        phase_row["stack"].insert(0, phase_owner)
        self.assertEqual(
            PresetResolver(self.workspace).resolve("canvas-presentation", template_type="template"),
            preset / "config/canvas-presentation.json",
        )
        inline = {
            name: json.loads((PACKAGE / "config" / f"{name}.json").read_text(encoding="utf-8"))
            for name in ("canvas-presentation", "canvas-results",
                         "canvas-interactions", "canvas-setup")
        }
        inline["canvas-presentation"]["colors"]["accent"] = "#ff0000"
        inline["canvas-interactions"]["progression"]["showFuturePhases"] = False
        inline["canvas-setup"]["installationMode"] = "automatic"
        inline["canvas-setup"]["workflowSlug"]["userProvided"] = False
        inline["phase-outputs"] = {"schemaVersion": 1, "byCommand": {
            item["commandName"]: {key: item[key] for key in ("expectsArtifact", "outputPath")}
            for item in self.handoff
        }}
        inline["phase-outputs"]["byCommand"]["speckit.analyze"]["expectsArtifact"] = None
        request = prepare_request(
            self.workspace, ["speckit.plan", "speckit.analyze"], "sample", "Sample",
            False, inventory=self.inventory, phase_outputs=self.handoff,
            inline_documents=inline,
        )
        scaffold = stage_canvas_scaffold(request, PACKAGE / "tests/fixtures/scaffold")
        self.assertEqual(bound_documents(request)["canvas-presentation"]["document"]["colors"]["accent"], "#123456")
        self.assertEqual(bound_documents(request)["phase-outputs"]["provider"]["kind"], "preset")
        atomic_json(request.with_name("command-override-draft.json"), {"categories": {}})
        prepare_override(request)
        candidate = materialize_candidate(request, scaffold)
        receipt = read_json(write_receipt(request, scaffold))
        profile = read_json(candidate / "canvas-experience.json")
        self.assertFalse(profile["interactions"]["progression"]["showFuturePhases"])
        self.assertEqual(profile["setup"]["installationMode"], "automatic")
        self.assertFalse(profile["setup"]["workflowSlug"]["userProvided"])
        self.assertTrue(receipt["categories"]["canvas-presentation"]["submittedInline"]["superseded"])
        self.assertTrue(receipt["categories"]["phase-outputs"]["submittedInline"]["superseded"])
        self.assertIn("canvas-presentation", " ".join(receipt["warnings"]))
        self.assertIn("phase-outputs", " ".join(receipt["warnings"]))
        del outputs["byCommand"]["speckit.analyze"]
        atomic_json(preset / "config/phase-outputs.json", outputs)
        mismatched = prepare_request(
            self.workspace, ["speckit.plan", "speckit.analyze"], "sample", "Sample",
            False, inventory=self.inventory, phase_outputs=self.handoff,
            inline_documents=inline,
        )
        with self.assertRaisesRegex(ValueError, "missing.*speckit.analyze"):
            stage_canvas_scaffold(mismatched, PACKAGE / "tests/fixtures/scaffold")

    def test_inline_phase_outputs_require_exact_pipeline_commands(self):
        document = {"schemaVersion": 1, "byCommand": {
            "speckit.plan": {"expectsArtifact": True, "outputPath": "specs/<slug>/plan.md"},
        }}
        with self.assertRaisesRegex(ValueError, "missing.*speckit.analyze"):
            prepare_request(
                self.workspace, ["speckit.plan", "speckit.analyze"], "sample", "Sample",
                False, inventory=self.inventory, phase_outputs=self.handoff,
                inline_documents={"phase-outputs": document},
            )

    def test_cli_uses_same_schema_for_editor_and_preparation(self):
        cli = PACKAGE / "scripts/python/canvas_generate.py"
        baseline = json.loads((PACKAGE / "config/canvas-setup.json").read_text(encoding="utf-8"))
        args = [sys.executable, str(cli), "validate-config", "--workspace",
                str(self.workspace), "--name", "canvas-setup",
                "--phase", "speckit.plan", "--json-stdin"]
        valid = subprocess.run(args, input=json.dumps(baseline), capture_output=True, text=True)
        self.assertEqual(valid.returncode, 0, valid.stderr)
        self.assertEqual(json.loads(valid.stdout)["document"], baseline)
        for raw, message in (
            ('{"schemaVersion":1,"schemaVersion":1}', "Duplicate key"),
            ('{"schemaVersion":1}', "Missing required"),
            ('{"schemaVersion":1, // comment\n}', "Invalid JSON"),
        ):
            with self.subTest(raw=raw):
                invalid = subprocess.run(args, input=raw, capture_output=True, text=True)
                self.assertNotEqual(invalid.returncode, 0)
                self.assertIn(message, invalid.stderr)

    def test_preview_exposes_generator_baselines_for_all_five_documents(self):
        cli = PACKAGE / "scripts/python/canvas_generate.py"
        result = subprocess.run([
            sys.executable, str(cli), "preview-config", "--workspace", str(self.workspace),
            "--phase", "speckit.plan", "--phase", "speckit.analyze",
            "--phase-outputs-json", json.dumps(self.handoff), "--inventory-stdin",
        ], input=json.dumps(self.inventory), capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        preview = json.loads(result.stdout)
        self.assertEqual(set(preview["documents"]), {
            "canvas-presentation", "phase-outputs", "canvas-results",
            "canvas-interactions", "canvas-setup",
        })
        self.assertEqual(list(preview["documents"]["phase-outputs"]["byCommand"]),
                         ["speckit.plan", "speckit.analyze"])
        self.assertTrue(all(winner is None for winner in preview["winners"].values()))

    def test_inline_asset_logo_is_rejected_but_preset_assets_remain_supported(self):
        presentation = json.loads((PACKAGE / "config/canvas-presentation.json").read_text())
        presentation["brand"]["logo"] = {"mode": "asset", "path": "assets/logo.png", "alt": "Logo"}
        with self.assertRaisesRegex(ValueError, "cannot supply an asset logo"):
            prepare_request(self.workspace, ["speckit.plan", "speckit.analyze"],
                            "sample", "Sample", False, inventory=self.inventory,
                            phase_outputs=self.handoff,
                            inline_documents={"canvas-presentation": presentation})
