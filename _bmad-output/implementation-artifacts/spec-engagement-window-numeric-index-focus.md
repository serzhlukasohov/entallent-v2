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
- `packages/application/src/use-cases/proactive-check-in.use-case.ts`, `apps/worker/src/conversation/conversation.processor.ts`, and `agent-service/src/agent_service/workflows/model_provider.py` -- consistent numeric wording in TS and proactive MAF paths.

## Tasks & Acceptance

**Execution:**
- [x] Update the pulse backlog service and focused unit tests with one bounded engagement-window predicate plus partial-group prioritization.
- [x] Extend AI/evidence contracts and prompts with optional `responseType`/`numericValue`, preserving backward compatibility.
- [x] Gate engagement evaluation by the same window, require a valid numeric value for numeric completion, and persist it through the existing assessment score column.
- [x] Pass numeric probe metadata through inbound, proactive TS, and proactive MAF prompts; retain safety and one-question gates.
- [x] Replace polarity-derived engagement scoring with three distinct assessment scores and add focused repository/use-case/orchestrator tests.
- [x] Append the completed verification result to `docs/agent-task-log.md`; record any encountered failure in `docs/agent-failures.md`.

**Acceptance Criteria:**
- Given a turn outside the final 14 days, when survey evidence runs, then no engagement question is presented to the evaluator and no engagement assessment is created.
- Given an eligible engagement probe and an explicit rating of 0, 7, or 10, when extraction succeeds, then the exact value is stored in `survey_assessments.score`; qualitative-only text does not close the question.
- Given three distinct scored engagement questions, when the employee confirms the group, then the stored group score equals their mean × 10 without a polarity fallback.
- Given one or more partially completed regular groups, when the next probe is selected, then the group closest to three insights wins, with canonical tie-breaking and stable fallback.
- Given either TS or proactive MAF generation, when the selected probe is numeric, then the visible reply asks exactly one explicit 0–10 question without mentioning survey mechanics.

## Spec Change Log

## Design Notes

`survey_assessments.score` already exists and is already exposed by the admin insights API. Reusing it is the shortest correct path and keeps qualitative evidence summaries available as context without pretending polarity is a rating. Historic rows with `score = null` remain unmodified and simply do not count as quantitative engagement answers.

## Verification

**Commands:**
- `pnpm --filter @entalent/contracts test` -- numeric evaluator contract remains compatible.
- `pnpm --filter @entalent/application test -- pulse-backlog.service.test.ts survey-evidence.use-case.test.ts conversation-orchestrator.test.ts` -- window, focus, persistence, and scoring behavior pass.
- `pnpm --filter @entalent/ai-openai test` -- TS response/evidence prompts pass.
- `pnpm --filter @entalent/worker test` -- repository and proactive runtime wiring pass.
- `cd agent-service && pytest tests/unit/test_model_provider_prompt.py` -- MAF numeric probe policy passes.
- `pnpm typecheck` -- cross-package contracts compile.

**Results:**
- Focused application tests passed: 85/85; AI package tests passed: 80/80; contracts passed: 89/89 plus Python runtime fixtures.
- Full package test graph passed: 15/15 tasks, including application 358/358, worker 144/144, and API 92/92.
- Root typecheck passed: 23/23 tasks; changed-package lint, Python ruff, and the script suite passed.
- Agent-service pytest passed: 198/198; canonical and packaged OpenAPI contracts are byte-identical; `git diff --check` passed.
- BMad Blind Hunter and Edge Case Hunter findings were fixed or recorded in `deferred-work.md` where migration or product decisions are required.
- Python mypy still reports the documented pre-existing model-provider baseline errors; no new changed-line mypy failure was found.
- Commit `b2fec85` was pushed to `main`; Railway auto-deploy completed successfully for api, worker, agent-service, and dashboard.
- Production agent-service readiness passed all six required-variable checks and validated the Dockerfile/runtime-volume envelope; HTTP probing was skipped because no health URL was provided.

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

- Mirror the deterministic one-question 0–10 check in the MAF path.
  [`model_provider.py:615`](../../agent-service/src/agent_service/workflows/model_provider.py#L615)

**Contracts, tests, and deferred boundaries**

- Reject unsupported persisted response types at the worker adapter boundary.
  [`survey.repository.ts:302`](../../apps/worker/src/survey/repositories/survey.repository.ts#L302)

- Cover window boundaries, group focus, explicit ratings, and numeric completion.
  [`pulse-backlog.service.test.ts:284`](../../packages/application/src/services/pulse-backlog.service.test.ts#L284)

- Verify TS regeneration and fail-closed behavior for malformed numeric probes.
  [`openai-provider.test.ts:403`](../../packages/ai-openai/src/openai-provider.test.ts#L403)

- Track migration and correction-policy follow-ups outside this minimal slice.
  [`deferred-work.md:81`](deferred-work.md#L81)
