"""A design helper is available after installation, but runs only by explicit name."""

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


PACKAGE = Path(__file__).resolve().parents[2]
FIXTURE = PACKAGE / "tests" / "fixtures" / "specify"
sys.path.insert(0, str(PACKAGE / "scripts" / "lib"))

from override import prepare_override  # noqa: E402
from contracts.handoff import prepare_request  # noqa: E402
from category_contracts import stage_documents  # noqa: E402
from staging import materialize_candidate, read_json  # noqa: E402
from support import record_support_result, validate_support_command  # noqa: E402


def specify(workspace: Path, *args: str) -> object:
    result = subprocess.run(
        ["specify", *args], cwd=workspace, capture_output=True,
        text=True, check=False,
    )
    if result.returncode:
        raise AssertionError(f"specify {' '.join(args)}: {result.stderr or result.stdout}")
    return json.loads(result.stdout) if args[-1] == "--json" else result.stdout


class DesignSupportInvocation(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.workspace = Path(temporary.name) / "project"
        self.workspace.mkdir()
        (self.workspace / ".specify").mkdir()
        (self.workspace / ".specify" / "init-options.json").write_text(
            json.dumps({
                "ai": "copilot", "ai_skills": True, "integration": "copilot",
                "script": "py", "speckit_version": "1.0.7",
            }),
            encoding="utf-8",
        )
        source = Path(temporary.name) / "packages"
        source.mkdir()
        generator = source / "generator"
        design = source / "design"
        shutil.copytree(FIXTURE / "core-generator", generator)
        shutil.copytree(FIXTURE, design, ignore=shutil.ignore_patterns("core-generator"))
        (design / "commands" / "helper.md").write_text(
            "# Design helper\n\n## Inputs\n\n"
            "`goal`: one named experience goal, supplied only when this command "
            "is explicitly selected during Generate.\n\n"
            "## Result\n\nReturn a JSON object with empty `categories`; "
            "named design documents are replaced through Specify templates.\n",
            encoding="utf-8",
        )
        specify(self.workspace, "extension", "add", str(generator), "--dev", "--priority", "100")
        specify(self.workspace, "extension", "add", str(design), "--dev", "--priority", "30")
        self.command = "speckit.sample-canvas-design.helper"
        artifacts = specify(self.workspace, "artifact", "list", "--json")
        helper = next(row for row in artifacts if row["kind"] == "command" and row["name"] == self.command)
        self.assertEqual(helper["stack"][0]["sourceId"], "sample-canvas-design")
        self.assertEqual(
            next(row for row in specify(self.workspace, "extension", "list", "--json")
                 if row["id"] == "sample-canvas-design")["enabled"], True,
        )
        self.request = prepare_request(
            self.workspace, ["speckit.analyze"], "my-canvas", "My Canvas", False,
        )

    def test_install_and_reload_only_expose_helper_explicit_invocation_runs_once(self) -> None:
        invocations = []
        reloads = []

        def reload_skills() -> None:
            skill = self.workspace / ".github" / "skills" / "speckit-sample-canvas-design-helper" / "SKILL.md"
            self.assertTrue(skill.is_file())
            reloads.append(self.command)

        def invoke(command: dict, inputs: dict) -> dict:
            invocations.append((command["invocation"], inputs))
            return {"categories": {}}

        reload_skills()
        self.assertEqual(reloads, [self.command])
        self.assertEqual(invocations, [])
        self.assertFalse(self.request.with_name("command-override-draft.json").exists())
        validated = validate_support_command(self.request, self.command)
        self.assertEqual(validated["invocation"], "/skill:speckit-sample-canvas-design-helper")
        self.assertIn("`goal`", validated["documentation"].split("## Result")[0])
        response = invoke(validated, {"goal": "Simpler navigation"})
        self.assertEqual(len(invocations), 1)
        draft = record_support_result(
            self.request, self.command, response, validated["sourceSha256"]
        )
        self.assertEqual(read_json(draft)["categories"], {})
        with self.assertRaisesRegex(ValueError, "already has"):
            record_support_result(
                self.request, self.command, response, validated["sourceSha256"]
            )
        prepare_override(self.request)
        stage_documents(self.request)
        candidate = materialize_candidate(
            self.request, PACKAGE / "tests" / "fixtures" / "scaffold",
        )
        self.assertEqual(
            read_json(candidate / "canvas-experience.json")["presentation"]["phases"]["showDescriptions"],
            True,
        )
        self.assertEqual(len(invocations), 1)

    def test_failed_or_invalid_explicit_invocation_writes_no_draft(self) -> None:
        validated = validate_support_command(self.request, self.command)

        def failed(_invocation: str) -> dict:
            raise RuntimeError("design helper failed")

        with self.assertRaisesRegex(RuntimeError, "design helper failed"):
            failed(validated["invocation"])
        for response in (
            {"error": "design helper failed"},
            {"categories": {"canvas-presentation": {"colors": {"unknown": "#fff"}}}},
        ):
            with self.subTest(response=response), self.assertRaises(ValueError):
                record_support_result(
                    self.request, self.command, response, validated["sourceSha256"]
                )
        self.assertFalse(self.request.with_name("command-override-draft.json").exists())

    def test_cli_requires_original_documented_source_and_valid_result(self) -> None:
        script = PACKAGE / "scripts" / "python" / "canvas_generate.py"

        def run(*args: str, payload: dict | None = None) -> subprocess.CompletedProcess[str]:
            return subprocess.run(
                [sys.executable, str(script), *args],
                cwd=self.workspace, text=True, capture_output=True, check=False,
                input=json.dumps(payload) if payload is not None else None,
            )

        resolved = run(
            "support-command", "--request", str(self.request),
            "--command", self.command,
        )
        self.assertEqual(resolved.returncode, 0, resolved.stderr)
        binding = json.loads(resolved.stdout)
        arguments = (
            "record-support-result", "--request", str(self.request),
            "--command", self.command, "--result-stdin",
        )
        invalid = run(
            *arguments, "--source-sha256", binding["sourceSha256"],
            payload={"categories": {"canvas-presentation": {"copy": {"unknown": "x"}}}},
        )
        self.assertNotEqual(invalid.returncode, 0)
        self.assertFalse(self.request.with_name("command-override-draft.json").exists())
        changed = run(
            *arguments, "--source-sha256", "0" * 64, payload={"categories": {}},
        )
        self.assertNotEqual(changed.returncode, 0)
        self.assertIn("source changed", changed.stderr)
        accepted = run(
            *arguments, "--source-sha256", binding["sourceSha256"],
            payload={"categories": {}},
        )
        self.assertEqual(accepted.returncode, 0, accepted.stderr)
        self.assertEqual(read_json(Path(json.loads(accepted.stdout)["draftPath"]))["categories"], {})


if __name__ == "__main__":
    unittest.main()
