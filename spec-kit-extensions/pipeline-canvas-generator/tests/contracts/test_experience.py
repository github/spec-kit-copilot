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

from experience import default_document, validate_complete_category  # noqa: E402
from override import prepare_override  # noqa: E402
from contracts.handoff import prepare_request  # noqa: E402
from staging import atomic_json  # noqa: E402


class DefaultExperienceContracts(unittest.TestCase):
    def test_active_documents_validate_without_retired_defaults(self) -> None:
        for name in ("canvas-presentation", "canvas-interactions",
                     "canvas-setup", "canvas-results", "phase-outputs"):
            with self.subTest(name=name):
                self.assertEqual(default_document(PACKAGE, name)["schemaVersion"], 1)
        results = default_document(PACKAGE, "canvas-results")
        self.assertNotIn("defaultResult", results)
        self.assertTrue(results["clarification"]["enabled"])
        self.assertTrue(results["progress"]["enabled"])
        for retired in ("canvas-theme", "canvas-content", "canvas-layout"):
            with self.subTest(retired=retired):
                self.assertFalse((PACKAGE / "config" / f"{retired}.json").exists())
                self.assertFalse((PACKAGE / "schemas" / f"{retired}.schema.json").exists())
                with self.assertRaisesRegex(ValueError, "Unknown default document"):
                    default_document(PACKAGE, retired)

    def test_unknown_missing_and_wrong_typed_values_fail(self) -> None:
        category = default_document(PACKAGE, "canvas-presentation")
        for key, value in (("bogus", 1), ("brand", None), ("phases", {"showDescriptions": "yes"}), ("schemaVersion", True)):
            with self.subTest(key=key):
                altered = copy.deepcopy(category)
                altered[key] = value
                with self.assertRaises(ValueError):
                    validate_complete_category("canvas-presentation", altered, PACKAGE)
        for key in ("copy", "buttonLabels"):
            with self.subTest(key=key):
                altered = copy.deepcopy(category)
                altered[key] = {"newWorkflow": "New"}
                with self.assertRaises(ValueError):
                    validate_complete_category("canvas-presentation", altered, PACKAGE)

    def test_unused_interaction_settings_are_not_accepted(self) -> None:
        category = default_document(PACKAGE, "canvas-interactions")
        for group, key, value in (
            ("progression", "mode", "guided"),
            ("rerun", "requireConfirmation", False),
            ("artifacts", "showRevisionControls", True),
        ):
            with self.subTest(key=key):
                altered = copy.deepcopy(category)
                altered.setdefault(group, {})[key] = value
                with self.assertRaises(ValueError):
                    validate_complete_category("canvas-interactions", altered, PACKAGE)

    def test_setup_status_copy_cannot_override_the_generated_ui(self) -> None:
        category = copy.deepcopy(default_document(PACKAGE, "canvas-presentation"))
        for key in ("readinessCopy", "recoveryCopy", "firstRunCopy"):
            with self.subTest(key=key):
                altered = copy.deepcopy(category)
                altered["onboarding"] = {key: "Custom setup status text"}
                with self.assertRaises(ValueError):
                    validate_complete_category("canvas-presentation", altered, PACKAGE)


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

    def test_invalid_nested_path_fails_before_finalized_override(self) -> None:
        atomic_json(self.request.with_name("command-override-draft.json"), {
            "categories":             {"canvas-setup": {"workflowSlug": {"label": "alert(1)"}}},
        })
        with self.assertRaisesRegex(ValueError, "Sparse command overrides are unsupported"):
            prepare_override(self.request)
        self.assertFalse(self.request.with_name("command-override.json").exists())

    def test_protected_and_null_fields_fail_before_finalization(self) -> None:
        for categories in (
            {"canvas-presentation": {"schemaVersion": 2}},
            {"canvas-interactions": {"inputs": None}},
            {"canvas-setup": {"installationMode": "external"}},
            {"canvas-results": {"phases": {"speckit.plan": {"disabled": True}}}},
        ):
            with self.subTest(categories=categories):
                atomic_json(self.request.with_name("command-override-draft.json"), {"categories": categories})
                with self.assertRaises(ValueError):
                    prepare_override(self.request)
                self.assertFalse(self.request.with_name("command-override.json").exists())

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
        document = copy.deepcopy(default_document(PACKAGE, "canvas-results"))
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
    def prepare(self) -> Path:
        with patch("request._preflight"):
            return prepare_request(
                self.workspace, ["speckit.plan"], "my-canvas", "My Canvas",
                False, inventory=self.inventory,
            )

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
