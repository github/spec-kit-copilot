import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import tempfile
import textwrap
import unittest
from unittest.mock import patch
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
GIT_HOOK_SCRIPT = ".specify/extensions/git/scripts/bash/create-new-feature-branch.sh"


def validate_preset_archive(path):
    with ZipFile(path) as archive:
        names = [entry.filename for entry in archive.infolist() if not entry.is_dir()]
        if set(names) != FILES or len(names) != len(FILES):
            raise AssertionError("Archive file names and count must match the package")
        for name in names:
            if archive.read(name).replace(b"\r\n", b"\n") != (PACKAGE / name).read_bytes().replace(b"\r\n", b"\n"):
                raise AssertionError(f"Archive content differs from package: {name}")


def validate_assistant_reporting(events, scenario):
    messages = [
        event["data"] for event in events if event.get("type") == "assistant.message"
        and event.get("data", {}).get("content")
    ]
    if scenario in ("pre-failure", "post-failure", "denied"):
        finals = [message["content"] for message in messages if message.get("phase") == "final_answer"]
        if not finals:
            raise AssertionError("Missing final assistant failure report")
        final = finals[-1].replace("*", "").lower()
        command = "speckit.fixture.post-one" if scenario == "post-failure" else "speckit.fixture.pre-one"
        if command not in final or not re.search(
            r"\b(fail(?:ed|ure)?|denied|stopped|unsuccessful|unable|cannot)\b|could not", final,
        ):
            raise AssertionError("Final response must identify the mandatory hook and unsuccessful outcome")
        if re.search(
            r"\b(?:workflow|skill(?: run)?|overall run)\s+(?:has\s+|was\s+)?"
            r"(?:completed(?!\s+(?:unsuccessfully\b|with\s+errors\b))"
            r"(?:\s+successfully)?|succeeded|successful)\b"
            r"|\bsuccessfully completed (?:the |this |entire )*(?:workflow|skill)\b"
            r"|\beverything (?:succeeded|completed successfully)\b",
            final,
        ):
            raise AssertionError("Final response contradicts the mandatory hook failure with workflow success")
    if scenario == "malformed":
        warnings = [message["content"].lower() for message in messages]
        if not any(
            "extensions.yml" in warning and "mandatory" in warning
            and re.search(r"yaml|pars(?:e|er|ing)", warning)
            and re.search(r"could not|cannot|unable|not checked|no hooks|unchecked", warning)
            for warning in warnings
        ):
            raise AssertionError("Assistant must warn that malformed YAML prevented mandatory hook checks")


def validate_optional_invocations(events, commands):
    messages = "\n".join(
        event["data"].get("content", "") for event in events
        if event.get("type") == "assistant.message"
    )
    invocations = re.findall(r"To execute:\s*`([^`]+)`", messages)
    for command in commands:
        expected = "/" + command.replace(".", "-")
        if expected not in invocations:
            raise AssertionError(f"Missing host-supported optional invocation: {expected}")
        if "/" + command in invocations:
            raise AssertionError(f"Dotted command ID is not a skills-mode invocation: {command}")


def successful_git_hook_invocations(events):
    """Accept only one direct script command per successful Bash tool call."""
    invocations = []
    completions = {
        event["data"]["toolCallId"]: event["data"]
        for event in events if event.get("type") == "tool.execution_complete"
    }
    for event in events:
        if event.get("type") != "assistant.message":
            continue
        for request in event["data"].get("toolRequests", []):
            if request.get("name") != "bash":
                continue
            command = request.get("arguments", {}).get("command", "")
            if GIT_HOOK_SCRIPT not in command:
                continue
            lexer = shlex.shlex(command, posix=True, punctuation_chars=True)
            lexer.whitespace_split = True
            tokens = list(lexer)
            while tokens and tokens[0].startswith("SPECIFY_FEATURE_DIRECTORY="):
                tokens.pop(0)
            # Deliberately constrain this fixture to a single simple invocation.
            if any(
                token and all(character in ";&|<>()" for character in token) for token in tokens
            ) or any(symbol in command for symbol in ("\n", "`", "$(")):
                raise AssertionError("Hook execution must be a single simple command")
            if tokens and tokens[0] in ("cat", "echo", "grep"):
                continue  # Simple read-only mentions are not execution.
            if tokens and tokens[-1] in (GIT_HOOK_SCRIPT, "./" + GIT_HOOK_SCRIPT):
                inspection = tokens[:-1]
                if (
                    inspection in (["head"], ["ls"], ["ls", "-l"], ["ls", "-la"])
                    or (
                        len(inspection) == 3 and inspection[:2] == ["head", "-n"]
                        and inspection[2].isdigit()
                    )
                    or (
                        len(inspection) == 3 and inspection[:2] == ["sed", "-n"]
                        and re.fullmatch(r"\d+(?:,\d+)?p", inspection[2])
                    )
                ):
                    continue
            if tokens and tokens[0] in ("bash", "sh"):
                tokens.pop(0)
            if not tokens or tokens[0] not in (GIT_HOOK_SCRIPT, "./" + GIT_HOOK_SCRIPT):
                raise AssertionError("Unrecognized hook attempt: use a direct script invocation")
            args = tokens[1:]
            if "--dry-run" in args or args.count("--json") != 1 or args.count("--short-name") != 1:
                raise AssertionError("Expected one real JSON branch-creation invocation")
            remaining = list(args)
            remaining.remove("--json")
            short_index = remaining.index("--short-name")
            del remaining[short_index:short_index + 2]
            if len(remaining) != 1 or remaining[0].startswith("-"):
                raise AssertionError("Unexpected hook invocation arguments")
            completion = completions.get(request.get("toolCallId"))
            output = (completion or {}).get("result", {}).get("content", "")
            if not completion or not completion.get("success") or "exit code 0" not in output:
                raise AssertionError("Missing successful tool result for hook invocation")
            branch_outputs = []
            for line in output.splitlines():
                if line.startswith("{"):
                    branch_outputs.append(json.loads(line))
            if not any("BRANCH_NAME" in result and "FEATURE_NUM" in result for result in branch_outputs):
                raise AssertionError("Missing branch-creation script JSON result")
            invocations.append(request)
    return invocations


class TranscriptOracleTests(unittest.TestCase):
    def test_optional_suggestions_use_installed_skill_invocations(self):
        command = "speckit.git.commit"
        good = {"type": "assistant.message", "data": {
            "content": "Command: `speckit.git.commit`\nTo execute: `/speckit-git-commit`",
        }}
        validate_optional_invocations([good], [command])
        for bad in (
            {"type": "assistant.message", "data": {"content": "To execute: `/speckit.git.commit`"}},
            {"type": "tool.execution_complete", "data": {"result": {"content": good["data"]["content"]}}},
        ):
            with self.subTest(transcript=bad), self.assertRaises(AssertionError):
                validate_optional_invocations([bad], [command])

    def test_failure_reporting_requires_an_uncontradicted_final_assistant_report(self):
        for scenario in ("pre-failure", "post-failure", "denied"):
            command = "speckit.fixture.post-one" if scenario == "post-failure" else "speckit.fixture.pre-one"
            report = f"Stopped: mandatory hook {command} failed; workflow cannot complete."
            good = {"type": "assistant.message", "data": {"phase": "final_answer", "content": report}}
            validate_assistant_reporting([good], scenario)
            for outcome in ("completed unsuccessfully", "completed with errors"):
                with self.subTest(scenario=scenario, outcome=outcome):
                    validate_assistant_reporting([{
                        "type": "assistant.message",
                        "data": {"phase": "final_answer", "content": report + f" The workflow {outcome}."},
                    }], scenario)
            bad_cases = [
                [{"type": "tool.execution_complete", "data": {"result": {"content": report}}}],
                [{"type": "assistant.message", "data": {"phase": "commentary", "content": report}}],
                [{"type": "assistant.message", "data": {"phase": "final_answer", "content": "All done."}}],
                [{"type": "assistant.message", "data": {
                    "phase": "final_answer", "content": report + " The workflow completed successfully.",
                }}],
                [{"type": "assistant.message", "data": {
                    "phase": "final_answer", "content": report + " The workflow completed.",
                }}],
                [{"type": "assistant.message", "data": {
                    "phase": "final_answer",
                    "content": report + " The workflow completed with errors. The workflow succeeded.",
                }}],
            ]
            for bad in bad_cases:
                with self.subTest(scenario=scenario, transcript=bad), self.assertRaises(AssertionError):
                    validate_assistant_reporting(bad, scenario)

    def test_malformed_warning_must_come_from_the_assistant(self):
        warning = ".specify/extensions.yml has invalid YAML; no hooks, including mandatory hooks, were checked."
        validate_assistant_reporting([
            {"type": "assistant.message", "data": {"phase": "final_answer", "content": warning}},
        ], "malformed")
        with self.assertRaises(AssertionError):
            validate_assistant_reporting([
                {"type": "tool.execution_complete", "data": {"result": {"content": warning}}},
                {"type": "assistant.message", "data": {"phase": "final_answer", "content": "Completed."}},
            ], "malformed")

    def test_script_mentions_and_compound_calls_are_not_one_execution(self):
        command = (
            f'SPECIFY_FEATURE_DIRECTORY=specs/offline-greeting {GIT_HOOK_SCRIPT} '
            '--json --short-name offline-greeting "A local greeting; Hello, <name>!"'
        )

        def transcript(commands, success=True):
            events = []
            for index, text in enumerate(commands):
                call_id = str(index)
                events.extend([
                    {"type": "assistant.message", "data": {"toolRequests": [{
                        "toolCallId": call_id, "name": "bash", "arguments": {"command": text},
                    }]}},
                    {"type": "tool.execution_complete", "data": {
                        "toolCallId": call_id, "success": success, "result": {
                            "content": '{"BRANCH_NAME":"001-greeting","FEATURE_NUM":"001"}\n'
                            "<shellId: 2 completed with exit code 0>",
                        },
                    }},
                ])
            return events

        self.assertEqual(len(successful_git_hook_invocations(transcript([command]))), 1)
        for mention in (
            f"cat {GIT_HOOK_SCRIPT}", f"echo {GIT_HOOK_SCRIPT}", f"grep git {GIT_HOOK_SCRIPT}",
            f"head {GIT_HOOK_SCRIPT}", f"head -n 80 {GIT_HOOK_SCRIPT}",
            f"ls {GIT_HOOK_SCRIPT}", f"ls -l {GIT_HOOK_SCRIPT}",
            f"sed -n '1,80p' {GIT_HOOK_SCRIPT}",
        ):
            with self.subTest(inspection=mention):
                self.assertEqual(successful_git_hook_invocations(transcript([mention])), [])
                self.assertEqual(len(successful_git_hook_invocations(transcript([mention, command]))), 1)
        for compound in (f"{command}; {command}", f"{command} && {command}", command + " --dry-run"):
            with self.subTest(command=compound), self.assertRaises(AssertionError):
                successful_git_hook_invocations(transcript([compound]))
        self.assertEqual(len(successful_git_hook_invocations(transcript([command, command]))), 2)
        with self.assertRaises(AssertionError):
            successful_git_hook_invocations(transcript([command], success=False))
        with self.assertRaises(AssertionError):
            successful_git_hook_invocations(transcript([command])[:1])
        for wrapped in (
            f"bash -c {shlex.quote(command)}",
            f"sh -c {shlex.quote(command)}",
            f"env bash -c {shlex.quote(command)}",
            f"sed -n '1e bash {GIT_HOOK_SCRIPT}' {GIT_HOOK_SCRIPT}",
        ):
            retry = transcript([command, wrapped])
            retry[-1]["data"]["success"] = False
            with self.subTest(retry=wrapped), self.assertRaisesRegex(AssertionError, "Unrecognized hook attempt"):
                successful_git_hook_invocations(retry)
        for inspection in (f"head {GIT_HOOK_SCRIPT}", f"sed -n '1,80p' {GIT_HOOK_SCRIPT}"):
            with self.subTest(compound_inspection=inspection), self.assertRaises(AssertionError):
                successful_git_hook_invocations(transcript([f"{inspection}; {command}"]))


def write_marker_script(project):
    (project / "fixture.py").write_text(textwrap.dedent("""\
        import json
        from pathlib import Path
        import sys
        import time

        root = Path(__file__).resolve().parent
        config = json.loads((root / "fixture.json").read_text())
        trace = root / "trace.jsonl"
        step = sys.argv[1]
        def emit(suffix):
            with trace.open("a") as output:
                output.write(json.dumps({"event": step + suffix, "time": time.monotonic_ns()}) + "\\n")
        def reject(message):
            emit(".rejected")
            raise SystemExit(message)
        if step == "verify":
            if (root / "result.txt").read_bytes() != b"done\\n":
                reject("RESULT_VERIFICATION_FAILED")
            print("RESULT_VERIFIED")
            raise SystemExit(0)
        sequence = ["pre-one", "pre-two", "body", "post-one", "post-two"]
        if not config["hooks"]:
            sequence = ["body"]
        if step not in sequence:
            reject("FORBIDDEN_HOOK_INVOKED: " + step)
        prior = sequence[:sequence.index(step)]
        expected = [item + suffix for item in prior for suffix in (".start", ".end")]
        actual = [json.loads(line)["event"] for line in trace.read_text().splitlines()] if trace.exists() else []
        if actual != expected:
            reject("INVALID_EXECUTION_ORDER: " + repr((actual, expected)))
        if step.startswith("post-"):
            tasks = (root / "specs/fixture/tasks.md").read_text().lower()
            if "- [x] t001" not in tasks:
                reject("Post hook ran before task completion")
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
    hook_entry = project / "fixture-hook"
    hook_entry.write_text('#!/bin/sh\nexec python3 fixture.py "$@"\n', encoding="utf-8")
    hook_entry.chmod(0o755)


class MarkerOracleTests(unittest.TestCase):
    def test_rejected_attempts_cannot_leave_a_passing_trace(self):
        cases = {
            "forbidden": ([], "disabled"),
            "duplicate": (["pre-one.start", "pre-one.end"], "pre-one"),
            "retry": (["pre-one.start"], "pre-one"),
            "out-of-order": ([], "pre-two"),
            "early-post": (
                [s + suffix for s in ("pre-one", "pre-two", "body") for suffix in (".start", ".end")],
                "post-one",
            ),
            "continued-after-rejection": (["disabled.rejected"], "pre-one"),
        }
        for label, (prior, step) in cases.items():
            with self.subTest(case=label), tempfile.TemporaryDirectory() as temp:
                project = Path(temp)
                write_marker_script(project)
                (project / "fixture.json").write_text(json.dumps({"scenario": "success", "hooks": True}))
                tasks = project / "specs/fixture/tasks.md"
                tasks.parent.mkdir(parents=True)
                tasks.write_text("- [ ] T001\n")
                trace = project / "trace.jsonl"
                trace.write_text("".join(json.dumps({"event": event}) + "\n" for event in prior))
                result = subprocess.run(
                    [sys.executable, "fixture.py", step], cwd=project, capture_output=True, timeout=10,
                )
                self.assertNotEqual(result.returncode, 0)
                events = [json.loads(line)["event"] for line in trace.read_text().splitlines()]
                self.assertEqual(events, [*prior, step + ".rejected"])

    def test_hook_only_entry_preserves_baseline_command(self):
        with tempfile.TemporaryDirectory() as temp:
            project = Path(temp)
            write_marker_script(project)
            self.assertIn('exec python3 fixture.py "$@"', (project / "fixture-hook").read_text())
            (project / "fixture.json").write_text(json.dumps({"scenario": "denied", "hooks": False}))
            result = subprocess.run(
                [sys.executable, "fixture.py", "body"], cwd=project, capture_output=True, timeout=10,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual((project / "result.txt").read_bytes(), b"done\n")


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
        version = manifest["preset"]["version"]
        self.assertRegex(version, r"^\d+\.\d+\.\d+\Z")
        self.assertEqual(manifest["requires"], {"speckit_version": "==1.2.3"})
        self.assertEqual(entry["requires"], manifest["requires"])
        self.assertEqual(entry["tags"], manifest["tags"])
        self.assertEqual(entry["provides"], {"templates": 0, "commands": 9})
        self.assertEqual(
            entry["download_url"],
            f"{manifest['preset']['repository']}/releases/download/"
            f"{PACKAGE.name}-v{version}/{PACKAGE.name}.zip",
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
        self.assertNotIn("`/{command}`", wrapper)
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
            "remaining work already covered by existing open tasks",
            "Blocked or unverified assessments do not reach it",
            "To execute: `{invocation}`", "Command: `{command}`",
            "Resolve `{invocation}` from the matching installed skill",
            "report it unavailable",
            "not Copilot native", "including all its artifact",
            "before starting the baseline workflow",
            "whether it begins with `Outline`, `Goal`, or `Execution Steps`",
        ):
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, wrapper)
        readme = (PACKAGE / "README.md").read_text(encoding="utf-8")
        manifest = yaml.safe_load((PACKAGE / "preset.yml").read_text(encoding="utf-8"))
        for phrase in (
            f"**{manifest['preset']['version']}**", "27d14e20c187c1f2916540ea201ecbdc9f8ed588",
            "**Initial release pending.**", "do not regenerate existing skills",
            "specify preset remove copilot-extension-hooks",
            "not a runtime executor", "Copilot App behavior is not established",
        ):
            self.assertIn(phrase, " ".join(readme.split()))

    @unittest.skipUnless(os.environ.get("HOOKS_PRESET_ARCHIVE"), "Set HOOKS_PRESET_ARCHIVE for release archive validation")
    def test_release_archive(self):
        validate_preset_archive(os.environ["HOOKS_PRESET_ARCHIVE"])

    def test_archive_validation_rejects_missing_extra_changed_and_duplicate_files(self):
        contents = {name: (PACKAGE / name).read_bytes() for name in FILES}
        cases = {
            "missing": [(name, data) for name, data in contents.items() if name != "LICENSE"],
            "extra": [*contents.items(), ("unexpected.txt", b"unexpected")],
            "changed": [(name, data + b"changed" if name == "LICENSE" else data) for name, data in contents.items()],
            "duplicate": [*contents.items(), ("LICENSE", contents["LICENSE"])],
        }
        for label, entries in cases.items():
            with self.subTest(case=label), tempfile.TemporaryDirectory() as temp:
                path = Path(temp) / "invalid.zip"
                if label == "duplicate":
                    with self.assertWarns(UserWarning), ZipFile(path, "w") as archive:
                        for name, data in entries:
                            archive.writestr(name, data)
                else:
                    with ZipFile(path, "w") as archive:
                        for name, data in entries:
                            archive.writestr(name, data)
                with self.assertRaises(AssertionError):
                    validate_preset_archive(path)

    def test_archive_comparison_normalizes_only_crlf_on_both_sides(self):
        content = b"first\nsecond \t\nthird\rfourth\n"
        for checkout_crlf in (False, True):
            for archive_crlf in (False, True):
                with self.subTest(checkout_crlf=checkout_crlf, archive_crlf=archive_crlf):
                    with tempfile.TemporaryDirectory() as temp:
                        root = Path(temp)
                        package = root / "package"
                        package.mkdir()
                        source = content.replace(b"\n", b"\r\n") if checkout_crlf else content
                        archived = content.replace(b"\n", b"\r\n") if archive_crlf else content
                        for name in FILES:
                            path = package / name
                            path.parent.mkdir(parents=True, exist_ok=True)
                            path.write_bytes(source)
                        for mutation in (None, b" ", b"\t", b"changed", b""):
                            archive_path = root / "fixture.zip"
                            with ZipFile(archive_path, "w") as archive:
                                for name in FILES:
                                    data = archived
                                    if name == "LICENSE" and mutation is not None:
                                        data = archived.replace(b"\r", b"") if mutation == b"" else archived + mutation
                                    archive.writestr(name, data)
                            with patch(__name__ + ".PACKAGE", package):
                                if mutation is None:
                                    validate_preset_archive(archive_path)
                                else:
                                    with self.assertRaises(AssertionError):
                                        validate_preset_archive(archive_path)


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
                    resolved = self.run_cli(project, "preset", "resolve", "speckit.plan")
                    self.assertIn(baseline, resolved)
                    self.assertNotIn(PACKAGE.name, resolved)
                    self.run_cli(project, "preset", "enable", PACKAGE.name)
                    self.run_cli(project, "preset", "set-priority", PACKAGE.name, "15")
                    self.assertEqual(self.skills(project), composed, "Priority alone leaves stale skills")
                    resolved = self.run_cli(project, "preset", "resolve", "speckit.plan")
                    self.assertIn(baseline, resolved)
                    self.assertNotIn(PACKAGE.name, resolved)
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
        write_marker_script(project)
        for step in (*hook_steps, "disabled", "conditional", "optional", "optional-default"):
            name = f"speckit-fixture-{step}"
            folder = project / ".github/skills" / name
            folder.mkdir()
            (folder / "SKILL.md").write_text(
                f"---\nname: {name}\ndescription: Execute the local {step} marker hook.\n---\n\n"
                f"Run `./fixture-hook {step}` from the project root exactly once. "
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
                        "spawn agents, or change skill files, fixture.py, fixture-hook, fixture.json, or extensions.yml."
                    )
                    result = subprocess.run(
                        [
                            str(Path(COPILOT).resolve()), "-C", str(project), "-p", prompt,
                            "--trust-folder", "--allow-all-tools", "--disable-builtin-mcps",
                            "--available-tools=bash,view,rg,glob,skill,apply_patch",
                            "--deny-tool=shell(gh:*)", "--deny-tool=shell(curl:*)",
                            "--deny-tool=shell(git push:*)",
                            *(
                                ["--deny-tool=shell(./fixture-hook:*)", "--deny-tool=shell(fixture-hook:*)"]
                                if scenario == "denied" else []
                            ),
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
                        self.assertEqual(events, expected)
                        self.assertEqual((project / "result.txt").read_bytes(), b"done\n")
                        self.assertIn("- [x] t001", (project / "specs/fixture/tasks.md").read_text().lower())
                    messages = [
                        json.loads(line)["data"].get("content", "")
                        for line in result.stdout.splitlines()
                        if json.loads(line).get("type") == "assistant.message"
                    ]
                    if scenario == "denied":
                        requests = [
                            request for line in result.stdout.splitlines()
                            if (event := json.loads(line)).get("type") == "assistant.message"
                            for request in event["data"].get("toolRequests", [])
                        ]
                        for request in requests:
                            if request.get("name") == "bash":
                                command = request.get("arguments", {}).get("command", "")
                                self.assertNotIn("fixture.py body", command)
                                self.assertNotIn("fixture.py verify", command)
                    if scenario not in ("absent", "malformed"):
                        self.assertIn("EXECUTE_COMMAND: speckit.fixture.pre-one", "\n".join(messages))
                    validate_assistant_reporting(
                        [json.loads(line) for line in result.stdout.splitlines()], scenario,
                    )
                    if scenario in ("success", "post-failure", "missing-plan"):
                        validate_optional_invocations(
                            [json.loads(line) for line in result.stdout.splitlines()],
                            ["speckit.fixture.optional", "speckit.fixture.optional-default"],
                        )

    def test_lean_convergence_with_existing_open_work_and_blocked_assessment(self):
        for blocked in (False, True):
            with self.subTest(blocked=blocked), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                project = self.make_project(root, "copilot-lean-sdd", "success")
                feature = project / "specs/fixture"
                tasks = feature / "tasks.md"
                tasks.write_text(
                    "# Tasks\n\n## Phase 1: Marker\n\n"
                    "- [x] T000 [US1] Initial implementation of result.txt was attempted.\n"
                    "- [ ] T001 [US1] Fix result.txt to contain exactly done and a newline; "
                    "verify with `python3 fixture.py verify`.\n", encoding="utf-8",
                )
                before = tasks.read_bytes()
                (project / "result.txt").write_bytes(b"pending\n")
                (feature / "plan.md").write_text(
                    "# Plan\n\nresult.txt must contain exactly done and a newline. "
                    "The implementation has been attempted but remains incomplete. "
                    "The documented local validation is `python3 fixture.py verify`. "
                    "An assertion failure is remaining implementation work already covered "
                    "by T001, not a missing validation prerequisite.\n", encoding="utf-8",
                )
                digest = hashlib.sha256(before).hexdigest()
                (project / "convergence-hook.py").write_text(
                    "import hashlib\nfrom pathlib import Path\n"
                    f"assert hashlib.sha256(Path('specs/fixture/tasks.md').read_bytes()).hexdigest() == {digest!r}\n"
                    "with Path('convergence-hook.log').open('a') as output:\n"
                    "    output.write('after_converge\\n')\n"
                    "print('AFTER_CONVERGE_COMPLETED')\n", encoding="utf-8",
                )
                skill = project / ".github/skills/speckit-fixture-convergence"
                skill.mkdir()
                (skill / "SKILL.md").write_text(
                    "---\nname: speckit-fixture-convergence\ndescription: Record the completed convergence assessment.\n"
                    "---\nRun `python3 convergence-hook.py` exactly once and wait for its result.\n",
                    encoding="utf-8",
                )
                (project / ".specify/extensions.yml").write_text(yaml.safe_dump({
                    "hooks": {"after_converge": [{
                        "extension": "fixture", "command": "speckit.fixture.convergence", "optional": False,
                    }]},
                }), encoding="utf-8")
                if blocked:
                    (feature / "spec.md").unlink()
                result = subprocess.run(
                    [
                        str(Path(COPILOT).resolve()), "-C", str(project), "-p",
                        "Run the installed speckit-converge skill for the active feature and report "
                        "the actual assessment outcome. Follow the selected baseline and lifecycle "
                        "rules. Use local files only; do not implement remaining work, change fixture "
                        "scripts, skills, extensions.yml, global configuration, or spawn agents.",
                        "--trust-folder", "--allow-all-tools", "--disable-builtin-mcps",
                        "--available-tools=bash,view,rg,glob,skill,apply_patch",
                        "--deny-tool=shell(gh:*)", "--deny-tool=shell(curl:*)",
                        "--log-dir", str(root / "host-logs"), "--output-format", "json",
                    ],
                    text=True, encoding="utf-8", capture_output=True, timeout=300,
                )
                hook_log = project / "convergence-hook.log"
                evidence = os.environ.get("HOOKS_EVIDENCE_DIR")
                if evidence:
                    folder = Path(evidence) / ("lean-converge-blocked" if blocked else "lean-converge-open-work")
                    folder.mkdir(parents=True, exist_ok=True)
                    (folder / "host.jsonl").write_text(result.stdout, encoding="utf-8")
                    (folder / "stderr.txt").write_text(result.stderr, encoding="utf-8")
                    (folder / "tasks.md").write_bytes(tasks.read_bytes())
                    (folder / "hook.log").write_text(hook_log.read_text() if hook_log.exists() else "")
                self.assertEqual(result.returncode, 0, result.stderr[-2000:])
                self.assertEqual(tasks.read_bytes(), before, "Existing open work must not be duplicated or rewritten")
                events = [json.loads(line) for line in result.stdout.splitlines()]
                messages = [event["data"] for event in events if event["type"] == "assistant.message"]
                finals = [m["content"] for m in messages if m.get("phase") == "final_answer"]
                self.assertTrue(finals)
                if blocked:
                    self.assertFalse(hook_log.exists())
                    self.assertRegex(finals[-1].lower(), r"missing|blocked|unverified|stopped")
                else:
                    self.assertEqual(hook_log.read_text(), "after_converge\n")
                    self.assertRegex(finals[-1], r"T001")
                    self.assertRegex(finals[-1].lower(), r"remaining|incomplete|not converged|open")
                    hook_index = next(
                        index for index, event in enumerate(events) if event["type"] == "assistant.message"
                        and any(
                            request.get("name") == "skill"
                            and request.get("arguments", {}).get("skill") == "speckit-fixture-convergence"
                            for request in event["data"].get("toolRequests", [])
                        )
                    )
                    before_hook = "\n".join(
                        event["data"].get("content", "") for event in events[:hook_index]
                        if event["type"] == "assistant.message"
                    )
                    self.assertIn("T001", before_hook)
                    self.assertRegex(before_hook.lower(), r"remaining|incomplete|not converged|open")

    @unittest.skipUnless(os.environ.get("HOOKS_SPECIFY_SOURCE"), "Set HOOKS_SPECIFY_SOURCE for installed Git extension exercises")
    def test_installed_git_extension_registers_and_executes_before_specify(self):
        source = Path(os.environ["HOOKS_SPECIFY_SOURCE"]) / "extensions/git"
        manifest = yaml.safe_load((source / "extension.yml").read_text(encoding="utf-8"))
        self.assertEqual(manifest["extension"]["id"], "git")
        declared = manifest["hooks"]["before_specify"]
        self.assertEqual(declared["command"], "speckit.git.feature")
        self.assertIs(declared["optional"], False)
        source_hashes = {
            str(p.relative_to(source)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in source.rglob("*") if p.is_file()
        }
        for baseline in ("copilot-lean-sdd", "copilot-full-sdd"):
            with self.subTest(baseline=baseline), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                project = root / "project"
                self.run_cli(
                    root, "init", str(project), "--integration", "copilot",
                    "--integration-options=--skills", "--ignore-agent-tools",
                    "--non-interactive", "--script", "py",
                )
                self.run_cli(project, "preset", "add", "--dev", str(BASELINES / baseline), "--priority", "10")
                self.run_cli(project, "preset", "add", "--dev", str(PACKAGE), "--priority", "5")
                self.run_cli(project, "extension", "add", str(source), "--dev")
                inventory = json.loads(self.run_cli(project, "extension", "list", "--json"))
                installed = next(e for e in inventory if e["id"] == "git")
                self.assertIs(installed["enabled"], True)
                self.assertEqual(installed["version"], manifest["extension"]["version"])
                config = project / ".specify/extensions.yml"
                config_bytes = config.read_bytes()
                registered = yaml.safe_load(config_bytes)
                hook = next(h for h in registered["hooks"]["before_specify"] if h["extension"] == "git")
                self.assertEqual(hook["command"], declared["command"])
                self.assertIs(hook["enabled"], True)
                self.assertIs(hook["optional"], False)
                installed_script = project / ".specify/extensions/git/scripts/bash/create-new-feature-branch.sh"
                self.assertEqual(
                    installed_script.read_bytes(),
                    (source / "scripts/bash/create-new-feature-branch.sh").read_bytes(),
                )
                skill = project / ".github/skills/speckit-git-feature/SKILL.md"
                self.assertTrue(skill.is_file(), "The extension installer must generate its hook skill")
                skill_bytes = skill.read_bytes()
                self.assertIn(
                    START, (project / ".github/skills/speckit-specify/SKILL.md").read_text(encoding="utf-8"),
                )

                def git(*args):
                    result = subprocess.run(
                        ["git", *args], cwd=project, text=True, encoding="utf-8",
                        capture_output=True, timeout=30,
                    )
                    self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                    return result.stdout.strip()

                git("-c", "init.defaultBranch=fixture-base", "init", "-q")
                git(
                    "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
                    "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-q",
                    "-m", "Initialize disposable extension validation repository",
                    "-m", "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>",
                )
                original_head = git("rev-parse", "HEAD")
                original_branch = git("branch", "--show-current")
                self.assertEqual(git("remote"), "", "Fixture repository must have no remote")
                prompt = (
                    "Run this project's speckit-specify skill. Feature directory provided by the user: "
                    "specs/offline-greeting (SPECIFY_FEATURE_DIRECTORY=specs/offline-greeting). "
                    "Feature: a local greeting utility for a single user. With no name it prints "
                    "'Hello, world!' followed by a newline. With one nonempty name it prints "
                    "'Hello, <name>!' followed by a newline. Blank names are rejected with a clear "
                    "error and nonzero exit. It works entirely offline with no accounts, storage, "
                    "or external services. Create only the specification and the selected baseline's "
                    "required specification artifacts; do not implement it or run plan/tasks. "
                    "Use the installed extension lifecycle handling normally. Optional hooks have "
                    "not been requested. This disposable repository has no remotes; any local "
                    "feature branch created by the installed mandatory hook is authorized. "
                    "Execute that hook script as one direct simple shell command per tool call "
                    "(an environment-variable prefix or bash interpreter is allowed); do not "
                    "combine it with reads, other commands, substitutions, or dry-run flags. "
                    "Do not change global configuration, install anything, spawn agents, edit "
                    "installed skills/extensions or extensions.yml, push, or use GitHub."
                )
                env = dict(os.environ)
                env["PATH"] = str(Path(self.cli).parent) + os.pathsep + env["PATH"]
                result = subprocess.run(
                    [
                        str(Path(COPILOT).resolve()), "-C", str(project), "-p", prompt,
                        "--trust-folder", "--allow-all-tools", "--disable-builtin-mcps",
                        "--available-tools=bash,view,rg,glob,skill,apply_patch",
                        "--deny-tool=shell(gh:*)", "--deny-tool=shell(curl:*)",
                        "--deny-tool=shell(git push:*)",
                        "--log-dir", str(root / "host-logs"), "--output-format", "json",
                    ],
                    env=env, text=True, encoding="utf-8", capture_output=True, timeout=300,
                )
                current_branch = git("branch", "--show-current")
                feature_file = project / ".specify/feature.json"
                feature = project / "specs/offline-greeting/spec.md"
                evidence = os.environ.get("HOOKS_EVIDENCE_DIR")
                if evidence:
                    folder = Path(evidence) / f"{baseline}-installed-git"
                    folder.mkdir(parents=True, exist_ok=True)
                    (folder / "host.jsonl").write_text(result.stdout, encoding="utf-8")
                    (folder / "stderr.txt").write_text(result.stderr, encoding="utf-8")
                    (folder / "extensions.yml").write_bytes(config_bytes)
                    (folder / "inventory.json").write_text(json.dumps(inventory, indent=2), encoding="utf-8")
                    (folder / "outcome.json").write_text(json.dumps({
                        "original_branch": original_branch, "current_branch": current_branch,
                        "original_head": original_head, "current_head": git("rev-parse", "HEAD"),
                        "branches": git("branch", "--format=%(refname:short)").splitlines(),
                        "feature_directory": json.loads(feature_file.read_text()) if feature_file.exists() else None,
                    }, indent=2), encoding="utf-8")
                    if feature.exists():
                        (folder / "spec.md").write_bytes(feature.read_bytes())
                self.assertEqual(result.returncode, 0, result.stderr[-2000:])
                self.assertNotEqual(current_branch, original_branch, "The real mandatory hook must create a branch")
                self.assertEqual(git("rev-parse", "HEAD"), original_head, "Optional commit hooks must not execute")
                self.assertEqual(len(git("branch", "--format=%(refname:short)").splitlines()), 2)
                self.assertEqual(json.loads(feature_file.read_text())["feature_directory"], "specs/offline-greeting")
                self.assertTrue(feature.is_file())
                self.assertIn("Hello", feature.read_text(encoding="utf-8"))
                if baseline == "copilot-full-sdd":
                    self.assertTrue((feature.parent / "checklists/requirements.md").is_file())
                self.assertEqual(config.read_bytes(), config_bytes, "No hook registrations may be hand-seeded")
                self.assertEqual(skill.read_bytes(), skill_bytes, "Use the installer's unmodified generated skill")
                events = [json.loads(line) for line in result.stdout.splitlines()]
                requests = [
                    r for e in events if e["type"] == "assistant.message"
                    for r in e["data"].get("toolRequests", [])
                ]
                hook_loads = [
                    r for r in requests if r.get("name") == "skill"
                    and r.get("arguments", {}).get("skill") == "speckit-git-feature"
                ]
                executions = successful_git_hook_invocations(events)
                validate_optional_invocations(events, ["speckit.git.commit"])
                self.assertEqual(len(hook_loads), 1)
                self.assertEqual(len(executions), 1, "Actually execute the installed extension's script exactly once")
                self.assertEqual(source_hashes, {
                    str(p.relative_to(source)): hashlib.sha256(p.read_bytes()).hexdigest()
                    for p in source.rglob("*") if p.is_file()
                })


if __name__ == "__main__":
    unittest.main()
