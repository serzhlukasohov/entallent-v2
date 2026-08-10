# Verification Pass — Current Triage

> Original pass: 2026-08-01  
> Re-triaged against current code: 2026-08-04  
> Status: **CURRENT BACKLOG, NOT A HISTORICAL RELEASE VERDICT**

This document used to mix old Bugbot/security output, stale CI counts, dependency-audit
numbers, and architecture opinions. It is now reduced to the findings that still matter
against the current tree.

## Current Verdict

The old report's main warning is still valid: green typecheck/tests do not cover several
production-risk paths.

However, not every old item is a release blocker. The current priority is:

1. **P0** Lock down the dev surface: `/dev/*`, dashboard `DevControls`, and `force-checkin`.
2. **P1** Fix tenant isolation in `UserInsightsController`.
3. **P1** Fail closed on Slack signature verification when `rawBody` is missing.
4. **P1** Block survey probes while a group confirmation is awaiting a user reply.
5. **P1/P2** Fix Slack `updateMessage` channel/ts modeling before using message updates.
6. **P2** Complete GDPR export/deletion coverage for survey/pulse data.

## Still Valid

| Priority | Finding | Current evidence | Action |
|----------|---------|------------------|--------|
| **P0** | `/dev/*` can be mounted in production with `ENABLE_DEV_ENDPOINTS=true`, and `DevSimulateController` has no guard. | `apps/api/src/app.module.ts` imports `DevModule` when `NODE_ENV !== 'production' || ENABLE_DEV_ENDPOINTS === 'true'`; `apps/api/src/dev/dev-simulate.controller.ts` has `@Controller('dev')` and no `@UseGuards`. | Refuse `ENABLE_DEV_ENDPOINTS=true` in production, or require a stronger explicit unsafe flag plus `ApiKeyGuard` on the controller. |
| **P0** | Dashboard renders destructive dev controls and server actions call `/dev/*` with the server-held admin key. | `apps/dashboard/src/app/pulse/page.tsx` always renders `DevControls`; `apps/dashboard/src/app/pulse/actions.ts` calls `/dev/reset-user` and `/dev/force-checkin`. | Hide/import `DevControls` only when explicitly enabled outside production; make server actions reject unless the same gate is enabled. |
| **P0** | `force-checkin` can target all active conversations if `tenantId` is omitted. | `apps/api/src/dev/dev-simulate.controller.ts` accepts `{ tenantId?: string }` and applies the tenant filter only when present. | Require `tenantId`; reject empty `userIds` + no tenant. This also belongs to the dev-surface fix. |
| **P1** | `UserInsightsController` ignores tenant. | `apps/api/src/admin/user-insights.controller.ts` accepts `_tenantId` but queries windows/evidence by `userId` only. | Require `tenantId` and filter every query by tenant/window tenant like `UserDebugController` does. |
| **P1** | Slack signature verification fails open if `rawBody` is missing. | `apps/api/src/channel/slack-events.controller.ts` verifies only inside `if (rawBody)`, then always delegates to `pipeline.processBody`. | Return early/reject when `rawBody` is absent for non-URL-verification Slack requests. |
| **P1** | Survey probe can still be selected while a group confirmation is awaiting. | Phase A is gated by `!phaseB.awaitingPresent`, but `probeQuestion` is not. | Add `!phaseB.awaitingPresent` to the `probeQuestion` condition and add an orchestrator test. |
| **P1/P2** | Slack `updateMessage` uses one field for both channel and timestamp. | `packages/channel-slack/src/slack.adapter.ts` sends `channel: message.externalMessageId` and `ts: message.externalMessageId`; the port does not carry channel id. | Extend `UpdateOutgoingMessage` with channel/conversation external id before relying on updates. |
| **P2** | GDPR export/deletion does not cover survey/pulse data. | `apps/api/src/users/user-data.controller.ts` exports/deletes messages, memory, goals, actions, risks, user; it does not cover `surveyEvidence`, `surveyAssessments`, `surveyGroupStates`, `pulseBacklog`, `surveyWindows`, or conversations. | Expand export/deletion coverage or explicitly document what is retained and why. |
| **P2** | Outbox queue jobs do not set deterministic `jobId`. | `apps/worker/src/conversation/outbox.service.ts` calls `.add(...)` without `jobId`. | Add idempotent job ids where duplicate sends/evaluations are harmful. |
| **P2** | Survey repository pending/awaiting methods are user-id only. | `packages/application/src/ports/survey.repository.port.ts` has `findPendingConfirmationGroups(userId)` and `findAwaitingConfirmationGroups(userId)`. | Add `tenantId` for consistency with tenant isolation. Lower priority than the controller leaks because current call paths already carry tenant-scoped users. |

## Removed From Release-Blocker List

These items may still be useful context, but they should not clutter the active P0/P1 list.

| Old item | Current disposition |
|----------|---------------------|
| Old Bugbot/Security agent IDs and branch-diff framing | Historical metadata; removed from the active backlog. |
| Old CI counts: `121 tests`, sampled packages | Stale. Current verification is tracked elsewhere; this report is not the CI baseline. |
| Old `pnpm audit --prod` counts: `45 vulnerabilities` | Stale snapshot. A fresh audit was attempted on 2026-08-04 but registry DNS failed in sandbox. Re-run before dependency work. |
| Dockerfile `pnpm deploy` concern | Not an auth bypass; not a release blocker here. |
| API key `!==` timing concern | Lower than current auth/tenant issues; do not track in this report. |
| No Postgres RLS | Accepted architectural hardening item for later. Current app relies on tenant filters; track only concrete missing filters. |
| Confirmation domain “god object” | Architecture cleanup, not a verified security/release blocker. Keep in the thermo-nuclear cleanup plan, not here. |
| “Unclear confirmation stalls Phase A indefinitely” | Product/UX debt. Not enough evidence to keep as P1 release blocker; revisit when confirmation cleanup resumes. |
| `findPendingConfirmationGroups(userId)` as high severity | Downgraded to P2 because the current orchestrator calls it for the active user; still worth fixing for consistency. |

## Next Fix Order

1. Patch dev surface in one changeset:
   - production refusal/gate for `ENABLE_DEV_ENDPOINTS`
   - `ApiKeyGuard` on `DevSimulateController`
   - dashboard `DevControls` and server actions gated
   - `force-checkin` requires `tenantId`
2. Patch tenant isolation in `UserInsightsController` with tests.
3. Patch Slack fail-closed `rawBody` behavior with controller tests.
4. Patch probe gating with an orchestrator regression test.
5. Decide whether Slack message updates are needed now; if yes, extend the port and adapter.
6. Expand GDPR export/deletion after confirming retention expectations.

## Verification To Run After Patches

```sh
pnpm --filter @entalent/api test
pnpm --filter @entalent/application test
pnpm typecheck
pnpm test
```

Re-run `pnpm audit --prod` only with registry access; do not use the old vulnerability
counts as current evidence.
