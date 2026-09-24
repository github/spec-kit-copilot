"""Complete generator-owned experience documents and required shapes."""

import copy
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


PACKAGE = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PACKAGE / "scripts" / "lib"))

from experience import default_experience, validate_complete_category  # noqa: E402
from override import CATEGORY_FIELDS, prepare_override  # noqa: E402
from publication import publish_candidate, record_outcome  # noqa: E402
from receipt import write_receipt  # noqa: E402
from request import prepare_request  # noqa: E402
from staging import atomic_json, materialize_candidate, read_json  # noqa: E402


class DefaultExperienceContracts(unittest.TestCase):
    def test_six_complete_schema_valid_documents(self) -> None:
        profile = default_experience(PACKAGE)
        self.assertEqual(profile["schemaVersion"], 1)
        self.assertEqual(set(profile["categories"]), set(CATEGORY_FIELDS))
        self.assertNotIn("defaultResult", profile["categories"]["canvas-results"])
        self.assertTrue(profile["categories"]["canvas-results"]["clarification"]["enabled"])
        self.assertTrue(profile["categories"]["canvas-results"]["progress"]["enabled"])

    def test_unknown_missing_and_wrong_typed_values_fail(self) -> None:
        category = default_experience(PACKAGE)["categories"]["canvas-layout"]
        for key, value in (("bogus", 1), ("navigation", None), ("phases", {"showDescriptions": "yes"}), ("schemaVersion", True)):
            with self.subTest(key=key):
                altered = copy.deepcopy(category)
                altered[key] = value
                with self.assertRaises(ValueError):
                    validate_complete_category("canvas-layout", altered, PACKAGE)


class ExperienceDraftContracts(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        workspace = Path(temporary.name)
        fixtures = PACKAGE / "tests" / "fixtures" / "composition"
        shutil.copytree(fixtures / "installed", workspace / ".specify")
        inventory = {
            "artifacts": json.loads((fixtures / "mixed-stack.json").read_text(encoding="utf-8")),
            "presets": json.loads((fixtures / "installed-presets.json").read_text(encoding="utf-8")),
            "extensions": json.loads((fixtures / "installed-extensions.json").read_text(encoding="utf-8")),
        }
        with patch("request._preflight"):
            self.request = prepare_request(
                workspace, ["speckit.plan"], "my-canvas", "My Canvas",
                False, inventory=inventory,
            )

    def test_nonempty_draft_uses_same_finalizer_and_request_digest(self) -> None:
        atomic_json(self.request.with_name("command-override-draft.json"), {
            "categories": {"canvas-layout": {"phases": {"showDescriptions": False}}},
        })
        result = read_json(prepare_override(self.request))
        self.assertFalse(result["categories"]["canvas-layout"]["phases"]["showDescriptions"])
        self.assertEqual(len(result["requestSha256"]), 64)

    def test_invalid_nested_path_fails_before_finalized_override(self) -> None:
        atomic_json(self.request.with_name("command-override-draft.json"), {
            "categories": {"canvas-layout": {"navigation": {"executable": "alert(1)"}}},
        })
        with self.assertRaisesRegex(ValueError, "Unsupported sparse override path"):
            prepare_override(self.request)
        self.assertFalse(self.request.with_name("command-override.json").exists())

    def test_protected_and_null_fields_fail_before_finalization(self) -> None:
        for categories in (
            {"canvas-content": {"schemaVersion": 2}},
            {"canvas-layout": {"navigation": {"style": None}}},
            {"canvas-content": {"copy": {"script": "alert(1)"}}},
            {"canvas-content": {"copy": {"new": "<script>alert(1)</script>"}}},
            {"canvas-theme": {"colors": {"customToken": "#123456"}}},
            {"canvas-theme": {"brand": {"logo": {"mode": "asset", "path": "https://example.com/logo.png", "alt": "Logo"}}}},
            {"canvas-theme": {"brand": {"logo": {"mode": "none", "path": "logo.png"}}}},
            {"canvas-results": {"defaultResult": {"source": {"kind": "phase-report", "field": "status"}}}},
            {"canvas-layout": {"responsive": {"mobile": True}}},
        ):
            with self.subTest(categories=categories):
                atomic_json(self.request.with_name("command-override-draft.json"), {"categories": categories})
                with self.assertRaises(ValueError):
                    prepare_override(self.request)
                self.assertFalse(self.request.with_name("command-override.json").exists())

    def test_result_values_replace_whole_array_and_phase_maps_merge_by_id(self) -> None:
        first = {"id": "ready", "label": "Ready", "tone": "positive"}
        second = {"id": "blocked", "label": "Blocked", "tone": "attention"}
        draft = {
            "categories": {
                "canvas-results": {
                    "defaultResult": {
                        "label": "Outcome", "values": [first, second],
                        "source": {"kind": "phase-report"}, "summary": True,
                    },
                },
                "canvas-interactions": {
                    "inputs": {"phases": {"speckit.plan": "Describe the work"}},
                    "phaseRunConfirmations": {"speckit.plan": "Run planning?"},
                },
            },
        }
        atomic_json(self.request.with_name("command-override-draft.json"), draft)
        finalized = read_json(prepare_override(self.request))["categories"]
        self.assertEqual(finalized, draft["categories"])
        from override import merge_sparse

        current = {"defaultResult": {"values": [first, second]}, "phases": {
            "speckit.plan": {"label": "Plan"}, "speckit.tasks": {"label": "Tasks"},
        }}
        updated = merge_sparse(current, {
            "defaultResult": {"values": [second]},
            "phases": {"speckit.plan": {"label": "Planning"}},
        })
        self.assertEqual(updated["defaultResult"]["values"], [second])
        self.assertEqual(updated["phases"]["speckit.tasks"]["label"], "Tasks")
        self.assertEqual(updated["phases"]["speckit.plan"]["label"], "Planning")

    def test_duplicate_result_ids_and_unsafe_phase_map_keys_fail(self) -> None:
        result = {
            "label": "Outcome", "values": [
                {"id": "ready", "label": "Ready", "tone": "positive"},
                {"id": "ready", "label": "Duplicate", "tone": "neutral"},
            ],
            "source": {"kind": "phase-report"}, "summary": True,
        }
        for categories in (
            {"canvas-results": {"defaultResult": result}},
            {"canvas-interactions": {"phaseRunConfirmations": {"../escape": "Run?"}}},
            {"canvas-interactions": {"inputs": {"phases": {"speckit.tasks": "Not selected"}}}},
            {"canvas-results": {"phases": {"speckit.tasks": {"disabled": True}}}},
        ):
            with self.subTest(categories=categories):
                atomic_json(self.request.with_name("command-override-draft.json"), {"categories": categories})
                with self.assertRaises(ValueError):
                    prepare_override(self.request)
                self.assertFalse(self.request.with_name("command-override.json").exists())

    def test_phase_result_disable_has_one_explicit_shape(self) -> None:
        document = copy.deepcopy(default_experience(PACKAGE)["categories"]["canvas-results"])
        document["phases"]["speckit.plan"] = {"disabled": True}
        validate_complete_category("canvas-results", document, PACKAGE)
        document["phases"]["speckit.plan"]["source"] = {"kind": "phase-report"}
        with self.assertRaises(ValueError):
            validate_complete_category("canvas-results", document, PACKAGE)


class CustomerCategoryContracts(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.workspace = Path(temporary.name)
        fixtures = PACKAGE / "tests" / "fixtures" / "composition"
        shutil.copytree(fixtures / "installed", self.workspace / ".specify")
        self.inventory = {
            "artifacts": json.loads((fixtures / "mixed-stack.json").read_text(encoding="utf-8")),
            "presets": json.loads((fixtures / "installed-presets.json").read_text(encoding="utf-8")),
            "extensions": json.loads((fixtures / "installed-extensions.json").read_text(encoding="utf-8")),
        }
        self.package = self.workspace / ".specify" / "presets" / "customer-canvas-design"
        self.source = self.package / "config" / "canvas-content.json"
        self.customer = copy.deepcopy(default_experience(PACKAGE)["categories"]["canvas-content"])
        self.customer["itemName"] = "Customer item"
        self.source.write_text(json.dumps(self.customer), encoding="utf-8")

    def prepare(self) -> Path:
        with patch("request._preflight"):
            return prepare_request(
                self.workspace, ["speckit.plan"], "my-canvas", "My Canvas",
                False, inventory=self.inventory,
            )

    def test_owned_category_suppresses_only_its_sparse_patch(self) -> None:
        request = self.prepare()
        binding = read_json(request)["workflow"]["categoryTemplates"]["canvas-content"]
        self.assertEqual(binding["provider"]["id"], "customer-canvas-design")
        self.assertEqual(binding["document"], self.customer)
        self.source.write_text('{"schemaVersion":1,"itemName":"Changed after capture"}', encoding="utf-8")
        atomic_json(request.with_name("command-override-draft.json"), {"categories": {
            "canvas-content": {"itemName": "Ignored override"},
            "canvas-layout": {"phases": {"showDescriptions": False}},
        }})
        prepare_override(request)
        scaffold = PACKAGE / "tests" / "fixtures" / "scaffold"
        candidate = materialize_candidate(request, scaffold)
        profile = read_json(candidate / "canvas-experience.json")
        self.assertEqual(profile["categories"]["canvas-content"], {
            **self.customer,
            "description": "My Canvas workflow canvas.",
        })
        self.assertFalse(profile["categories"]["canvas-layout"]["phases"]["showDescriptions"])
        receipt = read_json(write_receipt(request, scaffold))
        self.assertEqual(receipt["categories"]["canvas-content"]["owner"], "customer-canvas-design")
        self.assertIn("canvas-content", receipt["warnings"][0])
        publish_candidate(request, scaffold)
        outcome = read_json(record_outcome(
            request, provider_id="project:my-canvas", opened_instance="category-test",
        ))
        self.assertIn("customer-canvas-design", outcome["designProviders"])
        self.assertEqual(outcome["warnings"], receipt["warnings"])

    def test_invalid_or_unowned_template_fails_before_request_written(self) -> None:
        for change in ("invalid", "undeclared", "composed"):
            with self.subTest(change=change):
                source = self.source.read_text(encoding="utf-8")
                manifest = (self.package / "preset.yml").read_text(encoding="utf-8")
                stack = copy.deepcopy(self.inventory["artifacts"][-1]["stack"])
                try:
                    if change == "invalid":
                        self.source.write_text('{"schemaVersion":1,"bogus":true}', encoding="utf-8")
                    elif change == "undeclared":
                        (self.package / "preset.yml").write_text(
                            manifest.replace("    - name: canvas-content\n      file: config/canvas-content.json\n", ""),
                            encoding="utf-8",
                        )
                    else:
                        self.inventory["artifacts"][-1]["stack"][0]["strategy"] = "wrap"
                    with self.assertRaises(ValueError):
                        self.prepare()
                    cache = self.workspace / ".specify" / ".cache" / "canvas-generation"
                    self.assertFalse(cache.exists() and list(cache.glob("*/request.json")))
                finally:
                    self.source.write_text(source, encoding="utf-8")
                    (self.package / "preset.yml").write_text(manifest, encoding="utf-8")
                    self.inventory["artifacts"][-1]["stack"] = stack

    def test_replace_renderer_is_explicitly_rejected(self) -> None:
        self.inventory["artifacts"].append({
            "kind": "template", "name": "canvas-renderer",
            "stack": [{
                "sourceId": "customer-canvas-design", "layer": "preset",
                "strategy": "replace", "active": True, "hidden": False,
                "manifestPath": ".specify/presets/customer-canvas-design/preset.yml",
                "lookupId": "preset:customer-canvas-design:template:canvas-renderer",
                "sourcePath": ".specify/presets/customer-canvas-design/renderer/renderer.json",
            }],
        })
        with self.assertRaisesRegex(ValueError, "renderer templates are no longer supported"):
            self.prepare()


if __name__ == "__main__":
    unittest.main()
