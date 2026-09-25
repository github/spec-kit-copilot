"""Exercise the released Specify JSON and installed-manifest contract."""

import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from packaging.version import Version


FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "specify"
PACKAGE = Path(__file__).resolve().parents[2]
MINIMUM_VERSION = Version("1.0.7")


def specify(*args: str, cwd: Path) -> str:
    process = subprocess.run(
        ["specify", *args], cwd=cwd, text=True, encoding="utf-8",
        capture_output=True, check=False
    )
    if process.returncode:
        raise AssertionError(
            f"specify {' '.join(args)} failed ({process.returncode}): {process.stderr}"
        )
    return process.stdout


class ReleasedSpecifyContracts(unittest.TestCase):
    def test_json_inventory_and_installed_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            (project / ".specify").mkdir()
            version = specify("--version", cwd=project).strip().split()[-1]
            self.assertGreaterEqual(Version(version), MINIMUM_VERSION)

            for group in ("artifact", "preset", "extension"):
                self.assertIsInstance(
                    json.loads(specify(group, "list", "--json", cwd=project)), list
                )

            specify(
                "extension", "add", str(FIXTURE), "--dev", "--priority", "100",
                cwd=project,
            )
            packages = json.loads(specify("extension", "list", "--json", cwd=project))
            package = next(row for row in packages if row["id"] == "sample-canvas-design")
            for field in ("id", "version", "priority", "enabled", "source"):
                self.assertIn(field, package)
            self.assertEqual(package["priority"], 100)
            installed_manifest = project / ".specify" / "extensions" / package["id"] / "extension.yml"
            self.assertTrue(installed_manifest.is_file())
            self.assertIn("canvas-design", installed_manifest.read_text(encoding="utf-8"))

            artifacts = json.loads(specify("artifact", "list", "--json", cwd=project))
            for kind, name in (
                ("command", "speckit.sample-canvas-design.helper"),
                ("template", "canvas-presentation"),
            ):
                row = next(
                    item for item in artifacts
                    if item["kind"] == kind and item["name"] == name
                )
                self.assertIsInstance(row["stack"], list)
                self.assertTrue(row["stack"])
                for field in (
                    "sourceId", "layer", "strategy", "active", "hidden",
                    "manifestPath", "lookupId", "sourcePath",
                ):
                    self.assertIn(field, row["stack"][0])

    def test_preset_replaces_shared_phase_output_template(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            (project / ".specify").mkdir()
            preset = project / "phase-output-preset"
            (preset / "config").mkdir(parents=True)
            (preset / "config" / "phase-outputs.json").write_text(
                '{"schemaVersion":1,"default":{"kind":"unknown"},"phases":{'
                '"speckit.custom.phase":{"kind":"transient"}}}', encoding="utf-8",
            )
            (preset / "preset.yml").write_text(
                'schema_version: "1.0"\n'
                "preset:\n  id: phase-output-preset\n  name: Phase Output Preset\n"
                '  version: "1.0.0"\n  description: Custom phase outputs.\n'
                "  author: tests\n  repository: https://github.com/github/spec-kit-copilot\n"
                "  license: MIT\n"
                'requires:\n  speckit_version: ">=1.0.7"\n'
                "provides:\n  templates:\n    - type: template\n"
                "      name: phase-outputs\n      file: config/phase-outputs.json\n"
                "tags:\n  - canvas-design\n",
                encoding="utf-8",
            )
            specify("extension", "add", str(PACKAGE), "--dev", "--priority", "100", cwd=project)
            specify("preset", "add", "--dev", str(preset), cwd=project)
            rows = json.loads(specify("artifact", "list", "--json", cwd=project))
            template = next(row for row in rows if row["kind"] == "template"
                            and row["name"] == "phase-outputs")
            active = [layer for layer in template["stack"] if layer["active"]]
            self.assertEqual(len(active), 1)
            self.assertEqual(active[0]["sourceId"], "phase-output-preset")
            self.assertTrue(any(layer["sourceId"] == "pipeline-canvas-generator"
                                for layer in template["stack"]))


if __name__ == "__main__":
    unittest.main()
