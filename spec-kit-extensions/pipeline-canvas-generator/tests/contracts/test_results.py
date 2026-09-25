"""Configured canvas-result shapes are finite and never inferred."""

import copy
import sys
import unittest
from pathlib import Path

PACKAGE = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PACKAGE / "scripts" / "lib"))

from experience import default_document, validate_complete_category  # noqa: E402


def configured(source=None):
    return {
        "label": "Outcome",
        "values": [
            {"id": "ready", "label": "Ready", "tone": "positive"},
            {"id": "blocked", "label": "Blocked", "tone": "attention"},
        ],
        "source": source or {"kind": "phase-report"},
        "summary": True,
    }


class CanvasResultsContract(unittest.TestCase):
    def setUp(self) -> None:
        self.document = default_document(PACKAGE, "canvas-results")

    def validate(self, document):
        return validate_complete_category("canvas-results", document, PACKAGE)

    def test_absent_default_does_not_infer_a_result(self) -> None:
        self.assertNotIn("defaultResult", self.validate(self.document))
        self.assertEqual(self.document["phases"], {})

    def test_global_default_phase_replacement_and_disable(self) -> None:
        document = copy.deepcopy(self.document)
        document["defaultResult"] = configured()
        document["phases"] = {
            "speckit.plan": configured({"kind": "artifact-field", "field": "status"}),
            "speckit.analyze": {"disabled": True},
        }
        self.assertEqual(self.validate(document), document)
        self.assertNotEqual(document["defaultResult"], document["phases"]["speckit.plan"])

    def test_finite_values_unique_ids_and_semantic_tones(self) -> None:
        for value in ([], [configured()["values"][0]] * 21):
            with self.subTest(count=len(value)):
                document = copy.deepcopy(self.document)
                document["defaultResult"] = {**configured(), "values": value}
                with self.assertRaises(ValueError):
                    self.validate(document)
        for change in (
            {"values": [configured()["values"][0]] * 2},
            {"values": [{"id": "ready", "label": "Ready", "tone": "unknown"}]},
        ):
            document = copy.deepcopy(self.document)
            document["defaultResult"] = {**configured(), **change}
            with self.assertRaises(ValueError):
                self.validate(document)
        for tone in ("neutral", "info", "positive", "attention", "critical"):
            document = copy.deepcopy(self.document)
            document["defaultResult"] = {
                **configured(), "values": [{"id": "ready", "label": "Ready", "tone": tone}],
            }
            self.validate(document)

    def test_explicit_single_source_rejects_computed_and_fallbacks(self) -> None:
        for source in (
            {"kind": "computed"},
            {"kind": "phase-report", "field": "status"},
            {"kind": "artifact-field"},
            {"kind": "artifact-field", "field": "status", "fallback": "phase-report"},
        ):
            document = copy.deepcopy(self.document)
            document["defaultResult"] = configured(source)
            with self.subTest(source=source), self.assertRaises(ValueError):
                self.validate(document)
        document = copy.deepcopy(self.document)
        document["defaultResult"] = {**configured(), "secondaryResult": configured()}
        with self.assertRaises(ValueError):
            self.validate(document)


if __name__ == "__main__":
    unittest.main()
