# RPT-03 - Literal Engagement answers and durable source proof

Date: 2026-10-23. Proposed engineering contract for [RPT-03](../../implementation-artifacts/spec-rpt-03-literal-engagement-answers.md). No RPT-03 runtime implementation or product activation is claimed.

Source workspace: `/private/tmp/entalent-pulse-check-reports`, branch `codex/pulse-check-reports`, HEAD `237d7075ff08f262ccf3cbe2bf7c36cb390d204e` plus preserved local RPT-01/02. The initial dirty-file hashes are recorded in ignored `runs/rpt-03/preservation-start.json`.

## Authority and acceptance boundary

The approved report package requires three explicit integer answers from 1 through 10, equal question/person weighting, permanent allowed sources, durable receipt time and no inferred ratings. See FR-001-003/008/010/017/036, AC-01-04/09-11/17/33 and the implementation plan. These are prerequisite contributions: this story does not complete report readers, final cutoff configuration/settlement, narrative, delivery or public rights ingress.

The older Engagement specification and seed describe a different 0-10 contract. Preserve that definition, its assessments, version semantics, active default selection and pilot behavior. Do not convert historical 0 to 1, silently treat historical 1-10 values as new answers, or edit applied migrations. Preserve completed RPT-01/02 and their frozen intent.

A direct, unambiguous literal answer to the exact delivered numeric question is its own answer-confirmation receipt (`direct_explicit_answer`). This follows the separate quantitative rules in PR-014/020, FR-010 and AC-11. PR-003/FR-002 and AC-03 still require shown-and-confirmed proof for transformed analytical statements. This story adds no numeric summary confirmation, root-cause requirement or model-derived rating.

## 1. Verified brownfield constraints

- `seed.ts:538-579` defines `engagement_nps`, `engagement_motivation`, `engagement_current` as `numeric_0_10`. `types/records.ts:147` owns the response-type union. The mapper, generation prompts and provider validator also assume 0-10.
- `survey-evidence.use-case.ts:301` bypasses V2 meaning capture for legacy numeric items; values remain mutable assessments. The parser at 543-553 admits decimals/incidental numbers and mishandles negative signs. Assessments update by processing order, not receipt order.
- V2 windows are excluded from legacy group confirmation (`group-state.repository.ts:68-71,104-106`). Reusing that path would not provide numeric confirmation proof.
- Existing report lineages are restricted to open-ended rubric questions by migration 0054's resolver and 0057's identity guard. Extend both through forward migrations; do not invent numeric rubrics.
- New active definitions can make the tenant/global default lookup ambiguous (`survey.repository.ts:524-542`). Preparation must be inactive and explicit.
- Existing activated-content immutability only protects open-ended rows (0037). The new quantitative catalog and mapping need their own immutable contract.
- Evidence dispatch happens after successful conversation output. Therefore capturing only in `SurveyEvidenceProcessor` loses answers when generation fails or rapid-message coalescing skips a turn.

## 2. Versioned, inactive preparation

Introduce response type `numeric_1_10_integer` and answer contract `engagement-1-10-v1`; retain `numeric_0_10` unchanged. Add a tenant-scoped preparation script accepting an explicit source definition and new version. It accepts only an approved canonical 12-question V2 source, atomically clones those open-ended meanings/rubrics with new identities, and adds exactly three newly versioned quantitative questions from the copy below. The new definition version is `v2-report-engagement-1.0.0`; the existing open-ended scoring format remains `v2-policy-1.0.0`, while the independent answer contract is `engagement-1-10-v1`. It returns the same inactive definition on an identical replay and rejects conflicting content/version reuse. It does not change active/default selection, prepare/open a live cycle, rewrite seed data or call a provider.

Store an immutable `survey_engagement_collection_contracts` record for the new definition: tenant, source definition, contract version and the three question IDs/versions/stable keys. Product capture requires this exact contract plus an RPT-02 org-native cycle/window binding; a type string alone is insufficient. Existing RPT-02 windows with old numeric definitions retain their old behavior. Inactive preparation must leave default lookup unchanged. Existing org-native opening rejects inactive definitions: source-to-answer fixtures explicitly activate only their task-owned tenant definition inside the isolated test database before opening. Preparation never activates it; production activation remains separately authorized.

### Exact policy compatibility changes

The existing `hasCompleteV2ScoringPolicy` requires exactly 12 total questions, not just 12 open-ended ones. Keep it strict. Add a separate explicit new-contract helper that first validates the canonical 12 through that helper, then validates exactly the three declared numeric IDs/versions/keys; reject missing/extra/duplicate or undeclared questions. This is not a general relaxation of V2 validation.

Update `scripts/activate-v2-scoring-policy.ts` to recognize only the new declared catalog version with its immutable contract. Build the open-ended rubric/policy snapshot from the validated 12-question subset; the numeric three belong to their separate contract. Update the open-ended preflight in `question-insight.repository.ts` to recognize the same explicit branch, preserving missing-binding failure and legacy behavior. Add a forward replacement of the window-policy guard introduced by migration 0047: this exact version/contract uses the canonical mapping and must not fall through to the legacy q12 map. Do not edit 0047 itself.

In `survey.repository.ts`, extend the explicit org-native missing-binding guard to this exact new version/contract before the legacy quarter-window fallback. An active new catalog without a current approved org-native opening returns the existing typed unavailable/error outcome and creates no window, binding or legacy cohort. Do not relax the historical branch.

A distinct catalog version avoids the legacy installer lookup collision on `(tenant, version)` in `install-v2-survey-definition.ts`. Preserve that installer path and test that its replay still identifies the original canonical definition after new inactive preparation. Test policy preparation and open-ended capture for the new 15-question catalog, plus rejection of undeclared 15-question catalogs, incomplete canonical subsets and contract mismatches. No dummy rubric for numeric questions.

The following proposed canonical meanings/endpoints preserve the three existing topics; they define the new scale and do not claim historical comparability:

| Key | Proposed default English question |
| --- | --- |
| `engagement_nps` | On a scale from 1 to 10, where 1 means not at all likely and 10 means extremely likely, how likely are you to recommend this company as a place to work? Please reply with one whole number. |
| `engagement_motivation` | On a scale from 1 to 10, where 1 means never and 10 means always, how often do you feel motivated to give your best effort at work? Please reply with one whole number. |
| `engagement_current` | On a scale from 1 to 10, where 1 means not at all engaged and 10 means fully engaged, how engaged do you feel with your work right now? Please reply with one whole number. |

The recommendation key is retained for topic identity; it does not authorize promoter/detractor or eNPS calculations. Question wording/endpoints, mapping and contract become immutable once preparation completes. Changes require another version. Do not change existing personal-language policy; record the actual displayed form/version in prompt proof. Cross-product language support remains RPT-LANG.

Preserve the existing final-14-days offset relative to immutable `periodEnd`. For this new native contract, eligibility is half-open:

`[max(periodStart, openedAt, periodEnd - 14 days), min(periodEnd, stoppedAt ?? periodEnd))`.

This story does not move that offset to a business-calendar cutoff. RPT-04/05 later introduce and consume the report cutoff; retained answer history must support selecting the latest eligible answer strictly before it.

## 3. Deterministic capture before model work

Add a pure domain parser/invariant and an application capture use case with no AI dependency. Accept a single explicit whole-number answer or unambiguous rating notation such as `8` or `8/10`. Preserve its literal value. Reject 0, -1, 11, 7.5, 10.5/10, incidental `7 meetings`, negated/ambiguous values, multiple candidate answers and sentiment-only replies. A model value cannot create, override or validate this ledger answer. Incomplete/invalid text leaves the previous accepted revision intact.

Bind as of the immutable source inbound receipt, never processing/backfill time: select the latest positively delivered outbound in the same owned conversation whose positive delivery time is strictly before that inbound received timestamp, ordered by actual delivery time and stable outbound identity. It must be a new-contract numeric probe, with matching tenant, subject, window, definition, question ID/version, stable key, answer contract and actual displayed-form identity/hash. An intervening delivered non-probe clears the implicit binding. An unsent or ambiguously delivered prompt provides no proof. Provider `occurredAt` is diagnostic, not admission or correction ordering.

Existing normal/proactive producers must carry those fields into the persisted outbound and validate the new scale/topic alongside existing safety and one-question limits. Keep the legacy generation branch. Probe proof is accepted only after positive delivery receipt, not merely successful generation or queueing. Never infer a target question from an arbitrary old mention. Same-bound-probe follow-up answers may create revisions; a separate unprompted cross-topic correction UX is out of scope.

Call the use case from `ConversationProcessor.processInbound` after source ownership validation but before committed-turn resume, runtime skip, coalescing and generation. Its own short transaction is idempotent. Also invoke it before evidence finalization/evaluation for recovery, and for each original inbound in backfill. It must not complete the semantic evidence intent or make its success depend on model availability. Exclude the new response type before semantic evaluation and again before semantic apply; do not accidentally treat it as open-ended. Existing legacy numeric evidence remains unchanged.

## 4. Permanent state, ordering and receipt isolation

Add `schema/survey-engagement-answers.ts` with two responsibilities:

- `survey_engagement_capture_events`: durable source idempotency/terminal state, bound identity and content-free receipt order. An accepted event creates at most one answer revision. Distinguish invalid/ineligible from retryable operationally unavailable input; missing retained proof must not masquerade as low participation. After analytical expiry retain only the minimal content-free replay tombstone until subject erasure; never retain the old numeric value in it.
- `survey_engagement_answer_revisions`: immutable integer value and contract/question identity; tenant/user/window/cycle/lineage; acceptance permission revision; `direct_explicit_answer` proof kind; copied prompt delivery identity/time and inbound receipt identity/time; acceptance timestamp; monotonic suppression/expiry metadata. No private utterance, summary or model/rubric score fields.

Use explicit short composite FK names, integer/range checks, unique source-event identity and guards against identity/value/proof mutation. Enforce event-to-subject, revision-to-event, window-to-tenant/subject, lineage-to-tenant/subject/cycle/question and contract-to-definition/three distinct question identities; matching individually valid UUIDs is insufficient. Receipt copies must survive private-message cleanup; do not attach cascading private-message FKs. User/tenant erasure must still cascade safely. DB guards independently validate structural identity, receipts, contract, permission and lifecycle bounds. TypeScript's deterministic parser owns literal interpretation; do not pretend DB constraints semantically interpret private text.

Serialize acceptance on the existing RPT-02 subject advisory lock, then reread current permissions, participation and proof before insertion. Snapshot source/probe metadata in the same transaction. A valid pre-stop receipt may commit after a transfer/deactivation, in its frozen origin only. Full or matching lineage withdrawal always wins over future acceptance, even for an older receipt. Denied/invalid capture is benign to private coaching; infrastructure failure remains a visible retryable capture failure.

Order revisions by the exact stored PostgreSQL tuple `(answer_received_at, inbound_receipt_id)`; equal timestamps use PostgreSQL UUID order as an explicit deterministic tie-break, not a claim of finer physical arrival time. Do not compare truncated JavaScript timestamps or processing/insertion order. A current pointer, if used, is only a projection and cannot move backward. Keep immutable revisions so a later answer does not destroy the pre-cutoff answer. RPT-05 will implement the actual as-of report query and settlement barrier.

Backlog coverage for this response type comes only from current allowed accepted ledger answers, with matching question/contract version. Use the existing backlog covered marker as a recoverable projection. Do not create/update legacy assessments, group confirmation state or pilot group scores. Three distinct accepted questions are one complete respondent; RPT-01 remains the metric kernel, without per-person rounding or a legacy mean-times-ten conversion. This story does not wire any report renderer to the new source.

## 5. Rights, retention and recovery

Extend `survey_report_question_lineages` with an explicit answer-kind/contract discriminator. Preserve existing IDs, unique stable topic identity and negative exclusions. Keep real open-ended rubric metadata for that kind; numeric kind validates the declared three-question contract without a fake rubric. Extend both the resolver and identity guards in additive migrations. Numeric corrections remain in the same lineage.

Extend the existing withdrawal transaction under subject-before-working ordering: record its negative permission/revision, suppress matching numeric revisions/events and close only affected numeric collection state. Partial withdrawal keeps denominator/unrelated questions; full withdrawal applies to all numeric history. Do not rewrite delivered pilot snapshots or clear attempted/unknown delivery evidence. Existing open-ended behavior and exact original displayed bundle identity remain intact.

Apply the existing typed analytical/memory retention duration to numeric content, anchored to the original answer receipt; processing/replay cannot restart its lifetime. Under the subject lock, reread current typed tenant retention and test first acceptance against the original receipt and current database clock. Even a never-captured source that still exists under a longer message-retention policy must not create an already-expired scalar: record only terminal content-free `expired` state. Numeric cleanup shares that subject boundary and rechecks state, so capture prepared before cleanup cannot insert forbidden content afterward. No new duration or long-lived audit payload containing a score. Analytical cleanup deletes numeric content/proof and leaves only required negative/replay tombstones. Private-message cleanup after acceptance must not invalidate permanent proof. Never fall back to an older suppressed/expired answer to restore eligibility. Subject erasure removes numeric state and permissible content-free identity without FK deadlock. Intentional typed expiry, subject erasure or source deletion is terminal ineligibility, not endless operational retry. Unexpected loss of otherwise-required timely proof is a distinct retryable operational state; never fabricate a value or silently count that failure as ordinary nonparticipation. Later report settlement owns recovery decisions.

## 6. File ownership map for implementation

| Concern | Concrete files/actions |
| --- | --- |
| Pure invariant and boundary types | New `packages/domain/src/survey/engagement-answer.ts` and test; domain index; new `packages/contracts/src/pulse-engagement.ts` and test/index; `packages/application/src/types/records.ts` discriminator |
| Catalog/policy compatibility | `scripts/activate-v2-scoring-policy.ts` and its test/integration test; `packages/application/src/utils/question-scoring-policy.ts` and test; `apps/worker/src/survey/repositories/question-insight.repository.ts` preflight; forward replacement of 0047 guard; `survey.repository.ts` missing-opening guard and test; legacy installer replay regression |
| Catalog and permanent schema | New `scripts/prepare-report-engagement-definition.ts` and test; new `packages/database/src/schema/survey-engagement-answers.ts`; extend `schema/survey-report-scopes.ts`; both database schema/export indexes; generated forward SQL/meta after 0059 |
| Capture application/adapter | New `packages/application/src/ports/engagement-answer.repository.port.ts`; new `use-cases/capture-engagement-answer.use-case.ts` and test/index; new `apps/worker/src/survey/repositories/engagement-answer.repository.ts` |
| Actual entry/recovery | `apps/worker/src/conversation/conversation.processor.ts` and test; `survey/survey-evidence.processor.ts` and test; `survey/survey.module.ts`; application `survey-evidence.use-case.ts` and test |
| Probe and coverage | Application `ports/ai-provider.port.ts`, `services/pulse-backlog.service.ts` and test, `use-cases/conversation-orchestrator.ts` and test, `proactive-check-in.use-case.ts` and test; worker `survey.repository.ts` and test; AI `prompts/respond.ts`, `openai-provider.ts` and relevant tests |
| Rights and retention | Worker `reporting-permission.repository.ts`, `retention/retention.repository.ts`; existing retention integration tests; new `packages/database/src/__tests__/engagement-answers.integration.test.ts`; existing `pulse-report-scopes.integration.test.ts` regressions |
| Evidence | RPT-03 spec/design, implementation plan, `docs/agent-task-log.md`, relevant failure log |

## 7. Verification and acceptance matrix

All fixtures synthetic; no model/Slack calls, public payloads, live opening or non-local migration. Build dependencies first; never run dist-cleaning builds/typechecks concurrently with consumer tests.

1. 1/7/10 and `8/10` accepted; all invalid/ambiguous cases above rejected. A model-provided number without a literal answer is ignored. Open-ended confirmation/readiness stays unchanged.
2. Exact delivered probe and scalar proof survive private-text purge. A prompt delivered after the source receipt never rebinds that older answer, and delayed live/backfill resolve the same original question. Wrong tenant/user/window/question/version, unsupported contract, pending/unknown prompt, pre-opening and cycle-end receipts fail closed; direct SQL structural bypass is rejected.
3. Live normal/proactive probe -> actual ConversationProcessor -> permanent row -> backlog coverage works. Generation/evaluator/finalizer failure and coalescing cannot lose the literal receipt. Replay and backfill produce one answer, no legacy assessment/group write.
4. Reverse/concurrent processing produces identical revision order; exact timestamp ties are deterministic; microsecond precision is preserved. A post-cutoff revision leaves an earlier revision available for future as-of selection. This is source history proof, not completed RPT-05 acceptance.
5. First capture versus analytical cleanup in both lock orders, including message retention longer than analytical retention and a prepared capture waiting on cleanup. Expired/deleted source is terminal; unexpected proof loss is operational. Native stop/full/partial withdrawal races in both lock orders; original affiliation retained for timely answers; unrelated topics remain available. Replay, correction, expiry and cleanup cannot resurrect a forbidden answer.
6. Fresh migration plus unchanged legacy/default lookup, inactive preparation replay/conflict, explicit local activation/opening, active new catalog with missing opening creates no window/binding/legacy cohort, canonical-12-plus-declared-3 preparation/preflight, unchanged legacy installer replay, immutable new catalog and no historical numeric conversion. Retention/erasure and delivered/attempted snapshot invariance.
7. Run domain/contracts/application/AI tests, affected worker tests and no-MAF regression; full database integration on fresh isolated local PostgreSQL, explicit deterministic queue variant where affected; typecheck/lint; two independent BMad reviews and final root harness. Model/render/live acceptance stays separate.

## 8. Local execution evidence (2026-10-25)

The user approved the specification and this design. The local implementation is complete; frozen intent is unchanged. Permanent acceptance/capture clocks and positive-delivery proof are database-authored. Migration 0073 shares the NULL-aware delivery ambiguity rule across the adapter, independent SQL guard and erasure, including historical rows without fabricated clocks.

All eight review findings and the historical unknown-attempt addendum passed two independent correction rechecks. Database 103/103 (52 RPT-03), application 1,252, mocked AI 274, worker 445, explicit queue 31/31 and backfill 1/1 passed. The broad worker run skips 44 opt-in cases; separately enabled queue/backfill evidence is recorded in `runs/rpt-03/implementation-verification-receipt.json`. Final full harness: `runs/harness/receipt-1792923081548-bc98a337.json` (passed). Earlier applied SQL hashes, RPT-01/02 specifications and design were preserved.

This is local collection/proof acceptance only. Report readers, calendars/cutoffs, settlement, language, narrative, snapshots, delivery and product activation retain their separate specifications and acceptance boundaries.
