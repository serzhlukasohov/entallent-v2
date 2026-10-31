# RPT-04 — Company configuration and final-formation design

Date: 2026-10-26. Status: approved and implemented locally; independent correction reviews and deterministic acceptance passed. Evidence is recorded in the linked specification and `runs/rpt-04/acceptance-tracker.json`.

Required by [RPT-04 specification](../../implementation-artifacts/spec-rpt-04-company-calendar-and-final-formation.md). Authority: FR-016, configuration/metadata portion of FR-028/029, AC-16 and the configuration portion of AC-28 in this requirements package. This is one outcome: a trustworthy, versioned final-formation context for the native cycle. RPT-05 consumes its cutoff; RPT-06/07 consume its language and timing. It does not deliver reports.

## 1. Verified current boundaries

- `packages/contracts/src/onboarding.ts:5` defines IANA timezone, ISO weekdays 1–7 and one same-day start/end pair. `schema/onboarding.ts:6` persists a mutable singleton; there are no holidays, date exceptions or revision identities.
- `apps/api/src/onboarding/company-calendar.service.ts:38` validates, upserts and audits the calendar, then recalculates reminders after commit. Existing locking misses concurrent first creation. Operator CLI and `build-calendar-service.ts` construct this service without an HTTP calendar editor.
- Company setup intentionally exposes a staff-managed, read-only calendar (`company-setup-read.service.ts:84`, UI `:169`, tests `:59`). Company admins are not being granted calendar-write authority by this story.
- `schema/tenants.ts:8` stores the authoritative company locale as unvalidated text defaulting to `en`. `tenants.timezone`, employee timezone/locale and `onboardingLanguage` are different settings. No second editable locale will be introduced.
- The existing working-calendar helper has a seven-day search and an iterative conversion without a specified DST-fold rule. Report deadlines must not inherit those limitations or choose an employee timezone.
- Cycle policy identity is tenant + definition + immutable periodStart/periodEnd (`schema/survey-insight-v2.ts:60`). Native opening and scope snapshots are already immutable. Pilot selectors/senders use legacy cohorts and periodEnd; this story leaves those paths quarantined.
- Personal replies are explicitly English-only today (`application/src/utils/language-policy.ts:3`). Recording German company locale does not complete multilingual conversation, translated analytics/UI or full AC-28.

## 2. Configuration contract and ownership

Extend the existing authoritative company calendar with report-calendar fields. For calendar mutations, omitted holidays/overrides preserve stored values; only first creation uses empty lists. Explicit `[]` clears the corresponding list under CAS. Do not insert parser defaults before distinguishing omission from an explicit clear. Existing readers that project only timezone/weekdays/start/end retain their behavior; do not change reminder/proactive algorithms or claim they now honor holidays.

The report calendar uses:

- Valid IANA timezone and sorted, distinct ISO weekdays 1–7.
- Existing same-day `HH:mm` hours, with start strictly before end. No overnight or split-shift design is introduced.
- `holidays`: distinct real Gregorian local dates `YYYY-MM-DD`, years 0001–9999, closed regardless of the weekday template.
- `dateOverrides`: distinct date-keyed records, either `closed` or `working` with explicit same-day start/end. A working override can open a weekend or shorten hours. Reject a date present in both holidays and overrides, duplicate dates and meaningless closed-day hours. Do not silently choose precedence for contradictory input.

An ordinary weekday uses its configured base hours; a holiday or closed override has no closing candidate; a working override supplies its own hours. Validate actual dates, leap years, hours, timezone and bounds before mutation. Preserve the user's explicit calendar settings rather than replacing an invalid value with defaults.

Company report locale uses `tenants.locale`. Validate/canonicalize BCP47 through the existing Node/ICU runtime (`Intl.getCanonicalLocales`, plus `Intl.DateTimeFormat.supportedLocalesOf`); accept only a supported canonical tag. English default is `en` for new/missing company-language configuration; an explicitly malformed or unsupported stored value is a typed configuration error, never an implicit English fallback. This is configuration validation, not a guarantee of translated product coverage or model quality.

The company-admin setup gains a report-language field and current report-config revision. Calendar display remains read-only, showing timezone, hours and the report holiday/override settings. Keep the existing session, same-origin, CSRF, active identity and in-transaction company-admin authorization. Derive tenant/actor from session; reject injected tenant/actor fields. A general admin API key alone is not a company-admin session or report-access grant. Preserve CSP/escaping and onboarding's English-only setting.

Calendar writes remain the existing internal-operator service/CLI path. Extend that path with holidays/overrides and expected configuration revision. Update every caller, including dev-onboarding calendar initialization and CLI manual construction, to read/pass the revision; preserve existing dev-route guards. No ordinary source writes may bypass revision capture. Postcommit reminder recalculation stays in the calendar wrapper, and its failure does not roll back an already committed setting. A repeat identical calendar save with the current revision still retries recalculation without another config revision/audit; this preserves the operator CLI's documented recovery path. Language-only saves never enqueue reminder recalculation.

## 3. Revisions, serialization and legacy readiness

Keep mutable source fields in `tenants.locale` and `tenant_work_calendars`. Add immutable `tenant_report_config_revisions` with tenant identity, monotonic revision, canonical locale, validated calendar snapshot or explicit unavailable reason, content fingerprint, DB-authored capture time and minimal actor provenance. Do not store employee data. This is a snapshot/provenance ledger, not another editable configuration.

All configuration writers first lock the existing tenant row `FOR NO KEY UPDATE`. This serializes locale/calendar changes and first calendar creation while remaining compatible with unrelated FK key-share locks. Check `expectedConfigRevision` under that lock; stale edits return a conflict without source/revision/audit/plan changes. A true no-op requires both source values and the revision head to match; it does not append history or duplicate audit. If an authorized save matches current source fields but the head is stale, append a reconciliation revision/audit and refresh pending plans. Use the existing bounded serializable/deadlock retry pattern; retrying must not bypass CAS or current authorization.

In one transaction: lock tenant, authorize the actor, reread authoritative source/head, validate the proposed mutation, assess the retained other fields for readiness, write the source, append its revision, refresh non-started cycle plans and write before/after audit. Compute effective settings and plans only after locking; pre-lock API snapshots are not authoritative. Lock affected native cycles in stable identity order after the tenant configuration lock. Do not hold locks over queues, Slack or model calls. Audit configuration and affected cycle identities only.

Language may be configured before a calendar exists. Persist its valid locale revision with `missing_calendar` readiness; it is not a schedulable context. A valid language repair may also commit while an existing calendar is invalid: retain that source calendar unchanged, store no validated calendar snapshot and mark `invalid_calendar`. Symmetrically a valid calendar repair can retain a malformed legacy locale as `invalid_locale`, with no claimed canonical locale until repaired. Snapshots carry validated components plus explicit unavailable reason and source fingerprint; they never label malformed data valid or drop source fields to manufacture readiness.

For an existing tenant with no revision, the first planning/readiness operation may capture the actual current source configuration and its validated readiness under the same tenant lock, at the current DB time. Record this as initial capture; do not invent historical configuration timestamps. Invalid explicit locale/calendar blocks readiness until corrected by an authorized save. Later operations compare the head fingerprint with current source fields; a bypassed/out-of-sync source mutation blocks new formation instead of silently using a stale snapshot. Add a calendar INSERT/UPDATE/DELETE locking trigger taking the same tenant lock (except tenant-erasure cascade), so raw calendar SQL cannot commit between source verification and first-start capture. Raw tenant-locale updates already conflict on the tenant row. Direct SQL can receive a normal deadlock/serialization failure rather than bypass the boundary. Historical cycles and delivered snapshots receive no invented formation records or backdated cutoffs.

## 4. Pure final-deadline resolution

Input: exact immutable UTC cycle bounds and a validated configuration revision. Output: selected local working date/end, timezone, resolved UTC `finalDueAt`, configuration identity and algorithm version, or a typed blocked reason.

Enumerate local calendar dates intersecting the cycle in the company-calendar timezone. Consider each working date's effective end. A closing instant is eligible when `periodStart < close <= periodEnd`; choosing a close exactly at cycle end is valid and does not extend the collection interval. A partial final date whose configured close is after periodEnd is skipped in favor of an earlier eligible working close. Never invent a shortened close at periodEnd. Select the latest eligible closing instant. If there is none, return `no_working_close_in_cycle`.

Preserve exact timestamp ordering at submillisecond interval boundaries using the established exact timestamp comparison pattern; JavaScript Date truncation must not change inclusion. Read persisted cycle bounds as PostgreSQL timestamp text/epoch microseconds in the shared configuration helper and worker timing adapter. Add a compatible exact-string cycle-lock helper in `packages/database/src/pulse-report-state.ts`, casting those strings to timestamptz before the existing trigger-compatible key construction; retain existing Date callers unchanged. Never derive a persisted cycle's lock key from a truncated Drizzle Date. Test both interval comparisons and contention with the trigger's identical microsecond key. The search is bounded by the supplied interval's dates, not an arbitrary seven-day window. Explicit holidays can close weeks. Company timezone is authoritative even if the employee, recipient, `tenants.timezone` or server zone differs.

Consider working dates from latest to earliest. Resolve each effective local close to all possible UTC instants. When at least one possible instant exists and all are outside the exact cycle closing bounds, skip the date. For a gap with no possible instant, first exclude a partial boundary date whose intended wall close is outside that cycle's local boundary range. The first remaining candidate must have exactly one instant; otherwise return `nonexistent_work_end` or `ambiguous_work_end`. In particular, a fold blocks even if only one of its two occurrences lies in the interval. An earlier gap must not block a later normal eligible date. Do not roll forward, select an arbitrary offset or hide the selected candidate's error by choosing an earlier day. Admin/operator diagnostics identify date/time/timezone; this is not insufficient data. Non-hour offsets, ordinary DST transitions and years 0001/0099/0100 must work; do not reuse Date.UTC's 0–99 year reinterpretation. No new date library is assumed; assess the existing Intl approach with golden fixtures before adding any dependency.

Golden cases include:

| Cycle/configuration | Required result |
| --- | --- |
| Ends Sunday; Mon–Fri; Europe/Warsaw 18:00 | Friday 18:00 local, correct seasonal UTC |
| Same, Friday holiday | Thursday 18:00 local |
| Saturday override working until 13:00 | Saturday 13:00 if inside bounds |
| Cycle ends Friday 12:00, ordinary Friday close 18:00 | Earlier eligible close; no invented Friday noon close |
| Explicit Friday close 12:00 and periodEnd exactly 12:00 | Friday close is eligible |
| More than seven consecutive closed days | Search the whole interval, or return no-working-close |
| Europe/Warsaw 2026-03-29 close 02:30 | Nonexistent-work-end error |
| Europe/Warsaw 2026-10-25 close 02:30 | Ambiguous-work-end error |
| Asia/Kathmandu close 18:00 | Exact +05:45 conversion |

## 5. Durable native-cycle timing and first formation

Add `survey_report_final_timings` keyed uniquely by tenant and native cycle-scoring-policy identity, shared across Team Lead and Manager audiences. It references the exact configuration revision and stores algorithm version, readiness/status, timezone/local close/date and UTC due time. It does not copy mutable hierarchy or alter original cycle bounds. Missing/invalid configuration produces an explicit blocked plan; native opening/coaching can still succeed.

Statuses are `blocked`, `scheduled`, `started`. `blocked` carries a typed reason and no invented deadline/cutoff. `scheduled` has a valid due time and no formation time/cutoff. `started` has `formationStartedAt = reportDataCutoff =` one captured DB `clock_timestamp()` value; the full row's context is immutable thereafter. Structural DB guards enforce tenant/cycle/revision membership, native-opening identity, status/nullability, due time in `(periodStart, periodEnd]`, first-start time at/after due, immutable started records and tenant-erasure compatibility. A late cutoff may exceed periodEnd; do not incorrectly forbid that clock while validating due-time bounds. Callers cannot supply or restamp first-start clocks.

Native opening captures/refreshes the timing plan in its transaction, taking tenant configuration lock before the very first existing cycle lock and established subject locks, including the existing-opening replay branch. Replaying an opening preserves its original hierarchy/openedAt; it may initialize or refresh only an unstarted timing plan. Never retrofit the legacy cohort scheduler or change pilot opening behavior.

Calendar/language saves refresh `blocked`/`scheduled` plans using the new current revision under tenant-then-cycle locking, including plans whose old due time has passed. If an edited calendar cannot resolve a cycle, retain that cycle as explicitly blocked instead of rejecting otherwise valid company settings or preserving a stale deadline. Started rows retain their original configuration/language/deadline and cutoff. An expected revision in a queued/requested plan prevents an obsolete job from initiating the old schedule; callers receive a typed stale-plan result and must reload.

Expose application/worker operations to refresh/read a plan and begin final formation; keep these manually testable in local fixtures, with no automatic scheduler/queue/sender wiring. Begin locks tenant configuration then the exact cycle and first returns any existing `started` context unchanged, before current-source/stale-revision checks. Only an unstarted plan requires current source/head equality and expected revision. Early calls return `not_due`; blocked/stale calls return their typed reason. At/after due, atomically transition once to `started`. Explicitly test: audience A starts revision 4, company configuration becomes 5, and audience B retries with revision 3; B must recover A's exact revision-4 context.

A late first start records its actual DB time and observed delay from the planned due instant. Do not pretend that formation began on Friday when first invoked Monday. Subsequent recovery keeps exactly that first cutoff, with no new clock or silent extension. Cycle bounds still apply: later readers use the intersection of native cycle/opening/participation bounds and `[cycleStart, reportDataCutoff)`, even if an operationally late first start is after periodEnd. The requirement to deliver on the business day remains unmet in such a late case; timing metadata is not an on-time delivery claim. RPT-07 owns operational scheduling and delivery-delay recovery.

Collection remains governed by immutable native periodEnd and participation/permission rules. It can continue after report cutoff; those later receipts cannot enter that final and do not automatically move into another cycle. RPT-04 does not add a cutoff check to capture/admission, discard private work or alter RPT-03 coverage. Because receipt ordering is durable, freezing the context does not require acquiring every subject lock. RPT-05 must separately settle all eligible pre-cutoff work, including captures/finalizations that commit later, before deciding participation or assembly. No intermediate may begin after final cutoff once RPT-07 consumes this context.

## 6. Concrete ownership map

| Owner | Action |
| --- | --- |
| `packages/contracts/src/pulse-report-calendar.ts`, `onboarding.ts`, `index.ts` and tests | Versioned report-calendar/locale/config/timing contracts and typed blocked outcomes; preserve base reader shape |
| `packages/application/src/use-cases/resolve-pulse-report-final-schedule.ts` and tests | Pure deterministic date/effective-hours/UTC resolver and exact-boundary fixtures |
| `packages/database/src/schema/onboarding.ts`, new `schema/survey-report-calendar.ts`, both exports, forward migration after 0073 | Add source holidays/overrides, immutable config revisions, cycle timing FK/state/clock guards; generated metadata and tenant-erasure checks |
| `packages/database/src/pulse-report-configuration.ts`, `pulse-report-state.ts` and exports | Lock/reread source, exact timestamp/cycle-key support, revision/CAS and timing writes; computed data must derive from that locked source; keep pure calendar policy in application |
| `apps/api/src/report-configuration/report-configuration.service.ts`, module and tests | Shared atomic config-save adapter; authorize inside transaction; call application resolver and shared DB helpers for pending plans; no queue/module cycle |
| `apps/api/src/onboarding/company-calendar.service.ts`, `build-calendar-service.ts`, their tests, `onboarding.module.ts`, operator `scripts/configure-company-calendar.ts` | Delegate persistence/revisions through the shared service; CLI revision/options; retain recalculation only after commit |
| `apps/api/src/dev/dev-onboarding.controller.ts` and tests | Preserve guarded dev bootstrap while passing current revision; concurrent bootstrap cannot overwrite settings or clear report extras |
| `apps/api/src/hierarchy/company-setup.controller.ts`, read service/UI/module and tests | POST company-language under existing company-setup prefix, session+CSRF+actor checks, snapshot revision/readiness, language form and read-only calendar |
| `packages/application/src/ports/pulse-report-final-schedule.repository.port.ts`, `use-cases/begin-pulse-report-final-formation.use-case.ts`, tests and export | Typed plan/first-start boundary; actual clock is owned by DB adapter |
| `apps/worker/src/survey/repositories/pulse-report-final-schedule.repository.ts`, `pulse-report-scope.repository.ts`, `survey.module.ts` and tests | Native transaction integration, refresh/read/first-start methods; reuse cycle identity/locks and bounded conflict retry; no pilot/scheduler rewiring |
| `packages/database/src/__tests__/pulse-report-calendar.integration.test.ts` and affected suites | Actual configuration-to-timing rows, first-save/edit/start races, rollback, independent SQL guard/clock checks, started immutability, erasure, old projections and prior-story regression |
| This plan/spec, `docs/agent-task-log.md`, `docs/agent-failures.md` if needed | Honest stage/status, evidence, corrections and future consumers |

The neutral API report-configuration module depends only on DatabaseModule and exported shared/application helpers. HierarchyModule and OnboardingModule both import it; it imports neither. The operator CLI's manual service construction must use the same service. Avoid duplicated policy or a worker-to-API dependency.

## 7. Verification and completion boundary

Before implementation retrieve relevant harness reflection; preserve current dirty work, RPT-01–03 frozen blocks and all previously applied SQL. Use a new forward migration and generated metadata. Build dependencies sequentially before consumer tests; use isolated migrated PostgreSQL and named Redis with preflight for any queue fixture. No model or external Slack call is needed.

RED/GREEN covers matrix cases, invalid dates/locale/timezones, concurrent initial saves, stale CAS, no-op/rollback/audit, omitted extras versus explicit clears, recalculation failure then identical-save retry, language-before-calendar, partial repair of invalid legacy settings, reconciliation of bypassed source/head drift, raw SQL versus first-start locking, pending plan edits, admin cross-tenant/actor injection/CSRF/revocation, late start, not-due/stale calls, simultaneous audiences, begun-context recovery after config edits, exact microsecond bounds/lock contention and tenant deletion. Include irrelevant earlier DST gaps, gap outside a partial boundary, one-in-range fold, and early Gregorian years. Existing staff calendar, dev bootstrap, reminder, company setup and RPT-02/03 native tests must remain valid. Verify the rendered local setup form's behavior in a browser where feasible; do not claim browser acceptance from source assertions alone.

After implementation run package/API/worker tests, workspace typecheck/lint, two independent BMad code reviews and the final harness against the pinned baseline; inspect the completed log and structured receipt. Planning-only documentation checks are not any of these runtime passes.

Full AC-16 is accepted only when the persisted native context matches the company calendar; business-day scheduling/delivery additionally needs RPT-07. Full AC-28 still needs RPT-LANG/RPT-06. Source selection/settlement is RPT-05; narrative, snapshot and Slack acceptance are later work. No production migration, activation, API exposure of report data, model evaluation or external delivery is included in local RPT-04 acceptance.
