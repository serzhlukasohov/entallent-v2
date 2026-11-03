---
title: 'Admin API trace lookup and export'
type: 'feature'
created: '2026-11-01'
status: 'done'
baseline_commit: '04a72313fa7e9c9a299fb6e9891efa1eeb3b3fd4' # HEAD; the tree was already dirty (stories 1-4 uncommitted)
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-conversation-trace-qa-tests/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-conversation-trace-qa-tests/stories/4-production-conversation-trace.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 4 stores every traced turn encrypted in `conversation_turn_traces`, but nobody can read it: QA holds only Slack text and has no way to find the turn behind a message or see its trace (SPEC CAP-7).

**Approach:** Two admin API routes: a search that decrypts a bounded window of one tenant's traces server side and returns turns whose employee message or bot reply contains a text fragment, and an export that turns one conversation's traced turns into suite-report JSON the existing `render-report.mjs` renders like a sim run. The turn-to-report view moves from `from-sim-run.mjs` into `@entalent/conversation-trace` so sim and export share it. A `pnpm trace:export` script fetches and renders.

## Boundaries & Constraints

**Always:**
- `ApiKeyGuard`; `tenantId` is a required UUID query parameter; every SQL statement filters by it; nothing crosses tenants.
- Every search and export appends an `audit_logs` row (`admin.conversation_trace_searched`, `admin.conversation_trace_exported`) before the response leaves; an audit failure fails the request. Audit metadata holds counts and parameters, never the fragment or message text.
- Search text travels in a POST JSON body, never in the URL (request and proxy logs).
- Search is bounded: window 1-30 days (default 7), newest first, pages of 100 rows, at most 1,000 rows decrypted and 5 s of scanning per request, at most 50 matches (default 20); the response says when a bound stopped the scan. Fragment length 3-500.
- Export is bounded to the newest 200 turns (default 100) of the conversation, shown oldest first; turn numbers are ordinals by `started_at` across the conversation's retained traces.
- Logs and errors carry fixed codes and counts only; an undecryptable or unparsable row is skipped and counted.
- The routes are mounted only when `CONVERSATION_TRACE_ADMIN_ENABLED=true`; by default the production route boundary is unchanged.
- The sim suite report keeps byte-identical output after the view moves.

**Never:**
- No schema change or migration; no worker or turn-runtime change; no MAF or `agent-service`.
- No live LLM calls, sims or `harness:check`; the CLI is never run against a remote host here.
- No dashboard page (later), no precondition extraction (story 6).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fragment found | tenant A row whose userMessage contains `Sprint Review` (any case, extra spaces) | match with ids, times, status, `matchedIn: employee`, snippet around the hit | N/A |
| Bot-reply hit | fragment only in responseText | match with `matchedIn: bot` | N/A |
| Other tenant | same text stored in tenant B only | no match; tenant B rows never read | N/A |
| Bounds | 1,000+ rows, or 5 s budget used | scan stops; `scanStopped: 'row_limit' \| 'time_limit'` | N/A |
| Bad input | tenantId missing / not UUID; fragment < 3 or > 500; days/limit out of range | 400 | Nest validation |
| Undecryptable row | ciphertext of another key | skipped, `skipped` count + 1 | fixed log code, no content |
| Export | 3 traced turns, one failed | report JSON with 3 user/bot step pairs, failed one `missing` with its error and events; status `failed` | N/A |
| Export of unknown conversation | no rows for tenant + conversation | 404 after audit | N/A |
| Audit insert fails | DB error on audit | 500; no trace data returned | thrown |

</frozen-after-approval>

## Code Map

- `packages/conversation-sim/report/from-sim-run.mjs` -- `humanizeMeta`, `META_LABEL`, `EVENT_LABEL`, `turnSections`, `stepBadges` move out; script imports them from `@entalent/conversation-trace` (dist, CJS named exports work from ESM). Everything else stays.
- `packages/conversation-trace/src/report/turn-view.ts` (new) -- typed port of those functions; `turnSections(turn, trace)` / `stepBadges(turn, trace)` take the whole event list (sim `s.trace`) instead of the run.
- `packages/conversation-trace/src/report/trace-export.ts` (new) -- `buildTraceExportReport` (rows + decrypted payloads -> suite report), `findFragment` (normalized match + snippet), report types.
- `packages/conversation-sim/report/suite-report.schema.json`, `render-report.mjs` -- validation and rendering of the export in tests; unchanged.
- `apps/api/src/onboarding/onboarding-restart.controller.ts` -- pattern: `ApiKeyGuard`, `@Query('tenantId', ParseUUIDPipe)`, `AuditLogRepository.append` with `actorType/actorId: 'admin'`.
- `apps/api/src/channel/ingestion.service.ts` -- `decryptField(…, FIELD_ENCRYPTION_KEY)` pattern (no encryption adapter in the API).
- `apps/api/src/dev/dev-endpoints.ts`, `app.module.ts` -- env-gated module mount pattern.
- `apps/api/src/private-production-route-boundary.test.ts` -- forbids `conversation|messages` admin routes in default production; must stay green.
- `packages/database/src/schema/conversation-turn-traces.ts` -- indexes `(tenant_id, conversation_id, started_at)`; search scans by `(tenant_id, started_at)` within the window (no new index: 30-day retention bounds the table).
- `packages/config/src/env.ts`, `.env.example` -- new optional `CONVERSATION_TRACE_ADMIN_ENABLED`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/conversation-trace/src/report/*`, `index.ts`, tests -- shared view + export builder + fragment matcher; tests validate an export against the schema and render it.
- [x] `packages/conversation-sim/report/from-sim-run.mjs` -- import the shared view; baseline output diff is empty.
- [x] `apps/api/src/conversation-trace/*` -- reader (tenant-scoped SQL), service (bounded decrypt scan, export), controller, module, mount gate; unit tests for every matrix row; DB integration test skipped without `DATABASE_URL`.
- [x] `apps/api/package.json`, `app.module.ts`, `packages/config/src/env.ts`, `.env.example` -- wiring and opt-in.
- [x] `scripts/trace-export.mjs`, root `package.json` -- `pnpm trace:export`.

**Acceptance Criteria:**
- Given default production env, when the route boundary test runs, then its admin route snapshot is unchanged; given the opt-in, then exactly the two trace routes are added.
- Given existing suites, when api, conversation-trace and conversation-sim (99 pass + 1 skip) tests run, then all pass.

## Implementation Notes

- Implemented directly by the build agent (dispatch note: no implementation subagent).
- Shared view: `packages/conversation-trace/src/report/turn-view.ts` (typed port of `humanizeMeta`, `META_LABEL`, `EVENT_LABEL`, `turnSections`, `stepBadges`, plus `eventChainSection`) and `report/trace-export.ts` (`buildTraceExportReport`, `findFragment`, `normalizeForMatch`, `parseTracedTurnPayload`, suite-report types). `from-sim-run.mjs` imports them from the package `dist`; old vs new script on the same 38 synthetic tests over 41 runs gives byte-identical JSON.
- API: `apps/api/src/conversation-trace/` -- `conversation-trace.reader.ts` (tenant-filtered keyset paging, export rows + older count), `conversation-trace-admin.service.ts` (bounded decrypt scan, export, audit), `conversation-trace-admin.controller.ts`, `conversation-trace-admin.module.ts`, `conversation-trace-admin.mount.ts`; `app.module.ts` mounts the module only with `CONVERSATION_TRACE_ADMIN_ENABLED`. `@entalent/conversation-trace` added to `apps/api` deps (lockfile relinked offline).
- Routes: `POST /api/v1/admin/conversation-traces/search?tenantId=` body `{text, days?, limit?}`; `GET /api/v1/admin/conversation-traces/conversations/:conversationId/export?tenantId=&limit=`. Audit actions `admin.conversation_trace_searched` (resource tenant; counts, bounds, matched trace-row and conversation ids) and `admin.conversation_trace_exported` (resource conversation; turns, totalTurns, unreadable).
- `scripts/trace-export.mjs` + root `pnpm trace:export`; exercised only against a scratch local HTTP stub, never a real or remote API.
- The reader integration test (`conversation-trace.reader.integration.test.ts`) is skipped without `DATABASE_URL`; migration 0054 is still not applied locally, so it has not run.
- The route boundary test now stubs `CONVERSATION_TRACE_ADMIN_ENABLED` empty for its default-production snapshot (unchanged) and has a second case for the opt-in.

## Spec Change Log

## Review Triage Log

| # | Source | Finding | Verdict | Route | Evidence |
|---|---|---|---|---|---|
| 1 | blind | Audit actor is the constant `admin`; no operator identity | medium | defer | Shared `ADMIN_API_KEY` carries no identity (pre-existing for every admin route); needs per-operator credentials |
| 2 | blind | Search audit does not say which conversations were disclosed | medium | patch | Metadata now holds `matchedTraceRowIds` and `matchedConversationIds`; test asserts them |
| 3 | blind | Repeated common-word searches can page through a tenant's text | medium | defer | Per-request bounds only; needs a per-tenant/key rate limit or cumulative budget |
| 4 | blind, edge | Time budget skipped the page queries; no statement timeout | medium | patch | Budget now checked before each page query; DB statement timeout deferred with #3 |
| 5 | blind | No `(tenant_id, started_at)` index for search | low | defer | Spec forbids a schema change here; 30-day retention bounds the scan |
| 6 | blind, edge, verification | `row_limit` reported when the window held exactly 1,000 rows | low | patch | A one-row peek decides; test with exactly the bound |
| 7 | blind, edge | Older-count ignores ties on `started_at` | low | patch | Count uses the same `(started_at, id)` keyset |
| 8 | blind | Step numbers read as conversation positions | low | patch | Given block states numbers are ordinals among retained traces |
| 9 | blind | CLI sends the admin key over plain HTTP to remote hosts | low | patch | Non-loopback `http:` refused |
| 10 | blind | `--search` text lands in shell history | low | reject | Header documents it; a stdin mode adds surface for a local operator tool |
| 11 | blind, edge | `--out` can write an export into tracked folders | low | patch | Warning when inside the repo but outside `runs/` |
| 12 | blind | Raw error text shown in the export | false | reject | The export is the decrypted conversation for an audited admin; error text is part of the trace by design (story 4) |
| 13 | blind | No HTTP-level auth test; guard open when key unset outside production; non-constant-time compare | low | defer | `ApiKeyGuard` is pre-existing and shared; guard metadata asserted; production fails closed |
| 14 | blind | Unknown tenant id gives the same 404 | low | reject | Tenant probing still requires the admin key and is audited |
| 15 | blind | Search returns `userId` with a snippet | low | patch | Removed from matches; test asserts absence |
| 16 | blind | No runbook / railway doc for the flag; task log | low | patch | Runbook in Design Notes, README section, task-log row; railway-deploy doc update deferred |
| 17 | blind | `from-sim-run.mjs` needs the built package | low | patch | README states the build step (sim tests already need built workspace packages) |
| 18 | edge, verification | Completed turn cut to the minimum shown as a crash | medium | patch | Branch now checks `record.status`; test added |
| 19 | edge | Non-string `userMessage`/`responseText` would throw in the matcher | low | patch | `parseTracedTurnPayload` rejects them and malformed events; tests added |
| 20 | edge | All turns unreadable exports as passed | low | patch | Status `error`; schema-validated test |
| 21 | edge | CLI accepts non-numeric `--days/--limit/--turns` | low | patch | Integer check |
| 22 | edge | CLI crashes with a stack on network/JSON errors | low | patch | Caught, fixed message, exit 2 |
| 23 | edge | CLI silent when `ADMIN_API_KEY` unset | low | patch | Warning (local dev API may have no key) |
| 24 | edge | CLI flag value can swallow the next flag; unknown flags ignored | low | patch | Known-flag list and value check |
| 25 | verification | Shared view rows not pinned by any test | gap | patch | Row-level assertions for classifier, state, pulse and humanized metadata |
| 26 | verification | CLI has no automated test | gap | defer | Operator-only script; verified against a scratch HTTP stub |

## Design Notes

Decisions taken without a human (approvals waived by Illia): POST for search keeps message text out of URLs; a separate env opt-in rather than reusing `INTERNAL_DASHBOARD_ENABLED`, because the reviewed production boundary deliberately keeps conversation views off the shared admin key and turning this on is an explicit operator decision; audit after the read (with counts) but before the response, so no data leaves unaudited; the export is one suite "test" whose status is `failed` when any traced turn failed, with no judge and one comparison row per failed turn.

Runbook: turn tracing on for a tenant with `insert into feature_flags (key, tenant_id, enabled) values ('conversation_trace', '<tenant uuid>', true)` (the worker picks it up within 30 s; `enabled = false` turns it off). Start the API with `CONVERSATION_TRACE_ADMIN_ENABLED=true` (a Railway variable change needs Illia's approval). Then `pnpm trace:export -- --tenant <uuid> --search "<fragment>"` and `pnpm trace:export -- --tenant <uuid> --conversation <uuid>` with `TRACE_API_BASE` and `ADMIN_API_KEY` set; exports land in `runs/trace-exports/` and never get committed. Review access with `GET admin/audit-logs?action=admin.conversation_trace_searched` (or `_exported`).

## Verification

**Commands:**
- `pnpm --filter @entalent/conversation-trace build && pnpm --filter @entalent/conversation-trace test` -- pass.
- `pnpm --filter @entalent/api test` -- pass.
- `pnpm --filter @entalent/conversation-sim test` -- 99 pass + 1 skip.
- baseline diff of `from-sim-run.mjs` output before/after -- empty.
- `pnpm exec turbo run typecheck --force --concurrency=1`, `pnpm lint` -- pass.
