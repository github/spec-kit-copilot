"""Portable phase paths and recipient-side setup after a workspace transfer."""

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


PACKAGE = Path(__file__).resolve().parents[2]
TEMPLATE = PACKAGE / "templates" / "generated-canvas"
sys.path.insert(0, str(PACKAGE / "scripts" / "lib"))

from phase_output import validate_pair  # noqa: E402
from validation import confined_path  # noqa: E402


class PortabilityContracts(unittest.TestCase):
    def test_phase_paths_are_portable_on_windows_and_posix(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            def contract(path):
                return {"expectsArtifact": True, "outputPath": path}
            validate_pair(contract("specs/<slug>/plan.md"), root)
            for path in (
                "C:/Users/user/project/plan.md",
                "C:\\Users\\user\\project\\plan.md",
                "/home/user/project/plan.md",
                "../other/plan.md",
                "specs\\feature\\plan.md",
            ):
                with self.subTest(path=path), self.assertRaisesRegex(ValueError, "Unsafe"):
                    validate_pair(contract(path), root)
            self.assertEqual(confined_path(root, "specs/feature").parent, root / "specs")

    def test_linked_path_is_not_accepted_as_a_portable_artifact(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            external = root / "outside"
            external.mkdir()
            linked = root / "linked"
            try:
                linked.symlink_to(external, target_is_directory=True)
            except (OSError, NotImplementedError):
                self.skipTest("Directory links unavailable on this host")
            with self.assertRaisesRegex(ValueError, "Symlink|reparse"):
                confined_path(root, "linked/result.md")

    @unittest.skipUnless(shutil.which("node"), "Node.js required for recipient setup")
    def test_copied_setup_uses_recipient_evidence_not_source_paths(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "author"
            recipient = Path(directory) / "recipient"
            skill = source / ".github" / "skills" / "speckit-plan" / "SKILL.md"
            skill.parent.mkdir(parents=True)
            skill.write_text("# Recipient plan\n", encoding="utf-8")
            init = source / ".specify" / "init-options.json"
            init.parent.mkdir(parents=True)
            init.write_text(json.dumps({"ai": "copilot", "ai_skills": True}), encoding="utf-8")
            shutil.copytree(source, recipient)
            script = """
import { inspectSetup } from './setup-runtime.mjs';
const setup = {
    presets: [], extensions: [],
    requiredSkills: [{ name: 'speckit-plan', sha256: process.env.SKILL_SHA }],
};
const runSpecify = async () => 'specify 1.0.7';
const runCopilot = async () => JSON.stringify([
    { name: 'spec-kit-copilot', enabled: true, version: '0.16.0' },
]);
const result = await inspectSetup({
    cwd: process.env.RECIPIENT, setup, runSpecify, runCopilot,
    reloadAvailable: true, refresh: true,
});
if (!result.diskReady) throw Error(JSON.stringify(result.checks));
"""
            env = {
                **os.environ,
                "RECIPIENT": str(recipient),
                "SKILL_SHA": hashlib.sha256(skill.read_bytes()).hexdigest(),
            }
            result = subprocess.run(
                ["node", "--input-type=module", "-e", script],
                cwd=TEMPLATE, env=env, capture_output=True, text=True,
                timeout=30, check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            (recipient / ".github" / "skills" / "speckit-plan" / "SKILL.md").write_text(
                "# Edited after transfer\n", encoding="utf-8",
            )
            result = subprocess.run(
                ["node", "--input-type=module", "-e", script],
                cwd=TEMPLATE, env=env, capture_output=True, text=True,
                timeout=30, check=False,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("skill:speckit-plan", result.stderr)


if __name__ == "__main__":
    unittest.main()
