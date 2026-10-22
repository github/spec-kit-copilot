import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest
from zipfile import ZipFile

import yaml


PRESETS = Path(__file__).resolve().parents[1]
PACKAGE = PRESETS / "copilot-lean-sdd"
COMMANDS = {
    "constitution", "specify", "clarify", "plan", "tasks",
    "analyze", "checklist", "implement", "converge", "taskstoissues",
}
FILES = {
    "preset.yml", "README.md", "UPSTREAM.md", "LICENSE",
    *(f"commands/speckit.{name}.md" for name in COMMANDS),
}
FORBIDDEN = (
    ".specify/extensions.yml", "EXECUTE_COMMAND", "HookExecutor",
    "hooks.before_", "hooks.after_", "{SCRIPT}", "{ARGS}",
    "__SPECKIT_COMMAND_", "check-prerequisites",
)


class LeanPackageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = yaml.safe_load((PACKAGE / "preset.yml").read_text())
        cls.catalog = json.loads((PRESETS / "catalog.json").read_text())["presets"]["copilot-lean-sdd"]
        cls.commands = {
            name: (PACKAGE / f"commands/speckit.{name}.md").read_text()
            for name in COMMANDS
        }

    def test_metadata_and_inventory(self):
        self.assertEqual(self.manifest["schema_version"], "1.0")
        metadata = self.manifest["preset"]
        for key in ("id", "name", "version", "description", "author", "repository", "license"):
            self.assertEqual(metadata[key], self.catalog[key], key)
        self.assertEqual(metadata["id"], PACKAGE.name)
        self.assertTrue(metadata["name"].startswith("Copilot "))
        self.assertRegex(metadata["version"], r"^\d+\.\d+\.\d+$")
        self.assertEqual(self.manifest["requires"], self.catalog["requires"])
        self.assertEqual(self.manifest["requires"]["speckit_version"], ">=1.0.8")
        self.assertEqual(self.catalog["provides"], {"templates": 0, "commands": 10})
        self.assertEqual(self.manifest["tags"], self.catalog["tags"])
        entries = self.manifest["provides"]["templates"]
        self.assertEqual(len(entries), 10)
        self.assertEqual({e["name"] for e in entries}, {f"speckit.{n}" for n in COMMANDS})
        for entry in entries:
            self.assertEqual(entry["type"], "command")
            self.assertEqual(entry["strategy"], "replace")
            self.assertEqual(entry["replaces"], entry["name"])
            self.assertEqual(entry["file"], f"commands/{entry['name']}.md")
        release = f"copilot-lean-sdd-v{metadata['version']}"
        self.assertEqual(
            self.catalog["download_url"],
            f"{metadata['repository']}/releases/download/{release}/copilot-lean-sdd.zip",
        )

    def test_package_files_provenance_and_license(self):
        self.assertEqual(
            {p.relative_to(PACKAGE).as_posix() for p in PACKAGE.rglob("*") if p.is_file()},
            FILES,
        )
        self.assertFalse(any(p.is_symlink() for p in PACKAGE.rglob("*")))
        provenance = (PACKAGE / "UPSTREAM.md").read_text()
        self.assertIn("27d14e20c187c1f2916540ea201ecbdc9f8ed588", provenance)
        self.assertIn("presets/lean/commands", provenance)
        self.assertIn("templates/commands", provenance)
        license_text = (PACKAGE / "LICENSE").read_text()
        self.assertIn("Copyright GitHub, Inc.", license_text)
        self.assertIn("Permission is hereby granted", license_text)
        self.assertIn('THE SOFTWARE IS PROVIDED "AS IS"', license_text)
        readme = (PACKAGE / "README.md").read_text()
        self.assertIn(f"**{self.manifest['preset']['version']}**", readme)
        self.assertIn("Initial release pending", readme)
        self.assertIn("not** model compliance", readme)

    def test_self_contained_copilot_commands_without_hook_dispatch(self):
        for name, text in self.commands.items():
            with self.subTest(command=name):
                frontmatter, body = text[4:].split("\n---\n", 1)
                metadata = yaml.safe_load(frontmatter)
                self.assertIn("description", metadata)
                self.assertNotIn("scripts", metadata)
                self.assertIn("$ARGUMENTS", body)
                self.assertIn("Copilot", body)
                for forbidden in FORBIDDEN:
                    self.assertNotIn(forbidden, text)
                if name not in ("constitution", "specify"):
                    self.assertIn(".specify/feature.json", text)
                    self.assertIn("unsafe paths", text)
                    self.assertIn("missing", text)

    def test_lean_and_optional_command_contracts(self):
        self.assertIn("**Ask the user**", self.commands["specify"])
        self.assertIn('"feature_directory": "<feature_directory>"', self.commands["specify"])
        self.assertIn("Every requirement must be testable", self.commands["specify"])
        self.assertIn("Design decisions, architecture, file structure", self.commands["plan"])
        self.assertIn("dependency-ordered", self.commands["tasks"])
        self.assertIn("Halt on failure", self.commands["implement"])
        self.assertIn("MUST NOT", self.commands["constitution"])
        self.assertIn("non-governance", self.commands["constitution"])
        self.assertIn("at most five questions", self.commands["clarify"])
        self.assertIn("After each accepted answer", self.commands["clarify"])
        self.assertIn("No plan, tasks, templates, or checklist are required", self.commands["clarify"])
        self.assertIn("STRICTLY READ-ONLY", self.commands["analyze"])
        self.assertIn("constitution.md", self.commands["analyze"])
        self.assertIn("CRITICAL", self.commands["analyze"])
        self.assertIn(
            "No plan, tasks,\n   separate template, or Full SDD design artifacts are prerequisites",
            self.commands["checklist"],
        )
        self.assertIn("All new items remain `[ ]`", self.commands["checklist"])
        self.assertIn("reviewer-owned", self.commands["checklist"])
        self.assertIn("APPEND-ONLY", self.commands["converge"])
        self.assertIn("byte-for-byte unchanged", self.commands["converge"])
        self.assertIn("open AND closed", self.commands["taskstoissues"])
        self.assertIn("explicit permission", self.commands["taskstoissues"])
        self.assertIn(r"\bT\d{3,}\b", self.commands["taskstoissues"])

    @unittest.skipUnless(os.environ.get("LEAN_PRESET_ARCHIVE"), "Set LEAN_PRESET_ARCHIVE for archive validation")
    def test_release_archive(self):
        with ZipFile(os.environ["LEAN_PRESET_ARCHIVE"]) as archive:
            names = [n for n in archive.namelist() if not n.endswith("/")]
            self.assertEqual(set(names), FILES)
            self.assertEqual(len(names), len(FILES))
            for name in names:
                self.assertEqual(archive.read(name), (PACKAGE / name).read_bytes())


@unittest.skipUnless(os.environ.get("SPECIFY_BIN"), "Set SPECIFY_BIN for real CLI validation")
class LeanCliTests(unittest.TestCase):
    def test_init_install_resolve_and_generate_skills(self):
        executable = str(Path(os.environ["SPECIFY_BIN"]).resolve())
        with tempfile.TemporaryDirectory(prefix="copilot-lean-sdd-") as temp:
            root = Path(temp)
            project = root / "project"

            def run(*args, cwd=root):
                result = subprocess.run(
                    [executable, *args], cwd=cwd, text=True,
                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=120,
                )
                self.assertEqual(result.returncode, 0, result.stdout)
                return result.stdout

            run(
                "init", str(project), "--integration", "copilot",
                "--integration-options=--skills", "--ignore-agent-tools", "--non-interactive",
            )
            core = {p.parent.name.removeprefix("speckit-") for p in (project / ".github/skills").glob("*/SKILL.md")}
            self.assertEqual(core, COMMANDS, "Review new core commands before claiming complete baseline coverage")
            run("preset", "add", "--dev", str(PACKAGE), cwd=project)
            for name in sorted(COMMANDS):
                with self.subTest(command=name):
                    resolved = run("preset", "resolve", f"speckit.{name}", cwd=project)
                    self.assertIn("copilot-lean-sdd", resolved)
                    skill = (project / f".github/skills/speckit-{name}/SKILL.md").read_text()
                    body = (PACKAGE / f"commands/speckit.{name}.md").read_text().split("\n---\n", 1)[1]
                    self.assertIn(body.strip(), skill)
                    for forbidden in FORBIDDEN:
                        self.assertNotIn(forbidden, skill)
                    self.assertIsNone(re.search(r"hooks\.(before|after)_", skill))


if __name__ == "__main__":
    unittest.main()
