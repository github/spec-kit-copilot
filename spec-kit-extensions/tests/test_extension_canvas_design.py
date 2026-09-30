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
PACKAGE = EXTENSIONS / "extension-canvas-design"
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
        cls.catalog = json.loads((EXTENSIONS / "catalog.json").read_text("utf-8"))
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
        self.assertEqual(extension["id"], "extension-canvas-design")
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
            [("speckit.extension-canvas-design.load-page", "commands/load-page.md")],
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

    def test_copilot_catalog_matches_package(self):
        self.assertEqual(self.catalog["schema_version"], "1.0")
        catalog_url = (
            "https://raw.githubusercontent.com/github/spec-kit-copilot/main/"
            "spec-kit-extensions/catalog.json"
        )
        self.assertEqual(self.catalog["catalog_url"], catalog_url)
        self.assertIn("extension-canvas-design", self.catalog["extensions"])
        entry = self.catalog["extensions"]["extension-canvas-design"]
        for field in ("id", "name", "version", "author", "repository", "license"):
            with self.subTest(field=field):
                self.assertEqual(entry[field], self.manifest["extension"][field])
        self.assertEqual(entry["requires"], self.manifest["requires"])
        self.assertEqual(entry["provides"], {
            "commands": len(self.manifest["provides"]["commands"]),
            "hooks": 0,
        })
        self.assertEqual(entry["tags"], ["copilot", "canvas-design"])
        self.assertEqual(self.manifest["tags"], entry["tags"])
        self.assertIn("Copilot", entry["description"])
        self.assertIn("speckit_designer_load_pages", entry["description"])
        version = entry["version"]
        self.assertEqual(
            entry["download_url"],
            "https://github.com/github/spec-kit-copilot/releases/download/"
            f"extension-canvas-design-v{version}/extension-canvas-design.zip",
        )
        self.assertEqual(
            entry["documentation"],
            "https://github.com/github/spec-kit-copilot/blob/main/"
            "spec-kit-extensions/extension-canvas-design/README.md",
        )
        for path in (EXTENSIONS / "README.md", PACKAGE / "README.md"):
            with self.subTest(readme=path):
                readme = path.read_text("utf-8")
                self.assertIn(
                    f"specify extension catalog add {catalog_url} "
                    "--name spec-kit-copilot --install-allowed", readme,
                )
                self.assertIn("specify extension add extension-canvas-design\n", readme)

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

    def test_defaults_require_explicit_boolean_type(self):
        for field_type in (None, "string", "boolean"):
            for default in (True, False):
                with self.subTest(field_type=field_type, default=default):
                    page = copy.deepcopy(self.pages[0])
                    field = {"id": "custom.field", "label": "Custom", "default": default}
                    if field_type is not None:
                        field["type"] = field_type
                    page["fields"] = [field]
                    if field_type == "boolean":
                        self.validator.validate(page)
                    else:
                        with self.assertRaises(ValidationError):
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
            "specify extension add extension-canvas-design --from "
            "https://github.com/github/spec-kit-copilot/releases/download/"
            f"extension-canvas-design-v{version}/extension-canvas-design.zip",
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
        with tempfile.TemporaryDirectory(prefix="extension-canvas-design-package-") as temporary:
            root = Path(temporary)
            shutil.copytree(PACKAGE, root / "spec-kit-extensions/extension-canvas-design")
            result = subprocess.run(
                [sys.executable, "-c", self.workflow_python("Create extension ZIP")],
                cwd=root, env=dict(os.environ, EXTENSION_IDS='["extension-canvas-design"]'),
                capture_output=True, text=True,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assert_archive_matches_package(root / "extension-canvas-design.zip")

    def test_release_version_guards(self):
        version = self.manifest["extension"]["version"]
        tag = f"refs/tags/extension-canvas-design-v{version}"
        cases = [
            ("pull_request", "refs/pull/1/merge", "", "", True),
            ("push", "refs/heads/main", "", "", True),
            ("push", tag, "", "", True),
            ("push", "refs/tags/extension-canvas-design-v999.0.0", "", "", False),
            ("push", "refs/tags/canvas-design-v0.1.0", "", "", False),
            ("push", "refs/tags/extension/canvas-design/v0.1.0", "", "", False),
            ("push", "refs/tags/copilot-sub-agents-v1.0.0", "", "", False),
            ("workflow_dispatch", "refs/heads/main", "extension-canvas-design", version, True),
            ("workflow_dispatch", "refs/heads/main", "extension-canvas-design", f"v{version}", True),
            ("workflow_dispatch", "refs/heads/main", "extension-canvas-design", "999.0.0", False),
            ("workflow_dispatch", "refs/heads/main", "extension-canvas-design", "", False),
            ("workflow_dispatch", "refs/heads/main", "extension-canvas-design", f"{version}; echo bad", False),
            ("workflow_dispatch", "refs/heads/main", "unsupported", version, False),
            ("workflow_dispatch", "refs/heads/main", "extension-missing", version, False),
            ("workflow_dispatch", "refs/heads/main", "canvas-design", version, False),
            ("workflow_dispatch", "refs/heads/main", "", version, False),
            ("workflow_dispatch", "refs/heads/main", "../extension-canvas-design", version, False),
        ]
        for event, ref, extension_id, requested_version, succeeds in cases:
            with self.subTest(event=event, ref=ref, extension_id=extension_id,
                              version=requested_version), tempfile.TemporaryDirectory() as temporary:
                output = Path(temporary) / "output"
                env = dict(
                    os.environ, GITHUB_REF=ref, GITHUB_EVENT_NAME=event,
                    EXTENSION_ID=extension_id, VERSION=requested_version,
                    GITHUB_OUTPUT=str(output),
                )
                result = subprocess.run(
                    [sys.executable, "-c", self.workflow_python("Validate release version")],
                    cwd=EXTENSIONS.parent, env=env, capture_output=True, text=True,
                )
                self.assertEqual(result.returncode == 0, succeeds,
                                 result.stdout + result.stderr)
                if succeeds:
                    values = dict(line.split("=", 1) for line in output.read_text().splitlines())
                    self.assertEqual(json.loads(values["extension_ids"]), ["extension-canvas-design"])
                    if event == "workflow_dispatch" or ref.startswith("refs/tags/"):
                        self.assertEqual(values["tag"], tag.removeprefix("refs/tags/"))
                        self.assertEqual(values["extension_id"], "extension-canvas-design")
                        self.assertEqual(values["extension_name"], self.manifest["extension"]["name"])
                    else:
                        self.assertNotIn("tag", values)
                else:
                    self.assertFalse(output.exists())

    def test_release_supports_another_extension(self):
        with tempfile.TemporaryDirectory(prefix="extension-release-") as temporary:
            root = Path(temporary)
            extensions = root / "spec-kit-extensions"
            shutil.copytree(PACKAGE, extensions / "extension-canvas-design")
            package = extensions / "extension-sample"
            shutil.copytree(PACKAGE, package)
            manifest = copy.deepcopy(self.manifest)
            manifest["extension"].update(id="extension-sample", name="Sample Extension", version="1.2.3")
            manifest["provides"]["config"] = [
                {"name": "sample-config.yml", "template": "config-template.yml"},
            ]
            (package / "extension.yml").write_text(yaml.safe_dump(manifest), "utf-8")
            (package / "README.md").write_text("Sample extension", "utf-8")
            (package / "config-template.yml").write_text("enabled: true\n", "utf-8")
            catalog = copy.deepcopy(self.catalog)
            entry = copy.deepcopy(catalog["extensions"]["extension-canvas-design"])
            tag = "extension-sample-v1.2.3"
            entry.update(
                id="extension-sample", name="Sample Extension", version="1.2.3",
                download_url=f"https://github.com/github/spec-kit-copilot/releases/download/{tag}/extension-sample.zip",
            )
            catalog["extensions"]["extension-sample"] = entry
            (extensions / "catalog.json").write_text(json.dumps(catalog), "utf-8")
            cases = [
                ("workflow_dispatch", "refs/heads/main", ["extension-sample"]),
                ("push", f"refs/tags/{tag}", ["extension-sample"]),
                ("push", "refs/heads/main", ["extension-canvas-design", "extension-sample"]),
                ("pull_request", "refs/pull/1/merge", ["extension-canvas-design", "extension-sample"]),
            ]
            for event, ref, expected_ids in cases:
                with self.subTest(event=event, ref=ref):
                    output = root / "output"
                    output.write_text("")
                    result = subprocess.run(
                        [sys.executable, "-c", self.workflow_python("Validate release version")],
                        cwd=root, capture_output=True, text=True,
                        env=dict(os.environ, GITHUB_EVENT_NAME=event, GITHUB_REF=ref,
                                 EXTENSION_ID="extension-sample", VERSION="1.2.3",
                                 GITHUB_OUTPUT=str(output)),
                    )
                    self.assertEqual(result.returncode, 0, result.stderr)
                    values = dict(line.split("=", 1) for line in output.read_text().splitlines())
                    self.assertEqual(json.loads(values["extension_ids"]), expected_ids)
                    if len(expected_ids) == 1:
                        self.assertEqual(values["tag"], tag)
                        self.assertEqual(values["extension_id"], "extension-sample")
                        self.assertEqual(values["extension_name"], "Sample Extension")
                    else:
                        self.assertNotIn("tag", values)
                    result = subprocess.run(
                        [sys.executable, "-c", self.workflow_python("Create extension ZIP")],
                        cwd=root, capture_output=True, text=True,
                        env=dict(os.environ, EXTENSION_IDS=values["extension_ids"]),
                    )
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertEqual({path.stem for path in root.glob("*.zip")}, set(expected_ids))
                    with ZipFile(root / "extension-sample.zip") as archive:
                        self.assertEqual(set(archive.namelist()), FILES | {"config-template.yml"})
                        for name in archive.namelist():
                            self.assertEqual(archive.read(name), (package / name).read_bytes())
                    for path in root.glob("*.zip"):
                        path.unlink()

    def test_packaging_rejects_invalid_declared_files(self):
        cases = [
            ("commands", "file", "commands/load-page.md", "missing"),
            ("templates", "file", "pages/setup.json", "missing"),
            ("config", "template", "config-template.yml", "missing"),
            ("commands", "file", "commands/load-page.md", "directory"),
            ("templates", "file", "../outside.json", "outside"),
            ("commands", "file", None, "invalid"),
        ]
        for kind, field, name, problem in cases:
            with self.subTest(kind=kind, name=name, problem=problem), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                package = root / "spec-kit-extensions/extension-sample"
                shutil.copytree(PACKAGE, package)
                manifest = copy.deepcopy(self.manifest)
                manifest["extension"]["id"] = "extension-sample"
                manifest["provides"] = {kind: [{"name": "sample", field: name}]}
                (package / "extension.yml").write_text(yaml.safe_dump(manifest), "utf-8")
                if problem in ("missing", "directory"):
                    path = package / name
                    if path.is_file():
                        path.unlink()
                    if problem == "directory":
                        path.mkdir()
                elif problem == "outside":
                    (package / name).write_text("{}", "utf-8")
                result = subprocess.run(
                    [sys.executable, "-c", self.workflow_python("Create extension ZIP")],
                    cwd=root, env=dict(os.environ, EXTENSION_IDS='["extension-sample"]'),
                    capture_output=True, text=True,
                )
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(f"Declared {kind} {field} is not a regular package file", result.stderr)
                self.assertIn(repr(name), result.stderr)
                self.assertFalse((root / "extension-sample.zip").exists())

    def test_release_triggers_and_permissions(self):
        triggers = self.workflow["on"]
        self.assertEqual(set(triggers), {"workflow_call", "pull_request", "push"})
        self.assertEqual(triggers["push"]["tags"], ["extension-*-v*"])
        self.assertEqual(triggers["pull_request"]["branches"], ["main"])
        self.assertEqual(self.workflow["permissions"], {"contents": "read"})
        self.assertEqual(triggers["workflow_call"]["inputs"], {
            "extension_id": {"required": "true", "type": "string"},
            "version": {"required": "true", "type": "string"},
        })
        trigger = yaml.load(
            (EXTENSIONS.parent / ".github/workflows/release-extension-trigger.yml").read_text("utf-8"),
            Loader=yaml.BaseLoader,
        )
        self.assertEqual(set(trigger["on"]), {"workflow_dispatch"})
        inputs = trigger["on"]["workflow_dispatch"]["inputs"]
        self.assertEqual(inputs["extension_id"]["type"], "string")
        self.assertEqual(inputs["extension_id"]["required"], "true")
        self.assertEqual(inputs["version"]["required"], "true")
        caller = trigger["jobs"]["tag-and-release"]
        self.assertEqual(caller["uses"], "./.github/workflows/release-extension.yml")
        self.assertEqual(caller["permissions"], {"contents": "write"})
        self.assertEqual(caller["with"], {
            "extension_id": "${{ inputs.extension_id }}",
            "version": "${{ inputs.version }}",
        })
        for event in ("pull_request", "push"):
            self.assertIn(".github/workflows/release-extension-trigger.yml", triggers[event]["paths"])
        release = self.workflow["jobs"]["release"]
        self.assertEqual(release["needs"], "package")
        self.assertEqual(release["permissions"], {"contents": "write"})
        self.assertEqual(
            release["if"],
            "github.event_name == 'workflow_dispatch' || "
            "startsWith(github.ref, 'refs/tags/extension-')",
        )
        publish = next(
            step for step in release["steps"]
            if step.get("name") == "Publish validated extension"
        )["run"]
        self.assertIn('gh release create "$TAG" "$EXTENSION_ID.zip"', publish)
        self.assertIn('--title "$EXTENSION_ID ${TAG##*-}"', publish)
        self.assertIn("--verify-tag", publish)
        preset_workflow = yaml.load(
            (EXTENSIONS.parent / ".github/workflows/release-preset.yml").read_text("utf-8"),
            Loader=yaml.BaseLoader,
        )
        self.assertEqual(preset_workflow["on"]["push"]["tags"], [
            "*-v[0-9]+.[0-9]+.[0-9]+", "!extension-*",
        ])
        verify = next(
            step for step in self.workflow["jobs"]["package"]["steps"]
            if step.get("name") == "Verify release archive"
        )
        self.assertEqual(verify["env"]["CANVAS_DESIGN_ARCHIVE"], "extension-canvas-design.zip")

    def test_release_rejects_catalog_drift(self):
        version = self.manifest["extension"]["version"]
        mutations = [
            ("version", "999.0.0", "Catalog version must match"),
            ("download_url", "https://example.com/wrong.zip", "Catalog download URL must match"),
        ]
        with tempfile.TemporaryDirectory(prefix="extension-canvas-design-catalog-") as temporary:
            root = Path(temporary)
            package = root / "spec-kit-extensions/extension-canvas-design"
            package.mkdir(parents=True)
            shutil.copyfile(PACKAGE / "extension.yml", package / "extension.yml")
            for field, value, error in mutations:
                with self.subTest(field=field):
                    catalog = copy.deepcopy(self.catalog)
                    catalog["extensions"]["extension-canvas-design"][field] = value
                    (package.parent / "catalog.json").write_text(json.dumps(catalog), "utf-8")
                    result = subprocess.run(
                        [sys.executable, "-c", self.workflow_python("Validate release version")],
                        cwd=root,
                        env=dict(os.environ, GITHUB_EVENT_NAME="push",
                                 GITHUB_REF=f"refs/tags/extension-canvas-design-v{version}"),
                        capture_output=True, text=True,
                    )
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn(error, result.stderr)

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
