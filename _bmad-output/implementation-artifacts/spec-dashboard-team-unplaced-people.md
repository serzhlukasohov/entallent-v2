---
title: 'Dashboard team tab: people outside the org structure'
type: 'feature'
created: '2026-10-15'
status: 'in-review'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `GET /admin/team-hierarchy` reads only the org model once a tenant has an active org unit. In production the Test AI Agent tenant has one active unit with 2 people while the V2 pilot cohort has 6 participants, so 4 real participants are invisible on the "Команда" tab.

**Approach:** Add an `unplaced` list to the hierarchy response: active tenant users who are candidates for the team (active legacy `team_memberships` member, or member of the current V2 pilot cohort roster) but are not shown anywhere in the returned tree. Each entry carries the person's legacy team and its manager when known and whether they are in the V2 cohort. The dashboard renders them as a "Не в оргструктуре" card under the tree.

## Boundaries & Constraints

**Always:**
- The rule is source-independent: `unplaced = candidates − every id already in units` (managers, leads, members, direct members). For `source: 'org'` this lists people without an active placement; for `legacy` it lists cohort members with no legacy team; for `none` it lists the cohort.
- Candidates are users with `status = 'active'` and `deleted_at IS NULL` in the same tenant. All queries are tenant-scoped.
- The current V2 cohort is resolved by the same rule as the V2 pilot views (`selectCurrentPilotCohort` over V2 cohorts with a cycle scoring policy); no cohort means no cohort candidates.
- Names: linked Slack `display_name`, else active `people.display_name`, else `Участник N` numbered deterministically by user id within the list. Sorted by name.
- Legacy manager is resolved the same way as the legacy fallback tree (linked Slack account name, else the raw manager Slack id — the existing documented exception).
- Dashboard keeps the QA flag + pilot-tenant gate; UI copy in Russian.

**Ask First:** Any database migration; any write to org/legacy tables; exposing emails, employee ids or employee Slack ids.

**Never:**
- No work email, customer employee id, employee Slack id, survey answers or insight data in the response.
- Do not change the org/legacy tree assembly or the source selection rule.
- Do not modify Company Setup or hierarchy write services.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Partial org rollout | 1 active unit with 2 placed people; 4 more cohort/legacy users | `source: 'org'`, tree unchanged, `unplaced` has the 4 with legacy team + manager | N/A |
| Already shown | Candidate is a unit manager or team lead without placement | Not in `unplaced` | N/A |
| Cohort only | Roster user with no legacy membership | Entry with `legacyTeam: null`, `inCurrentCohort: true` | N/A |
| Inactive user | Roster or member user deleted/inactive | Omitted | N/A |
| No cohort | Tenant has no V2 cohort | Only legacy candidates considered | N/A |
| Everyone placed | All candidates in tree | `unplaced: []`, UI hides the card | N/A |

</frozen-after-approval>

## Code Map

- `packages/contracts/src/admin-team-hierarchy.ts` -- response contract
- `apps/api/src/admin/team-hierarchy.read-model.ts` -- org/legacy reads + pure builders
- `apps/api/src/admin/v2-pilot.read-model.ts` -- `selectCurrentPilotCohort`, private V2 cohort listing query to share
- `apps/api/src/admin/team-hierarchy.read-model.test.ts` -- mocked `execute` sequence tests
- `apps/dashboard/src/app/page.tsx` -- team tab render

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/admin-team-hierarchy.ts` -- add `AdminTeamHierarchyUnplacedPerson { id, displayName, legacyTeam: { name, manager: AdminTeamHierarchyManager | null } | null, inCurrentCohort }` and `unplaced` on the response.
- [x] `apps/api/src/admin/v2-pilot.read-model.ts` -- export a `listV2PilotCohorts(db, tenantId)` query used by both read models.
- [x] `apps/api/src/admin/team-hierarchy.read-model.ts` -- after building units (all sources), read candidates in one tenant-scoped query (legacy members ∪ current roster, active users, legacy team/manager, names) and project with a pure `buildUnplaced(units, rows)`.
- [x] `apps/api/src/admin/team-hierarchy.read-model.test.ts` -- cover the matrix, tenant scoping, no PII fields.
- [x] `apps/dashboard/src/app/page.tsx` -- "Не в оргструктуре" card listing name, "Команда: … · Руководитель: …" or "Нет старой команды", and a "V2-когорта" badge; include count in the subtitle; show the card even when `units` is empty.

**Acceptance Criteria:**
- Given the production shape (1 unit, 2 placed, 6 cohort participants), when `/` loads, then all 6 participants are visible exactly once across the tree and the "Не в оргструктуре" card.

## Design Notes

Subtracting "ids already in the tree" (rather than "has active placement") keeps the rule correct for every source and prevents double listing of managers/leads who have no placement row. `people.id = users.id`, so org and user ids share one space.

## Verification

**Commands:**
- `pnpm --filter @entalent/contracts build` -- success
- `pnpm --filter @entalent/api exec vitest run src/admin/team-hierarchy.read-model.test.ts src/admin/v2-pilot.read-model.test.ts` -- pass
- `pnpm --filter @entalent/api typecheck && pnpm --filter @entalent/api lint` -- pass
- `pnpm --filter @entalent/dashboard typecheck && pnpm --filter @entalent/dashboard lint && pnpm --filter @entalent/dashboard build` -- pass

**Manual checks:**
- Local fixture (ids prefixed `f1f1f1f1`) with 1 org unit + legacy team + cohort; `/` shows the unplaced card.
