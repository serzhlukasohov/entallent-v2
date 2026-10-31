# Pulse Check Reports — Implementation Plan

Updated: 2026-10-30. Status: RPT-01, RPT-02, RPT-03 and RPT-04 completed locally after approval, with independent review and deterministic verification. RPT-05 is also completed locally after corrective regressions, two independent rechecks and the final harness. RPT-06 is also completed locally with independent rechecks and deterministic harness evidence. RPT-07 completed locally on 2026-10-29 after independent review, the explicit 0093 exception, fresh-chain verification and final harness. RPT-LANG also completed locally after two final rechecks, fresh99-migration verification and the official harness. RPT-08 required local scope is complete after reviewed final8 and the default official harness; broader local legacy verification retains an estimated5% remainder. External acceptance and activation remain outstanding.

## Authority and acceptance boundary

Implement [PRODUCT-REQUIREMENTS.md](PRODUCT-REQUIREMENTS.md), [FUNCTIONAL-REQUIREMENTS.md](FUNCTIONAL-REQUIREMENTS.md), [ACCEPTANCE-SCENARIOS.md](ACCEPTANCE-SCENARIOS.md), and [SLACK-PRESENTATION.md](SLACK-PRESENTATION.md) from PR #32, baseline `237d7075ff08f262ccf3cbe2bf7c36cb390d204e`. Keep the existing Insight Analysis confirmation/scoring/privacy contract except where this package explicitly supersedes reporting rules. Archived MAF code is outside the work.

The product outcome is all four audience/phase variants and their insufficient-data outcomes. Foundation stories do not constitute delivered reporting. Product acceptance requires the actual authorized source-to-snapshot-to-Slack path, with arithmetic, persistence, queue, privacy, narrative, localization, and presentation evidence distinguished from one another. Deployment, production configuration, model egress, and external Slack delivery remain separate human boundaries.

## Verified brownfield assessment

Read-only investigations used CodeGraph in the original indexed checkout, followed by source verification in the PR #32 worktree. No live database state was inspected.

| Area | Existing foundation | Change needed |
| --- | --- | --- |
| Open-ended metrics | `select-v2-cohort-report-inputs.use-case.ts` enforces scoped 3/3 inputs; `build-v2-index-report.ts` already averages complete contributors without intermediate rounding | Reuse mathematical behavior, separate the new canonical policy from pilot text, validate 0–100 integer inputs, add audience gates and raw category/direction rules |
| Quantitative Engagement | `survey-evidence.use-case.ts` binds explicit numeric answers to probes; assessment storage exists | Existing `numeric_0_10` contract admits zero/decimals; `group-scoring.ts` rounds person means. Add approved 1–10 integer collection/versioning and a permanent receipt-backed raw-answer source. Do not reinterpret old data or infer ratings |
| Hierarchy | `schema/organization.ts` has org unit Manager, team Lead, and placements | Cohorts and pilot snapshots reference legacy `teams`; capture role-aware audience scopes and person/affiliation membership durably, rather than resolving current hierarchy at report time |
| Allowed insights | V2 permanent insights, policy-bound windows, frozen rosters, privacy decisions and withdrawal timestamps | Reader currently filters `users.status = active`; retain permitted pre-departure contributions while excluding new old-team collection, deletion, expiry and withdrawal |
| Permission changes | V2 `withdrawnAt` and content-free retention provenance exist | Define typed full/partial reporting exclusions and topic lineage; onboarding participation is not reporting consent |
| Calendar | `WorkCalendarSchema`, `tenant_work_calendars`, and company setup service validate timezone/weekdays/workEnd | Add holidays/date exceptions, durable final due date/calendar revision, distinct cutoff, settlement barrier, and explicit invalid/no-working-day outcomes |
| Language | `tenants.locale` defaults to English | Expose validated company configuration, distinguish personal chat language, and carry canonical text/report language metadata |
| Delivery | V2 processor persists snapshots, rechecks bindings, records receipts and blocks ambiguous retries | Introduce product audience identity/cutoff/language/provenance and bounded multi-message receipts; retain delivery safety while replacing pilot all-four-group and changed-contributor gates |

## Dependency sequence

Each row needs its own actionable specification and BMad review before implementation. RPT-01 has an approved, completed foundation specification. RPT-02 and RPT-03 have approved, locally completed execution specifications and designs. RPT-04 also has an approved, locally completed specification and design. RPT-05 has an approved and locally completed execution specification and required design. RPT-06 also has an approved and locally completed execution specification and required design; RPT-07 also has an approved and locally completed execution specification and required engineering design; RPT-LANG has an approved, locally completed execution specification and required design; RPT-08 has an approved execution specification, required design and all33 traceability matrix; its independent review identified eleven implementation patches and final acceptance remains open. These are work-package identifiers, not invented sprint/epic completion statuses.

| ID | Deliverable and concrete surfaces | Depends on | Requirement coverage and verification |
| --- | --- | --- | --- |
| RPT-01 | Canonical metric/eligibility kernel in `packages/application/src/use-cases/calculate-pulse-report-metrics.ts`, tests, package export | Approved arithmetic requirements | FR-009–011, numeric direction part of FR-013, threshold parts of FR-014/019/020; deterministic examples, raw precision, invalid/missing input and duplicate contributors |
| RPT-02 | Frozen audience scope and permission contracts; forward schema/migrations under `packages/database`; cycle-opening and org lifecycle adapters under worker survey/API hierarchy | RPT-01 for projection checks | FR-004–007/014/020/036, AC-05–08/20/33; migrated fixtures for Manager deduplication, own-TL exclusion, transfer cutoff, full versus partial withdrawal, old-topic lineage, tenant and role isolation |
| RPT-03 | Versioned explicit Engagement collection and receipt-backed permanent quantitative answer storage; contracts, TS evidence/orchestration, worker persistence and retention | RPT-02 affiliations/permission semantics | FR-001–003/008/010/017/036, AC-01–04/09–11; source proof, 1–10 integers, unchanged historical definitions, score-before-report isolation. Extend confirmation provenance before considering this source ready |
| RPT-04 | Company calendar/locale configuration and versioned final formation; contracts, API setup, schema and application calendar resolver | RPT-02 scope identity | FR-016/028/029 configuration portion, AC-16/28; configured workEnd, holidays, DST, missing/invalid/no-working-day errors. Freeze calendar semantics at formation; define pre-formation edits in this specification |
| RPT-LANG | Cross-product language prerequisite: canonical analytical generation/storage, admin UI and independent personal chat language | RPT-04 locale contract; preserve RPT-03 source proofs | FR-028/029 and PR-021 beyond report rendering, AC-28; owned surfaces and separate acceptance below. Report locale metadata alone does not complete this dependency |
| RPT-05 | Allowed-source reader, baseline history and timely-input settlement; worker repositories plus application selection, durable progress/recovery and new report cutoff | RPT-02/03/04 | FR-001/003/005–008/012/013/017–019/036, AC-06–10/13/14/17–19/33; only permanent allowed inputs, delayed finalization included, late confirmation excluded, no false insufficient notice, no source-conversation reads |
| RPT-06 | Four audience builders, bounded narrative generation/validation and company-language Block Kit serialization; application report port, AI adapter, Slack adapter | RPT-01/05 | FR-021–032, AC-10/12/21–29; supported cause/focus/action evaluations, 0/1/3 actions, no TL numeric leakage, localized accessible text, current Slack limits. Eligible overall remains buildable when every team is insufficient. Define multi-message packaging here without clipping teams |
| RPT-07 | Automatic threshold/scheduled formation, immutable product snapshots and per-send delivery claims/receipts; worker survey processor/scheduler and new snapshot persistence | RPT-02/04/05/06 | FR-015/018/019/033–035, AC-15–18/30–32; concurrency, crash recovery, changed inputs/recipient/workspace, ambiguous provider outcome and explicit reconciliation. Do not rewrite pilot snapshots |
| RPT-08 | Verified required connected LOCAL acceptance and conservative pilot-readiness bundle; actual native source/queue/formation/delivery fixtures, guarded0091→0098 migration compatibility, diagnostics and four-variant previews | RPT-01–07 and RPT-LANG, locally complete | All33 ACs traced with separate local/semantic/client/public evidence; explicitly test eligible finals after1–4 changed people. Public employee withdrawal ingress and production native wiring are mandatory blocked follow-up implementation gates; separately authorized model/native Slack/production acceptance precedes activation. |

RPT-02/03/04 require forward migrations, with generated metadata and local migrated validation. Production migration execution is not part of preparing or reviewing these stories. Scope changes must not be hidden inside an arithmetic or formatting patch.

### RPT-LANG ownership and activation prerequisite

This is an explicit cross-product dependency requiring its own specification; it is not silently included in RPT-01 or declared satisfied by translated report headings. New report activation requires acceptance of this dependency, or an explicit human decision to narrow the cross-product rollout boundary.

- Analytical generation/persistence: `finalize-question-insight.use-case.ts`, worker `conversation/ai.service.ts`, `question-insight.repository.ts`, AI `prompts/question-insight-finalization.ts`, and `schema/survey-insight-v2.ts`. Define canonical-language storage/metadata while preserving confirmed meaning, scoring, privacy acceptance and receipt provenance. Do not translate or overwrite original private messages; historical canonical-record treatment needs an explicit compatible migration design.
- Company/admin configuration and UI: `schema/tenants.ts`, API `hierarchy/company-setup-ui.controller.ts`, `company-setup-read.service.ts`, `admin/user-insights.controller.ts`, and dashboard `app/pulse/page.tsx` / `app/pulse/[userId]/page.tsx`. Configure one authoritative validated locale, localize canonical app text, and preserve tenant/admin boundaries.
- Personal conversation: application `utils/language-policy.ts`, conversation orchestration and AI `prompts/respond.ts`. Replace the English-only restriction through an independently verified language policy; personal language must not override company report language. Do not claim equal model quality across languages from configuration tests.
- Separate verification: deterministic locale/default/metadata tests; confirmation/scoring/privacy regressions; admin/dashboard checks; independently approved multilingual model evaluation for meaning preservation and personal-language behavior. AC-28 must exercise company German with personal Ukrainian and mixed-language source insights. Report-only rendering tests cannot establish this dependency.

## First execution specification

Start with [RPT-01 specification](../../implementation-artifacts/spec-rpt-01-canonical-report-metrics.md). It defines internal calculation contracts and tests only. RPT-05 and RPT-06 must consume it before product cutover; an exported helper alone is not reporting acceptance.

Completed locally: [RPT-02 specification](../../implementation-artifacts/spec-rpt-02-frozen-report-scopes.md) and its required [engineering design](RPT-02-DESIGN.md). This introduces no live opening, production migration or public rights route.

RPT-01 deliberately leaves the gated pilot builder and snapshots unchanged. It does not alter collection scale or deliver new reports. The older Engagement specification and pilot report-input specification remain historical context, with their conflicting 0–10 scale, periodEnd and denominator defaults superseded only through explicit later cutover work.

## Verification and completion criteria

- Every requirement and acceptance scenario is assigned above; a future per-story tracker must distinguish partial coverage from executed acceptance.
- Before each code change, retrieve relevant harness failures. Preserve command diagnostics in ignored artifacts when a gate fails; never treat truncated output as proof.
- In a fresh worktree, install offline and build sibling packages before Vitest. After edits, rebuild changed package outputs before testing consumers.
- RPT-01: focused arithmetic tests, existing builder/selector tests, application typecheck/lint, then required harness receipt. No live model, database or Slack call is necessary for pure arithmetic.
- Persistence/lifecycle stories: fresh isolated migrated PostgreSQL and named isolated Redis target, affected API/worker tests, then harness. Avoid a shared database whose migration watermark may skip renumbered entries.
- Connector payloads require `pnpm harness:preflight` and separate authorization for external messages/model egress. No retired MAF smoke is an acceptance route.
- A story is complete only after its tests, BMad review findings, task/failure logs and structured harness receipt are recorded. Full reporting remains incomplete until all four real variants satisfy their acceptance paths.

## Worktree tooling

Planning self-review checked source accuracy, dependency coverage and the first specification. Corrections bind eligibility modes to metric kinds, distinguish raw internal calculations from publication permission, assign the all-teams-insufficient Manager case explicitly, and give cross-product language its own activation prerequisite. Requirement assignment is not executed acceptance. The user approved RPT-01; its foundation implementation passed focused tests and two independent BMad reviews. This does not approve or complete subsequent stories.

Implementation tree: `/private/tmp/entalent-pulse-check-reports`, branch `codex/pulse-check-reports`; original dirty checkout remains untouched. Local BMad `_bmad/` runtime and `.agents/skills/` are ignored installation assets absent from the new worktree. Use the already installed skills/config resolvers at `/Users/serzh/Documents/enTalentNew`, while resolving artifact destinations to this implementation tree. Do not reinstall BMad or generate replacement configuration to compensate.

Use original-checkout CodeGraph only for navigation; verify source against this worktree before deriving decisions because its branch differs. This plan records static findings, not production or CI status.

## Current execution boundary

RPT-01/02/03 are done locally under their approved specifications. RPT-03 prepares an inactive 1–10 integer catalog, captures literal answers independently of model work, preserves permanent receipt history, and applies negative permissions, expiry and erasure. No active/default catalog or historical 0–10 data was converted.

RPT-03 verification: database 103/103 (52 native RPT-03), application 1,252, mocked AI 274, worker 445; 44 opt-in worker cases skipped in the broad run, with explicit queue 31/31 and backfill 1/1 verified separately. Workspace typecheck/lint and the final isolated-database full harness passed in `runs/harness/receipt-1792923081548-bc98a337.json`. Two independent BMad correction reviews are clear after all eight findings and the historical NULL-clock addendum were addressed. Applied migration hashes and RPT-01/02 preservation checks passed.

[RPT-04 specification](../../implementation-artifacts/spec-rpt-04-company-calendar-and-final-formation.md) and its [engineering design](RPT-04-DESIGN.md) are done locally after `A` approval on 2026-10-26. Calendar/locale saves preserve staff ownership, enforce CAS and capture source/revision/audit/pending plans atomically. Native cycles share an immutable actual first-start context and DB cutoff. Collection bounds remain unchanged. Two independent correction rechecks are clear; resolver 15, UI fixtures 4, native configuration/formation 22 and full database integration 125 passed. Final workspace typecheck/lint and baseline harness passed in `runs/harness/receipt-1793005962780-0669b22e.json`; preservation evidence is `runs/rpt-04/final-preservation-audit.json`. Five browser scenarios used actual setup HTML/JS with synthetic local responses; actual backend evidence is separate. [RPT-05 readers/settlement](../../implementation-artifacts/spec-rpt-05-allowed-inputs-and-settlement.md), with its [required design](RPT-05-DESIGN.md), is also done locally after approval on 2026-10-26. Receipt fencing, independent durable progress, permanent-only allowed selection, current rights/retention invalidation, native recovery ownership and the guarded baseline seam are implemented. Eight independent-review findings and the corrective delivered-probe/backfill/inline-recovery edges are closed. Current gates: DB164, worker323, API337, application569, contracts95 and migrated/queue54; zero skips. Workspace typecheck/lint24/24, five builds, both v3 rechecks, preservation and official full harness `runs/harness/receipt-1793065369178-50365fe6.json` passed. Official completed-final production remains structurally blocked until RPT-07 supplies a real snapshot FK.

RPT-LANG, RPT-07 snapshots/delivery, RPT-08 end-to-end acceptance and verified public rights ingress remain outstanding. Full reporting has not been delivered. No production migration, activation, external model call or Slack delivery occurred; no commit, push or PR was created.

## RPT-06 local acceptance

The [RPT-06 specification](../../implementation-artifacts/spec-rpt-06-report-assembly-and-slack-presentation.md) and [required design](RPT-06-DESIGN.md) are done locally after approval on 2026-10-28, including complete-intermediate3/3 selection. The callable read/build path prepares coherent frozen scopes, projects safe evidence, bounds dedicated narrative/review/localization operations, validates four audience variants, rechecks current/historical authorization, and produces complete literal immutable Slack packages. No scheduler, snapshot/history-completion producer or sending is enabled.

All thirty deterministic boundaries passed. Current source inventory contains34 paths; all215 starting dirty files were preserved outside declared changes, all83 applied migrations/journal entries and prior specifications remain unchanged. Both independent v4 rechecks are clear after five implementation corrections. Two pre-existing legacy fixture defects were corrected without changing runtime behavior or target guards. Worker486 tests passed, with four explicitly guarded unrelated cases skipped; database178, application1178, AI284, contracts102, Slack38 and offline5 passed, along with workspace builds/typecheck/lint and ten non-MAF script checks. Official pinned-baseline harness passed in `runs/harness/receipt-1793182108438-a2963c20.json`. Final evidence and preservation are under `runs/rpt-06/`.

RPT-LANG and RPT-07/08 remain activation prerequisites. Actual semantic/multilingual model quality, native Slack desktop/mobile acceptance and optional browser visual inspection remain unverified; synthetic fixtures and HTML previews are not release acceptance. No commit, push, PR, production operation, external model call or Slack send occurred.


## RPT-07 planning checkpoint (historical, superseded by completion below)

[Draft specification](../../implementation-artifacts/spec-rpt-07-automatic-formation-snapshots-and-delivery.md) and [required design](RPT-07-DESIGN.md) define automatic native obligations, immutable full snapshots, real completed-final support, per-part claims/receipts and explicit reconciliation. Source investigations and planning checks are under `runs/rpt-07/`. These are planning artifacts only; no RPT-07 runtime, migration, connector, provider or delivery acceptance is claimed.

The proposal explicitly asks approval for a bounded one-part publication fence, a narrow extension of RPT-05's no-transport-lock design rule; write-ahead ownership commits before the network transaction. It preserves assembly-versus-delivery completion and forbids automatic replacement of canceled/attempted snapshots. Await BMad Step 2 `[A] Approve` or `[E] Edit` before runtime implementation. RPT-LANG, RPT-07 implementation, RPT-08 and separately authorized live acceptance remain outstanding.

RPT-07 execution authorized by human `А` on 2026-10-28. Approved spec entered `in-progress`; the frozen intent is preserved in `runs/rpt-07/approved-frozen-intent.txt`. BMad Step 3 is executing sequentially in the same authorized worktree. This approval includes the explicit bounded publication-fence design; it does not authorize production, external model/Slack calls, commit/push or activation.

## RPT-07 current-source verification checkpoint

RPT-07 completed locally on 2026-10-29. Automatic native obligations, immutable snapshots, canonical final history, recovery and controlled fake-transport delivery are implemented and independently reviewed. Native 41/worker 31, workspace build 13/13, global typecheck/lint 24/24 and full database integration 219/219 pass. Final post-approval pinned-base harness: `runs/harness/receipt-1793272170654-26e06e7c.json`.

The explicit human exception applied only the exact reviewed 0093 correction. Actual fresh migrations 0000–0093, before 0094, pass with guarded old-format safe/unsafe sweep and exact-byte fake-delivery fixtures. Fresh full-chain 0000–0094 ledger hashes match all 95 source files; pre-existing ledger records remain unchanged. Evidence: `runs/rpt-07/approved-chain-status.json`, `runs/rpt-07/approved-ledger-status.json`, `runs/rpt-07/review/approved-0093-exception.json`. Preservation checks cover 278 source hashes, 242 starting paths, 185 protected SQL/meta files with only the exact approved exception, 95 journal entries and frozen intent.

Remaining: 0% for local RPT-07. Consolidated receipt: `runs/rpt-07/current-verification-receipt.json`. RPT-LANG, RPT-08 and separately authorized model/live Slack and production acceptance remain outstanding. Local fixtures do not establish production upgrade acceptance or restore content already purged by original 0093. Activation remains disabled. No commit, push, PR or production operation was performed.


## RPT-LANG planning checkpoint — 2026-10-29 (historical; superseded below)

The next dependency has a [draft specification](../../implementation-artifacts/spec-rpt-lang-company-and-personal-language.md) and [required design](RPT-LANG-DESIGN.md). Three read-only source audits covered canonical analytical generation/storage, personal conversation and actual administrative consumers. This is not an epic story; no sprint status is created. Planning remains in the previously authorized implementation worktree and preserves unrelated changes.

The proposal separates company-language analytical/admin/report output from durable personal-language preference. It includes nullable historical provenance and authorized expiring safe-display renditions; complete setup/five-route dashboard copy; existing-classifier language proposals and ordered preference CAS; exact reviewed numeric/disclosure locale forms; strict bounded resource preparation. Original private text, scoring and receipt/rights/retention contracts remain unchanged. Personal English-only policy replacement is explicit, rather than an accidental prompt edit. Unsupported/missing resources have typed readiness outcomes; the accepted company-locale contract is not reduced to a fixed language list.

Current Pulse screens use the V2 pilot read model, not only legacy `user-insights`; both relevant guarded surfaces are mapped. The touched legacy endpoint's tenant binding requires a regression before locale projection is added. Local technical debug controls are excluded. No implementation, migration, provider call, Slack send, production mutation, commit/push/PR or activation occurred during planning.

Self-review, measured spec size and preservation evidence: `runs/rpt-lang/planning-validation.json`. BMad Step 2 `[A] Approve` or `[E] Edit` is required before runtime implementation. RPT-LANG implementation and independent review/deterministic harness remain outstanding; multilingual semantic/model/Slack acceptance and RPT-08 remain separately gated.


## RPT-LANG local completion — 2026-10-29

The approved [execution specification](../../implementation-artifacts/spec-rpt-lang-company-and-personal-language.md) is done locally. Company-language analytics/admin output and independent durable personal language now have explicit resource/provenance boundaries; exact numeric evidence, scoring, private originals and copy lifetimes are preserved. Both final independent BMad rechecks close R1–R9. The first official attempt failed a stale manual bundle schema; that fixture was corrected without runtime/SQL changes and its complete223-case worker selection passes. The failed receipt remains retained.

Final official receipt: `runs/harness/receipt-1793288712151-c9399e5e.json`; full fresh-chain database243/243 without skips,99 ordered SQL hashes/clocks, workspace build/types/lint, affected application1328/provider289/API39/dashboard29 and worker223. Final preservation and current structured verification receipt live under `runs/rpt-lang/`. All prior299 implementation-start dirty paths and applied migration prefixes are preserved except the declared language delta; original checkout remains untouched.

Remaining:0% for local RPT-LANG. RPT-01–07 and RPT-LANG now have local implementation acceptance. RPT-08 still needs its own specification, deterministic end-to-end acceptance and controlled cutover plan. Actual multilingual semantic/privacy quality, live model/native Slack acceptance, public reporting-rights ingress verification and production activation remain separately gated; no full-reporting release claim follows from these fixtures.


## RPT-08 planning checkpoint — 2026-10-30

[Draft specification](../../implementation-artifacts/spec-rpt-08-connected-acceptance-and-pilot-readiness.md), [required design](RPT-08-DESIGN.md) and [all33 acceptance matrix](RPT-08-ACCEPTANCE-MATRIX.md) define one local connected synthetic acceptance/readiness bundle. Actual normalized ingress, real native evidence/queues/calendar/formation/snapshot/receipt components and independent arithmetic/member oracles are required; only AI/Slack boundaries are faked. The local migration lane pins actual0091 schema and guarded synthetic old-format rows through unchanged0092–0098, distinct from absent historical-producer execution. No runtime implementation or service/provider/Slack operation occurred during planning.

Public full/partial reporting-rights intake and native production driver registration remain absent mandatory blockers, requiring separate scoped implementation/approval before pilot. Semantic/resource/native Slack/production/rollout gates remain blocked or not_run. Local readiness accounting can pass while pilot eligibility is blocked; a checklist does not satisfy missing integration. Planning review/preservation/token/link evidence is under `runs/rpt-08/`; prior runtime receipt remains the RPT-LANG receipt above. Await BMad Step2 `[A] Approve` or `[E] Edit` before implementation.


## RPT-08 execution authorized — 2026-10-30

The human approved continuation after the concrete RPT-08 checkpoint and roadmap explanation. The execution specification is in-progress with unchanged frozen intent; approved artifact hashes,377 starting dirty paths,194 protected SQL/meta files and99 journal entries are saved under `runs/rpt-08/`. This authorizes the local connected acceptance/readiness work only. Public rights UX, production driver registration, live provider/Slack calls, remote Git/deployment and activation remain separate gates. No epic/story key is assigned.

## RPT-08 strict local implementation verified — 2026-10-30

The approved Step3 implementation completed a single current-source final7 aggregate: 813/813 unique selected tests passed, zero skips, all 33 local cases; connected/restart/migration each 2/2 and all 807 lower regressions. Actual process exit 0. Native Slack renderer evidence is 26 actual `node:test` cases. Source and preserved-worktree evidence are `runs/rpt-08/final-verification-summary.json` and `runs/rpt-08/implementation-postrun-preservation.json`; the review delta contains 24 implementation-owned paths and one narrowly approved original-test block correction. All 194 SQL/meta files, 99 journal entries, approved contexts and frozen intent are preserved. Failed/cancelled prior runs remain diagnostic history and are not counted toward this result.

Next: coordinator-owned BMAD Step04 independent review, any necessary corrections, then the official harness against pinned base `237d7075ff08f262ccf3cbe2bf7c36cb390d204e`. RPT-08 remains in progress until those gates pass. This closes the local implementation work, with approximately 10% of local package completion remaining for review/final verification. Production reporting still requires separately scoped public full/partial withdrawal intake, native production registration, real multilingual model and Slack-client acceptance, and an explicitly approved production cycle/cutover. Pilot remains blocked and activation false.


## RPT-08 Step04 corrective execution — 2026-10-30

Independent blind and edge reviews completed against the exact 24-path delta. Eleven deduplicated implementation/verification patches are accepted in `runs/rpt-08/step04-triage.json`; frozen intent and original scope remain unchanged. Final7 remains historical pre-review evidence for source `634dee9d90773da7ad6f71895c786fe25b078b12a2e620eae20d6b6c2f7f9375`, not proof of corrected source. Complete counterexample regressions, independent corrective rechecks, a new single zero-skip source-frozen aggregate and the official gate before local completion. Production prerequisites remain blocked.


## RPT-08 reviewed-source local acceptance — 2026-10-30

The new full final8 run actually exited 0 on immutable source `7b18faddb819f29fffa9d078316bf22a631845d53ef0f73b33950bf51d265603`: 813 unique canonical tests, no skips and all 33 local cases. Two independent bounded correction rechecks and coordinator evidence/preservation/preview audits passed. The earlier final7 source remains historical proof only. Final workspace checks and the official pinned-base harness are the remaining local completion steps. Public authenticated full/partial withdrawal intake, native production registration, real model/language/privacy/Slack-client acceptance, production inventory and exact human-authorized rollout remain mandatory before a production cycle.


## RPT-08 final scoped outcome — 2026-10-30

Required local scope complete: final8 actual813/33 zero-skip; two independent corrective rechecks; coordinator source/preservation/12-part preview audits; workspace types/lint24; official default PostgreSQL-only receipt `runs/harness/receipt-1793399354824-e58f8f26.json`. The default profile's nine additional conditional skips are fully accounted in `runs/rpt-08/official-profile-skip-audit.json`: seven separately passed on the same source and two preserved RPT07 fixed-port behaviors remain unverified. Broad local verification retains roughly5% work for the two legacy tests/portable owned-target follow-up; no unconditional local0 claim. Required RPT08 matrix assertions themselves are complete. Production-path remainder is approximately35–45%, low confidence, covering the previously listed public withdrawal intake, native registration and external acceptance/rollout gates. No production cycle was launched.


## Production blocker planning checkpoint — 2026-10-31

[Production blocker closure plan](PRODUCTION-BLOCKERS-PLAN.md) sequences G03–G11 into code packages RPT-09 (employee reporting-rights intake), RPT-10 (native registration with default-off audited controls), the small RPT-08a legacy-port exception, and separately authorized external gates. [RPT-09 draft specification](../../implementation-artifacts/spec-rpt-09-employee-reporting-rights-intake.md) awaits BMad `[A] Approve` or `[E] Edit`. No implementation, Git, live model/Slack or production activity occurred.

RPT-09 specification approved by the human on 2026-10-31 (`[A]`); status `ready-for-dev`, frozen intent locked. Implementation has not started and awaits an explicit start instruction.

## RPT-09 local outcome — 2026-10-31

[RPT-09](../../implementation-artifacts/spec-rpt-09-employee-reporting-rights-intake.md) is done locally: Slack DM rights protocol, migration 0099, API admission before ack, worker application through the existing withdraw command, model-proposed menu. Step04 produced ten patches (applied) and three deferred items. Official default receipt `runs/harness/receipt-1793444994105-955e4503.json`; the Redis-gated new suite passed 6/6 separately on final source. G03 still needs native Slack-client (EXT-B) and deployed-binding evidence. Nothing committed or deployed.

RPT-10 specification approved by the human on 2026-10-31 (`[A]`); status `ready-for-dev`, frozen intent locked. Implementation awaits an explicit start instruction.

## RPT-10 local outcome — 2026-10-31

[RPT-10](../../implementation-artifacts/spec-rpt-10-native-production-registration.md) code is implemented and reviewed (16 Step04 patches, recheck fix R1): lifecycle queue/processor/scan registered behind `PULSE_REPORTS_ENABLED` (default false) and audited per-scope activation controls (migration 0100, `reports:activation` script). Status remains `in-review`: fresh strict bundles fail only on load-sensitive RPT-07 short-window successor fixtures, so no fresh zero-skip strict pass exists yet. Next: approved fixture fix, then strict bundle and official harness. Nothing committed or deployed.

- 2026-10-31 RPT-10 closed locally: RPT-07 short-window fixture fix verified (delivery 39/39 x3), fresh strict bundle `20261031_rpt10d` passed (822 tests, 0 skips, `pilotEligibility=blocked`), official harness receipt `runs/harness/receipt-1793470751971-d38c7fe4.json`. Mid-multipart hold behavior confirmed by the human. R3-selected oracle made DB-relative with approval (harness receipt-1793476391091-d3cd5bb9). Next: RPT-08a (needs preservation exception), then EXT-A..E (each needs separate authorization).

- 2026-10-31 RPT-08a done locally: both legacy RPT07 Redis suites pass on owned named Redis 56465 via `claimOwnedRpt07Redis`; official harness receipt `runs/harness/receipt-1793477460245-4b1ae190.json`; zero unverified legacy fixed-port behaviors. Local code packages RPT-01..10, LANG and 08a are complete; remaining gates are EXT-A..E plus Git publication, each needing separate authorization.
