---
title: 'Survey Evidence Polarity Validation'
type: 'refactor'
created: '2026-08-12'
status: 'done'
review_loop_iteration: 0
context: []
baseline_commit: '8622d04a6d1504ff061704ad22a400044ddf427a'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `survey_evidence.polarity` is stored as unrestricted text even though the product model only supports `positive`, `negative`, `neutral`, and `mixed`. The AI contract already emits a strict enum, but the application repository port and worker persistence boundary widen it back to `string`, so a future caller or adapter bug could persist invalid data.

**Approach:** Keep the database schema unchanged in this slice, but make the application write contract explicit and add a worker repository guard before insert. Invalid polarity should fail before persistence with a stable operational error.

## Boundaries & Constraints

**Always:** Preserve existing valid polarity values and dashboard/API read behavior. Keep the change producer-side only: type-level narrowing in application and runtime validation in worker persistence. Add focused tests for valid insert and invalid rejection.

**Ask First:** Adding a database migration or check constraint; changing historical data; changing AI output schema semantics; changing dashboard display logic.

**Never:** Do not silently coerce unknown polarity values to `neutral`. Do not drop evidence records without surfacing an error. Do not broaden the allowed polarity set.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Valid evidence | `polarity: 'positive'`, `'negative'`, `'neutral'`, or `'mixed'` | Evidence is inserted with the same polarity value. | N/A |
| Invalid producer value | Runtime caller passes `polarity: 'unclear'` or another unsupported string | No DB insert is attempted. | Throw `survey_evidence_invalid_polarity`. |
| Typed application caller | Code constructs `SaveSurveyEvidenceParams` | TypeScript only accepts the four supported polarity values. | Compile-time failure for unsupported literals. |

</frozen-after-approval>

## Code Map

- `packages/application/src/ports/survey.repository.port.ts` -- Defines the persistence port; currently widens polarity to `string`.
- `packages/application/src/use-cases/survey-evidence.use-case.ts` -- Producer path from AI survey evaluation into `saveEvidence`.
- `apps/worker/src/survey/repositories/survey.repository.ts` -- Drizzle persistence adapter that inserts `survey_evidence`.
- `packages/application/src/use-cases/survey-evidence.use-case.test.ts` -- Existing application coverage for evidence extraction flow.
- `apps/worker/src/survey/repositories/survey.repository.test.ts` -- New focused repository tests for polarity validation.
- `packages/database/src/schema/survey.ts` -- DB column remains text in this slice; comment documents intended values.

## Tasks & Acceptance

**Execution:**
- [x] `packages/application/src/ports/survey.repository.port.ts` -- introduce `SurveyEvidencePolarity` union and use it in `SaveSurveyEvidenceParams` -- prevents new application callers from using arbitrary strings.
- [x] `apps/worker/src/survey/repositories/survey.repository.ts` -- validate `params.polarity` before insert -- keeps the database boundary safe if runtime input is cast or malformed.
- [x] `apps/worker/src/survey/repositories/survey.repository.test.ts` -- add tests for valid insert and invalid rejection -- verifies the guard and no-insert behavior.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- mark the deferred polarity validation item complete -- keeps architecture tracking current.

**Acceptance Criteria:**
- Given valid survey evidence polarity, when `saveEvidence` persists evidence, then the exact allowed polarity is written.
- Given an unsupported runtime polarity, when `saveEvidence` is called, then it throws `survey_evidence_invalid_polarity` before calling Drizzle `insert`.
- Given application code uses `SaveSurveyEvidenceParams`, when it assigns polarity, then TypeScript narrows the value to `positive | negative | neutral | mixed`.
- Given the admin dashboard reads survey data, when this change is deployed, then existing response shapes and UI behavior remain unchanged.

## Verification

**Commands:**
- `pnpm --filter @entalent/worker test -- survey.repository.test.ts` -- expected: new repository tests pass.
- `pnpm --filter @entalent/application test -- survey-evidence.use-case.test.ts` -- expected: producer flow remains green.
- `pnpm --filter @entalent/application typecheck` -- expected: polarity type narrowing compiles.
- `pnpm --filter @entalent/worker typecheck` -- expected: worker adapter compiles.
- `pnpm typecheck && pnpm lint && pnpm test` -- expected: full repo gate passes.

## Suggested Review Order

**Validation Boundary**

- Entry point: runtime guard fails before persistence.
  [`survey.repository.ts:109`](../../apps/worker/src/survey/repositories/survey.repository.ts#L109)

- Allowed list is compiled against the application polarity union.
  [`survey.repository.ts:26`](../../apps/worker/src/survey/repositories/survey.repository.ts#L26)

- Guard implementation keeps invalid strings out of DB inserts.
  [`survey.repository.ts:248`](../../apps/worker/src/survey/repositories/survey.repository.ts#L248)

**Application Contract**

- Persistence port narrows writes to supported polarity values.
  [`survey.repository.port.ts:3`](../../packages/application/src/ports/survey.repository.port.ts#L3)

**Tests**

- Valid polarity insert preserves values and numeric serialization.
  [`survey.repository.test.ts:57`](../../apps/worker/src/survey/repositories/survey.repository.test.ts#L57)

- Invalid runtime polarity rejects before insert.
  [`survey.repository.test.ts:80`](../../apps/worker/src/survey/repositories/survey.repository.test.ts#L80)
