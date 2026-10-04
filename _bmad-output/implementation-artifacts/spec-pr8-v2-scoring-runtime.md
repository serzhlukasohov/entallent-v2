---
title: 'Apply approved Insight Analysis V2 scoring policy locally'
type: 'feature'
created: '2026-10-01'
status: 'done'
baseline_commit: '370874b603d63448cfe4bceef02422d471169a51'
review_loop_iteration: 0
context:
  - '_bmad-output/specs/spec-insight-analysis-v2/SPEC.md'
  - '_bmad-output/specs/spec-insight-analysis-v2/SCORING-POLICY.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The active V2 implementation still binds the old seeded twelve-question map, permits fractional question scores, requires a number for every confirmed insight, and treats a finalized question as immutable. PR #8 approves different topic meanings and Scoring Policy 1.0.0, so the existing path cannot safely use that policy.

**Approach:** Add a separate versioned twelve-topic survey definition and exact approved policy payload; carry its identity through activation, confirmation, scoring, privacy-safe persistence, and subsequent confirmed updates. Verify the complete local path without activating any production cycle.

## Boundaries & Constraints

**Always:** Preserve old definitions and historical responses; use the approved A1–B3 meanings and five numeric anchors per topic, with shared rules and reviewed examples. Scores are integers 0–100, including intermediate integers. Confirmed but unevaluable meaning persists as a de-identified `insufficient_evidence` insight without a score. New confirmed information supplements prior de-identified history; only the latest confirmed condition is current. Persist policy/rubric/model/prompt/confidence/timestamps, purge private analytical derivatives atomically, and keep original conversation messages private. Engagement remains separate.

**Ask First:** Any production scoring activation, non-local migration apply, destructive data operation, push, merge, or PR closure.

**Never:** Treat catalog IDs as existing stable keys; relabel old answers; score uncertainty as 50 or missing data as zero; use V1 polarity/sentiment; load draft calibration examples as approved targets; call retired MAF; invent an employee Index aggregation formula or manager report.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
| --- | --- | --- | --- |
| New catalog | Future cycle with versioned A1–B3 definition and matching policy | Exact 12-topic binding; one approved rubric per topic | Reject old/mismatched meanings, missing anchors, or unapproved version |
| Clear condition | Confirmed private meaning | Integer score, safe summary, provenance, private purge | Reject fractional/out-of-range result before persistence |
| Unclear condition | Confirmed meaning that cannot be evaluated | Safe qualitative insight with `insufficient_evidence`, no number | No 50/default score; incomplete scored Index |
| Updated condition | Later confirmed supplement for same topic | Append safe history; current score reflects latest condition | Unconfirmed supplement leaves current result unchanged |
| Historical data | Old seeded question or prior cycle | Historical record remains under old definition | No implicit mapping or rescoring |

</frozen-after-approval>

## Code Map

- `scripts/generate-v2-scoring-policy.ts`, `scripts/data/v2-scoring-policy-1.0.0.json` — reproducible approved payload from Product Markdown.
- `packages/application/src/utils/question-scoring-policy.ts` — exact topic and rubric readiness guard.
- `packages/database/src/schema/survey.ts`, `packages/database/src/schema/survey-insight-v2.ts`, `packages/database/migrations/` — versioned definitions, safe result/history persistence.
- `scripts/activate-v2-scoring-policy.ts`, `apps/worker/src/survey/repositories/question-insight.repository.ts` — policy activation and worker storage boundaries.
- `packages/application/src/use-cases/finalize-question-insight.use-case.ts`, `packages/ai-openai/src/openai-provider.ts` — score/outcome decision and model adapter.

## Tasks & Acceptance

**Execution:**
- [x] `scripts/generate-v2-scoring-policy.ts`, `scripts/data/v2-scoring-policy-1.0.0.json` — prove complete, exact approved payload and exclude draft examples.
- [x] `packages/application/src/utils/question-scoring-policy.ts`, `scripts/activate-v2-scoring-policy.ts` — validate new IDs, meanings, policy version, and all five anchors before binding.
- [x] `packages/database/src/schema/survey.ts`, `packages/database/migrations/`, `scripts/install-v2-survey-definition.ts` — create a new inactive versioned topic definition without rewriting old rows.
- [x] `packages/application/src/use-cases/finalize-question-insight.use-case.ts`, `packages/ai-openai/src/openai-provider.ts` — enforce integer scoring and explicit confirmed unscored outcome.
- [x] `packages/database/src/schema/survey-insight-v2.ts`, `apps/worker/src/survey/repositories/question-insight.repository.ts` — persist de-identified history and latest-current semantics transactionally.
- [x] Relevant application, worker, database, and script tests — cover the matrix through the real local queue and migrated PostgreSQL/Redis path.

**Acceptance Criteria:**
- Given the approved policy file, when compiled and bound to a new matching definition, then all twelve rubrics and exactly sixty anchors match Product source, and old definitions cannot bind to policy 1.0.0.
- Given confirmed meaning, when finalization runs or retries, then the correct scored or unscored safe result is stored once and private derivatives are purged while original messages survive.
- Given a later confirmed supplement, when finalization completes, then safe history retains the prior version and current selection uses only the latest confirmed condition.
- Given local migrated PostgreSQL and isolated Redis, when the V2 conversation flow runs, then policy, privacy, lifecycle, and version boundaries pass focused tests and `pnpm harness:check -- --base <base-revision>`.

## Spec Change Log

## Verification

Local PostgreSQL 17 with pgvector and Redis DB 15: all 48 migrations applied. Approved definition/activation, historical 12+3 definitions, one-topic supplement through confirmation and unscored finalization, replay protection, and current/history selection passed focused tests. The explicit BullMQ run passed 22/22 scenarios on the final code. After review fixes, `pnpm harness:check -- --base HEAD` passed typecheck, lint, tests, and diff check with receipt `runs/harness/receipt-1790935863871-c5ca44cd.json`. The harness excludes model evaluations. A separate approved-policy model probe passed 14/14 approved examples and an unscored case; structured scores are in `runs/harness/v2-approved-model-bridge-2026-10-02.json`. These examples are in the prompt, so this proves wiring and reference consistency, not generalization or an approved calibration tolerance. Review findings on legacy definitions, future-cycle activation, supplements, and replay were classified as patches and fixed. The unscored manager-report suggestion is outside the approved scope; nullable signal metadata is not required by the frozen intent.

**Commands:**
- `node --import tsx scripts/generate-v2-scoring-policy.ts --check` — checked-in payload matches approved Markdown.
- `pnpm typecheck` and focused application/worker/database/script tests — changed contracts and paths compile and pass.
- `pnpm db:generate`, local `pnpm db:migrate`, `pnpm test:integration` — forward schema and migrated behavior pass on named local PostgreSQL.
- `pnpm harness:check -- --base HEAD` and full base gate with named PostgreSQL/Redis — structured receipts pass for the intended scope.

## Suggested Review Order

**Policy identity and activation**

- Start with the cycle binding and period-aware activation boundary.
  [`activate-v2-scoring-policy.ts:49`](../../scripts/activate-v2-scoring-policy.ts#L49)

- Require exact approved meanings and rubric content before binding.
  [`question-scoring-policy.ts:56`](../../packages/application/src/utils/question-scoring-policy.ts#L56)

- Install the new definition inactive while preserving historical rows.
  [`install-v2-survey-definition.ts:10`](../../scripts/install-v2-survey-definition.ts#L10)

**Persistence and lifecycle**

- Add unscored outcomes and current-history storage without changing historical scores.
  [`0047_busy_nocturne.sql:1`](../../packages/database/migrations/0047_busy_nocturne.sql#L1)

- Enforce scored or unscored results before privacy-safe persistence.
  [`finalize-question-insight.use-case.ts:96`](../../packages/application/src/use-cases/finalize-question-insight.use-case.ts#L96)

- Supply the approved meaning and calibration examples to the model with prompt provenance.
  [`question-insight-finalization.ts:20`](../../packages/ai-openai/src/prompts/question-insight-finalization.ts#L20)

- Reopen only for newer messages and preserve confirmed history transactionally.
  [`question-insight.repository.ts:1027`](../../apps/worker/src/survey/repositories/question-insight.repository.ts#L1027)

- Select one to three ready topics for confirmed supplements.
  [`question-insight.repository.ts:653`](../../apps/worker/src/survey/repositories/question-insight.repository.ts#L653)

**Verification**

- Exercise approved and historical definitions through the real BullMQ flow.
  [`v2-conversation-flow.integration.test.ts:39`](../../apps/worker/src/conversation/v2-conversation-flow.integration.test.ts#L39)
