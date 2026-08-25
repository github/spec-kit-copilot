# Test fixtures

## Live CLI snapshots

`live-cli-list.json` is a point-in-time capture of the real
`specify artifact list --json` output. It's consumed by
`test/artifact-cli.integration.test.mjs`'s **fixture drift** suite to catch
shape regressions if the CLI's JSON contract changes.

It is **not** consumed by the fixture-based unit tests in
`test/artifact-cli.test.mjs` — those tests use synthetic fixtures inline.

`list --json` returns the full composition stack per row, so no separate
`info` snapshot is needed.

### Regenerating

Run from a workspace where `specify` is installed and a representative
composition is applied (any preset/extension mix works — the drift test only
checks field presence, not counts or content):

```powershell
specify artifact list --json > test/fixtures/live-cli-list.json
```

