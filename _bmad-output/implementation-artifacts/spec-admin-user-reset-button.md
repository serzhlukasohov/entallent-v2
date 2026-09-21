---
title: 'Admin user reset button'
type: 'feature'
created: '2026-09-05'
status: 'done'
baseline_commit: 'b416bfd'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The manager dashboard has no production-safe way to reset one employee's agent state before retesting. The existing `/dev/reset-user` route is disabled in production and the GDPR data-deletion route soft-deletes the user, which does not fit “start this same Slack user from zero”.

**Approach:** Add an admin-authenticated reset endpoint and expose it as a per-user dashboard button. Reset conversational/runtime state while preserving the user row and Slack channel account so the next Slack message creates a fresh conversation for the same person.

## Boundaries & Constraints

**Always:** Keep the endpoint behind `ApiKeyGuard`; require tenant scoping; audit successful resets; preserve `users` and `channel_accounts`; clear conversations, messages, survey state, memory, goals, scheduled actions, risk signals, style profile, and user-linked LLM run rows for that tenant/user.

**Ask First:** Deleting audit logs, deleting channel account mappings, running the reset against production data manually, or changing Railway variables.

**Never:** Reuse GDPR erasure for dev/test reset; add a second reset implementation that can drift from the admin path; hardcode a user id, tenant id, Slack id, or environment-specific URL.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Admin resets active user | `POST /admin/users/:userId/reset?tenantId=<uuid>` | Conversation and agent state for that user is deleted, user remains active, response returns affected row counts | N/A |
| Missing or wrong tenant | Valid user id but no row for tenant | No reset is applied | `404 User ... not found` |
| Dashboard click | Manager table row reset button | Button asks confirmation, calls server action, refreshes team/pulse views, shows result | Failed request shows inline error |

</frozen-after-approval>

## Code Map

- `apps/api/src/admin/user-reset.service.ts` -- single reusable reset implementation.
- `apps/api/src/admin/user-reset.controller.ts` -- admin-authenticated API adapter and audit record.
- `apps/api/src/dev/dev-simulate.controller.ts` -- reuse the service for `/dev/reset-user` to avoid drift.
- `apps/api/src/admin/admin.module.ts` and `apps/api/src/dev/dev.module.ts` -- wire provider/controller.
- `apps/dashboard/src/app/lib.ts` -- shared server-side POST helper.
- `apps/dashboard/src/app/actions.ts` -- server action for dashboard reset.
- `apps/dashboard/src/app/components/TeamTable.tsx` -- per-user Reset button.
- `docs/agent-task-log.md` -- task log row after implementation.

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/src/admin/user-reset.service.ts` -- implement tenant-scoped reset with one reusable code path.
- [x] `apps/api/src/admin/user-reset.controller.ts` -- expose admin route and audit success.
- [x] `apps/api/src/dev/dev-simulate.controller.ts` -- delegate existing dev reset to the same service.
- [x] `apps/dashboard/src/app/lib.ts`, `apps/dashboard/src/app/actions.ts`, `apps/dashboard/src/app/components/TeamTable.tsx` -- add dashboard POST action and per-user button.
- [x] Tests -- cover API adapter/reset service and dashboard type/build.

**Acceptance Criteria:**
- Given an active user with conversation state, when an admin resets that user, then the user and Slack account remain usable and agent conversation state is cleared.
- Given a user outside the requested tenant, when reset is requested, then the API returns not found and does not delete state.
- Given the dashboard team table, when Reset is clicked and confirmed, then the reset endpoint is called and dashboard data is revalidated.

## Verification

**Commands:**
- `pnpm --filter @entalent/api test -- src/admin/admin-console.controllers.test.ts` -- admin reset tests pass.
- `pnpm --filter @entalent/api typecheck` -- API compiles.
- `pnpm --filter @entalent/dashboard typecheck` -- dashboard compiles.
- `pnpm --filter @entalent/dashboard build` -- Next.js build passes.
- `pnpm typecheck && pnpm lint && pnpm test` -- pre-push gate passes before push.

## Suggested Review Order

**Admin reset boundary**

- Entry point audits before destructive reset and scopes by tenant.
  [`user-reset.controller.ts:8`](../../apps/api/src/admin/user-reset.controller.ts#L8)

- Single DB reset path clears agent state without deleting user/channel mapping.
  [`user-reset.service.ts:45`](../../apps/api/src/admin/user-reset.service.ts#L45)

- Tenant-scoped survey evidence follows the window ownership boundary.
  [`user-reset.service.ts:93`](../../apps/api/src/admin/user-reset.service.ts#L93)

**Dashboard action**

- Server action posts through existing internal API env and revalidates views.
  [`actions.ts:6`](../../apps/dashboard/src/app/actions.ts#L6)

- Team row button confirms destructive reset and shows returned counts.
  [`TeamTable.tsx:197`](../../apps/dashboard/src/app/components/TeamTable.tsx#L197)

**Dev reuse and tests**

- Existing dev reset now delegates to the same service.
  [`dev-simulate.controller.ts:454`](../../apps/api/src/dev/dev-simulate.controller.ts#L454)

- Tests cover service mapping/not-found and admin audit adapter.
  [`user-reset.service.test.ts:23`](../../apps/api/src/admin/user-reset.service.test.ts#L23)
