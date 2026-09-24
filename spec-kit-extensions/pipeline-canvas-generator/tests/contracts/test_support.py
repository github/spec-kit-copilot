"""Design helper commands are resolved and recorded only when explicitly named."""

import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


PACKAGE = Path(__file__).resolve().parents[2]
FIXTURES = PACKAGE / "tests" / "fixtures" / "composition"
sys.path.insert(0, str(PACKAGE / "scripts" / "lib"))

from override import prepare_override  # noqa: E402
from request import prepare_request  # noqa: E402
from staging import materialize_candidate, read_json  # noqa: E402
from support import record_support_result, validate_support_command  # noqa: E402


class ExplicitSupportContracts(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.workspace = Path(directory.name)
        shutil.copytree(FIXTURES / "installed", self.workspace / ".specify")
        helper = self.workspace / ".specify" / "extensions" / "design-helper"
        (helper / "commands").mkdir(parents=True)
        (helper / "commands" / "help.md").write_text(
            "# Design helper\n\n## Inputs\n\nA named experience goal.\n\n"
            "## Result\n\nA JSON object containing only `categories`.\n",
            encoding="utf-8",
        )
        (helper / "extension.yml").write_text(
            'schema_version: "1.0"\n'
            "extension:\n  id: design-helper\n  name: Design Helper\n  version: 1.0.0\n"
            "provides:\n  commands:\n"
            "    - name: speckit.design-helper.design-help\n"
            "      file: commands/help.md\n"
            "tags: [canvas-design]\n",
            encoding="utf-8",
        )
        inventory = {
            "artifacts": json.loads((FIXTURES / "mixed-stack.json").read_text(encoding="utf-8")),
            "presets": json.loads((FIXTURES / "installed-presets.json").read_text(encoding="utf-8")),
            "extensions": json.loads((FIXTURES / "installed-extensions.json").read_text(encoding="utf-8")),
        }
        inventory["extensions"].append({
            "id": "design-helper", "name": "Design Helper", "version": "1.0.0",
            "priority": 30, "enabled": True, "source": {"kind": "local"},
        })
        inventory["artifacts"].append({
            "kind": "command", "name": "speckit.design-helper.design-help",
            "stack": [{
                "sourceId": "design-helper", "layer": "extension",
                "strategy": "replace", "active": True, "hidden": False,
                "manifestPath": ".specify/extensions/design-helper/extension.yml",
                "lookupId": "extension:design-helper:command:speckit.design-helper.design-help",
                "sourcePath": ".specify/extensions/design-helper/commands/help.md",
            }],
        })
        with patch("request._preflight"):
            self.request = prepare_request(
                self.workspace, ["speckit.plan"], "my-canvas", "My Canvas",
                False, inventory=inventory,
            )

    def test_installation_and_request_do_not_invoke_or_record_support(self) -> None:
        draft = self.request.with_name("command-override-draft.json")
        self.assertFalse(draft.exists())
        command = validate_support_command(self.request, "speckit.design-helper.design-help")
        self.assertEqual(command["invocation"], "/skill:speckit-design-helper-design-help")
        self.assertEqual(command["extensionId"], "design-helper")
        self.assertFalse(draft.exists())
        result = record_support_result(
            self.request, "speckit.design-helper.design-help",
            {"categories": {"canvas-layout": {"phases": {"showDescriptions": False}}}},
            command["sourceSha256"],
        )
        self.assertFalse(read_json(result)["categories"]["canvas-layout"]["phases"]["showDescriptions"])
        prepare_override(self.request)
        candidate = materialize_candidate(
            self.request, PACKAGE / "tests" / "fixtures" / "scaffold"
        )
        self.assertEqual(
            read_json(candidate / "canvas-experience.json")["categories"]["canvas-layout"]["phases"]["showDescriptions"],
            False,
        )
        with self.assertRaisesRegex(ValueError, "already has"):
            record_support_result(
                self.request, "speckit.design-helper.design-help",
                {"categories": {}}, command["sourceSha256"],
            )

    def test_explicit_support_failures_surface_and_write_no_draft(self) -> None:
        source_sha256 = validate_support_command(
            self.request, "speckit.design-helper.design-help"
        )["sourceSha256"]
        for name in ("speckit.plan", "speckit.pipeline-canvas-generator.generate", "speckit.unknown"):
            with self.subTest(name=name), self.assertRaises(ValueError):
                validate_support_command(self.request, name)
        with self.assertRaisesRegex(ValueError, "only categories"):
            record_support_result(
                self.request, "speckit.design-helper.design-help", {"error": "failed"},
                source_sha256,
            )
        with self.assertRaisesRegex(ValueError, "Unsupported|Protected"):
            record_support_result(
                self.request, "speckit.design-helper.design-help",
                {"categories": {"canvas-content": {"schemaVersion": 2}}},
                source_sha256,
            )
        self.assertFalse(self.request.with_name("command-override-draft.json").exists())

    def test_changed_documentation_rejects_result_without_draft(self) -> None:
        command = validate_support_command(self.request, "speckit.design-helper.design-help")
        source = self.workspace / command["sourcePath"]
        source.write_text(
            source.read_text(encoding="utf-8").replace("A named experience goal.", "A different goal."),
            encoding="utf-8",
        )
        with self.assertRaisesRegex(ValueError, "source changed"):
            record_support_result(
                self.request, command["commandName"],
                {"categories": {}}, command["sourceSha256"],
            )
        self.assertFalse(self.request.with_name("command-override-draft.json").exists())


if __name__ == "__main__":
    unittest.main()
