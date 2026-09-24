"""Require the current SDK canvas scaffold before materialization."""

import sys
import tempfile
import unittest
from pathlib import Path


PACKAGE = Path(__file__).resolve().parents[2]
FIXTURE = PACKAGE / "tests" / "fixtures" / "scaffold" / "extension.mjs"
sys.path.insert(0, str(PACKAGE / "scripts" / "lib"))

from staging import validate_canvas_scaffold  # noqa: E402


class ScaffoldContracts(unittest.TestCase):
    def test_fresh_canvas_scaffold_has_sdk_server_actions_and_close(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            entry = Path(directory) / "extension.mjs"
            entry.write_bytes(FIXTURE.read_bytes())
            self.assertEqual(len(validate_canvas_scaffold(Path(directory))["sha256"]), 64)
            entry.write_text("export const fake = 'joinSession createCanvas';\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "SDK extension import"):
                validate_canvas_scaffold(Path(directory))

    def test_absent_scaffold_is_not_treated_as_default(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, "Missing"):
                validate_canvas_scaffold(Path(directory))


if __name__ == "__main__":
    unittest.main()
