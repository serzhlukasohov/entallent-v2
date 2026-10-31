---
title: 'RPT-04: Company configuration and frozen final-formation context'
type: 'feature'
created: '2026-10-25'
status: 'done'
review_loop_iteration: 0
baseline_commit: 237d7075ff08f262ccf3cbe2bf7c36cb390d204e
context:
  - '{project-root}/_bmad-output/planning-artifacts/pulse-check-reports/RPT-04-DESIGN.md'
---

<frozen-after-approval reason="human-owned intent - do not modify unless human renegotiates">

## Intent

**Problem:** Native reports have no authoritative business-day deadline, versioned company-language context or durable formation cutoff independent of cycle end.

**Approach:** Version the existing company configuration, resolve the last working close inside each native cycle, and freeze one cycle-wide context at actual first formation. The required design defines transactions and edge cases.

## Boundaries & Constraints

**Always:** Company-calendar timezone; configured workEnd, holidays and date overrides; English-default validated company locale. Preserve immutable cycle bounds, RPT-01–03 and staff-managed calendar ownership. Admin language editing uses existing session, tenant authorization and CSRF. Pre-formation edits refresh pending plans; begun formation retains its exact revision, due date, language and cutoff. Cutoff is DB-authored actual first start; retries cannot restamp it.

**Ask First:** Production migration/activation, external model/Slack calls, changes to calendar ownership, onboarding behavior or personal-language policy.

**Never:** Guess missing hours/timezone, silently resolve DST gaps/folds, rewrite historical cycles/snapshots, infer insufficient participation from scheduling errors, implement settlement/readers/rendering/sending or touch MAF.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
| --- | --- | --- | --- |
| Deadline | Sunday cycle end; Friday working; Friday holiday variant | Friday configured close; Thursday in variant | No fixed hour |
| Overrides | Saturday explicitly working; shortened day | Latest configured close in `(periodStart, periodEnd]` | Reject duplicate/conflicting dates |
| Configuration | Missing calendar, invalid locale, no working close | Explicit blocked plan; collection still available | Typed reason; no fallback |
| DST | Nonexistent or repeated local workEnd | Block formation for that configuration | Explicit gap/fold error |
| Edit/race | Settings change before or concurrently with first start | One current revision selected transactionally | Stale save/job conflicts |
| Recovery | Retry; late first start | Same frozen context; actual late-start time and delay recorded | Never backdate or extend cycle |

</frozen-after-approval>

## Code Map

- `packages/contracts/src/onboarding.ts`, `apps/api/src/onboarding/company-calendar.service.ts` - current staff calendar and postcommit reminder behavior.
- `apps/api/src/hierarchy/company-setup.controller.ts` - company-admin session/CSRF boundary; locale is currently unvalidated `tenants.locale`.
- `apps/worker/src/survey/repositories/pulse-report-scope.repository.ts`, `packages/database/src/pulse-report-state.ts` - native cycle identity, opening and established locks.

## Tasks & Acceptance

Implement the concrete ownership map and invariant checks in the [required design](../planning-artifacts/pulse-check-reports/RPT-04-DESIGN.md).

**Execution:**
- [x] `packages/contracts/src/pulse-report-calendar.ts`, `onboarding.ts`, exports/tests - real dates, effective hours, canonical locale and typed readiness.
- [x] `packages/application/src/use-cases/resolve-pulse-report-final-schedule.ts`, tests - pure company-calendar resolver; exact interval comparisons, holidays beyond seven days and DST rejection.
- [x] `packages/database/src/schema/survey-report-calendar.ts`, `schema/onboarding.ts`, `pulse-report-configuration.ts`, `pulse-report-state.ts`, exports and forward migration - immutable revisions, tenant/cycle plan, exact timestamp/lock keys, DB-authored cutoff and structural guards.
- [x] `apps/api/src/report-configuration/report-configuration.service.ts`, its module/tests; onboarding calendar service, module and `build-calendar-service.ts`; operator CLI - atomic source/revision/audit writes, CAS and pending-plan refresh; preserve recalculation.
- [x] `apps/api/src/dev/dev-onboarding.controller.ts` and tests - carry revision through guarded bootstrap; omitted holiday fields preserve existing settings.
- [x] `apps/api/src/hierarchy/company-setup.controller.ts`, setup read service/UI, hierarchy module and tests - authorized company-language editor, revision conflicts and read-only calendar; no second locale source.
- [x] `packages/application/src/ports/pulse-report-final-schedule.repository.port.ts`, `use-cases/begin-pulse-report-final-formation.use-case.ts`, worker `survey/repositories/pulse-report-final-schedule.repository.ts`, native-opening adapter and exports/tests - refresh/read/first-start operations with one cutoff across audiences; no scheduler wiring.
- [x] `packages/database/src/__tests__/pulse-report-calendar.integration.test.ts`, affected API/worker suites and report plan/task logs - migrated races, legacy compatibility, proof and review evidence.
- [x] `scripts/agent-harness.ts`, `scripts/agent-harness.test.ts` - prevent focused active-contract verification from chaining archived runtime checks; preserve archived sources.

**Acceptance Criteria:**
- Given concurrent calendar/language saves and first formation, when transactions commit, then settings, revision, plan and audit agree; stale writers cannot overwrite current configuration.
- Given different audience workers or retries, when formation begins, then they receive one immutable context without changing receipt-ledger or native collection bounds.
- Given German company configuration and Ukrainian user locale, when context is frozen, then it records German without changing personal chat, onboarding language or scores; full AC-28 remains RPT-LANG/RPT-06 acceptance.
- Given previous stories and pilot data, when this foundation runs, then their frozen identity, default selection, delivery gates and existing onboarding projections remain valid.

## Spec Change Log

## Verification

- RED/GREEN pure resolver and configuration tests; native migrated source-to-context cases, rollback, CAS and first-start races; existing calendar/admin/native scope regressions.
- Build dependencies sequentially before consumers. Run relevant package/API/worker tests, `pnpm typecheck`, `pnpm lint`, and final `pnpm harness:check -- --base 237d7075ff08f262ccf3cbe2bf7c36cb390d204e` with isolated local services; exact-target preflight before queue fixtures.
- Two independent BMad code reviews after implementation; preserve RPT-01–03 hashes and applied SQL. Local RPT-04 acceptance passed on 2026-10-26. Production, full localization, settlement and delivery remain later work.

## Implementation Evidence

Human approval: `A`, 2026-10-26. RPT-04 is complete locally; no sprint story key was assigned.

- Calendar/locale source, immutable revision, pending plan and audit agree under CAS and tenant/cycle locks. Migrated configuration/formation suite: 22/22, including races, legacy repair, rollback, exact locks and one immutable DB clock.
- Resolver: 15/15; executable setup UI fixtures: 4/4. Five browser scenarios passed on actual HTML/JS with synthetic local auth/snapshot/mutation responses; backend acceptance is separate actual API/PostgreSQL evidence.
- Independent Blind Hunter and Edge Case Hunter reviews found four implementation patches; both correction rechecks are clear. See `runs/rpt-04/review/triage.json` and correction reports.
- Final baseline harness passed diff-check, workspace typecheck, lint and selected active tests: API 83, worker 81, mocked AI 233, application 615, contracts 12, domain 17, database 125. One existing opt-in worker queue case was skipped; prior explicit queue evidence remains preserved. No archived contract execution occurred in the final harness.
- Supplementary active runtime/disconnected regressions, onboarding, caller and script compilation evidence: `runs/rpt-04/implementation-handoff.json` and `correction-handoff.json`.
- Structured final receipt: `runs/harness/receipt-1793005962780-0669b22e.json`. Model evaluations were skipped; RPT-04 is deterministic configuration/timing work and does not authorize provider calls.
- Preservation audit passed: 74 older SQL files, older migration snapshots/journal prefix, RPT-01–03 artifacts and frozen intent. Migration 0074 is the only new migration and was applied to isolated local databases.
- Remaining: 0% for approved RPT-04. RPT-05 settlement/readers, RPT-LANG, RPT-06 rendering and RPT-07 scheduling/delivery retain their separate acceptance boundaries.

## Suggested Review Order

**Formation entry point**

- Recover the first context before validating a new start against current configuration.
  [pulse-report-final-schedule.repository.ts:59](../../apps/worker/src/survey/repositories/pulse-report-final-schedule.repository.ts#L59)

- Database guards author one clock for immutable start and cutoff.
  [0074_company_report_configuration.sql:74](../../packages/database/migrations/0074_company_report_configuration.sql#L74)

**Configuration serialization**

- Serialize authorized source, revision, audit and pending-plan changes under CAS.
  [report-configuration.service.ts:84](../../apps/api/src/report-configuration/report-configuration.service.ts#L84)

- Retain exact cycle bounds and refresh only contexts that have not started.
  [pulse-report-configuration.ts:135](../../packages/database/src/pulse-report-configuration.ts#L135)

- Use the same revision boundary for sanctioned dev initialization without overwriting existing settings.
  [dev-company-calendar.ts:13](../../apps/api/scripts/dev-company-calendar.ts#L13)

**Calendar resolution**

- Resolve company working closes with exact bounds, DST rejection and Gregorian edge handling.
  [resolve-pulse-report-final-schedule.ts:54](../../packages/application/src/use-cases/resolve-pulse-report-final-schedule.ts#L54)

**Admin boundary**

- Derive tenant and actor from authenticated session and require CSRF.
  [company-setup.controller.ts:44](../../apps/api/src/hierarchy/company-setup.controller.ts#L44)

- Display validated calendar components while retaining actionable legacy-repair errors.
  [company-setup-ui.controller.ts:172](../../apps/api/src/hierarchy/company-setup-ui.controller.ts#L172)

**Supporting contracts and evidence**

- Validate explicit dates, overrides, working hours and canonical company locale.
  [pulse-report-calendar.ts:25](../../packages/contracts/src/pulse-report-calendar.ts#L25)

- Persist tenant revisions and native-cycle timing with typed structural constraints.
  [survey-report-calendar.ts:16](../../packages/database/src/schema/survey-report-calendar.ts#L16)

- Exercise actual migrated races, clock immutability, repair and initialization.
  [pulse-report-calendar.integration.test.ts:23](../../packages/database/src/__tests__/pulse-report-calendar.integration.test.ts#L23)

- Cover exact timestamps, holidays, DST and company-local Gregorian limits.
  [resolve-pulse-report-final-schedule.test.ts:17](../../packages/application/src/use-cases/resolve-pulse-report-final-schedule.test.ts#L17)

- Keep active-contract verification from chaining archived runtime fixtures.
  [agent-harness.ts:653](../../scripts/agent-harness.ts#L653)
