---
title: 'RPT-LANG: Company language and independent personal conversation'
type: 'feature'
created: '2026-10-29'
status: 'done'
review_loop_iteration: 0
baseline_commit: 237d7075ff08f262ccf3cbe2bf7c36cb390d204e
context:
  - '{project-root}/_bmad-output/planning-artifacts/pulse-check-reports/RPT-LANG-DESIGN.md'
---

<frozen-after-approval reason="human-owned intent - do not modify unless human renegotiates">

## Intent

**Problem:** Reports support company language, but canonical analytics lack language provenance, admin screens mix English/Russian, and personal conversation is forced to English.

**Approach:** Implement one explicit language boundary: company-language analytical/admin output and independent durable personal preference. Reuse RPT-04 locale authority and preserve RPT-03/05/06/07 evidence semantics.

## Boundaries & Constraints

**Always:** Follow the linked design. Preserve exact confirmed meaning, scoring, machine keys, private originals, rights, retention and delivery proofs. Accept canonical ICU-supported BCP47 without a fixed language allowlist. Store separate prose provenance. Language-only work never rescores or overwrites historical canonical text. Every copied rendition inherits source authorization/expiry.

**Ask First:** Production/activation, live model/Slack acceptance, historical bulk conversion, commits/push/PR, or changes to collection/rights/scoring semantics.

**Never:** Translate private originals in place; silently label English as another language; generate translations during admin GET or failure recovery; treat fixtures as multilingual quality acceptance; revive MAF.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
| --- | --- | --- | --- |
| Independent language | German company, Ukrainian employee | German analytics/admin/report; Ukrainian personal text | Missing accepted resource is typed unavailable |
| Preference | Explicit choice; later number, agreement or quote | Keep explicit choice and original numeric evidence | Stale/replayed proposals cannot overwrite newer preference |
| History/config edit | Legacy unknown-language text; company changes locale | Original stays immutable; separate safe display rendition | Missing rendition shows pending, never claims localized completion |
| Exact forms | Previously delivered English probe; preference changes | Answer binds original delivered form/hash | Unreviewed translation cannot become a probe |
| Lifetime | Source withdrawn, expired or deleted | All derived display text invalidated/purged | No older source fallback or retention extension |

</frozen-after-approval>

## Code Map

- `packages/contracts/src/pulse-report-calendar.ts`, `ai.ts`, `pulse-engagement.ts` — locale, classifier and exact-form boundaries.
- `packages/application/src/use-cases/finalize-question-insight.use-case.ts`, `utils/language-policy.ts` — analytical generation and personal selection.
- `apps/worker/src/conversation/repositories/question-insight.repository.ts`, `conversation.repository.ts` — source/CAS/provenance ownership.
- `apps/api/src/admin/v2-pilot.read-model.ts`, `apps/dashboard/src/app/lib.ts` — actual current dashboard consumers.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/pulse-language.ts`, `ai.ts`, `admin-v2-pilot*.ts`, `admin-user-insights.ts`; application ports — define strict resources, proposals and locale/prose read metadata.
- [x] `packages/database/src/schema/survey-insight-v2.ts`, `schema/index.ts`, `schema/pulse-language.ts`, forward migrations after 0094 — persist revision-bound language capture, separate scoring/prose provenance, resources/forms and expiring safe renditions; preserve legacy unknowns.
- [x] `packages/application/src/use-cases/prepare-pulse-language.use-case.ts`, `prepare-analytical-rendition.use-case.ts` and mapped adapters in design §9 — bounded preparation/review, strict install/read and full source-lifetime closure; no model calls from reads.
- [x] `finalize-question-insight.use-case.ts`, `utils/question-deidentification-policy.ts`, worker `conversation/ai.service.ts`, `question-insight.repository.ts`, AI `prompts/question-insight-finalization.ts` — canonical language, privacy-safe fallback and prose provenance without language-driven rescoring.
- [x] `utils/language-policy.ts`, `use-cases/conversation-orchestrator.ts`, proactive/follow-up use cases and repository ports/adapters; AI classifier/respond prompts — validated proposal from existing classification call, durable preference CAS and consistent per-turn language.
- [x] `pulse-engagement.ts`, worker `survey/repositories/engagement-answer.repository.ts`, `onboarding/onboarding-copy.ts`, `utils/reporting-disclosure.ts`, `utils/content-filter-recovery.ts`, legacy group-confirmation prompt — reviewed exact forms, operational/onboarding/disclosure copy and actual shown-form receipt compatibility.
- [x] API `hierarchy/company-setup-ui.controller.ts`, `company-setup-read.service.ts`, `admin/user-insights.controller.ts`, `admin/v2-pilot.read-model.ts`; dashboard five active routes/shared shell — localize full visible copy, pure tenant-scoped locale reads, legacy tenant-binding fix and safe-summary rendition/status.
- [x] Colocated contract/application/provider/API tests, DB integration and dashboard fixtures — cover the matrix, language ordering, source isolation, erasure, unchanged arithmetic/receipts and all active UI routes; complete independent BMad review and final harness.

**Acceptance Criteria:**
- Given mixed-language confirmed evidence, when finalization/display/reporting run, then company and personal languages remain independent with unchanged scores, keys and original message bytes.
- Given explicit/inferred preference proposals, when out-of-order, ambiguous or replayed turns execute, then durable precedence/CAS and committed outbound bytes remain correct without another classifier call.
- Given legacy records or changed company language, when admin reads execute, then provenance is truthful and localized display never mutates canonical source, grants access or bypasses lifetime checks.
- Given unavailable resources or invalid exact forms, when generation/rendering runs, then typed pending/unavailable prevents falsely localized output and preserves source receipt semantics.
- Given a finalized implementation, when independent review, affected deterministic suites and preservation/harness run, then every task passes; live semantic/model/Slack acceptance remains separately gated.

## Spec Change Log

## Design Notes

PR-021; FR-028/029; AC-28. The linked design fixes exact preference precedence, bounded resource preparation, nullable legacy metadata, immutable numeric/disclosure forms, safe historical projections and all five dashboard routes. Local debug controls remain excluded. No new sprint status is invented.

## Verification

- Rebuild changed workspace packages before focused consumer tests; run package plus affected API/worker suites and new migrated preference/form/rendition lifetime tests.
- `pnpm --filter @entalent/dashboard typecheck` and `pnpm --filter @entalent/dashboard build`; deterministic en/de/uk all-page/setup fixtures.
- `pnpm typecheck`, `pnpm lint`; local migration validation and independent BMad review.
- `pnpm harness:check -- --base 237d7075ff08f262ccf3cbe2bf7c36cb390d204e` — final structured deterministic receipt; no provider egress or retired test chain.

## Step4 corrective checklist

Initial blind and edge review identified seven implementation patches; later rechecks closed R8 onboarding composition and R9 manual-schema verification. Approved frozen intent remains unchanged. Root triage: `runs/rpt-lang/review/triage.json`.

- [x] R1 medium, conditional composition invariant: preserve exact approved form/disclosure bytes in actual composed and persisted outbound bodies, with both proof contracts; existing disclosure gates remain unchanged and a normal-load outage was not reproduced.
- [x] R2 medium: retain pending explicit preference across newer inference; preserve source clocks and newer-explicit replacement.
- [x] R3 high: visible authenticated unavailable state and authorized language recovery with unchanged CSRF/session.
- [x] R4 medium: localize lifecycle/count presentation through full templates while preserving enum/request values.
- [x] R5 medium: resource reads reuse transaction context and complete on a constrained single-connection pool.
- [x] R6 high: expired/deleted native watermark cannot resurrect analytical source/copies; forward-only SQL and explicit legacy compatibility.
- [x] R7 medium: actual Team Signals render localized pending/unavailable status while retaining score/provenance.
- [x] R8 high, reachable R1 follow-up: actual substantive team-lead onboarding acknowledgment remains before the final approved numeric form; preserve real state transition, existing gates, acknowledgment and both delivery hashes. Real undecided/deferred OnboardingService-to-save regressions pass.
- [x] R9 medium: align the manual bundle schema with nullable language/score-cache fields; preserve legacy nulls and verify the complete official worker selection.

Correction acceptance requires meaningful failing/passing regressions, affected deterministic checks, source/migration preservation, both independent rechecks and the coordinator's final official harness. Live semantic/Slack/production acceptance remains separately gated.

Corrective functional evidence:24 migrated language cases,52 RPT03 cases,9 executable setup cases and29 dashboard cases pass. Application1328, complete official worker223, global types24 plus policy types, lint24 and dashboard production build pass. Both independent final rechecks are clear. Fresh-chain official harness passes all243 database integration cases without skips; all99 ordered migration hashes/clocks match. Applied SQL and approved intent remain unchanged.


## Local completion evidence — 2026-10-29

Completion criteria met: all execution tasks and R1–R9 corrections, two independent final source rechecks, full affected deterministic checks, actual fresh0000–0098 migration chain and ledger, final official harness, and preserved unrelated source/approved intent. Official receipt: `runs/harness/receipt-1793288712151-c9399e5e.json`. Exact reviewed-runtime freeze: `runs/rpt-lang/review/correction-source-freeze-r9-final.json`; final editorial/preservation receipts distinguish closure documents from tested runtime. Failed attempt1 remains retained with its failed status.

Remaining:0% for local RPT-LANG. RPT-08, multilingual semantic/model/privacy-quality evaluation, real Slack acceptance and production activation remain separate. Model evaluations were intentionally not run; fixtures establish routing/constraints only. No commit, push or PR was created. Story key is unset; sprint synchronization is skipped.

## Suggested Review Order

**Language ownership**

- Keep company-language generation separate from scoring and immutable employee evidence.
  [finalize-question-insight.use-case.ts:144](../../packages/application/src/use-cases/finalize-question-insight.use-case.ts#L144)

- Apply independent personal preference precedence without a second classifier completion.
  [language-policy.ts:4](../../packages/application/src/utils/language-policy.ts#L4)

- Persist trusted preference ordering while sharing the resource-read transaction.
  [conversation.repository.ts:24](../../apps/worker/src/conversation/repositories/conversation.repository.ts#L24)

**Exact bodies and restricted-copy lifetime**

- Keep authorized acknowledgments before the exact accepted final question.
  [reporting-disclosure.ts:65](../../packages/application/src/utils/reporting-disclosure.ts#L65)

- Preserve onboarding transitions and delivery proofs through final-body composition.
  [conversation-orchestrator.ts:1330](../../packages/application/src/use-cases/conversation-orchestrator.ts#L1330)

- Prevent deleted native dependencies from reopening expired source authority.
  [0097_fair_ezekiel_stane.sql:65](../../packages/database/migrations/0097_fair_ezekiel_stane.sql#L65)

- Require positive immutable legacy-opening proof rather than inferred absence.
  [0098_pulse-language-positive-legacy.sql:2](../../packages/database/migrations/0098_pulse-language-positive-legacy.sql#L2)

- Revalidate source permission, hash and expiry when serving separate renditions.
  [analytical-rendition.repository.ts:10](../../apps/worker/src/survey/repositories/analytical-rendition.repository.ts#L10)

**Authenticated readers and visible states**

- Read tenant locale without creating configuration revisions.
  [company-language-read.service.ts:9](../../apps/api/src/admin/company-language-read.service.ts#L9)

- Keep authenticated recovery visible with truthful document language and unchanged CSRF protection.
  [company-setup-ui.controller.ts:96](../../apps/api/src/hierarchy/company-setup-ui.controller.ts#L96)

- Show translation status explicitly while preserving signal scores and provenance.
  [page.tsx:20](../../apps/dashboard/src/app/pulse/page.tsx#L20)

**Supporting contracts and executable regressions**

- Validate accepted copy resources and stable interpolation contracts.
  [pulse-language.ts:20](../../packages/contracts/src/pulse-language.ts#L20)

- Exercise actual onboarding transitions through saved text and both delivery hashes.
  [pulse-language.integration.test.ts:142](../../packages/database/src/__tests__/pulse-language.integration.test.ts#L142)

- Preserve nullable legacy defaults in full-row manual-schema consumers.
  [question-insight.repository.bundle.integration.test.ts:111](../../apps/worker/src/survey/repositories/question-insight.repository.bundle.integration.test.ts#L111)

- Verify actual pending and unavailable Team Signals across company locales.
  [company-language.test.tsx:36](../../apps/dashboard/src/app/company-language.test.tsx#L36)
