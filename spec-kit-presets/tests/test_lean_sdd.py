import hashlib
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
    "analyze", "checklist", "implement", "converge",
}
UPSTREAM_SHA256 = {
    "constitution": "56ca2ffc2938d04285adc8e0a7cc33164d7f0b8538d5b8aa70791de6ddb9f0a0",
    "specify": "9d68997ce418cc3293f66f946681bed0a33328c64a05757c0554ded19eec0ce2",
    "plan": "d4dbd594dc8ea9853583353cfc556ac419ffedf2300c207d4ce75c24debe2ab9",
    "tasks": "b363acd5cdbc3312b2fa03c763913515947feb214702281fe13355401ebd0210",
    "implement": "d50654ebfad997092a939d7020e546c48be47aa676c7ddeb90eb70b5cf20767c",
}
UPSTREAM_IMPLEMENT_EXECUTION = """3. **Execute tasks** in order:
   - Complete each task before moving to the next
   - Mark completed tasks by changing `- [ ]` to `- [x]` in `<feature_directory>/tasks.md`
   - Halt on failure and report the issue"""
IMPLEMENT_EXECUTION = """3. **Execute tasks sequentially**, in dependency order:
   - Work on one task at a time; finish its file writes before running validation, and wait for the result
   - Verify the task's stated outcome, mark it `[x]`, wait for the write, then read `tasks.md` back
   - Only after confirming the saved marker, select and start the next task
   - Never batch different tasks, including checkbox updates, or run validation alongside unfinished file writes
   - If a task fails or its outcome cannot be verified, stop and report; leave it unchecked"""
FILES = {
    "preset.yml", "README.md", "LICENSE",
    *(f"commands/speckit.{name}.md" for name in COMMANDS),
}
FORBIDDEN = (
    ".specify/extensions.yml", "EXECUTE_COMMAND", "HookExecutor",
    "hooks.before_", "hooks.after_", "{SCRIPT}", "{ARGS}",
    "check-prerequisites",
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
        self.assertEqual(self.catalog["provides"], {"templates": 0, "commands": 9})
        self.assertEqual(self.manifest["tags"], self.catalog["tags"])
        entries = self.manifest["provides"]["templates"]
        self.assertEqual(len(entries), 9)
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

    def test_package_files_and_license(self):
        self.assertEqual(
            {p.relative_to(PACKAGE).as_posix() for p in PACKAGE.rglob("*") if p.is_file()},
            FILES,
        )
        self.assertFalse(any(p.is_symlink() for p in PACKAGE.rglob("*")))
        license_text = (PACKAGE / "LICENSE").read_text()
        self.assertIn("Copyright GitHub, Inc.", license_text)
        self.assertIn("Permission is hereby granted", license_text)
        self.assertIn('THE SOFTWARE IS PROVIDED "AS IS"', license_text)
        readme = (PACKAGE / "README.md").read_text()
        self.assertIn("27d14e20c187c1f2916540ea201ecbdc9f8ed588/presets/lean", readme)
        self.assertIn(f"**{self.manifest['preset']['version']}**", readme)

    def test_lean_imports_only_change_approved_implement_execution_step(self):
        for name, digest in UPSTREAM_SHA256.items():
            with self.subTest(command=name):
                path = PACKAGE / f"commands/speckit.{name}.md"
                content = path.read_bytes()
                if name == "implement":
                    self.assertEqual(content.count(IMPLEMENT_EXECUTION.encode()), 1)
                    content = content.replace(
                        IMPLEMENT_EXECUTION.encode(), UPSTREAM_IMPLEMENT_EXECUTION.encode(), 1
                    )
                self.assertEqual(hashlib.sha256(content).hexdigest(), digest)

    def test_self_contained_commands_without_hook_dispatch(self):
        for name, text in self.commands.items():
            with self.subTest(command=name):
                frontmatter, body = text[4:].split("\n---\n", 1)
                metadata = yaml.safe_load(frontmatter)
                self.assertIn("description", metadata)
                self.assertNotIn("scripts", metadata)
                self.assertIn("$ARGUMENTS", body)
                for forbidden in FORBIDDEN:
                    self.assertNotIn(forbidden, text)
                if name not in UPSTREAM_SHA256:
                    self.assertIn(".specify/feature.json", text)
                    self.assertIn("missing", text)

    def test_shared_commands_follow_lean_outline(self):
        for name in COMMANDS - UPSTREAM_SHA256.keys():
            with self.subTest(command=name):
                text = self.commands[name]
                self.assertEqual(
                    re.findall(r"^## (.+)$", text, re.MULTILINE),
                    ["User Input", "Outline"],
                )

    def test_lean_and_optional_command_contracts(self):
        self.assertIn("**Ask the user**", self.commands["specify"])
        self.assertIn('"feature_directory": "<feature_directory>"', self.commands["specify"])
        self.assertIn("Every requirement must be testable", self.commands["specify"])
        self.assertIn("Design decisions, architecture, file structure", self.commands["plan"])
        self.assertIn("dependency-ordered", self.commands["tasks"])
        self.assertIn("If a task fails or its outcome cannot be verified, stop and report", self.commands["implement"])
        self.assertIn("MUST NOT", self.commands["constitution"])
        self.assertIn("non-governance", self.commands["constitution"])
        self.assertIn("Repeat for up to five material questions", self.commands["clarify"])
        self.assertIn("Ask **one** question using Copilot's `ask_user`, then wait for its answer", self.commands["clarify"])
        self.assertIn("No plan, tasks, or checklist required", self.commands["clarify"])
        self.assertIn("**Read-only**: Do not modify files", self.commands["analyze"])
        self.assertIn("constitution.md", self.commands["analyze"])
        self.assertIn("CRITICAL", self.commands["analyze"])
        self.assertIn(
            "No plan, tasks, or separate template required",
            self.commands["checklist"],
        )
        self.assertIn("Leave new items unchecked", self.commands["checklist"])
        self.assertIn("reviewer-owned", self.commands["checklist"])
        self.assertIn("**Append-only**: Preserve existing tasks", self.commands["converge"])
        self.assertIn("leave `tasks.md` unchanged", self.commands["converge"])
        self.assertIn("do not duplicate open tasks", self.commands["converge"])

    def test_clarification_requires_serial_ask_save_verify_loop(self):
        text = self.commands["clarify"]
        steps = [
            "Ask **one** question",
            "Write the accepted question and answer",
            "Read back the saved text",
            "**only then** consider the next question",
        ]
        positions = [text.index(step) for step in steps]
        self.assertEqual(positions, sorted(positions))
        self.assertIn("Never batch questions, run questions and writes in parallel", text)
        self.assertIn("or saving fails", text)
        self.assertIn("Do not start another command", text)

    def test_implementation_requires_verified_sequential_task_completion(self):
        text = self.commands["implement"]
        self.assertIn(IMPLEMENT_EXECUTION, text)
        steps = [
            "finish its file writes before running validation",
            "Verify the task's stated outcome",
            "mark it `[x]`, wait for the write",
            "then read `tasks.md` back",
            "Only after confirming the saved marker",
        ]
        positions = [text.index(step) for step in steps]
        self.assertEqual(positions, sorted(positions))
        self.assertNotIn("Follow TDD", text)
        self.assertNotIn("parallel tasks [P]", text)

    def test_convergence_requires_verified_outcomes_before_declaring_completion(self):
        text = self.commands["converge"]
        self.assertIn("every task outcome, including checked tasks", text)
        self.assertIn("documented local validation checks sequentially; wait for each result", text)
        self.assertIn("A failed required check is remaining work, even if another command passes", text)
        self.assertIn("If verification is blocked, report it as unverified; do not declare convergence", text)
        self.assertIn("Declare convergence only when all required outcomes are verified", text)
        self.assertLess(
            text.index("Run the feature's documented local validation checks"),
            text.index("Append missing work"),
        )

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
            self.assertEqual(
                core - {"taskstoissues"}, COMMANDS,
                "Review new core commands before claiming complete baseline coverage",
            )
            run("preset", "add", "--dev", str(PACKAGE), cwd=project)
            for name in sorted(COMMANDS):
                with self.subTest(command=name):
                    resolved = run("preset", "resolve", f"speckit.{name}", cwd=project)
                    self.assertIn("copilot-lean-sdd", resolved)
                    skill = (project / f".github/skills/speckit-{name}/SKILL.md").read_text()
                    body = (PACKAGE / f"commands/speckit.{name}.md").read_text().split("\n---\n", 1)[1]
                    for part in body.strip().split("__SPECKIT_COMMAND_SPECIFY__"):
                        self.assertIn(part, skill)
                    self.assertNotIn("__SPECKIT_COMMAND_", skill)
                    for forbidden in FORBIDDEN:
                        self.assertNotIn(forbidden, skill)
                    self.assertIsNone(re.search(r"hooks\.(before|after)_", skill))


if __name__ == "__main__":
    unittest.main()
