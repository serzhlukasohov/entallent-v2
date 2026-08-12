---
title: 'Profile Facts Owner'
type: 'refactor'
created: '2026-08-12'
status: 'done'
review_loop_iteration: 0
baseline_commit: '8526e347023d3842210f24359d579153aad68e56'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** User identity/profile facts are written by multiple paths with local rules: ingestion writes initial names, profile hydration updates Slack facts, and backfill tooling has another copy of display-name logic. That drift is exactly how dashboard name behavior can regress after a local fix.

**Approach:** Introduce one application-owned profile facts policy that normalizes external display names and decides when external channel facts may populate `users.preferred_name` versus only `channel_accounts.display_name`. Convert runtime writers and current Slack backfill tooling to use that policy while preserving existing visible dashboard behavior.

## Boundaries & Constraints

**Always:** Preserve tenant scoping, current DB tables, current dashboard name fallback, and the rule that a non-empty existing `users.preferred_name` wins over external Slack display names. Treat blank names and names equal to the external user ID as unusable display names. Keep timezone update behavior compatible with current hydration.

**Ask First:** Any schema migration, new profile table, user-facing rename/edit feature, dashboard UI redesign, destructive backfill behavior, or change that overwrites an existing non-empty preferred name.

**Never:** Do not make manager dashboard display names nullable, do not remove user ID fallback, do not change Slack API scopes, do not store raw Slack profiles, and do not combine this with the larger backfill hardening story.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| New channel user | No user exists; external display name is usable | User and channel account are created with normalized preferred/channel display name | N/A |
| Existing preferred name | User has `preferred_name = "Alice"`; Slack returns `"Slack Alice"` | Preferred name remains `"Alice"`; channel display name can update to `"Slack Alice"` | N/A |
| Missing preferred name | User has blank/null preferred name; Slack returns `"Slack Alice"` | Preferred name is populated with `"Slack Alice"` and channel account display name updates | N/A |
| Unusable external name | Slack returns blank or the external user ID | Preferred/channel display-name writes are skipped; hydration status still records outcome | N/A |

</frozen-after-approval>

## Code Map

- `packages/application/src/services/profile-facts-policy.ts` -- new single owner for display-name normalization and preferred-name merge decisions.
- `packages/application/src/services/profile-facts-policy.test.ts` -- focused tests for user-chosen names, Slack names, blanks, and external-user-id fallbacks.
- `packages/application/src/index.ts` -- exports the policy for API/worker/tooling.
- `apps/api/src/channel/ingestion.service.ts` -- new-user bootstrap write site for initial preferred/channel display names.
- `apps/worker/src/profile/user-profile.repository.ts` -- profile hydration write site for preferred name, channel display name, timezone, and metadata.
- `scripts/backfill-slack-display-names.ts` -- existing Slack name repair tooling should consume the same policy without expanding tooling scope.

## Tasks & Acceptance

**Execution:**
- [x] `packages/application/src/services/profile-facts-policy.ts` -- add normalized profile-facts policy helpers -- centralizes identity/profile write decisions.
- [x] `packages/application/src/index.ts` -- export the policy -- makes API, worker, and scripts consume one owner.
- [x] `apps/api/src/channel/ingestion.service.ts` -- apply the policy when creating users/channel accounts -- removes local initial-name rules.
- [x] `apps/worker/src/profile/user-profile.repository.ts` -- apply the policy when hydrating external profile facts -- preserves existing preferred-name ownership.
- [x] `scripts/backfill-slack-display-names.ts` -- reuse the policy for Slack display-name eligibility and preferred-name updates -- avoids another divergent copy.
- [x] Add focused tests for the policy and update existing hydration tests where needed.
- [x] Run targeted tests plus monorepo `typecheck`, `lint`, and `test`.

**Acceptance Criteria:**
- Given an existing non-empty preferred name, when Slack hydration returns a different display name, then only the channel display name updates and the preferred name is preserved.
- Given a missing preferred name, when a usable Slack display name arrives, then preferred name and channel display name are both populated consistently.
- Given Slack returns a blank display name or the external user ID, when profile facts are applied, then no display-name write is produced.
- Given ingestion creates a new user with a usable display name, when the user/channel rows are inserted, then both use the policy-normalized name.

## Spec Change Log

- 2026-08-12 -- Added application-owned profile facts policy and converted API, worker, hydration use case, and Slack backfill write paths to use it.
- 2026-08-12 -- Addressed BMad review edge case by rejecting external-user-id display names case-insensitively.

## Design Notes

This is a first-slice ownership refactor, not a new domain model. The policy lives in `@entalent/application` because both API ingestion and worker hydration already depend on that package, and scripts can import it without reaching into app-specific code.

## Verification

**Commands:**
- `pnpm --filter @entalent/application test -- profile-facts-policy.test.ts profile-hydration.use-case.test.ts` -- passed, 10 tests.
- `pnpm --filter @entalent/api typecheck` -- passed.
- `pnpm --filter @entalent/worker typecheck` -- passed.
- `pnpm --filter @entalent/application typecheck` -- passed after BMad review patch.
- `pnpm typecheck` -- passed, 23 tasks; repeated after BMad review patch.
- `pnpm lint` -- passed, 23 tasks; repeated after BMad review patch.
- `pnpm test` -- passed, 15 tasks; repeated after BMad review patch.

## File List

- `apps/api/src/channel/ingestion.service.ts`
- `apps/worker/src/profile/user-profile.repository.ts`
- `packages/application/src/index.ts`
- `packages/application/src/ports/user-profile.repository.port.ts`
- `packages/application/src/services/profile-facts-policy.ts`
- `packages/application/src/services/profile-facts-policy.test.ts`
- `packages/application/src/use-cases/profile-hydration.use-case.ts`
- `packages/application/src/use-cases/profile-hydration.use-case.test.ts`
- `scripts/backfill-slack-display-names.ts`

## Dev Agent Record

### Completion Notes

- Centralized external profile fact normalization and write decisions in `@entalent/application`.
- Preserved existing non-empty `users.preferred_name` ownership while allowing channel display names to update from usable external profile names.
- Reused the same policy in API ingestion, worker hydration, and the Slack display-name backfill script.
- Kept this as a first-slice refactor with no schema migration, no dashboard UI change, and no destructive backfill behavior.
- BMad adversarial/edge review resolved one low-cost edge case: external user IDs are now rejected case-insensitively when Slack-like fallbacks appear in display-name fields.
