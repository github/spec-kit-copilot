# Pinned PR #32 parity inputs

`assess.json`, `bugfix.json`, and `sdd.json` are byte-for-byte copies of
`test/fixtures/generation/` at commit
`a2497002cb1ab81b70916818d1a889f8182f172a` of
github/spec-kit-copilot#32. Their SHA-256 digests are, respectively:

| Fixture | SHA-256 |
| --- | --- |
| `assess.json` | `d90ae2c5ba9943592e377aed9cfa14388d34bf279fd533332e235ca2ca9f4288` |
| `bugfix.json` | `7e314b1b4fd28a4ae360e3124c37c0d35e34533e73cc790d1306dd54252be787` |
| `sdd.json` | `49ad7b505f99d8093ae81cea3bf8dd8e4ac9a9a6fbaa37d636d3c3653d02465d` |

`generated-runtime.json` extracts the inline scenarios in
`test/generated-phase-runs.test.mjs`, `test/generated-constitution.test.mjs`,
and `test/generated-extension-lifecycle.test.mjs` at the same commit.
It is a derived portable fixture, not a file that existed in the PR.
These are parity baselines, not an assertion that the existing Wizard
compiler's Constitution-as-selected-command treatment is the final v1 policy.
Tests must retain the source identities while exposing Constitution as a
project-level prerequisite rather than a numbered workflow phase.
