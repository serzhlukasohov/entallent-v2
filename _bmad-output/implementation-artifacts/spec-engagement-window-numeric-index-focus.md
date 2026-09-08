---
title: 'Quantitative Engagement Window and Index-Focused Pulse Probes'
type: 'feature'
created: '2026-08-28'
status: 'done'
baseline_commit: '4a230ad19fb03ef16db7e4517d26c68b43dfd216'
review_loop_iteration: 0
context:
  - '{project-root}/docs/pulse-cadence-system.md'
  - '{project-root}/docs/adr/ADR-007-survey-evidence-state-machine.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Engagement questions are selected by the pulse backlog only near quarter end, but the evidence evaluator still sees them throughout the cycle and records qualitative signals. Numeric response type is lost between question selection, reply generation, extraction, persistence, and group scoring. Regular probes are initially grouped, yet organic evidence and ignored entries can leave several indexes partially filled instead of completing one three-question index quickly.

**Approach:** Make the final 14 days a shared, bounded engagement eligibility rule for asking and extraction; ask the existing engagement questions explicitly on their canonical 0–10 scale; persist validated ratings in the existing `survey_assessments.score`; and prefer the non-engagement group with the most completed questions until all three are complete. Keep opportunistic evidence from other groups, but do not let it override the selected probe focus.

## Boundaries & Constraints

**Always:** Preserve safety, consent, pacing, one-question limits, tenant scoping, TypeScript ownership of persistence, existing question IDs, and the 0–100 engagement-index formula. Treat the engagement window as `periodEnd - 14 days <= now <= periodEnd`; an expired active window must not remain engagement-eligible. A numeric engagement question is complete only after a validated explicit 0–10 answer is stored. When regular groups tie on progress, use canonical order `autonomy → belonging → growth → purpose`.

**Ask First:** Changing the canonical scale from 0–10 to 1–10; cleaning, rewriting, or backfilling historical evidence, assessments, or group scores; changing tenant policy/configuration; adding a migration; suppressing valid organic evidence from non-focused groups; changing report anonymity or confirmation behavior.

**Never:** Infer engagement ratings from polarity, close a numeric question from qualitative sentiment alone, expose survey mechanics/HR language to employees, add a new active-group table, or move persistence/scoring into the model or Python runtime.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Regular cycle | More than 14 days before `periodEnd` | Engagement questions are neither selected nor evaluated | Continue with regular groups |
| Engagement window | From exactly 14 days before through `periodEnd` | Engagement probe asks one explicit 0–10 question and stores its rating as assessment score | Qualitative-only reply remains incomplete and may be probed again |
| Expired window | `now > periodEnd`, row still active | No engagement selection or extraction | Do not silently treat negative days as eligible |
| Partial regular groups | Multiple groups have progress | Select pending question from the group with most completed questions; tie by canonical order | Fall back to canonical pending order if focused group has no selectable entry |
| Completed engagement group | Three distinct questions have numeric scores | Engagement index is mean score × 10 | Fewer than three scores produce no group index |

</frozen-after-approval>

## Code Map

- `packages/application/src/services/pulse-backlog.service.ts` -- shared eligibility and progress-aware probe selection.
- `packages/application/src/use-cases/survey-evidence.use-case.ts` -- eligible question set, numeric validation, completion, and score persistence.
- `packages/application/src/ports/ai-provider.port.ts` and `packages/contracts/src/ai.ts` -- optional response type/numeric result contracts.
- `packages/ai-openai/src/prompts/respond.ts` and `packages/ai-openai/src/prompts/survey.ts` -- direct numeric probe and extraction instructions.
- `packages/application/src/ports/survey.repository.port.ts` and `apps/worker/src/survey/repositories/survey.repository.ts` -- existing assessment score read/write path.
- `packages/application/src/use-cases/conversation-orchestrator.ts` -- probe metadata and engagement index from three assessment scores.
- `packages/application/src/use-cases/proactive-check-in.use-case.ts` and `packages/ai-openai/src/openai-provider.ts` -- deterministic numeric wording in the supported TypeScript path; MAF and `agent-service` remain unchanged.

## Tasks & Acceptance

**Execution:**
- [x] Update the pulse backlog service and focused unit tests with one bounded engagement-window predicate plus partial-group prioritization.
- [x] Extend AI/evidence contracts and prompts with optional `responseType`/`numericValue`, preserving backward compatibility.
- [x] Gate engagement evaluation by the same window, require a valid numeric value for numeric completion, and persist it through the existing assessment score column.
- [x] Pass numeric probe metadata through inbound and proactive TS prompts; retain safety and one-question gates without extending the retired MAF boundary.
- [x] Replace polarity-derived engagement scoring with three distinct assessment scores and add focused repository/use-case/orchestrator tests.
- [x] Append the completed verification result to `docs/agent-task-log.md`; record any encountered failure in `docs/agent-failures.md`.

**Acceptance Criteria:**
- Given a turn outside the final 14 days, when survey evidence runs, then no engagement question is presented to the evaluator and no engagement assessment is created.
- Given an eligible engagement probe and an explicit rating of 0, 7, or 10, when extraction succeeds, then the exact value is stored in `survey_assessments.score`; qualitative-only text does not close the question.
- Given three distinct scored engagement questions, when the employee confirms the group, then the stored group score equals their mean × 10 without a polarity fallback.
- Given one or more partially completed regular groups, when the next probe is selected, then the group closest to three insights wins, with canonical tie-breaking and stable fallback.
- Given TypeScript generation, when the selected probe is numeric, then the visible reply asks exactly one explicit 0–10 question without mentioning survey mechanics.

## Spec Change Log

- 2026-08-28: Production acceptance exposed that the model evaluator could recognize an explicit rating while omitting optional `numericValue`. Commit `b4a583f` made the explicit inbound rating, bound to the exact preceding probe, the deterministic source of truth and rejects a conflicting model value.
- 2026-08-28: Completed production acceptance for regular-window exclusion, final-14-day numeric wording and persistence, qualitative-only incompletion, and `growth` 2/3 focus selection. Removed the isolated test user and all verified queue/database artifacts afterward.
- 2026-08-28: Corrected an implementation-boundary mistake by restoring `agent-service`, MAF prompt policy, runtime contracts, and proactive MAF wiring byte-for-byte to their pre-feature state. Quantitative engagement remains TypeScript-only.

## Design Notes

`survey_assessments.score` already exists and is already exposed by the admin insights API. Reusing it is the shortest correct path and keeps qualitative evidence summaries available as context without pretending polarity is a rating. Historic rows with `score = null` remain unmodified and simply do not count as quantitative engagement answers.

## Verification

**Commands:**
- `pnpm --filter @entalent/contracts test` -- numeric evaluator contract remains compatible.
- `pnpm --filter @entalent/application test -- pulse-backlog.service.test.ts survey-evidence.use-case.test.ts conversation-orchestrator.test.ts` -- window, focus, persistence, and scoring behavior pass.
- `pnpm --filter @entalent/ai-openai test` -- TS response/evidence prompts pass.
- `pnpm --filter @entalent/worker test` -- repository and supported proactive TypeScript wiring pass.
- `pnpm typecheck` -- cross-package contracts compile.

**Results:**
- Focused application tests passed: 85/85; AI package tests passed: 80/80; contracts passed: 89/89.
- Full package test graph passed: 15/15 tasks, including application 358/358, worker 144/144, and API 92/92.
- Root typecheck passed: 23/23 tasks; changed-package lint and the script suite passed; `git diff --check` passed.
- BMad Blind Hunter and Edge Case Hunter findings were fixed or recorded in `deferred-work.md` where migration or product decisions are required.
- Commit `b2fec85` was pushed to `main`; its accidental MAF/agent-service changes were subsequently restored to the pre-feature state.
- Commit `b4a583f` passed the full pre-push gate (including application 360/360); Railway deployed api and worker successfully while agent-service and dashboard were correctly skipped by watch paths.
- Production behavior acceptance passed: outside the 14-day window the next probe was regular (`autonomy / q12_expectations`); inside the window `engagement_nps` produced one explicit 0–10 question and stored score `7.00`; a qualitative-only engagement reply stored no assessment and left its backlog entry active.
- With `growth` prepared at 2/3, the production-backed selector returned `growth / q12_progress_discussion`, proving the closest-index focus rule independently of the model's optional probe-use decision.
- Cleanup passed: BullMQ jobs `conversation:251-254` and `survey-evidence:239-241` were removed after terminal-state and ownership checks; all 12 database counts for the isolated user, account, conversation, messages, window, backlog, evidence, assessments, group state, LLM runs, audit logs, and runtime attempts were zero.
- No-MAF correction verification passed: MAF-facing files match `b2fec85^` exactly; application 87/87, AI 80/80, worker 144/144, contracts 87/87, root typecheck 23/23, and changed TypeScript package lint all passed.

## Suggested Review Order

**Evidence eligibility and numeric truth**

- Bind numeric evaluation to the tagged preceding probe and explicit employee rating.
  [`survey-evidence.use-case.ts:114`](../../packages/application/src/use-cases/survey-evidence.use-case.ts#L114)

- Reuse one bounded 14-day predicate for asking and turn-time extraction.
  [`pulse-backlog.service.ts:11`](../../packages/application/src/services/pulse-backlog.service.ts#L11)

- Persist validated scores while qualitative-only numeric replies remain incomplete.
  [`survey-evidence.use-case.ts:195`](../../packages/application/src/use-cases/survey-evidence.use-case.ts#L195)

**Selection and scoring**

- Exclude already-scored engagement questions before unlocking their backlog entries.
  [`pulse-backlog.service.ts:52`](../../packages/application/src/services/pulse-backlog.service.ts#L52)

- Focus regular probes on the most-complete unfinished group with stable tie-breaking.
  [`pulse-backlog.service.ts:85`](../../packages/application/src/services/pulse-backlog.service.ts#L85)

- Calculate engagement only from three distinct, bounded numeric assessment scores.
  [`conversation-orchestrator.ts:531`](../../packages/application/src/use-cases/conversation-orchestrator.ts#L531)

**Generation boundaries**

- Carry the selected response type into the TypeScript response boundary.
  [`conversation-orchestrator.ts:342`](../../packages/application/src/use-cases/conversation-orchestrator.ts#L342)

- Retry once, then fail closed when a TS numeric probe remains invalid.
  [`openai-provider.ts:272`](../../packages/ai-openai/src/openai-provider.ts#L272)

**Contracts, tests, and deferred boundaries**

- Reject unsupported persisted response types at the worker adapter boundary.
  [`survey.repository.ts:302`](../../apps/worker/src/survey/repositories/survey.repository.ts#L302)

- Cover window boundaries, group focus, explicit ratings, and numeric completion.
  [`pulse-backlog.service.test.ts:284`](../../packages/application/src/services/pulse-backlog.service.test.ts#L284)

- Verify TS regeneration and fail-closed behavior for malformed numeric probes.
  [`openai-provider.test.ts:403`](../../packages/ai-openai/src/openai-provider.test.ts#L403)

- Track migration and correction-policy follow-ups outside this minimal slice.
  [`deferred-work.md:81`](deferred-work.md#L81)
