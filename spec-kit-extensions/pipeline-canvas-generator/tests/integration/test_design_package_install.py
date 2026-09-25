"""Install the sample design package and built bundle in an isolated project."""

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[4]
PRESET = ROOT / "spec-kit-presets" / "copilot-canvas-studio"
BUNDLE = ROOT / "spec-kit-bundles" / "copilot-canvas-studio"


@unittest.skipUnless(shutil.which("specify"), "Specify CLI required for live package install")
class DesignPackageInstall(unittest.TestCase):
    def test_bundle_artifact_preserves_an_independently_installed_design_preset(self) -> None:
        with tempfile.TemporaryDirectory(prefix="canvas-design-install-") as temporary:
            workspace = Path(temporary) / "project"
            workspace.mkdir()
            output = Path(temporary) / "artifacts"
            output.mkdir()

            def run(*args):
                result = subprocess.run(
                    ["specify", *args], cwd=workspace, capture_output=True, text=True,
                    encoding="utf-8", errors="replace", timeout=160, check=False,
                )
                self.assertEqual(result.returncode, 0,
                                 f"specify {' '.join(args)}:\n{result.stdout}\n{result.stderr}")
                return result.stdout

            run("init", "--here", "--force", "--integration", "copilot",
                "--integration-options=--skills", "--script", "py", "--ignore-agent-tools")
            run("preset", "add", "--dev", str(PRESET))
            run("bundle", "build", "--path", str(BUNDLE), "--output", str(output))
            archive = output / "copilot-canvas-studio-1.0.0.zip"
            self.assertTrue(archive.is_file())
            run("bundle", "install", str(archive), "--offline")
            bundles = json.loads(run("bundle", "list", "--json"))
            self.assertEqual(bundles[0]["bundle_id"], "copilot-canvas-studio")
            self.assertEqual(bundles[0]["contributed_components"], [])
            run("bundle", "remove", "copilot-canvas-studio")
            self.assertEqual(json.loads(run("bundle", "list", "--json")), [])
            presets = json.loads(run("preset", "list", "--json"))
            self.assertTrue(any(item["id"] == "copilot-canvas-studio" for item in presets))


if __name__ == "__main__":
    unittest.main()
