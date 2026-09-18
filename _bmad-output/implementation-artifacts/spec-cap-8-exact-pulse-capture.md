---
title: 'CAP-8: Explain exact pulse capture'
type: 'bugfix'
created: '2026-09-16'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'b82b9f6'
context:
  - '_bmad-output/specs/spec-generic-conversation-bug-backlog/bug-catalog.md'
  - 'docs/collected-product-requirements.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** When an employee asks what exact information was picked up from their discussion, the coach gives a generic recap and may make unsupported storage claims. It must disclose the employee's currently persisted pulse evidence and lifecycle without exposing hidden reasoning or another person's data.

**Approach:** Detect a distinct transparency intent, inspect evidence linked to prior inbound messages owned by the same tenant/user, and answer deterministically. Save exact provenance on future confirmation prompts so `confirmed` and `withdrawn` are asserted only when the inspected message demonstrably contributed to that frozen candidate.

## Boundaries & Constraints

**Always:** Safety is primary. Scope lookup by tenant, user, inbound ownership, and source message ID. Show owned normalized evidence with a truthful status. Treat missing/legacy provenance as `temporary`, not final. Describe confirmed material only as eligible for de-identified group aggregation. Keep CAP-8 read-only and exclude its question from evidence extraction.

**Ask First:** Any schema migration; change to retention, report snapshots, confirmation semantics, or manager/HR visibility; production payload, commit, push, or deploy.

**Never:** Expose hidden reasoning, foreign evidence, temporary evidence to managers, or raw individual evidence as reportable. Never treat CAP-8 as confirmation, correction, withdrawal, disclosure receipt, staging, or report enqueueing. Never claim `absent` means never stored/processed. Never touch retired MAF or `agent-service`.

## I/O & Edge-Case Matrix

| Scenario | State | Expected behavior | Guard |
|----------|-------|-------------------|-------|
| Absent | No owned active linked evidence | Say no current persisted pulse evidence is linked | Mention possible processing lag; no universal storage claim |
| Temporary | Linked evidence lacks exact final provenance | Show each `evidenceSummary` as a non-reportable working interpretation | Exclude superseded evidence |
| Confirmed | Current confirmation prompt names the source ID; group is confirmed/report-sent | Show that prompt's exact persisted summary as eligible for de-identified aggregation | Do not claim report inclusion, score impact, or manager visibility |
| Withdrawn | Current prompt names the source ID; group is withdrawn | Show that prompt's exact summary as withdrawn from future reporting | Do not claim deletion or retroactive report removal |
| Multiple | One message yielded several groups | Return separate summary/status items | Do not collapse conflicting statuses |
| Legacy final | Group is final but prompt lacks source provenance | Show linked evidence as `temporary` | Never infer final linkage from group status |
| Safety/foreign | Safety applies or ownership mismatches | Safety wins; foreign records look absent | Disclose and mutate nothing |

</frozen-after-approval>

## Code Map

- `packages/contracts/src/ai.ts`, `packages/ai-openai/src/prompts/classify.ts`, `packages/ai-openai/src/openai-provider.ts` -- typed intent and normalization.
- `packages/application/src/types/records.ts`, `packages/application/src/ports/survey.repository.port.ts` -- prompt metadata and provenance read contract.
- `apps/worker/src/survey/repositories/survey.repository.ts` -- ownership/evidence/group/prompt lookup.
- `packages/application/src/use-cases/conversation-orchestrator.ts`, `packages/application/src/utils/reporting-disclosure.ts` -- provenance persistence, routing, and localized deterministic copy.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/ai.ts`, `packages/ai-openai/src/prompts/classify.ts`, `packages/ai-openai/src/openai-provider.ts` -- add narrow `pulse_capture_explanation`; preserve safety and translation/quotation/evaluation/memory/CAP-3/4/5/7/mixed-action controls.
- [x] `packages/application/src/types/records.ts`, `packages/application/src/use-cases/conversation-orchestrator.ts` -- store the selected confirmation candidate's unique source IDs in existing prompt metadata; add no schema.
- [x] `packages/application/src/ports/survey.repository.port.ts`, `apps/worker/src/survey/repositories/survey.repository.ts` -- return linked evidence through owned inbound messages and tenant/user-scoped windows; map final status only when current prompt metadata proves inclusion.
- [x] `packages/application/src/use-cases/conversation-orchestrator.ts`, `packages/application/src/utils/reporting-disclosure.ts` -- answer from prior inbound messages before generative fallback; suppress probing, disclosure, confirmation flows, evidence extraction, and reporting side effects.
- [x] `packages/ai-openai/src/openai-provider.test.ts`, `apps/worker/src/survey/repositories/survey.repository.test.ts`, `packages/application/src/use-cases/conversation-orchestrator.test.ts` -- cover collisions, ownership, all statuses, provenance fail-closed, safety precedence, and zero mutation.

**Acceptance Criteria:**
- Given D05-03 after persisted evidence, when the employee asks what exact information was captured, then the reply lists owned normalized evidence/status without free-form generation.
- Given no linked evidence or pending asynchronous extraction, when CAP-8 is requested, then the reply is scoped to current persisted evidence and makes no universal storage claim.
- Given a final group without exact source IDs on its current prompt, when CAP-8 is requested, then the message is not labeled `confirmed` or `withdrawn`.
- Given CAP-8 during safety handling, then safety wins; during awaiting-confirmation, CAP-8 bypasses confirmation interpretation and performs no survey/report mutation.
- Given a foreign tenant/user message ID, when queried, then neither content nor existence is disclosed.

## Spec Change Log

## Design Notes

Baseline: `b82b9f6`. Reuse confirmation-prompt metadata instead of adding persistence. Because extraction follows orchestration asynchronously, CAP-8 covers already-persisted evidence from prior messages, not the current question.

## Verification

**Commands:**
- `pnpm exec vitest run packages/ai-openai/src/openai-provider.test.ts packages/application/src/use-cases/conversation-orchestrator.test.ts apps/worker/src/survey/repositories/survey.repository.test.ts` -- focused behavior passes.
- `pnpm typecheck` -- affected boundaries compile.
- `pnpm harness:check -- --base b82b9f6` -- structured receipt succeeds without retired-runtime paths.

## Suggested Review Order

**Deterministic conversation boundary**

- Start here: routes CAP-8 before generation and scopes lookup to earlier conversation history.
  [`conversation-orchestrator.ts:454`](../../packages/application/src/use-cases/conversation-orchestrator.ts#L454)

- Freezes exact source provenance on the existing confirmation prompt metadata.
  [`conversation-orchestrator.ts:642`](../../packages/application/src/use-cases/conversation-orchestrator.ts#L642)

- Prevents the transparency question itself from becoming new pulse evidence.
  [`conversation-orchestrator.ts:698`](../../packages/application/src/use-cases/conversation-orchestrator.ts#L698)

**Provenance and lifecycle truth**

- Maps final status only when exact prompt provenance exists; deduplicates identical items.
  [`survey.repository.ts:451`](../../apps/worker/src/survey/repositories/survey.repository.ts#L451)

- Fails closed unless every source message belongs to the same earlier conversation.
  [`survey.repository.ts:582`](../../apps/worker/src/survey/repositories/survey.repository.ts#L582)

**Intent and employee-visible copy**

- Normalizes direct capture questions while preserving safety, quoting, and mixed-action controls.
  [`openai-provider.ts:459`](../../packages/ai-openai/src/openai-provider.ts#L459)

- Renders localized absent, temporary, confirmed, and withdrawn explanations deterministically.
  [`reporting-disclosure.ts:64`](../../packages/application/src/utils/reporting-disclosure.ts#L64)

**Regression evidence**

- Proves repository ownership, temporal scoping, lifecycle mapping, and deduplication.
  [`survey.repository.test.ts:63`](../../apps/worker/src/survey/repositories/survey.repository.test.ts#L63)

- Proves D05-03, no survey mutation, lifecycle copy, localization, and safety precedence.
  [`conversation-orchestrator.test.ts:628`](../../packages/application/src/use-cases/conversation-orchestrator.test.ts#L628)

- Proves exact intent recognition and collision controls at the latest-turn boundary.
  [`openai-provider.test.ts:411`](../../packages/ai-openai/src/openai-provider.test.ts#L411)
