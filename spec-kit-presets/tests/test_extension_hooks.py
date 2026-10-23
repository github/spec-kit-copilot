import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import textwrap
import unittest
from zipfile import ZipFile

import yaml


PRESETS = Path(__file__).resolve().parents[1]
PACKAGE = PRESETS / "copilot-extension-hooks"
COMMANDS = {
    "constitution", "specify", "clarify", "plan", "tasks",
    "analyze", "checklist", "implement", "converge",
}
FILES = {"preset.yml", "README.md", "LICENSE", "commands/lifecycle.md"}
START = "## Copilot extension lifecycle checkpoints"
CLI = os.environ.get("HOOKS_SPECIFY_BIN")
BASELINES = Path(os.environ.get("HOOKS_BASELINES_ROOT", str(PRESETS)))
COPILOT = os.environ.get("HOOKS_COPILOT_BIN")


def frontmatter(text):
    return yaml.safe_load(text.split("---", 2)[1])


def body(text):
    rendered = text.split("---", 2)[2].strip()
    # Specify adds the skill title outside the composed command body.
    if rendered.startswith("# "):
        rendered = rendered.split("\n", 1)[1].strip()
    return rendered


class HookPackageTests(unittest.TestCase):
    def test_metadata_inventory_and_license(self):
        manifest = yaml.safe_load((PACKAGE / "preset.yml").read_text(encoding="utf-8"))
        catalog = json.loads((PRESETS / "catalog.json").read_text(encoding="utf-8"))
        entry = catalog["presets"][PACKAGE.name]
        self.assertEqual(manifest["schema_version"], "1.0")
        for key, value in manifest["preset"].items():
            self.assertEqual(entry[key], value, key)
        self.assertEqual(manifest["preset"]["id"], PACKAGE.name)
        self.assertEqual(manifest["preset"]["version"], "1.0.0")
        self.assertEqual(manifest["requires"], {"speckit_version": "==1.2.3"})
        self.assertEqual(entry["requires"], manifest["requires"])
        self.assertEqual(entry["tags"], manifest["tags"])
        self.assertEqual(entry["provides"], {"templates": 0, "commands": 9})
        self.assertEqual(
            entry["download_url"],
            "https://github.com/github/spec-kit-copilot/releases/download/"
            "copilot-extension-hooks-v1.0.0/copilot-extension-hooks.zip",
        )
        templates = manifest["provides"]["templates"]
        self.assertEqual(len(templates), 9)
        self.assertEqual({t["name"] for t in templates}, {f"speckit.{c}" for c in COMMANDS})
        for template in templates:
            self.assertEqual(template["type"], "command")
            self.assertEqual(template["strategy"], "wrap")
            self.assertEqual(template["replaces"], template["name"])
            self.assertEqual(template["file"], "commands/lifecycle.md")
        paths = list(PACKAGE.rglob("*"))
        self.assertFalse(any(p.is_symlink() for p in paths))
        self.assertEqual(
            {p.relative_to(PACKAGE).as_posix() for p in paths if p.is_file()}, FILES,
        )
        license_text = (PACKAGE / "LICENSE").read_text(encoding="utf-8")
        for phrase in ("Copyright GitHub, Inc.", "Permission is hereby granted", "AS IS"):
            self.assertIn(phrase, license_text)

    def test_instruction_contract_not_a_runtime_compliance_test(self):
        wrapper = (PACKAGE / "commands/lifecycle.md").read_text(encoding="utf-8")
        self.assertFalse(wrapper.startswith("---"), "Inherit all baseline frontmatter")
        self.assertEqual(wrapper.count("{CORE_TEMPLATE}"), 1)
        self.assertEqual(wrapper.count(START), 1)
        self.assertLess(wrapper.index("## Pre-Execution Checks"), wrapper.index("{CORE_TEMPLATE}"))
        self.assertLess(wrapper.index("{CORE_TEMPLATE}"), wrapper.index("## Post-Execution Checks"))
        for phrase in (
            "hooks.before_<command>", "hooks.after_<command>",
            "configured YAML list", "Do not sort", "enabled` is explicitly `false",
            "enabled by default", "do **not** attempt to interpret or evaluate",
            "null/empty", "non-empty `condition`", "optional: true", "optional: false",
            "omitted flag defaults to optional", "EXECUTE_COMMAND: {command}",
            "MUST actually invoke the hook and wait", "actual work and result",
            "invocation is unavailable or denied", "hook fails",
            "stop this invocation", "do not report successful workflow completion",
            "include the parser", "then continue normally",
            "do not invoke it twice", "not a persistent lock",
            "before** the baseline Completion Report",
            "after producing and reporting `converged` or `tasks_appended`",
            "not Copilot native", "including all its artifact",
        ):
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, wrapper)
        readme = (PACKAGE / "README.md").read_text(encoding="utf-8")
        for phrase in (
            "**1.0.0**", "27d14e20c187c1f2916540ea201ecbdc9f8ed588",
            "**Initial release pending.**", "do not regenerate existing skills",
            "specify preset remove copilot-extension-hooks",
            "not a runtime executor", "Copilot App behavior is not established",
        ):
            self.assertIn(phrase, " ".join(readme.split()))

    def test_release_archive_layout(self):
        with tempfile.TemporaryDirectory() as temp:
            archive = Path(temp) / "copilot-extension-hooks.zip"
            with ZipFile(archive, "w") as output:
                for relative in sorted(FILES):
                    output.write(PACKAGE / relative, relative)
            with ZipFile(archive) as zipped:
                self.assertEqual(set(zipped.namelist()), FILES)
                manifest = yaml.safe_load(zipped.read("preset.yml"))
                self.assertEqual(manifest["preset"]["id"], PACKAGE.name)
                for template in manifest["provides"]["templates"]:
                    self.assertIn(template["file"], zipped.namelist())


@unittest.skipUnless(CLI, "Set HOOKS_SPECIFY_BIN to released Specify 1.2.3")
class SpecifyCompositionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cli = str(Path(CLI).resolve())
        version = subprocess.run(
            [cls.cli, "--version"], text=True, encoding="utf-8",
            capture_output=True, check=True, timeout=30,
        )
        if version.stdout.strip() != "specify 1.2.3":
            raise AssertionError(f"Expected Specify 1.2.3, got {version.stdout!r}")
        for name in ("copilot-lean-sdd", "copilot-full-sdd"):
            if not (BASELINES / name / "preset.yml").is_file():
                raise AssertionError(f"Missing canonical baseline fixture: {BASELINES / name}")

    def run_cli(self, project, *args):
        env = dict(os.environ)
        env["PATH"] = str(Path(self.cli).parent) + os.pathsep + env["PATH"]
        env["PYTHONIOENCODING"] = "utf-8"
        result = subprocess.run(
            [self.cli, *args], cwd=project, env=env, text=True, encoding="utf-8",
            capture_output=True, timeout=120,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result.stdout

    def skills(self, project):
        return {
            name: (project / f".github/skills/speckit-{name}/SKILL.md").read_text(encoding="utf-8")
            for name in sorted(COMMANDS)
        }

    def test_real_skills_composition_activation_priority_and_removal(self):
        for baseline in ("copilot-lean-sdd", "copilot-full-sdd"):
            for script in ("sh", "ps", "py"):
                with self.subTest(baseline=baseline, script=script), tempfile.TemporaryDirectory() as temp:
                    root = Path(temp)
                    project = root / "project"
                    self.run_cli(
                        root, "init", str(project), "--integration", "copilot",
                        "--integration-options=--skills", "--ignore-agent-tools",
                        "--non-interactive", "--script", script,
                    )
                    source = BASELINES / baseline
                    original_sources = {
                        p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                        for p in (source / "commands").glob("*.md")
                    }
                    self.run_cli(project, "preset", "add", "--dev", str(source), "--priority", "10")
                    baseline_skills = self.skills(project)
                    for skill in baseline_skills.values():
                        self.assertNotIn(".specify/extensions.yml", skill)
                        self.assertNotIn("EXECUTE_COMMAND", skill)
                    authored = project / "specs/authored.txt"
                    authored.parent.mkdir(exist_ok=True)
                    authored.write_bytes(b"Authored feature artifacts must not change.\n")
                    self.run_cli(project, "preset", "add", "--dev", str(PACKAGE), "--priority", "5")
                    composed = self.skills(project)
                    for name, text in composed.items():
                        with self.subTest(command=name):
                            self.assertEqual(text.count(START), 1)
                            self.assertEqual(text.count("EXECUTE_COMMAND: {command}"), 1)
                            self.assertEqual(text.count(body(baseline_skills[name])), 1)
                            selected = text.split("## Selected baseline", 1)[1].rsplit(
                                "## Post-Execution Checks", 1,
                            )[0].strip()
                            self.assertEqual(selected, body(baseline_skills[name]))
                            self.assertIn("hooks.before_<command>", text)
                            self.assertIn("hooks.after_<command>", text)
                            self.assertNotIn("{CORE_TEMPLATE}", text)
                            self.assertNotIn("{SCRIPT}", text)
                            self.assertNotIn("__SPECKIT_COMMAND_", text)
                            metadata = frontmatter(text)
                            self.assertEqual(metadata["name"], f"speckit-{name}")
                            self.assertEqual(
                                metadata["description"], frontmatter(baseline_skills[name])["description"],
                            )
                            self.assertEqual(metadata["metadata"]["source"], f"preset:{PACKAGE.name}")
                            resolved = self.run_cli(project, "preset", "resolve", f"speckit.{name}")
                            self.assertIn(PACKAGE.name, resolved)
                    self.run_cli(project, "preset", "disable", PACKAGE.name)
                    self.assertEqual(self.skills(project), composed, "Disable alone leaves stale skills")
                    self.assertIn(baseline, self.run_cli(project, "preset", "resolve", "speckit.plan"))
                    self.run_cli(project, "preset", "enable", PACKAGE.name)
                    self.run_cli(project, "preset", "set-priority", PACKAGE.name, "15")
                    self.assertEqual(self.skills(project), composed, "Priority alone leaves stale skills")
                    self.assertIn(baseline, self.run_cli(project, "preset", "resolve", "speckit.plan"))
                    self.run_cli(project, "preset", "remove", PACKAGE.name)
                    self.assertEqual(self.skills(project), baseline_skills)
                    self.run_cli(project, "preset", "add", "--dev", str(PACKAGE), "--priority", "15")
                    for name, text in self.skills(project).items():
                        self.assertNotIn(START, text, "A higher-precedence replacement hides the wrapper")
                        self.assertEqual(body(text), body(baseline_skills[name]))
                    self.run_cli(project, "preset", "remove", PACKAGE.name)
                    self.run_cli(project, "preset", "add", "--dev", str(PACKAGE), "--priority", "5")
                    self.assertEqual(self.skills(project), composed)
                    override = project / ".specify/templates/overrides/speckit.plan.md"
                    override.parent.mkdir(parents=True, exist_ok=True)
                    override.write_text(
                        "---\ndescription: Project override\n---\n\nProject-only plan.\n", encoding="utf-8",
                    )
                    self.run_cli(project, "preset", "remove", PACKAGE.name)
                    self.run_cli(project, "preset", "add", "--dev", str(PACKAGE), "--priority", "5")
                    self.assertNotIn(START, self.skills(project)["plan"])
                    self.assertIn("Project-only plan.", self.skills(project)["plan"])
                    self.assertEqual(authored.read_bytes(), b"Authored feature artifacts must not change.\n")
                    self.assertEqual(original_sources, {
                        p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                        for p in (source / "commands").glob("*.md")
                    })


@unittest.skipUnless(CLI and COPILOT, "Set HOOKS_SPECIFY_BIN and HOOKS_COPILOT_BIN for bounded model exercises")
class CopilotBehaviorTests(unittest.TestCase):
    run_cli = SpecifyCompositionTests.run_cli

    @classmethod
    def setUpClass(cls):
        SpecifyCompositionTests.setUpClass.__func__(cls)

    def make_project(self, root, baseline, scenario):
        project = root / "project"
        self.run_cli(
            root, "init", str(project), "--integration", "copilot",
            "--integration-options=--skills", "--ignore-agent-tools",
            "--non-interactive", "--script", "py",
        )
        self.run_cli(project, "preset", "add", "--dev", str(BASELINES / baseline), "--priority", "10")
        if scenario != "absent":
            self.run_cli(project, "preset", "add", "--dev", str(PACKAGE), "--priority", "5")
        feature = project / "specs/fixture"
        feature.mkdir(parents=True)
        (project / ".specify/feature.json").write_text(
            json.dumps({"feature_directory": "specs/fixture"}), encoding="utf-8",
        )
        (project / ".specify/memory/constitution.md").write_text(
            "# Constitution\n\nOnly the requested local fixture outcome is in scope. "
            "Do not access external services or change global configuration.\n", encoding="utf-8",
        )
        (feature / "spec.md").write_text(
            "# Marker feature\n\n## User Story 1\nProduce a local result file.\n\n"
            "## Functional Requirements\nFR-001: result.txt contains exactly `done` and a newline.\n\n"
            "## Success Criteria\nSC-001: Running the documented verification succeeds.\n", encoding="utf-8",
        )
        (feature / "plan.md").write_text(
            "# Plan\n\nUse the existing fixture.py CLI and the installed Python interpreter. "
            "No dependencies, research, data model, interfaces, or new source files are needed.\n\n"
            "Run `python3 fixture.py body`, then "
            "`python3 fixture.py verify`. Existing local trace files are fixture diagnostics.\n",
            encoding="utf-8",
        )
        (feature / "tasks.md").write_text(
            "# Tasks\n\n## Phase 1: Marker\n\n"
            "- [ ] T001 [US1] Run `python3 fixture.py body` to produce result.txt; "
            "verify using `python3 fixture.py verify`.\n", encoding="utf-8",
        )
        hook_steps = ("pre-one", "pre-two", "post-one", "post-two")
        expect_hooks = scenario not in ("absent", "malformed")
        (project / "fixture.json").write_text(
            json.dumps({"scenario": scenario, "hooks": expect_hooks}), encoding="utf-8",
        )
        (project / "fixture.py").write_text(textwrap.dedent("""\
            import json
            from pathlib import Path
            import sys
            import time

            root = Path(__file__).resolve().parent
            config = json.loads((root / "fixture.json").read_text())
            trace = root / "trace.jsonl"
            step = sys.argv[1]
            if step == "verify":
                assert (root / "result.txt").read_bytes() == b"done\\n"
                print("RESULT_VERIFIED")
                raise SystemExit(0)
            sequence = ["pre-one", "pre-two", "body", "post-one", "post-two"]
            if not config["hooks"]:
                sequence = ["body"]
            if step not in sequence:
                raise SystemExit("FORBIDDEN_HOOK_INVOKED: " + step)
            prior = sequence[:sequence.index(step)]
            expected = [item + suffix for item in prior for suffix in (".start", ".end")]
            actual = [json.loads(line)["event"] for line in trace.read_text().splitlines()] if trace.exists() else []
            assert actual == expected, (actual, expected)
            if step.startswith("post-"):
                tasks = (root / "specs/fixture/tasks.md").read_text().lower()
                assert "- [x] t001" in tasks, "Post hook ran before task completion"
            def emit(suffix):
                with trace.open("a") as output:
                    output.write(json.dumps({"event": step + suffix, "time": time.monotonic_ns()}) + "\\n")
            emit(".start")
            time.sleep(0.4)
            if (config["scenario"] == "pre-failure" and step == "pre-one") or (config["scenario"] == "post-failure" and step == "post-one"):
                raise SystemExit("FIXTURE_HOOK_FAILED: " + step)
            if step == "body":
                (root / "result.txt").write_bytes(b"done\\n")
            emit(".end")
            print("COMPLETED: " + step)
            """), encoding="utf-8",
        )
        for step in (*hook_steps, "disabled", "conditional", "optional", "optional-default"):
            name = f"speckit-fixture-{step}"
            folder = project / ".github/skills" / name
            folder.mkdir()
            (folder / "SKILL.md").write_text(
                f"---\nname: {name}\ndescription: Execute the local {step} marker hook.\n---\n\n"
                f"Run `python3 fixture.py {step}` from the project root exactly once. "
                "Wait for its exit and report the actual result. Do not edit the script or "
                "trace, retry a failure, delegate, or run a different step.\n", encoding="utf-8",
            )

        def hook(step, **fields):
            return {"extension": "fixture", "command": f"speckit.fixture.{step}", **fields}

        config = {
            "settings": {"auto_execute_hooks": False},
            "hooks": {
                "before_implement": [
                    hook("pre-one", optional=False, priority=50, condition=None),
                    hook("disabled", optional=False, enabled=False),
                    hook("conditional", optional=False, condition="env.PATH is set"),
                    hook("optional", optional=True, prompt="Optional marker; user has not requested it."),
                    hook("optional-default"),
                    hook("pre-two", optional=False, enabled=True, priority=1, condition=""),
                    hook("pre-one", optional=False, priority=50),
                ],
                "after_implement": [
                    hook("post-one", optional=False, priority=50),
                    hook("post-two", optional=False, priority=1),
                ],
            },
        }
        (project / ".specify/extensions.yml").write_text(
            "hooks: [invalid YAML" if scenario == "malformed" else yaml.safe_dump(config, sort_keys=False),
            encoding="utf-8",
        )
        if scenario == "missing-plan":
            (feature / "plan.md").unlink()
        return project

    def test_bounded_cli_invocation_wait_skips_duplicates_and_failures(self):
        evidence = os.environ.get("HOOKS_EVIDENCE_DIR")
        scenarios = os.environ.get(
            "HOOKS_BEHAVIOR_SCENARIOS",
            "success,pre-failure,post-failure,absent,malformed,missing-plan,denied",
        ).split(",")
        self.assertTrue(set(scenarios) <= {
            "success", "pre-failure", "post-failure", "absent", "malformed", "missing-plan", "denied",
        })
        for baseline in ("copilot-lean-sdd", "copilot-full-sdd"):
            for scenario in scenarios:
                with self.subTest(baseline=baseline, scenario=scenario), tempfile.TemporaryDirectory() as temp:
                    root = Path(temp)
                    project = self.make_project(root, baseline, scenario)
                    prompt = (
                        "Run this project's speckit-implement skill for its active feature and report "
                        "the actual outcome. Use only local files and commands in this disposable "
                        "project. Do not access external services, change global configuration, "
                        "spawn agents, or change skill files, fixture.py, fixture.json, or extensions.yml."
                    )
                    result = subprocess.run(
                        [
                            str(Path(COPILOT).resolve()), "-C", str(project), "-p", prompt,
                            "--trust-folder", "--allow-all-tools", "--disable-builtin-mcps",
                            "--available-tools=bash,view,rg,glob,skill,apply_patch",
                            "--deny-tool=shell(gh:*)", "--deny-tool=shell(curl:*)",
                            "--deny-tool=shell(git push:*)",
                            *(["--deny-tool=shell(python3:*)"] if scenario == "denied" else []),
                            "--log-dir", str(root / "host-logs"), "--output-format", "json",
                        ],
                        text=True, encoding="utf-8", capture_output=True, timeout=300,
                    )
                    trace_path = project / "trace.jsonl"
                    trace = trace_path.read_text(encoding="utf-8") if trace_path.exists() else ""
                    events = [json.loads(line)["event"] for line in trace.splitlines()]
                    if evidence:
                        folder = Path(evidence) / f"{baseline}-{scenario}"
                        folder.mkdir(parents=True, exist_ok=True)
                        (folder / "host.jsonl").write_text(result.stdout, encoding="utf-8")
                        (folder / "stderr.txt").write_text(result.stderr, encoding="utf-8")
                        (folder / "trace.jsonl").write_text(trace, encoding="utf-8")
                        (folder / "tasks.md").write_bytes((project / "specs/fixture/tasks.md").read_bytes())
                    self.assertEqual(result.returncode, 0, result.stderr[-2000:])
                    if scenario in ("pre-failure", "denied", "missing-plan"):
                        expected = {
                            "pre-failure": ["pre-one.start"],
                            "denied": [],
                            "missing-plan": ["pre-one.start", "pre-one.end", "pre-two.start", "pre-two.end"],
                        }[scenario]
                        self.assertEqual(events, expected)
                        self.assertFalse((project / "result.txt").exists())
                        self.assertIn("- [ ] T001", (project / "specs/fixture/tasks.md").read_text())
                        if scenario == "pre-failure":
                            self.assertIn("FIXTURE_HOOK_FAILED", result.stdout)
                        elif scenario == "denied":
                            self.assertIn("denied", result.stdout.lower())
                    else:
                        if scenario in ("absent", "malformed"):
                            expected = ["body.start", "body.end"]
                        else:
                            completed = ["pre-one", "pre-two", "body"]
                            if scenario == "success":
                                completed += ["post-one", "post-two"]
                            expected = [item + suffix for item in completed for suffix in (".start", ".end")]
                            if scenario == "post-failure":
                                expected.append("post-one.start")
                                self.assertIn("FIXTURE_HOOK_FAILED", result.stdout)
                        self.assertEqual(events, expected)
                        self.assertEqual((project / "result.txt").read_bytes(), b"done\n")
                        self.assertIn("- [x] t001", (project / "specs/fixture/tasks.md").read_text().lower())
                    messages = [
                        json.loads(line)["data"].get("content", "")
                        for line in result.stdout.splitlines()
                        if json.loads(line).get("type") == "assistant.message"
                    ]
                    if scenario not in ("absent", "malformed"):
                        self.assertIn("EXECUTE_COMMAND: speckit.fixture.pre-one", "\n".join(messages))
                    if scenario == "malformed":
                        self.assertIn("mandatory", result.stdout.lower())
                        self.assertIn("parse", result.stdout.lower())


if __name__ == "__main__":
    unittest.main()
