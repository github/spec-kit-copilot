# Test fixtures

## Live CLI snapshots

`live-cli-list.json` and `live-cli-info.json` are point-in-time captures of the
real `specify artifact` CLI output. They're consumed by
`test/artifact-cli.integration.test.mjs`'s **fixture drift** suite to catch shape
regressions if the CLI's JSON contract changes.

They are **not** consumed by the fixture-based unit tests in
`test/artifact-cli.test.mjs` — those tests use synthetic fixtures inline.

### Regenerating

Run from a workspace where `specify` is installed and a representative
composition is applied (any preset/extension mix works — the drift test only
checks field presence, not counts or content):

```powershell
specify artifact list --json > test/fixtures/live-cli-list.json

# For live-cli-info.json: capture one representative artifact of each kind
# (command, template, script) into a { "<id>": <info> } map. See the capture
# helper in .speckit-wizard/diffs/ or run manually:
$listObj = specify artifact list --json | ConvertFrom-Json
$sample = @{}
foreach ($kind in @("command","template","script")) {
    $first = $listObj | Where-Object { $_.kind -eq $kind } | Select-Object -First 1
    if ($first) {
        $sample[$first.id] = specify artifact info $first.id --json | ConvertFrom-Json
    }
}
$sample | ConvertTo-Json -Depth 20 | Out-File test/fixtures/live-cli-info.json -Encoding utf8
```
