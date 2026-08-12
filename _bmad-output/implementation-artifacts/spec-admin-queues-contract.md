---
title: 'Admin Queues Contract'
type: 'refactor'
created: '2026-08-12'
status: 'done'
review_loop_iteration: 0
baseline_commit: '3e0119f173d6128e98cf34aa93953fd8e52303aa'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `/admin/queues` now uses the shared queue-name list, but the response shape is still locally implied by `unknown[]` in the API and duplicated as ad hoc interfaces in smoke tooling. This leaves the dashboard and operational checks able to drift from the API without an early compile-time failure.

**Approach:** Add a narrow shared admin queues response contract to `@entalent/contracts` and make the API controller, dashboard fetch usage, and smoke script consume that contract. Preserve the wire response exactly: `{ queues, timestamp }` with BullMQ job counts per queue.

## Boundaries & Constraints

**Always:** Keep existing endpoint paths and JSON field names unchanged. Queue names in response items must remain `QueueName` values from the shared queue contract. Job count values must tolerate BullMQ's current count shape without over-validating Redis internals. Dashboard should gain a package dependency on `@entalent/contracts` only if needed for type imports.

**Ask First:** Any runtime validation layer, endpoint rename, dashboard UI redesign, pagination/filtering, Redis query behavior change, or broader migration of unrelated admin DTOs.

**Never:** Do not change queue registration, job retry behavior, queue string values, admin authentication, dashboard rendering behavior, or production deployment topology. Do not broaden this package into `manager/team`, analytics, trends, or user insights contracts.

## I/O & Edge-Case Matrix

| Scenario             | Input / State                                         | Expected Output / Behavior                                                                                     | Error Handling                                              |
| -------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Queue stats response | API initializes BullMQ queues from `ALL_QUEUE_NAMES`  | `getStats()` returns `AdminQueuesResponse` with each item name typed as `QueueName`, counts, and ISO timestamp | Existing controller exception behavior remains unchanged    |
| Dashboard fetch      | Dashboard requests `/admin/queues` through `fetchApi` | Generic type is imported from `@entalent/contracts`, so dashboard expectations compile against API contract    | Existing `null` fallback on fetch failure remains unchanged |
| Smoke script parsing | Remote smoke reads `/admin/queues`                    | Script reuses the shared response type instead of its own local duplicate                                      | Existing smoke failure behavior remains unchanged           |

</frozen-after-approval>

## Code Map

- `packages/contracts/src/queue.ts` -- owns `QueueName` and `ALL_QUEUE_NAMES`; should also own admin queue response item/count types.
- `packages/contracts/src/index.ts` -- existing shared export surface; already exports queue contract.
- `packages/contracts/src/queue.test.ts` -- focused queue contract test; should pin admin queue response type invariants where practical.
- `apps/api/src/admin/queues.controller.ts` -- producer of `/admin/queues`; should return `AdminQueuesResponse` instead of `{ queues: unknown[]; timestamp: string }`.
- `apps/dashboard/package.json` -- may need `@entalent/contracts` workspace dependency for dashboard type imports.
- `apps/dashboard/Dockerfile` -- dashboard production image build context; must include any new workspace package dependency copied before install.
- `apps/dashboard/src/app/lib.ts` and relevant dashboard route files -- server-side admin API fetch helper and callers; queues usage should import shared response type.
- `scripts/live-maf-primary-app-smoke.ts` -- currently declares local `QueueCountsSnapshot` and `AdminQueuesResponse`; should import shared types.

## Tasks & Acceptance

**Execution:**

- [x] `packages/contracts/src/queue.ts` -- add `AdminQueueCounts`, `AdminQueueSnapshot`, and `AdminQueuesResponse` exports -- centralizes `/admin/queues` response shape beside queue names.
- [x] `packages/contracts/src/queue.test.ts` -- add a focused compile/runtime-light assertion around queue snapshot names and count keys -- catches accidental contract drift.
- [x] `apps/api/src/admin/queues.controller.ts` -- type `getStats()` as `Promise<AdminQueuesResponse>` and coerce queue names through the canonical `QueueName` list -- makes API the producer of the shared contract.
- [x] `apps/dashboard` -- import the shared response type wherever `/admin/queues` is consumed; add workspace dependency if required -- makes dashboard compile against the same API contract.
- [x] `apps/dashboard/Dockerfile` -- copy and build `packages/contracts` in the dashboard builder stage before `next build` -- keeps production image builds aligned with the new workspace dependency.
- [x] `scripts/live-maf-primary-app-smoke.ts` -- replace local duplicate response interfaces with shared imports -- removes a second drift point.
- [x] Run targeted typechecks/tests -- prove contracts, API, dashboard, and smoke tooling still compile.

**Acceptance Criteria:**

- Given `/admin/queues` compiles, when the controller response type changes, then the API must satisfy `AdminQueuesResponse` from `@entalent/contracts`.
- Given dashboard code fetches admin queue stats, when `@entalent/contracts` changes the queue response shape, then dashboard typecheck must expose incompatible assumptions.
- Given the remote smoke script checks queues, when it parses `/admin/queues`, then it uses the same shared response type as API/dashboard instead of local duplicate interfaces.
- Given this refactor deploys, when production dashboard or admin queues endpoint runs, then the JSON response shape and visible UI behavior remain unchanged.

## Spec Change Log

## Design Notes

Keep this as a type contract, not a runtime schema. BullMQ owns the detailed count keys, and current code only needs a stable queue-name plus count-map envelope. Runtime validation can be added later if API boundary hardening becomes a separate goal.

## Verification

**Commands:**

- `pnpm --filter @entalent/contracts test -- queue.test.ts` -- expected: queue contract tests pass.
- `pnpm --filter @entalent/contracts build` -- expected: package emits updated declarations for downstream typechecks.
- `pnpm --filter @entalent/api typecheck` -- expected: admin queues controller satisfies shared response type.
- `pnpm --filter @entalent/dashboard typecheck` -- expected: dashboard resolves shared contract imports and compiles.
- `pnpm --filter @entalent/dashboard build` -- expected: dashboard production build succeeds with the new workspace dependency.
- `pnpm exec tsc --noEmit --skipLibCheck scripts/live-maf-primary-app-smoke.ts` or existing script-level check if available -- expected: smoke script shared imports compile.

**Results:**

- `pnpm --filter @entalent/contracts test -- queue.test.ts` -- passed.
- `pnpm --filter @entalent/contracts typecheck` -- passed.
- `pnpm --filter @entalent/contracts build` -- passed.
- `pnpm --filter @entalent/api test -- queues.controller.test.ts` -- passed.
- `pnpm --filter @entalent/api typecheck` -- passed.
- `pnpm --filter @entalent/dashboard typecheck` -- passed.
- `pnpm --filter @entalent/dashboard build` -- passed; Next reported sandbox `fetch EPERM` warnings during prerender, but exited successfully.
- `pnpm exec prettier --check ...` -- passed for touched TS/JSON/MD files; Dockerfile was excluded because this Prettier invocation has no Dockerfile parser.
- `pnpm exec tsx -e "import type { AdminQueuesResponse } from '@entalent/contracts'; ..."` -- passed with sandbox escalation; verifies shared contract import resolution through the smoke script runtime toolchain. Direct standalone `tsc scripts/live-maf-primary-app-smoke.ts` is not a valid repo check because it bypasses workspace tsconfig/module settings and reports pre-existing unrelated errors.

**Review Results:**

- Blind Hunter -- no actionable findings.
- Edge Case Hunter -- fixed dashboard Docker build context, exact `QueueName` type assertion, and numeric admin queue count contract.
- Production dashboard deploy initially failed because the copied contracts package had no `dist/index.d.ts` in the clean Docker image; fixed by building `@entalent/contracts` before dashboard `next build`.

## Suggested Review Order

**Shared Contract**

- Start here: response envelope now lives beside canonical queue names.
  [`queue.ts:20`](../../packages/contracts/src/queue.ts#L20)

- Queue item names stay narrowed to the canonical queue union.
  [`queue.ts:22`](../../packages/contracts/src/queue.ts#L22)

**API Producer**

- Controller now promises the shared admin queues response.
  [`queues.controller.ts:43`](../../apps/api/src/admin/queues.controller.ts#L43)

- BullMQ queue instances preserve canonical names at construction.
  [`queues.controller.ts:35`](../../apps/api/src/admin/queues.controller.ts#L35)

**Dashboard Consumer**

- Dashboard has a typed admin queues fetch helper without UI changes.
  [`lib.ts:21`](../../apps/dashboard/src/app/lib.ts#L21)

- Production image includes the new workspace dependency.
  [`Dockerfile:10`](../../apps/dashboard/Dockerfile#L10)

- Clean image builds contract declarations before dashboard typecheck.
  [`Dockerfile:13`](../../apps/dashboard/Dockerfile#L13)

**Operational Smoke**

- Remote smoke reuses the shared response contract.
  [`live-maf-primary-app-smoke.ts:10`](../../scripts/live-maf-primary-app-smoke.ts#L10)

**Verification**

- Contract test pins exact `QueueName` response typing.
  [`queue.test.ts:37`](../../packages/contracts/src/queue.test.ts#L37)
