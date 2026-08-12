---
title: 'Shared Queue Constants'
type: 'refactor'
created: '2026-08-12'
status: 'done'
review_loop_iteration: 0
baseline_commit: '5085985fc4875179baf520911c25e5c6914d213c'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Queue names are currently defined independently in the API app, worker app, and admin queue controller. This already produced drift: the worker knows about `group-report`, `style-analysis`, and `profile-hydration`, while the API queue module and admin queue stats use smaller hardcoded lists.

**Approach:** Introduce one shared queue-name contract in a workspace package and make API, worker, and admin queue tooling import from it. Each service may still decide which queues it registers locally, but every queue string must come from the same canonical source.

## Boundaries & Constraints

**Always:** Queue string values must remain unchanged to preserve existing Redis/BullMQ queues. `QUEUE_NAMES` must stay available from `apps/api/src/queue/queue.module.ts` and `apps/worker/src/queue/queue.module.ts` as a compatibility export unless all callers are migrated in the same change. Admin queue stats must stop using a third hardcoded queue list. The shared contract must include every currently used queue: `conversation`, `memory-extraction`, `survey-evidence`, `risk-analysis`, `followup-planning`, `followup-execution`, `message-send`, `proactive-scan`, `group-report`, `style-analysis`, and `profile-hydration`.

**Ask First:** Any rename of an existing queue, deletion of a queue, change to BullMQ retry/default job options, Redis connection behavior, worker processor names, or production deployment topology.

**Never:** Do not migrate live queue data, flush Redis, change job payload schemas, change job names such as `process`/`hydrate`/`send`, or combine API and worker queue modules into one Nest module. Do not broaden this spec into admin DTO contracts, production dashboard smoke tests, read models, or hydration status alerts.

## I/O & Edge-Case Matrix

| Scenario                   | Input / State                                                                      | Expected Output / Behavior                                                                                   | Error Handling                                                |
| -------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| Canonical import           | API and worker import queue names                                                  | Both resolve the same string values from the shared contract                                                 | TypeScript fails if a removed or misspelled key is referenced |
| Service-local registration | API registers only producer-facing queues while worker registers all worker queues | Both registration lists use canonical names without requiring both services to register identical queue sets | No runtime change; queue registration stays service-owned     |
| Admin stats coverage       | `/admin/queues` initializes BullMQ `Queue` instances                               | Stats include all canonical queues, including `group-report`, `style-analysis`, and `profile-hydration`      | Existing dead-letter/retry behavior remains unchanged         |

</frozen-after-approval>

## Code Map

- `packages/contracts/src/index.ts` -- existing shared export surface consumed by API/worker packages.
- `packages/contracts/src/queue.ts` -- new canonical queue-name contract.
- `apps/api/src/queue/queue.module.ts` -- API BullMQ root/register module; should re-export shared `QUEUE_NAMES` and use canonical values.
- `apps/worker/src/queue/queue.module.ts` -- worker BullMQ root/register module; should re-export shared `QUEUE_NAMES` and use canonical values.
- `apps/api/src/admin/queues.controller.ts` -- admin queue stats currently has its own hardcoded `ALL_QUEUES`; should consume canonical queue names.
- `apps/api/src/dev/dev-simulate.controller.ts`, `apps/api/src/channel/slack-ingest.service.ts`, worker processors/modules -- existing callers that should keep compiling through compatibility exports or direct shared imports.

## Tasks & Acceptance

**Execution:**

- [x] `packages/contracts/src/queue.ts` -- add `QUEUE_NAMES`, `ALL_QUEUE_NAMES`, and narrow queue-name type exports -- centralizes queue topology strings.
- [x] `packages/contracts/src/index.ts` -- export the queue contract -- makes canonical names available to API and worker.
- [x] `apps/api/src/queue/queue.module.ts` -- remove local literal object, import/re-export `QUEUE_NAMES`, and keep existing API registration set service-local -- eliminates API-side duplicate constants without changing registration behavior.
- [x] `apps/worker/src/queue/queue.module.ts` -- remove local literal object, import/re-export `QUEUE_NAMES`, and keep worker registration set service-local -- eliminates worker-side duplicate constants without changing registration behavior.
- [x] `apps/api/src/admin/queues.controller.ts` -- replace local `ALL_QUEUES` literals with canonical `ALL_QUEUE_NAMES` -- gives admin tooling visibility into every known queue.
- [x] `packages/contracts/src/queue.test.ts` or equivalent focused test -- assert canonical queue names include all current values and expose stable string values -- catches accidental renames.
- [x] Run targeted typechecks/tests -- prove API, worker, and contracts still agree at compile time.

**Acceptance Criteria:**

- Given the existing API and worker queue modules, when they compile, then every referenced queue key resolves from the shared `@entalent/contracts` queue contract.
- Given admin queue stats initialize, when `/admin/queues` reads queue counts, then it covers all canonical queues including `profile-hydration`, `style-analysis`, and `group-report`.
- Given existing Redis queues already contain jobs, when this refactor deploys, then queue string values remain byte-for-byte identical and existing jobs remain addressable.
- Given a developer adds or renames a queue key later, when they update only one service-local module, then TypeScript/tests expose the missing shared contract update.

## Spec Change Log

## Design Notes

The shared package should own names, not Nest registration. Keeping registration service-local avoids forcing API to register worker-only queues as producers and avoids collapsing app-specific queue module boundaries. Compatibility re-exports keep the initial blast radius small while still moving ownership to the shared contract.

## Verification

**Commands:**

- `pnpm --filter @entalent/contracts test -- queue.test.ts` -- expected: queue contract tests pass.
- `pnpm --filter @entalent/contracts typecheck` -- expected: shared contract compiles.
- `pnpm --filter @entalent/contracts build` -- expected: generated workspace declarations include queue exports for downstream package typechecks.
- `pnpm --filter @entalent/api typecheck` -- expected: API imports and admin queue tooling compile.
- `pnpm --filter @entalent/worker typecheck` -- expected: worker processors/modules compile.

## Suggested Review Order

**Canonical Contract**

- Start here: one source now owns every queue string.
  [`queue.ts:1`](../../packages/contracts/src/queue.ts#L1)

- Derived list prevents contract/list drift in operational tooling.
  [`queue.ts:18`](../../packages/contracts/src/queue.ts#L18)

**Service Bindings**

- API keeps local registration, but imports shared names.
  [`queue.module.ts:4`](../../apps/api/src/queue/queue.module.ts#L4)

- Worker keeps broader registration from the same source.
  [`queue.module.ts:4`](../../apps/worker/src/queue/queue.module.ts#L4)

- Admin stats now sees every canonical queue.
  [`queues.controller.ts:33`](../../apps/api/src/admin/queues.controller.ts#L33)

**Retry Safety**

- Ambiguous queue-local job IDs no longer retry the first match.
  [`queues.controller.ts:71`](../../apps/api/src/admin/queues.controller.ts#L71)

- Queue-qualified retry handles expanded dead-letter coverage.
  [`queues.controller.ts:99`](../../apps/api/src/admin/queues.controller.ts#L99)

**Verification**

- Contract tests pin current queue names and coverage.
  [`queue.test.ts:5`](../../packages/contracts/src/queue.test.ts#L5)

- Controller tests cover ambiguous and queue-qualified retry.
  [`queues.controller.test.ts:5`](../../apps/api/src/admin/queues.controller.test.ts#L5)
