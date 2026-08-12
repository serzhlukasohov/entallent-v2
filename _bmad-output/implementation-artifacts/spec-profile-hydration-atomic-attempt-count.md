# Profile Hydration Atomic Attempt Count

Status: implemented
Date: 2026-08-12

## Problem

Profile hydration observability stored `profileHydration.attemptCount` inside
`channel_accounts.profile_metadata`. The worker repository previously used a
read-modify-write sequence:

1. select matching channel account metadata
2. read the current JSON attempt count in application code
3. update the JSON document

Concurrent hydration jobs for the same account could both read the same value
and write the same incremented value, losing one attempt.

## Scope

- Keep the existing JSONB-backed metadata shape.
- Keep admin/dashboard contracts unchanged.
- Preserve channel account scoping by tenant, channel type, workspace, and user.
- Do not introduce a schema migration in this slice.

## Acceptance Criteria

- `recordProfileHydrationOutcome` writes hydration metadata with a single
  database `UPDATE`.
- `profileHydration.attemptCount` is incremented in PostgreSQL, not in
  application read-modify-write code.
- Dirty or missing JSON attempt counts safely reset to zero before increment.
- Existing operational redaction for hydration errors remains in place.
- Worker tests cover the atomic update behavior.

## Implementation Notes

- `apps/worker/src/profile/user-profile.repository.ts` now builds a Drizzle SQL
  expression using `jsonb_set` and `jsonb_build_object`.
- The update preserves non-hydration metadata fields because `jsonb_set` writes
  only the `profileHydration` key.
- Non-object metadata is normalized to `{}` inside SQL before `jsonb_set`.
- `lastSuccessAt` is refreshed on success and preserved for non-success outcomes.
- The attempt count cast is guarded with a numeric regex to avoid failing on
  malformed JSON values.

## Verification

- `pnpm --filter @entalent/worker test -- user-profile.repository.test.ts`
- `pnpm --filter @entalent/worker test -- user-profile.repository.test.ts conversation.processor.test.ts conversation.module.test.ts`
- `pnpm --filter @entalent/worker typecheck`
