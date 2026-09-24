"""Mandatory setup disclosure belongs to the protected host, not the renderer."""

import shutil
import subprocess
import unittest
from pathlib import Path

PACKAGE = Path(__file__).resolve().parents[2]
UI = PACKAGE / "templates" / "generated-canvas" / "ui"


@unittest.skipUnless(shutil.which("node"), "Node.js is required for setup view checks")
class SetupDisclosureContracts(unittest.TestCase):
    def test_complete_review_and_escaped_provenance(self) -> None:
        script = """
import { installationDisclosure } from './setup-view.mjs';
const components = [
    { kind: 'preset', id: 'team-preset', version: '2.1.0', priority: 11,
        installedSource: { kind: 'git', url: 'https://example.org/team-preset' },
        manifestSha256: 'a'.repeat(64), installed: true },
    { kind: 'extension', id: '<customer-ext>', version: '1.0.0', priority: 100,
        installedSource: { kind: 'local' }, manifestSha256: 'b'.repeat(64), installed: false },
];
const html = installationDisclosure(components, '<script>alert(1)</script>');
for (const required of [
    'Community package warning', 'Trust: Not verified', 'Executable content:', 'team-preset',
    '&lt;customer-ext&gt;', '2.1.0', '1.0.0', 'Priority:', 'git', 'local',
    'a'.repeat(64), 'b'.repeat(64), 'Installed', 'Requires installation',
    'https://example.org/team-preset', 'provide this package externally',
    '&lt;script&gt;alert(1)&lt;/script&gt;', 'aria-label="Required presets and extensions"',
]) if (!html.includes(required)) throw Error(`Missing protected review fact: ${required}`);
if (html.includes('<script>') || html.includes('<customer-ext>') || html.includes('<button')) {
    throw Error('Injected content or per-component approval in disclosure');
}
if ((html.match(/<li class="installation-component">/g) ?? []).length !== 2) {
    throw Error('A required package was omitted from the review');
}
if (!html.includes('Source URL: <a href="https://example.org/team-preset"')) {
    throw Error('Captured source URL was hidden from the installation review');
}
const unsafe = installationDisclosure([{ ...components[0],
    installedSource: { kind: 'git', url: 'http://example.org/insecure' },
}], 'Review');
if (unsafe.includes('href=') || !unsafe.includes('provide this package externally')) {
    throw Error('Insecure source rendered as an install link');
}
try { installationDisclosure([], 'Review'); throw Error('Empty approval rendered'); }
catch (error) { if (error.message === 'Empty approval rendered') throw error; }
"""
        result = subprocess.run(
            ["node", "--input-type=module", "-e", script],
            cwd=UI, capture_output=True, text=True, check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_trusted_host_retains_review_and_atomic_approval(self) -> None:
        host = (UI / "app.js").read_text(encoding="utf-8")
        runtime = (PACKAGE / "templates" / "generated-canvas" / "extension.mjs").read_text(encoding="utf-8")
        self.assertIn('installationDisclosure(approval.components, approval.copy)', host)
        self.assertIn('id="approval-accept"', host)
        self.assertIn('id="approval-defer"', host)
        self.assertIn('"/api/installation-approval"', host)
        self.assertIn('acceptInstallationApproval(approvalContext(inst), input.fingerprint)', runtime)
        self.assertIn('copy: experience.categories["canvas-onboarding"].approvalCopy', runtime)


if __name__ == "__main__":
    unittest.main()
