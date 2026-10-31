---
title: 'RPT-05: Allowed native datasets and timely-input settlement'
type: 'feature'
created: '2026-10-26'
status: 'done'
review_loop_iteration: 0
baseline_commit: 237d7075ff08f262ccf3cbe2bf7c36cb390d204e
context:
  - '{project-root}/_bmad-output/planning-artifacts/pulse-check-reports/RPT-05-DESIGN.md'
---

<frozen-after-approval reason="human-owned intent - do not modify unless human renegotiates">

## Intent

**Problem:** Native reports cannot safely select timely inputs or distinguish processing failures from insufficient participation.

**Approach:** Seal receipt progress, select permanent allowed histories and prepare metric/baseline candidates. The required design defines transactions.

## Boundaries & Constraints

**Always:** Frozen affiliation; exact receipts and required confirmations within native bounds/unlock and RPT-04 cutoff. Preserve RPT-01 arithmetic, RPT-02/03 proof/permissions, departed contributions, qualitative/numeric separation, current rights/retention and pilot defaults.

**Ask First:** Production, external model/Slack calls, historical proof imports, grants/public routes or language-policy changes.

**Never:** Private/working text in reporting; older suppressed-score revival; queue emptiness as settlement; technical failure as insufficiency; fabricated completed history; narrative/snapshot/delivery/MAF implementation.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
| --- | --- | --- | --- |
| Timeliness | Pre-cutoff receipt and confirmation; late finalizer | Include permanent result once settled | Failed work blocks; no partial final |
| Race | Ingress overlaps first start; reverse worker order | DB receipt fence; one deterministic closed set | Unverified/missing proof blocks |
| Latest | Post-cutoff update; current unscored/withdrawn topic | Preserve timely prior state; never revive older score | Current exclusion wins |
| Scope | Transfer; full or partial withdrawal | Origin retained; full adjusts denominator, partial does not | No destination leakage |
| Gates | Five of 100 numeric respondents; incomplete text | Final eligible; permitted qualitative separate | Four means insufficiency only after settlement |
| History | Prior completed final; incompatible policy | Raw comparable delta or Baseline established | No guessed completion/older fallback |

</frozen-after-approval>

## Code Map

- `apps/api/src/channel/ingestion.service.ts` - receipt/admission transaction.
- `apps/worker/src/survey/repositories/question-insight.repository.ts` - confirmation/purge/permanent ownership.
- Existing pilot reader remains separate; exact ownership is in the required design.

## Tasks & Acceptance

Implement the full [required design](../planning-artifacts/pulse-check-reports/RPT-05-DESIGN.md) ownership map and fixtures.

**Execution:**
- [x] `packages/contracts/src/pulse-report-inputs.ts`, exports/tests - typed dataset, progress and baseline boundaries.
- [x] `packages/database/src/schema/survey-report-inputs.ts`, `pulse-report-input-state.ts`, forward SQL/meta - receipt fence, independent stages, shown mappings, watermarks, generations, candidates and locked completion seam.
- [x] `apps/api/src/channel/ingestion.service.ts` and mapped active writers - DB-authored admission; preserve unverified historical clocks.
- [x] Worker conversation/evidence/send/finalization files enumerated in the design - atomic progress, ordered native verdicts, original coalesced dependencies and recovery.
- [x] `packages/application/src/use-cases/prepare-pulse-report-inputs.use-case.ts`, `settle-pulse-report-inputs.use-case.ts`, `select-pulse-report-baseline.ts`, mapped ports/tests - permanent-only preparation and RPT-01 computation.
- [x] Worker `survey/repositories/pulse-report-{input,settlement,history}.repository.ts`, module - exact scoped SQL, certification and baseline reads; no completion producer before RPT-07.
- [x] Mapped permission/retention/cutoff adapters - negative terminals, cooperating locks and invalidation without retention extension.
- [x] `packages/database/src/__tests__/pulse-report-inputs.integration.test.ts`, `pulse-report-settlement.integration.test.ts`, affected suites/logs - migrated matrix, source isolation, crashes and preservation.

**Acceptance Criteria:**
- Given identical admitted events, when jobs run in different orders, then preparation yields the same permitted closed set or explicit unresolved state, never a knowingly incomplete final/notice.
- Given concurrent rights/expiry/erasure, when certifying or reading, then current exclusions prevail without older-score fallback.
- Given Manager scopes, when computing, then each person has one vote, own TL is excluded per team and team insufficiency cannot block eligible overall.
- Given pilot/history paths, when native preparation runs, then old behavior remains intact; no unverified completed baseline is invented.

## Review Corrections

Two independent BMad reviews produced eight deduplicated implementation patches; captured intent is unchanged. Both v3 source rechecks are clear after corrective regressions, including delivered-probe erasure, mixed-user provider ownership and receipt-free backfill. All corrective execution gates and the official pinned-baseline harness passed.

- [x] R1: Shown-form suffix/full-body hash mismatch blocks normal prefixed confirmations
- [x] R2: Native corrected-statement return drops remaining clarification budget
- [x] R3: Out-of-frontier and later-cycle positive progress invalidates frozen prior candidates/history
- [x] R4: Unsupported or blocked old-cycle work prevents independent new-cycle native processing
- [x] R5: Historical shown-form lookup can bind a new-cycle receipt to an old-cycle form
- [x] R6: Missing historical binding recovery closes a newer active window
- [x] R7: Soft-erasure leaves copied private nativeShownComponents statements in message metadata
- [x] R8: Native recovery repeats provider work by enqueueing fresh generation jobs without active-stage deduplication

## Spec Change Log

## Verification

- Behavioral RED/GREEN and migrated ingress/first-start, exact-clock, stage, reverse-verdict, delayed-ACK, rights/retention and six-respondent recovery fixtures.
- Positive history uses synthetic completed-history fixtures; actual DB rejects premature completion. Snapshot/delivery acceptance remains RPT-07.
- Sequential builds; affected package/API/worker tests, full isolated DB integration, typecheck/lint and two independent BMad reviews. Preflight named local DB/Redis before queue fixtures.
- Finish with `pnpm harness:check -- --base 237d7075ff08f262ccf3cbe2bf7c36cb390d204e`; inspect receipt and preserve prior stories/applied SQL. Current-source local acceptance passed; product activation and external-provider acceptance remain outside this story.

Execution verification: all eight tasks and four ACs checked against the 28-case/60-reference acceptance map in `runs/rpt-05/implementation-acceptance-map.json`; all references were revalidated. Current gates: DB164, application569, worker323, API337, contracts95 and migrated/queue54 passed without skips (1,542 tests). Workspace typecheck/lint24/24, scripts typecheck and five affected builds passed. Both independent v3 correction rechecks are clear. Official full harness passed in `runs/harness/receipt-1793065369178-50365fe6.json` against the pinned baseline, including DB164 on the separate harness database. All 83 applied migration hashes match; prior stories, frozen intent, 75 older SQL files, snapshots and journal prefixes are preserved. Completion criterion: approved allowed-source/settlement behavior, all corrective regressions, independent rechecks, preservation and final harness pass. Remaining: 0% for RPT-05. Official final completion/snapshots/delivery, RPT-LANG and external model/Slack acceptance remain later work.

## Suggested Review Order


**Allowed datasets**

- Start at the use case joining settlement, allowed inputs, metrics and baseline selection.
  [prepare-pulse-report-inputs.use-case.ts:81](../../packages/application/src/use-cases/prepare-pulse-report-inputs.use-case.ts#L81)

- Observe receipt stages and coverage without private conversation or working-text queries.
  [pulse-report-input-state.ts:27](../../packages/database/src/pulse-report-input-state.ts#L27)

- Persist reproducible candidates from permanent allowed inputs and frozen request context.
  [pulse-report-input.repository.ts:27](../../apps/worker/src/survey/repositories/pulse-report-input.repository.ts#L27)


**Receipt and invalidation boundaries**

- Fence ingress with tenant and subject locks before the database receipt clock.
  [0075_sharp_lightspeed.sql:198](../../packages/database/migrations/0075_sharp_lightspeed.sql#L198)

- Limit positive invalidation to affected receipts, cycles, dependencies and candidate frontiers.
  [0081_pulse_review_corrections.sql:40](../../packages/database/migrations/0081_pulse_review_corrections.sql#L40)


**Native recovery ownership**

- Classify queued finalization using actual trusted receipt and exact native cycle admission.
  [pulse-report-progress.repository.ts:16](../../apps/worker/src/survey/repositories/pulse-report-progress.repository.ts#L16)

- Deduplicate existing, active, delayed and recoverable native queue work before enqueueing.
  [question-cutoff.processor.ts:694](../../apps/worker/src/survey/question-cutoff.processor.ts#L694)

- Preserve receipt-free backfill while separating native and legacy provider ownership.
  [survey-evidence.processor.ts:33](../../apps/worker/src/survey/survey-evidence.processor.ts#L33)


**Rights and history**

- Erase private metadata atomically while preserving independent immutable delivery proof.
  [user-data.controller.ts:87](../../apps/api/src/users/user-data.controller.ts#L87)

- Reauthorize historical candidates against current source rights and retention.
  [pulse-report-history.repository.ts:17](../../apps/worker/src/survey/repositories/pulse-report-history.repository.ts#L17)

- Keep official final completion closed until RPT-07 provides the real snapshot relationship.
  [0075_sharp_lightspeed.sql:386](../../packages/database/migrations/0075_sharp_lightspeed.sql#L386)


**Regression evidence**

- Exercise mixed-user queued and inline finalization with real Redis and provider-call assertions.
  [pulse-report-review.integration.test.ts:255](../../packages/database/src/__tests__/pulse-report-review.integration.test.ts#L255)

- Verify actual endpoint erasure with delivered numeric probes and ambiguous-send proof.
  [pulse-report-review.integration.test.ts:612](../../packages/database/src/__tests__/pulse-report-review.integration.test.ts#L612)
