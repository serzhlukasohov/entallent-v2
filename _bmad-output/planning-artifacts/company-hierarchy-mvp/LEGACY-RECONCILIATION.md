---
title: Company Hierarchy MVP — Legacy Reconciliation Gate
document_type: migration-review-plan
status: awaiting-tenant-report
source_spec: _bmad-output/specs/spec-company-hierarchy-mvp/SPEC.md
---

# Legacy Team reconciliation gate

The old `teams` record has a name and `manager_slack_user_id`, but no stable customer Team key, Unit key, or separate Team Lead. These cannot be inferred from a Slack address or a Team name. No backfill or read-path cutover should run until the tenant-specific report and mapping are reviewed.

## Read-only report

Run against an explicitly identified target database and tenant:

```sh
TENANT_ID=<tenant-uuid> DATABASE_URL=<target-database-url> node --import tsx apps/api/scripts/reconcile-legacy-hierarchy.ts > /secure/location/legacy-hierarchy-report.json
```

The script uses a repeatable-read, read-only transaction and emits no credentials. Treat the resulting IDs, Team names, and membership list as customer data. Store the report in a restricted location outside Git.

The report inventories active legacy memberships, linked Slack manager candidates, provisioned Person roles, new Unit/Team marker matches, and membership drift. It can run before the new hierarchy migrations: `schemaReady: false` then means Person/Unit/Team comparisons are unavailable and all approval decisions remain open. In that old schema, Slack accounts have no `link_status` column, so the report treats existing accounts as linked. A partially applied hierarchy schema fails closed, including the case where new tables exist without `link_status`. Re-run after migration with `schemaReady: true` before any backfill. A `legacy:<old-team-uuid>` Team key is only an optional exact marker; its presence does not prove customer approval.

## Mapping decision per legacy Team

Record these fields in the reviewed mapping before any write:

| Field | Required decision |
| --- | --- |
| `legacyTeamId` | Existing Team UUID from the report |
| `customerTeamKey` | Customer-approved stable key for the new Team |
| `customerUnitKey` | Existing or newly approved Unit key |
| `managerPersonId` | Same-tenant Person with Manager role for that Unit |
| `teamLeadPersonId` | Same-tenant Person with Team Lead role for that Team |
| `memberPersonIds` | Exact active Employee membership set after resolving report issues |

The Manager and Team Lead must be confirmed separately. Existing `manager_slack_user_id` may help identify a candidate but does not determine either role. Missing or ambiguous people, cross-tenant membership, and conflicting role/lifecycle values stay quarantined until resolved.

## Reviewed manifest and draft backfill

The report's `sourceFingerprint` is a SHA-256 digest of the tenant ID, legacy Team IDs/names/Slack manager IDs, and active membership rows. Any change to those source rows requires a fresh report and approval. Store the approved manifest outside Git alongside the restricted report:

```json
{
  "schemaVersion": 1,
  "tenantId": "<tenant-uuid>",
  "sourceFingerprint": "<64-character fingerprint from the report>",
  "teams": [{
    "legacyTeamId": "<legacy-team-uuid>",
    "customerTeamKey": "<approved-stable-team-key>",
    "teamName": "<approved-team-name>",
    "customerUnitKey": "<approved-stable-unit-key>",
    "unitName": "<approved-unit-name>",
    "managerPersonId": "<same-tenant-manager-person-uuid>",
    "teamLeadPersonId": "<same-tenant-lead-person-uuid>",
    "memberPersonIds": ["<exact-active-employee-person-uuid>"]
  }]
}
```

Classify every legacy Team in the manifest: map it to the new hierarchy or explicitly quarantine it. A quarantined Team remains only in the legacy reporting path, creates no Person/Unit/Team/placement rows, and must be named by exact legacy Team ID and reason (`test_fixture` or `outside_customer_scope`). A Team cannot be both mapped and quarantined. The source fingerprint still covers its members, so drift requires a new report and approval. For mapped Teams, the exact active membership set is mandatory. The planner checks Person roles and lifecycle, existing draft ownership/placement conflicts, Team and Unit definitions, tenant scope, and the source fingerprint. It does not infer a Manager or Team Lead from Slack. New hierarchy records remain draft and the old Team rows are retained.

For a tenant whose only legacy Team is approved as a test fixture, the manifest may contain an empty `teams` array and this quarantine entry:

```json
"quarantinedTeams": [{ "legacyTeamId": "<legacy-team-uuid>", "reason": "test_fixture" }]
```

Review the dry-run JSON and confirm `counts`, owners, names, keys, and members before applying:

```sh
TENANT_ID=<tenant-uuid> DATABASE_URL=<target-database-url> \
  BACKFILL_MANIFEST_PATH=/secure/location/approved-manifest.json \
  node --import tsx apps/api/scripts/backfill-legacy-hierarchy.ts > /secure/location/backfill-dry-run.json
```

For the reviewed tenant and database only, apply the same manifest with an identified operator. `CONFIRM_HIERARCHY_BACKFILL` must exactly match `TENANT_ID`:

```sh
TENANT_ID=<tenant-uuid> DATABASE_URL=<target-database-url> \
  BACKFILL_MANIFEST_PATH=/secure/location/approved-manifest.json \
  OPERATOR_ID=<operator-id> CONFIRM_HIERARCHY_BACKFILL=<tenant-uuid> \
  node --import tsx apps/api/scripts/backfill-legacy-hierarchy.ts --apply \
  > /secure/location/backfill-apply.json
```

Apply uses a serializable transaction, locks the tenant and legacy source rows, rechecks the live snapshot and post-write state, and records an audit event. A repeat with the same manifest should report zero new Units, Teams, and placements. A successful draft backfill does not authorize Unit activation or a current reporting read cutover.

## Cutover gates

1. Approve the per-tenant mapping or quarantine classification for every legacy Team explicitly. Re-run the report if its source fingerprint changes.
2. Apply a forward-only, idempotent draft backfill in a transaction; preserve old Team rows and historical membership records.
3. Re-run the report and compare Team IDs, active member Person IDs, Unit/Team ownership, and counts. Resolve every mismatch before activation.
4. Validate active graph and runtime eligibility with the full migration chain, PostgreSQL, Redis, and Slack acceptance.
5. Switch the affected read paths to the new hierarchy only after the evidence above passes; retain old structures for rollback and historical reporting until their consumers are migrated.

Current status: the report, planner, dry-run, and explicit draft apply passed on a synthetic tenant in a separate local pgvector/PostgreSQL 16 database with the full migration chain, including zero dry-run writes and an idempotent repeat. On 2026-09-27, the user confirmed Railway production tenant `Test AI Agent` as the target and classified its only legacy Team, `QA Grill Verification 2026-09-08` (five active memberships), as a test fixture to remain in the legacy path. Restricted reports and the quarantine manifest are stored outside Git under `/private/tmp/entalent-legacy-hierarchy-*-2026-09-27.json` with mode `0600`. With the user's authorization, migrations `0018`–`0025` were applied to Railway project `reasonable-adaptation`, environment `production`, database `railway`: the migration count rose from 18 to 26 and the hierarchy tables became available. The post-migration report has `schemaReady: true` and the same source fingerprint as the approved manifest. The post-migration dry-run and confirmed apply each planned zero new Units, Teams, or placements and one quarantined Team. The apply recorded `org.legacy.backfill_draft`; verification found zero Person/Unit/Team/placement rows and the legacy Team retained. No Unit activation or cutover has run. The corporate IdP is still unknown.

The existing local `entalent` database was left untouched. It currently has four active tenants, no legacy Team rows, and no `people` table, so it cannot supply a customer mapping or serve as hierarchy acceptance evidence.

## Current read-path cutover inventory

| Consumer | Current source | Cutover requirement |
| --- | --- | --- |
| New survey cycle roster (`apps/worker/src/survey/repositories/survey.repository.ts`) | Legacy `teams` and `team_memberships` | Keep legacy Team identity and recipient coupling until the separate reporting launch. New rosters already exclude draft, inactive, and non-Pulse Persons. Before that launch, reconcile active `org_teams` and `org_employee_placements` against roster counts and define direct Unit Employee reporting semantics. |
| Current Team lookup (`apps/worker/src/survey/repositories/team.repository.ts`) | Legacy membership and `teams.manager_slack_user_id` | This is a survey/reporting lookup, not an organizational owner lookup. Keep its legacy Team identity and recorded recipient until the separate reporting launch; preserve frozen `survey_reporting_cohorts` lookup for existing cycles. New setup and hierarchy operations resolve ownership only through active Person/Unit/Team records. |
| Group state roster eligibility (`apps/worker/src/survey/repositories/group-state.repository.ts`) | Legacy membership at the reporting cycle boundary | Keep historical cohort membership immutable and current report membership on the legacy cohort path until the separate reporting launch. Define the current versus historical roster boundary before changing this query. |
| Group report recipient (`packages/application/src/use-cases/group-report.use-case.ts`, `apps/worker/src/survey/group-report.processor.ts`) | Legacy `manager_slack_user_id` | Product decision on 2026-09-27: retain previous report recipients until a separate reporting launch. Do not treat this Slack ID as new hierarchy ownership or replace it with the new Manager/Team Lead during hierarchy cutover. Existing report snapshots retain their recorded destination. |
| Confirmation deidentification (`packages/application/src/use-cases/conversation-orchestrator.ts`) | Legacy reporting Team identifiers plus active hierarchy identifiers | Keep the reporting Team lookup for cohort behavior. Query active Unit/Team and scoped Person/Slack identifiers separately so newly provisioned participants cannot bypass the existing known-identifier filter while report routing remains unchanged. |
| Internal development dashboard (`apps/api/src/admin/manager-dashboard.read-model.ts`, `apps/api/src/admin/pulse-overview.controller.ts`) | Tenant-wide runtime users and existing survey records | Do not present it as customer hierarchy/reporting UI. New current lists exclude provisioned non-Pulse/draft/inactive Persons; historical aggregates need separate migration review. |
| Internal aggregate analytics (`apps/api/src/admin/analytics.controller.ts`) | Existing messages, risk signals, surveys and runtime users | Current metrics now exclude provisioned non-Pulse/draft/inactive Persons while admitting legacy users. Historical metric semantics must be reviewed before any customer reporting use. |

The new Person eligibility predicate is additive to the compatibility runtime: it admits a user with no Person row, and admits a provisioned Person only when active and Pulse-participating. It does not establish that legacy Team rows match the new Unit/Team graph. Never infer a Manager or Team Lead from `manager_slack_user_id`.

The approved hierarchy cutover changes organizational ownership and setup/rollout reads after tenant reconciliation. It does not launch new Team/Unit reports or alter report routing. Before the separate reporting launch, define recipient and privacy rules and reconcile current and historical cohorts; that launch owns the survey/reporting read-path migration.
