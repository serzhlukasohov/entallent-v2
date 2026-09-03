---
title: 'PR 5 REQ-015 Reporting Disclosure Receipt'
type: 'feature'
created: '2026-09-03'
status: 'done'
route: 'plan-code-review'
baseline_commit: '0f8401d9aca6fd42e2cca17cd60156982721b486'
context:
  - '{project-root}/docs/collected-product-requirements.md'
  - '{project-root}/_bmad-output/planning-artifacts/2026-09-03-pr5-product-conformance-audit-and-plan.md'
---

# PR 5 REQ-015 Reporting Disclosure Receipt

<frozen-after-approval reason="Accepted PR #5 defaults and sequential implementation order">

## Intent

**Problem:** The TypeScript runtime can confirm and report a survey group without durable evidence that the employee first received the current reporting disclosure. The existing `onboarding` mode does not read or persist onboarding state.

**Approach:** Use delivered outbound messages as the disclosure receipt: canonical text in `messages.text`, a centralized version in message metadata, and provider `sent_at` as `shownAt`. Gate confirmation on that tenant/user-scoped receipt and copy its immutable proof onto the confirmed group state.

## Boundaries & Constraints

**Always:** Render versioned disclosure copy deterministically; record delivery only after the channel succeeds; require `shownAt < confirmingMessage.occurredAt`; scope receipt and pending/awaiting lookups by tenant and user; suppress confirmation and pulse probes until the current version is delivered; preserve safety responses over onboarding copy; exclude legacy confirmed rows without proof from reports.

**Ask First:** Production migration or deployment, live-model/Slack execution, changing the approved disclosure semantics, or expanding this gap into the later de-identification/correction lifecycle.

**Never:** Treat prompt output, queued delivery, `onboardingStatus`, or `consentState` as proof of disclosure; backfill legacy users as informed; create a disclosure table or user-level duplicate receipt without a measured need.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
| --- | --- | --- | --- |
| First safe turn | No delivered current receipt | Response contains canonical disclosure and metadata version; confirmation/probe stay blocked | Delivery failure leaves `sent_at` null, so next safe turn retries |
| Safety turn | No receipt and survey-blocking risk | Safety response only | Disclosure remains pending |
| Confirmation | Current receipt delivered before inbound reply | Agreement may confirm; group stores receipt and confirming message proof | Missing, stale, cross-tenant, or late receipt fails closed |
| Legacy awaiting | Awaiting group without current receipt | Return group to pending, show disclosure, resurface summary on later turn | “OK” to disclosure cannot confirm old summary |
| Legacy confirmed | Confirmed row lacks proof | Row cannot satisfy report query | No grandfathering |

</frozen-after-approval>

## Code Map

- `packages/application/src/utils/reporting-disclosure.ts` — current version and deterministic localized copy.
- `packages/application/src/ports/conversation.repository.port.ts` — delivered receipt lookup contract.
- `packages/application/src/use-cases/conversation-orchestrator.ts` — fail-closed Phase A/B gate and message tagging.
- `packages/database/src/schema/survey-group-states.ts` — immutable confirmation/disclosure proof.
- `apps/worker/src/conversation/repositories/conversation.repository.ts` — tenant/user receipt query.
- `apps/worker/src/survey/repositories/group-state.repository.ts` — tenant-scoped confirmation queries and legacy-report exclusion.
- `apps/worker/src/message-send/message-send.processor.ts` — scoped delivery receipt persistence after channel success.
- `packages/channel-slack/src/slack.adapter.ts` — Slack server timestamp as the delivery clock.
- `packages/application/src/use-cases/proactive-check-in.use-case.ts` — disclosure gate for proactive pulse probes.

## Tasks & Acceptance

**Execution:**

- [x] Add focused failing application tests for missing/current/stale disclosure, safety suppression, legacy awaiting, and timestamp ordering.
- [x] Add the versioned disclosure utility and application record/port types.
- [x] Gate Phase A/B and persist the exact disclosure marker on the outbound message.
- [x] Add nullable group-state proof fields and a forward migration whose confirmed-row constraint is `NOT VALID` for legacy data.
- [x] Scope repository reads by tenant, persist proof on confirmation, and exclude legacy confirmed rows without proof.
- [x] Add repository/message-send tests for delivered, failed, dev, and cross-tenant receipt behavior.

**Acceptance Criteria:**

- Given no successfully delivered current disclosure, when any confirmation-like message arrives, then no group becomes confirmed and no report job is queued.
- Given a current same-tenant receipt delivered before the exact inbound confirmation, when the employee agrees, then the group stores disclosure version/time plus confirming message/time and queues at most one report job.
- Given legacy awaiting or confirmed state without proof, when processing or reporting, then it fails closed without pretending disclosure occurred.
- Given Slack delivery fails, when the employee sends another message, then disclosure is still missing and is retried on the next safe response.

## CLI Verification

- `pnpm --filter @entalent/application test -- src/use-cases/conversation-orchestrator.test.ts`
- `pnpm --filter @entalent/worker test -- src/conversation/repositories/conversation.repository.test.ts src/message-send/message-send.processor.test.ts src/survey/repositories/group-state.repository.test.ts`
- `pnpm typecheck`
- `pnpm test:integration` with local `DATABASE_URL`
- `git diff --check`
