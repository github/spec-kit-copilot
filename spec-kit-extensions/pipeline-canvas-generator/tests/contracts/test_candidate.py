"""Reject candidate corruption before any project extension target is written."""

import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


PACKAGE = Path(__file__).resolve().parents[2]
FIXTURES = PACKAGE / "tests" / "fixtures" / "composition"
sys.path.insert(0, str(PACKAGE / "scripts" / "lib"))

from override import prepare_override  # noqa: E402
from request import prepare_request  # noqa: E402
from staging import atomic_json, materialize_candidate  # noqa: E402
from validation import validate_candidate  # noqa: E402


class CandidateContracts(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.workspace = Path(directory.name)
        shutil.copytree(FIXTURES / "installed", self.workspace / ".specify")
        inventory = {
            "artifacts": json.loads((FIXTURES / "mixed-stack.json").read_text(encoding="utf-8")),
            "presets": json.loads((FIXTURES / "installed-presets.json").read_text(encoding="utf-8")),
            "extensions": json.loads((FIXTURES / "installed-extensions.json").read_text(encoding="utf-8")),
        }
        with patch("request._preflight"):
            self.request = prepare_request(
                self.workspace, ["speckit.plan"], "my-canvas", "My Canvas",
                False, inventory=inventory,
            )
        atomic_json(self.request.with_name("command-override-draft.json"), {"categories": {}})
        prepare_override(self.request)
        self.candidate = materialize_candidate(
            self.request, PACKAGE / "tests" / "fixtures" / "scaffold"
        )
        self.scaffold = PACKAGE / "tests" / "fixtures" / "scaffold"

    def test_complete_candidate_has_hashes_and_target_remains_absent(self) -> None:
        hashes = validate_candidate(self.request, self.scaffold)
        self.assertIn("extension.mjs", hashes)
        self.assertIn("ui/app.js", hashes)
        self.assertFalse(any(name.startswith("renderer/") for name in hashes))
        self.assertIn("canvas-experience.json", hashes)
        self.assertFalse((self.workspace / ".github" / "extensions" / "my-canvas").exists())

    def test_modified_missing_and_extra_candidate_files_fail(self) -> None:
        file = self.candidate / "pipeline.json"
        original = file.read_bytes()
        file.write_bytes(b"{}")
        with self.assertRaisesRegex(ValueError, "modified candidate"):
            validate_candidate(self.request, self.scaffold)
        file.write_bytes(original)
        file.unlink()
        with self.assertRaisesRegex(ValueError, "missing declared files"):
            validate_candidate(self.request, self.scaffold)
        file.write_bytes(original)
        extra = self.candidate / "unexpected.mjs"
        extra.write_text("export default 1;\n", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "Unexpected or modified"):
            validate_candidate(self.request, self.scaffold)


if __name__ == "__main__":
    unittest.main()
