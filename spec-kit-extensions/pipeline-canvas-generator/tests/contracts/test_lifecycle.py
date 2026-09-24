"""Inspect and remove only an intact, confirmed generated target."""

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

from lifecycle import inspect_target, remove_target  # noqa: E402
from override import prepare_override  # noqa: E402
from publication import publish_candidate  # noqa: E402
from receipt import write_receipt  # noqa: E402
from request import prepare_request  # noqa: E402
from staging import atomic_json, materialize_candidate  # noqa: E402


class LifecycleContracts(unittest.TestCase):
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
            request = prepare_request(
                self.workspace, ["speckit.plan"], "my-canvas", "My Canvas",
                False, inventory=inventory,
            )
        atomic_json(request.with_name("command-override-draft.json"), {"categories": {}})
        prepare_override(request)
        scaffold = PACKAGE / "tests" / "fixtures" / "scaffold"
        materialize_candidate(request, scaffold)
        write_receipt(request, scaffold)
        self.target = publish_candidate(request, scaffold)

    def test_inspect_and_confirmed_remove(self) -> None:
        report = inspect_target(self.workspace, "my-canvas")
        self.assertEqual(report["target"], str(self.target))
        self.assertEqual(report["canvasId"], "my-canvas")
        self.assertGreater(report["fileCount"], 1)
        with self.assertRaisesRegex(ValueError, "exact target"):
            remove_target(self.workspace, "my-canvas", "my-canvas")
        self.assertTrue(self.target.is_dir())
        self.assertEqual(remove_target(self.workspace, "my-canvas", str(self.target)), report)
        self.assertFalse(self.target.exists())
        self.assertFalse((self.target.parent / ".my-canvas.lock").exists())

    def test_modified_or_unrecognized_target_is_not_removed(self) -> None:
        (self.target / "pipeline.json").write_text("{}", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "changed"):
            remove_target(self.workspace, "my-canvas", str(self.target))
        self.assertTrue(self.target.is_dir())
        (self.target / "pipeline.json").unlink()
        (self.target / ".speckit-canvas.json").unlink()
        with self.assertRaises(ValueError):
            remove_target(self.workspace, "my-canvas", str(self.target))
        self.assertTrue(self.target.is_dir())

    def test_extra_file_and_link_block_remove(self) -> None:
        (self.target / "manual.txt").write_text("keep me", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "unexpected"):
            remove_target(self.workspace, "my-canvas", str(self.target))
        (self.target / "manual.txt").unlink()
        outside = self.workspace / "outside"
        outside.write_text("safe", encoding="utf-8")
        try:
            (self.target / "link").symlink_to(outside)
        except (OSError, NotImplementedError):
            self.skipTest("Creating symlinks requires elevated permission")
        with self.assertRaisesRegex(ValueError, "link"):
            remove_target(self.workspace, "my-canvas", str(self.target))
        self.assertEqual(outside.read_text(encoding="utf-8"), "safe")
        self.assertTrue(self.target.is_dir())


if __name__ == "__main__":
    unittest.main()
