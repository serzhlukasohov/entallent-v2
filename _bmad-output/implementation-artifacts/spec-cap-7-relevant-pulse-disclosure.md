---
title: 'Restrict reporting disclosure to relevant pulse flows'
type: 'bugfix'
created: '2026-09-14'
status: 'done'
review_loop_iteration: 0
baseline_commit: '1e398379b8769b5c77bd25985317adf8ccf47a53'
context:
  - '{project-root}/_bmad-output/specs/spec-generic-conversation-bug-backlog/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-generic-conversation-bug-backlog/bug-catalog.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The inbound TypeScript conversation orchestrator treats ordinary turn cadence as permission to append the pulse-reporting disclosure. Once three inbound turns exist, unrelated safe free text can receive disclosure text and metadata even though no Pulse flow is active, reproducing D05-01 and the same failure class in D05-02.

**Approach:** Remove cadence as a disclosure trigger at the existing shared orchestrator boundary. An inbound reply may introduce the disclosure only for an explicit reporting explanation or when persisted awaiting-confirmation state proves a relevant legacy Pulse flow; scheduled Pulse disclosure remains owned by `ProactiveCheckInUseCase`.

## Boundaries & Constraints

**Always:** Preserve the requested non-Pulse answer; use already-loaded persisted Pulse state; keep explicit reporting questions, legacy awaiting-state recovery, delivered-receipt confirmation, safety gates, tenant scope, and proactive Pulse behavior intact; follow RED→GREEN; validate the deployed worker with multiple sequential Slack turns and exactly one reply per inbound.

**Ask First:** Any database reset or fixture mutation; schema, prompt, classifier, API, dashboard, or proactive-check-in change; Railway configuration change; deployment of a service other than `worker`; merge of the branch.

**Never:** Use turn count alone as Pulse relevance; add a new state query, dependency, policy abstraction, or Slack-specific branch; revive, invoke, test, or deploy MAF/`agent-service`; weaken safety, privacy, confirmation, or delivery-proof gates; commit transcript-bearing local backlog artifacts.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|---------------------------|----------------|
| D05-01 ordinary statement | Exact onboarding text; `casual_conversation/new_substance`; pacing ready; no disclosure receipt or awaiting group | Normal onboarding reply remains; no disclosure hint, appended text, or version metadata | N/A |
| D05-02 unrelated requests | Exact reminder, change-detail, client-deck, and two team-score messages represented by their supported request/clarification classifications; pacing ready; no Pulse state | Requested reply remains for every row; no disclosure hint, appended text, or version metadata | N/A |
| Explicit reporting question | `reporting_explanation`; no current receipt | Deterministic localized disclosure remains available | N/A |
| Legacy awaiting confirmation | Persisted awaiting group; no current receipt | Existing recovery may offer disclosure and return the group to pending | N/A |
| Scheduled Pulse turn | Proactive check-in without current receipt | Existing proactive disclosure behavior remains unchanged | N/A |
| Safety-blocked turn | Survey blocked or crisis/sensitive strategy | No disclosure and no Pulse state mutation | Preserve existing safety response |

</frozen-after-approval>

## Code Map

- `packages/application/src/use-cases/conversation-orchestrator.ts` -- shared inbound disclosure decision and its response/persistence consumers.
- `packages/application/src/use-cases/conversation-orchestrator.test.ts` -- existing disclosure, safety, confirmation, and pacing fixtures; CAP-7 regression home.
- `packages/application/src/use-cases/proactive-check-in.use-case.ts` -- unchanged scheduled Pulse owner and preservation boundary.
- `packages/application/src/use-cases/proactive-check-in.use-case.test.ts` -- unchanged preservation coverage for scheduled disclosure.

## Tasks & Acceptance

### Task 1 — Restrict inbound reporting disclosure

**Execution:**
- [x] `packages/application/src/use-cases/conversation-orchestrator.test.ts` and `packages/application/src/use-cases/conversation-orchestrator.ts` -- add exact D05-01 plus table-driven D05-02 RED coverage, then remove only the cadence-only disclosure trigger and reuse explicit reporting or persisted awaiting state.

**Post-review operations:** Run the harness gate, commit/push, verify the production worker deployment, run preflight, then execute sequential Slack ordinary/reminder/reporting-control scenarios with reply read-back after every send.

**Acceptance Criteria:**
- Given pacing-ready inbound history without Pulse state, when any of the six D05-01/D05-02 inputs is handled, then its normal requested answer is preserved and neither response context nor saved outbound metadata marks a reporting disclosure.
- Given an explicit reporting explanation request or persisted awaiting-confirmation recovery, when the inbound turn is handled, then the existing disclosure path still works without weakening safety or confirmation invariants.
- Given a scheduled proactive Pulse turn, when no current disclosure receipt exists, then its existing disclosure ownership and persistence behavior are unchanged.
- Given the reviewed commit is deployed to the production worker and preflight passes, when realistic Slack scenarios run sequentially, then unrelated turns contain no disclosure, a genuine reporting question returns the disclosure, and each inbound produces exactly one read-back reply.

## Spec Change Log

## Verification

**Commands:**
- `pnpm --filter @entalent/application exec vitest run src/use-cases/conversation-orchestrator.test.ts` -- exact RED first, then all focused orchestrator tests green.
- `pnpm --filter @entalent/application exec vitest run src/use-cases/conversation-orchestrator.test.ts src/use-cases/proactive-check-in.use-case.test.ts` -- inbound and scheduled disclosure consumers green.
- `pnpm --filter @entalent/application typecheck` -- no TypeScript regressions.
- `pnpm harness:check -- --base 1e398379b8769b5c77bd25985317adf8ccf47a53` -- structured harness receipt passes before push.
- `pnpm harness:preflight` -- PostgreSQL and Redis reachable before any Slack payload.

**Production evidence:**
- Commits `8ba76b3`, `b459833`, and `e5e9b05` pushed to `origin/codex/grill-session-docs`; pre-push receipt `runs/harness/receipt-1789385167294-2d9f62bd.json` passed with orchestrator 81/81.
- Railway production `worker` deployment `c4524a27-0051-4550-91ed-5bd33d14779c` reached `SUCCESS` from a clean `e5e9b05` snapshot.
- Preflight receipt `runs/harness/receipt-1789385349010-eff98c7c.json` confirmed PostgreSQL and Redis reachable.
- Sequential Slack read-back in `D0BJDC2MPE2`: unrelated onboarding and task-priority replies at `1789385372.660079` and `1789385391.859449` contained no disclosure; the explicit reporting control returned the disclosure at `1789385413.838689`; each inbound produced exactly one reply.

## Suggested Review Order

**Disclosure relevance boundary**

- Removes cadence-only triggering while retaining explicit reporting and awaiting-state recovery.
  [`conversation-orchestrator.ts:419`](../../packages/application/src/use-cases/conversation-orchestrator.ts#L419)

**Exact regressions**

- Covers all six D05 inputs with preserved replies and absent disclosure metadata.
  [`conversation-orchestrator.test.ts:252`](../../packages/application/src/use-cases/conversation-orchestrator.test.ts#L252)

- Verifies the observable no-disclosure response, context, and persistence contract.
  [`conversation-orchestrator.test.ts:340`](../../packages/application/src/use-cases/conversation-orchestrator.test.ts#L340)

**Preservation controls**

- Keeps persisted awaiting-confirmation recovery eligible for disclosure.
  [`conversation-orchestrator.test.ts:350`](../../packages/application/src/use-cases/conversation-orchestrator.test.ts#L350)

- Keeps generated disclosure idempotent on the eligible path.
  [`conversation-orchestrator.test.ts:396`](../../packages/application/src/use-cases/conversation-orchestrator.test.ts#L396)

- Proves pending state alone cannot introduce disclosure.
  [`conversation-orchestrator.test.ts:424`](../../packages/application/src/use-cases/conversation-orchestrator.test.ts#L424)

- Preserves deterministic answers for explicit reporting questions.
  [`conversation-orchestrator.test.ts:450`](../../packages/application/src/use-cases/conversation-orchestrator.test.ts#L450)
