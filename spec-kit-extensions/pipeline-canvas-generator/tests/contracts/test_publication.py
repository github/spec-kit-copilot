"""Absent-target publication and one authoritative, post-open outcome."""

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
from publication import publish_candidate, record_outcome, verify_published_target  # noqa: E402
from receipt import write_receipt  # noqa: E402
from contracts.handoff import prepare_request  # noqa: E402
from staging import atomic_json, materialize_candidate, read_json  # noqa: E402


class PublicationContracts(unittest.TestCase):
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
        self.scaffold = PACKAGE / "tests" / "fixtures" / "scaffold"
        materialize_candidate(self.request, self.scaffold)
        write_receipt(self.request, self.scaffold)

    def test_publication_requires_provider_verification_before_result(self) -> None:
        target = publish_candidate(self.request, self.scaffold)
        self.assertEqual(target, self.workspace / ".github" / "extensions" / "my-canvas")
        self.assertEqual(verify_published_target(self.request), target)
        self.assertFalse(self.request.with_name("result.json").exists())
        with self.assertRaisesRegex(ValueError, "inspected provider"):
            record_outcome(self.request, provider_id="user:my-canvas", opened_instance="canvas-1")
        with self.assertRaisesRegex(ValueError, "Existing canvas target"):
            publish_candidate(self.request, self.scaffold)
        self.assertTrue(target.is_dir())
        outcome = record_outcome(
            self.request, provider_id="project:my-canvas", opened_instance="canvas-1",
        )
        self.assertEqual(read_json(outcome)["status"], "succeeded")
        with self.assertRaisesRegex(ValueError, "already recorded"):
            record_outcome(self.request, provider_id="project:my-canvas", opened_instance="canvas-1")

    def test_failed_and_changed_target_never_get_success(self) -> None:
        target = publish_candidate(self.request, self.scaffold)
        (target / "pipeline.json").write_text("{}", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "changed"):
            record_outcome(self.request, provider_id="project:my-canvas", opened_instance="canvas-1")
        outcome = record_outcome(self.request, error_code="readback_failed", details="Target changed.")
        self.assertEqual(read_json(outcome)["status"], "failed")
        self.assertTrue(target.is_dir())


if __name__ == "__main__":
    unittest.main()
