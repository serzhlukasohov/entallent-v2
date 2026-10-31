# RPT-02 — Frozen report scopes and permission state

Date: 2026-10-22. Engineering contract for the [RPT-02 specification](../../implementation-artifacts/spec-rpt-02-frozen-report-scopes.md); local foundation implementation is completed and independently reviewed, with deterministic acceptance evidence recorded in the specification. Product activation remains a later acceptance boundary. Product authority remains FR-004–007/014/020/036 and AC-05–08/20/33. This foundation must integrate with later source selection and delivery before a user-facing withdrawal or reporting feature is activated.

## Verified integration facts

- `surveyCycleScoringPolicies.id` is the existing V2 cycle UUID, unique by tenant/definition/period. Policy preparation can precede opening; the binding is not a frozen audience snapshot.
- `OpenSurveyReportingCycleUseCase` and the CLI delegate to `SurveyRepository.openReportingCycle`. Its existing transaction freezes legacy cohorts, then returns early on repeat. Legacy team IDs have no general durable mapping to org teams; `legacy:<id>` is a reconciliation convention, not an authoritative FK.
- `surveyWindows.reportingCohortId` and `reportingTeamId` are nullable. Existing V2 policy/window triggers bind by tenant, definition and period independently of those legacy columns. Application `findOrCreateActiveWindow` still requires a legacy cohort; an explicit product branch is necessary.
- Org invariants allow one active employee placement or one active team-lead ownership per person. `active-graph.ts` rejects TL-plus-employee placement, though no cross-table DB constraint enforces it. Validate the complete active graph when opening; do not silently select a convenient affiliation.
- Hierarchy move/promotion/deactivation services already use serializable transactions. Their postcommit onboarding events are best effort, so those events cannot own authoritative report collection stops.
- Real Slack/dev ingress persists `messages.receivedAt` server-side in `IngestionService.saveInboundMessage`. It represents durable admission after identity resolution, not initial network arrival. `occurredAt` is distinct provider time. Legacy/synthetic messages may have null receipt time.
- Confirmation receipts retain `inboundMessageId`, but current `confirmedAt` uses provider time and finalization purges the working message reference. Add separate durable admission proof; do not reinterpret historical `confirmedAt`.

## 1. Opening and immutable affiliation

Add `scopeMode: 'legacy' | 'org_native'` to the existing opening input/CLI, defaulting to `legacy`. The explicit `org_native` path resolves an already approved V2 policy binding and freezes scopes in one serializable transaction. This code path is preparatory; no production cycle is opened by implementation or verification.

The first org-native open uses the database transaction clock for actual `openedAt`. Do not reconstruct historical org membership from a caller-supplied backdated opening time. Replays return the identical already-frozen snapshot. Reject a first product opening when that cycle already has legacy cohorts or bound collection windows; reject a conflicting legacy open after a product freeze. These typed conflicts avoid a false success from the legacy early return and avoid silently backfilling today's hierarchy into a past cycle.

Both legacy and org-native opening paths must acquire the same cycle advisory lock, using the tenant/definition/period key and order already used by the `0030` window-policy trigger, before mode checks or audience reads. Check opposite-mode records and finish the entire open under that lock; serializable retry is also required. Different-table uniqueness alone cannot exclude cross-mode races. Test legacy-versus-product concurrent opening, not just two product retries.

Persist, in new `survey-report-scopes.ts` schema:

| Record | Required identity/invariants |
| --- | --- |
| `survey_report_cycle_openings` | Tenant + existing cycle-policy UUID unique; actual opening timestamp, scope contract version. Commit only a complete snapshot; no visible partially opened state |
| `survey_report_scopes` | UUID, tenant/cycle, kind `team` or `manager_overall`, org team/unit identities, parent scope, frozen labels and opening owner for audit; stable history key and boundary fingerprint |
| `survey_report_participants` | Unique cycle/person and cycle/runtime-user identity; frozen opening role/origin unit/team. Mutable earliest collection-stop metadata is separate from immutable affiliation |
| `survey_report_scope_memberships` | Unique scope/participant; tenant/cycle consistency; authoritative frozen denominator membership |
| `survey_report_window_bindings` | Unique window and cycle/participant; validate window tenant/user/definition/period/policy; never silently rebind |

Use composite tenant FKs, natural-key uniqueness, scope-kind checks, and guards preventing affiliation/membership rewrites after opening. New schema must not introduce FK behavior that prevents existing typed erasure/retention cleanup. Explicitly test lifecycle deletion behavior instead of allowing a live org deletion to erase historical audiences accidentally.

Team membership contains eligible direct employees, excluding its opening TL. A team scope supplies both the TL's direct-team report and the Manager's team section; the requested view determines its threshold/visibility. Manager overall membership is the deduplicated union of subordinate employee memberships plus each eligible opening TL. Exclude the Manager's own experience, HR/HRBP/Leadership, and unit-only unassigned employees from this stated scope. Preserve empty/small team scopes so later builders can show their labels with insufficient data. Apply the existing active/consent/deletion eligibility contract at opening; creating permission metadata must never grant consent.

`findOrCreateActiveWindow` must resolve frozen product participation before its legacy fallback. Create the window, existing V2 policy binding, new participant/window binding and logical question lineages atomically. Product windows have null legacy cohort/team columns. A stopped/nonparticipant product user gets a typed collection-unavailable result, not a fallback to a destination team or an unhandled coaching-turn failure. Do not dispatch legacy group reports for product windows.

History identity uses tenant + scope kind + org team/unit UUID. A Manager boundary fingerprint captures the subordinate team UUID set; it excludes employee IDs, owner/account IDs and display labels. RPT-05 decides version/boundary comparability; roster-only changes retain history with a caveat. Pilot snapshots are not automatically product baselines.

Opening owner is audit metadata, not a Slack delivery target. RPT-07 must resolve an authorized recipient and freeze it at assembly; assembled snapshots cannot silently retarget. This story adds no recipient-replacement delivery behavior.

## 2. Durable collection stops and receipt policy

Persist the earliest applicable `collectionStoppedAt`, typed cause, and hierarchy audit/mutation identity inside the same transaction that moves, promotes or deactivates a person, team or unit. Cover replaced TLs and transfers of teams between units. Keep the original participant and membership rows; do not decrement the denominator for these events. A later cycle uses current affiliations.

New product collection uses `[max(periodStart, openedAt), min(periodEnd, collectionStoppedAt ?? periodEnd))`. Apply the actual opening lower bound even when no stop exists. A durable source answer and required confirmation must each lie in this interval. Pre-opening queued admissions do not become eligible merely because they execute after opening. A confirmation received after the stop cannot qualify merely because the answer predates it. Missing trusted receipt metadata is an ineligible source, never a fabricated time.

Add a small application policy returning allowed/stopped/full-withdrawal/lineage-excluded/missing-proof outcomes from explicit metadata. A partial exclusion blocks only its specified lineage, not unrelated topics or all personal collection. Invoke the policy before new product probing/capture, confirmation staging/verdict application, and before permanent finalization commits. Use normal survey-unavailable/skip behavior so personal coaching remains available. Update `survey-evidence.use-case.ts` as well as backlog, conversation and proactive callers to handle typed unavailability.

Use one lock order across record types: cycle lock when opening, then subject permission/participation state in stable subject-ID order, then working/analytical rows in stable row-ID order. Apply this order consistently to capture, verdict, finalization, withdrawal and hierarchy stop transactions; current finalization's working-row-first lock must be revised wherever the new permission state applies. Recheck after model calls; never hold database locks over provider calls. Race fixtures must exercise cross-type operations, not only same-request retries.

Copy content-free accepted receipt identity/time into finalized revision metadata before private working purge. Existing `confirmedAt` semantics remain unchanged. Pre-stop receipt-backed work may finalize after a stop; post-stop work may not. RPT-03 extends the same proof boundary to quantitative Engagement. RPT-05 consumes permanent proof only and must preserve departed contributors instead of applying the pilot reader's current-active-user filter.

## 3. Full/partial permission commands and logical lineages

Provide an application use case/port and transactional database adapter. No employee-facing HTTP/Slack withdrawal entrypoint exists today. Do not reuse `surveyEnabled`, onboarding participation, bundle agree/reject/decline, or company-admin hierarchy capability as reporting permission. This story exposes no new public route and makes no claim that an employee-facing rights workflow is complete.

Commands require explicit tenant, subject runtime-user/person binding, verified-subject or authorized internal rights-request provenance, durable request identity, and a discriminated target:

- `full_reporting`: durable denial of future reporting use for that subject until a separately authorized grant workflow; this story implements no grant. Exclude all covered inputs from future delivery and remove that subject from affected unpublished intermediate denominators.
- `partial_reporting`: explicit logical lineage UUIDs belonging to the same tenant/subject. Exclude those lineages across their surviving revisions/corrections; keep denominator membership and unrelated inputs. Do not interpret one cycle's question exclusion as a permanent ban on that stable key in every future cycle.

Persist current negative permission/revision state separately from append-only idempotent request/exclusion records. Absence of a full denial is not a consent grant. Use the trusted request admission time, never a model-supplied timestamp. The use case accepts only verified request context, not arbitrary admin claims; tests reject missing/wrong-subject provenance and tenant mismatch. Binding this port to an actual employee-request adapter is an explicit RPT-08 activation prerequisite.

Define content-free `survey_report_question_lineages`, unique by `(tenantId, cycleScoringPolicyId, userId, questionStableKey)`. Snapshot question ID/version and scoring policy as validation metadata; revision, working ID, confirmation time, audience and team are not lineage identity. Register bound catalog lineages with product window creation; all corrections attach to the same identity. Partial exclusion cannot be bypassed by replacing a working row or creating a new finalized revision.

Surviving historical V2 revisions can receive lineage metadata only through validated immutable joins: insight → window (tenant/user/definition/period) → cycle/window policy → policy version → question definition/version/stableKey. Include noncurrent and already withdrawn revisions. Never retrieve private source text, infer current org membership, resurrect deleted content, or reinterpret a metadata backfill as receipt-backed reportability. Unresolved metadata remains explicitly ineligible, with content-free diagnostics.

Withdrawal and finalization must serialize on the same subject permission/participation state. Every V2 finalization, including a legacy-cohort V2 window, must honor applicable full/lineage exclusions; it cannot bypass them by lacking an org-native participant binding. Opening/stop-time proof remains specific to org-native collection; this does not rewrite legacy timestamps or upgrade legacy eligibility. The transaction records exclusions/revision, marks affected surviving permanent V2 revisions withdrawn, and cancels affected pilot snapshots only when provably pending and unattempted. Preserve attempted-pending and `delivery_unknown` attempt/reconciliation evidence and logical publication identity; never clear ambiguity or create a resend opportunity. New product snapshot invalidation/permission-revision checks remain mandatory RPT-07 consumers; delivered snapshots stay immutable. Delayed finalization must recheck and cannot recreate reportable withdrawn content.

Use existing typed retention duties for analytical content and audit provenance. Removing expired insight text must not remove a still-needed suppression tombstone or reset a full denial to allowed. Add cleanup coverage for new metadata; no new private text belongs in these tables. Account erasure remains its separate rights contract and must not be blocked or undermined by new FKs.

## 4. Ownership and implementation surfaces

- Application: new scope contracts/resolver, receipt/permission policy and withdrawal command port under `packages/application/src/ports/` and `use-cases/`; extend existing opening use case. Reuse RPT-01 only for threshold projections.
- Persistence: new schema module, exports, generated forward migration/metadata, migrated DB fixtures and retention integration. The journal currently ends at index 53; generate the next migration instead of editing applied history.
- Worker: dedicated `pulse-report-scope.repository.ts` and permission adapter, opening/window branch and module wiring, source admission/finalization integration in `question-insight.repository.ts`.
- API hierarchy: transaction-local stop writes in `hierarchy-mutation.service.ts` and `hierarchy-deactivation.service.ts`; preserve independent onboarding event behavior.
- CLI: explicit org-native opening input, mode conflicts and same-snapshot replay. Default legacy behavior stays compatible.

RPT-02 is complete only after the actual new opening/window/lifecycle/permission transactions and their races pass. It does not complete the RPT-05 report reader, RPT-06 payloads, RPT-07 delivery, quantitative Engagement, calendar/localization, production migration or external rights adapter. Existing pilot source selection is not silently relabeled as the new audience contract.

## 5. Required verification

Use synthetic fixtures. Prove org-only teams need no legacy mapping; 5+5 employees/TLs count 12 overall and 5 per team; empty/small teams remain scopes; malformed hierarchy fails atomically. Race repeated opens and legacy/product mode conflicts under the common cycle lock; assert no partial/backfilled snapshot and no window rebinding. Exclude pre-opening, cycle-end and post-cycle admissions even if processing occurs inside a later transaction.

Prove confirmation admitted before move/deactivation can finalize afterward in the original affiliation; post-stop or missing receipt cannot; a destination scope receives no copied old insight. Prove lifecycle stop and finalization/withdrawal races honor the same lock and preserve the earliest stop. Personal coaching cannot fail merely because collection stopped.

Prove full 10→8 denominator gives threshold 7; partial keeps denominator 10/threshold 8 and breaks 3/3 without losing unrelated qualitative content or blocking unrelated collection. Repeated request is idempotent; tenant/wrong-subject/admin-only attempts fail. Revisions/corrections and retention cleanup cannot resurrect withdrawn inputs. Delivered pilot snapshots remain byte-identical; attempted/ambiguous pending evidence cannot be cleared or retried through withdrawal recovery.

After offline dependencies/builds, use application tests, worker focused tests plus migrated repository fixtures, API hierarchy tests and full database integration (a migration changes that gate). Verify on a fresh isolated local PostgreSQL database; never reset the shared developer DB. Supply an isolated Redis database for any queue fixtures. Capture command diagnostics outside the structured harness receipt. No connector payload, model call, production operation or archived MAF smoke is part of this story's deterministic verification.

## Planning review resolutions

Two read-only source reviews identified and resolved seven concrete specification gaps before approval: shared cross-mode cycle locking; unconditional opening/cycle admission bounds; preserving ambiguous delivery evidence; consistent subject-before-working lock order; lineage-specific partial exclusions; explicit survey-evidence unavailability handling; and applying permission exclusions to V2 finalization independently of org-native binding. These are design resolutions, not passed runtime regressions. The matrix/race fixtures must prove them during implementation.
