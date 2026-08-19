---
title: 'Story 11.1 - Direct TypeScript Path and Quality Baseline'
type: 'refactor'
created: '2026-08-19'
status: 'in-review'
baseline_commit: 'ac492a0473a3a5f0f1bf8127c744ffdfa63cef9f'
review_loop_iteration: 0
context:
  - 'docs/architecture/conversation-dialogue.md'
  - 'docs/adr/ADR-011-mentor-companion-dialogue.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Production is already running the TypeScript mentor successfully, but each inbound turn still performs MAF-oriented context hydration and a preliminary classification before `ConversationOrchestrator` repeats that work. The existing data also cannot explain which typed dialogue decisions correlate with reliable and useful conversations.

**Approach:** Send inbound jobs directly from `ConversationProcessor` to the existing `ConversationOrchestrator`, persist a small privacy-safe projection of the existing `ReplyPlan`, and provide a tenant-scoped 14-day decision report from current PostgreSQL tables.

## Boundaries & Constraints

**Always:** Keep TypeScript as the owner of validation, persistence, queues, and side effects. Reuse `ConversationOrchestrator`, `ReplyPlan`, `messages.metadata`, `llm_runs`, and existing repositories/tables. Keep current reply behavior unchanged. Store only typed enums, booleans, counts, stable IDs, and language-policy source in decision metadata. Scope the report by tenant and compare the latest 14 complete days with the preceding 14 days.

**Ask First:** Any Railway/domain/service/variable mutation; any production deployment; any database schema or migration; any expansion of this story into MAF deletion, Slack delivery semantics, tenant/user-insight repair, or external analytics infrastructure.

**Never:** Add a planner, renderer port, runtime abstraction, event bus, warehouse, dashboard, dependency, dialogue-state table, or duplicate classifier. Do not store prompt/completion text, memory text, topic text, free-form reasoning, or chain-of-thought. Do not publish token, cost, or prompt-version metrics while the current `llm_runs` writer is incomplete.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Inbound TS turn | Valid conversation job while MAF is disabled | Processor invokes `ConversationOrchestrator.orchestrate` once; one context load/classification path produces the same outbound behavior | Existing processor retry/failure handling remains authoritative |
| Decision metadata | Orchestrator produces a `ReplyPlan` and outbound message | Metadata includes version, dialogue act, response move, reply shape, language policy, session-start flag, memory grounding count/usage, and survey probe state | Omit unavailable optional IDs; never fall back to raw text |
| Current report window | Tenant ID with eligible conversations in the latest 14 days | JSON/SQL output reports reliability, continuity, decision cohorts, and useful-state yield | Empty cohorts return zero/null-safe metrics rather than cross-tenant data |
| Ineligible traffic | Deleted, `__init__`, synthetic/control, or proactive messages | Excluded from inbound quality denominators | Keep exclusion rules explicit and testable in the report query |

</frozen-after-approval>

## Code Map

- `apps/worker/src/conversation/conversation.processor.ts` -- inbound job entry point and current duplicated MAF candidate-context work.
- `apps/worker/src/conversation/conversation.module.ts` -- worker dependency wiring.
- `packages/application/src/use-cases/conversation-orchestrator.ts` -- single TS orchestration path and outbound metadata construction.
- `packages/application/src/types/records.ts` -- existing typed message metadata boundary, if type extension is required.
- `scripts/` -- existing operational-script home for a SQL-backed report.

## Tasks & Acceptance

**Execution:**
- [x] `apps/worker/src/conversation/conversation.processor.ts` and focused tests -- call the orchestrator directly for inbound jobs and remove preliminary MAF context/classifier work.
- [x] `apps/worker/src/conversation/conversation.module.ts` -- reuse existing orchestrator wiring without introducing a replacement runtime abstraction.
- [x] `packages/application/src/use-cases/conversation-orchestrator.ts` and focused tests -- persist the approved privacy-safe decision projection from existing typed values.
- [x] `scripts/` -- add the smallest tenant-scoped PostgreSQL decision report for current versus previous 14-day windows.

**Acceptance Criteria:**
- Given an eligible inbound TS job, when the worker processes it, then only `ConversationOrchestrator` loads dialogue context and classifies the turn.
- Given a successful outbound reply, when it is persisted, then its metadata contains only the approved stable decision fields and existing safe metadata.
- Given a tenant ID, when the report runs, then it returns the four approved sections without a new schema and without rows from another tenant.
- Existing inbound reply, retry, survey, memory, safety, audit, and delivery behavior remains green in focused tests.

## Spec Change Log

## Verification

**Commands:**
- `pnpm --filter @entalent/application test -- conversation-orchestrator.test.ts` -- expected: focused orchestration tests pass.
- `pnpm --filter @entalent/worker test -- conversation.processor.test.ts` -- expected: focused processor tests pass.
- `pnpm --filter @entalent/application typecheck && pnpm --filter @entalent/worker typecheck` -- expected: affected TypeScript packages compile.
- `SIM_GATE_RUNS=1 pnpm sim:gate` -- expected: dialogue quality gate passes when model credentials and services are available.
- `git diff --check` -- expected: no whitespace errors.

**Result:** Focused tests, typechecks, script tests, `git diff --check`, and an empty-tenant report against the migrated local PostgreSQL schema passed. The one-run simulation baseline passed 6/8 scenarios; memory grounding and terse-user judge failures are recorded in `docs/agent-failures.md` for follow-up rather than expanding this story.

## Suggested Review Order

**Direct TypeScript path**

- Inbound jobs now enter the existing orchestrator without duplicate MAF hydration or classification.
  [`conversation.processor.ts:278`](../../apps/worker/src/conversation/conversation.processor.ts#L278)

- Focused routing coverage proves no runtime call or worker-side DB preload occurs.
  [`conversation.processor.test.ts:169`](../../apps/worker/src/conversation/conversation.processor.test.ts#L169)

**Privacy-safe decision evidence**

- Outbound persistence projects existing typed decisions into safe measurement metadata.
  [`conversation-orchestrator.ts:308`](../../packages/application/src/use-cases/conversation-orchestrator.ts#L308)

- Privacy tests reject memory, topic, and classifier-reasoning text leakage.
  [`conversation-orchestrator.test.ts:453`](../../packages/application/src/use-cases/conversation-orchestrator.test.ts#L453)

**Tenant decision report**

- Reliability pairs every reply while decision cohorts require measured TypeScript metadata.
  [`typescript-conversation-decision-report.sql:47`](../../scripts/typescript-conversation-decision-report.sql#L47)

- Useful-state yields are attributed through eligible inbound source-message IDs.
  [`typescript-conversation-decision-report.sql:206`](../../scripts/typescript-conversation-decision-report.sql#L206)

- The thin runner validates tenant input and emits one JSON report.
  [`typescript-conversation-decision-report.ts:30`](../../scripts/typescript-conversation-decision-report.ts#L30)

**Supporting checks**

- Static safety checks pin tenant filters, exclusions, and forbidden sensitive metrics.
  [`typescript-conversation-decision-report.test.ts:24`](../../scripts/typescript-conversation-decision-report.test.ts#L24)

- One package script exposes the report without a new dependency or framework.
  [`package.json:37`](../../package.json#L37)
