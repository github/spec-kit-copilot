"""Exercise the released Specify JSON and installed-manifest contract."""

import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from packaging.version import Version


FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "specify"
MINIMUM_VERSION = Version("1.0.7")


def specify(*args: str, cwd: Path) -> str:
    process = subprocess.run(
        ["specify", *args], cwd=cwd, text=True, capture_output=True, check=False
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
                ("template", "canvas-content"),
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


if __name__ == "__main__":
    unittest.main()
