# Precondition candidates

`pnpm sim:record` writes candidates here: `<name>/precondition.json` plus the run and suite reports
under `<name>/runs/` (git-ignored). Nothing in this folder is test state: QA tests reference only
files inside `preconditions/`, and a recorded precondition loads only after approval.

Review the candidate and its report, then approve it with `pnpm sim:approve precondition-candidates/<name>` (from
`packages/conversation-sim`; from the repo root use `packages/conversation-sim/precondition-candidates/<name>`).
See "Recording a precondition" in `qa-tests/README.md`.
