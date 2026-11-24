# Wizard Flow Test

This test-only extension contributes a Review phase between Plan and Tasks.
`speckit.extension-wizard-flow-test.review` writes a primary Markdown report at
`specs/<slug>/reviews/review.md` and an additional Markdown checklist at
`specs/<slug>/reviews/checklist.md`. Its `after_plan` hook runs
`speckit.extension-wizard-flow-test.audit` after Plan; the hook is not a runnable phase.
