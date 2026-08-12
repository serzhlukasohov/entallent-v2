---
title: 'Account Scoped Profile Hydration'
type: 'refactor'
created: '2026-08-12'
status: 'done'
review_loop_iteration: 0
baseline_commit: '22479524f1d5ee81d9958d42fd13701a626f18de'
context: []
---

<frozen-after-approval reason="human-owned intent - do not modify unless human renegotiates">

## Intent

**Problem:** Profile hydration currently identifies Slack account writes mostly by `userId + tenantId + channelType`. If one user has multiple Slack workspace accounts, a single hydration job can update display-name/status metadata on unrelated channel accounts.

**Approach:** Carry the external workspace identity through the profile-hydration payload, external-profile lookup, profile write, and outcome write. Use it to scope `channel_accounts` updates to the specific Slack workspace account while preserving backward compatibility for any already queued jobs that lack the new field.

## Boundaries & Constraints

**Always:** Preserve existing dashboard name fallback behavior, tenant scoping, queue retry behavior, and current DB schema. Keep old profile hydration jobs executable when `externalWorkspaceId` is absent.

**Ask First:** Any schema migration, destructive cleanup of queued jobs, Slack API scope change, dashboard UI change, or removal of legacy payload compatibility.

**Never:** Do not update unrelated channel accounts when a workspace-scoped hydration job has enough identity to target one account. Do not store raw Slack profiles or secrets.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Workspace-scoped hydration | Payload has `externalWorkspaceId` | Fetch and write only that workspace account's Slack profile facts/status | Retry behavior unchanged |
| Multiple Slack accounts | Same user has two Slack channel accounts | Hydrating workspace A does not update workspace B display name or metadata | N/A |
| Legacy queued job | Payload lacks `externalWorkspaceId` | Job still runs through the prior user/tenant/channel fallback | No queue purge needed |
| Missing profile/failure | Fetch returns null or throws | Outcome metadata is recorded only on scoped account when scope exists | Original failure is preserved |

</frozen-after-approval>

## Code Map

- `packages/application/src/ports/outbox.port.ts` -- profile hydration payload includes optional external workspace scope.
- `packages/application/src/ports/external-profile.port.ts` -- external profile lookup accepts optional workspace scope.
- `packages/application/src/ports/user-profile.repository.port.ts` -- profile/outcome writes accept optional account scope.
- `packages/application/src/ports/workspace-connection.repository.port.ts` -- workspace lookup accepts optional tenant scope.
- `packages/application/src/use-cases/profile-hydration.use-case.ts` -- passes workspace scope through fetch, profile write, and outcome write.
- `apps/worker/src/conversation/outbox.service.ts` -- enqueues scoped payloads unchanged.
- `packages/application/src/use-cases/conversation-orchestrator.ts` and `packages/application/src/use-cases/maf-primary-agent-runtime.ts` -- include request workspace in hydration jobs.
- `apps/worker/src/conversation/repositories/workspace-connection.repository.ts` -- resolves Slack account by user and optional workspace.
- `apps/worker/src/profile/slack-external-profile.adapter.ts` -- fetches profile for the scoped account.
- `apps/worker/src/profile/user-profile.repository.ts` -- scopes channel account display-name/status writes.

## Tasks & Acceptance

**Execution:**

- [x] Add optional `externalWorkspaceId` to profile hydration payload/input and pass it from runtime producers.
- [x] Pass workspace scope through external profile fetch and Slack account lookup.
- [x] Pass account scope through profile update and hydration outcome writes.
- [x] Scope worker repository `channel_accounts` updates to the target workspace account when scope is present.
- [x] Update focused tests for profile hydration use case payload propagation.
- [x] Run targeted tests plus monorepo `typecheck`, `lint`, and `test`.

**Acceptance Criteria:**

- Given a profile hydration job with `externalWorkspaceId`, when Slack profile facts are applied, then only that workspace account's `channel_accounts` row is eligible for display-name/status updates.
- Given a user has multiple Slack accounts, when one scoped hydration succeeds or fails, then unrelated Slack account metadata is not modified by that job.
- Given an older queued hydration job lacks `externalWorkspaceId`, when the worker processes it, then the job still follows the previous fallback path.
- Given profile hydration succeeds, misses, or fails, when outcome telemetry is recorded, then the workspace scope is forwarded consistently.

## Spec Change Log

- 2026-08-12 -- Added workspace-scoped profile hydration payload propagation, repository scoping, and tenant-aware workspace lookup for scoped hydration.

## Design Notes

This is a boundary-tightening slice, not a schema migration. `externalWorkspaceId` is already present in runtime requests and identifies the Slack workspace side of the existing unique channel account key.

## Verification

**Commands:**

- `pnpm --filter @entalent/application test -- profile-hydration.use-case.test.ts` -- passed, 6 tests.
- `pnpm --filter @entalent/application test -- profile-hydration.use-case.test.ts conversation-orchestrator.test.ts maf-primary-agent-runtime.test.ts` -- passed, 36 tests.
- `pnpm --filter @entalent/worker test -- conversation.processor.test.ts conversation.module.test.ts` -- passed, 25 tests.
- `pnpm --filter @entalent/application typecheck` -- passed.
- `pnpm --filter @entalent/worker typecheck` -- passed.
- `pnpm typecheck` -- passed, 23 tasks; repeated after BMad review patch.
- `pnpm lint` -- passed, 23 tasks; repeated after BMad review patch.
- `pnpm test` -- passed, 15 tasks; repeated after BMad review patch.

## File List

- `apps/worker/src/conversation/repositories/workspace-connection.repository.ts`
- `apps/worker/src/profile/profile-hydration.processor.ts`
- `apps/worker/src/profile/slack-external-profile.adapter.ts`
- `apps/worker/src/profile/user-profile.repository.ts`
- `packages/application/src/index.ts`
- `packages/application/src/ports/external-profile.port.ts`
- `packages/application/src/ports/outbox.port.ts`
- `packages/application/src/ports/user-profile.repository.port.ts`
- `packages/application/src/ports/workspace-connection.repository.port.ts`
- `packages/application/src/use-cases/conversation-orchestrator.ts`
- `packages/application/src/use-cases/maf-primary-agent-runtime.ts`
- `packages/application/src/use-cases/profile-hydration.use-case.ts`
- `packages/application/src/use-cases/profile-hydration.use-case.test.ts`

## Dev Agent Record

### Completion Notes

- Hydration jobs produced by TypeScript and MAF primary runtime now include `externalWorkspaceId`.
- Profile hydration fetches Slack profiles through a workspace-scoped account lookup while preserving legacy jobs with no workspace scope.
- Worker profile writes now scope `channel_accounts.display_name` and hydration status metadata to the target account when scope is present.
- BMad review patch added tenant-aware workspace-connection lookup for scoped hydration.
