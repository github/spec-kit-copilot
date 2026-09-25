"""Regeneration validates a fresh candidate before exact-target replacement."""

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
from publication import regenerate_candidate  # noqa: E402
from receipt import write_receipt  # noqa: E402
from contracts.handoff import prepare_request  # noqa: E402
from staging import atomic_json, materialize_candidate  # noqa: E402


class RegenerationJourney(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.workspace = Path(directory.name)
        shutil.copytree(FIXTURES / "installed", self.workspace / ".specify")
        self.inventory = {
            name: json.loads((FIXTURES / filename).read_text(encoding="utf-8"))
            for name, filename in (
                ("artifacts", "mixed-stack.json"),
                ("presets", "installed-presets.json"),
                ("extensions", "installed-extensions.json"),
            )
        }
        self.target = self.workspace / ".github" / "extensions" / "my-canvas"
        self.target.mkdir(parents=True)
        (self.target / "manual.txt").write_text("user edits", encoding="utf-8")
        with patch("request._preflight"):
            self.request = prepare_request(
                self.workspace, ["speckit.plan"], "my-canvas", "My Canvas",
                True, inventory=self.inventory,
            )
        self.scaffold = PACKAGE / "tests" / "fixtures" / "scaffold"

    def stage(self) -> None:
        atomic_json(self.request.with_name("command-override-draft.json"), {"categories": {}})
        prepare_override(self.request)
        materialize_candidate(self.request, self.scaffold)
        write_receipt(self.request, self.scaffold)

    def test_confirmation_and_invalid_candidate_preserve_manual_edits(self) -> None:
        with self.assertRaisesRegex(ValueError, "confirmation"):
            regenerate_candidate(self.request, self.scaffold, "not-the-target")
        with self.assertRaises(ValueError):
            regenerate_candidate(self.request, self.scaffold, str(self.target))
        self.assertEqual((self.target / "manual.txt").read_text(encoding="utf-8"), "user edits")

    def test_unrecognized_target_replaced_only_after_confirmation(self) -> None:
        self.stage()
        self.assertEqual(
            regenerate_candidate(self.request, self.scaffold, str(self.target)), self.target
        )
        self.assertFalse((self.target / "manual.txt").exists())
        self.assertTrue((self.target / ".speckit-canvas.json").is_file())

    def test_lock_contention_preserves_target(self) -> None:
        self.stage()
        lock = self.target.parent / ".my-canvas.lock"
        lock.mkdir()
        with self.assertRaisesRegex(ValueError, "target lock"):
            regenerate_candidate(self.request, self.scaffold, str(self.target))
        self.assertTrue((self.target / "manual.txt").exists())

    def test_partial_publication_recovers_with_new_confirmed_request(self) -> None:
        self.stage()
        original_copy = shutil.copyfile
        with patch("publication.shutil.copyfile", side_effect=OSError("locked destination")):
            with self.assertRaisesRegex(OSError, "locked destination"):
                regenerate_candidate(self.request, self.scaffold, str(self.target))
        self.assertFalse((self.target / "manual.txt").exists())
        self.assertFalse((self.target.parent / ".my-canvas.lock").exists())
        with patch("request._preflight"):
            self.request = prepare_request(
                self.workspace, ["speckit.plan"], "my-canvas", "My Canvas",
                True, inventory=self.inventory,
            )
        self.stage()
        with patch("publication.shutil.copyfile", wraps=original_copy):
            regenerate_candidate(self.request, self.scaffold, str(self.target))
        self.assertTrue((self.target / ".speckit-canvas.json").is_file())

    def test_link_inside_target_is_rejected_without_deletion(self) -> None:
        self.stage()
        try:
            (self.target / "linked").symlink_to(self.workspace / ".specify", target_is_directory=True)
        except (OSError, NotImplementedError):
            self.skipTest("Symlink creation unavailable on this host")
        with self.assertRaisesRegex(ValueError, "link"):
            regenerate_candidate(self.request, self.scaffold, str(self.target))
        self.assertTrue((self.target / "manual.txt").exists())


if __name__ == "__main__":
    unittest.main()
