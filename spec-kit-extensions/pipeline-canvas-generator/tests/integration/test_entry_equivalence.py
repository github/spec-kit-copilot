"""Wizard inventory and standalone capture produce the same generated authority."""

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
from receipt import write_receipt  # noqa: E402
from request import prepare_request  # noqa: E402
from staging import atomic_json, materialize_candidate, read_json  # noqa: E402


class EntryEquivalence(unittest.TestCase):
    def test_confirmed_order_config_and_runtime_providers_match(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace = Path(directory)
            shutil.copytree(FIXTURES / "installed", workspace / ".specify")
            inventory = {
                "artifacts": json.loads((FIXTURES / "mixed-stack.json").read_text(encoding="utf-8")),
                "presets": json.loads((FIXTURES / "installed-presets.json").read_text(encoding="utf-8")),
                "extensions": json.loads((FIXTURES / "installed-extensions.json").read_text(encoding="utf-8")),
            }
            for phases in (["speckit.plan", "speckit.analyze"], ["speckit.bug.assess"]):
                with self.subTest(phases=phases):
                    with patch("request._preflight"), patch("request.capture_inventory", return_value=inventory):
                        wizard = prepare_request(
                            workspace, phases, "equivalent", "Equivalent Canvas",
                            False, inventory=inventory,
                        )
                        standalone = prepare_request(
                            workspace, phases, "equivalent", "Equivalent Canvas", False,
                        )
                    self.assertEqual(wizard.read_bytes(), standalone.read_bytes())
                    scaffold = PACKAGE / "tests" / "fixtures" / "scaffold"
                    results = []
                    for request in (wizard, standalone):
                        atomic_json(request.with_name("command-override-draft.json"), {"categories": {}})
                        prepare_override(request)
                        candidate = materialize_candidate(request, scaffold)
                        write_receipt(request, scaffold)
                        results.append({
                            "pipeline": read_json(candidate / "pipeline.json"),
                            "experience": read_json(candidate / "canvas-experience.json"),
                            "receipt": read_json(candidate / ".speckit-canvas.json"),
                        })
                    self.assertEqual(results[0], results[1])
                    self.assertEqual(
                        [step["commandName"] for step in results[0]["pipeline"]["pipeline"]["steps"]],
                        phases,
                    )
                    if phases == ["speckit.bug.assess"]:
                        self.assertIn(
                            {"kind": "extension", "id": "runtime-assess", "version": "0.1.0"},
                            results[0]["receipt"]["runtimeProviders"],
                        )


if __name__ == "__main__":
    unittest.main()
