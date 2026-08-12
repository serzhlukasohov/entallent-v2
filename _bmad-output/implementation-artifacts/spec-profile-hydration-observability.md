---
title: 'Profile Hydration Observability'
type: 'feature'
created: '2026-08-12'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'da66f0a2c33086974073984719741dd7c7ce3e56'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Profile hydration currently updates Slack display names when it succeeds, but missing profiles and Slack/API failures are not visible enough for operators. When the dashboard falls back to user IDs, there is no focused admin signal explaining whether hydration never ran, returned no profile, failed, or is stuck in retries.

**Approach:** Record the latest hydration outcome on each channel account and expose a tenant-filtered admin status endpoint that summarizes missing display names, last hydration attempts, and failed profile-hydration retry jobs. Preserve existing dashboard name rendering and keep the first slice read-only from the dashboard perspective.

## Boundaries & Constraints

**Always:** Keep existing profile writes to `users.preferred_name`, `users.timezone`, and `channel_accounts.display_name` behavior-compatible. Use tenant-filtered admin APIs protected by the existing admin API key guard. Store only operational status, timestamps, attempt counts, and short error/reason strings; do not store raw Slack payloads or secrets.

**Ask First:** Any new database table, migration, alert delivery integration, dashboard visual redesign, Slack token scope change, or change that makes non-Slack channel hydration fail.

**Never:** Do not make dashboard employee names nullable, do not remove the user ID fallback, do not retry profile hydration from the admin status endpoint, and do not expose bot tokens, Slack emails, or raw profile metadata in admin responses.

## I/O & Edge-Case Matrix

| Scenario             | Input / State                                                           | Expected Output / Behavior                                                                                                                           | Error Handling                                      |
| -------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Successful hydration | Slack returns a profile with display name/timezone                      | Profile facts are written as before and channel metadata records `status: "success"` with `lastAttemptAt`, `lastSuccessAt`, and incremented attempts | N/A                                                 |
| No profile available | Adapter returns `null` because account/workspace/profile is unavailable | No display name is written and channel metadata records `status: "missing_profile"` with a reason                                                    | No exception is thrown                              |
| Retryable failure    | Slack/profile fetch throws or repository write fails                    | Worker job still fails for BullMQ retry/DLQ visibility and metadata records `status: "failed"` with a short error                                    | Error is rethrown after metadata update             |
| Admin status         | Admin calls `/admin/profile-hydration/status?tenantId=...`              | Response includes summary counts, missing display-name rows with latest hydration status, and recent failed `profile-hydration` jobs                 | Existing API key guard handles unauthorized callers |

</frozen-after-approval>

## Code Map

- `packages/application/src/use-cases/profile-hydration.use-case.ts` -- application owner of profile hydration success/missing/failure outcomes.
- `packages/application/src/ports/user-profile.repository.port.ts` -- repository boundary that can record hydration metadata without leaking database details into the use case.
- `apps/worker/src/profile/user-profile.repository.ts` -- Drizzle implementation that updates user/channel profile facts and `channel_accounts.profile_metadata`.
- `apps/worker/src/profile/slack-external-profile.adapter.ts` -- Slack adapter; should let retryable Slack API failures reach the processor instead of silently becoming missing profiles.
- `apps/worker/src/profile/profile-hydration.processor.ts` -- BullMQ processor that owns job retry visibility.
- `packages/contracts/src/admin-profile-hydration.ts` -- new shared admin response contract for profile hydration observability.
- `apps/api/src/admin/profile-hydration-status.controller.ts` -- new admin endpoint combining channel metadata with failed profile-hydration jobs.
- `apps/api/src/admin/admin.module.ts` -- registers the new admin controller.
- `packages/application/src/use-cases/profile-hydration.use-case.test.ts` -- focused use-case behavior tests.

## Tasks & Acceptance

**Execution:**

- [x] `packages/contracts/src/admin-profile-hydration.ts` and `packages/contracts/src/index.ts` -- add/export shared response types for profile hydration status.
- [x] `packages/application/src/ports/user-profile.repository.port.ts` -- add a method to record hydration outcomes by user, tenant, and channel type.
- [x] `packages/application/src/use-cases/profile-hydration.use-case.ts` -- record success, missing profile, and failure outcomes while preserving existing profile update behavior.
- [x] `apps/worker/src/profile/user-profile.repository.ts` -- write compact hydration status into `channel_accounts.profile_metadata` and keep current display-name/timezone updates.
- [x] `apps/worker/src/profile/slack-external-profile.adapter.ts` -- preserve non-retryable missing account/workspace behavior and rethrow Slack API fetch errors for queue retry visibility.
- [x] `apps/api/src/admin/profile-hydration-status.controller.ts` and `apps/api/src/admin/admin.module.ts` -- expose tenant-filtered admin status with missing-name rows and failed queue jobs.
- [x] Add/update focused tests for use-case outcomes and admin response shape.
- [x] Run typecheck, lint, tests, and production dashboard verifier if a deploy is pushed.

**Acceptance Criteria:**

- Given profile hydration succeeds, when the use case completes, then existing profile fields are written and latest hydration metadata records a successful attempt.
- Given no external profile is available, when the use case completes, then no profile fields are written and admin status can show the user as missing a display name with `missing_profile`.
- Given Slack profile fetch throws, when the worker processes the job, then BullMQ can retry/fail the job and the latest hydration metadata records `failed`.
- Given an admin calls the new status endpoint for a tenant, when some active users lack display names, then the response lists only that tenant's missing display-name accounts plus summary counts and recent failed profile-hydration jobs.

## Spec Change Log

## Design Notes

Use `channel_accounts.profile_metadata` for the first observability slice because it already belongs to the external-channel account and avoids a migration for status fields that are operational, not domain facts. A later single-owner profile refactor can promote this into a stronger profile model if needed.

## Verification

**Commands:**

- `pnpm --filter @entalent/application test -- profile-hydration.use-case.test.ts` -- expected: profile hydration outcome tests pass.
- `pnpm --filter @entalent/contracts test -- admin-profile-hydration.test.ts` -- expected: admin contract tests pass.
- `pnpm --filter @entalent/api test -- profile-hydration-status.controller.test.ts` -- expected: admin status aggregation tests pass.
- `pnpm typecheck` -- expected: monorepo typecheck passes.
- `pnpm lint` -- expected: lint passes with only pre-existing warnings.
- `pnpm test` -- expected: test suite passes.

**Results:**

- `pnpm --filter @entalent/application test -- profile-hydration.use-case.test.ts` -- passed.
- `pnpm --filter @entalent/contracts test -- admin-profile-hydration.test.ts` -- passed.
- `pnpm --filter @entalent/api test -- profile-hydration-status.controller.test.ts` -- passed.
- `pnpm typecheck` -- passed after exporting `ProfileHydrationOutcome` from `@entalent/application`.
- `pnpm lint` -- passed.
- `pnpm test` -- passed.

**Review Results:**

- Blind Hunter -- found missing tenant validation, tenant-filtered failed-job paging, raw operational error exposure, retry churn for non-retryable Slack profile errors, and best-effort telemetry masking risks.
- Edge Case Hunter -- found tenant join leakage risk, blank tenant IDs, Redis queue-read failure behavior, tenant paging gaps, non-Error rejection handling, metadata-write masking, no-account visibility limits, and JSONB attempt-count race risk.
- Fixes applied -- endpoint now rejects blank tenant IDs, joins users by both user and tenant, filters Slack channel accounts, reads a larger failed-job window before tenant filtering, degrades to DB status if Redis queue reads fail, sanitizes persisted/exposed operational messages, treats known permanent Slack profile errors as missing profiles, and makes telemetry writes best-effort so they do not cause duplicate profile writes or mask original failures.
- Deferred -- account-scoped profile hydration writes and atomic attempt-count increments were appended to `deferred-work.md` because they require extending the hydration payload/account identity boundary and fit the upcoming profile ownership refactor.

## Suggested Review Order

**Admin Status**

- Start with the protected status endpoint and tenant-safe query boundary.
  [`profile-hydration-status.controller.ts:60`](../../apps/api/src/admin/profile-hydration-status.controller.ts#L60)

- Failed-job visibility degrades safely and filters after a wider queue read.
  [`profile-hydration-status.controller.ts:98`](../../apps/api/src/admin/profile-hydration-status.controller.ts#L98)

- Summary generation isolates missing display names from hydrated accounts.
  [`profile-hydration-status.controller.ts:109`](../../apps/api/src/admin/profile-hydration-status.controller.ts#L109)

**Hydration Outcomes**

- Use case records success, missing profile, and retryable failure outcomes.
  [`profile-hydration.use-case.ts:16`](../../packages/application/src/use-cases/profile-hydration.use-case.ts#L16)

- Telemetry writes are best-effort and cannot create duplicate profile writes.
  [`profile-hydration.use-case.ts:61`](../../packages/application/src/use-cases/profile-hydration.use-case.ts#L61)

- Worker repository stores compact status in existing channel metadata.
  [`user-profile.repository.ts:55`](../../apps/worker/src/profile/user-profile.repository.ts#L55)

- Slack adapter separates permanent missing-user cases from retryable failures.
  [`slack-external-profile.adapter.ts:25`](../../apps/worker/src/profile/slack-external-profile.adapter.ts#L25)

**Shared Contract**

- Contract defines the admin response consumed by API/tests.
  [`admin-profile-hydration.ts:10`](../../packages/contracts/src/admin-profile-hydration.ts#L10)

**Verification**

- Application tests cover success, missing, failure, and telemetry-write failures.
  [`profile-hydration.use-case.test.ts:8`](../../packages/application/src/use-cases/profile-hydration.use-case.test.ts#L8)

- API tests cover summary counts, tenant filtering, blank tenant IDs, and Redis fallback.
  [`profile-hydration-status.controller.test.ts:8`](../../apps/api/src/admin/profile-hydration-status.controller.test.ts#L8)
