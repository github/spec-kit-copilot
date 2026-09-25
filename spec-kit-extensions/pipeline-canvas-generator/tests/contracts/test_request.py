"""Shared composition and request-boundary regression tests."""

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


PACKAGE = Path(__file__).resolve().parents[2]
FIXTURES = PACKAGE / "tests" / "fixtures" / "composition"
sys.path.insert(0, str(PACKAGE / "scripts" / "lib"))

from artifact_snapshot import normalize_snapshot  # noqa: E402
from contracts.handoff import handoff, prepare_request  # noqa: E402
from request import validate_request  # noqa: E402
from staging import atomic_json, create_request_dir, read_json  # noqa: E402
from validation import confined_path, target_path  # noqa: E402


def fixture(name: str) -> object:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


class FixtureWorkspace(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.workspace = Path(self.directory.name)
        shutil.copytree(FIXTURES / "installed", self.workspace / ".specify")

    def snapshot(self) -> dict:
        return normalize_snapshot(
            fixture("mixed-stack.json"),
            fixture("installed-presets.json"),
            fixture("installed-extensions.json"),
            self.workspace,
        )


class SnapshotContracts(FixtureWorkspace):
    def test_installed_tags_and_exact_specify_stack(self) -> None:
        snapshot = self.snapshot()
        self.assertEqual(
            [(row["kind"], row["id"], row["classification"])
             for row in snapshot["packageClassifications"]],
            [
                ("preset", "customer-canvas-design", "canvas-design"),
                ("extension", "runtime-assess", "runtime"),
                ("extension", "pipeline-canvas-generator", "canvas-design"),
            ],
        )
        raw = fixture("mixed-stack.json")
        for original, normalized in zip(raw, snapshot["artifacts"], strict=True):
            self.assertEqual(
                [(part["sourceId"], part["active"], part["hidden"], part["strategy"])
                 for part in original["stack"]],
                [(part["sourceId"], part["active"], part["hidden"], part["strategy"])
                 for part in normalized["stack"]],
            )
        self.assertEqual(snapshot["compositionFingerprint"], self.snapshot()["compositionFingerprint"])

    def test_changed_tag_changes_fingerprint(self) -> None:
        before = self.snapshot()
        manifest = self.workspace / ".specify" / "presets" / "customer-canvas-design" / "preset.yml"
        manifest.write_text(manifest.read_text(encoding="utf-8").replace("canvas-design", "custom"),
                            encoding="utf-8")
        after = self.snapshot()
        self.assertNotEqual(before["compositionFingerprint"], after["compositionFingerprint"])

    def test_malformed_json_and_invalid_list_are_rejected(self) -> None:
        with self.assertRaises(json.JSONDecodeError):
            fixture("invalid-response.json")
        with self.assertRaisesRegex(ValueError, "JSON array"):
            normalize_snapshot({}, [], [], self.workspace)

    def test_missing_installed_manifest_does_not_default_to_runtime(self) -> None:
        (self.workspace / ".specify" / "extensions" / "runtime-assess" / "extension.yml").unlink()
        with self.assertRaisesRegex(ValueError, "Missing or unsafe"):
            self.snapshot()

    def test_target_and_request_paths_are_confined(self) -> None:
        target = target_path(self.workspace, "customer-workflow")
        self.assertEqual(target, self.workspace / ".github" / "extensions" / "customer-workflow")
        with self.assertRaisesRegex(ValueError, "canvas ID"):
            target_path(self.workspace, "../outside")
        with self.assertRaisesRegex(ValueError, "escapes"):
            confined_path(self.workspace, ".specify/../../outside")
        request_dir = create_request_dir(self.workspace)
        self.assertEqual(request_dir.parent, self.workspace / ".specify" / ".cache" / "canvas-generation")
        atomic_json(request_dir / "request.json", {"schemaVersion": 1})
        self.assertEqual(read_json(request_dir / "request.json"), {"schemaVersion": 1})

    def test_symlink_target_is_rejected(self) -> None:
        (self.workspace / ".github").mkdir()
        try:
            (self.workspace / ".github" / "extensions").symlink_to(
                self.workspace / ".specify", target_is_directory=True
            )
        except (OSError, NotImplementedError):
            self.skipTest("Creating a symlink is unavailable on this host")
        with self.assertRaisesRegex(ValueError, "Symlink"):
            target_path(self.workspace, "canvas")


class PreparationContracts(FixtureWorkspace):
    def inventory(self) -> dict:
        return {
            "artifacts": fixture("mixed-stack.json"),
            "presets": fixture("installed-presets.json"),
            "extensions": fixture("installed-extensions.json"),
        }

    def request_paths(self) -> list[Path]:
        root = self.workspace / ".specify" / ".cache" / "canvas-generation"
        return list(root.glob("*/request.json")) if root.exists() else []

    def test_tagged_contributor_rejects_phase_and_writes_no_request(self) -> None:
        with self.assertRaisesRegex(ValueError, r"customer-canvas-design.*speckit.assess.intake"):
            prepare_request(
                self.workspace, ["speckit.assess.intake"], "workflow",
                "Workflow", False, inventory=self.inventory(),
            )
        self.assertEqual(self.request_paths(), [])

    def test_valid_core_phase_preserves_order_and_binds_one_snapshot(self) -> None:
        inventory = self.inventory()
        path = prepare_request(
            self.workspace, ["speckit.plan", "speckit.analyze"], "workflow",
            "Workflow", False, inventory=inventory,
        )
        request = read_json(path)
        self.assertEqual(request["workflow"]["selectedPhases"], ["speckit.plan", "speckit.analyze"])
        self.assertEqual(
            [row["expectsArtifact"] for row in request["workflow"]["phaseOutputs"]],
            [True, False],
        )
        self.assertEqual(len(self.request_paths()), 1)
        self.assertEqual(request["workflow"]["artifactSnapshot"]["artifacts"][0]["name"],
                         "speckit.assess.intake")

    def test_generated_preset_skill_uses_specify_stack_independent_of_manifest_layout(self) -> None:
        preset = self.workspace / ".specify" / "presets" / "copilot-sub-agents"
        (preset / "commands").mkdir(parents=True)
        (preset / "commands" / "speckit.analyze.md").write_text("# Analyze\n", encoding="utf-8")
        skill = self.workspace / ".github" / "skills" / "speckit-analyze" / "SKILL.md"
        skill.parent.mkdir(parents=True)
        skill.write_text("# Analyze skill\n", encoding="utf-8")
        manifest = preset / "preset.yml"
        inventory = self.inventory()
        inventory["presets"].append({
            "id": "copilot-sub-agents", "name": "Copilot Sub-Agents",
            "version": "1.0.0", "priority": 1, "enabled": True,
            "source": {"kind": "local"},
        })
        analyze = next(row for row in inventory["artifacts"] if row["name"] == "speckit.analyze")
        analyze["stack"].insert(0, {
            "sourceId": "copilot-sub-agents", "layer": "preset", "strategy": "prepend",
            "active": True, "hidden": False,
            "manifestPath": ".specify/presets/copilot-sub-agents/preset.yml",
            "lookupId": "preset:copilot-sub-agents:command:speckit.analyze",
            "sourcePath": ".github/skills/speckit-analyze/SKILL.md",
        })
        declaration = "      name: speckit.analyze\n      file: commands/speckit.analyze.md\n"
        for provides in (
            "  templates:\n    - type: command\n" + declaration,
            "  commands:\n    -\n" + declaration,
            "  commands:\n    -\n" + declaration +
            "  templates:\n    - type: command\n" + declaration,
        ):
            with self.subTest(provides=provides):
                manifest.write_text(
                    "schema_version: '1.0'\npreset:\n  id: copilot-sub-agents\n"
                    "  version: '1.0.0'\nprovides:\n" + provides, encoding="utf-8",
                )
                path = prepare_request(
                    self.workspace, ["speckit.plan"], "workflow", "Workflow", False,
                    inventory=inventory,
                )
                self.assertEqual(read_json(path)["workflow"]["selectedPhases"], ["speckit.plan"])
        manifest.write_text(
            "schema_version: '1.0'\npreset:\n  id: copilot-sub-agents\n"
            "  version: '1.0.0'\nprovides:\n  templates:\n    - type: template\n"
            + declaration, encoding="utf-8",
        )
        path = prepare_request(
            self.workspace, ["speckit.plan"], "workflow", "Workflow", False,
            inventory=inventory,
        )
        self.assertEqual(read_json(path)["workflow"]["selectedPhases"], ["speckit.plan"])

    def test_missing_binding_and_malformed_inventory_write_no_request(self) -> None:
        with self.assertRaisesRegex(ValueError, "Missing selected phase command"):
            prepare_request(
                self.workspace, ["speckit.unknown"], "workflow",
                "Workflow", False, inventory=self.inventory(),
            )
        with self.assertRaisesRegex(ValueError, "JSON array"):
            prepare_request(
                self.workspace, ["speckit.analyze"], "workflow",
                "Workflow", False, inventory={"artifacts": {}, "presets": [], "extensions": []},
            )
        self.assertEqual(self.request_paths(), [])

    def test_tampered_fingerprint_and_unknown_request_field_fail(self) -> None:
        inventory = self.inventory()
        path = prepare_request(
            self.workspace, ["speckit.analyze"], "workflow",
            "Workflow", False, inventory=inventory,
        )
        original = read_json(path)
        with self.assertRaisesRegex(ValueError, "Invalid request fields"):
            validate_request(original | {"unauthorized": True})
        fingerprint = original["workflow"]["artifactSnapshot"]["compositionFingerprint"]
        original["workflow"]["artifactSnapshot"]["compositionFingerprint"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "fingerprint"):
            validate_request(original)
        original["workflow"]["artifactSnapshot"]["compositionFingerprint"] = fingerprint
        original["workflow"]["phaseOutputs"][0]["commandName"] = "speckit.plan"
        with self.assertRaisesRegex(ValueError, "unordered phase-output"):
            validate_request(original)

    def test_wizard_inventory_adapter_uses_shared_request(self) -> None:
        script = PACKAGE / "scripts" / "python" / "canvas_generate.py"
        result = subprocess.run(
            [
                sys.executable, str(script), "prepare-request",
                "--workspace", str(self.workspace),
                "--phase", "speckit.assess.intake",
                "--canvas-id", "workflow",
                "--display-name", "Workflow",
                "--phase-outputs-json", json.dumps(handoff(["speckit.assess.intake"])),
                "--inventory-stdin",
            ],
            input=json.dumps(self.inventory()), text=True, capture_output=True,
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("customer-canvas-design", result.stderr)
        self.assertEqual(self.request_paths(), [])

    def test_standalone_adapter_captures_specify_inventory(self) -> None:
        script = PACKAGE / "scripts" / "python" / "canvas_generate.py"
        with tempfile.TemporaryDirectory() as directory:
            workspace = Path(directory)
            (workspace / ".specify").mkdir()
            fixture_extension = PACKAGE / "tests" / "fixtures" / "specify" / "core-generator"
            installed = subprocess.run(
                ["specify", "extension", "add", str(fixture_extension), "--dev", "--priority", "100"],
                cwd=workspace, text=True, capture_output=True, check=False,
            )
            self.assertEqual(installed.returncode, 0, installed.stderr)
            result = subprocess.run(
                [
                    sys.executable, str(script), "prepare-request",
                    "--workspace", str(workspace),
                    "--phase", "speckit.analyze",
                    "--canvas-id", "workflow",
                    "--display-name", "Workflow",
                    "--phase-outputs-json", json.dumps(handoff(["speckit.analyze"])),
                ],
                text=True, capture_output=True, check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            path = Path(json.loads(result.stdout)["requestPath"])
            self.assertEqual(read_json(path)["workflow"]["selectedPhases"], ["speckit.analyze"])


if __name__ == "__main__":
    unittest.main()
