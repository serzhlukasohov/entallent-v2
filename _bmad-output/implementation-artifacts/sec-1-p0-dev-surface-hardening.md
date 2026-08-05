---
baseline_commit: b2f4eaa3ec9eaaa3f2b85a79481b7a7ee9649083
---

# Story SEC.1: P0 Dev Surface Hardening

Status: done

## Story

As an operator of the production enTalent Slack coach,
I want development-only API endpoints and dashboard controls to be fail-closed and explicitly gated,
so that a misconfigured production environment cannot expose destructive testing actions.

## Acceptance Criteria

1. **Production cannot mount dev endpoints by accident**
   - Given `NODE_ENV=production`
   - When `ENABLE_DEV_ENDPOINTS=true`
   - Then API startup fails fast with a clear configuration error
   - And `/dev/*` is not mounted in production by `ENABLE_DEV_ENDPOINTS=true` alone

2. **Every `/dev/*` route requires admin API authentication**
   - Given `DevModule` is mounted in a non-production environment
   - And `ADMIN_API_KEY` is configured
   - When a request is sent to any `DevSimulateController` route without `x-api-key`
   - Then the route is rejected by `ApiKeyGuard`
   - And valid `x-api-key` behavior remains consistent with existing admin controllers
   - And the existing local-dev behavior of `ApiKeyGuard` with no `ADMIN_API_KEY` is not broadened beyond non-production

3. **Dashboard dev controls are hidden unless explicitly enabled**
   - Given `DASHBOARD_DEV_CONTROLS_ENABLED` is not enabled
   - When `/pulse` renders
   - Then `DevControls` is not rendered
   - And destructive controls such as reset and force check-in are not visible

4. **Dashboard server actions reject when dev controls are disabled**
   - Given `DASHBOARD_DEV_CONTROLS_ENABLED` is not enabled
   - When `resetUser` or `forceCheckIn` is invoked directly
   - Then the action throws before calling the API
   - And no `/dev/reset-user` or `/dev/force-checkin` request is made

5. **`force-checkin` is tenant-scoped**
   - Given a request to `/dev/force-checkin` without `tenantId`
   - Then the API returns `400 Bad Request`
   - And no queue jobs are enqueued
   - Given `tenantId` is present
   - Then the query only selects active conversations for that tenant

6. **Existing local development workflow still works intentionally**
   - Given `NODE_ENV=development`
   - And `ENABLE_DEV_ENDPOINTS=true` if required by the chosen helper
   - And a valid admin key is provided when configured
   - Then dev simulation/reset/check-in routes still work for local or staging testing

## Tasks / Subtasks

- [x] Add a testable API dev-endpoint gate (AC: 1, 6)
  - [x] Replace the top-level raw `isDev` expression in `apps/api/src/app.module.ts` with a named helper such as `shouldMountDevModule(env)`.
  - [x] Make `NODE_ENV=production && ENABLE_DEV_ENDPOINTS=true` throw a clear startup/configuration error.
  - [x] Keep normal non-production behavior compatible with existing local testing.
  - [x] Add focused unit tests for the helper.

- [x] Protect `DevSimulateController` with `ApiKeyGuard` (AC: 2)
  - [x] Add `@UseGuards(ApiKeyGuard)` to `apps/api/src/dev/dev-simulate.controller.ts`.
  - [x] Register `ApiKeyGuard` in `DevModule` providers, or import a shared auth module if one is introduced later.
  - [x] Do not weaken `ApiKeyGuard`; it already fails closed in production when `ADMIN_API_KEY` is missing.

- [x] Require `tenantId` for `force-checkin` (AC: 5)
  - [x] Change the request DTO from `{ userIds?: string[]; tenantId?: string }` to require `tenantId`.
  - [x] Validate missing/empty `tenantId` with `BadRequestException`.
  - [x] Preserve the existing optional `userIds` filter, but keep the DB query tenant-scoped regardless of `userIds`.
  - [x] Add a regression test that missing `tenantId` enqueues zero jobs.

- [x] Gate dashboard dev controls at render time (AC: 3)
  - [x] Add a small server-side helper in dashboard code, for example `devControlsEnabled()`.
  - [x] Use an explicit env flag such as `DASHBOARD_DEV_CONTROLS_ENABLED=true`.
  - [x] Do not render `<DevControls />` in `apps/dashboard/src/app/pulse/page.tsx` unless the helper returns true.
  - [x] Keep the pulse overview UI otherwise unchanged.

- [x] Gate dashboard server actions (AC: 4)
  - [x] In `apps/dashboard/src/app/pulse/actions.ts`, check the same helper before `devPost`.
  - [x] Throw before `fetch` when disabled.
  - [x] Keep `ADMIN_API_KEY` use server-side only; do not expose it to client components.

- [x] Verification (AC: all)
  - [x] Run `pnpm --filter @entalent/api test`.
  - [x] Run `pnpm --filter @entalent/api typecheck`.
  - [x] Run `pnpm --filter @entalent/dashboard typecheck`.
  - [x] Run `pnpm typecheck`.

### Review Findings

- [x] [Review][Patch] `force-checkin` returned 500 instead of 400 for absent/null body or non-string `tenantId` [apps/api/src/dev/dev-simulate.controller.ts:381]
- [x] [Review][Patch] `force-checkin` accepted malformed `userIds`, allowing invalid filtering semantics or 500s [apps/api/src/dev/dev-simulate.controller.ts:389]
- [x] [Review][Defer] Dashboard dev actions need an operator-auth story before intentionally enabling them in any shared non-production environment [apps/dashboard/src/app/pulse/actions.ts:23] — deferred, pre-existing/shared-environment risk outside this P0 production hardening story

## Dev Notes

### Current Risk

The current triage marks the dev surface as P0 because development-only tools can perform destructive operations and may be exposed by configuration:

- `apps/api/src/app.module.ts` mounts `DevModule` when `NODE_ENV !== 'production' || ENABLE_DEV_ENDPOINTS === 'true'`.
- `apps/api/src/dev/dev-simulate.controller.ts` exposes `/dev/*` routes with no `@UseGuards`.
- `apps/dashboard/src/app/pulse/page.tsx` always renders `DevControls`.
- `apps/dashboard/src/app/pulse/actions.ts` calls `/dev/reset-user` and `/dev/force-checkin` with server-held `ADMIN_API_KEY`.
- `apps/api/src/dev/dev-simulate.controller.ts` currently accepts `tenantId?: string` for `force-checkin`, so omitted `tenantId` widens the query to all active conversations.

Source: `docs/superpowers/plans/2026-08-01-verification-pass.md`.

### Files To Update

#### `apps/api/src/app.module.ts`

Current state:
- Imports the production application modules and conditionally adds `DevModule`.
- Uses a top-level raw env expression:
  `process.env['NODE_ENV'] !== 'production' || process.env['ENABLE_DEV_ENDPOINTS'] === 'true'`.

Required change:
- Move the decision into a named, exported helper so tests can cover production and non-production cases.
- The helper must not mount `DevModule` in production only because `ENABLE_DEV_ENDPOINTS=true`.
- Fail fast for `NODE_ENV=production && ENABLE_DEV_ENDPOINTS=true`; this prevents an unsafe Railway/env toggle from starting successfully.

Preserve:
- `ConfigModule.forRoot({ isGlobal: true, validate: () => validateEnv() })`.
- Existing module imports and ordering unless a change is required for the dev gate.

#### `packages/config/src/env.ts`

Current state:
- Defines the shared Zod env schema.
- Does not currently model `ENABLE_DEV_ENDPOINTS` or `DASHBOARD_DEV_CONTROLS_ENABLED`.

Required change:
- If the API gate uses `validateEnv`, add `ENABLE_DEV_ENDPOINTS` to the schema and enforce production refusal in `superRefine`.
- If the API gate stays local to `apps/api`, keep the config package untouched. Do not add unused env fields.

Preserve:
- Existing OpenAI/Azure validation.
- Existing production fail-closed behavior for `ADMIN_API_KEY` in `ApiKeyGuard`; do not try to solve that in this story.

#### `apps/api/src/dev/dev.module.ts`

Current state:
- Imports `ChannelModule`, `DatabaseModule`, and BullMQ queues.
- Registers `DevSimulateController`.

Required change:
- Provide `ApiKeyGuard` if needed for controller-level `@UseGuards(ApiKeyGuard)` resolution.

Preserve:
- Queue registrations for `conversation` and `proactive_scan`.
- Do not move dev routes into `AdminModule`; they should remain visibly development-only.

#### `apps/api/src/dev/dev-simulate.controller.ts`

Current state:
- Exposes `@Controller('dev')`.
- Supports simulation, proactive check-in testing, user reset, survey evidence evaluation, and forced check-in.
- `forceCheckIn` accepts `{ userIds?: string[]; tenantId?: string }`.

Required change:
- Add controller-level `@UseGuards(ApiKeyGuard)`.
- Add strict `tenantId` validation to `forceCheckIn`.
- Use `BadRequestException` for missing/blank `tenantId`.
- Ensure the DB `where` clause always includes `eq(conversations.tenantId, body.tenantId)`.
- Do not change `ApiKeyGuard` semantics in this story. It already rejects missing/invalid keys when `ADMIN_API_KEY` is configured and fails closed in production when the key is absent; local development without a key remains a separate, intentional guard behavior.

Preserve:
- Existing test utility behavior for valid tenant-scoped calls.
- Existing returned shape `{ enqueued, users }`.
- Existing `userIds` filtering semantics after tenant scoping.

#### `apps/dashboard/src/app/pulse/page.tsx`

Current state:
- Server component that renders pulse overview.
- Imports and always renders `DevControls`.

Required change:
- Render `DevControls` only when a server-side dashboard dev gate is enabled.
- Avoid importing client-only dev controls into the active JSX path when disabled if a simple conditional import pattern is practical; a normal conditional render is acceptable if it keeps the build simple.

Preserve:
- Existing pulse overview layout and text.
- Existing `fetchApi` and `TENANT_ID` behavior.

#### `apps/dashboard/src/app/pulse/actions.ts`

Current state:
- Server actions call `/dev/reset-user` and `/dev/force-checkin`.
- `ADMIN_API_KEY` is read server-side.

Required change:
- Check the same dashboard dev gate before calling `devPost`.
- Throw a clear error when disabled.
- Keep `tenantId` required in `forceCheckIn(userId, tenantId)`.

Preserve:
- `revalidatePath('/pulse')` after successful calls.
- Server-only handling of `ADMIN_API_KEY`.

#### `apps/dashboard/src/app/pulse/DevControls.tsx`

Current state:
- Client component with reset/check-in buttons.

Required change:
- Likely no behavioral change needed if parent rendering and actions are gated.
- Do not read env vars in this client component.

Preserve:
- Existing UI behavior when enabled.

### Existing Patterns To Reuse

- Reuse `ApiKeyGuard` from `apps/api/src/auth/api-key.guard.ts`; do not create a second admin auth guard.
- Follow admin controller style: controller-level `@UseGuards(ApiKeyGuard)`.
- Use Nest `BadRequestException` for invalid request shape.
- Keep dashboard gates server-side. Client components must not receive secrets or evaluate private env logic.

### Anti-Patterns To Avoid

- Do not rely on “Railway will not set this env var” as the safety mechanism.
- Do not expose `ADMIN_API_KEY` to the browser.
- Do not add a public dashboard toggle that enables dev controls client-side.
- Do not make `force-checkin` tenant optional for convenience.
- Do not broaden this story into tenant isolation for all admin endpoints; `UserInsightsController` is a separate P1 story.
- Do not include dependency audit upgrades in this story.

## Testing Requirements

### API Tests

Add focused Vitest coverage under `apps/api/src`:

- Dev module gate helper:
  - production + `ENABLE_DEV_ENDPOINTS=true` fails closed
  - production + unset/false does not mount dev module
  - development behavior remains intentional
- `forceCheckIn`:
  - missing/blank `tenantId` throws `BadRequestException`
  - valid `tenantId` applies tenant filter and can enqueue expected jobs
- Guard metadata or controller behavior:
  - Prefer an integration-style Nest testing module if lightweight.
  - At minimum, assert the controller has `@UseGuards(ApiKeyGuard)` metadata and `DevModule` provides the guard.

### Dashboard Verification

There is no dashboard test script in `apps/dashboard/package.json`; do not invent a new test framework for this story.

Required verification:
- `pnpm --filter @entalent/dashboard typecheck`
- `pnpm --filter @entalent/dashboard build` if practical

If adding a helper function for dev-control gating, keep it pure and colocated so it can be covered later without a framework migration.

## Project Structure Notes

- API app: `apps/api/src`.
- Dashboard app: `apps/dashboard/src/app`.
- Shared env schema: `packages/config/src/env.ts`.
- BMad triage source: `docs/superpowers/plans/2026-08-01-verification-pass.md`.
- Architecture source: `ARCHITECTURE.md`.

No database migration is expected for this story.
No Slack behavior should change.
No production deploy should be done by the dev agent unless explicitly requested after review.

## References

- `docs/superpowers/plans/2026-08-01-verification-pass.md` — current P0 triage and fix order.
- `ARCHITECTURE.md` — API/dashboard/worker boundaries and queue architecture.
- `apps/api/src/app.module.ts` — current DevModule mounting logic.
- `apps/api/src/auth/api-key.guard.ts` — existing admin API key guard.
- `apps/api/src/dev/dev.module.ts` — dev module wiring.
- `apps/api/src/dev/dev-simulate.controller.ts` — destructive dev routes.
- `apps/dashboard/src/app/pulse/page.tsx` — always-rendered dev controls.
- `apps/dashboard/src/app/pulse/actions.ts` — server actions that call dev endpoints.
- `apps/dashboard/src/app/pulse/DevControls.tsx` — client controls.

## Dev Agent Record

### Agent Model Used

GPT-5 Codex.

### Debug Log References

- `pnpm --filter @entalent/api test` — passed after adding `shouldMountDevModule`.
- `pnpm --filter @entalent/api test` — passed after adding `ApiKeyGuard` metadata coverage for `DevSimulateController`.
- `pnpm --filter @entalent/api test` — passed after requiring `tenantId` before `force-checkin` touches DB/queues.
- `pnpm --filter @entalent/dashboard typecheck` — passed after dashboard dev-control gate.
- `pnpm --filter @entalent/dashboard build` — passed after dashboard dev-control gate.
- `pnpm --filter @entalent/api typecheck` — passed.
- `pnpm --filter @entalent/api lint` — passed with pre-existing `no-console` warnings in `apps/api/src/main.ts`.
- `pnpm --filter @entalent/dashboard lint` — passed.
- `pnpm --filter @entalent/application test` — passed after making time-dependent proactive tests deterministic.
- BMad multi-agent review — 1 acceptance auditor clean, 1 blind hunter and 1 edge-case hunter found validation hardening gaps; patches applied.
- Manual API smoke: production `ENABLE_DEV_ENDPOINTS=true` fails fast with `ENABLE_DEV_ENDPOINTS=true is not allowed in production`.
- Manual API smoke: non-production `/api/v1/dev/force-checkin` with configured `ADMIN_API_KEY` returns `401` without key, `403` with wrong key, `400` for missing/non-UUID tenant and malformed `userIds`, and `202 {"enqueued":0,"users":[]}` for a valid nonexistent tenant UUID.
- Manual API smoke: production-mode API starts normally, `/api/v1/health` returns `200`, and `/api/v1/dev/force-checkin` returns `404` even with a valid admin key.
- Manual dashboard helper smoke: production + `DASHBOARD_DEV_CONTROLS_ENABLED=true` returns disabled; development + flag returns enabled; disabled server action throws `Dev controls are disabled` before `fetch`.
- `pnpm test` — passed.
- `pnpm typecheck` — passed.

### Completion Notes List

- Added a testable API dev endpoint gate. Production with `ENABLE_DEV_ENDPOINTS=true` now throws during startup decision, production without the flag does not mount `DevModule`, and non-production mounting behavior is preserved.
- Protected `DevSimulateController` with the existing `ApiKeyGuard` and registered the guard in `DevModule` without changing guard semantics.
- Required non-blank `tenantId` for `force-checkin`; invalid requests now fail with `BadRequestException` before storage or queue access, and valid queries are always tenant-scoped.
- Hardened `force-checkin` runtime validation for absent request body, non-string tenant IDs, non-UUID tenant IDs, and malformed `userIds`.
- Added a server-side dashboard dev-control gate. `DevControls` no longer renders unless enabled outside production, and server actions throw before calling `/dev/*` when disabled.
- Stabilized existing application proactive/quiet-hours tests by freezing their default system time outside quiet hours; product quiet-hours semantics were not changed.
- Deferred shared non-production dashboard operator auth as a follow-up story; production remains fail-closed in this story.
- Story implementation passed review and manual smoke checks.

### File List

- `apps/api/src/app.module.ts`
- `apps/api/src/dev/dev.module.ts`
- `apps/api/src/dev/dev-endpoints.ts`
- `apps/api/src/dev/dev-endpoints.test.ts`
- `apps/api/src/dev/dev-simulate.controller.ts`
- `apps/api/src/dev/dev-simulate.controller.test.ts`
- `apps/dashboard/src/app/pulse/actions.ts`
- `apps/dashboard/src/app/pulse/dev-controls-gate.ts`
- `apps/dashboard/src/app/pulse/page.tsx`
- `_bmad-output/implementation-artifacts/deferred-work.md`
- `packages/application/src/use-cases/follow-up-execution.test.ts`
- `packages/application/src/use-cases/proactive-scheduler.test.ts`
