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
# Pinned core imports with only hook-related deletions.
IMPORT_SHA256 = {
    "constitution": "775a220b62d7d59b8740df9f01b36465478cea511e619d21ae3d558599946143",
    "specify": "090c4af532316e6529373e722d7957bec2f27cd74b3f18d525fdbeeaa1aae320",
    "clarify": "dcae481e2a2934576ee9ba8278c37b6d911d423b2087fbd456b48d8619ba21c6",
    "plan": "018293a3440991384ff13b7c5b1bc328d652296fa6304db8c5ad93f9df31605f",
    "tasks": "acd75ba6d4a46704cd2fea7a05bb7578533a9e0b283b14c6140a28c8cd0a22a6",
    "analyze": "e03e7c94a7253d2537fab197e5f2365a7ed9b9cdc6ef8fbec9d3c2663a7c9588",
    "checklist": "cca87df5a8586b0681ef3b0a3e6baca063748eed9546c52775d2f342abcaa143",
    "implement": "7658bcbfff7a78bfb8f6e3ae29b50b7f327f9e6da1e0cf1f57fcc27c5d4e1b55",
    "converge": "2a3cbec425ccf205e7d048f0629584f0d3242d2b92402da196a0c3022198c79e",
}
CORE_GIT_BLOBS = {
    "analyze": "7de2d28f0da797998e5e30d6323b7316a74e60ff",
    "checklist": "6e33f5d4225c539fa1c3860e5409f098a6a8d827",
    "clarify": "f48d8bd703d7eb3fe4eadf2d3d283ca508e6bb80",
    "constitution": "f2c107a15865344ffb684d33c09cb3de7baf1bea",
    "converge": "f6a44c3e91b3c0100aa4553d498e758b1125b9a5",
    "implement": "f98ba525de1bb29efdb520695a4fd3fa8499bbf6",
    "plan": "d559e517ae59bb3e664b59b528372444baac4626",
    "specify": "52b2b2456500c68c6a9cfbac5de9d2df7bedf918",
    "tasks": "1b9c4255fe8d9cd76e8f3e5952ada7a17c62a87e",
}


def lf_bytes(content):
    return content.replace(b"\r\n", b"\n")


class FullPackageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = yaml.safe_load((PACKAGE / "preset.yml").read_text(encoding="utf-8"))
        cls.catalog = json.loads((PRESETS / "catalog.json").read_text(encoding="utf-8"))["presets"][PACKAGE.name]
        cls.commands = {
            name: (PACKAGE / f"commands/speckit.{name}.md").read_text(encoding="utf-8")
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
        self.assertEqual(self.manifest["requires"]["speckit_version"], "==1.2.3")
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
        license_text = (PACKAGE / "LICENSE").read_text(encoding="utf-8")
        self.assertIn("Copyright GitHub, Inc.", license_text)
        self.assertIn("Permission is hereby granted", license_text)
        self.assertIn('THE SOFTWARE IS PROVIDED "AS IS"', license_text)
        readme = (PACKAGE / "README.md").read_text(encoding="utf-8")
        self.assertIn("27d14e20c187c1f2916540ea201ecbdc9f8ed588/templates/commands", readme)
        self.assertIn(f"**{self.manifest['preset']['version']}**", readme)

    def test_reviewed_full_imports_remain_intact(self):
        for name, digest in IMPORT_SHA256.items():
            with self.subTest(command=name):
                content = lf_bytes((PACKAGE / f"commands/speckit.{name}.md").read_bytes())
                for ending in (b"\n", b"\r\n"):
                    with self.subTest(line_ending=ending):
                        checkout = content.replace(b"\n", ending)
                        self.assertEqual(hashlib.sha256(lf_bytes(checkout)).hexdigest(), digest)

    def test_line_ending_normalization_preserves_other_bytes(self):
        self.assertEqual(lf_bytes(b"one\r\ntwo\nthree\rfour \t"), b"one\ntwo\nthree\rfour \t")
        content = "Quality \u226580%\n".encode("utf-8")
        self.assertEqual(lf_bytes(content), content)
        self.assertNotEqual(lf_bytes(content + b" "), content)

    @unittest.skipUnless(os.environ.get("FULL_CORE_SOURCE"), "Set FULL_CORE_SOURCE for authenticated core comparison")
    def test_only_hook_deletions_from_authenticated_core(self):
        source = Path(os.environ["FULL_CORE_SOURCE"]) / "templates/commands"
        for name in sorted(COMMANDS):
            with self.subTest(command=name):
                original = lf_bytes((source / f"{name}.md").read_bytes())
                blob = hashlib.sha1(b"blob " + str(len(original)).encode() + b"\0" + original).hexdigest()
                self.assertEqual(blob, CORE_GIT_BLOBS[name], "Source must match the pinned upstream revision")
                expected = original.decode()
                for heading in (
                    r"## Pre-Execution Checks",
                    r"## Post-Execution Checks",
                    r"## Mandatory Post-Execution Hooks",
                    r"### 9\. Check for extension hooks",
                ):
                    pattern = rf"^{heading}\n.*?(?=^## |\Z)"
                    for section in re.findall(pattern, expected, flags=re.M | re.S):
                        self.assertIn(".specify/extensions.yml", section)
                        self.assertRegex(section, rf"hooks\.(?:before|after)_{name}")
                    expected = re.sub(pattern, "", expected, flags=re.M | re.S)
                expected = re.sub(r"^- \[ \] Extension hooks dispatched.*\n", "", expected, flags=re.M)
                expected = expected.replace(" and proceed to the Mandatory Post-Execution Hooks section", "")
                if name == "specify":
                    expected = re.sub(
                        r"^2\. \*\*Branch creation\*\* \(optional, via hook\):\n.*?(?=^3\. \*\*Create the spec feature directory)",
                        "", expected, flags=re.M | re.S,
                    )
                    expected = expected.replace(", never by the hook", "")
                    expected = expected.replace(
                        "Branch creation is handled by the `before_specify` hook (git extension). ", "",
                    )
                expected = expected.rstrip("\n") + "\n"
                actual = lf_bytes((PACKAGE / f"commands/speckit.{name}.md").read_bytes())
                self.assertEqual(actual, expected.encode(), "Non-hook instructions must match after LF normalization")
                source_iterator = iter(original)
                self.assertTrue(all(byte in source_iterator for byte in actual), "No added bytes allowed")

    def test_no_lifecycle_dispatch_and_preserved_script_metadata(self):
        for name, text in self.commands.items():
            with self.subTest(command=name):
                for forbidden in FORBIDDEN:
                    self.assertNotIn(forbidden, text)
                metadata = yaml.safe_load(text.split("---", 2)[1])
                self.assertIn("description", metadata)
                self.assertIn("$ARGUMENTS", text)
                self.assertNotIn("Copilot interaction", text)
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
                self.assertEqual(lf_bytes(archive.read(name)), lf_bytes((PACKAGE / name).read_bytes()))


@unittest.skipUnless(os.environ.get("FULL_SPECIFY_BIN"), "Set FULL_SPECIFY_BIN for real CLI validation")
class FullCliTests(unittest.TestCase):
    def test_registration_rendering_and_prerequisites(self):
        executable = str(Path(os.environ["FULL_SPECIFY_BIN"]).resolve())
        with tempfile.TemporaryDirectory(prefix="copilot-full-sdd-") as temp:
            root = Path(temp).resolve()
            for script_type in ("sh", "py"):
                with self.subTest(script_type=script_type):
                    project = root / script_type
                    env = dict(os.environ)
                    env["PATH"] = str(Path(executable).parent) + os.pathsep + env["PATH"]
                    env["PYTHONIOENCODING"] = "utf-8"

                    def run(args, cwd=project, success=True):
                        result = subprocess.run(
                            args, cwd=cwd, env=env, text=True, encoding="utf-8",
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
                    self.assertLessEqual(COMMANDS, core)
                    run([executable, "preset", "add", "--dev", str(PACKAGE)])
                    scripts = {}
                    for name in sorted(COMMANDS):
                        resolved = run([executable, "preset", "resolve", f"speckit.{name}"])
                        self.assertIn(PACKAGE.name, resolved.stdout)
                        skill = (project / f".github/skills/speckit-{name}/SKILL.md").read_text(encoding="utf-8")
                        metadata = yaml.safe_load(skill.split("---", 2)[1])
                        self.assertEqual(metadata["metadata"]["source"], f"preset:{PACKAGE.name}")
                        self.assertEqual(metadata["name"], f"speckit-{name}")
                        for forbidden in (*FORBIDDEN, "{SCRIPT}", "{ARGS}", "__SPECKIT_COMMAND_", "/memory/"):
                            if forbidden == "/memory/":
                                self.assertNotIn("`/memory/", skill)
                            else:
                                self.assertNotIn(forbidden, skill)
                        self.assertNotIn("scripts:", skill.split("---", 2)[1])
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
                    config.write_text(json.dumps({"feature_directory": "specs/001-contract"}) + "\n", encoding="utf-8")
                    before = config.read_bytes()
                    paths = json.loads(run(scripts["clarify"]).stdout)
                    self.assertEqual(Path(paths["FEATURE_SPEC"]), feature / "spec.md")
                    self.assertEqual(config.read_bytes(), before)

                    # Missing plan gates tasks/checklist/analysis/implementation/convergence.
                    for name in ("tasks", "checklist", "analyze", "implement", "converge"):
                        failure = run(scripts[name], success=False)
                        self.assertIn("plan.md", failure.stdout + failure.stderr)
                    (feature / "spec.md").write_text(
                        "# Contract feature\n\n## Requirements\n- FR-001: Return a greeting.\n",
                        encoding="utf-8",
                    )
                    (feature / "plan.md").write_bytes(b"")
                    for name in ("checklist", "analyze", "implement", "converge"):
                        failure = run(scripts[name], success=False)
                        self.assertIn("plan.md is empty", failure.stdout + failure.stderr)
                    (feature / "plan.md").unlink()
                    plan = json.loads(run(scripts["plan"]).stdout)
                    self.assertEqual(Path(plan["IMPL_PLAN"]), feature / "plan.md")
                    plan_content = (feature / "plan.md").read_text(encoding="utf-8")
                    self.assertIn("Constitution Check", plan_content)
                    authored_plan = (
                        plan_content + "\n## Authored decision\nKeep this decision \u2014 do not replace it.\n"
                    ).encode("utf-8")
                    (feature / "plan.md").write_bytes(authored_plan)
                    self.assertEqual(run(scripts["plan"]).returncode, 0)
                    self.assertEqual((feature / "plan.md").read_bytes(), authored_plan)
                    tasks = json.loads(run(scripts["tasks"]).stdout)
                    self.assertIn("TASKS_TEMPLATE_CONTENT", tasks)
                    self.assertIn("User Story", tasks["TASKS_TEMPLATE_CONTENT"])
                    checklist = json.loads(run(scripts["checklist"]).stdout)
                    self.assertIn("TEMPLATE_CONTENT", checklist)
                    for name in ("analyze", "implement", "converge"):
                        failure = run(scripts[name], success=False)
                        self.assertIn("tasks.md", failure.stdout + failure.stderr)
                    (feature / "tasks.md").write_text(
                        "# Tasks\n- [ ] T001 Return greeting in hello.py\n", encoding="utf-8",
                    )
                    for name in ("analyze", "implement", "converge"):
                        result = json.loads(run(scripts[name]).stdout)
                        self.assertIn("tasks.md", result["AVAILABLE_DOCS"])
                    (feature / "spec.md").unlink()
                    for name in ("analyze", "converge"):
                        failure = run(scripts[name], success=False)
                        self.assertIn("spec.md", failure.stdout + failure.stderr)


if __name__ == "__main__":
    unittest.main()
