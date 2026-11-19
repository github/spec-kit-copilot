## Copilot extension lifecycle checkpoints

This layer handles **Specify extension lifecycle hooks**, not Copilot native
hooks/events. It adds no baseline artifacts, phases, or prerequisite exemptions.
Read the selected baseline below, consider its User Input, and respect its scope
and safeguards before dispatching anything.

Capture the current loaded skill's name, `speckit-<command>`, once for this
invocation. `<command>` must be one of `constitution`, `specify`, `clarify`,
`plan`, `tasks`, `analyze`, `checklist`, `implement`, or `converge`.
Use that captured command for both events, even while invoking a hook's skill.
Do not dispatch hooks for another command or for `taskstoissues`.

Apply these checkpoints exactly once per invocation:

1. Run **Pre-Execution Checks** below before starting the baseline workflow,
   whether it begins with `Outline`, `Goal`, or `Execution Steps`.
2. Execute the selected baseline unchanged, including all its artifact
   prerequisites, user approval gates, read-only boundaries, and validation.
3. Run **Post-Execution Checks** below at the established completion checkpoint:
   - For `specify`, `clarify`, `plan`, `tasks`, and `implement`, after successful
     workflow/validation and **before** the baseline Completion Report (or its
     equivalent final summary). Defer that report until post-hooks finish; do not
     stop at an earlier Done When list or report instruction.
   - For `constitution` and `checklist`, after the baseline update/generation and
     its summary.
   - For `analyze`, after the analysis report and remediation offer.
   - For `converge`, after producing and reporting `converged` or `tasks_appended`
     in-session, before listing hooks. A completed Lean assessment that reports
     remaining work already covered by existing open tasks also reaches this
     checkpoint, even when nothing is appended. This is not convergence and must
     not be reported as such. Blocked or unverified assessments do not reach it.

Do not run successful-completion post-hooks if the baseline stops on a failed
prerequisite, gate, or validation. Never use a hook to bypass such a stop.
This is the sole lifecycle dispatcher in the supported baseline composition:
do not perform a second hook pass for a baseline report, Done When item, or
`EXECUTE_COMMAND` marker. Track each dispatched `(event, extension, command)`
in this invocation; do not invoke it twice, automatically retry it, or re-enter
the current lifecycle command recursively. This tracking is session guidance,
not a persistent lock or host-enforced guarantee.

## Pre-Execution Checks

Check if `.specify/extensions.yml` exists in the project root.
If it exists, read it and look for entries under `hooks.before_<command>`,
substituting the captured baseline command.
Apply **Hook handling** below to those entries, in their configured YAML list
order. Do not sort them by hook `priority`: that is the core command-template
behavior, distinct from `HookExecutor.get_hooks_for_event()`.
If no hooks are registered or the file does not exist, skip silently.

## Hook handling

Use these rules independently at each checkpoint:

- If the YAML cannot be parsed or is invalid, do not skip silently: tell the
  user that `.specify/extensions.yml` could not be read (include the parser
  error) and that no hooks were checked, including any mandatory
  (`optional: false`) hooks registered there, then continue normally.
- Filter out hooks where `enabled` is explicitly `false`. Treat hooks without
  an `enabled` field as enabled by default.
- For each remaining hook, do **not** attempt to interpret or evaluate hook
  `condition` expressions:
  - If the hook has no `condition` field, or it is null/empty, treat the hook as
    executable.
  - If the hook defines a non-empty `condition`, skip the hook and leave
    condition evaluation to the HookExecutor implementation. Do not call
    HookExecutor as an additional dispatch pass.
- For each executable hook, output the following based on its `optional` flag
  (an omitted flag defaults to optional, as in extension registration):
  Resolve `{invocation}` from the matching installed skill and the current
  host's supported skills-mode invocation, separately from the dotted command
  id. For example, `speckit.git.commit` identifies installed skill
  `speckit-git-commit`, invoked in Copilot CLI as `/speckit-git-commit`, not
  `/speckit.git.commit`. Use the host's skill tool when actually executing it.
  Do not advertise an unavailable skill as executable: report it unavailable
  for an optional hook; for a mandatory hook, follow the failure rule below.
  - **Optional hook** (`optional: true`):

    ```text
    ## Extension Hooks

    **Optional Hook**: {extension}
    Command: `{command}`
    Description: {description}

    Prompt: {prompt}
    To execute: `{invocation}`
    ```

    Before the baseline, label this **Optional Pre-Hook**. Present it for the
    user's choice; do not automatically invoke it. Do not treat silence as
    approval or block the baseline waiting for an unrequested optional hook.
  - **Mandatory hook** (`optional: false`):

    ```text
    ## Extension Hooks

    **Automatic Hook**: {extension}
    Executing: `{invocation}`
    EXECUTE_COMMAND: {command}
    ```

    Before the baseline, label this **Automatic Pre-Hook**.
    After emitting the block above you MUST actually invoke the hook and wait
    for it to finish before continuing. Run it the same way you would run the
    command yourself in this Copilot agent/session: load and execute the
    installed corresponding `speckit-...` skill using the host's skill
    invocation tool or supported skills-mode invocation. The literal command
    id is not necessarily the invocation syntax. Emitting the block, describing
    the hook, or merely reading its skill does not run the hook.
    Wait for the hook's actual work and result before the next hook, baseline
    step, or completion report. If invocation is unavailable or denied, or the
    hook fails, report the hook command and error, stop this invocation, and
    do not report successful workflow completion. Do not silently downgrade a
    mandatory hook to an optional suggestion.

In the output blocks, `{command}` means the **hook's command id**, not the
captured baseline command. Keep the configured command id (including dots) in
`EXECUTE_COMMAND:`; choose the host's skills invocation syntax separately.

## Selected baseline

{CORE_TEMPLATE}

## Post-Execution Checks

At the completion checkpoint defined above, read `.specify/extensions.yml`
again and look for entries under `hooks.after_<command>`, substituting the
captured baseline command. Apply **Hook handling** exactly once in configured
YAML list order. If no hooks are registered or the file does not exist, skip
silently. After mandatory hooks finish, emit any deferred baseline Completion
Report with the actual hook outcome; do not claim a failed hook succeeded.
