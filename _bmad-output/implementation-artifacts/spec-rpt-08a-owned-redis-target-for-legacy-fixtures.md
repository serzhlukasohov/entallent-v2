---
title: 'RPT-08a: Owned named Redis target for the two legacy RPT-07 fixtures'
type: 'chore'
created: '2026-10-31'
status: 'done'
review_loop_iteration: 0
baseline_commit: 237d7075ff08f262ccf3cbe2bf7c36cb390d204e
context:
  - '{project-root}/_bmad-output/planning-artifacts/pulse-check-reports/PRODUCTION-BLOCKERS-PLAN.md'
  - '{project-root}/runs/rpt-08/official-profile-skip-audit.json'
  - '{project-root}/docs/pulse-report-cutover-operations.md'
---

<frozen-after-approval reason="human-owned intent - do not modify unless human renegotiates">

## Intent

**Problem:** `pulse-report-connected.integration.test.ts` and `pulse-report-lifecycle-queue.integration.test.ts` accept only `redis://127.0.0.1:56385/15`. That Redis is not ours and must not be touched, so both suites have never run under the official profile or on an owned target; `runs/rpt-08/official-profile-skip-audit.json` records them as the two unverified legacy behaviors (about 5% of broad local verification).

**Approach:** Replace the hard-coded port check in both files with one shared guard that accepts any explicitly named, loopback, db-15 Redis target the operator owns, and proves ownership at runtime by claiming an exclusive owner key on an empty database. Then run both suites natively on an owned Redis and record source-bound evidence. Human preservation-scope exception for these two files granted in chat on 2026-10-31 ("Yes, start RPT-08a").

## Boundaries & Constraints

**Always:** The guard runs before any queue or worker is created and requires all of: `REDIS_URL` host `127.0.0.1`, path `/15`; `RPT07_REDIS_TARGET` equal to `host:port/15` of that URL (explicit naming, same convention as `PULSE_ACCEPTANCE_REDIS_TARGET`); db 15 empty except for the guard's own key; owner key set with `NX` and a per-run nonce, released only if it still holds that nonce. A guard failure throws (fails the suite), never skips. The test bodies, oracles, timeouts and `describe.runIf` conditions stay byte-identical apart from the guard call and the connection object derived from it.

**Ask First:** Touching Redis `127.0.0.1:56385` in any way; changing any oracle or assertion in the two files; adding these suites to the strict acceptance lanes or changing the official harness profile; commits/push/PR.

**Never:** Accept a non-loopback host or a db other than 15; fall back to a default target when `RPT07_REDIS_TARGET` is missing; `FLUSHDB`/`FLUSHALL` or deleting keys other than the guard's owner key and the `bull:<queueName>:*` keys of queue names registered with the claim during the owned run (human renegotiation 2026-10-31: queue cleanup of the suite's own random-UUID queues allowed so db 15 returns to empty); weakening the guard to make a run pass.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
| --- | --- | --- | --- |
| Owned target | `REDIS_URL=redis://127.0.0.1:56465/15`, `RPT07_REDIS_TARGET=127.0.0.1:56465/15`, empty db 15 | Guard claims owner key; suite runs; key released after | N/A |
| Unnamed target | `RPT07_REDIS_TARGET` missing or different | Throw `requires_named_owned_rpt07_redis` before any Redis write | Suite fails |
| Non-loopback or wrong db | host `localhost`/remote, or path `/0` | Throw before connecting | Suite fails |
| Non-empty db | db 15 has foreign keys | Throw `rpt07_redis_not_empty`; nothing written | Suite fails |
| Concurrent claim | Owner key already held | Throw `rpt07_redis_owner_conflict` | Suite fails |
| Default profile | No `REDIS_URL` | Suites skipped by the existing `runIf` (unchanged) | N/A |

</frozen-after-approval>

## Code Map

- `packages/database/src/__tests__/pulse-report-connected.integration.test.ts:32` -- fixed-port check to replace; connection built at line ~116.
- `packages/database/src/__tests__/pulse-report-lifecycle-queue.integration.test.ts:17` -- fixed-port check to replace; connection at line 20.
- `scripts/run-pulse-report-acceptance.ts:23-53,175` -- existing named-target and `SET NX` owner pattern to mirror.
- `runs/rpt-08/official-profile-skip-audit.json` -- record of the two unverified behaviors to supersede with new evidence.

## Tasks & Acceptance

**Execution:**
- [x] `packages/database/src/__tests__/rpt07-owned-redis.fixture.ts` -- `claimOwnedRpt07Redis(env)` returning `{ connection, release }`; checks as in Always; unit test for every matrix row that does not need a live Redis.
- [x] The two preserved files -- replace only the fixed-port check with the guard call, take `connection` from it, release in the existing `finally`/`afterAll`; record before/after hashes and an exact diff under `runs/rpt-08a/`.
- [x] Start a new owned Redis (127.0.0.1:56465, recorded in an inventory under `runs/rpt-08a/`), run both suites against a fresh migrated owned PostgreSQL database, and run the guard-rejection rows live.
- [x] Update `runs/rpt-08/official-profile-skip-audit.json` successor evidence (new file, original kept), `docs/pulse-report-cutover-operations.md` remainder note, logs.

**Acceptance Criteria:**
- Given an owned, named, empty Redis target, when both suites run, then all their tests pass with zero skips and the owner key is gone afterwards.
- Given each rejection row, when the guard runs, then it throws before any queue or worker exists and db 15 is unchanged.
- Given the default official profile, when the harness runs, then it passes with the same skip set as before.

## Verification

**Commands:**
- Unit test for the guard; both suites with `DATABASE_URL`, `REDIS_URL`, `RPT07_REDIS_TARGET` on owned targets -- pass, zero skips.
- `pnpm --filter @entalent/database typecheck` and lint -- pass.
- `pnpm harness:check -- --base 237d7075ff08f262ccf3cbe2bf7c36cb390d204e` on a migrated owned database -- exit 0 with receipt.

## Implementation and verification evidence — 2026-10-31

Implemented after `[A]`. One renegotiation during implementation (recorded in Never): release may remove the suite's own registered `bull:<queueName>:*` keys so db 15 returns to empty between suites. Step04 review: 4 patches (S1 owner-key leak on setup failure, S2 live test clobbering a claim, S3 non-atomic release, S4 GETDEL version) and 1 defer (S5 new env-gated skips, recorded); `runs/rpt-08a/step04-triage.json`.

- Preserved files: whitespace-insensitive diff is 13 changed lines each (import, guard call, owned queue name/connection, try/finally release); oracles, timeouts and `runIf` unchanged. Hashes and diffs: `runs/rpt-08a/{before,after}-hashes.txt`, `preserved-files.diff`, `preserved-files.ignore-whitespace.diff`.
- Owned Redis 127.0.0.1:56465 (inventory `runs/rpt-08a/owned-service-inventory.json`), fresh migrated `entalent_rpt08a_int`: guard + both legacy suites 14/14 in six runs (three after review patches), db 15 empty after each.
- Live rejection: unnamed target fails with `requires_named_owned_rpt07_redis` before any Redis write.
- Default profile: 9 pure guard tests pass; 2 legacy suites + 3 live guard rows skip by `runIf`.
- Typecheck, eslint and prettier clean for touched files.
- Official harness on fresh migrated `entalent_rpt08a_harness`: passed, receipt `runs/harness/receipt-1793477460245-4b1ae190.json` (254 passed, 23 skipped; +9 passed and +3 env-gated skips versus the RPT-10 receipt). Successor skip audit `runs/rpt-08a/official-profile-skip-audit-rpt08a.json`: zero unverified legacy fixed-port behaviors.
- Not done: the strict acceptance bundle was not rerun (these suites are not in its lanes; no lane input changed).

## Suggested Review Order

**Guard (entry point)**

- Claim: NX owner key with nonce and TTL, then the db must hold nothing else.
  [`rpt07-owned-redis.fixture.ts:57`](../../packages/database/src/__tests__/rpt07-owned-redis.fixture.ts#L57)

- Named loopback db-15 target check runs before any connection.
  [`rpt07-owned-redis.fixture.ts:14`](../../packages/database/src/__tests__/rpt07-owned-redis.fixture.ts#L14)

- Release deletes only registered queue keys, then atomic compare-and-delete of the owner key.
  [`rpt07-owned-redis.fixture.ts:89`](../../packages/database/src/__tests__/rpt07-owned-redis.fixture.ts#L89)

**Preserved legacy fixtures (exception granted)**

- Claim just before queue creation; release in an outer finally.
  [`pulse-report-connected.integration.test.ts:113`](../../packages/database/src/__tests__/pulse-report-connected.integration.test.ts#L113)

- Same pattern for the repair suite.
  [`pulse-report-lifecycle-queue.integration.test.ts:18`](../../packages/database/src/__tests__/pulse-report-lifecycle-queue.integration.test.ts#L18)

**Tests**

- Pure rejection rows (run in every profile).
  [`rpt07-owned-redis.integration.test.ts:11`](../../packages/database/src/__tests__/rpt07-owned-redis.integration.test.ts#L11)

- Live claim, conflict, non-empty and takeover rows on an owned target.
  [`rpt07-owned-redis.integration.test.ts:49`](../../packages/database/src/__tests__/rpt07-owned-redis.integration.test.ts#L49)
