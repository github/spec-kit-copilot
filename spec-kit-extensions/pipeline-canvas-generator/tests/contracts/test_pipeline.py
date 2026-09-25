"""Linear blueprint tests grounded in pinned PR #32 parity fixtures."""

import copy
import hashlib
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import yaml


PACKAGE = Path(__file__).resolve().parents[2]
FIXTURES = PACKAGE / "tests" / "fixtures" / "composition"
sys.path.insert(0, str(PACKAGE / "scripts" / "lib"))

from compiler import _setup_requirements, compile_blueprint  # noqa: E402
TEMPLATE_NAME = "phase-outputs"
from contracts.handoff import prepare_request  # noqa: E402
from override import prepare_override  # noqa: E402
from staging import atomic_json, materialize_candidate, read_json  # noqa: E402


class BlueprintContracts(unittest.TestCase):
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

    def request(self, *phases: str) -> dict:
        path = prepare_request(
            self.workspace, list(phases), "fixture-workflow", "Fixture Workflow",
            False, inventory=self.inventory,
        )
        return read_json(path)

    def test_order_and_output_contracts_are_compiled_unchanged(self) -> None:
        request = self.request("speckit.plan", "speckit.analyze")
        with patch("subprocess.run", side_effect=AssertionError("compiler must not execute phases")):
            blueprint = compile_blueprint(request)
        self.assertEqual(blueprint["schemaVersion"], 2)
        self.assertEqual(blueprint["pipeline"]["topology"], "linear")
        self.assertEqual(
            [step["commandName"] for step in blueprint["pipeline"]["steps"]],
            request["workflow"]["selectedPhases"],
        )
        self.assertEqual(
            [step["predecessors"] for step in blueprint["pipeline"]["steps"]],
            [[], [0]],
        )
        self.assertEqual(
            [step["artifact"] for step in blueprint["pipeline"]["steps"]],
            [
                {"outputPath": "specs/<slug>/plan.md",
                 "persistent": True, "completionSignal": "artifact"},
                {"outputPath": None, "persistent": False,
                 "completionSignal": "transient"},
            ],
        )
        self.assertEqual(blueprint["runtime"]["itemRoot"], "specs/<slug>")

    def test_canvas_metadata_and_setup_defaults(self) -> None:
        configuration = {
            "canvas": {
                "id": "fixture-workflow",
                "displayName": "Fixture Workflow",
                "workflowListName": "Features",
                "description": "Run the selected feature workflow.",
            },
        }
        path = prepare_request(
            self.workspace, ["speckit.plan"], "fixture-workflow", "Fixture Workflow",
            False, inventory=self.inventory, configuration=configuration,
        )
        request = read_json(path)
        blueprint = compile_blueprint(request)
        self.assertEqual(request["canvas"], configuration["canvas"])
        self.assertNotIn("instanceConfiguration", request)
        self.assertEqual(blueprint["metadata"]["description"], "Run the selected feature workflow.")
        self.assertEqual(blueprint["metadata"]["workflowListName"], "Features")
        self.assertTrue(blueprint["runtime"]["userProvidesSlug"])
        self.assertTrue(blueprint["setup"]["requireInstallationApproval"])
        atomic_json(path.with_name("command-override-draft.json"), {"categories": {}})
        prepare_override(path)
        candidate = materialize_candidate(
            path, PACKAGE / "tests" / "fixtures" / "scaffold",
        )
        profile = read_json(candidate / "canvas-experience.json")
        self.assertTrue(profile["setup"]["workflowSlug"]["userProvided"])
        self.assertEqual(profile["setup"]["installationMode"], "prompt")
        self.assertEqual(read_json(candidate / "workflow-config.json")["resultLabels"], [])
        self.assertTrue(read_json(candidate / "workflow-config.json")["clarificationTag"])
        final_blueprint = read_json(candidate / "pipeline.json")
        self.assertEqual(final_blueprint["metadata"]["description"], "Run the selected feature workflow.")
        self.assertEqual(final_blueprint["metadata"]["workflowListName"], "Features")
        self.assertTrue(final_blueprint["runtime"]["userProvidesSlug"])
        self.assertTrue(final_blueprint["setup"]["requireInstallationApproval"])
        request["instanceConfiguration"] = {"advanced": True}
        with self.assertRaisesRegex(ValueError, "Invalid request fields"):
            compile_blueprint(request)

    def test_result_labels_reject_duplicates_in_design_category(self) -> None:
        path = prepare_request(
            self.workspace, ["speckit.plan"], "fixture-workflow", "Fixture Workflow",
            False, inventory=self.inventory,
        )
        atomic_json(path.with_name("command-override-draft.json"), {"categories": {
            "canvas-results": {"resultLabels": ["Go", "go"]},
        }})
        with self.assertRaisesRegex(ValueError, "Sparse command overrides are unsupported"):
            prepare_override(path)

    def test_constitution_is_project_prerequisite_not_workflow_item(self) -> None:
        blueprint = compile_blueprint(self.request("speckit.constitution", "speckit.plan"))
        self.assertEqual(blueprint["projectArtifacts"], {
            "constitution": {"instanceKey": "0:constitution", "required": True},
        })
        workflow = [
            step for step in blueprint["pipeline"]["steps"]
            if step["instanceKey"] != blueprint["projectArtifacts"]["constitution"]["instanceKey"]
        ]
        self.assertEqual([step["commandName"] for step in workflow], ["speckit.plan"])
        self.assertIn("speckit-constitution",
                      [skill["name"] for skill in blueprint["setup"]["requiredSkills"]])

    def test_runtime_provider_only_in_setup(self) -> None:
        request = self.request("speckit.bug.assess")
        blueprint = compile_blueprint(request)
        self.assertEqual(blueprint["setup"]["compositionFingerprint"],
                         request["workflow"]["artifactSnapshot"]["compositionFingerprint"])
        self.assertEqual(blueprint["setup"]["extensions"], [{
            "kind": "extension", "id": "runtime-assess", "version": "0.1.0",
            "enabled": True, "priority": 10, "precedence": 0,
            "installedSource": {"kind": "local"},
            "manifestPath": ".specify/extensions/runtime-assess/extension.yml",
            "manifestSha256": hashlib.sha256((
                self.workspace / ".specify/extensions/runtime-assess/extension.yml"
            ).read_bytes()).hexdigest(),
        }])
        self.assertEqual(blueprint["pipeline"]["steps"][0]["source"]["id"], "runtime-assess")
        self.assertNotIn("pipeline-canvas-generator",
                         [entry["id"] for entry in blueprint["setup"]["extensions"]])

    def test_installed_skill_fingerprint_is_bound_to_request(self) -> None:
        skill = self.workspace / ".github/skills/speckit-plan/SKILL.md"
        skill.parent.mkdir(parents=True)
        skill.write_text("# Plan\n", encoding="utf-8")
        request = self.request("speckit.plan")
        digest = hashlib.sha256(skill.read_bytes()).hexdigest()
        self.assertEqual(request["workflow"]["requiredSkillHashes"], {"speckit-plan": digest})
        skill.write_text("# Replaced after request\n", encoding="utf-8")
        self.assertEqual(compile_blueprint(request)["setup"]["requiredSkills"][0]["sha256"], digest)
        request["workflow"]["requiredSkillHashes"]["speckit-plan"] = "invalid"
        with self.assertRaisesRegex(ValueError, "skill fingerprints"):
            compile_blueprint(request)

    def test_setup_preserves_cli_relative_order_of_effective_providers(self) -> None:
        request = self.request("speckit.bug.assess")
        snapshot = copy.deepcopy(request["workflow"]["artifactSnapshot"])
        provider = copy.deepcopy(next(item for item in snapshot["providers"]
                                      if item["id"] == "runtime-assess"))
        provider["id"] = "earlier-runtime"
        provider["manifestPath"] = ".specify/extensions/earlier-runtime/extension.yml"
        snapshot["providers"].insert(0, provider)
        command = copy.deepcopy(next(item for item in snapshot["artifacts"]
                                     if item["name"] == "speckit.bug.assess"))
        layer = copy.deepcopy(command["stack"][0])
        layer["sourceId"] = "earlier-runtime"
        command["stack"].append(layer)
        step = compile_blueprint(request)["pipeline"]["steps"][0]
        setup = _setup_requirements(snapshot, [command], [step])
        self.assertEqual([(item["id"], item["precedence"]) for item in setup["extensions"]],
                         [("earlier-runtime", 0), ("runtime-assess", 1)])
        self.assertEqual(setup["presets"], [])

    def test_unsafe_or_non_markdown_bound_output_rejected(self) -> None:
        request = self.request("speckit.plan")
        for path in ("../outside.md", "specs/<slug>/diagram.png"):
            altered = copy.deepcopy(request)
            altered["workflow"]["phaseOutputs"][0]["outputPath"] = path
            with self.assertRaisesRegex(ValueError, "Unsafe phase-output"):
                compile_blueprint(altered)

    def test_unsupported_topology_and_independent_item_roots_rejected(self) -> None:
        altered = self.request("speckit.plan")
        altered["workflow"]["topology"] = "branching"
        with self.assertRaisesRegex(ValueError, "Invalid request fields"):
            compile_blueprint(altered)
        with self.assertRaisesRegex(ValueError, "multiple independent item roots"):
            compile_blueprint(self.request("speckit.plan", "speckit.bug.assess"))

    def test_pinned_assess_bugfix_and_sdd_artifact_parity(self) -> None:
        pinned = PACKAGE / "tests" / "fixtures" / "pipelines"
        for name, extension_id in (("assess", "assess"), ("bugfix", "bug"), ("sdd", None)):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                workspace = Path(directory)
                (workspace / ".specify").mkdir()
                fixture = json.loads((pinned / f"{name}.json").read_text(encoding="utf-8"))
                ids = [item["id"] for item in fixture["snapshot"]["pipeline"]]
                phases = [phase if phase.startswith("speckit.") else f"speckit.{phase}"
                          for phase in ids]
                package_id = extension_id or "pipeline-canvas-generator"
                package = workspace / ".specify" / "extensions" / package_id
                (package / "config").mkdir(parents=True)
                (package / "commands").mkdir()
                outputs = {}
                artifacts = []
                for phase, artifact in zip(phases, fixture["expectedArtifacts"], strict=True):
                    outputs[phase] = (
                        {"kind": "artifact", "outputPath": artifact}
                        if artifact is not None else {"kind": "transient"}
                    )
                    if extension_id:
                        command_file = f"commands/{phase}.md"
                        (package / command_file).write_text("# Pinned parity command\n", encoding="utf-8")
                        layer = {
                            "sourceId": package_id, "layer": "extension",
                            "strategy": "replace", "active": True, "hidden": False,
                            "manifestPath": f".specify/extensions/{package_id}/extension.yml",
                            "lookupId": f"extension:{package_id}:command:{phase}",
                            "sourcePath": f".specify/extensions/{package_id}/{command_file}",
                        }
                    else:
                        layer = {
                            "sourceId": None, "layer": None, "strategy": "replace",
                            "active": True, "hidden": False, "manifestPath": None,
                            "lookupId": None, "sourcePath": None,
                        }
                    artifacts.append({"kind": "command", "name": phase, "stack": [layer]})
                file = "config/phase-outputs.json"
                (package / file).write_text(json.dumps({
                    "schemaVersion": 1, "default": {"kind": "unknown"}, "phases": outputs,
                }), encoding="utf-8")
                artifacts.append({
                    "kind": "template", "name": TEMPLATE_NAME, "stack": [{
                        "sourceId": package_id, "layer": "extension",
                        "strategy": "replace", "active": True, "hidden": False,
                        "manifestPath": f".specify/extensions/{package_id}/extension.yml",
                        "lookupId": f"extension:{package_id}:template:{TEMPLATE_NAME}",
                        "sourcePath": f".specify/extensions/{package_id}/{file}",
                    }],
                })
                (package / "extension.yml").write_text(yaml.safe_dump({
                    "schema_version": "1.0",
                    "extension": {"id": package_id, "name": package_id, "version": "0.1.0"},
                    "provides": {"templates": [{"name": TEMPLATE_NAME, "file": file}]},
                    "tags": ["canvas-design"] if extension_id is None else [],
                }), encoding="utf-8")
                if extension_id:
                    shutil.copytree(
                        FIXTURES / "installed" / "extensions" / "pipeline-canvas-generator",
                        workspace / ".specify" / "extensions" / "pipeline-canvas-generator",
                    )
                extensions = [{
                    "id": package_id, "version": "0.1.0", "priority": 100,
                    "enabled": True, "source": {"kind": "local"},
                }]
                if extension_id:
                    extensions.append({
                        "id": "pipeline-canvas-generator", "version": "0.1.0",
                        "priority": 100, "enabled": True, "source": {"kind": "local"},
                    })
                request = read_json(prepare_request(
                    workspace, phases, "fixture-workflow", "Fixture Workflow",
                    False, inventory={
                        "artifacts": artifacts, "presets": [],
                        "extensions": extensions,
                    },
                    phase_outputs=[
                        {"commandName": phase, "expectsArtifact": path is not None,
                         "outputPath": path}
                        for phase, path in zip(phases, fixture["expectedArtifacts"], strict=True)
                    ],
                ))
                blueprint = compile_blueprint(request)
                self.assertEqual(
                    [step["skillName"] for step in blueprint["pipeline"]["steps"]],
                    fixture["expectedSkills"],
                )
                self.assertEqual(
                    [step["artifact"]["outputPath"] for step in blueprint["pipeline"]["steps"]],
                    fixture["expectedArtifacts"],
                )
                self.assertEqual(
                    [row["commandName"] for row in blueprint["phaseOutputs"]], phases,
                )


if __name__ == "__main__":
    unittest.main()
