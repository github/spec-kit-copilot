import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import tempfile
import unittest
from zipfile import ZipFile

import yaml


PRESETS = Path(__file__).resolve().parents[1]
PACKAGE = PRESETS / "copilot-full-sdd"
COMMANDS = {
    "constitution", "specify", "clarify", "plan", "tasks",
    "analyze", "checklist", "implement", "converge",
}
FILES = {
    "preset.yml", "README.md", "LICENSE",
    *(f"commands/speckit.{name}.md" for name in COMMANDS),
}
FORBIDDEN = (
    ".specify/extensions.yml", "EXECUTE_COMMAND", "HookExecutor",
    "hooks.before_", "hooks.after_", "Extension Hooks",
    "Mandatory Post-Execution Hooks", "before_specify",
)
# Pinned core imports after the hook removal and Copilot adaptations documented
# in the package README. Changes require an explicit source/contract review.
IMPORT_SHA256 = {
    "constitution": "80a952d35318da14791a6043664d0de0fd067d4773cef45df347595deb8b5478",
    "specify": "fd7a1e51bf1554cd509032abe4dc616cc7fdabfa8a88f0472fa68661fd502917",
    "clarify": "b1698e4ceceb4e53244a80e4b9691d61195ea3764feb093a0a58803a0203a04a",
    "plan": "49eb550a250da4f7c5ca8f1b0552f0d941f1dc06f126dd6396421495edcfbac7",
    "tasks": "542617339670616c572d9e3e218fa72fe1006db5ad0d122fd2080c616233f307",
    "analyze": "f294039d7fdac56c5ca6ff991b0c5c67a566e5e2b3e0496b9ea1fc537514aff6",
    "checklist": "ce5150af901be0e60ee73fddd91e57bcc774d0f0d9f39ab15605f6077e233b98",
    "implement": "1bdd95c4a3220d5af0d8a37db13dae91ba199b9b25a19ac4d5a9b24c838886da",
    "converge": "974d84928c58ed947fd829c9cb6a6610d0989897026e1ddd120c45cf04fcbfcb",
}


class FullPackageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = yaml.safe_load((PACKAGE / "preset.yml").read_text())
        cls.catalog = json.loads((PRESETS / "catalog.json").read_text())["presets"][PACKAGE.name]
        cls.commands = {
            name: (PACKAGE / f"commands/speckit.{name}.md").read_text()
            for name in COMMANDS
        }

    def test_metadata_and_inventory(self):
        self.assertEqual(self.manifest["schema_version"], "1.0")
        metadata = self.manifest["preset"]
        for key, value in metadata.items():
            self.assertEqual(value, self.catalog[key], key)
        self.assertEqual(metadata["id"], PACKAGE.name)
        self.assertEqual(metadata["name"], "Copilot Full SDD")
        self.assertRegex(metadata["version"], r"^\d+\.\d+\.\d+$")
        self.assertEqual(self.manifest["requires"], self.catalog["requires"])
        self.assertEqual(self.manifest["requires"]["speckit_version"], ">=1.0.8")
        self.assertEqual(self.manifest["tags"], self.catalog["tags"])
        self.assertEqual(self.catalog["provides"], {"templates": 0, "commands": 9})
        entries = self.manifest["provides"]["templates"]
        self.assertEqual(len(entries), 9)
        self.assertEqual({e["name"] for e in entries}, {f"speckit.{n}" for n in COMMANDS})
        for entry in entries:
            self.assertEqual(entry["type"], "command")
            self.assertEqual(entry["strategy"], "replace")
            self.assertEqual(entry["replaces"], entry["name"])
            self.assertEqual(entry["file"], f"commands/{entry['name']}.md")
        release = f"{PACKAGE.name}-v{metadata['version']}"
        self.assertEqual(
            self.catalog["download_url"],
            f"{metadata['repository']}/releases/download/{release}/{PACKAGE.name}.zip",
        )

    def test_files_license_and_source(self):
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
        self.assertIn("27d14e20c187c1f2916540ea201ecbdc9f8ed588/templates/commands", readme)
        self.assertIn(f"**{self.manifest['preset']['version']}**", readme)

    def test_reviewed_full_imports_remain_intact(self):
        for name, digest in IMPORT_SHA256.items():
            with self.subTest(command=name):
                content = (PACKAGE / f"commands/speckit.{name}.md").read_bytes()
                self.assertEqual(hashlib.sha256(content).hexdigest(), digest)

    def test_no_lifecycle_dispatch_and_preserved_script_metadata(self):
        for name, text in self.commands.items():
            with self.subTest(command=name):
                for forbidden in FORBIDDEN:
                    self.assertNotIn(forbidden, text)
                metadata = yaml.safe_load(text.split("---", 2)[1])
                self.assertIn("description", metadata)
                self.assertIn("$ARGUMENTS", text)
                self.assertIn("Copilot's `ask_user`", text)
                if name == "specify":
                    self.assertNotIn("scripts", metadata)
                else:
                    self.assertEqual(set(metadata["scripts"]), {"sh", "ps", "py"})
                    self.assertIn("{SCRIPT}", text)

    def test_full_artifact_and_quality_contracts(self):
        expected = {
            "constitution": [
                "constitution-template", "Sync Impact Report", "MUST NOT",
                "No remaining unexplained bracket tokens", "Dates ISO format",
            ],
            "specify": [
                "spec-template", ".specify/feature.json", "checklists/requirements.md",
                "Each requirement must be testable", "max 3 iterations",
                "Maximum 3 [NEEDS CLARIFICATION]", "Completion Report",
            ],
            "clarify": [
                "--paths-only", "Maximum of 5 total questions",
                "Integration after EACH accepted answer", "Save the spec file AFTER each integration",
                "Validation (performed after EACH write", "Re-validate Spec Quality Checklist",
                "Only toggle the `[ ]`/`[x]` marker",
            ],
            "plan": [
                "setup-plan", "Constitution Check", "ERROR if violations unjustified",
                "research.md", "data-model.md", "contracts/", "quickstart.md",
                "Re-evaluate Constitution Check post-design", "ERROR on gate failures",
            ],
            "tasks": [
                "setup-tasks", "TASKS_TEMPLATE_CONTENT",
                "Required**: plan.md", "spec.md", "organized by user story",
                "Tests are OPTIONAL", "dependency graph", "Independent test criteria",
            ],
            "analyze": [
                "--require-spec --require-tasks --include-tasks", "STRICTLY READ-ONLY",
                "Constitution conflicts are automatically CRITICAL", "Coverage Summary Table",
                "NEVER modify files",
            ],
            "checklist": [
                "--template checklist-template", "reviewer-owned",
                "MUST NOT mark generated items `[x]`", "Never delete or replace existing",
                "MINIMUM: ≥80%", "NOT whether the implementation works",
            ],
            "implement": [
                "--require-tasks --include-tasks", "STOP", "Wait for user response",
                "Phase-by-phase execution", "Respect dependencies",
                "Halt execution if any non-parallel task fails",
                "Validate that tests pass", "coverage meets requirements",
            ],
            "converge": [
                "--require-spec --require-tasks --include-tasks", "APPEND-ONLY, NEVER REWRITE",
                "byte-for-byte unchanged", "completion claims are not evidence",
                "Never reuse or renumber existing IDs", "Constitution-violation tasks MUST",
                "MUST run only after",
            ],
        }
        for name, contracts in expected.items():
            with self.subTest(command=name):
                for contract in contracts:
                    self.assertIn(contract, self.commands[name])

    @unittest.skipUnless(os.environ.get("FULL_PRESET_ARCHIVE"), "Set FULL_PRESET_ARCHIVE for archive validation")
    def test_release_archive(self):
        with ZipFile(os.environ["FULL_PRESET_ARCHIVE"]) as archive:
            names = [n for n in archive.namelist() if not n.endswith("/")]
            self.assertEqual(set(names), FILES)
            self.assertEqual(len(names), len(FILES))
            for name in names:
                self.assertEqual(archive.read(name), (PACKAGE / name).read_bytes())


@unittest.skipUnless(os.environ.get("SPECIFY_BIN"), "Set SPECIFY_BIN for real CLI validation")
class FullCliTests(unittest.TestCase):
    def test_registration_rendering_and_prerequisites(self):
        executable = str(Path(os.environ["SPECIFY_BIN"]).resolve())
        with tempfile.TemporaryDirectory(prefix="copilot-full-sdd-") as temp:
            root = Path(temp).resolve()
            for script_type in ("sh", "py"):
                with self.subTest(script_type=script_type):
                    project = root / script_type
                    env = dict(os.environ)
                    env["PATH"] = str(Path(executable).parent) + os.pathsep + env["PATH"]

                    def run(args, cwd=project, success=True):
                        result = subprocess.run(
                            args, cwd=cwd, env=env, text=True,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120,
                        )
                        if success:
                            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                        else:
                            self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
                        return result

                    run([
                        executable, "init", str(project), "--integration", "copilot",
                        "--integration-options=--skills", "--ignore-agent-tools",
                        "--non-interactive", "--script", script_type,
                    ], cwd=root)
                    core = {
                        p.parent.name.removeprefix("speckit-")
                        for p in (project / ".github/skills").glob("*/SKILL.md")
                    }
                    self.assertEqual(core - {"taskstoissues"}, COMMANDS)
                    run([executable, "preset", "add", "--dev", str(PACKAGE)])
                    scripts = {}
                    for name in sorted(COMMANDS):
                        resolved = run([executable, "preset", "resolve", f"speckit.{name}"])
                        self.assertIn(PACKAGE.name, resolved.stdout)
                        skill = (project / f".github/skills/speckit-{name}/SKILL.md").read_text()
                        metadata = yaml.safe_load(skill.split("---", 2)[1])
                        self.assertEqual(metadata["metadata"]["source"], f"preset:{PACKAGE.name}")
                        self.assertEqual(metadata["name"], f"speckit-{name}")
                        for forbidden in (*FORBIDDEN, "{SCRIPT}", "{ARGS}", "__SPECKIT_COMMAND_", "/memory/"):
                            if forbidden == "/memory/":
                                self.assertNotIn("`/memory/", skill)
                            else:
                                self.assertNotIn(forbidden, skill)
                        self.assertNotIn("scripts:", skill.split("---", 2)[1])
                        self.assertIn("Copilot's `ask_user`", skill)
                        if name != "specify":
                            invocation = re.search(r"Run `([^`]+)`", skill)
                            self.assertIsNotNone(invocation, name)
                            scripts[name] = shlex.split(invocation[1])
                            self.assertIn(f".specify/scripts/{'bash' if script_type == 'sh' else 'python'}/", invocation[1])

                    # Resolve the constitution scaffold through the installed CLI.
                    constitution = json.loads(run(scripts["constitution"]).stdout)
                    self.assertIn("TEMPLATE_CONTENT", constitution)
                    self.assertIn("Governance", constitution["TEMPLATE_CONTENT"])
                    feature = project / "specs/001-contract"
                    feature.mkdir(parents=True)
                    config = project / ".specify/feature.json"
                    config.write_text(json.dumps({"feature_directory": "specs/001-contract"}) + "\n")
                    before = config.read_bytes()
                    paths = json.loads(run(scripts["clarify"]).stdout)
                    self.assertEqual(Path(paths["FEATURE_SPEC"]), feature / "spec.md")
                    self.assertEqual(config.read_bytes(), before)

                    # Missing plan gates tasks/checklist/analysis/implementation/convergence.
                    for name in ("tasks", "checklist", "analyze", "implement", "converge"):
                        failure = run(scripts[name], success=False)
                        self.assertIn("plan.md", failure.stdout + failure.stderr)
                    (feature / "spec.md").write_text("# Contract feature\n\n## Requirements\n- FR-001: Return a greeting.\n")
                    plan = json.loads(run(scripts["plan"]).stdout)
                    self.assertEqual(Path(plan["IMPL_PLAN"]), feature / "plan.md")
                    plan_content = (feature / "plan.md").read_text()
                    self.assertIn("Constitution Check", plan_content)
                    self.assertEqual(run(scripts["plan"]).returncode, 0)
                    self.assertEqual((feature / "plan.md").read_text(), plan_content)
                    tasks = json.loads(run(scripts["tasks"]).stdout)
                    self.assertIn("TASKS_TEMPLATE_CONTENT", tasks)
                    self.assertIn("User Story", tasks["TASKS_TEMPLATE_CONTENT"])
                    checklist = json.loads(run(scripts["checklist"]).stdout)
                    self.assertIn("TEMPLATE_CONTENT", checklist)
                    for name in ("analyze", "implement", "converge"):
                        failure = run(scripts[name], success=False)
                        self.assertIn("tasks.md", failure.stdout + failure.stderr)
                    (feature / "tasks.md").write_text("# Tasks\n- [ ] T001 Return greeting in hello.py\n")
                    for name in ("analyze", "implement", "converge"):
                        result = json.loads(run(scripts[name]).stdout)
                        self.assertIn("tasks.md", result["AVAILABLE_DOCS"])
                    (feature / "spec.md").unlink()
                    for name in ("analyze", "converge"):
                        failure = run(scripts[name], success=False)
                        self.assertIn("spec.md", failure.stdout + failure.stderr)


if __name__ == "__main__":
    unittest.main()
