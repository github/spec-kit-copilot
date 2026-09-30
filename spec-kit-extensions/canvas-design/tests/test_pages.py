import importlib.util
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

PACKAGE = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("designer_pages", PACKAGE / "scripts/python/pages.py")
pages = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pages)


def cli(project, *args):
    result = subprocess.run(
        [sys.executable, "-X", "utf8", "-c", "from specify_cli import app; app()", *args],
        cwd=project, capture_output=True, encoding="utf-8", timeout=60,
    )
    if result.returncode:
        raise AssertionError(result.stdout + result.stderr)
    return result.stdout


class PageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="canvas-design-tests-")
        cls.base = Path(cls.temp.name) / "base"
        cls.base.mkdir()
        cli(cls.base, "init", "--here", "--non-interactive", "--integration", "copilot",
            "--integration-options=--skills", "--script", "py", "--ignore-agent-tools")
        cli(cls.base, "extension", "add", str(PACKAGE), "--dev")

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def setUp(self):
        self.project = Path(self.temp.name) / self._testMethodName
        shutil.copytree(self.base, self.project)

    def load(self):
        return pages.load_pages(self.project, PACKAGE)

    def preset(self, documents, strategy="replace"):
        source = Path(self.temp.name) / f"{self._testMethodName}-preset"
        source.mkdir()
        templates = []
        for name, document in documents.items():
            (source / f"{name}.json").write_text(json.dumps(document), encoding="utf-8")
            templates.append({"type": "template", "name": f"canvas-settings-{name}",
                              "file": f"{name}.json", "strategy": strategy})
        manifest = {
            "schema_version": "1.0",
            "preset": {"id": "test-pages", "name": "Test pages", "version": "1.0.0",
                       "description": "Designer page override fixture", "author": "tests"},
            "requires": {"speckit_version": ">=1.0.7"},
            "provides": {"templates": templates},
        }
        (source / "preset.yml").write_text(pages.yaml.safe_dump(manifest), encoding="utf-8")
        cli(self.project, "preset", "add", "--dev", str(source))
        return self.project / ".specify/presets/test-pages"

    def test_registered_defaults_and_controls(self):
        model = self.load()
        self.assertEqual([page["title"] for page in model["pages"]],
                         ["Essentials", "Artifacts", "Appearance", "Result Badges"])
        self.assertEqual(len(model["pages"][0]["fields"]), 5)
        self.assertTrue(all(not page["fields"] for page in model["pages"][1:]))
        self.assertEqual(model["constraints"]["canvas.id"]["maxLength"], 100)
        self.assertEqual(model["constraints"]["canvas.description"]["maxLength"], 240)
        self.assertEqual(model["values"]["workflowSlug.userProvided"], False)
        self.assertEqual(model["values"]["canvas.id"], "")
        installed = json.loads(cli(self.project, "extension", "list", "--json"))
        self.assertEqual(installed[0]["provides"]["templates"], 4)

    def test_preset_precedence_registration_order_and_disabled_pages(self):
        setup = json.loads((PACKAGE / "pages/setup.json").read_text())
        setup.update(title="Customized Essentials", order=15)
        self.preset({
            "setup": setup,
            "appearance": {"schemaVersion": 1, "title": "Hidden", "order": 30,
                           "enabled": False, "fields": []},
            "extra": {"schemaVersion": 1, "title": "Extra", "order": 5,
                      "fields": [{"id": "extra.flag", "label": "Extra flag",
                                  "type": "boolean", "default": True}]},
        })
        (self.project / ".specify/templates/canvas-settings-stray.json").write_text("{}")
        model = self.load()
        self.assertEqual([page["title"] for page in model["pages"]],
                         ["Extra", "Customized Essentials", "Artifacts", "Result Badges"])
        self.assertEqual(model["pages"][1]["provenance"]["provider"], "test-pages")
        self.assertTrue(model["values"]["extra.flag"])

    def test_missing_winning_file_does_not_fall_back(self):
        root = self.preset({"setup": json.loads((PACKAGE / "pages/setup.json").read_text())})
        (root / "setup.json").unlink()
        with self.assertRaisesRegex(ValueError, "Missing, unsafe or oversized"):
            self.load()

    def test_broken_json_does_not_fall_back(self):
        root = self.preset({"setup": json.loads((PACKAGE / "pages/setup.json").read_text())})
        (root / "setup.json").write_text("{")
        with self.assertRaises(json.JSONDecodeError):
            self.load()

    def test_duplicate_fields_and_unsupported_controls_fail(self):
        root = self.preset({"extra": {"schemaVersion": 1, "title": "Extra", "order": 50,
                                     "fields": [{"id": "canvas.id", "label": "Duplicate"}]}})
        with self.assertRaisesRegex(ValueError, "Duplicate enabled field"):
            self.load()
        (root / "extra.json").write_text(json.dumps({
            "schemaVersion": 1, "title": "Extra", "order": 50,
            "fields": [{"id": "extra", "label": "Unsupported", "type": "repeatable-group"}],
        }))
        with self.assertRaisesRegex(ValueError, "unsupported value"):
            self.load()

    def test_disabling_identity_page_fails(self):
        setup = json.loads((PACKAGE / "pages/setup.json").read_text())
        setup["enabled"] = False
        self.preset({"setup": setup})
        with self.assertRaisesRegex(ValueError, "Canvas ID and Title"):
            self.load()

    def test_project_override_and_unsupported_composition(self):
        setup = json.loads((PACKAGE / "pages/setup.json").read_text())
        setup["title"] = "Project Essentials"
        root = self.project / ".specify/templates/overrides"
        root.mkdir(parents=True, exist_ok=True)
        (root / "canvas-settings-setup.md").write_text(json.dumps(setup), encoding="utf-8")
        model = self.load()
        self.assertEqual(model["pages"][0]["title"], "Project Essentials")
        self.assertEqual(model["pages"][0]["provenance"]["kind"], "project")
        self.preset({"appearance": {"schemaVersion": 1, "title": "Composed", "order": 30,
                                   "fields": []}}, strategy="append")
        with self.assertRaisesRegex(ValueError, "effective replace layer"):
            self.load()

    def test_paths_cannot_escape_provider(self):
        with self.assertRaisesRegex(ValueError, "escapes"):
            pages.confined(self.project, "../outside.json")
        with self.assertRaisesRegex(ValueError, "unsupported schema version"):
            schema = json.loads((PACKAGE / "schemas/page.schema.json").read_text())
            pages.check_schema({"schemaVersion": True, "title": "Invalid", "order": 1, "fields": []},
                               schema, "test")


if __name__ == "__main__":
    unittest.main()
