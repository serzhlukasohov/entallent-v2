---
title: 'Dashboard team tab: who reports to whom'
type: 'feature'
created: '2026-10-14'
status: 'done'
baseline_commit: '2801bba3a48ad9d7aa8d5f0333f3d0a30ac91597' # working-tree snapshot after uncommitted specs 1-2 (refs/bmad/spec3-baseline)
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The "Команда" tab (`/`) shows the current cohort's survey progress. It does not show who is on the team or the reporting hierarchy, which is what the PO needs from it. The cohort/progress table is now duplicated by the cycle detail page from spec 1.

**Approach:** Add an admin read endpoint that returns the tenant's hierarchy as a tree: unit with manager → teams with lead → employees, plus employees placed directly in the unit. It is read from the new org model. When the tenant has no active org units, it falls back to legacy `teams` + `team_memberships`. Replace `/` with a tree view of this hierarchy. This is spec 3 of 3.

## Boundaries & Constraints

**Always:**
- Only `lifecycle_status = 'active'` units, teams, placements, and people are read from the org model.
- Legacy fallback uses active memberships (`left_at IS NULL`). Each legacy team becomes one unit. Its manager is resolved from `manager_slack_user_id` through a linked Slack `channel_accounts` row, and shows the raw Slack id when unresolved. Members are direct unit members.
- The response states `source: 'org' | 'legacy' | 'none'`. All queries are tenant-scoped. The endpoint uses `ApiKeyGuard` + `assertInternalDashboardEnabled` with `Cache-Control: private, no-store`.
- Names: org persons use `people.display_name`; legacy users use their linked Slack `display_name`, else `Участник N`.
- The dashboard shows the tree only under the existing Test AI Agent tenant gate and `QA_PRIVATE_VIEW_ENABLED`, the same as other named views.
- Sorting is by unit name, then team name, then person name. UI copy is in Russian.

**Ask First:** Any database migration, any change to hierarchy write services or Company Setup endpoints, or showing emails or employee ids.

**Never:**
- Do not expose work email, customer employee id, Slack ids of employees, or any survey/insight data.
- Do not reuse the company-admin OIDC session.
- Do not modify `CompanySetupReadService`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Org model | Active units/teams/placements | `source: 'org'`; units with manager, teams with lead and members, directMembers | N/A |
| Unit without teams | Employees placed with `team_id` null | Listed under the unit as direct reports | N/A |
| Inactive people | Manager/lead person not active; draft or inactive teams/placements | Manager/lead shown as `null` ("не назначен"); inactive teams and placements omitted; an empty unit still shows | N/A |
| Legacy fallback | No active org units, legacy teams exist | `source: 'legacy'`; one unit per team, manager name or raw Slack id | N/A |
| Nothing | No org units and no legacy teams | `source: 'none'`, `units: []`; UI shows "Иерархия ещё не настроена" | N/A |
| Bad tenant | Non-UUID tenantId | 400 | BadRequestException |
| Dashboard gate off | QA flag off or other tenant | QA-mode notice | null-safe render |

</frozen-after-approval>

## Code Map

- `packages/database/src/schema/organization.ts`, `people.ts`, `teams.ts`, `channel-accounts.ts` -- `org_units.manager_person_id`, `org_teams.team_lead_person_id`, `org_employee_placements(employee_person_id, unit_id, team_id)`, `people.id = users.id`, legacy `teams.manager_slack_user_id`, `team_memberships(team_id, user_id, left_at)`
- `apps/api/src/hierarchy/legacy-reconciliation.read.ts` -- reference reads of both models (do not modify)
- `apps/api/src/admin/v2-pilot.controller.ts` / `.read-model.ts` / `.test.ts` -- controller, raw-SQL read-model, and vitest patterns to mirror
- `apps/api/src/admin/admin.module.ts` -- register controller + provider
- `packages/contracts/src/index.ts` -- contract exports
- `apps/dashboard/src/app/page.tsx`, `lib.ts` -- home page to replace; gated fetchers

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/admin-team-hierarchy.ts` -- `AdminTeamHierarchyPerson {id, displayName, role}`, `AdminTeamHierarchyTeam {id, name, lead, members}`, `AdminTeamHierarchyUnit {id, name, manager, teams, directMembers}`, `AdminTeamHierarchyResponse {tenantId, source, checkedAt, units}`; export them from `index.ts`.
- [x] `apps/api/src/admin/team-hierarchy.read-model.ts` -- `getHierarchy(tenantId)` reads the org model first, then the legacy fallback. A pure `buildOrgHierarchy(rows)` / `buildLegacyHierarchy(rows)` does the tree assembly and sorting.
- [x] `apps/api/src/admin/team-hierarchy.controller.ts` + `admin.module.ts` -- `GET admin/team-hierarchy?tenantId=`.
- [x] `apps/api/src/admin/team-hierarchy.read-model.test.ts` -- tests for tenant validation, org tree assembly (team members vs direct members, a lead also placed in their team appearing once as lead, sorting), legacy fallback with resolved and unresolved manager, `none`, and no email/employee-id fields in output.
- [x] `apps/dashboard/src/app/lib.ts` -- `fetchAdminTeamHierarchy()` behind the tenant + QA gates.
- [x] `apps/dashboard/src/app/page.tsx` -- replace the cohort table with the tree. Each unit is a card: manager on top, then team blocks ("Тимлид: …", members), then "Напрямую у руководителя". Show headcount per unit and a source note ("Оргструктура" / "Старые команды Slack").

**Acceptance Criteria:**
- Given an active org hierarchy, when `/` loads, then the PO sees each manager, the teams under them with their leads, and every active employee exactly once.
- Given only legacy teams, when `/` loads, then the tree still shows team → manager → members and labels the source as legacy.

## Design Notes

A team lead normally also has an active placement in their own team. Render the lead in the team header and exclude them from that team's member list, so nobody appears twice.

## Verification

**Commands:**
- `pnpm --filter @entalent/contracts build` -- expected: success
- `pnpm --filter @entalent/api exec vitest run src/admin/team-hierarchy.read-model.test.ts` -- expected: all pass
- `pnpm --filter @entalent/api typecheck && pnpm --filter @entalent/api lint` -- expected: success
- `pnpm --filter @entalent/dashboard typecheck && pnpm --filter @entalent/dashboard lint && pnpm --filter @entalent/dashboard build` -- expected: success

## Suggested Review Order

**Hierarchy read (entry point)**

- Org model first, legacy fallback, `none`; tenant-scoped, names and roles only
  [`team-hierarchy.read-model.ts:90`](../../apps/api/src/admin/team-hierarchy.read-model.ts#L90)

- Org tree: managers/leads shown once; placement in inactive team stays with the unit
  [`team-hierarchy.read-model.ts:38`](../../apps/api/src/admin/team-hierarchy.read-model.ts#L38)

- Legacy tree: active non-deleted members, blank names fall back, stable `Участник N`
  [`team-hierarchy.read-model.ts:68`](../../apps/api/src/admin/team-hierarchy.read-model.ts#L68)

- Route: API key, internal-dashboard gate, no-store
  [`team-hierarchy.controller.ts:17`](../../apps/api/src/admin/team-hierarchy.controller.ts#L17)

**Team tab**

- Tree view replaces the cohort table; source note and empty states
  [`page.tsx:62`](../../apps/dashboard/src/app/page.tsx#L62)

- Fetcher behind the QA flag and pilot-tenant gate
  [`lib.ts:79`](../../apps/dashboard/src/app/lib.ts#L79)

**Peripherals**

- Contract; the only Slack id exposed is an unresolved legacy manager
  [`admin-team-hierarchy.ts:1`](../../packages/contracts/src/admin-team-hierarchy.ts#L1)

- Tests: validation, tree assembly, de-duplication, legacy fallback, none
  [`team-hierarchy.read-model.test.ts:30`](../../apps/api/src/admin/team-hierarchy.read-model.test.ts#L30)
