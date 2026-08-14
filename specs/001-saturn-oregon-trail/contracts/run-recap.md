<!-- speckit:plan v1 -->
# Contract — Run Recap (End-of-Run Export)

At `phase === "ended"`, the app offers a clipboard-copyable recap of the completed run. This is the only outbound data path; there is no server upload.

## Recap format (plain text)

```
Saturn Oregon Trail — {outcome, capitalized}
Seed: {run.seed}
Turns: {run.turn}/20
Crew: {aliveCount}/{totalCount} survived

--- Captain's Log ---
[Turn {at}] {text}
...
[Turn {at}] {text}
```

- No emoji, no ANSI, no HTML.
- Line endings normalized to `\n`.
- Total length target ≤ 4 KB.
- If `captainsLog.length > 40`, the middle is elided with a single `[... N entries elided ...]` line.

## Export API

```ts
buildRecap(run: Run): string;
copyRecap(text: string): Promise<CopyResult>;

type CopyResult =
  | { ok: true; method: "clipboard-api" }
  | { ok: true; method: "textarea-fallback" }
  | { ok: false; reason: "not-supported" };
```

- `copyRecap` tries `navigator.clipboard.writeText` first.
- On failure (permission denied, insecure context), falls back to a hidden `<textarea>` + `document.execCommand("copy")`.
- Success reports which path won so the UI can show a "Copied" toast either way.

## UI contract

- The end-of-run screen shows the recap in a monospaced, pre-formatted panel — WYSIWYG for the paste target.
- "Copy recap" is the primary action; "Play again" is secondary.
- After a successful copy, focus moves to "Play again" for keyboard navigation.

## Test contract

- Golden snapshot: for a fixed seed and a 20-turn scripted play, `buildRecap` matches a checked-in `.txt` fixture.
- E2E (Playwright): assert clipboard content after clicking "Copy recap" (Playwright clipboard permission grant).
- Fallback path exercised by mocking `navigator.clipboard.writeText` to reject in a unit test.
