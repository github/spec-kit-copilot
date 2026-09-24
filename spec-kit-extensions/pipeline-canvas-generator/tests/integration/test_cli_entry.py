"""Standalone Specify installation must not bypass generation policy."""

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


PACKAGE = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PACKAGE / "scripts" / "lib"))

from request import prepare_request  # noqa: E402
from staging import read_json  # noqa: E402


def specify(workspace: Path, *args: str) -> str:
    result = subprocess.run(
        ["specify", *args], cwd=workspace, capture_output=True, text=True, check=False,
    )
    if result.returncode:
        raise AssertionError(f"specify {' '.join(args)} failed: {result.stderr or result.stdout}")
    return result.stdout


class StandaloneEntryContracts(unittest.TestCase):
    def test_bare_python_without_canvas_authoring_host_does_not_publish(self) -> None:
        fixtures = PACKAGE / "tests" / "fixtures" / "composition"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shutil.copytree(fixtures / "installed", root / ".specify")
            inventory = {
                "artifacts": json.loads((fixtures / "mixed-stack.json").read_text(encoding="utf-8")),
                "presets": json.loads((fixtures / "installed-presets.json").read_text(encoding="utf-8")),
                "extensions": json.loads((fixtures / "installed-extensions.json").read_text(encoding="utf-8")),
            }
            with patch("request._preflight"):
                request = prepare_request(
                    root, ["speckit.plan"], "sample-canvas", "Sample Canvas",
                    False, inventory=inventory,
                )
            script = PACKAGE / "scripts" / "python" / "canvas_generate.py"
            attempt = subprocess.run(
                [sys.executable, str(script), "generate", "--request", str(request),
                 "--scaffold", str(root / "missing-host-scaffold")],
                cwd=root, capture_output=True, text=True, check=False,
            )
            self.assertNotEqual(attempt.returncode, 0)
            self.assertIn("scaffold", attempt.stderr.lower())
            self.assertFalse((root / ".github" / "extensions" / "sample-canvas").exists())
            self.assertEqual(read_json(request.with_name("result.json"))["status"], "failed")

    def test_unsupported_cli_version_rejects_before_request_creation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / ".specify").mkdir()
            with patch("request._run", return_value="specify 0.9.0"):
                with self.assertRaisesRegex(ValueError, "incompatible"):
                    prepare_request(root, ["speckit.plan"], "sample-canvas", "Sample Canvas", False)
            self.assertFalse((root / ".specify" / ".cache" / "canvas-generation").exists())

    def test_directly_installed_runtime_phase_without_output_binding_is_callable(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / ".specify").mkdir()
            package = root / "runtime-source"
            (package / "commands").mkdir(parents=True)
            (package / "commands" / "phase.md").write_text("# Runtime phase\n", encoding="utf-8")
            (package / "extension.yml").write_text(
                'schema_version: "1.0"\n'
                "extension:\n"
                "  id: runtime-phase\n"
                "  name: Runtime Phase\n"
                '  version: "1.0.0"\n'
                "  description: Runtime fixture.\n"
                "  category: process\n"
                "  effect: read-write\n"
                "  author: tests\n"
                "  repository: https://github.com/github/spec-kit-copilot\n"
                "  license: MIT\n"
                "requires:\n"
                '  speckit_version: ">=1.0.7"\n'
                "provides:\n"
                "  commands:\n"
                "    - name: speckit.runtime-phase.phase\n"
                "      file: commands/phase.md\n",
                encoding="utf-8",
            )
            specify(root, "extension", "add", str(package), "--dev")
            with self.assertRaisesRegex(ValueError, "installed canvas generator is required"):
                prepare_request(
                    root, ["speckit.runtime-phase.phase"], "sample-canvas", "Sample Canvas", False,
                )
            self.assertFalse((root / ".specify" / ".cache" / "canvas-generation").exists())
            specify(root, "extension", "add", str(PACKAGE), "--dev", "--priority", "100")
            path = prepare_request(
                root, ["speckit.runtime-phase.phase"], "sample-canvas", "Sample Canvas", False,
            )
            self.assertEqual(
                read_json(path)["workflow"]["phaseOutputs"][0]["contract"]["result"],
                {"kind": "unknown"},
            )

    def test_directly_installed_design_phase_rejected_without_request_or_stack_change(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / ".specify").mkdir()
            package = root / "design-runtime-source"
            (package / "commands").mkdir(parents=True)
            (package / "commands" / "phase.md").write_text(
                "# Design phase\n", encoding="utf-8",
            )
            (package / "extension.yml").write_text(
                'schema_version: "1.0"\n'
                "extension:\n"
                "  id: design-runtime\n"
                "  name: Design Runtime\n"
                '  version: "1.0.0"\n'
                "  description: Direct-installed design fixture.\n"
                "  category: process\n"
                "  effect: read-write\n"
                "  author: tests\n"
                "  repository: https://github.com/github/spec-kit-copilot\n"
                "  license: MIT\n"
                "requires:\n"
                '  speckit_version: ">=1.0.7"\n'
                "provides:\n"
                "  commands:\n"
                "    - name: speckit.design-runtime.phase\n"
                "      file: commands/phase.md\n"
                "tags:\n"
                "  - canvas-design\n",
                encoding="utf-8",
            )
            specify(root, "extension", "add", str(package), "--dev")
            self.assertFalse((root / ".github" / "extensions" / "sample-canvas").exists())
            original = json.loads(specify(root, "artifact", "list", "--json"))
            with self.assertRaisesRegex(
                ValueError, r"design-runtime.*speckit\.design-runtime\.phase",
            ):
                prepare_request(
                    root, ["speckit.design-runtime.phase"], "sample-canvas",
                    "Sample Canvas", False,
                )
            self.assertEqual(
                json.loads(specify(root, "artifact", "list", "--json")), original,
            )
            self.assertFalse((root / ".specify" / ".cache" / "canvas-generation").exists())


if __name__ == "__main__":
    unittest.main()
