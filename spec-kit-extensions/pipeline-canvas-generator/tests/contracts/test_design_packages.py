"""Installed-manifest fixtures distinguish design inputs from runtime providers."""

import json
import unittest
from pathlib import Path

import yaml


FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "design-packages"
ROOT = Path(__file__).resolve().parents[4]


class DesignPackageFixtures(unittest.TestCase):
    def test_every_declared_file_exists_and_tags_match_package_purpose(self):
        for kind, package_id, design in (
            ("preset", "theme-preset", True),
            ("extension", "support-extension", True),
            ("extension", "runtime-extension", False),
        ):
            with self.subTest(package_id=package_id):
                folder = FIXTURES / package_id
                document = yaml.safe_load((folder / f"{kind}.yml").read_text(encoding="utf-8"))
                self.assertEqual(document[kind]["id"], package_id)
                self.assertEqual("canvas-design" in document["tags"], design)
                provides = document["provides"]
                for component in (*provides.get("templates", []), *provides.get("commands", [])):
                    self.assertTrue({"name", "file"} <= component.keys())
                    if kind == "preset":
                        self.assertEqual(component.get("type"), "template")
                    path = folder / component["file"]
                    self.assertTrue(path.is_file(), path)
                    self.assertTrue(path.resolve().is_relative_to(folder.resolve()))

    def test_sample_preset_templates_are_accepted_by_specify(self):
        document = yaml.safe_load((ROOT / "spec-kit-presets/copilot-canvas-studio/preset.yml").read_text(
            encoding="utf-8"))
        for template in document["provides"]["templates"]:
            self.assertEqual(template["type"], "template")
            self.assertTrue({"name", "file"} <= template.keys())
            self.assertTrue((ROOT / "spec-kit-presets/copilot-canvas-studio" / template["file"]).is_file())

    def test_support_command_is_distinct_from_generation_and_runtime_phases(self):
        design = yaml.safe_load(
            (FIXTURES / "support-extension" / "extension.yml").read_text(encoding="utf-8"))
        runtime = yaml.safe_load(
            (FIXTURES / "runtime-extension" / "extension.yml").read_text(encoding="utf-8"))
        support = design["provides"]["commands"][0]["name"]
        self.assertNotEqual(support, "speckit.pipeline-canvas-generator.generate")
        self.assertNotIn(support, {entry["name"] for entry in runtime["provides"]["commands"]})

    def test_first_party_catalogs_reference_the_tagged_manifests_and_release_assets(self):
        sources = (
            ("preset", "spec-kit-presets", "copilot-canvas-studio", "copilot-canvas-studio"),
            ("extension", "spec-kit-extensions", "pipeline-canvas-generator",
             "pipeline-canvas-generator"),
            ("bundle", "spec-kit-bundles", "copilot-canvas-studio",
             "copilot-canvas-studio-bundle"),
        )
        for kind, folder, package_id, tag_id in sources:
            with self.subTest(kind=kind):
                catalog = json.loads((ROOT / folder / "catalog.json").read_text(encoding="utf-8"))
                entry = catalog[f"{kind}s"][package_id]
                manifest = yaml.safe_load((ROOT / folder / package_id / f"{kind}.yml").read_text(
                    encoding="utf-8"))
                self.assertEqual(manifest[kind]["id"], package_id)
                self.assertEqual(manifest[kind]["version"], entry["version"])
                self.assertIn("canvas-design", manifest["tags"])
                self.assertIn("canvas-design", entry["tags"])
                self.assertEqual(entry["manifest_url"],
                                 f"https://raw.githubusercontent.com/github/spec-kit-copilot/main/"
                                 f"{folder}/{package_id}/{kind}.yml")
                self.assertTrue(entry["download_url"].endswith(
                    f"/{tag_id}-v{entry['version']}/{tag_id}.zip"))
        bundle = yaml.safe_load((ROOT / "spec-kit-bundles/copilot-canvas-studio/bundle.yml").read_text(
            encoding="utf-8"))
        self.assertEqual(
            [item["id"] for item in bundle["provides"]["presets"]],
            ["copilot-canvas-studio"],
        )
        self.assertFalse((ROOT / "catalog.json").exists())


if __name__ == "__main__":
    unittest.main()
