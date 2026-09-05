---
title: 'Advance additional pending survey groups after reporting disclosure'
type: 'bugfix'
created: '2026-09-05'
status: 'done'
review_loop_iteration: 1
baseline_commit: '258d0bae191b18f28ec6396c9ffa25104b5c83b4'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/handoff-2026-09-05-full-slack-product-smoke.md'
  - '{project-root}/docs/superpowers/railway-deploy.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** After a valid reporting disclosure has already been delivered, additional survey groups such as `belonging` and `engagement` can remain in `pending_confirmation`. A contradictory model classification that combines `reporting_explanation` with an acknowledgement dialogue act makes the shared TypeScript orchestrator repeat disclosure-only text and never stage the next confirmation prompt.

**Approach:** Reproduce the production-shaped contradiction in one focused orchestrator test, then normalize the decision at the existing shared application boundary: ignore reporting intent only when the latest dialogue act is an `acknowledgement`, while preserving disclosure behavior for every other reporting-intent classification. Preserve all existing delivery, safety, exact-summary, and one-active-confirmation invariants.

## Boundaries & Constraints

**Always:** Keep TypeScript as owner of survey state and outbound side effects; require an earlier delivered current-version disclosure before staging; stage at most one repository-selected pending group; preserve exact displayed-summary validation and delivery activation; use neutral synthetic Slack copy; verify the deployed worker and persisted production evidence.

**Ask First:** Any production data reset; database/schema changes; Railway variables, settings, domains, volumes, or deployment of a service other than `worker`; merging the branch or expanding the fix beyond the demonstrated shared boundary.

**Never:** Revive or extend MAF; weaken safety/privacy gates; infer consent from disclosure delivery; confirm a group without a later user agreement; add dependencies or Slack-specific branching; rewrite existing migrations or unrelated dirty-tree artifacts.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Contradictory acknowledgement | Current delivered disclosure; classification has `reporting_explanation` plus `dialogueAct=acknowledgement`; `belonging` and `engagement` are pending | Generate and persist one confirmation prompt for the first returned pending group, with exact summary metadata; do not repeat disclosure-only text | Existing stale-candidate failure remains fail-closed |
| Non-acknowledgement reporting question | Reporting intent plus any dialogue act other than `acknowledgement` | Return the localized disclosure and do not interpret or stage confirmation on that turn | Existing safety gates can still block survey behavior |
| Missing disclosure receipt | Pending groups exist but no earlier delivered current-version disclosure exists | Offer disclosure first and stage no confirmation | Delivery must be observed on a later inbound turn before staging |
| Closing or unsafe turn | Pending groups and disclosure receipt exist, but the latest turn is closing or survey-blocked | Stage no confirmation | Preserve current crisis/sensitive behavior |

</frozen-after-approval>

## Code Map

- `packages/application/src/use-cases/conversation-orchestrator.ts` -- shared TypeScript decision boundary that derives `reportingExplanationRequested` and controls confirmation phases, probes, and disclosure rendering.
- `packages/application/src/use-cases/conversation-orchestrator.test.ts` -- focused regression seam with existing disclosure and Phase A confirmation fixtures.
- `packages/ai-openai/src/prompts/classify.ts` -- existing classifier contract already requires explicit asks for `reporting_explanation` and separates acknowledgement dialogue acts; no change expected.
- `apps/worker/src/survey/repositories/group-state.repository.ts` -- persistence boundary whose existing single-active-candidate and delivery-proof behavior must remain unchanged.
- `docs/agent-failures.md` and `docs/agent-task-log.md` -- required blocker resolution and task evidence records.

## Tasks & Acceptance

**Execution:**
- [x] `packages/application/src/use-cases/conversation-orchestrator.test.ts` -- add and run a RED regression using real acknowledgement text, a valid topic anchor, current disclosure, two pending groups, and assertions on confirmation context and staging.
- [x] `packages/application/src/use-cases/conversation-orchestrator.ts` -- exclude only `dialogueAct=acknowledgement` when deriving reporting explanation intent so every downstream consumer uses one normalized decision without breaking other reporting classifications.

**Acceptance Criteria:**
- Given an earlier delivered current disclosure and multiple pending groups, when the latest acknowledgement is inconsistently labeled with reporting intent, then exactly one pending group receives a staged confirmation prompt and the response is not disclosure-only.
- Given reporting intent with any non-acknowledgement dialogue act, including the schema-defaulted `new_substance`, when the turn is safe, then deterministic disclosure behavior remains unchanged.
- Given the scoped diff, when focused application tests, application typecheck/lint, and `git diff --check` run, then all local checks pass.

## Post-review Rollout

After BMad implementation review completes: commit and push `codex/grill-session-docs` and require its pre-push hook to pass; inspect Railway project, production environment, and worker status; under the user's explicit deployment instruction, deploy only `worker` from the reviewed clean commit because merging is not authorized; capture the returned deployment id and verify its metadata/status correspond to that commit and reach `SUCCESS`; then read `D0BJDC2MPE2`, send neutral user-like turns without resetting data, reread the reply, and verify Slack plus production DB evidence. Only after that evidence succeeds, mark the production failure fixed and add the final task-log row. Completion requires one pending `belonging` or `engagement` row to gain a delivered confirmation prompt without another disclosure-only loop.

## Spec Change Log

- Iteration 1: adversarial review found that requiring exactly `dialogueAct=request` could suppress legitimate privacy questions classified as `continuation`, `correction`, or schema-defaulted `new_substance`. Human clarified that only `acknowledgement` should suppress stale reporting intent. Updated the implementation task, regression shape, and rollout evidence requirements. Avoid the rejected exact-request predicate. KEEP the one-boundary fix, explicit-question disclosure behavior, one-group staging, and no schema/repository/Slack changes.

## Design Notes

The classifier prompt defines acknowledgement as a separate dialogue act, but the schema independently accepts reporting intent and defaults omitted dialogue acts to `new_substance`. Suppressing only the known contradictory acknowledgement preserves compatibility and is the smallest cross-provider fix; repository, schema, and Slack adapter changes are deferred unless the RED test disproves the diagnosis.

## Verification

**Commands:**
- `pnpm --filter @entalent/application test -- src/use-cases/conversation-orchestrator.test.ts` -- RED before the source change, green after it.
- `pnpm --filter @entalent/application typecheck` -- application contract remains valid.
- `pnpm --filter @entalent/application lint` -- changed package passes lint.
- `git diff --check` -- no whitespace errors.
- `git diff --no-index --check -- /dev/null _bmad-output/implementation-artifacts/spec-multi-group-confirmation-after-disclosure.md` -- no whitespace errors in the untracked spec; exit 1 is expected because the files differ.
- `git push` -- branch push and repository pre-push hook pass.
- `railway deployment list --service worker --limit 3 --json` -- target and final deployment status are verified.

**Manual checks:**
- Slack history shows a delivered confirmation prompt rather than another disclosure-only reply; production evidence binds its message id and exact summary to one pending group without changing unrelated groups or resetting data.

**Review iteration 1:**
- Rejected and reverted the exact-request predicate and its first test before any commit, push, deployment, Slack write, or production data change.

**Implementation after review loop 1:**
- RED: focused orchestrator run failed only the new acknowledgement regression (47 passed, 1 failed); `generateResponse` was not called.
- GREEN: focused orchestrator run passed 48/48, including `request` and schema-defaulted `new_substance` reporting classifications; application typecheck and lint passed; `git diff --check` passed.
- Pending: commit/push hook, worker deployment, Slack history, production DB evidence, and docs failure/task-log updates.

**Accepted Step-4 patch results:**
- RED: focused orchestrator run passed 48 and failed only the two new disclosure-preservation cases; each returned the ordinary generated reply instead of disclosure.
- GREEN: focused orchestrator run passed 50/50; application typecheck and lint passed; `git diff --check` passed.
- Untracked spec: the no-index whitespace check emitted no diagnostics and returned the expected difference exit code 1.
- Pending: commit/push hook, worker deployment, Slack history, production DB evidence, and docs failure/task-log updates.

## Suggested Review Order

**Shared decision boundary**

- Suppress only stale, substance-free acknowledgement intent after a delivered disclosure.
  [`conversation-orchestrator.ts:153`](../../packages/application/src/use-cases/conversation-orchestrator.ts#L153)

**Regression coverage**

- Prove two pending groups yield exactly one persisted confirmation prompt.
  [`conversation-orchestrator.test.ts:499`](../../packages/application/src/use-cases/conversation-orchestrator.test.ts#L499)

- Preserve disclosure for real privacy questions and absent delivery receipts.
  [`conversation-orchestrator.test.ts:256`](../../packages/application/src/use-cases/conversation-orchestrator.test.ts#L256)

- Preserve schema-defaulted non-acknowledgement reporting requests.
  [`conversation-orchestrator.test.ts:237`](../../packages/application/src/use-cases/conversation-orchestrator.test.ts#L237)
