import copy
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from zipfile import ZipFile

import yaml
from jsonschema import Draft202012Validator, ValidationError


EXTENSIONS = Path(__file__).resolve().parents[1]
PACKAGE = EXTENSIONS / "canvas-design"
PAGE_NAMES = ("setup", "artifacts", "appearance", "results")
FILES = {
    "extension.yml",
    "README.md",
    "commands/load-page.md",
    "schemas/page.schema.json",
    *(f"pages/{name}.json" for name in PAGE_NAMES),
}


class CanvasDesignPackageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = yaml.safe_load((PACKAGE / "extension.yml").read_text("utf-8"))
        cls.schema = json.loads((PACKAGE / "schemas/page.schema.json").read_text("utf-8"))
        cls.validator = Draft202012Validator(cls.schema)
        cls.pages = [
            json.loads((PACKAGE / f"pages/{name}.json").read_text("utf-8"))
            for name in PAGE_NAMES
        ]
        cls.command = (PACKAGE / "commands/load-page.md").read_text("utf-8")
        cls.workflow = yaml.load(
            (EXTENSIONS.parent / ".github/workflows/release-extension.yml").read_text("utf-8"),
            Loader=yaml.BaseLoader,
        )

    def workflow_python(self, step_name):
        step = next(
            step for step in self.workflow["jobs"]["package"]["steps"]
            if step.get("name") == step_name
        )
        lines = step["run"].strip().splitlines()
        self.assertEqual(lines[0], "python - <<'PY'")
        self.assertEqual(lines[-1], "PY")
        return "\n".join(lines[1:-1])

    def test_manifest_and_shipped_files(self):
        self.assertEqual(self.manifest["schema_version"], "1.0")
        extension = self.manifest["extension"]
        self.assertEqual(extension["id"], "canvas-design")
        self.assertRegex(extension["version"], r"^\d+\.\d+\.\d+$")
        self.assertIn(
            f'Canvas Design **{extension["version"]}**',
            (PACKAGE / "README.md").read_text("utf-8"),
        )
        self.assertEqual(self.manifest["requires"], {"speckit_version": ">=1.0.7"})
        self.assertEqual(
            set(self.manifest["provides"]), {"commands", "templates"}
        )
        self.assertEqual(
            [(command["name"], command["file"])
             for command in self.manifest["provides"]["commands"]],
            [("speckit.canvas-design.load-page", "commands/load-page.md")],
        )
        self.assertEqual(
            [(template["name"], template["file"])
             for template in self.manifest["provides"]["templates"]],
            [(f"canvas-settings-{name}", f"pages/{name}.json") for name in PAGE_NAMES],
        )
        actual_files = set()
        for path in PACKAGE.rglob("*"):
            self.assertFalse(path.is_symlink(), f"Package symlink: {path}")
            if path.is_file():
                actual_files.add(path.relative_to(PACKAGE).as_posix())
        self.assertEqual(actual_files, FILES)
        for declaration in (
            self.manifest["provides"]["commands"]
            + self.manifest["provides"]["templates"]
        ):
            path = PACKAGE / declaration["file"]
            self.assertTrue(path.resolve().is_relative_to(PACKAGE.resolve()))
            self.assertTrue(path.is_file(), declaration["file"])

    def test_schema_and_default_pages(self):
        Draft202012Validator.check_schema(self.schema)
        self.assertEqual(
            self.schema["$schema"], "https://json-schema.org/draft/2020-12/schema"
        )
        for index, page in enumerate(self.pages):
            with self.subTest(page=page["id"]):
                self.validator.validate(page)
                self.assertEqual(page["id"], f"canvas-settings-{PAGE_NAMES[index]}")
                self.assertEqual(page["order"], (index + 1) * 10)
                self.assertTrue(page["enabled"])
        self.assertEqual(
            [page["title"] for page in self.pages],
            ["Essentials", "Artifacts", "Appearance", "Result Badges"],
        )
        self.assertEqual(
            self.pages[0]["fields"],
            [
                {"id": "canvas.id", "label": "Canvas ID"},
                {"id": "canvas.displayName", "label": "Title"},
                {"id": "canvas.description", "label": "Description"},
                {"id": "canvas.workflowListName", "label": "Workflow header"},
                {"id": "workflowSlug.userProvided", "label": "Show slug field",
                 "type": "boolean"},
            ],
        )
        self.assertTrue(all(page["fields"] == [] for page in self.pages[1:]))
        field_ids = [field["id"] for page in self.pages for field in page["fields"]]
        self.assertEqual(len(field_ids), len(set(field_ids)))

    def test_schema_rejects_invalid_page_shapes(self):
        mutations = {
            "schema version": {"schemaVersion": 2},
            "invalid id": {"id": "../outside"},
            "long id": {"id": "a" * 81},
            "empty title": {"title": ""},
            "long title": {"title": "a" * 121},
            "long description": {"description": "a" * 1001},
            "fractional order": {"order": 1.5},
            "large order": {"order": 100001},
            "small order": {"order": -100001},
            "enabled type": {"enabled": "true"},
            "unknown property": {"html": "<input>"},
            "too many fields": {"fields": [{"id": "x", "label": "X"}] * 101},
            "unknown field property": {"fields": [{"id": "x", "label": "X", "html": ""}]},
            "missing label": {"fields": [{"id": "x"}]},
            "invalid field id": {"fields": [{"id": "1x", "label": "X"}]},
            "unsupported control": {"fields": [{"id": "x", "label": "X", "type": "html"}]},
            "default type": {"fields": [{"id": "x", "label": "X", "default": "true"}]},
        }
        for name, mutation in mutations.items():
            with self.subTest(case=name):
                page = copy.deepcopy(self.pages[0])
                page.update(mutation)
                with self.assertRaises(ValidationError):
                    self.validator.validate(page)
        for required in ("schemaVersion", "id", "title", "order", "fields"):
            with self.subTest(missing=required):
                page = copy.deepcopy(self.pages[0])
                del page[required]
                with self.assertRaises(ValidationError):
                    self.validator.validate(page)

    def test_schema_accepts_optional_field_types_and_disabled_pages(self):
        page = copy.deepcopy(self.pages[0])
        page["enabled"] = False
        page["fields"] = [
            {"id": "custom.text", "label": "Text", "type": "string"},
            {"id": "custom.flag", "label": "Flag", "type": "boolean", "default": True},
        ]
        self.validator.validate(page)
        del page["enabled"]
        self.validator.validate(page)

    def test_command_contract(self):
        frontmatter = self.command.split("---", 2)
        self.assertEqual(frontmatter[0], "")
        metadata = yaml.safe_load(frontmatter[1])
        self.assertEqual(
            metadata["description"],
            self.manifest["provides"]["commands"][0]["description"],
        )
        defaults = re.findall(r"^- `(canvas-settings-[a-z]+)`$", self.command, re.M)
        self.assertEqual(defaults, [f"canvas-settings-{name}" for name in PAGE_NAMES])
        normalized = " ".join(self.command.split())
        for required in (
            "$ARGUMENTS", "`handoffId`", "`requestId`",
            "Additional Designer pages", "removing duplicates",
            "specify preset resolve <name>", "Resolve all pages before submitting any",
            "Preserve spaces and drive-letter colons",
            "not found` can return exit code 0",
            "Stop on missing/ambiguous results",
            "Never choose a file by scanning",
            "Call the custom `speckit_designer_load_pages` tool exactly once",
            'pages: [{"name": "<template-name>", "path": "<resolved-path>"}, ...]',
            "Submit the entire collected set",
            "`error` containing the CLI error/output instead of `pages`",
            "If the tool is unavailable, report that and stop",
            "do not run a Python helper or write the provider's state files yourself",
            "Do not claim that opening or loading succeeded before the tool succeeds",
        ):
            with self.subTest(contract=required):
                self.assertIn(required, normalized)

    def test_documented_normal_install_and_provider_boundary(self):
        readme = (PACKAGE / "README.md").read_text("utf-8")
        version = self.manifest["extension"]["version"]
        self.assertIn(
            "specify extension add canvas-design --from "
            "https://github.com/github/spec-kit-copilot/releases/download/"
            f"extension/canvas-design/v{version}/canvas-design.zip",
            readme,
        )
        self.assertIn('--integration copilot --integration-options="--skills"', readme)
        self.assertNotIn("--dev", readme)
        self.assertIn("not shipped by this package", readme)
        self.assertIn("no released\nWizard version is asserted", readme)

    @unittest.skipUnless(os.environ.get("CANVAS_DESIGN_ARCHIVE"), "No release ZIP supplied")
    def test_release_archive_has_exact_package_bytes(self):
        self.assert_archive_matches_package(os.environ["CANVAS_DESIGN_ARCHIVE"])

    def test_inline_workflow_packaging(self):
        with tempfile.TemporaryDirectory(prefix="canvas-design-package-") as temporary:
            root = Path(temporary)
            shutil.copytree(PACKAGE, root / "spec-kit-extensions/canvas-design")
            result = subprocess.run(
                [sys.executable, "-c", self.workflow_python("Create extension ZIP")],
                cwd=root, capture_output=True, text=True,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assert_archive_matches_package(root / "canvas-design.zip")

    def test_release_version_guards(self):
        version = self.manifest["extension"]["version"]
        tag = f"refs/tags/extension/canvas-design/v{version}"
        cases = [
            ("pull_request", "refs/pull/1/merge", "", True),
            ("push", "refs/heads/main", "", True),
            ("push", tag, "", True),
            ("push", "refs/tags/extension/canvas-design/v999.0.0", "", False),
            ("push", "refs/tags/canvas-design-v0.1.0", "", False),
            ("workflow_dispatch", "refs/heads/main", version, True),
            ("workflow_dispatch", "refs/heads/main", "999.0.0", False),
            ("workflow_dispatch", "refs/heads/feature", version, False),
        ]
        for event, ref, requested, succeeds in cases:
            with self.subTest(event=event, ref=ref, version=requested):
                env = dict(os.environ, GITHUB_EVENT_NAME=event, GITHUB_REF=ref,
                           REQUESTED_VERSION=requested)
                result = subprocess.run(
                    [sys.executable, "-c", self.workflow_python("Validate release version")],
                    cwd=EXTENSIONS.parent, env=env, capture_output=True, text=True,
                )
                self.assertEqual(result.returncode == 0, succeeds,
                                 result.stdout + result.stderr)

    def test_release_triggers_and_permissions(self):
        triggers = self.workflow["on"]
        self.assertEqual(triggers["push"]["tags"], ["extension/canvas-design/v*"])
        self.assertEqual(triggers["pull_request"]["branches"], ["main"])
        self.assertEqual(self.workflow["permissions"], {"contents": "read"})
        release = self.workflow["jobs"]["release"]
        self.assertEqual(release["needs"], "package")
        self.assertEqual(release["permissions"], {"contents": "write"})
        self.assertEqual(
            release["if"],
            "github.event_name == 'workflow_dispatch' || "
            "startsWith(github.ref, 'refs/tags/extension/canvas-design/v')",
        )

    def assert_archive_matches_package(self, path):
        with ZipFile(path) as archive:
            members = archive.infolist()
            self.assertEqual(len(members), len(FILES), "Duplicate or extra ZIP entries")
            self.assertEqual({entry.filename for entry in members}, FILES)
            self.assertIsNone(archive.testzip())
            for entry in members:
                with self.subTest(member=entry.filename):
                    self.assertFalse(entry.is_dir())
                    self.assertEqual(
                        archive.read(entry),
                        (PACKAGE / entry.filename).read_bytes(),
                    )


if __name__ == "__main__":
    unittest.main()
