# Agent Failure Log

Use this file to turn agent misses into harness improvements.

## Template

```md
## YYYY-MM-DD: short title
- Symptom:
- Expected:
- Root cause layer: instructions | context | architecture | verification | environment | workflow | tooling
- Harness fix:
- Regression check:
- Status: open | fixed | obsolete
```

## Open Failures

## 2026-09-29: V2 implementation expanded into adjacent runtime recovery

- Symptom: The local PR #7 implementation grew to 265 changed or untracked files, including generic memory, profile, style, follow-up, and V1 report recovery that the approved V2 spec does not directly request.
- Expected: Each changed area should trace to IA-001–IA-047 or to a demonstrated dependency of the V2 cutover.
- Root cause layer: workflow
- Harness fix: Audit changed paths against the BMad spec's in-scope and out-of-scope lists before handoff; separate adjacent reliability changes after checking dependencies and preserve unrelated work.
- Regression check: Review `git status --porcelain`, the PR diff, and a requirement-to-file map before any PR update.
- Status: open

## 2026-09-29: Gate receipt was cited without checking its file

- Symptom: A status update named a nonexistent full-harness receipt despite the run passing.
- Expected: A receipt link must identify the actual JSON file produced by the last gate.
- Root cause layer: verification
- Harness fix: List the newest receipt and read its structured statuses before citing it; correct the task log when a citation is wrong.
- Regression check: `test -f <reported-receipt>` and inspect its `status` and `checks` fields before reporting.
- Status: fixed

## 2026-09-29: Late API receipt excluded a pre-cutoff Slack event from recovery

- Symptom: An inbound confirmation with `occurredAt` before cycle cutoff but `receivedAt` after cutoff held temporary Bundle content, while the admission scanner excluded the event and could not restore its job.
- Expected: REQ-009 eligibility and recovery use the durable source-event timestamp, independent of API or queue delay.
- Root cause layer: architecture
- Harness fix: Remove the `receivedAt < periodEnd` filter from the admission recovery query and keep a PostgreSQL fixture with a pre-cutoff event received after cutoff.
- Regression check: Run the focused admission and cutoff PostgreSQL integration tests; both must retain the Bundle before a receipt and purge it after processing.
- Status: fixed

## 2026-09-29: Full harness test failure lost its assertion in truncated output

- Symptom: The first full harness run after group-report recovery reported `test` failed, but the streamed output was truncated before the failing assertion could be identified. The standalone worker suite and a second full harness run passed.
- Expected: Every failed harness test check should preserve the exact failing command and assertion in a bounded diagnostic artifact.
- Root cause layer: verification
- Harness fix: Have the harness capture each test command's failure summary in an artifact with no private fixture content; investigate the underlying test if it recurs.
- Regression check: Re-run the full harness with output captured and inspect the failing test summary whenever status is failed.
- Status: open

## 2026-09-29: Group-report recovery fixture inserted an already queued intent

- Symptom: The first migrated PostgreSQL recovery test failed with `conversation_dispatch_intent_scope_mismatch` when it inserted a new intent with `lastQueuedAt` already populated.
- Expected: The fixture should follow the production two-step commit then enqueue transition enforced by migration `0046`.
- Root cause layer: verification
- Harness fix: Insert the committed intent without a queue timestamp, then update `lastQueuedAt` after insert.
- Regression check: Run the focused migrated PostgreSQL/Redis group-report recovery fixture.
- Status: fixed

## 2026-09-29: Cutoff recovery fixture lacked new follow-up repository methods

- Symptom: The focused cutoff test failed after the scanner began querying committed follow-up sends and executions because its repository fake lacked those methods.
- Expected: A focused scanner fixture should model each recovery port it exercises and fail only for behavior regressions.
- Root cause layer: verification
- Harness fix: Extend the scanner fixture with the follow-up recovery methods and retain the migrated PostgreSQL/Redis delivery regression.
- Regression check: `pnpm --filter @entalent/worker test:focused src/survey/question-cutoff.processor.test.ts` and the opt-in follow-up delivery recovery fixture.
- Status: fixed

## 2026-09-29: Multiline type assertion broke message-send test parsing

- Symptom: The first focused Vitest and worker typecheck run could not parse a multiline `as Job<MessageSendJob>` assertion in the new privacy regression.
- Expected: The test should compile and exercise the delivery-error boundary.
- Root cause layer: verification
- Harness fix: Bind the job data separately and use a single unambiguous assertion at the call site.
- Regression check: `pnpm --filter @entalent/worker exec vitest run src/message-send/message-send.processor.test.ts && pnpm --filter @entalent/worker typecheck`.
- Status: fixed

## 2026-09-29: Cutoff receipt probe used a reserved SQL alias

- Symptom: The first migrated PostgreSQL/BullMQ run failed all eight V2 scenarios with `syntax error at or near "window"`.
- Expected: A scoped pending-reply query should run on the production schema before any conversation job changes state.
- Root cause layer: verification
- Harness fix: Renamed the raw SQL alias to `cycle_window` and reran the opt-in queue matrix.
- Regression check: `V2_CONVERSATION_QUEUE_TEST=1` migrated PostgreSQL/Redis worker flow.
- Status: fixed

## 2026-09-29: After-cutoff fixture assumed an intermediate eligibility flag was stage-specific

- Symptom: The new BullMQ cutoff-order test completed the agreement and finalization but failed on `intermediateEligible`, which describes complete `3/3` coverage even when the selected stage is final.
- Expected: The fixture should assert final-stage rows and empty intermediate rows without changing the selector's completion predicate.
- Root cause layer: verification
- Harness fix: Asserted `3/3` eligibility and final-stage content separately; the focused delayed-cutoff queue run passed.
- Regression check: `V2_CONVERSATION_QUEUE_TEST=1` worker test filtered to `afterCutoff=true`.
- Status: fixed

## 2026-09-29: V2 cutoff can discard an in-period confirmation before its queued verdict

- Symptom: A PostgreSQL regression persists a delivered Bundle and employee agreement before `periodEnd`, runs the cutoff cleanup first, then finds no awaiting Bundle for the still-queued confirmation. The three working rows become `no_data` and Bundle components are purged.
- Expected: REQ-009 determines eligibility from persisted event timestamps, so queue ordering must not change the outcome of an in-period confirmation; private derivatives must still be purged after resolution.
- Root cause layer: architecture
- Harness fix: Added a content-free job receipt and cutoff barrier, bypassed rapid-message coalescing for pending Bundle replies, and retained passing PostgreSQL and BullMQ cutoff-before-verdict regressions.
- Regression check: `DATABASE_URL=<isolated-postgres> pnpm --filter @entalent/worker exec vitest run src/survey/repositories/question-insight.repository.bundle.integration.test.ts`.
- Status: fixed

## 2026-09-29: Report-input test asserted request fields outside repository scope

- Symptom: The first selector test failed when an intermediate request changed `reportKind` and `now`, although the repository should receive only stable window scope.
- Expected: The fixture should assert tenant, person, window, definition, and question group independently of report stage and clock.
- Root cause layer: verification
- Harness fix: Scope the repository fixture assertion to the fields it actually owns.
- Regression check: `pnpm --filter @entalent/application exec vitest run src/use-cases/select-question-insight-inputs.use-case.test.ts`.
- Status: fixed

## 2026-09-29: Worker typecheck used stale application package declarations

- Symptom: Worker typecheck rejected the new selector fields before the changed application package had been rebuilt.
- Expected: Cross-package typecheck should read declarations built from the current application source.
- Root cause layer: workflow
- Harness fix: Build `@entalent/application` before a standalone worker typecheck after changing its public types; the full Turbo typecheck already builds dependencies in order.
- Regression check: `pnpm --filter @entalent/application build && pnpm --filter @entalent/worker typecheck`.
- Status: fixed

## 2026-09-29: Expanded queue fixture assumed database row order and pre-purge Bundle status

- Symptom: The first partial-confirmation queue run failed because the fixture compared unordered working rows positionally; a later assertion expected `resolved` after finalization had already advanced the Bundle to `purged`.
- Expected: The fixture should match question identity and assert the lifecycle state at the observed boundary.
- Root cause layer: verification
- Harness fix: Index working rows by question ID and assert `purged` only after finalization, while checking text and components are null.
- Regression check: `V2_CONVERSATION_QUEUE_TEST=1 DATABASE_URL=<isolated-postgres> REDIS_URL=<isolated-redis-db-15> pnpm --filter @entalent/worker test -- src/conversation/v2-conversation-flow.integration.test.ts`.
- Status: fixed

## 2026-09-29: Full AppModule fixture lacked constructor metadata in Vitest

- Symptom: The first production AppModule HTTP fixture returned 500 on a valid Company Admin session because Vitest transpilation left `CompanyAdminSessionService` without its database constructor dependency.
- Expected: The fixture should execute the real session and route guards against migrated PostgreSQL.
- Root cause layer: verification
- Harness fix: Declare design-time constructor metadata for the session, identity, guard, and tested controllers in the fixture before importing AppModule.
- Regression check: `DATABASE_URL=<isolated-postgres> REDIS_URL=<isolated-redis> pnpm --filter @entalent/api test -- src/company-auth/company-admin-session.integration.test.ts` checks a positive Admin session and negative role/private-route matrix.
- Status: fixed

## 2026-09-29: V2 prompt attributed old employee evidence to a new message

- Symptom: The live model extracted clear-goal evidence from an older employee turn when the latest turn only asked about weather, despite an instruction to focus on the latest turn.
- Expected: V2 working meaning attributed to a source message must originate in that employee message, with the preceding assistant question used only to interpret a short reply.
- Root cause layer: architecture and verification
- Harness fix: Limit V2 evaluator input to the source inbound message and nearest preceding outbound message; keep the latest-turn instruction. Add an isolated synthetic model probe for unrelated and grounded short replies.
- Regression check: `pnpm --filter @entalent/application test -- src/use-cases/survey-evidence.use-case.test.ts` and `pnpm exec dotenv -e .env -- node --import tsx scripts/verify-v2-model-bridge.ts` when model credentials are available.
- Status: fixed

## 2026-09-29: Isolated typecheck read stale built workspace declarations

- Symptom: AI and worker package typechecks rejected the new optional survey evaluation argument until upstream application and AI packages were rebuilt; the first model command also resolved a different system `dotenv` binary.
- Expected: Targeted downstream checks should use the current workspace declarations and repository-local dotenv CLI.
- Root cause layer: tooling
- Harness fix: Build changed upstream workspace packages before isolated downstream typecheck; invoke `pnpm exec dotenv`. The full harness already follows dependency order.
- Regression check: `pnpm --filter @entalent/application build`, `pnpm --filter @entalent/ai-openai build`, then `pnpm --filter @entalent/worker typecheck`.
- Status: fixed

## 2026-09-29: Backfill boundary fix used an unavailable array method

- Symptom: The first backfill boundary change passed its behavior test but failed application typecheck because `findLastIndex` is outside the configured ES2022 library.
- Expected: A targeted change should pass both behavior tests and the package's configured TypeScript target.
- Root cause layer: verification
- Harness fix: Use a reverse index loop compatible with ES2022 and run package typecheck alongside the focused test.
- Regression check: `pnpm --filter @entalent/application typecheck` plus `pnpm --filter @entalent/application test -- src/use-cases/survey-evidence.use-case.test.ts`.
- Status: fixed

## 2026-09-29: Local verification used the wrong Vitest and PostgreSQL binaries

- Symptom: Root `pnpm exec vitest` could not find Vitest, and the default `pg_ctl` was version 14 against a PostgreSQL 17 data directory.
- Expected: Targeted tests and isolated PostgreSQL should start with the package-local test runner and matching server version.
- Root cause layer: tooling
- Harness fix: Use `pnpm --filter @entalent/application test -- <test-path>` and `/opt/homebrew/opt/postgresql@17/bin/pg_ctl` for this local fixture.
- Regression check: Confirm the package test command resolves Vitest and `pg_ctl --version` matches `PG_VERSION` before starting an existing cluster.
- Status: fixed

## 2026-09-29: Clarification continued after its Bundle prompt was deleted

- Symptom: A partially resolved Bundle still exposed its disputed private meaning and accepted a clarification after the original outbound confirmation message was soft-deleted.
- Expected: A deleted original prompt cannot authorize further clarification reads, prompt staging, or verdict application.
- Root cause layer: architecture and verification
- Harness fix: Require the original Bundle prompt to remain sent, outbound, scoped, and undeleted at all three clarification boundaries; preserve a safe scope error.
- Regression check: `DATABASE_URL=<isolated-postgres> pnpm --filter @entalent/worker exec vitest run src/survey/repositories/question-insight.repository.bundle.integration.test.ts` deletes the original prompt before each boundary.
- Status: fixed

## 2026-09-29: Route inventory test exceeded Vitest default timeout

- Symptom: The full harness failed when the production AppModule route inventory took 5.01 seconds under parallel API tests, just beyond Vitest's default five-second limit.
- Expected: A module-graph privacy assertion should have enough time for cold imports while still failing if initialization stalls.
- Root cause layer: verification
- Harness fix: Give this import-heavy test a scoped 15-second timeout; leave the global test timeout unchanged.
- Regression check: `DATABASE_URL=<isolated-postgres> pnpm harness:check -- --base origin/main` runs the route inventory alongside other API tests.
- Status: fixed

## 2026-09-29: Resolved clarification text survived in a partial Bundle

- Symptom: With two disputed questions, confirming the first left its private statement in the Bundle `components` until the second dispute was resolved.
- Expected: Each resolved question loses its Bundle copy immediately; only still-pending disputed statements remain.
- Root cause layer: architecture and verification
- Harness fix: Lock the Bundle in the clarification verdict transaction, remove the resolved component, verify the remainder matches pending questions, and purge the Bundle after the final verdict.
- Regression check: `DATABASE_URL=<isolated-postgres> pnpm --filter @entalent/worker exec vitest run src/survey/repositories/question-insight.repository.bundle.integration.test.ts` with two disputed questions resolved in sequence.
- Status: fixed

## 2026-09-29: BullMQ repeat metadata stores interval as text

- Symptom: The first isolated Redis cutoff test failed because it expected numeric `every: 300000`, while `getRepeatableJobs()` returned the persisted value as `"300000"`.
- Expected: The test should assert BullMQ's public readback shape while still proving the five-minute interval.
- Root cause layer: verification
- Harness fix: Assert the stored string interval and retain the live repeat-registration check.
- Regression check: `V2_CUTOFF_QUEUE_TEST=1 DATABASE_URL=<isolated-postgres> REDIS_URL=<isolated-redis-db-15> pnpm --filter @entalent/worker exec vitest run src/survey/repositories/survey.repository.cutoff.integration.test.ts`.
- Status: fixed

## 2026-09-29: Connector preflight accepted a silent Redis socket

- Symptom: `harness:preflight` passed with a TCP connection to Redis DB 15, but a subsequent Redis command did not receive a reply and had to be stopped.
- Expected: Preflight should confirm a bounded protocol response from the named Redis and PostgreSQL targets before allowing connector payloads.
- Root cause layer: verification and tooling
- Harness fix: Preflight now sends bounded Redis PING and PostgreSQL `select 1` through the configured clients, keeping credentials and responses out of receipts. A direct fake listener regression and the local blocked-Redis preflight verify fail-closed behavior.
- Regression check: `pnpm exec tsx scripts/agent-harness.test.ts` uses silent TCP listeners for both services; a live `pnpm harness:preflight` must return blocked when Redis does not answer PING.
- Status: fixed

## 2026-09-29: Timed Redis probe left a pending command rejection

- Symptom: The first protocol-probe test appeared to pass, then the process crashed when ioredis rejected a queued command after disconnect.
- Expected: A timed preflight returns blocked and exits cleanly without an unhandled rejection.
- Root cause layer: tooling and verification
- Harness fix: Use one explicit deadline for the whole Redis operation, disable ioredis command timeouts, handle client error events, and disconnect in `finally`.
- Regression check: `pnpm exec tsx scripts/agent-harness.test.ts` completes and exits zero after silent Redis and PostgreSQL probes.
- Status: fixed

## 2026-09-29: V2 accepted replies to deleted confirmation prompts

- Symptom: A pending bundle could still be selected and its reply applied after the stored outbound confirmation prompt was marked deleted; the clarification reply transaction had the same missing guard.
- Expected: Only a still-present, delivered outbound prompt may authorize a bundle or clarification verdict.
- Root cause layer: architecture and verification
- Harness fix: Check outbound direction, deletion state, and active window in the bundle read; check deletion state again inside both verdict transactions.
- Regression check: `DATABASE_URL=<isolated-postgres> pnpm --filter @entalent/worker exec vitest run src/survey/repositories/question-insight.repository.bundle.integration.test.ts` with deleted-prompt cases.
- Status: fixed

## 2026-09-29: V1 confirmation reads crossed a V2 policy binding

- Symptom: A legacy pending or awaiting group state remained visible to the V1 conversation confirmation lookup after its survey window was bound to V2.
- Expected: V2-bound windows never surface V1 confirmation prompts or block unrelated V1 pending groups.
- Root cause layer: architecture and verification
- Harness fix: Exclude V2-bound windows from both V1 confirmation reads and the pending-group blocker subquery; extend the migrated-PostgreSQL quarantine fixture beyond report inputs.
- Regression check: `DATABASE_URL=<isolated-migrated-postgres> pnpm --filter @entalent/worker exec vitest run src/survey/repositories/group-state.repository.v2-quarantine.integration.test.ts`.
- Status: fixed

## 2026-09-29: Isolated PostgreSQL restart used the default port

- Symptom: A migrated-DB regression could not connect to port 55435 after `pg_ctl start` restarted the disposable cluster on its default port 5432.
- Expected: The test cluster resumes on its assigned isolated port.
- Root cause layer: environment and tooling
- Harness fix: Pass `-o '-p 55435'` when starting this disposable cluster and check `pg_isready` before the DB test.
- Regression check: `pg_isready -h 127.0.0.1 -p 55435` succeeds before invoking Vitest with the matching `DATABASE_URL`.
- Status: fixed

## 2026-09-29: Local API shutdown did not finish after SIGTERM

- Symptom: The compiled API kept listening after SIGTERM during two isolated route checks and required forced stop; the second check showed multiple Redis sockets still established.
- Expected: The local API should release its HTTP and Redis handles promptly on shutdown.
- Root cause layer: tooling; the specific Nest or BullMQ lifecycle owner is unverified.
- Harness fix: Add a bounded compiled-API shutdown smoke, identify which lifecycle provider retains Redis sockets, then close that owner before changing lifecycle code.
- Regression check: Launch compiled API on a local test port, send SIGTERM, and assert the listener and process exit within a bounded interval.
- Status: open

## 2026-09-29: Vitest API bootstrap omitted Nest constructor metadata

- Symptom: A Vitest-based HTTP check returned 500 because `ApiKeyGuard` received no `Reflector`; the compiled API returned 401 for the same unauthenticated route.
- Expected: HTTP access acceptance should exercise the compiled production DI path.
- Root cause layer: verification and tooling
- Harness fix: Drop the incompatible Vitest AppModule bootstrap; use the compiled API with isolated PostgreSQL and Redis for HTTP route acceptance, while keeping the network-free module-graph unit test.
- Regression check: Compiled API yields 404 for private routes with a fixture admin key and 401/200 for a mounted admin route without/with that key.
- Status: fixed

## 2026-09-29: Model bundle changed display text capitalization

- Symptom: A synthetic model-generated bundle rendered `You` while its mapped statement used `you`, so exact-text validation rejected an otherwise traceable three-question bundle.
- Expected: A unique case-only variation maps back to the exact displayed phrase; ambiguous or substantive differences remain invalid.
- Root cause layer: architecture and verification
- Harness fix: Normalize a unique case-insensitive match to the displayed phrase at the bundle boundary and retain focused exact-text and ambiguous-match regressions plus the synthetic model bridge.
- Regression check: `pnpm --filter @entalent/application exec vitest run src/utils/question-bundle-composition.test.ts` and `pnpm exec tsx scripts/verify-v2-model-bridge.ts` with configured model credentials.
- Status: fixed

## 2026-09-29: Route metadata helper used a banned broad function type

- Symptom: Full harness failed API lint on the new production route inventory test because its reflection helper used `Function`.
- Expected: The route metadata test should satisfy repository lint while still accepting Nest controller classes.
- Root cause layer: verification
- Harness fix: Use a minimal decorated-class shape with a prototype record and cast method handlers to `object` for metadata inspection.
- Regression check: `pnpm --filter @entalent/api lint` and `pnpm --filter @entalent/api exec vitest run src/private-production-route-boundary.test.ts`.
- Status: fixed

## 2026-09-29: Production route inventory test lacked a valid config fixture

- Symptom: The first module-graph test passed its assertions but Vitest reported an asynchronous environment-validation rejection because required service variables were absent.
- Expected: Importing the production AppModule for route metadata should complete without background config errors or external connections.
- Root cause layer: environment and verification
- Harness fix: Supply synthetic database, Redis, encryption, model, and admin-key values before importing AppModule; keep the route test network-free and restore the environment afterward.
- Regression check: `pnpm --filter @entalent/api exec vitest run src/private-production-route-boundary.test.ts` must exit zero without unhandled errors.
- Status: fixed

## 2026-09-29: One failed Question Insight blocked later confirmed questions

- Symptom: `executePending` stopped at the first failing confirmed question, so another confirmed question for the same employee was never finalized during that job attempt.
- Expected: Independent confirmed questions should each receive a finalization attempt while the job still reports a safe failure for retry.
- Root cause layer: architecture and verification
- Harness fix: Continue through the pending list, remember whether any attempt failed, and throw a stable batch error after processing all questions; keep a two-question regression with a failing first item.
- Regression check: `pnpm --filter @entalent/application exec vitest run src/use-cases/finalize-question-insight.use-case.test.ts`.
- Status: fixed

## 2026-09-29: Partial Bundle retained accepted and declined private statements

- Symptom: A partial confirmation kept the full displayed Bundle and all three component statements while only one question needed clarification; the first cleanup patch then hit the parser's exact-three assumption.
- Expected: After the partial verdict, only disputed question statements remain as temporary analytical content; clarification can still find its mapped statement.
- Root cause layer: architecture and verification
- Harness fix: Scrub Bundle display text and non-disputed components in the verdict transaction, then validate one or two components on the clarification path while retaining exact-three validation for initial Bundle replies.
- Regression check: `DATABASE_URL=<isolated-postgres> pnpm --filter @entalent/worker exec vitest run src/survey/repositories/question-insight.repository.bundle.integration.test.ts`.
- Status: fixed

## 2026-09-29: Labeled-name parser consumed an unrelated preceding word

- Symptom: After adding Polish and Ukrainian labels, the first implementation let `Atlas` through when the source said `my Project Atlas`; a broad word-plus-name match consumed `my Project` before the parser reached the project label.
- Expected: Every recognized project or person label should contribute its following proper name to the privacy rejection set, even in the middle of a sentence.
- Root cause layer: verification
- Harness fix: Match known labels first, then parse the following proper name with a separate case-sensitive Unicode expression; keep English, Polish, and Ukrainian label-drop regressions.
- Regression check: `pnpm --filter @entalent/application exec vitest run src/use-cases/finalize-question-insight.use-case.test.ts`.
- Status: fixed

## 2026-09-28: V2 provider interface expansion missed wrappers and a test mock

- Symptom: Package typechecks failed because `RecordingAiProvider` and a focused application test mock lacked the new question-bundle provider method; the worker initially saw an older built provider declaration.
- Expected: The interface, live provider, fallback router, recording wrapper, scripted fake, worker service, test mocks, and built declarations should agree before package typechecks run.
- Root cause layer: verification
- Harness fix: Treat every `AiProviderPort` change as a cross-package contract edit; build application and provider packages before checking consumers, then run the full workspace typecheck.
- Regression check: `pnpm typecheck`.
- Status: fixed

## 2026-09-29: SQL-shape test missed invalid correlated exclusion syntax

- Symptom: API SQL-shape tests passed, but the migrated-PostgreSQL analytics fixture failed with `syntax error at or near "SELECT"` because `notExists(sql`...`)` emitted an unparenthesized subquery.
- Expected: The V2 policy exclusion should compile and execute in PostgreSQL.
- Root cause layer: verification
- Harness fix: Use an explicit `NOT EXISTS (SELECT ...)` SQL fragment and keep a migrated-PostgreSQL fixture covering overview, coverage, and trends before and after policy binding.
- Regression check: `DATABASE_URL=<isolated-migrated-postgres> pnpm --filter @entalent/api exec vitest run src/admin/v2-analytics-quarantine.integration.test.ts`.
- Status: fixed

## 2026-09-29: Trends fixture crossed the UTC reporting-day boundary

- Symptom: The first API integration fixture saw a scored funnel but zero daily signal capture at local midnight in Warsaw.
- Expected: The fixture's synthetic evidence should fall inside the UTC range used by the trends response.
- Root cause layer: verification
- Harness fix: Set fixture evidence time twelve hours before the test instant and use a two-day range; keep separate funnel and question assertions independent of the daily bucket.
- Regression check: Run `v2-analytics-quarantine.integration.test.ts` near the local/UTC date boundary.
- Status: fixed

## 2026-09-26: default local database lacks hierarchy migration

- Symptom: A read-only local tenant inventory that included `people` failed because the existing `entalent` database has not received the hierarchy migrations.
- Expected: Inventory commands should identify schema readiness before querying new hierarchy tables.
- Root cause layer: environment
- Harness fix: Use the separate fully migrated `entalent_hierarchy_acceptance` database for integration acceptance; query legacy-only tables when inspecting the untouched default database.
- Regression check: Check `to_regclass('public.people')` and migration status before new-schema inventory; verify integration commands target the named acceptance database.
- Status: fixed

## 2026-09-28: Privacy route test used the banned broad Function type

- Symptom: API lint rejected the new module-registration test's `Function[]` cast.
- Expected: A structural route assertion should pass the repository's TypeScript lint rules.
- Root cause layer: verification
- Harness fix: Treat reflective Nest metadata as `unknown[]` and assert membership without a broad callable type.
- Regression check: `pnpm --filter @entalent/api lint`.
- Status: fixed

## 2026-09-26: hand-built backfill SQL fixture omitted Drizzle columns

- Symptom: The first synthetic backfill apply attempts failed because the temporary `audit_logs` and `org_units` tables omitted standard columns emitted by Drizzle inserts.
- Expected: A transaction check should exercise the intended backfill behavior with a schema matching the application.
- Root cause layer: verification
- Harness fix: Added full-schema local rollout integration coverage and ran backfill acceptance against the complete pgvector-capable migration chain instead of the abbreviated fixture.
- Regression check: On an isolated migrated PostgreSQL database, run reconciliation, dry-run, apply, and repeat apply; verify zero dry-run writes, one approved graph, and zero repeat inserts. Run `DATABASE_URL=<local-isolated-db> pnpm --filter @entalent/api exec vitest run src/hierarchy/hierarchy-rollout.integration.test.ts` for transactional rollout.
- Status: fixed

## 2026-09-25: required harness commands attempted dependency installation

- Symptom: Both `pnpm exec tsx scripts/agent-harness.ts reflection` and `pnpm harness:check -- --base origin/main` found no local dependencies, started a workspace install, and entered repeated npm registry retries that could not resolve in the managed network environment.
- Expected: Required reflection and final harness commands should use already provisioned tooling and must not mutate or install the workspace before a documentation-only task.
- Root cause layer: environment
- Harness fix: Provision workspace dependencies before the task or provide a dependency-independent reflection launcher that fails fast when its runtime is absent.
- Regression check: Run reflection and `harness:check` in a clean checkout with network disabled; each must produce its artifact or a clear no-runtime diagnostic without invoking `pnpm install`.
- Status: open

## 2026-09-18: local dashboard production verifier lacked the admin key

- Symptom: `pnpm dashboard:prod:verify` stopped before network access with `ADMIN_API_KEY is required` because the local `.env` does not contain the production dashboard credential.
- Expected: Production dashboard verification should use the target service environment without printing or copying secrets into the local shell.
- Root cause layer: environment
- Harness fix: When the local key is absent, run the existing read-only verifier through `railway run --service dashboard --environment production --`.
- Regression check: The Railway-backed rerun passes API health, manager team/trends, and all dashboard routes.
- Status: fixed

## 2026-09-08: production survey cycle open script rejects Date values

- Symptom: `railway run --service api -- ... pnpm exec tsx scripts/open-survey-reporting-cycle.ts` failed with `The "string" argument must be of type string or an instance of Buffer or ArrayBuffer. Received an instance of Date`.
- Repeat: A V2 confirmation PostgreSQL fixture passed a `Date` directly to a raw `postgres` tagged SQL parameter and failed with the same error; serializing it to ISO resolved the fixture error.
- Expected: The production open-cycle helper should create a reporting cohort using the same Date inputs accepted by the application use case and Drizzle schema.
- Root cause layer: tooling
- Harness fix: The repository serializes the raw SQL instant to ISO; `scripts/open-survey-reporting-cycle.integration.test.ts` now executes the same script/use-case/repository path against migrated PostgreSQL and verifies roster creation and idempotent retry.
- Regression check: `DATABASE_URL=<isolated-migrated-postgres> pnpm exec tsx scripts/open-survey-reporting-cycle.integration.test.ts`.
- Status: fixed
- Verification limit: isolated DB proof; production command was not rerun.

## 2026-09-08: terse style adaptation still asks a question every turn

- Symptom: Post-Grill `terse-user` scenario failed twice because the follow-up conversation produced question counts `1, 1, 1, 1`; the code comment says terse style should ask only every other turn, but `applyTerseStyle()` only shortens the response.
- Expected: A learned terse style should keep a normal colleague tone while allowing at least one short statement-only reply instead of interrogating every terse acknowledgement.
- Root cause layer: architecture
- Harness fix: Enforce question pacing in the shared reply strategy/plan boundary for confident terse profiles, not in scenario-specific prompt wording.
- Local fix: `applyTerseStyle()` now uses the already-loaded user-turn count to keep questions only on odd terse turns; focused orchestrator regressions and the live pacing assertions pass.
- Regression check: `pnpm --filter @entalent/conversation-sim exec vitest run src/scenarios/terse-user.sim.test.ts`
- Status: fixed

## 2026-09-08: exact Annna replay still re-enters rejected pulse/report framing

- Symptom: Post-Grill `annna-intent-fidelity` failed twice: one gate sample kept answering with reporting disclosure after the user asked for chatbot-answer criteria, and the repeat classified the `No, you keep circling` correction turn as `closing` instead of `correction`.
- Expected: Consultation requests about another chatbot should be answered directly; when the employee rejects the prior frame, the corrected request should control the response and stale pulse/report assumptions should stay out.
- Root cause layer: architecture
- Harness fix: Narrow the reporting-disclosure route and harden latest-turn correction normalization/classification for mixed rejection-plus-request messages.
- Local fix: Provider normalization now accepts reporting-question evidence only from the raw latest user message, preserves explicit Russian reporting questions, and promotes mixed rejection requests misclassified as `closing` to `correction`; focused AI/application regressions and the final live sample pass.
- Regression check: `pnpm --filter @entalent/conversation-sim exec vitest run src/scenarios/annna-intent-fidelity.sim.test.ts`
- Status: fixed

## 2026-09-08: scenario reports mark deterministic checks clear before post-report assertions

- Symptom: `memory-recall`, `terse-user`, and `annna-intent-fidelity` markdown reports show `Deterministic checks all clear` even though later test assertions fail the same scenario.
- Expected: Scenario artifacts should include post-report hard assertion failures so a failed gate cannot look clean when read from the per-scenario report.
- Root cause layer: verification
- Harness fix: Move scenario hard assertions into the reported deterministic check path or append assertion failures to the report before the test exits.
- Regression check: `pnpm --filter @entalent/conversation-sim exec vitest run src/scenarios/memory-recall.sim.test.ts`
- Status: open

## 2026-09-03: BMad config resolver called without project root

- Symptom: `resolve_config.py` exited with a required `--project-root` argument error.
- Expected: BMad configuration resolves before planning the implementation slice.
- Root cause layer: tooling
- Harness fix: Use `python3 _bmad/scripts/resolve_config.py --project-root "$PWD"` and the customization resolver command from the skill.
- Regression check: Both resolver commands exit zero before creating the next spec.
- Status: fixed

## 2026-09-03: Local PostgreSQL check blocked by sandbox socket policy

- Symptom: the first Docker status and localhost database test attempts returned permission errors.
- Expected: approved local integration verification reaches the existing Postgres container.
- Root cause layer: environment
- Harness fix: Run read-only Docker status and local integration tests with the required sandbox escalation, without changing container state.
- Regression check: `pnpm exec dotenv -e .env -- pnpm --filter @entalent/database test:integration`
- Status: fixed

## 2026-09-03: Index inspection used unsafe shell quoting

- Symptom: the first ad hoc PostgreSQL index query was parsed incorrectly before the successful schema check.
- Expected: inspect the generated active-confirmation index without shell interpolation errors.
- Root cause layer: tooling
- Harness fix: Pass inspection SQL through a quoted heredoc or a migration-aware test instead of nested command-line quoting.
- Regression check: the integration test asserts staged-candidate uniqueness directly.
- Status: fixed

## 2026-09-03: ambiguous one-line patch changed the wrong test fixture
- Symptom: A patch intended for the acknowledgement assertion matched the first `topicAnchor: null` in the file and changed the shared base fixture; the targeted test stayed red.
- Expected: The patch should update only the assertion inside `passes acknowledgement dialogue state to response generation`.
- Root cause layer: tooling
- Harness fix: Include the enclosing test or assertion context when patching repeated literals, then inspect the focused file diff before running tests.
- Regression check: `git diff -- packages/application/src/use-cases/conversation-orchestrator.test.ts` must show only the intended assertion line before the targeted test runs.
- Recurrence: On 2026-09-05 an unscoped status-line patch changed the first failure entry; it was immediately corrected with heading-scoped context.
- Status: fixed

## 2026-09-03: GitHub PR metadata refresh blocked by network
- Symptom: Two consecutive `gh pr view 5 --repo serzhlukasohov/entallent-v2` refreshes failed with `error connecting to api.github.com` after the PR metadata had been captured earlier in the audit.
- Expected: A read-only PR metadata refresh should return the current branch, file, review, and check state.
- Root cause layer: environment
- Harness fix: Treat an earlier captured PR snapshot as evidence for the same audit run, report that the final live refresh was unavailable, and avoid repeated retries without a network-state change.
- Regression check: Run one `gh pr view 5 --repo serzhlukasohov/entallent-v2 --json state,headRefName,baseRefName,statusCheckRollup`; retry only after connectivity changes.
- Status: open

## 2026-09-03: acknowledgement reply-plan test contradicts its fixture
- Symptom: `pnpm test` fails because the acknowledgement fixture sets `topicAnchor` to `the release shipped over the weekend` while the assertion expects `topicAnchor: null`.
- Expected: The test should assert the intended typed plan and agree with the fixture and renderer pause behavior.
- Root cause layer: verification
- Harness fix: Correct the stale assertion or explicitly normalize acknowledgement anchors in `buildReplyPlan`, then keep one focused regression for the chosen behavior.
- Regression check: `pnpm --filter @entalent/application test -- src/use-cases/conversation-orchestrator.test.ts -t "passes acknowledgement dialogue state"`
- Status: fixed

## 2026-09-03: root integration command silently drops database environment
- Symptom: `pnpm exec dotenv -e .env -- pnpm test:integration` exits successfully while all database tests are skipped because Turbo does not pass `DATABASE_URL` to the package task.
- Expected: With a local database URL present, the documented root command should execute the integration tests or fail clearly.
- Root cause layer: workflow
- Harness fix: `turbo.json` declares `DATABASE_URL` for `test:integration`, so package integration tests receive the database URL.
- Regression check: `pnpm exec dotenv -e .env -- pnpm test:integration` must report 25 executed tests, not 25 skipped.
- Status: fixed

## 2026-08-19: TS quality gate misclassifies repeated memory assertion
- Symptom: Story 11.2 made `terse-user` pass hard/judge, but `memory-recall` again failed its required-grounding assertion and the console again mislabeled the product assertion as `infra_failed`, causing an unnecessary retry.
- Expected: The gate should report the memory assertion as a hard product failure without an infrastructure retry; turn-taking scenarios should remain green.
- Root cause layer: verification
- Harness fix: Classify scenario assertion failures separately from model/network failures in the gate runner; address memory grounding in its own story rather than expanding Story 11.2.
- Regression check: `SIM_GATE_RUNS=1 pnpm sim:gate`
- Recurrence: On 2026-09-08 post-Grill verification, `memory-recall` reproduced twice: final replies remembered the payments-architecture defense, but `requiredGrounding` was empty.
- Harness fix: Require the planner's highest-priority memory anchor for unanchored emotional support; the focused unit regression and live Azure OpenAI/LangWatch scenario pass.
- Status: fixed

## Obsolete / Retired Failures

These entries are retained as historical evidence but are not active work because MAF and `agent-service` are no longer supported.

## 2026-08-19: packaged Python runtime schema drifted from canonical OpenAPI
- Symptom: `test_python_service_packages_shared_runtime_openapi_schema` fails because the packaged Python schema omits `greeting_opens_conversation`.
- Expected: The deployable Python artifact must exactly match `packages/contracts/runtime/openapi.json`.
- Root cause layer: workflow
- Harness fix: Keep the packaged schema synchronized whenever the canonical runtime schema changes.
- Regression check: `agent-service/.venv/bin/python -m pytest agent-service/tests/unit/test_runtime_contract.py -q`
- Status: fixed

## 2026-08-20: Model-provider mypy baseline is not clean
- Symptom: Whole-file mypy reports three pre-existing errors at lines 721, 782, and 857 outside the engagement diff.
- Expected: Typed runtime verification should distinguish new errors from baseline debt.
- Root cause layer: verification
- Harness fix: None planned; do not spend current verification effort on the retired model-provider path.
- Regression check: Not active while MAF and `agent-service` remain unsupported.
- Status: obsolete

## 2026-09-03: BMad resolver scripts have different CLI contracts

- Symptom: `resolve_config.py` required `--project-root`, while passing that same flag to `resolve_customization.py` failed as an unknown argument.
- Expected: Resolve BMad config and skill customization without trial-and-error invocations.
- Root cause layer: workflow
- Harness fix: Call `resolve_config.py --project-root <root>` and run `resolve_customization.py --skill <path> --key workflow` from the project root.
- Regression check: Run both commands before entering the selected BMad workflow step.
- Status: fixed

## 2026-09-03: Worker SQL test read stale database declarations

- Symptom: A focused worker repository test compiled malformed SQL until `@entalent/database` was rebuilt after schema changes.
- Expected: Consumer tests resolve current workspace schema declarations.
- Root cause layer: workflow
- Harness fix: Build changed producer packages before running focused consumer tests.
- Regression check: `pnpm --filter @entalent/database build` before worker repository verification.
- Status: fixed

## 2026-09-03: Review agents failed after writing edits

- Symptom: Two REQ-015 agents ended with local `404 /v1/responses`, so they could not return their final reports although their filesystem edits remained.
- Expected: Agent completion returns both edits and a reviewable result.
- Root cause layer: tooling
- Harness fix: Treat the shared worktree as authoritative, inspect the diff locally, then restart failed agents for read-only review.
- Regression check: `collaboration.list_agents` followed by local `git diff` before reassigning failed work.
- Status: fixed

## 2026-09-03: Focused simulation command ran the full live suite

- Symptom: `pnpm --filter @entalent/conversation-sim sim -- <file>` passed an extra separator to Vitest, ran live scenarios, and hit blocked model/network calls.
- Expected: Run only the deterministic receipt regression.
- Root cause layer: workflow
- Harness fix: Use `pnpm --filter @entalent/conversation-sim exec vitest run <file>` for focused simulation tests.
- Regression check: Output must list only the requested test file.
- Status: fixed

## 2026-09-03: Local integration test blocked by sandbox network policy

- Symptom: The first local Postgres run failed with `connect EPERM` to `localhost:5434` despite the database being available.
- Expected: Execute migration and constraint tests against the confirmed local database.
- Root cause layer: environment
- Harness fix: Verify the redacted database target, then rerun the same test with local network escalation.
- Regression check: `pnpm --filter @entalent/database test:integration` reports executed tests rather than connection errors or skips.
- Status: fixed

## 2026-09-03: Simulation TypeScript target lacks Array.findLast

- Symptom: Root typecheck rejected `MessageRecord[].findLast` in the simulation receipt fake.
- Expected: The deterministic fake compiles under the repository's ES2022 target.
- Root cause layer: architecture
- Harness fix: Use the existing array APIs supported by ES2022.
- Regression check: `pnpm --filter @entalent/conversation-sim typecheck`.
- Status: fixed

## Fixed Failures

## 2026-09-26: onboarding delivery projection test lagged new receipt fields

- Symptom: Focused worker tests failed because the outbound delivery projection assertion omitted the newly selected Slack receipt and onboarding binding fields.
- Expected: The repository test should verify the fields consumed by the sender after the projection changes.
- Root cause layer: verification
- Harness fix: Update the projection assertion alongside the sender's required fields and keep the focused repository test in the worker check.
- Regression check: `pnpm --filter @entalent/worker test -- src/conversation/repositories/conversation.repository.test.ts`
- Status: fixed

## 2026-09-07: Homebrew Node drift left active node linked to a removed dylib

- Symptom: After installing `node@24`, active Homebrew `node` still pointed at `node` 25.2.1 and failed with `Library not loaded: /opt/homebrew/opt/simdjson/lib/libsimdjson.29.dylib`.
- Expected: The repo shell uses a working Node 24 runtime matching CI before running pnpm/tsx gates.
- Root cause layer: environment
- Harness fix: Add `.node-version`/`.nvmrc`, install `node@24`, and link Homebrew to `node@24` so `node`, `npm`, and `corepack` resolve to the CI major.
- Regression check: `node -v`, `pnpm -v`, and `pnpm run agent:preflight`.
- Status: fixed

## 2026-09-07: Full prepush aggregates a MAF script under non-MAF task boundaries

- Symptom: `pnpm prepush` passed typecheck, lint, and package tests, then reached `test:scripts`; rerunning `pnpm test:scripts` outside the sandbox was rejected because the aggregate includes `scripts/live-maf-primary-app-smoke.test.ts` while the task explicitly prohibited MAF and agent-service work.
- Expected: A non-MAF implementation slice should have a deterministic prepush-equivalent gate that does not execute MAF smoke scripts.
- Root cause layer: workflow
- Harness fix: Split `test:scripts` into MAF and non-MAF script-test commands, add `prepush:non-maf`, and add `agent:preflight` so scoped verification does not cross MAF boundaries.
- Regression check: `pnpm run agent:preflight` and `pnpm run prepush:non-maf`.
- Status: fixed

## 2026-09-07: Parallel BMad memlog appends race on a shared temp file

- Symptom: Two concurrent `memlog.py append` calls to the same workspace caused one append to fail with `.memlog.md.tmp` missing during `os.replace`.
- Expected: BMad decision logging should be append-only and reliable.
- Root cause layer: tooling
- Harness fix: Never run multiple `memlog.py append` calls for the same workspace in parallel; append sequentially.
- Regression check: BMad spec self-validation entries are appended one at a time.
- Status: fixed

## 2026-09-05: confirmation summary label leaked into Slack text

- Symptom: Real Slack confirmation prompt displayed the internal `confirmationSummary:` field label before the employee-facing summary.
- Expected: The employee sees only natural confirmation copy, while `metadata.confirmationSummary` remains available for exact-summary persistence.
- Root cause layer: architecture
- Harness fix: Reject label-bearing confirmation drafts at the OpenAI provider validation boundary and fail closed in the orchestrator if any provider returns one.
- Regression check: `pnpm --filter @entalent/ai-openai test -- src/openai-provider.test.ts` and `pnpm --filter @entalent/application test -- src/use-cases/conversation-orchestrator.test.ts`.
- Status: fixed

## 2026-09-03: channel-slack package has no Vitest dependency

- Symptom: The first Slack timestamp regression used Vitest and package typecheck could not resolve the import.
- Expected: A package-local timestamp check runs with declared dependencies.
- Root cause layer: tooling
- Harness fix: Use Node's built-in `node:test` and `node:assert` for the two adapter checks.
- Regression check: `node --import tsx --test packages/channel-slack/src/slack.adapter.test.ts`
- Status: fixed

## 2026-08-24: GitHub auth/permission unavailable for PR creation
- Symptom: `git push -u origin codex/grill-session-docs` failed with `could not read Username for 'https://github.com': Device not configured`; SSH push failed with `Permission denied (publickey)`; `gh` was not installed. Reproduced on 2026-09-02 after GitHub CLI auth was configured: account `yjinia` was authenticated, but push to `serzhlukasohov/entallent-v2` was denied with HTTP 403.
- Expected: A requested PR should be pushed and opened from the local branch.
- Root cause layer: environment
- Harness fix: Configure GitHub auth for an account with write access to the repo, grant `yjinia` write access, or push to a fork and open a cross-repo PR.
- Regression check: `git push -u origin <branch>` with the intended account or authenticated PR creation through the GitHub connector.
- Status: fixed on 2026-09-02 after repo write access was granted; push and PR creation succeeded.

## 2026-08-21: npx unavailable for skill install command
- Symptom: `npx skills add https://github.com/mattpocock/skills --skill grill-with-docs` failed with `zsh:1: command not found: npx`.
- Expected: A user-provided skill install command should either run directly or have a documented fallback.
- Root cause layer: environment
- Harness fix: Use the preinstalled skill-installer helper script to install GitHub skills when Node/npm shims are unavailable.
- Regression check: `python3 ~/.codex/skills/.system/skill-installer/scripts/install-skill-from-github.py --repo mattpocock/skills --path skills/grill-with-docs`
- Status: fixed

## 2026-08-20: TSX IPC socket blocks full pre-push inside sandbox
- Symptom: `pnpm prepush` passed monorepo typecheck, lint, and package tests, then `test:scripts` failed with `listen EPERM` for the TSX IPC socket.
- Expected: Complete script-test verification despite the sandbox IPC restriction.
- Root cause layer: environment
- Harness fix: Rerun the scoped `pnpm test:scripts` check outside the sandbox when TSX IPC is denied; the outside-sandbox verification passed.
- Regression check: `pnpm test:scripts`
- Status: fixed

## 2026-08-29: Initial autonomous harness review found boundary gaps
- Symptom: Independent review found that shallow/default diffs could miss committed retired changes, overrides were not receipted, malformed preflight had no receipt, and generated repair branches could recurse or validate with a self-modified harness.
- Expected: Every changed path and automation revision must stay inside the approved deterministic, retired-surface, connector, and human-review boundaries.
- Root cause layer: workflow
- Harness fix: Pin complete/source revisions, use merge-base and no-renames, validate trusted copied harness code, record safe override/path evidence, block recursive repairs, and keep connector/model-provider guards aligned.
- Regression check: `pnpm exec tsx scripts/agent-harness.test.ts`, workflow YAML parse, and manual workflow permission/guard inspection.
- Status: fixed

## 2026-08-29: Workflow YAML smoke used a newer Psych option
- Symptom: The first local YAML parse failed because system Ruby 2.6 does not support `YAML.load_file(..., aliases: true)`.
- Expected: The dependency-free workflow syntax smoke should run on the repository host Ruby.
- Root cause layer: tooling
- Harness fix: Use the compatible plain `YAML.load_file(file)` call; these workflows do not use YAML aliases.
- Regression check: `ruby -e "require 'yaml'; ARGV.each { |f| YAML.load_file(f) }" .github/workflows/*.yml`
- Status: fixed

## 2026-08-20: Local Slack connector smoke blocked by sandbox infra limits
- Symptom: API/worker dev processes fail to start (`AggregateError ... connect EPERM ... 127.0.0.1:5432/6380`) and `curl /api/v1/channel/slack/events` returns `000` because local services are unreachable in this environment.
- Expected: A signed Slack event should be accepted and processed, producing conversation queue work and outbound commit metadata.
- Root cause layer: environment
- Harness fix: `pnpm harness:preflight` now verifies safe PostgreSQL/Redis host-port targets and blocks before connector payloads.
- Regression check: `pnpm exec tsx scripts/agent-harness.test.ts`
- Status: fixed

## 2026-08-19: TS quality gate misclassifies scenario assertions
- Symptom: A scenario assertion containing network/timeout wording was mislabeled `infra_failed` and retried.
- Expected: A report or assertion is a hard product failure; only report-free transport failures retry.
- Root cause layer: verification
- Harness fix: Route the gate through the pure report-first failure classifier.
- Regression check: `pnpm --filter @entalent/conversation-sim test -- src/gate/failure-classifier.test.ts`
- Status: fixed

## 2026-08-28: Mixed rejection plus request escaped correction policy
- Symptom: One exact Annna sample classified `No, you keep circling` plus the corrected criteria request as `request`, allowing an unnecessary rubric offer after the direct answer.
- Expected: An explicit rejection controls response shape even when the same message contains a new request: answer it directly, ask zero questions, and stop.
- Root cause layer: architecture
- Harness fix: Add a classifier example and a deterministic provider-boundary normalization for unambiguous rejection-prefixed requests; keep the exact scenario strict on `correction`, zero questions, and no extra offer.
- Regression check: `pnpm --filter @entalent/ai-openai test -- openai-provider.test.ts prompts/classify.test.ts prompts/respond.test.ts` plus turn 13 of the exact Annna scenario.
- Status: fixed

## 2026-08-28: Explicit `No, forget` varied into acknowledgement
- Symptom: The third exact Annna sample classified the final `No, forget` as `acknowledgement`, reopened the discussion, and asked another question.
- Expected: Unambiguous stop phrases must always become typed `closing` with no topic anchor, follow-up, or additional offer.
- Root cause layer: architecture
- Harness fix: Normalize bounded explicit stop phrases at the provider boundary to `closing` while preserving safety fields; keep the scenario's closing-plan and zero-question assertions.
- Regression check: `pnpm --filter @entalent/ai-openai test -- openai-provider.test.ts` plus turn 15 of the exact Annna scenario.
- Status: fixed

## 2026-08-28: Exact evaluator rejected valid correction wording
- Symptom: Hard assertions rejected valid acknowledgements such as `overreading`, `earlier read was too far off`, and `over-reading`; the post-fix judge also explicitly said no third-person violation was visible but still marked that binary criterion false.
- Expected: The evaluator should accept semantically equivalent admissions and use deterministic checks for exact pronoun constraints without weakening the required correction, direct answer, or no-circling contracts.
- Root cause layer: verification
- Harness fix: Expand only the acknowledgement-synonym matcher, move the no-third-person criterion to a deterministic assertion across all 15 coach replies, and retain typed-plan, content, question, stale-frame, memory, and closing assertions.
- Regression check: `pnpm --filter @entalent/conversation-sim exec vitest run src/scenarios/annna-intent-fidelity.sim.test.ts`
- Status: fixed

## 2026-08-28: Memory extraction copied mentor-authored conclusions into employee state
- Symptom: Exact Annna replay stored `Employee thinks belonging is probably the hardest` after the employee said `have no idea`; another sample turned `No, forget` into a goal.
- Expected: Only the employee's latest explicit assertion or adoption may create or change employee memory; the just-generated mentor reply and closing language are never evidence or goals.
- Root cause layer: architecture
- Harness fix: Bound each extraction to the latest employee message, structurally omit the trailing mentor reply, keep earlier turns as context only, and explicitly reject closing/rejection goals.
- Regression check: `pnpm --filter @entalent/ai-openai test -- prompts/memory.test.ts` plus the exact Annna scenario's mentor-sourced-memory and invalid-closing-goal assertions.
- Status: fixed

## 2026-08-28: Rejected framing returned from stored memory after correction
- Symptom: The correction reply dropped pulse-check/report framing, but two turns later stored project context caused the bot to ask whether criteria should target regular chat or pulse-check answers.
- Expected: A rejected frame must remain suppressed through the immediate corrected exchange without deleting otherwise valid project context.
- Root cause layer: architecture
- Harness fix: Persist correction evidence in outbound decision metadata, suppress response memory for the next two mentor replies, and add a responder-level recent-correction contract that follows the latest request without reviving pre-correction topics.
- Regression check: `pnpm --filter @entalent/application test -- conversation-orchestrator.test.ts` and `pnpm --filter @entalent/ai-openai test -- prompts/respond.test.ts`.
- Status: fixed

## 2026-08-28: Slack Socket Mode explicit disconnect crashed the production API
- Symptom: The production API exited while the Slack client was connecting because `@slack/socket-mode@1.3.6`/`finity` treated `server explicit disconnect` as an unhandled state-machine event; restarting the API restored service.
- Expected: A transient or explicit Socket Mode disconnect should reconnect or fail without terminating the API process.
- Root cause layer: architecture
- Harness fix: Upgrade `@slack/socket-mode` to `2.0.7`, which removes the Finity lifecycle and handles server disconnect through the WebSocket close/reconnect path; keep a regression for disconnect-before-handshake.
- Regression check: `pnpm --filter @entalent/api test -- slack-socket-mode.lifecycle.test.ts`
- Status: fixed

## 2026-08-28: Leading acknowledgement hid a substantive correction
- Symptom: In the exact Annna replay, the message beginning with `yes` and then rejecting the pulse-check interpretation was classified as `acknowledgement / continue_existing_thread`, so the next reply retained manager/report framing.
- Expected: A substantive clarification or rejection must be `correction` even when it begins with a backchannel such as `yes`.
- Root cause layer: instructions
- Harness fix: Restrict `acknowledgement` to messages that are entirely backchannels and state that an explicit correction wins over a leading acknowledgement.
- Regression check: `pnpm --filter @entalent/ai-openai test -- prompts/classify.test.ts prompts/respond.test.ts`; production exact replay must persist `dialogueAct=correction` for the combined `yes`/correction turn.
- Status: fixed

## 2026-08-28: Slack acceptance targeted the wrong app DM
- Symptom: A connector-authored marker appeared in `D09GVMU5S3G` at Slack timestamp `1787867291.624999`, but no enTalent ingress followed because that DM belongs to the separate `AI Agent Bot` app. The production EnTalent DM is `D0BJDC2MPE2`, with bot user `U0BJ018K3CP`.
- Expected: Live acceptance must resolve the product app identity and channel before treating missing ingress as connector or filtering behavior.
- Root cause layer: workflow
- Harness fix: Verify the DM title and bot author before replay. Use `D0BJDC2MPE2` for EnTalent; both authenticated Slack Web and the ChatGPT Slack connector reach the product there, so do not weaken the production anti-loop filter.
- Regression check: Send one connector marker to `D0BJDC2MPE2` and confirm a reply authored by `U0BJ018K3CP` before continuing.
- Status: fixed

## 2026-08-20: metadata trace test expected unsorted keys
- Symptom: `conversation-orchestrator.test.ts` failed after adding `continuityDecision` and `goalDecision` because the test sorted actual metadata keys but the expected list was not sorted.
- Expected: Metadata shape regression should verify keys without failing on a mechanical ordering mismatch.
- Root cause layer: verification
- Harness fix: Keep expected key lists sorted whenever the assertion calls `Object.keys(...).sort()`.
- Regression check: `pnpm --filter @entalent/application test -- conversation-orchestrator.test.ts`
- Status: fixed

## 2026-08-20: Story 11.3 review patch missed fixture and timestamp propagation
- Symptom: Focused orchestrator tests failed after review fixes because owner-aware fixtures were incomplete, an acknowledgement assertion was stale, and the computed inbound timestamp was not passed to continuity resolution.
- Expected: Review patches and their production-shaped fixtures should pass the focused regression before broader verification.
- Root cause layer: workflow
- Harness fix: Run the focused test immediately after each review patch and keep required conversation identity fields in the shared fixture.
- Regression check: `pnpm --filter @entalent/application test -- conversation-orchestrator.test.ts`
- Status: fixed

## 2026-08-20: TSX IPC socket blocks full pre-push inside sandbox
- Symptom: `pnpm prepush` passes monorepo typecheck, lint, and package tests, then `test:scripts` fails with `listen EPERM` for the TSX IPC socket. On 2026-08-29 the escalation also exposed that the default script suite still included a retired live-MAF smoke test.
- Expected: Complete ordinary pre-push verification without invoking retired MAF tooling.
- Root cause layer: workflow
- Harness fix: Remove the retired live-MAF test from `test:scripts`; rerun `pnpm prepush` outside the sandbox only for the remaining TypeScript-owned script checks when TSX IPC is denied.
- Regression check: `pnpm test:scripts`
- Status: fixed

## 2026-08-19: Story 11.2 consumer typecheck read stale declarations
- Symptom: The focused `ai-openai` typecheck rejected new `ReplyPlan` reasons before `application` declarations were rebuilt.
- Expected: Consumer verification should use declarations generated from the current source.
- Root cause layer: workflow
- Harness fix: Build changed upstream packages before focused consumer typechecks, or use root `pnpm typecheck` which orders the dependency graph.
- Regression check: `pnpm --filter @entalent/application build` then `pnpm --filter @entalent/ai-openai typecheck`
- Status: fixed

## 2026-08-19: Story 11.2 test mock missed lint suppression
- Symptom: The first full pre-push stopped on one new `as any` test mock without the repository's required local ESLint suppression.
- Expected: Focused implementation verification should catch lint errors before the broad handoff check.
- Root cause layer: verification
- Harness fix: Run lint for each changed package after focused tests and before the full pre-push.
- Regression check: `pnpm --filter @entalent/application lint`
- Status: fixed

## 2026-08-19: Cross-contract rollback left one stale test reason
- Symptom: After removing two story-local reason enums to avoid MAF/OpenAPI expansion, one reply-plan test still expected the removed acknowledgement reason.
- Expected: Mechanical contract rollback should update every source and test occurrence before verification.
- Root cause layer: workflow
- Harness fix: Run an exact removed-symbol scan before rerunning focused tests.
- Regression check: `rg 'acknowledgement_pauses_conversation|closing_ends_conversation' packages`
- Status: fixed

## 2026-08-18: classifier emits unsupported closing intent
- Symptom: Live Slack closing turn ("Спасибо, пока достаточно. Вернусь к этому позже.") was retried three times and produced no outbound reply.
- Expected: Closing/stop-style turns should map to a valid intent and produce a short, question-free close.
- Root cause layer: architecture
- Harness fix: Normalize known misplaced dialogue-act labels at the classifier boundary and keep closing as a typed `dialogueAct`.
- Regression check: `pnpm --filter @entalent/ai-openai test -- openai-provider.test.ts` plus `pnpm --filter @entalent/application test -- conversation-orchestrator.test.ts`
- Status: fixed

## 2026-08-18: Slack connector attribution flipped ambiguous turn language
- Symptom: Production Slack smoke answered `ok` in English after a Russian conversation.
- Expected: Short ambiguous turns should inherit the recent Russian user-turn language.
- Root cause layer: verification
- Harness fix: Add a production-shaped regression with Slack connector attribution appended to an ambiguous user turn.
- Regression check: `pnpm --filter @entalent/application test -- conversation-orchestrator.test.ts`
- Status: fixed

## 2026-08-15: contextual support smoke repeated stock fallback
- Symptom: Production Slack smoke repeated the stock support phrase after the user pushed back that the reply was too generic.
- Expected: A context-rich support turn should route through the model path instead of repeating deterministic support fallback.
- Root cause layer: verification
- Harness fix: Add a production-shaped regression where a previous stock support reply forces the next support-emotion turn onto the model path.
- Regression check: `agent-service/.venv/bin/python -m pytest agent-service/tests/unit/test_model_provider.py -q`
- Status: fixed

## 2026-09-03: Live Slack smoke write rejected by approval review

- Symptom: Slack channel history was readable, but the approved REQ-012 marker message was rejected before delivery; a schema-probe retry was also rejected.
- Expected: One explicitly authorized marker reaches `D0BJDC2MPE2`, then channel history provides delivery and agent-reply evidence.
- Root cause layer: tooling
- Harness fix: Treat connector write rejection as a hard stop; surface the exact target and message for renewed user approval instead of probing or switching tools.
- Regression check: Read the target first, invoke one direct Slack send only after explicit approval, then verify the unique marker through `slack_read_channel`.
- Status: open

## 2026-09-03: Live Slack smoke transcript hidden after approved send

- Symptom: After renewed explicit approval, one REQ-012 marker delivered to `D0BJDC2MPE2`, but Slack read/search transcript content was returned to Codex as opaque `ccr:` references, so the agent reply text and confirmation summary could not be inspected.
- Expected: Slack smoke should expose model-readable channel history after delivery so follow-up turns can be sent only in response to actual agent text.
- Root cause layer: tooling
- Harness fix: Require a model-readable transcript source before continuing live Slack follow-up turns; use connector message links/search only as delivery evidence.
- Regression check: Send one approved marker, verify returned Slack `ts`, then verify read/search output contains text before sending any reply.
- Status: open

## 2026-09-03: Reporting disclosure receipt did not advance pending confirmation

- Symptom: Live Slack after delivered reporting disclosure repeated disclosure-only text and left `survey_group_states.status = pending_confirmation`.
- Expected: Once current reporting disclosure is delivered before the inbound turn, the next safe non-closing turn should surface the exact displayed confirmation prompt and stage `awaiting_confirmation`.
- Root cause layer: architecture
- Harness fix: Add orchestrator regression for acknowledgement after delivered disclosure and avoid passing disclosure policy hints after current receipt exists.
- Regression check: `pnpm --filter @entalent/application test -- src/use-cases/conversation-orchestrator.test.ts`
- Status: fixed

## 2026-09-03: Delivered confirmation prompt stayed pending after Slack delivery

- Symptom: Slack delivered a confirmation prompt with valid `confirmationSummary`, but `survey_group_states.status` stayed `pending_confirmation` with `confirmation_prompt_message_id` set.
- Expected: A delivered prompt with a valid displayed summary should be treated as awaiting confirmation, including rows that missed the delivery activation hook.
- Root cause layer: architecture
- Harness fix: Make delivered-prompt queries accept both staged pending and awaiting states, guarded by `messages.sent_at IS NOT NULL` and summary validity.
- Regression check: `pnpm --filter @entalent/worker test -- src/survey/repositories/group-state.repository.test.ts src/message-send/message-send.processor.test.ts`
- Status: fixed

## 2026-09-03: Confirmation state SQL passed JS Date through raw template

- Symptom: Real Slack confirmation reply retried and failed with `TypeError [ERR_INVALID_ARG_TYPE]: ArrayBuffer. Received an instance Date` in `ConversationProcessor`.
- Expected: Group confirmation SQL should compare timestamps without passing raw JS `Date` values through untyped SQL template parameters.
- Root cause layer: architecture
- Harness fix: Convert raw timestamp parameters to ISO `::timestamptz` and keep disclosure-before-confirmation check in TypeScript before the SQL update.
- Regression check: `pnpm --filter @entalent/worker test -- src/survey/repositories/group-state.repository.test.ts src/message-send/message-send.processor.test.ts`
- Status: fixed

## 2026-09-05: Confirmation label retry failed closed without Slack reply

- Symptom: After the first label-leak fix, a production Slack turn reached `pending_confirmation`, but worker job 390 failed closed when the model repeated a confirmation draft containing the technical `confirmationSummary:` label; no outbound Slack prompt was delivered.
- Expected: A simple exposed provider label should be normalized before confirmation validation so the user receives the clean confirmation prompt, while invalid summaries still fail closed.
- Root cause layer: architecture
- Harness fix: Strip the simple `confirmationSummary:` label at the OpenAI provider boundary before validation and keep the orchestrator contract guard as the cross-provider safety net.
- Regression check: `pnpm --filter @entalent/ai-openai test -- src/openai-provider.test.ts`
- Status: fixed

## 2026-09-05: Additional pending groups repeat disclosure without confirmation prompt

- Symptom: Full production Slack smoke created `belonging` and `engagement` pending confirmation states, but repeated the reporting disclosure message after acknowledgement and never surfaced a confirmation prompt.
- Expected: Once a pending group has enough evidence and disclosure is delivered, the next safe acknowledgement should show the exact confirmation summary prompt.
- Root cause layer: architecture
- Harness fix: Normalize stale `reporting_explanation` intent at the shared orchestrator boundary only for a substance-free acknowledgement after a delivered disclosure, with a multi-group regression.
- Regression check: Real Slack smoke or orchestrator test covering `belonging`/`engagement` pending states after existing confirmed groups.
- Status: fixed

## 2026-09-05: Confirmation lifecycle copy breaks language and acknowledgement

- Symptom: The full Slack lifecycle confirmed both `engagement` and `belonging`, but both Russian prompts ended with `did I get that right?`; after the second explicit agreement, the bot continued the topic with another question instead of visibly acknowledging confirmation.
- Expected: Confirmation prompts stay in the resolved response language, and an accepted confirmation produces a clear, question-free acknowledgement before normal conversation resumes.
- Root cause layer: architecture
- Harness fix: Remove the literal English confirmation exemplar, disable ordinary follow-up after a successful confirmation, and revalidate the corrected zero-question draft at the provider boundary.
- Regression check: Focused orchestrator/provider tests plus a real Slack confirmation cycle.
- Status: fixed

## 2026-09-05: Documented deterministic harness command does not exist

- Symptom: `pnpm harness:check -- --base HEAD` failed because the root package exposes no `harness:check` script.
- Expected: The specification should name a runnable deterministic repository gate.
- Root cause layer: workflow
- Harness fix: Use the current root `pnpm prepush` gate and verify available scripts from `package.json` before copying older handoff commands.
- Regression check: `jq -e '.scripts.prepush and (.scripts["harness:check"] | not)' package.json` followed by `pnpm prepush`.
- Status: fixed

## 2026-09-06: De-identification gate missed delivery activation and strict accepted proof

- Symptom: Initial typed gate allowed a delivered staged confirmation to become `awaiting_confirmation` without row/message `deidentificationDecision`, accepted malformed decisions with non-empty reasons, and omitted known team identifiers.
- Expected: No candidate reaches confirmation or reporting unless TypeScript records `accepted`, exact `deidentification-v1`, and `reasons: []`, bound to the delivered candidate.
- Root cause layer: architecture
- Harness fix: Share one accepted-proof predicate across stage, delivery activation, confirm, report projection, and parser/type guard; include existing team identifiers in policy input.
- Regression check: `pnpm --filter @entalent/application test -- src/utils/deidentification-policy.test.ts src/use-cases/conversation-orchestrator.test.ts` and `pnpm --filter @entalent/worker test -- src/survey/repositories/group-state.repository.test.ts`
- Status: fixed

## 2026-09-06: Withdrawal columns appended to already-applied migration

- Symptom: Database integration failed after adding `withdrawn_at` and `withdrawal_message_id` to existing `0012` because the local test database had already recorded that migration.
- Expected: New persisted columns apply through a forward migration when any environment may have already applied the previous migration.
- Root cause layer: workflow
- Harness fix: Before editing an uncommitted migration, check whether local integration DB has recorded it; if yes, add the new persistence change as the next migration.
- Regression check: `pnpm exec dotenv -e .env -- pnpm --filter @entalent/database test:integration`
- Status: fixed

## 2026-09-06: Dependent package checks used missing or stale dist output

- Symptom: Parallel affected builds briefly failed with missing `@entalent/contracts` / `@entalent/ai-openai` declarations while sibling builds rewrote `dist`; later worker typecheck also missed a newly exported application type until application was rebuilt.
- Expected: Package builds that consume sibling package `dist` artifacts run after those dependencies finish building.
- Root cause layer: workflow
- Harness fix: After changing a package export, build that dependency before any consumer typecheck/build; keep parallelism only for checks that do not read sibling `dist` output.
- Regression check: Sequential dependency builds, then `pnpm --filter @entalent/worker typecheck` and `pnpm --filter @entalent/worker build`.
- Status: fixed

## 2026-09-06: Exclusion verdict schema lacked prompt semantics

- Symptom: Confirmation interpreter schema accepted `exclude`, but the system prompt still listed only `agree`, `correct`, and `unclear` verdict meanings.
- Expected: Prompt and typed schema define the same machine-readable verdict set so explicit withdrawal language can reach the TypeScript withdrawal path.
- Root cause layer: architecture
- Harness fix: Add prompt-rendering regression test for new structured verdict semantics, not only parser/schema tests.
- Regression check: `pnpm --filter @entalent/ai-openai test -- src/prompts/confirm-interpret.test.ts src/openai-provider.test.ts`
- Status: fixed

## 2026-09-06: Malformed awaiting de-identification proof could hold confirmation slot

- Symptom: A delivered awaiting group with missing or malformed accepted proof returned early in the orchestrator without clearing `confirmation_prompt_message_id`, blocking later pending confirmations for the user.
- Expected: Confirmation cannot proceed without typed accepted proof, and invalid awaiting proof returns the row to pending so a new accepted candidate can be generated.
- Root cause layer: architecture
- Harness fix: Add orchestrator regression for awaiting group state with `deidentificationDecision: null`.
- Regression check: `pnpm --filter @entalent/application test -- src/use-cases/conversation-orchestrator.test.ts`
- Status: fixed

## 2026-09-06: Cohort membership patch changed the wrong focused test mock

- Symptom: The focused team repository suite failed with `this.db.client.select is not a function` after the test mock for the current-membership lookup was changed to `selectDistinct`, while only the historical cycle lookup had changed in production.
- Expected: The patch and its test double target the exact changed method without altering a sibling query path.
- Root cause layer: workflow
- Harness fix: Use symbol-qualified CodeGraph context before each same-file patch and rerun the smallest affected test immediately after the edit.
- Regression check: `pnpm --filter @entalent/worker test -- src/survey/repositories/team.repository.test.ts`
- Status: fixed

## 2026-09-06: BMad uv activation could not initialize the home cache in sandbox

- Symptom: `uv run _bmad/scripts/resolve_customization.py` failed with `Operation not permitted` while opening `/Users/serzh/.cache/uv/sdists-v9/.git`.
- Expected: BMad customization resolution should run inside the workspace sandbox without requiring writes to the user cache.
- Root cause layer: tooling
- Harness fix: Set `UV_CACHE_DIR` to a task-scoped writable directory under `/private/tmp` for BMad `uv run` commands.
- Regression check: `UV_CACHE_DIR=/private/tmp/entalent-bmad-uv-cache uv run _bmad/scripts/resolve_customization.py --skill .agents/skills/bmad-spec --key workflow`
- Status: fixed

## 2026-09-06: Grill decision patches repeatedly failed before application

- Symptom: Multiple documentation patches assumed non-matching paragraph context or had malformed orchestration/patch syntax. Failed attempts did not change files partially.
- Expected: Decision capture should use the current on-disk requirement text and apply atomically.
- Root cause layer: tooling/context
- Harness fix: Read exact target paragraphs in the immediately preceding command, then apply one file per patch with a validated terminator and minimal JavaScript wrapper.
- Regression check: `git diff --check`
- Status: fixed

## 2026-09-06: BMad spec customization references missing project context

- Symptom: BMad spec activation resolved `file:{project-root}/project-context.md` as a persistent fact, but that file does not exist in the checkout.
- Expected: Every configured persistent-fact file exists and can be loaded before the workflow starts.
- Root cause layer: workflow/configuration
- Harness fix: Either generate the canonical root project context or remove the stale persistent-fact reference after confirming which source should own it.
- Regression check: `test -f project-context.md`
- Status: open

## 2026-08-20: MAF prompt rewrite changed a regression marker's case
- Symptom: The focused prompt test failed because `Do not paraphrase` replaced the asserted lowercase marker.
- Expected: Engagement wording changes should preserve unrelated prompt contracts.
- Root cause layer: verification
- Harness fix: Preserve the existing marker while extending the sentence and run the focused prompt test immediately.
- Regression check: `agent-service/.venv/bin/python -m pytest agent-service/tests/unit/test_model_provider_prompt.py -q`
- Status: fixed

## 2026-08-28: Numeric probe metadata was passed to an unused persistence shape
- Symptom: Root typecheck rejected `responseType` on the hidden proactive-request persistence payload.
- Expected: New metadata should cross only boundaries that consume it.
- Root cause layer: architecture
- Harness fix: Remove the unused field and keep `responseType` only in the runtime candidate context.
- Regression check: `pnpm --filter @entalent/worker typecheck`
- Status: fixed

## 2026-08-28: Agent-service verification used an unavailable global pytest
- Symptom: `pytest tests/unit/test_model_provider_prompt.py` failed with `command not found` despite the repository virtualenv being present.
- Expected: Python verification should use the project-owned interpreter.
- Root cause layer: workflow
- Harness fix: Use `agent-service/.venv/bin/python -m pytest` in local verification commands.
- Regression check: `agent-service/.venv/bin/python -m pytest agent-service/tests/unit/test_model_provider_prompt.py -q`
- Status: fixed

## 2026-08-28: Narrow response type widened in a prompt fixture
- Symptom: Root typecheck rejected a numeric-probe fixture because its `responseType` literal widened to `string` after the runtime contract became an enum.
- Expected: Fixtures for closed contract values should retain literal types.
- Root cause layer: verification
- Harness fix: Mark the fixture discriminator `as const` and keep root typecheck in the handoff gate.
- Regression check: `pnpm typecheck`
- Status: fixed

## 2026-08-28: Python scope guard matched a harmless word substring
- Symptom: The full Python suite rejected validator prose because the word “requests” contains the forbidden substring `requests`.
- Expected: Runtime policy wording should not trip the repository's coarse forbidden-fragment scan.
- Root cause layer: verification
- Harness fix: Use equivalent wording without the forbidden fragment and always run the full Python suite after prompt changes.
- Regression check: `agent-service/.venv/bin/python -m pytest agent-service/tests/unit/test_scope.py -q`
- Status: fixed

## 2026-08-20: Targeted conversation sim command ran the full suite
- Symptom: Passing `-- terse-user.sim.test.ts` through the package script made Vitest run nine scenario files; live cases then failed on blocked DNS.
- Expected: Only the requested terse-user scenario should run.
- Root cause layer: workflow
- Harness fix: Use `pnpm --filter @entalent/conversation-sim exec vitest run src/scenarios/terse-user.sim.test.ts` for one scenario.
- Regression check: Confirm Vitest reports exactly one test file before treating the run as evidence.
- Status: fixed

## 2026-08-20: Live model verification lacked authorized egress
- Symptom: The corrected live terse-user simulation was rejected because it would send scenario text to Azure OpenAI without explicit egress authorization; later direct-intent and exact Annna reruns repeated this when they also included LangWatch telemetry.
- Expected: Live prompt verification should run only with an explicitly approved destination and payload.
- Root cause layer: environment
- Harness fix: Keep exact private-transcript scenarios out of LangWatch, request explicit approval for the remaining Azure scenario egress, and use deterministic prompt regressions as the safe default.
- Regression check: Before a live sim with private transcript text, confirm LangWatch reporting is disabled and explicit approval exists for the model-provider destination; otherwise do not run it.
- Recurrence: On 2026-09-08, a post-fix `memory-recall` run hit sandbox DNS and the outside-sandbox retry was rejected because Azure OpenAI and LangWatch scenario egress had not been explicitly approved.
- Status: open

## 2026-08-28: Closing turn created durable anti-goal memories
- Symptom: The production Annna replay classified `No, forget` as `closing` and replied without a question, but memory extraction stored four active `goal` items phrased as “Employee no longer wants to continue…” from that closing turn.
- Expected: A closing turn may cancel or complete an existing goal, but must not create durable memory, a new goal, or a follow-up from the decision to stop the current thread.
- Root cause layer: architecture
- Harness fix: Enforce the closing boundary in `MemoryExtractionUseCase` using the persisted outbound `dialogueAct`; discard memory items, goal creates, and follow-ups while retaining explicit cancel/complete proposals.
- Regression check: `pnpm --filter @entalent/application test -- memory-extraction.use-case.test.ts`; the exact Annna scenario rejects paraphrased “no longer wants to continue” goal memories.
- Status: fixed

## 2026-08-28: Git staging initially ran without repository-write escalation
- Symptom: `git add -u` failed because the managed sandbox could not create `.git/index.lock`.
- Expected: Explicitly authorized commit operations should write the Git index successfully.
- Root cause layer: tooling
- Harness fix: Run Git index mutations with repository-write escalation in the managed desktop sandbox.
- Regression check: `git diff --cached --check` after staging.
- Status: fixed

## 2026-08-28: Railway readiness initially ran inside the network sandbox
- Symptom: The first production readiness run failed DNS lookup for Railway's API.
- Expected: The read-only deployment verification should reach Railway after an authorized push.
- Root cause layer: environment
- Harness fix: Run Railway-backed readiness with network escalation in the managed desktop sandbox.
- Regression check: `pnpm maf:agent-service:readiness` completes with service, variable, and deployment-envelope checks.
- Status: fixed

## 2026-08-28: MAF-only smoke was used for a TypeScript feature
- Symptom: `maf-proactive-selected-probe-smoke.ts` reported `selected_probe_missing` while the supported TypeScript path was under acceptance.
- Expected: Retired MAF smoke and `agent-service` verification must not be used for TypeScript-only product work.
- Root cause layer: verification
- Harness fix: Exclude MAF smoke from the verification plan and use TypeScript selector/outbound evidence instead.
- Regression check: The task verification list contains no `maf:*`, `agent-service`, Python runtime, or MAF OpenAPI command.
- Status: obsolete

## 2026-08-28: Survey evaluator omitted an explicit numeric rating field
- Symptom: Production evaluation recognized the employee's reply `7` but omitted optional `numericValue`, leaving `survey_assessments.score` null and the engagement backlog incomplete.
- Expected: An explicit 0–10 answer to the exact preceding numeric probe should persist even when the model omits the redundant structured number.
- Root cause layer: architecture
- Harness fix: Treat the deterministically parsed inbound rating as source of truth, require exact probe binding, and reject any conflicting model-provided value (`b4a583f`).
- Regression check: `pnpm --filter @entalent/application test -- survey-evidence.use-case.test.ts`; production replay stores `7.00`, while qualitative-only text stores no score.
- Status: fixed

## 2026-08-28: Inline queue-cleanup script used shell-interpreted template literals
- Symptom: Backticks in a `tsx -e` command were expanded by the outer shell, producing `command not found` diagnostics and suppressing the script's removal summary; the guarded removal itself completed.
- Expected: Production cleanup commands should preserve JavaScript source exactly and report every removed target.
- Root cause layer: tooling
- Harness fix: Avoid template literals in shell-embedded scripts; use string concatenation or a reviewed temporary script, then perform an independent read-only absence check.
- Regression check: Query the exact job IDs after cleanup and require `remaining=[]`; the verification passed for all seven jobs.
- Status: fixed

## 2026-08-28: Engagement implementation crossed the retired MAF boundary
- Symptom: Commit `b2fec85` added numeric-probe behavior to `agent-service`, the MAF runtime contract, and proactive MAF worker wiring even though MAF is unsupported and out of scope.
- Expected: Engagement scheduling, quantitative extraction, persistence, and focus changes must remain in the supported TypeScript application/worker/AI path.
- Root cause layer: instructions
- Harness fix: Restore every MAF-facing file to its pre-feature bytes and add an explicit no-MAF boundary check to engagement verification.
- Regression check: Diff the final tree against `b2fec85^` for `agent-service`, runtime OpenAPI/contracts, `agent-runtime.port.ts`, and proactive MAF `responseType` wiring; require no feature delta.
- Status: fixed

## 2026-08-29: Worker suite required retired MAF wiring
- Symptom: The first full worker test run failed because a source-inspection test still required `recordShadowCandidate` and primary/canary MAF wiring in `ConversationModule`.
- Expected: The worker must remain TypeScript-only even while retired MAF artifacts stay available as unreferenced archive code.
- Root cause layer: verification
- Harness fix: Replace the obsolete rollout assertion with a quarantine regression that rejects MAF router, client, and proactive-branch references in the active worker module and processor.
- Regression check: `pnpm --filter @entalent/worker test` passes 117/117 and includes the TypeScript-only module/processor boundary assertions.
- Status: fixed

## 2026-08-30: Broad application test command crossed the retired MAF boundary
- Symptom: A TypeScript pulse-backlog verification used the broad `@entalent/application` test command, which also executed archived MAF unit and smoke test files; a delegated worker had also opened one archived runtime-ledger test while searching for a database mock pattern.
- Expected: Ordinary product work must use an active-runtime allowlist and neither inspect nor execute retired MAF tests, even when they are colocated in a supported TypeScript package.
- Root cause layer: verification
- Harness fix: Derive existing colocated tests from changed paths, run them through their owning package, and reject any derived retired target; never fall back to root `pnpm test`.
- Regression check: `pnpm exec tsx scripts/agent-harness.test.ts` proves a changed package source runs only its colocated active test while an adjacent archived test and root broad test remain untouched.
- Recurrence: On 2026-09-08, the documented `prepush:non-maf` script still called `turbo run test`, which executed archived MAF unit tests despite its name; no MAF service or live runtime was invoked.
- Status: open

## 2026-08-30: Harness reflection IPC was blocked by the managed sandbox
- Symptom: The first focused reflection command failed with `listen EPERM` while creating the local tsx IPC socket.
- Expected: Required read-only reflection should run before review without a false product failure.
- Root cause layer: environment
- Harness fix: Run this local reflection command with the narrowly scoped managed-sandbox escalation.
- Regression check: The same focused reflection command exits `2` with `eligible=false`, not an IPC error.
- Recurrence: On 2026-09-17, CAP-6 closeout reflection for four Markdown paths hit the same `listen EPERM`; all four narrowly escalated read-only reruns completed successfully with `eligible=true`.
- Recurrence: On 2026-09-18, CAP-11 reflection and the focused `tsx --test` run hit the same IPC restriction; both narrowly escalated reruns passed.
- Recurrence: On 2026-09-26, Company Admin OIDC reflection and `pnpm harness:check` hit the same IPC restriction. `node --import tsx scripts/agent-harness.ts reflection --changed-path apps/api/src/company-auth` and `node --import tsx scripts/agent-harness.ts check --base 2e12d5b` passed without an IPC socket.
- Recurrence: On 2026-09-27, `pnpm harness:check` again hit `listen EPERM`; the direct `node --import tsx scripts/agent-harness.ts check --base a189ed2776853a23c3315ffc23da348d4af3e235` passed and wrote a receipt.
- Harness fix: `harness:check` and `harness:preflight` now use the direct `node --import tsx` launcher, avoiding the tsx CLI socket; use the same launcher for manual reflection.
- Recurrence: On 2026-09-27, the instruction-mandated `pnpm exec tsx` reflection again hit `listen EPERM`; the direct Node launcher passed. `AGENTS.md` now names the direct launcher for reflection.
- Regression check: Run `pnpm harness:check --base <base-revision>` under the managed sandbox and verify it emits a structured receipt. The 2026-09-27 rerun passed.
- Status: open

## 2026-08-30: Broad formatting check mixed harness code with inherited docs
- Symptom: A combined Prettier check failed on existing BMad and agent-log Markdown while validating the two changed harness scripts.
- Expected: Harness implementation formatting should be verified without rewriting unrelated dirty documentation.
- Root cause layer: workflow
- Harness fix: Scope formatting verification to `scripts/agent-harness.ts` and its test.
- Regression check: `pnpm exec prettier --check scripts/agent-harness.ts scripts/agent-harness.test.ts` passes.
- Status: fixed

## 2026-08-30: Production aggregate check assumed a root pg dependency
- Symptom: The first post-deploy read-only aggregate command stopped locally with `Cannot find module 'pg'` before connecting to production.
- Expected: Operational verification should reuse an installed repository database client without adding a dependency.
- Root cause layer: tooling
- Harness fix: Run one-off read-only database checks through `@entalent/database` and its existing `postgres` client.
- Regression check: `pnpm --filter @entalent/database exec node -e 'console.log(require.resolve("postgres"))'` resolves locally before the Railway command runs.
- Status: fixed

## 2026-09-08: Live conversation scenarios lacked explicit destination approval
- Symptom: The post-deploy `memory-recall` and `terse-user` live run was rejected before execution because its test dialogue and context would be sent to Azure OpenAI and LangWatch.
- Expected: External model/evaluation payloads run only after the user explicitly approves the payload class and named destinations.
- Root cause layer: instructions
- Harness fix: Before the live command, request one explicit approval that names test dialogue/context, Azure OpenAI, and LangWatch; note that Annna disables LangWatch.
- Regression check: The approval text and the exact focused scenario command are present before any external run.
- Status: fixed

## 2026-09-08: Conversation simulation used a stale built workspace dependency
- Symptom: The first Annna repeat after changing `packages/ai-openai/src` still exercised the previous `dist` behavior and repeated the reporting-disclosure failure.
- Expected: A live conversation simulation should exercise the current affected workspace package source.
- Root cause layer: workflow
- Harness fix: Build each changed workspace dependency consumed through its package entry point before running conversation simulations.
- Regression check: `pnpm --filter @entalent/ai-openai build` succeeds before the focused Annna command.
- Status: fixed

## 2026-09-17: CAP-6 resolved-detail re-extraction was nondeterministic

- Symptom: Three model-backed D04-03 replays alternated between carrying the earlier “reconstruct the whole flow” detail and returning only facts from the latest turn; when carried, conflicting generic question directives still reopened the resolved branch until they were made optional.
- Expected: A detail explicitly resolved in the active thread remains available to the next reply plan and cannot be reopened as a clarification.
- Root cause layer: architecture
- Harness fix: Stop relying on prompt-only re-extraction on every turn; carry the bounded resolved-detail receipt through existing outbound message metadata for eligible same-session dialogue acts, while clearing it on topic replacement, correction, closing, any safety turn, confirmation, or a new session and prioritizing all current details within the cap.
- Regression check: Contracts 89/89, application reply-plan/orchestrator 187/187, AI 145/145, worker 175/175, repeated model-backed D04-03 plus unresolved-detail control runs, and final harness `runs/harness/receipt-1789670481321-c35ba0e7.json` pass; final blind review reported no findings.
- Recurrence: The first post-review model replay hit sandbox DNS `ENOTFOUND`; the explicitly approved Azure OpenAI rerun passed, so no product change was made for the transport failure.
- Recurrence: Pre-push model replays returned `resolvedDetails=[]` for the explicit whole-flow statement, varied its dialogue act, and once evicted the newer prior detail when four current details filled the cap, correctly blocking the push. The shared orchestrator now falls back to typed `latestUserSubstance` only for same-session/same-topic substantive turns and retains the most recent prior details in remaining cap slots; focused application tests pass 187/187 without phrase matching or another model call.
- Status: fixed

## 2026-09-18: CAP-9 review tests initially encoded two invalid assumptions

- Symptom: The hardened API test expected a hand-converted Slack timestamp two hours late, and worker typecheck rejected a one-argument `orderBy` mock after the query began asserting three sort keys.
- Expected: Review coverage should preserve the real Unix event time and model the called variadic query-builder method.
- Root cause layer: verification
- Harness fix: Derive the expected `Date` from Unix milliseconds and make the `orderBy` mock variadic.
- Regression check: Focused API/worker tests plus API/worker typecheck pass.
- Status: fixed

## 2026-09-26: Person integration gate lacked a pgvector-capable local database

- Symptom: The focused Person integration suite could not complete: local PostgreSQL 14 lacks `vector.control`, and Docker was not running. The initial socket-only connection also failed because the test client attempted TCP.
- Expected: The complete migration chain and Person constraints run against a local PostgreSQL with pgvector.
- Root cause layer: environment
- Harness fix: Provide a reproducible pgvector-capable local integration target and an explicit connection URL in the database test setup.
- Regression check: `DATABASE_URL=<local-pgvector-url> pnpm --filter @entalent/database exec vitest run --config vitest.integration.config.ts src/__tests__/people.integration.test.ts`.
- Recurrence: The organization schema suite also needs the same pgvector-capable full migration chain; its new migration and targeted constraints passed in an isolated PostgreSQL fixture without the earlier migrations.
- Status: open

## 2026-09-26: Application suite gave a non-reproducible survey assessment failure

- Symptom: The full application suite failed one existing numeric-survey assessment assertion (`upsertAssessment` had zero calls); the focused survey file then passed all 22 tests unchanged.
- Expected: The same survey test should pass reliably in both package and focused runs.
- Root cause layer: verification
- Harness fix: Reproduce under the full suite and isolate any shared clock, mock, or test-order dependency before changing product code; the hierarchy slice did not touch survey evidence files.
- Regression check: Compare the focused survey file with the full application suite under an isolated test-worker configuration.
- Status: open

## 2026-09-26: CSV verification fixtures initially missed required schema and header fields

- Symptom: The focused CSV test initially omitted the `pulseParticipant` header; the isolated SQL check initially lacked runtime `users` columns and counted prior rejected audit attempts as new events.
- Expected: Test fixtures match the CSV contract and the Drizzle table shape, and audit assertions isolate events from the current run.
- Root cause layer: verification
- Harness fix: Keep a reusable CSV fixture builder with the complete header set and a pgvector-backed integration database migrated through the normal chain; scope audit assertions to a fresh tenant or baseline count.
- Regression check: Run focused CSV application/API tests and a valid plus invalid import on a clean migrated integration database.
- Status: open

## 2026-09-26: Slack link service first pass left an unused transaction type

- Symptom: API typecheck and lint failed on an unused `Transaction` alias after the Slack link service was introduced.
- Expected: The focused service passes static checks before harness completion.
- Root cause layer: verification
- Harness fix: Keep API typecheck and lint in the focused change loop; remove unused scaffolding before widening the verification scope.
- Regression check: `pnpm --filter @entalent/api typecheck` and `pnpm --filter @entalent/api lint`.
- Status: fixed

## 2026-09-26: Isolated inbound SQL fixture omitted the users ID default

- Symptom: The first real-SQL inbound identity check failed because the minimal temporary `users` table did not generate IDs, although the repository schema does.
- Expected: The temporary fixture mirrors required defaults so a fallback-user transaction can run.
- Root cause layer: environment
- Harness fix: Prefer a database built from the full migration chain; while pgvector is unavailable, include schema defaults in any isolated fixture before testing writes.
- Regression check: Run concurrent fallback identity creation on a fresh migrated PostgreSQL database and assert one user plus one account.
- Status: open

## 2026-09-26: Worker typecheck read stale application package declarations

- Symptom: Worker typecheck initially reported that the new shared runtime eligibility export was missing, while application source tests passed.
- Expected: The worker compiles against freshly built application declarations.
- Root cause layer: workflow
- Harness fix: Build `@entalent/application` after changing its exports and before package-scoped worker typecheck; the repository-wide harness already orders builds through Turbo.
- Regression check: `pnpm --filter @entalent/application build` followed by `pnpm --filter @entalent/worker typecheck`.
- Status: fixed

## 2026-09-26: Worker harness found stale delivery projection assertion

- Symptom: The repository-wide harness failed because the delivery repository test expected the old projection without `userId` after the worker eligibility guard added that field.
- Expected: The projection test checks the user identity and conversation/user join used by the delivery guard.
- Root cause layer: verification
- Harness fix: Update projection assertions whenever a runtime guard adds a required identity field; keep the repository test in the harness gate.
- Regression check: `pnpm --filter @entalent/worker exec vitest run src/conversation/repositories/conversation.repository.test.ts`.
- Status: fixed

## 2026-09-26: Activation SQL check loaded stale database package output

- Symptom: The first onboarding-intent SQL check failed inside Drizzle because the API service imported a new table that was absent from the old built `@entalent/database` output.
- Expected: Runtime checks load the current schema export after a schema change.
- Root cause layer: workflow
- Harness fix: Build `@entalent/database` after schema/migration generation and before direct `node --import tsx` integration probes; keep repository-wide harness ordering as the final gate.
- Regression check: `pnpm --filter @entalent/database build` followed by the isolated activation/intent SQL check.
- Status: fixed

## 2026-09-26: Company Admin bootstrap script at repository root could not resolve package dependencies

- Symptom: Direct Node execution failed with `Cannot find module 'drizzle-orm'` from the root `scripts/` directory.
- Expected: The operator bootstrap uses the API package's declared dependencies and is typechecked with it.
- Root cause layer: workflow
- Harness fix: Place the script under `apps/api/scripts/` and include its dedicated tsconfig in the API typecheck command.
- Regression check: `pnpm --filter @entalent/api typecheck` and run the bootstrap CLI without arguments; it should report the missing input argument, not a module error.
- Status: fixed

## 2026-09-26: OIDC session test omitted join predicates

- Symptom: A test failed while asserting that the WHERE predicate contained the subject/provider join condition.
- Expected: The test inspects the JOIN predicate where that condition actually lives.
- Root cause layer: verification
- Harness fix: Capture JOIN and WHERE predicates separately in the query mock and assert each SQL clause in its own location.
- Regression check: `pnpm --filter @entalent/api exec vitest run src/company-auth/company-admin-identity.service.test.ts`.
- Status: fixed

## 2026-09-26: Isolated PostgreSQL initialization needs host shared memory

- Symptom: `initdb` inside the sandbox failed at bootstrap with `shmget: Operation not permitted`; Docker daemon was not running.
- Expected: A temporary local database supports migration SQL checks without touching an existing database.
- Root cause layer: environment
- Harness fix: Use the installed Homebrew PostgreSQL 14 in an isolated `/private/tmp` cluster with approved host shared-memory access. Use a minimal base-schema fixture for migrations `0021` and `0022`; do not call that a full pgvector migration test.
- Regression check: Apply `0021` and `0022` with `psql -v ON_ERROR_STOP=1`, then verify single-use state, revocation, draft admin, and cross-tenant FK in the fixture.
- Status: fixed

## 2026-09-26: postgres-js fixture URL did not use the Unix socket

- Symptom: the read-only legacy reconciliation command exited with `ECONNREFUSED` against an isolated socket-only PostgreSQL fixture.
- Expected: the command connects to the intended temporary database and emits a tenant report.
- Root cause layer: tooling
- Harness fix: Start temporary PostgreSQL with a localhost listener when testing scripts that use postgres-js, and use an explicit `postgresql://localhost:<port>/<db>` URL; stop the host-started server with approved host access before deleting its data directory.
- Regression check: Run `company-hierarchy:reconcile` against a synthetic localhost PostgreSQL fixture and assert one Team, one active member, and one manager candidate.
- Status: fixed
## 2026-09-26: Draft edit mock returned unrelated ownership rows

- Symptom: the new role-change test reported a Team owner reference instead of its intended Employee placement reference; its inferred mixed-table `Map` also failed TypeScript compilation.
- Expected: the fixture models only the references owned by the edited Person and compiles with mixed table keys.
- Root cause layer: verification.
- Harness fix: Type mixed-table fixture maps explicitly and clear unrelated table rows in each role-reference case.
- Regression check: `pnpm --filter @entalent/api exec vitest run src/hierarchy/hierarchy-draft.service.test.ts` and `pnpm --filter @entalent/api typecheck`.
- Status: fixed.

## 2026-09-26: Local PostgreSQL integration test blocked by sandbox TCP policy

- Symptom: the Company Admin session integration test failed with `connect EPERM` on `127.0.0.1:5434` and `::1:5434` inside the managed sandbox. The same local TCP restriction recurred for the owner replacement integration test on 2026-09-27; the scoped host-access rerun passed.
- Expected: the test connects to the separate local `entalent_hierarchy_acceptance` database and exercises the migrated schema.
- Root cause layer: environment.
- Harness fix: Rerun only the local database test with scoped host access; keep its `DATABASE_URL` pointed at the isolated acceptance database.
- Regression check: with scoped host access, run `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5434/entalent_hierarchy_acceptance pnpm --filter @entalent/api exec vitest run src/company-auth/company-admin-session.integration.test.ts src/hierarchy/hierarchy-mutation.integration.test.ts`.
- Status: fixed.

## 2026-09-26: Owner replacement left stale onboarding intents

- Symptom: promoting a new Team Lead or Manager with the explicit `deactivate` action disabled the previous Person but left their `pending` or `failed` first-contact intent eligible for repeated worker preparation.
- Expected: deactivation during owner replacement cancels unsent first-contact intents in the same transaction.
- Root cause layer: architecture.
- Harness fix: Apply the same onboarding cancellation rule as standalone Person, Team, and Unit deactivation; cover both owner replacements on the migrated PostgreSQL schema.
- Regression check: `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5434/entalent_hierarchy_acceptance pnpm --filter @entalent/api exec vitest run src/hierarchy/hierarchy-mutation.integration.test.ts`.
- Status: fixed.

## 2026-09-26: Draft HRBP role correction was blocked by its own scope row

- Symptom: removing all selected Unit assignments from a draft HRBP left a draft `org_hrbp_scopes` row, so a subsequent draft Person role edit still failed with `hrbp_scope_reference`.
- Expected: Company Admin can explicitly clear a draft selected scope and then correct an imported draft role.
- Root cause layer: architecture.
- Harness fix: Interpret an empty selected scope for a draft HRBP as an inactive scope record, retain the active HRBP minimum, and document the clear action in setup.
- Regression check: `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5434/entalent_hierarchy_acceptance pnpm --filter @entalent/api exec vitest run src/hierarchy/hierarchy-advisor-scope.service.test.ts src/hierarchy/hierarchy-advisor-scope.integration.test.ts`.
- Status: fixed.

## 2026-09-26: Company Admin session survived OIDC subject rotation

- Symptom: a session stored only tenant and Person IDs; after the Person's issuer/subject binding changed, the old session still passed the any-binding check.
- Expected: a session stays valid only while the exact OIDC identity used at login remains bound to that Person under an active provider and capability.
- Root cause layer: architecture.
- Harness fix: Persist a SHA-256 fingerprint of the verified issuer/subject pair in each new session, compare it on every resolve, and fail closed for pre-migration sessions without a fingerprint.
- Regression check: apply migration `0025` to isolated PostgreSQL and run `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5434/entalent_hierarchy_acceptance pnpm --filter @entalent/api exec vitest run src/company-auth/company-admin-session.integration.test.ts`.
- Status: fixed.

## 2026-09-26: Persisted Slack receipt could leave onboarding in sending

- Symptom: if a worker stopped after persisting `messages.sent_at` and `external_message_id` but before updating `org_onboarding_deliveries`, the intent remained `sending` with no scheduled scan retry.
- Expected: an operator can safely reconcile a confirmed database receipt without resending; intents without a receipt remain untouched for Slack verification.
- Root cause layer: workflow.
- Harness fix: Add a tenant-scoped read-only inventory and confirmed apply path that validates the outbound message and writes an audit event; document the manual path for uncertain sends.
- Regression check: `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5434/entalent_hierarchy_acceptance pnpm --filter @entalent/api exec vitest run src/hierarchy/onboarding-reconciliation.integration.test.ts`.
- Status: fixed.
## 2026-09-26: Empty optional setup fields reached draft validation as strings

- Symptom: setup forms send empty strings for optional Manager, Team Lead, and Team fields; the controller passed them through, causing draft creation to reject an intentionally empty assignment.
- Expected: an empty optional form field means no assignment.
- Root cause layer: architecture.
- Harness fix: Normalize empty optional strings to null at the customer setup controller boundary.
- Regression check: `pnpm --filter @entalent/api exec vitest run src/hierarchy/company-setup.controller.test.ts`.
- Status: fixed.
## 2026-09-26: SQL eligibility test expected parameters for inline literals

- Symptom: the SQL compilation test failed because its expected `active` and `false` values were not in the parameter array.
- Expected: verify the generated predicate regardless of whether the SQL builder inlines fixed literals.
- Root cause layer: verification.
- Harness fix: Assert the compiled SQL text for fixed literals and column correlations.
- Regression check: `pnpm --filter @entalent/database exec vitest run src/person-eligibility.test.ts`.
- Status: fixed.

## 2026-09-27: Concurrent hierarchy transactions surfaced PostgreSQL serialization aborts

- Symptom: two of six parallel PostgreSQL integration files failed with `40001` while the same files passed serially.
- Expected: independent hierarchy operations finish under normal database concurrency without recording a false rejected mutation for a transient serialization abort.
- Root cause layer: architecture.
- Harness fix: Retry the complete serializable database transaction a bounded number of times on PostgreSQL `40001`, before recording any final rejection. Keep the retry wrapper free of external side effects.
- Regression check: `pnpm --filter @entalent/api exec vitest run src/hierarchy/serializable-retry.test.ts src/hierarchy/hierarchy-mutation.service.test.ts`, then run the six Company Hierarchy PostgreSQL integration files in parallel against the isolated local acceptance database.
- Status: fixed.

## 2026-09-27: Hierarchy audit omitted structured transitions for active operations

- Symptom: rollout audit stored counts without affected Person/Team IDs, owner replacement and deactivation audit lacked structured before/after values, and invalid Unit selection bypassed the rejected rollout audit.
- Expected: each invoked hierarchy mutation records its actor, affected IDs, structured transition, or rejection reason.
- Root cause layer: verification.
- Harness fix: Add affected IDs and structured before/after state to rollout, owner replacement, deactivation, Slack-link, and Company Admin capability audit records; move rollout selection validation inside its audited boundary.
- Regression check: `pnpm --filter @entalent/api exec vitest run src/hierarchy/hierarchy-rollout.service.test.ts src/hierarchy/hierarchy-mutation.service.test.ts src/hierarchy/hierarchy-deactivation.service.test.ts src/hierarchy/hierarchy-slack-link.service.test.ts src/hierarchy/hierarchy-capability.service.test.ts`.
- Status: fixed.

## 2026-09-27: New hierarchy identifiers absent from confirmation safety check

- Symptom: a newly provisioned active Person without legacy Team membership supplied no Unit/Team or colleague identifiers to confirmation deidentification.
- Expected: confirmation safety uses current active organizational identifiers while legacy cohort and report routing remain unchanged.
- Root cause layer: architecture.
- Harness fix: Add a separate tenant-scoped active hierarchy identifier read to the Survey repository and include it in the existing deidentification decision. Keep the reporting Team lookup intact.
- Regression check: `pnpm --filter @entalent/application exec vitest run src/use-cases/conversation-orchestrator.test.ts` and the worker `team.repository.integration.test.ts` against the isolated migrated local PostgreSQL database.
- Status: fixed.

## 2026-09-27: Production legacy report required schema detection and export approval

- Symptom: the report reader queried hierarchy tables and `channel_accounts.link_status` that are absent before migration; a later attempt to export the full production tenant report to a local file was rejected by automatic approval review.
- Expected: pre-migration inventory works read-only and sensitive membership/Slack data is exported only to an explicitly approved destination.
- Root cause layer: workflow.
- Harness fix: Detect complete old versus migrated schema, treat old Slack accounts as linked when `link_status` is absent, fail on partial schema or unknown tenant, and mark report `schemaReady`; retain the full production export as an approval-gated operation with its payload and destination stated beforehand.
- Regression check: `pnpm --filter @entalent/api exec vitest run src/hierarchy/legacy-reconciliation.read.test.ts src/hierarchy/legacy-reconciliation.test.ts`, followed by a read-only local report on the isolated migrated acceptance database.
- Status: fixed (the user granted access and the restricted read-only production report was exported).

## 2026-09-27: pnpm banner polluted redirected hierarchy JSON

- Symptom: Redirecting `pnpm --filter @entalent/api company-hierarchy:reconcile` to a JSON report file included pnpm's command banner before the JSON, so parsing the restricted production report failed.
- Expected: The read-only report command should produce one valid JSON document with no wrapper output.
- Root cause layer: tooling.
- Harness fix: The reconciliation and backfill runbook now invokes the TypeScript scripts directly with `node --import tsx` when JSON is redirected to a file.
- Regression check: Redirect `node --import tsx apps/api/scripts/reconcile-legacy-hierarchy.ts` to a restricted file and parse the whole file as JSON.
- Status: fixed.

## 2026-09-27: quarantine reason widened past its validated union

- Symptom: The first quarantine manifest parser passed its focused tests but API typecheck rejected `reason: string` where the validated reason union was required.
- Expected: The parsed quarantine reason remains typed as the two accepted values.
- Root cause layer: verification.
- Harness fix: Narrow the validated reason explicitly and keep API typecheck in the implementation gate.
- Regression check: `pnpm --filter @entalent/api typecheck`.
- Status: fixed.
## 2026-09-27: Hierarchy rollout could not adopt a legacy Slack User

- Symptom: The designated test Employee already has a linked Slack account, one conversation, and 102 messages. Setup draft creation would allocate a new User ID, while Slack linking rejects assigning that account to a second User.
- Expected: Explicit hierarchy reconciliation should retain the existing User ID, channel account, and conversation history, then activate the Person and Unit atomically without interrupting the active conversation runtime.
- Root cause layer: architecture
- Harness fix: Add an audited, operator-scoped legacy adoption path inside the serializable Unit rollout transaction, with exact Slack email and account ownership checks. Keep legacy Team membership and report routing unchanged.
- Regression check: A migrated PostgreSQL test starts with an active legacy User and historical conversation, rejects a failed rollout with no Person row, then activates the same User ID and verifies history, account ownership, onboarding uniqueness, and runtime eligibility.
- Status: open

## 2026-09-27: First-contact intents waited for the hourly proactive scan

- Symptom: A successful Unit rollout created two pending onboarding intents, but the production worker's scheduled scan runs only once an hour, delaying live acceptance and first contact.
- Expected: An operator should be able to process only the selected Unit's pending first contacts promptly, without triggering normal proactive candidates for the tenant.
- Root cause layer: workflow
- Harness fix: Add a distinct `onboarding-only` queue job requiring both tenant and Unit IDs; filter onboarding dispatch by both IDs and skip the proactive scheduler for that job.
- Regression check: Worker processor tests reject missing scope and prove the proactive scheduler is not called; PostgreSQL/BullMQ onboarding integration proves an unrelated Unit filter queues nothing and the selected intent delivers once.
- Status: open

## 2026-09-27: Slack bot lacked DM creation scope during first-contact preparation

- Symptom: The selected Manager and Employee onboarding intents failed before outbound message creation because Slack `conversations.open` returned `missing_scope`; the bot lacked `im:write`.
- Expected: The connected bot opens each selected DM and delivers one first contact with a durable Slack receipt.
- Root cause layer: environment
- Harness fix: Verify the installed bot token's actual `x-oauth-scopes` and both recipient DM opens before scoped dispatch. Reinstall the app after adding `im:write`, reconcile stored workspace scope metadata with an audit record, and retry only an exact failed intent set with no outbound message or external receipt.
- Regression check: Production preflight, both `conversations.open` probes, exact retry dry-run, targeted `onboarding-only` job, and receipt readback for the two selected Persons; migrated PostgreSQL retry test rejects an existing outbound message.
- Status: fixed

## 2026-09-28: Documentation reflection attempted an implicit dependency install

- Symptom: The documented `_bmad/scripts/resolve_config.py` path was absent, CodeGraph had no callable CLI or MCP tool, and `pnpm exec tsx scripts/agent-harness.ts reflection` attempted to install missing workspace dependencies before failing on npm DNS.
- Expected: Repository-guided documentation review should use the indexed/BMad tools named by `AGENTS.md`, or fail fast without creating a local dependency store or retrying the registry.
- Root cause layer: environment
- Harness fix: Restore or correct the BMad resolver and CodeGraph tool paths, and make reflection fail fast when the pinned local `tsx` executable is absent.
- Regression check: In a dependency-incomplete checkout, tool discovery identifies the usable path or exits immediately without network installation attempts.
- Status: open

## 2026-09-28: Local PostgreSQL proxy accepted TCP but did not answer

- Symptom: `pnpm db:migrate` for the new Insight Analysis V2 migration timed out connecting to `localhost:5434`; `nc` succeeded, but `pg_isready -h 127.0.0.1 -p 5434 -t 3` reported no response and Docker CLI commands hung. The V2 clarification fixture repeated this failure on 2026-09-28. A fresh 2026-09-29 `docker compose ps` probe also hung after port 5434 failed readiness. Isolated Homebrew PostgreSQL 17 with pgvector and Redis then passed all V2 migrations, the BullMQ fixture, and full local gates.
- Expected: A local migration attempt should verify a responsive PostgreSQL target before opening the migration transaction.
- Root cause layer: environment
- Harness fix: Keep the bounded PostgreSQL/Redis preflight before local database and queue tests; when Docker does not answer, use disposable isolated services. Investigate the Docker daemon/proxy separately without delaying isolated local acceptance.
- Regression check: `pg_isready -h 127.0.0.1 -p 5434 -t 3` must report accepting connections before `pnpm db:migrate`; a listening socket alone is insufficient.
- Status: open

## 2026-09-28: Cutoff integration fixture assumed UUID sort order

- Symptom: The first PostgreSQL cutoff integration test failed while checking bundle cleanup even though the returned rows showed the future bundle was correctly retained.
- Expected: Assertions identify the closed and future bundle by identity, independent of lexical UUID order.
- Root cause layer: verification
- Harness fix: Select bundle IDs and match each expected row by ID in the integration fixture.
- Regression check: `DATABASE_URL=<isolated-postgres> pnpm --filter @entalent/worker exec vitest run src/survey/repositories/survey.repository.cutoff.integration.test.ts`.
- Status: fixed

## 2026-09-28: API test invocation used a Jest-only option

- Symptom: `pnpm --filter @entalent/api test -- --runInBand` stopped before running tests because Vitest does not recognize `--runInBand`.
- Expected: The API test command should use the repository's Vitest CLI options.
- Root cause layer: workflow
- Harness fix: Use the documented `pnpm --filter @entalent/api test` command without the Jest option.
- Regression check: `pnpm --filter @entalent/api test` completes the suite.
- Status: fixed

## 2026-09-28: Boundary unit test imported the full API module

- Symptom: The private-route test passed its assertions but Vitest exited with an unhandled environment validation error after importing `AppModule` without database, Redis, and encryption settings.
- Expected: A route registration unit test should inspect the narrow module metadata without initializing the application configuration.
- Root cause layer: verification
- Harness fix: Keep the boundary test scoped to `UsersModule`; verify root imports by code review or a boot test with explicit safe test configuration.
- Regression check: `pnpm --filter @entalent/api exec vitest run src/users/private-user-route-boundary.test.ts` exits cleanly without production settings.
- Status: fixed

## 2026-09-28: Survey evidence fixture expired during the test

- Symptom: The harness intermittently skipped an explicit Engagement rating because the fixture set the window end to the current instant, while the inbound message was created milliseconds later.
- Expected: The numeric answer test uses a window that remains active throughout the test.
- Root cause layer: verification
- Harness fix: Set the shared fixture window to a bounded interval around the current time.
- Regression check: `pnpm --filter @entalent/application exec vitest run src/use-cases/survey-evidence.use-case.test.ts` and the full harness gate pass repeatedly.
- Status: fixed

## 2026-09-28: V2 cutoff fixture lagged behind clarification migration

- Symptom: Full harness with `DATABASE_URL` failed on `survey.repository.cutoff.integration.test.ts` because its temporary working-insights table lacked `clarification_prompt_message_id` used by the cutoff cleanup query.
- Expected: The PostgreSQL fixture matches the columns touched by the current V2 repository and verifies that cutoff clears the clarification prompt reference.
- Root cause layer: verification
- Harness fix: Add the `0028` column and a non-null fixture value, then assert it is cleared. Run the harness with an isolated migrated database so conditional DB tests are not silently skipped.
- Regression check: `DATABASE_URL=<isolated-migrated-postgres> pnpm harness:check -- --base origin/main`.
- Status: fixed

## 2026-09-28: Worker integration test used a stale application build

- Symptom: The DB-backed harness rejected a safe V2 summary with a categorical fallback while the application unit test passed. The same stale-build class recurred when a direct worker cutoff test loaded old application output.
- Expected: The worker integration test should exercise the current application source and preserve a safe generalized summary.
- Root cause layer: verification
- Harness fix: Rebuild `@entalent/application` before running worker tests after application changes and document that order in `AGENTS.md`; retain the cross-package safe-summary regression. The privacy identifier extractor also now keeps its uppercase-name match case-sensitive so it cannot absorb ordinary words after a project name.
- Regression check: `pnpm --filter @entalent/application build && DATABASE_URL=<isolated-migrated-postgres> pnpm --filter @entalent/worker exec vitest run src/survey/repositories/question-insight.repository.migrated.integration.test.ts`; then run the DB-backed harness.
- Status: fixed

## 2026-09-28: V2 reporting fixture used a nullable tenant ID inside a mapped insert

- Symptom: Worker and later API migrated-DB fixtures passed runtime checks but failed typecheck because a nullable cleanup tenant ID was reused inside mapped inserts.
- Expected: The integration fixture should typecheck as part of the full workspace gate.
- Root cause layer: verification
- Harness fix: Capture the inserted tenant row's non-null ID in a local constant for fixture construction; reserve the nullable variable for afterAll cleanup, then rerun the full DB-backed harness.
- Regression check: `DATABASE_URL=<isolated-migrated-postgres> pnpm harness:check -- --base origin/main`.
- Status: fixed

## 2026-09-28: Cycle-policy migration used a PostgreSQL reserved alias

- Symptom: Migration `0030` failed on the isolated PostgreSQL cluster with `syntax error at or near "JOIN"`.
- Expected: The forward migration should apply after `0029` without partial schema state.
- Root cause layer: verification
- Harness fix: Rename the `window` table alias to `cycle_window` in the trigger SQL and keep a migrated-PostgreSQL activation test.
- Regression check: Apply all migrations on an isolated database, then run `survey-cycle-policy-activation.integration.test.ts`.
- Status: fixed

## 2026-09-28: Operational script lacked a compile gate at the root

- Symptom: A database-package test could not resolve the root activation script's application dependency; a direct root `tsc` also lacked declared Node and workspace dependencies.
- Expected: The database package should test only schema behavior, and the operational script should compile and run from its owning root workspace.
- Root cause layer: architecture and tooling
- Harness fix: Keep the database fixture package-local, add a root script integration fixture, declare the root script dependencies, and include its dedicated TypeScript config in `pnpm typecheck`.
- Regression check: `pnpm exec tsc -p scripts/tsconfig.v2-policy.json` plus the DB-backed root activation script integration test.
- Status: fixed
## 2026-09-29: Delivery queue and dev log retained private response text

- Symptom: New message-send jobs copied the persisted outbound text into Redis, and the dev delivery path logged the full text.
- Expected: Delivery should read the authorized persisted message and emit only metadata to the queue and operational logs.
- Root cause layer: architecture and verification
- Harness fix: Remove the redundant queue text field, redact dev delivery logging, and convert Slack-send exceptions to a fixed safe failure code; add focused queue-payload, log, and failure-reason regressions.
- Regression check: `pnpm --filter @entalent/worker exec vitest run src/conversation/outbox.service.test.ts src/message-send/message-send.processor.test.ts`.
- Status: fixed
- Historical queued jobs require a separate retention audit.
## 2026-09-29: Internal V1 analytics did not quarantine V2 policy windows

- Symptom: Manager trends, general overview survey count, and survey coverage still queried V1 evidence or assessments for windows bound to a V2 scoring policy.
- Expected: V1 analytics should exclude those windows while V2 reporting consumes only finalized safe question insights.
- Root cause layer: architecture and verification
- Harness fix: Add policy-binding exclusion to each V1 survey query and SQL-shape regressions for all three API paths.
- Regression check: `pnpm --filter @entalent/api exec vitest run src/admin/manager-dashboard.read-model.test.ts src/admin/analytics.controller.test.ts src/admin/survey-coverage.controller.test.ts`.
- Status: fixed
## 2026-09-29: Evidence extraction failure blocked confirmed V2 finalization

- Symptom: The survey evidence processor ran extraction before finalization, so a failed extraction prevented a previously confirmed question from being scored and purged.
- Expected: Confirmation should finalize independently of new evidence extraction on the same queued job.
- Root cause layer: workflow
- Harness fix: Finalize pending confirmed questions first; retain a migrated-PostgreSQL regression where extraction fails after the final record commits and private working text is purged.
- Regression check: `DATABASE_URL=<isolated-migrated-postgres> pnpm --filter @entalent/worker exec vitest run src/survey/survey-evidence.processor.test.ts src/survey/repositories/question-insight.repository.migrated.integration.test.ts`.
- Status: fixed
## 2026-09-29: V2 privacy gate accepted localized direct identifiers

- Symptom: The generic V1 de-identification check did not reject Unicode Slack handles, bare domains, local nine-digit phone numbers, dotted dates, or Russian and Polish written dates in V2 summaries. A later adversarial pass found that dotted clock time `14.30` and accent-folded variants of known Polish names also passed the V2 gate.
- Expected: Persistent Question Insight text should reject these identifiers before the score and summary commit.
- Root cause layer: architecture and verification
- Harness fix: Add a separately versioned Question Insight policy with Unicode-aware boundaries, route V2 finalization through it, and retain focused identifier tests plus a migrated-PostgreSQL retry/commit fixture. Expand the policy to `question-deidentification-v2` for dotted clock times and accent-folded known names. Keep the V1 group-state policy version stable.
- Regression check: `pnpm --filter @entalent/application exec vitest run src/utils/question-deidentification-policy.test.ts src/use-cases/finalize-question-insight.use-case.test.ts` and the migrated worker `question-insight.repository.migrated.integration.test.ts`.
- Status: fixed

## 2026-09-29: V2 privacy gate accepted localized labeled names

- Symptom: A V2 summary could retain a capitalized project, customer, team, or person name after a Polish, Ukrainian, or Russian label, such as `Projekt Orion`.
- Expected: The privacy gate should reject the candidate and retry before persisting reportable text.
- Root cause layer: architecture and verification
- Harness fix: Extend the V2-only labeled-identifier check to localized labels and retain a finalizer regression for a model-introduced Polish project name.
- Regression check: `pnpm --filter @entalent/application exec vitest run src/utils/question-deidentification-policy.test.ts src/use-cases/finalize-question-insight.use-case.test.ts`.
- Status: fixed

## 2026-09-29: Privacy policy version bump left a migrated fixture on v1

- Symptom: The full harness failed its migrated worker test because a newly finalized row correctly stored `question-deidentification-v2` while the fixture still expected `v1`.
- Expected: Integration assertions should distinguish the new policy version on fresh finalization from historical v1 rows inserted directly as fixtures.
- Root cause layer: verification
- Harness fix: Update the fresh-finalization assertion to v2 and retain the historical v1 fixture unchanged.
- Regression check: Migrated question-insight PostgreSQL test and `pnpm harness:check -- --base origin/main`.
- Status: fixed

## 2026-09-29: One full harness run reported an API session test error

- Symptom: One full harness run failed during the API suite with a Vitest unhandled error attributed to the Company Admin session test. The isolated session test, the full API suite, and the next full harness run passed without edits to that test.
- Expected: The full gate should pass consistently on the isolated PostgreSQL and Redis targets.
- Root cause layer: verification (unconfirmed)
- Harness fix: Retain the isolated session and full-suite commands as a diagnostic pair; capture complete API suite output on recurrence before changing product code.
- Regression check: `pnpm --filter @entalent/api test` and `pnpm harness:check -- --base origin/main` against the same isolated services.
- Status: open

## 2026-09-29: V2 cutoff discovery could strand private question text

- Symptom: A migrated-PostgreSQL RED fixture showed a closed-window `confirmed` row with an out-of-window confirmation remained private and unfinalizable. A separate unbound V2 working row was invisible to cutoff discovery because discovery required a Scoring Policy binding.
- Expected: Cutoff must purge invalid confirmed rows and all unresolved V2 working text in closed windows, independent of scoring-policy activation, while preserving valid confirmed rows for finalization retry.
- Root cause layer: architecture and verification
- Harness fix: Discover tenants from V2 working/bundle content directly, include invalid confirmed rows in the cutoff purge, and keep isolated PostgreSQL plus BullMQ restart fixtures.
- Regression check: `V2_CUTOFF_QUEUE_TEST=1 DATABASE_URL=<isolated-postgres> REDIS_URL=<isolated-redis-db-15> pnpm --filter @entalent/worker exec vitest run src/survey/repositories/survey.repository.cutoff.integration.test.ts`.
- Status: fixed

## 2026-09-29: Cutoff test table omitted a production window column

- Symptom: After adding confirmation-window validation, the focused cutoff fixture failed with `column survey_windows.period_start does not exist`; its temporary table modeled only `period_end`.
- Expected: The PostgreSQL fixture should expose the window columns used by the production cutoff query.
- Root cause layer: verification
- Harness fix: Add `period_start` to the temporary window table and keep the focused migrated-PostgreSQL check.
- Regression check: `DATABASE_URL=<isolated-postgres> pnpm --filter @entalent/worker exec vitest run src/survey/repositories/survey.repository.cutoff.integration.test.ts`.
- Status: fixed

## 2026-09-29: Cycle-close script discarded the Redis database number

- Symptom: `close-survey-reporting-cycle.ts` rebuilt the Redis connection from host, port, and password, so a configured `/15` database silently became DB 0 for enqueued report jobs.
- Expected: Operational cycle close should enqueue into the same Redis database named by `REDIS_URL` and used by the worker.
- Root cause layer: tooling
- Harness fix: Pass the complete Redis URL to ioredis. Keep a local DB-15 connection probe and the close-script configuration test in the verification recipe.
- Regression check: import `createRedis`, connect with an isolated `redis://127.0.0.1:56381/15`, verify `redis.options.db === 15`, then run the full harness.
- Status: fixed

## 2026-09-29: Inline tsx probe used unsupported top-level await

- Symptom: The first Redis URL verification command failed at transform time because `tsx -e` emits CommonJS and did not support top-level `await`.
- Expected: The local probe should reach Redis and verify the parsed database number.
- Root cause layer: workflow
- Harness fix: Wrap asynchronous inline probes in an async function and catch failures with a stable code.
- Regression check: the DB-15 connection probe exits zero and prints only `redis_db_15_ok`.
- Status: fixed

## 2026-09-29: Cutoff timer proof launcher could not load Nest decorators

- Symptom: An inline `node --import tsx` timer probe failed while transforming the decorated QuestionCutoffProcessor.
- Expected: The real BullMQ timing probe should load the same processor code that the worker runs.
- Root cause layer: tooling
- Harness fix: Build the worker with its Nest TypeScript config and load the emitted JavaScript for this probe.
- Regression check: `pnpm --filter @entalent/worker build`, then import `apps/worker/dist/survey/question-cutoff.processor.js` in the isolated BullMQ probe.
- Status: fixed

## 2026-09-29: PostgreSQL timestamp serialization broke purge assertion

- Symptom: The rejection purge assertion expected a JavaScript Date, but the raw PostgreSQL client returned a timestamp string.
- Expected: The test should verify purge completion independent of driver timestamp representation.
- Root cause layer: verification
- Harness fix: Assert `purged_at IS NOT NULL` for each working row and the Bundle, alongside the absence of private text and the preserved original message.
- Regression check: `DATABASE_URL=<isolated-postgres> pnpm --filter @entalent/worker exec vitest run src/survey/repositories/question-insight.repository.bundle.integration.test.ts`.
- Status: fixed

## 2026-09-29: Mounted analytics read Employee Conversation Storage

- Symptom: `/admin/analytics` and `/admin/manager/trends` queried `messages` directly for activity, contrary to the V2 analytics storage boundary.
- Expected: Mounted analytical readers consume content-free metadata and cannot query original conversation messages.
- Root cause layer: architecture
- Harness fix: Add a tenant/person/day activity projection maintained by a database trigger, backfill existing counts, and switch the mounted aggregate readers to that projection. Retain SQL-shape and migrated-PostgreSQL tests.
- Regression check: `DATABASE_URL=<isolated-migrated-postgres> pnpm --filter @entalent/api exec vitest run src/admin/analytics.controller.test.ts src/admin/manager-dashboard.read-model.test.ts src/admin/v2-analytics-quarantine.integration.test.ts` plus `pnpm --filter @entalent/database test:integration`.
- Status: fixed

## 2026-09-29: UTC day filter applied timezone to an interval

- Symptom: The first migrated-PostgreSQL analytics fixture failed with `function pg_catalog.timezone(unknown, interval) does not exist` after switching the trends query to daily activity.
- Expected: The query converts the completed timestamp expression to a UTC date.
- Root cause layer: verification
- Harness fix: Parenthesize the `now() - make_interval(...)` expression before `AT TIME ZONE 'UTC'` and keep the PostgreSQL API fixture in the gate.
- Regression check: `DATABASE_URL=<isolated-migrated-postgres> pnpm --filter @entalent/api exec vitest run src/admin/v2-analytics-quarantine.integration.test.ts`.
- Status: fixed

## 2026-09-29: Final-cycle closure enqueued V1 report jobs for V2 cycles

- Symptom: The final-cycle cohort query selected every ended cohort, including cohorts with a V2 scoring-policy binding. The later V1 group-state reader suppressed their data, but the queue job was still created.
- Expected: V1 report jobs should be created only for legacy cycles; V2 cycle cleanup should still run independently.
- Root cause layer: architecture and verification
- Harness fix: Exclude cohorts with a company-cycle V2 policy or any V2-bound window in the close repository query. Keep a PostgreSQL fixture for bound windows, registered cycles with no window, older V1 cycles, and the close use case's queued cohort IDs.
- Regression check: `DATABASE_URL=<isolated-postgres> pnpm --filter @entalent/worker exec vitest run src/survey/repositories/survey.repository.final-report-quarantine.integration.test.ts`.
- Status: fixed

## 2026-09-29: Vitest did not emit Nest constructor metadata in HTTP session fixture

- Symptom: The new Company Admin HTTP test returned 500 because Nest constructed the controller without its session dependency.
- Expected: The focused HTTP fixture should exercise a valid database-backed session and the admin guard.
- Root cause layer: tooling
- Harness fix: Supply explicit `design:paramtypes` metadata for the fixture controllers and guard before creating the test app.
- Regression check: `DATABASE_URL=<isolated-migrated-postgres> pnpm --filter @entalent/api exec vitest run src/company-auth/company-admin-session.integration.test.ts`.
- Status: fixed

## 2026-09-29: Report boundary fixture used an unsorted frozen roster

- Symptom: The five-person control case produced no V1 report before V2 binding because the test cohort's roster order differed from the sorted team roster.
- Expected: The control case should be reportable so the later V2 suppression assertion proves the boundary.
- Root cause layer: verification
- Harness fix: Sort the frozen cohort and window roster in the PostgreSQL fixture before exercising the report use case.
- Regression check: `DATABASE_URL=<isolated-migrated-postgres> pnpm --filter @entalent/worker exec vitest run src/survey/repositories/group-state.repository.v2-quarantine.integration.test.ts`.
- Status: fixed

## 2026-09-29: Analytical read-scope probe assumed missing database guard

- Symptom: A regression probe intended to expose a mismatched employee/window analytical row failed during insert with `survey_insight_v2_window_user_mismatch`.
- Expected: The test should prove the actual cross-scope boundary, including the database guard already installed by migration `0026`.
- Root cause layer: context and verification
- Harness fix: Assert the migrated PostgreSQL rejects both mismatched window ownership and mismatched question group, then verify the legitimate selector remains scoped.
- Regression check: `DATABASE_URL=<isolated-migrated-postgres> pnpm --filter @entalent/worker exec vitest run src/survey/repositories/question-insight.repository.migrated.integration.test.ts`.
- Status: fixed

## 2026-09-29: Conversation repository accepted mismatched message ownership

- Symptom: A message with valid tenant/user foreign keys but a different conversation owner entered private history or was readable by ID; a forged delivered disclosure could also satisfy the employee receipt lookup.
- Expected: Every private message read verifies that the referenced conversation has the same tenant and user as the message.
- Root cause layer: architecture and verification
- Harness fix: Join messages to their owning conversation in recent history, ID lookup, disclosure lookup, and inbound admission; reject mismatched external conversation reuse during API ingestion; add forward migration `0032` to reject new mismatched message writes while retaining a migrated-PostgreSQL regression for historical cross-tenant and same-tenant mismatches.
- Regression check: `DATABASE_URL=<isolated-migrated-postgres> pnpm --filter @entalent/worker exec vitest run src/conversation/repositories/conversation.repository.privacy.integration.test.ts src/conversation/repositories/conversation.repository.test.ts`.
- Status: fixed

## 2026-09-29: Historical privacy fixture failed after message owner guard

- Symptom: The migrated-PostgreSQL privacy test could no longer insert intentionally inconsistent historical messages after migration `0032`; its first raw-SQL replacement passed JavaScript Date objects that postgres.js could not bind.
- Expected: The fixture should reproduce possible pre-migration rows while the production write guard remains enabled for normal inserts.
- Root cause layer: verification and tooling
- Harness fix: Insert only the historical mismatch fixtures in a transaction with local replica trigger mode, use ISO timestamp strings, and restore normal trigger behavior at transaction end.
- Regression check: `DATABASE_URL=<isolated-migrated-postgres> pnpm --filter @entalent/worker exec vitest run src/conversation/repositories/conversation.repository.privacy.integration.test.ts`.
- Status: fixed

## 2026-09-29: BullMQ delivery fixture returned a string timestamp

- Symptom: The first V2 Bundle delivery-restart probe failed after retry because its mock repository returned raw postgres.js `sent_at` text, while the processor expects a `Date` from the production Drizzle repository.
- Expected: The queue probe should exercise the production message repository and verify recovery from a failure after delivery persistence.
- Root cause layer: verification
- Harness fix: Replace the mock message read/write with `ConversationRepository` on PostgreSQL; stub only eligibility and onboarding outside this fixture's scope.
- Regression check: `DATABASE_URL=<isolated-postgres> REDIS_URL=<isolated-redis-db-15> V2_BUNDLE_QUEUE_TEST=1 pnpm --filter @entalent/worker exec vitest run src/survey/repositories/question-insight.repository.bundle.integration.test.ts`.
- Status: fixed

## 2026-09-29: Conversation job caused side effects before private admission

- Symptom: A queued inbound message with mismatched ownership still enqueued profile hydration before the orchestrator rejected it. A job with a valid conversation owner but mismatched external destination generated an outbound reply.
- Expected: The stored conversation owner, external destination, and inbound message ownership must be verified before any profile, model, or outbound effect.
- Root cause layer: architecture and verification
- Harness fix: Validate the persisted external conversation ID, then validate the scoped inbound message before profile hydration. Keep focused negative tests for both cases in the orchestrator suite.
- Regression check: `pnpm --filter @entalent/application exec vitest run src/use-cases/conversation-orchestrator.test.ts -t 'rejects a queue destination|rejects a confirming message outside the conversation ownership'`.
- Status: fixed

## 2026-09-29: Survey evidence job evaluated an unowned conversation

- Symptom: The evidence use case read recent messages by conversation ID and could call the model using another employee's history for a forged queue user. The processor also finalized that queue user's pending insights before validating the conversation owner. A stale inbound ID still caused evaluation of newer history.
- Expected: Validate the conversation owner before finalization, window creation, or model work; evaluate a live job only when its exact inbound message remains in scoped recent history.
- Root cause layer: architecture and verification
- Harness fix: Add an owner admission check before processor finalization and in both live/backfill use cases, validate every returned message's scope, and skip live work when the source message is absent. Keep a migrated-PostgreSQL/BullMQ forged-owner fixture alongside the unit regressions.
- Regression check: `pnpm --filter @entalent/application exec vitest run src/use-cases/survey-evidence.use-case.test.ts` and `DATABASE_URL=<isolated-migrated-postgres> REDIS_URL=<isolated-redis-db-15> V2_CONVERSATION_QUEUE_TEST=1 pnpm --filter @entalent/worker exec vitest run src/conversation/v2-conversation-flow.integration.test.ts`.
- Status: fixed

## 2026-09-29: Full-rejection queue fixture lacked backlog state

- Symptom: The new rejection flow reached its database assertions, but found no backlog rows to verify reopening. The first local run also used a PostgreSQL role absent from this isolated cluster.
- Expected: The fixture should represent an active Pulse cycle with pending backlog rows and connect using the cluster's actual role.
- Root cause layer: verification and environment
- Harness fix: Seed all twelve backlog questions in the queue fixture and use the isolated cluster's verified `serzh` role in the local test command.
- Regression check: `DATABASE_URL=postgresql://serzh@127.0.0.1:55435/postgres REDIS_URL=redis://127.0.0.1:56381/15 V2_CONVERSATION_QUEUE_TEST=1 pnpm --filter @entalent/worker exec vitest run src/conversation/v2-conversation-flow.integration.test.ts`.
- Status: fixed

## 2026-09-29: Slack ingestion failures logged raw error objects

- Symptom: HTTP event and Socket Mode catch paths passed original pipeline/start errors to Nest logging; a pipeline error containing employee message text would expose that text in operational logs.
- Expected: Slack ingress acknowledges or handles the failure while logs contain only stable non-content error codes.
- Root cause layer: architecture and verification
- Harness fix: Replace raw error logging in both ingress paths with fixed codes and add private-marker regressions for HTTP events, Socket Mode events, and socket startup.
- Regression check: `pnpm --filter @entalent/api exec vitest run src/channel/slack-events.controller.test.ts src/channel/slack-socket-mode.lifecycle.test.ts`.
- Status: fixed

## 2026-09-29: V2 backfill skipped most employee messages

- Symptom: A 35-message conversation with 18 employee turns produced only four V2 backfill evaluations because the inherited V1 stride processed the last inbound message of each 15-message window.
- Expected: Recovery backfill should evaluate every in-cycle V2 employee turn once, attributing evidence to that exact source message and limiting model context to the nearest earlier assistant reply.
- Root cause layer: architecture and verification
- Harness fix: Give V2 backfill a per-inbound traversal with bounded two-turn context while retaining the existing V1 window traversal. Add a 35-message regression that verifies all source IDs and model context.
- Regression check: `pnpm --filter @entalent/application exec vitest run src/use-cases/survey-evidence.use-case.test.ts`.
- Status: fixed

## 2026-09-29: Hydration response contract fixture retained a removed field

- Symptom: The full harness typecheck failed after `traceId` was removed from the hydration-status response contract because its contract test fixture still included that field.
- Expected: The response contract and its typed fixture should describe the same safe fields.
- Root cause layer: verification
- Harness fix: Update the typed fixture in the same change as the contract; retain the full contract typecheck gate to catch future field drift.
- Regression check: `pnpm --filter @entalent/contracts typecheck` followed by `pnpm harness:check -- --base origin/main`.
- Status: fixed

## 2026-09-29: Model environment probe used an unavailable dotenv import

- Symptom: A one-line credential-presence probe failed because the root workspace does not expose `dotenv` as an importable Node package.
- Expected: The probe should confirm configuration presence without printing secret values or installing dependencies.
- Root cause layer: tooling
- Harness fix: Use the repo's configured `pnpm exec dotenv -e .env -- ...` launcher for model scripts and a key-only parser for read-only environment inspection.
- Regression check: Run `pnpm exec dotenv -e .env -- node -e 'console.log(Boolean(process.env.AZURE_OPENAI_API_KEY))'` before a synthetic model probe.
- Status: fixed

## 2026-09-29: Local migrated PostgreSQL started with wrong major version

- Symptom: `pg_ctl` failed to start the retained V2 test cluster because the shell resolved PostgreSQL 14 while its data directory was initialized by PostgreSQL 17.
- Expected: Local migrated-schema verification should start the retained cluster with the matching server major version.
- Root cause layer: environment and tooling
- Harness fix: Read `PG_VERSION` before starting a retained test cluster and invoke that major version's `pg_ctl` explicitly; this cluster uses `/opt/homebrew/opt/postgresql@17/bin/pg_ctl`.
- Regression check: Compare `cat <cluster>/PG_VERSION` with `<pg_ctl> --version` before `pg_ctl start`, then run `pg_isready` on the chosen test port.
- Status: fixed

## 2026-09-29: Recovery processor test used an unsupported matcher and stale application build

- Symptom: The first focused recovery run failed because this Vitest version lacks `toHaveBeenCalledBefore`; typecheck also found one finalizer fake missing the new repository method, two cutoff fixtures using the old constructor, and a worker import pointing at stale built application exports.
- Expected: Recovery tests and worker typecheck should exercise the new periodic path with current package exports and complete test doubles.
- Root cause layer: verification and tooling
- Harness fix: Compare Vitest mock invocation order directly, update all constructor and repository fixtures with the new dependency, and build `@entalent/application` before isolated worker typecheck.
- Regression check: `pnpm --filter @entalent/application typecheck && pnpm --filter @entalent/application build && pnpm --filter @entalent/worker typecheck && pnpm --filter @entalent/worker exec vitest run src/survey/question-cutoff.processor.test.ts`.
- Status: fixed

## 2026-09-29: Raw SQL tuple comparison received a Date object

- Symptom: The first migrated-PostgreSQL delayed-source test failed because postgres-js could not bind a JavaScript `Date` interpolated inside a raw Drizzle SQL tuple.
- Expected: The source-bound history query should compare the timestamp and return earlier messages.
- Root cause layer: tooling
- Harness fix: Serialize timestamps to ISO strings and cast them to `timestamptz` in raw SQL fragments.
- Regression check: `DATABASE_URL=<migrated-local-db> pnpm --filter @entalent/worker exec vitest run src/conversation/repositories/conversation.repository.privacy.integration.test.ts`.
- Status: fixed

## 2026-09-29: Retained PostgreSQL cluster restarted on default port

- Symptom: Four migrated-database tests failed with `ECONNREFUSED` on port 55435 after the retained cluster started on port 5432.
- Expected: The retained test cluster should listen on the port named by `DATABASE_URL`.
- Root cause layer: environment and tooling
- Harness fix: Start the retained PostgreSQL 17 cluster with `pg_ctl -o '-p 55435'` and check its readiness on that port before database tests.
- Regression check: `pg_isready -h 127.0.0.1 -p 55435` before the migrated-database Vitest command.
- Status: fixed

## 2026-09-29: Existing Pulse question map mistaken for missing rubric input

- Symptom: The handoff said all twelve rubrics needed to be provided, overlooking the approved question-to-Index map and separate Engagement rules in REQ-008.
- Expected: Reuse prior approved requirements before asking the user to resupply product definitions.
- Root cause layer: context and workflow
- Harness fix: Check `docs/collected-product-requirements.md` REQ-008 and the current V2 spec scope before declaring a scoring dependency; distinguish stable question mapping from exact `0–100` rubric anchors.
- Regression check: Compare the V2 spec question model and deferred decisions against REQ-008 before updating IA-022 or asking for rubric content.
- Status: fixed

## 2026-09-29: Canonical-map guard exposed synthetic stable-key fixtures

- Symptom: The first full harness failed three worker repository fixtures with `v2_scoring_policy_incomplete`; one edited fixture then had a syntax error and a remaining lookup for `growth_2`.
- Expected: V2 test definitions should use the approved REQ-008 stable keys while keeping synthetic scoring anchors confined to fixtures.
- Root cause layer: verification and context
- Harness fix: Reuse the canonical key map in worker fixtures, keep an independent literal map in validator and database tests, and run worker typecheck plus targeted migrated-database tests before the full harness.
- Regression check: `pnpm --filter @entalent/worker typecheck` and the migrated PostgreSQL worker test suite with `DATABASE_URL` set.
- Status: fixed

## 2026-09-29: Legacy analytics accepted cross-definition survey rows

- Symptom: A migrated-PostgreSQL fixture counted scored assessments whose question belonged to another tenant's survey definition; forged evidence suppressed or altered trends, and a window carrying another tenant's employee was counted.
- Expected: Overview, coverage, and trends should use only questions from the window's definition, tenant-owned or global definitions, windows owned by the tenant's employee, and evidence from that window's employee.
- Root cause layer: architecture and verification
- Harness fix: Add scoped definition and employee joins to all mounted survey aggregate readers and retain the forged cross-definition and cross-person PostgreSQL fixture.
- Regression check: `DATABASE_URL=<migrated-local-db> pnpm --filter @entalent/api exec vitest run src/admin/v2-analytics-quarantine.integration.test.ts`.
- Status: fixed

## 2026-09-29: Retained production delivery jobs outlive message text ownership

- Symptom: A read-only production queue audit found `text` in all 1000 retained completed and four failed `message-send` jobs. None of the four failed jobs had a matching scoped outbound message row, so the queue retained text after its source message was gone. Their failure reasons were not stable codes.
- Expected: Redis delivery jobs should hold identifiers only; retained failures should not preserve raw provider errors or private text beyond the message lifecycle.
- Root cause layer: architecture and verification
- Harness fix: Keep new delivery payloads identifier-only and add a dry-run-first retained-job redaction tool. Require the message-ID worker deployment before using its apply mode, and verify the queue state and post-write contents.
- Regression check: `pnpm exec tsx scripts/redact-retained-message-send-jobs.test.ts`, isolated Redis dry-run/apply, and a production dry-run returning zero retained `withText` after the authorized cleanup.
- Status: open

## 2026-09-29: Redaction tool initially used a protected BullMQ job key method

- Symptom: Script typecheck rejected `Job.toKey()` because it is protected and expects a key argument.
- Expected: The script should use a public queue API to address a retained job's Redis hash.
- Root cause layer: tooling
- Harness fix: Use `Queue.toKey(job.id)` and include the script in the TypeScript gate.
- Regression check: `pnpm exec tsc -p scripts/tsconfig.v2-policy.json` and isolated Redis apply verification.
- Status: fixed

## 2026-09-29: Full harness caught nullable BullMQ stacktrace type

- Symptom: The full harness failed script typecheck because `Job.stacktrace` can be null after reloading a retained job.
- Expected: Post-redaction verification should accept an absent stacktrace as empty without weakening the failure-reason check.
- Root cause layer: verification
- Harness fix: Treat a null stacktrace as length zero and keep the redaction script in the full TypeScript gate.
- Regression check: `pnpm exec tsc -p scripts/tsconfig.v2-policy.json` and `pnpm harness:check -- --base origin/main`.
- Status: fixed

## 2026-09-29: V2 reporting selector admitted a confirmation at the cycle cutoff

- Symptom: A migrated-PostgreSQL RED fixture inserted a finalized question with `confirmedAt = periodEnd`; the final selector returned its score and summary. A late prior-cycle score could also become the chosen trend baseline.
- Expected: Only confirmations within the half-open `[periodStart, periodEnd)` window may enter final or prior-cycle reporting inputs; a late working confirmation must not reach scoring.
- Root cause layer: architecture and verification
- Harness fix: Scope final and prior-score reads by their owner window and confirmation interval, reject out-of-window working confirmation before finalization, and keep the migrated cutoff fixture.
- Regression check: `DATABASE_URL=<migrated-local-db> pnpm --filter @entalent/worker exec vitest run src/survey/repositories/question-insight.repository.migrated.integration.test.ts`.
- Status: fixed

## 2026-09-29: Cross-package worker test used stale application build

- Symptom: After changing the application repository port, the worker typecheck and integration test still loaded the old `@entalent/application` declaration and runtime build, reporting a missing `findWindowPeriodEnd` method.
- Expected: Worker verification should use the current application package build after a shared port change.
- Root cause layer: workflow
- Harness fix: Added `pnpm --filter @entalent/worker test:focused <test-path>` and made worker `typecheck` build `@entalent/application` first. Pass the test path without `--`: that separator becomes a literal Vitest argument and runs the whole suite. Direct `exec vitest` can load stale `dist`.
- Regression check: `pnpm --filter @entalent/worker test:focused src/survey/survey-evidence.recovery.integration.test.ts` with isolated `DATABASE_URL`, `REDIS_URL`, and `V2_CONVERSATION_QUEUE_TEST=1`.
- Status: fixed

## 2026-09-29: Delayed V2 conversation message fell outside recent history

- Symptom: Orchestration rejected a valid queued inbound when twenty newer messages were stored before its job ran.
- Expected: The queued inbound and its preceding context should be read by source ID, regardless of newer messages.
- Root cause layer: architecture and verification
- Harness fix: Use the source-bound history repository path for conversation orchestration when available, and keep a delayed-message regression.
- Regression check: `pnpm --filter @entalent/application exec vitest run src/use-cases/conversation-orchestrator.test.ts`.
- Status: fixed

## 2026-09-29: Late V2 capture could recreate private text after cutoff

- Symptom: A delayed job with an in-period source timestamp could insert a collecting summary after the cutoff scanner had run.
- Expected: Capture after the window end should be ignored, even for an older source message.
- Root cause layer: architecture and verification
- Harness fix: Check current time against the window end in the capture transaction and retain a PostgreSQL cutoff regression.
- Regression check: `DATABASE_URL=<local-db> pnpm --filter @entalent/worker exec vitest run src/survey/repositories/question-insight.repository.capture.integration.test.ts`.
- Status: fixed

## 2026-09-29: Isolated PostgreSQL start used an older client binary

- Symptom: The default `pg_ctl` from PostgreSQL 14 could not start the isolated PostgreSQL 17 data directory.
- Expected: Local verification should launch the server with its matching major-version binary.
- Root cause layer: environment
- Harness fix: Record and use `/opt/homebrew/opt/postgresql@17/bin/pg_ctl` for this isolated test directory.
- Regression check: Check the data-directory version before starting PostgreSQL for the harness.
- Status: fixed

## 2026-09-29: Privacy documentation advertised unmounted rights routes

- Symptom: `PRIVACY.md` described arbitrary-user shared-key export/deletion routes as active and listed retention periods that conflict with current code defaults.
- Expected: The privacy inventory should reflect mounted access boundaries, distinguish current configured defaults from an approved policy, and avoid claiming a rights workflow that is not implemented.
- Root cause layer: context and verification
- Harness fix: Compare privacy documentation with the production AppModule route graph and `DEFAULT_RETENTION_POLICY` during IA-043 review; require a separate identity and privacy contract for employee-rights delivery.
- Regression check: Review `PRIVACY.md` alongside `apps/api/src/app.module.ts`, `apps/api/src/users/users.module.ts`, and `packages/domain/src/tenant/tenant.ts` before publishing privacy claims.
- Status: fixed

## 2026-09-29: Unlabeled person name survived the V2 privacy gate

- Symptom: A candidate summary retaining `Sarah` was accepted when the confirmed meaning named Sarah without a role label and hierarchy identifiers did not include her. Follow-up RED fixtures found the same gap for names at the first sentence start in English, Polish, and Ukrainian, then again at the start of a later sentence.
- Expected: A person name already visible in the confirmed source should be treated as a known identifier before final analytical text is persisted.
- Root cause layer: architecture and verification
- Harness fix: Extract capitalized names occurring within source sentences and at every likely sentence start into the privacy identifier set; exempt common generic starters, retain multilingual RED/GREEN finalizer regressions, and keep categorical fallback.
- Regression check: `pnpm --filter @entalent/application exec vitest run src/use-cases/finalize-question-insight.use-case.test.ts` and migrated PostgreSQL finalization test.
- Status: fixed

## 2026-09-29: Slack HTTP webhook accepted events without a signed body

- Symptom: A direct controller call with no `rawBody` reached the ingestion pipeline; URL verification also returned its challenge before signature verification.
- Expected: Every Slack HTTP request must have a raw body and pass workspace signature verification before ingestion or challenge response.
- Root cause layer: architecture and verification
- Harness fix: Fail closed when `rawBody` is absent and verify the signature before handling either request type; retain focused controller regressions.
- Regression check: `pnpm --filter @entalent/api exec vitest run src/channel/slack-events.controller.test.ts`.
- Status: fixed

## 2026-09-29: Slack URL challenge lacked a workspace identity

- Symptom: The first signature hardening required a workspace lookup before returning a URL challenge, but Slack URL verification may omit `team_id` before any workspace connection exists.
- Expected: A valid app-signed challenge should succeed without a workspace ID, while unsigned challenges and ordinary events remain rejected.
- Root cause layer: architecture and verification
- Harness fix: Verify URL challenges with the configured app signing secret when present, retain the workspace secret path for ordinary events, and cover both valid and invalid challenge signatures.
- Regression check: `pnpm --filter @entalent/api exec vitest run src/channel/slack-events.controller.test.ts`.
- Status: fixed

## 2026-09-29: zsh reserved `status` masked a successful harness exit

- Symptom: A harness wrapper attempted to assign `status=$?` in zsh, which is read-only; the wrapper exited 1 after the harness had already written a passed receipt.
- Expected: The wrapper should preserve the harness exit code and print its final lines without adding a shell error.
- Root cause layer: tooling
- Harness fix: Use a task-specific nonreserved name such as `harness_exit_code` in zsh wrappers and inspect the structured receipt when a wrapper fails after a command.
- Regression check: Run the wrapper in zsh with a nonreserved exit-code variable and confirm its exit matches `pnpm harness:check`.
- Status: fixed

## 2026-09-29: Mounted Slack webhook test used an incompatible parser type

- Symptom: The mounted Fastify test passed at runtime but API typecheck rejected a `Record<string, unknown>` parser request annotation.
- Expected: Route verification and TypeScript's Fastify parser contract should both pass.
- Root cause layer: verification
- Harness fix: Let Fastify infer the parser callback types and cast only the added `rawBody` property.
- Regression check: `pnpm --filter @entalent/api typecheck` plus the mounted controller test.
- Status: fixed

## 2026-09-29: Slack signed timestamp accepted future and malformed values

- Symptom: RED adapter tests showed HMAC-valid requests with a timestamp more than five minutes in the future or a nonnumeric timestamp passed verification.
- Expected: A signed Slack HTTP request must carry a valid integer timestamp within five minutes of local time.
- Root cause layer: architecture and verification
- Harness fix: Validate decimal timestamp syntax and safe integer range before enforcing the symmetric five-minute window; retain focused adapter tests.
- Regression check: `node --import tsx --test packages/channel-slack/src/slack.adapter.test.ts`.
- Status: fixed

## 2026-09-29: Unsigned Slack team ID reached API warning logs

- Symptom: A RED controller test sent an invalidly signed URL challenge with a private marker in `team_id`; the API warning included the marker verbatim.
- Expected: Untrusted Slack request fields must not enter ingestion diagnostics before signature verification.
- Root cause layer: architecture and verification
- Harness fix: Use stable warning codes for missing raw body, missing signing secret, and invalid signature; retain the private-marker controller regression.
- Regression check: `pnpm --filter @entalent/api exec vitest run src/channel/slack-events.controller.test.ts`.
- Status: fixed

## 2026-09-29: Parameterized V2 queue fixture used a readonly statement list

- Symptom: Worker typecheck rejected passing a readonly group-example statement list into the mutable `arrayContaining` matcher after the queue fixture was extended to four Index groups.
- Expected: The expanded fixture should typecheck and run all canonical group scenarios.
- Root cause layer: verification
- Harness fix: Copy the example tuple into a mutable fixture array before using matchers and model doubles.
- Regression check: `pnpm --filter @entalent/worker typecheck` and the opt-in V2 BullMQ flow.
- Status: fixed

## 2026-09-29: V2 privacy gate accepted bare contact and Slack identifiers

- Symptom: RED policy tests accepted a ten-digit phone number without separators, a raw Slack user ID, and a Slack channel mention embedded in a candidate analytical summary.
- Expected: These identifying forms must fail the privacy gate so the finalizer retries or uses a safe fallback before persistence.
- Root cause layer: architecture and verification
- Harness fix: Extend the versioned V2 policy with bounded numeric, Slack user ID, and channel-mention patterns; keep policy and finalizer retry regressions.
- Regression check: `pnpm --filter @entalent/application exec vitest run src/utils/question-deidentification-policy.test.ts src/use-cases/finalize-question-insight.use-case.test.ts`.
- Status: fixed

## 2026-09-29: V2 privacy gate accepted Slack user-group ID without alias

- Symptom: A RED policy test accepted `<!subteam^S12345678>` in a candidate Question Insight. The aliased form was rejected only because its alias looked like a Slack handle.
- Expected: A Slack user-group ID must fail the privacy gate with or without an alias.
- Root cause layer: architecture and verification
- Harness fix: Match Slack user-group mentions as known identifiers in the versioned V2 policy and retain both policy regressions.
- Regression check: `pnpm --filter @entalent/application exec vitest run src/utils/question-deidentification-policy.test.ts`.
- Status: fixed

## 2026-09-29: V2 privacy gate accepted internationalized email

- Symptom: RED policy tests accepted `sara@会社.jp` and failed to classify `sara@przykład.pl` as an email; the first address could enter a final analytical summary.
- Expected: An email address with Unicode local or domain characters must fail the V2 privacy gate.
- Root cause layer: architecture and verification
- Harness fix: Add a Unicode-aware email pattern to the versioned V2 policy and retain policy plus finalizer retry regressions.
- Regression check: `pnpm --filter @entalent/application exec vitest run src/utils/question-deidentification-policy.test.ts src/use-cases/finalize-question-insight.use-case.test.ts`.
- Status: fixed

## 2026-09-29: BullMQ cutoff retry test read a stale job object

- Symptom: The three-attempt integration test observed the job in Redis as `failed` but reported `attemptsMade = 0` from the enqueue-time JavaScript object.
- Expected: The test should verify the authoritative attempt count after the worker has processed the job.
- Root cause layer: verification
- Harness fix: Reload the job from its queue before asserting `attemptsMade`, then exercise manual retry and privacy cleanup.
- Regression check: Run the opt-in V2 cutoff queue test with isolated PostgreSQL and Redis DB 15.
- Status: fixed

## 2026-09-29: Receipt failure retried a completed V2 verdict

- Symptom: A transient failure writing the conversation-job receipt made BullMQ rerun a successfully orchestrated V2 verdict and send a second outbound message.
- Expected: A receipt failure after durable orchestration must retry only receipt and cutoff cleanup, without repeating the employee response.
- Root cause layer: architecture and verification
- Harness fix: Queue an identifier-only `receipt-retry` job after a failed receipt write and keep a migrated PostgreSQL/BullMQ regression that injects this failure and checks the outbound count, receipt, and cleanup.
- Regression check: `V2_CONVERSATION_QUEUE_TEST=1 pnpm --filter @entalent/worker exec vitest run src/conversation/v2-conversation-flow.integration.test.ts` with isolated PostgreSQL and Redis.
- Status: fixed

## 2026-09-29: Timely V2 clarification disappeared when its worker ran after cutoff

- Symptom: A persisted, in-period clarification was absent from the pending lookup after wall-clock cutoff, even while the receipt barrier retained its private Bundle.
- Expected: A reply recorded before the window end remains eligible when delayed queue processing reaches it.
- Root cause layer: architecture and verification
- Harness fix: Scope clarification lookup to the persisted inbound message and compare its timestamp with the window end; retain a PostgreSQL regression for timely and late messages.
- Regression check: Run `question-insight.repository.bundle.integration.test.ts` with a responsive PostgreSQL target, then process a timely clarification through BullMQ after cutoff.
- Status: fixed

## 2026-09-29: Missing conversation job can hold V2 temporary content indefinitely

- Symptom: Slack ingestion persisted an inbound message before enqueueing its conversation job; an enqueue failure could leave no job or receipt while cutoff deferred private cleanup indefinitely. New admissions recover this case. Retained completed jobs can now recover their missing receipt, but older messages without an admission and jobs that failed or were evicted still need reconciliation.
- Expected: A durable recovery path eventually processes every timely persisted reply or reaches an explicit, audited terminal decision.
- Root cause layer: architecture
- Harness fix: Migration `0036` records a content-free admission transactionally with Slack inbound; the cutoff scanner requeues never-admitted timely replies with a stable job ID and queues receipt-only recovery for retained completed jobs. Add durable side-effect reconciliation for failed or evicted jobs before replaying those.
- Regression check: The opt-in V2 BullMQ flow must recover a never-enqueued reply after cutoff with one response and eventual purge; separately inject a failed or evicted job after orchestration to prove no duplicate response.
- Status: open

## 2026-09-29: Clarification integration fixture reused a later message ID

- Symptom: The first PostgreSQL run of the cutoff regression failed in a subsequent test with a duplicate `messages_pkey`.
- Expected: Each fixture message has a unique ID across the shared temporary tables.
- Root cause layer: verification
- Harness fix: Give the late-response fixture a distinct message ID and rerun the whole file on isolated PostgreSQL.
- Regression check: Run `question-insight.repository.bundle.integration.test.ts` with `DATABASE_URL` set; all enabled tests must pass together.
- Status: fixed

## 2026-09-29: Admission test doubles lagged behind the new API call

- Symptom: The first Slack ingest unit run failed because its spy expected one `saveInboundMessage` argument while durable admission adds a second argument.
- Expected: The test should assert both the inbound source and its content-free admission metadata.
- Root cause layer: verification
- Harness fix: Update the spy expectation and add an enqueue-failure case that keeps the admission pending.
- Regression check: `pnpm --filter @entalent/api exec vitest run src/channel/slack-ingest.service.test.ts`.
- Status: fixed

## 2026-09-29: Cutoff test constructor patch landed on the conversation processor

- Symptom: Typecheck found seven arguments on `ConversationProcessor` and only three on `QuestionCutoffProcessor` in one integration fixture.
- Expected: Only the cutoff fixture should receive the new admission repository and conversation queue dependencies.
- Root cause layer: workflow and verification
- Harness fix: Move the test doubles to the exact cutoff constructor and run worker typecheck before the BullMQ suite.
- Regression check: `pnpm --filter @entalent/worker typecheck`.
- Status: fixed

## 2026-09-29: Receipt recovery fixture misread BullMQ attempt count

- Symptom: The first completed-job recovery scenario expected `attemptsMade = 0`, but BullMQ reported one attempt for a job that ran once and completed.
- Expected: The test should use BullMQ's persisted attempt count and separately assert one model verdict and one outbound response.
- Root cause layer: verification
- Harness fix: Expect one attempt, retain the post-cutoff completed-job receipt recovery assertion, and rerun the scenario against isolated PostgreSQL and Redis.
- Regression check: Run the opt-in V2 BullMQ flow filtered to `receiptRetryUnavailable=true`, then the full file.
- Status: fixed

## 2026-09-29: Completed-job receipt test used a purged Bundle

- Symptom: A post-cutoff agreement resolved and purged its Bundle, so the missing-receipt scanner correctly found no held temporary content; the test expected a receipt-retry job that this cleanup path did not need.
- Expected: The fixture should retain a pending Bundle while proving a completed job's missing receipt is recovered without repeating the response.
- Root cause layer: verification
- Harness fix: Use an unrelated timely reply that leaves the Bundle pending until the receipt releases cutoff; assert one response, one interpretation, receipt-only retry, and `no_data` cleanup.
- Regression check: Run the opt-in V2 BullMQ flow filtered to `receiptRetryUnavailable=true` against migrated PostgreSQL and Redis DB 15.
- Status: fixed

## 2026-09-29: Pagination regression used an unsupported Vitest matcher

- Symptom: The first focused run and worker typecheck failed because `toHaveBeenCalledExactlyOnceWith` is unavailable in this Vitest version.
- Expected: The test should prove one receipt retry with the scoped payload using supported matchers.
- Root cause layer: verification
- Harness fix: Assert `toHaveBeenCalledOnce` and `toHaveBeenCalledWith` separately.
- Regression check: Run the focused cutoff unit test and `pnpm --filter @entalent/worker typecheck` together.
- Status: fixed

## 2026-09-29: Late-persisted reply holds a Bundle without a recovery path

- Symptom: A reply with an event timestamp before cutoff but first persisted after cutoff enters the no-receipt purge barrier and overdue count, while the admission recovery selector excludes it.
- Expected: The purge barrier and recovery eligibility must follow one approved policy for late Slack delivery; a Bundle must not be retained with no possible processing path.
- Root cause layer: architecture
- Harness fix: Keep a PostgreSQL fixture for late first persistence and apply the selected cutoff policy consistently to receipt barrier, admission recovery, and verdict eligibility.
- Regression check: Run `survey.repository.cutoff.integration.test.ts` and `survey.repository.admission.integration.test.ts` together with `DATABASE_URL` set.
- Status: open

## 2026-09-29: Root scoring script was invoked with the package test runner

- Symptom: `pnpm exec vitest run scripts/activate-v2-scoring-policy.test.ts` failed because the root workspace does not provide a Vitest binary.
- Expected: Root script tests use the repository's `tsx` launcher.
- Root cause layer: workflow
- Harness fix: Use the command declared in `package.json`: `pnpm exec tsx scripts/activate-v2-scoring-policy.test.ts`.
- Regression check: Run that exact command before scoring-policy activation changes are handed off.
- Status: fixed

## 2026-09-29: Activated V2 question content remained editable

- Symptom: A migrated PostgreSQL fixture accepted a version and semantic-content edit to an open-ended question after its V2 cycle was registered.
- Expected: An activated cycle retains the same question identity, version, wording, and interpretation throughout processing and finalization.
- Root cause layer: architecture
- Harness fix: Forward migration `0037` freezes substantive question-row updates after V2 activation while permitting no-op updates and edits to unactivated definitions.
- Regression check: Run `DATABASE_URL=<isolated-local-postgres> pnpm --filter @entalent/database exec vitest run --config vitest.integration.config.ts src/__tests__/survey-cycle-policy-activation.integration.test.ts`.
- Status: fixed

## 2026-09-29: BullMQ retry delivered two responses for one V2 verdict

- Symptom: A migrated-PostgreSQL/Redis worker fixture queued one outbound, injected a post-enqueue error, retried the same conversation job, and delivered two different outbound message IDs for the same inbound while recording one receipt.
- Expected: A committed V2 turn has one outbound identity and resumes missing dispatch without reapplying its verdict or generating another response.
- Root cause layer: architecture
- Harness fix: Add a scoped PostgreSQL turn-effect commit and identifier-only durable dispatch intents, then reconcile failed or evicted jobs from that state. Keep the new two-attempt fixture as the regression and change its assertion to exactly one delivered outbound when the fix is wired.
- Regression check: Run `V2_CONVERSATION_QUEUE_TEST=1 DATABASE_URL=<isolated-local-postgres> REDIS_URL=redis://127.0.0.1:<port>/15 pnpm --filter @entalent/worker exec vitest run src/conversation/v2-conversation-flow.integration.test.ts -t deliveryEnqueuedThenError=true`.
- Current mitigation: Stable inbound-derived outbound UUID and scoped text/owner checks now yield one delivered response in the two-attempt fixture. The post-verdict/pre-outbound gap and Redis-loss reconciliation remain open.
- Status: open

## 2026-09-29: V2 queue test used a future synthetic inbound timestamp as delivery cutoff

- Symptom: The first duplicate-delivery assertion found zero responses because it filtered response `occurredAt` against a synthetic inbound timestamp set one second after prompt delivery, which was still in the future during rapid test execution.
- Expected: The fixture should identify the two response rows by the actual queued outbound IDs and verify each has a delivery timestamp.
- Root cause layer: verification
- Harness fix: Assert distinct message-send job IDs and their scoped persisted delivery rows instead of comparing fixture timestamps to wall-clock delivery time.
- Regression check: Run the focused `deliveryEnqueuedThenError=true` PostgreSQL/Redis scenario.
- Status: fixed

## 2026-09-29: Outbound identity tests missed schema and metadata requirements

- Symptom: Initial focused tests failed because two exact metadata assertions omitted the new source ID and a new Drizzle integration fixture omitted the required `occurred_at` value.
- Expected: Tests changing persisted message shape should update exact allowlists and construct complete schema-valid rows.
- Root cause layer: verification
- Harness fix: Include the identifier-only source marker in expected metadata and set explicit timestamps in newly inserted message fixtures.
- Regression check: Run application orchestrator tests and worker typecheck before the PostgreSQL/BullMQ queue scenario.
- Status: fixed

## 2026-09-29: Bundle fixture wrote verdict receipts outside its temporary schema

- Symptom: Four Bundle integration cases failed after migration `0038`; the receipt insert reached the real table and failed its tenant/person/conversation scope trigger.
- Expected: The fixture isolates every table used by the repository, including newly added durable receipts.
- Root cause layer: verification
- Harness fix: Add `survey_question_verdict_receipts` to the fixture's temporary tables so its inbound and receipt share the same isolated scope.
- Regression check: Run the Bundle integration file with migrated PostgreSQL, then `pnpm harness:check -- --base origin/main`.
- Status: fixed

## 2026-09-29: Isolated PostgreSQL restarted on its default port

- Symptom: The first `0039` integration run could not connect to the named `55441` target after restarting the saved test cluster.
- Expected: The restarted cluster listens on the explicit port used by the test environment.
- Root cause layer: environment
- Harness fix: Restart `pg_ctl` with `-o '-p 55441'` and verify its listener before running the migration test.
- Regression check: Read `postmaster.opts` or probe the named port before invoking the integration suite.
- Status: fixed

## 2026-09-29: Custom migration used a reserved SQL alias

- Symptom: Migration `0040` failed to parse at `window` during the first isolated PostgreSQL run.
- Expected: The group-report intent guard migration applies before integration assertions.
- Root cause layer: verification
- Harness fix: Use `cycle_window` as the SQL alias and rerun the migrated integration fixture.
- Regression check: Apply every custom migration to isolated PostgreSQL before relying on a generated snapshot or typecheck.
- Status: fixed

## 2026-09-29: Clarification preview assertion mixed object and null matchers

- Symptom: Worker typecheck rejected a `toMatchObject` expectation whose conditional argument could be `null`, although the Vitest run passed.
- Expected: The test checks the first remaining clarification as an object and the final one as null with their respective matchers.
- Root cause layer: verification
- Harness fix: Split the assertion by case and run worker typecheck alongside the focused PostgreSQL test.
- Regression check: `pnpm --filter @entalent/worker typecheck` before the full V2 queue suite.
- Status: fixed

## 2026-09-29: Isolated PostgreSQL restarted with the wrong major version

- Symptom: The first restart of the saved PostgreSQL fixture failed because shell `pg_ctl` resolved to version 14 while its data directory was created by version 17.
- Expected: The saved fixture starts on port 55441 for the migrated V2 queue test.
- Root cause layer: environment
- Harness fix: Use `/opt/homebrew/opt/postgresql@17/bin/pg_ctl` for this version 17 fixture and retain its explicit port.
- Regression check: Check `PG_VERSION` and the selected `pg_ctl --version` before restarting a saved fixture.
- Status: fixed

## 2026-09-29: Orchestrator fake omitted persisted response text

- Symptom: The full harness failed 81 application assertions after the orchestrator began using the committed outbound text; the test repository returned only an ID.
- Expected: The repository fake returns the saved response text as the real adapter does.
- Root cause layer: verification
- Harness fix: Make the shared fake echo the saved text and preserve its test ID in sequential overrides.
- Regression check: Run the full conversation-orchestrator test file after changing persisted response reads.
- Status: fixed

## 2026-09-29: Concurrent committed turns duplicated downstream evidence dispatch

- Symptom: Two workers for one admitted inbound produced one outbound and one verdict but queued Pulse evidence twice.
- Expected: A committed turn has one stable intent and queue job per downstream effect.
- Root cause layer: architecture
- Harness fix: Commit identifier-only evidence, memory, and style intents with the response; dispatch only unqueued intents under stable job IDs. Keep the concurrent BullMQ case.
- Regression check: Run the `concurrentThird=true` migrated PostgreSQL/Redis V2 flow and assert one job per effect.
- Status: fixed

## 2026-09-29: Purged Bundle hid a committed turn from cutoff recovery

- Symptom: A timely V2 agreement committed its outbound and verdict, then its original Redis job failed before the receipt; the cutoff scanner found no pending admission.
- Expected: The scanner finds that committed turn by scoped inbound identity and resumes its receipt and undispatched send without repeating the verdict.
- Root cause layer: architecture
- Harness fix: Permit the queued admission selector to include a purged Bundle only when a same-tenant, same-user, same-conversation committed turn effect exists; retain the unpurged rule for uncommitted replies.
- Regression check: Run the migrated PostgreSQL/Redis `lostMessageJob=true` flow and the admission selector fixture with a purged Bundle.
- Status: fixed

## 2026-09-29: Isolated PostgreSQL test command assumed Docker credentials

- Symptom: Initial focused tests failed with `role "postgres" does not exist`; the local fixture on port 55441 uses the OS user and the `postgres` database.
- Expected: The test command targets the named isolated PostgreSQL fixture with its actual role and database.
- Root cause layer: environment
- Harness fix: Check the isolated server role and database before constructing `DATABASE_URL`; use the verified target in the test command.
- Regression check: Run `psql -h 127.0.0.1 -p 55441 -d postgres -Atqc 'select current_user, current_database()'` before the V2 queue fixture.
- Status: fixed

## 2026-09-29: Profile hydration queued before the response transaction

- Symptom: An inbound turn with missing profile data queued hydration before the model response existed; a response-model failure left a Redis job without a committed turn.
- Expected: The hydration job is dispatched only from a committed, scoped turn intent and repeated dispatch uses one job identity.
- Root cause layer: architecture
- Harness fix: Add a profile-hydration intent to the turn transaction, dispatch it after commit with an inbound-derived job ID, and scan old unqueued committed intents outside survey windows.
- Regression check: Run the application response-failure test, Redis outbox identity test, and migrated PostgreSQL/BullMQ lost-job recovery case.
- Status: fixed

## 2026-09-29: Employee reminder escaped a failed response turn

- Symptom: Reminder scheduling saved an action and enqueued its job before the response was prepared; a later response failure left a reminder without the committed answer.
- Expected: The action and answer commit or roll back together, and a delayed job follows only a committed action intent.
- Root cause layer: architecture
- Harness fix: Save the action in the turn transaction, persist an action-scoped follow-up intent, and use a stable action-and-due-time job ID after commit.
- Regression check: Run the application response-failure test and the migrated PostgreSQL/Redis reminder transaction rollback test.
- Status: fixed

## 2026-09-29: V1 group confirmation and report escaped a failed answer

- Symptom: V1 agreement changed the group state and queued a report before the employee answer was prepared; a later answer failure left the confirmation and report without its committed turn.
- Expected: The state transition, answer, and report intent commit together, with the Redis report job queued only after commit.
- Root cause layer: architecture
- Harness fix: Prepare the V1 decision without mutation, apply it in the turn transaction, and use a group-state-scoped immutable report intent and stable job ID.
- Regression check: Run the V1 pre-response branch tests and migrated PostgreSQL/Redis rollback, enqueue-failure, and committed-resume fixture.
- Status: fixed

## 2026-09-29: Safety repository contract broke an archived fixture

- Symptom: The full harness failed typecheck because the historical MAF test fixture lacked the new source-idempotent risk write method.
- Expected: Active TypeScript safety writes require source idempotency while the retired runtime remains untouched.
- Root cause layer: architecture
- Harness fix: Keep the legacy repository contract and define a narrower extended contract required by the active orchestrator and worker adapter.
- Regression check: Run `pnpm --filter @entalent/application typecheck` and the full harness after changing a shared safety port.
- Status: fixed

## 2026-09-29: Profile outcome SQL failed on the real database

- Symptom: The migrated-PostgreSQL profile recovery fixture failed while recording `profileHydration` metadata: first a cast bound to the JSON key, then an untyped parameter in `jsonb_build_object`.
- Expected: Profile facts, outcome metadata, and the committed completion receipt save in one transaction.
- Root cause layer: verification
- Harness fix: Parenthesize the extracted attempt-count value before casting, cast JSON-building parameters to text, and retain a real-schema transaction regression that checks rollback and one successful outcome.
- Regression check: Run `DATABASE_URL=<isolated local URL> REDIS_URL=<isolated local DB 15 URL> V2_CONVERSATION_QUEUE_TEST=1 pnpm --filter @entalent/worker exec vitest run src/profile/user-profile.repository.integration.test.ts`.
- Status: fixed

## 2026-09-29: Style recovery fixture failed TypeScript checking

- Symptom: The first migrated-PostgreSQL style fixture passed at runtime but failed worker typecheck because a mutable cleanup tenant ID was inferred as possibly undefined inside an insert mapping callback.
- Expected: Both runtime and static checks accept a fixture scoped to one created tenant.
- Root cause layer: verification
- Harness fix: Narrow the mapped tenant value at the insert site and retain the worker typecheck in the full gate.
- Regression check: Run `pnpm --filter @entalent/worker typecheck` with the style recovery fixture included.
- Status: fixed

## 2026-09-29: Late style recovery overwrote a newer observation

- Symptom: A migrated PostgreSQL regression completed a newer style intent before an older one; the late older job changed the profile again and incremented its analysis count.
- Expected: A completed newer source remains authoritative, and each accepted observation merges with the current profile inside a serialized transaction.
- Root cause layer: architecture
- Harness fix: Serialize committed style writes by tenant and user, apply the style update to the profile read inside that transaction, and mark an older intent complete without applying it when a newer source already completed. The fixture also records required outbound source metadata and updates an intent's queue timestamp only after creation.
- Regression check: Run `DATABASE_URL=<isolated local URL> REDIS_URL=<isolated local DB 15 URL> V2_CONVERSATION_QUEUE_TEST=1 pnpm --filter @entalent/worker exec vitest run src/style/repositories/style-profile.repository.integration.test.ts` after rebuilding `@entalent/application`.
- Status: fixed

## 2026-09-29: Retention cleanup bound Date objects to raw SQL

- Symptom: A migrated-PostgreSQL V2 retention fixture failed before cleanup because postgres.js received a JavaScript Date as an untyped raw SQL parameter.
- Expected: The active tenant policy applies its cutoffs to durable stores, including private V2 working text and Bundles.
- Root cause layer: verification
- Harness fix: Bind ISO instants with explicit timestamptz casts in every raw retention query and retain the migrated-PostgreSQL tenant-scope, age, and repeat-run fixture.
- Regression check: Run `DATABASE_URL=<isolated local URL> pnpm --filter @entalent/worker exec vitest run src/retention/retention.repository.v2.integration.test.ts src/retention/retention.repository.test.ts`.
- Status: fixed

## 2026-09-29: Risk-source guard blocked retention provenance clearing

- Symptom: The migrated-PostgreSQL retention fixture failed with `risk_signal_source_scope_mismatch` when cleanup tried to clear expired risk-signal evidence IDs.
- Expected: Tenant retention expires private risk content without violating the immutable source and ownership constraints.
- Root cause layer: architecture
- Harness fix: Keep the guarded source IDs for now, clear the recommended action, and require an explicit forward schema and policy decision before removing risk provenance.
- Regression check: Run the migrated-PostgreSQL retention fixture and assert expired risk signals retain source IDs while their recommended action is cleared.
- Status: open

## 2026-09-29: Delayed memory extraction read later employee turns

- Symptom: A source-scoped memory job used the conversation's latest 20 messages, so a delayed worker could pass a later private disclosure to the model and attach its meaning to the older source.
- Expected: The extractor sees only messages through the committed inbound and its own outbound reply.
- Root cause layer: architecture
- Harness fix: Read source-bounded history, fetch the scoped outbound separately, and reject a reply linked to another inbound before any model call.
- Regression check: Run `pnpm --filter @entalent/application exec vitest run src/use-cases/memory-extraction.use-case.test.ts` and assert the late-turn and mismatched-source cases.
- Status: fixed

## 2026-09-29: Completion guard erased report-intent scope in a later migration

- Symptom: The migrated-PostgreSQL turn-effect fixture rejected a valid `group_report` dispatch intent after migration `0045` with `conversation_dispatch_intent_scope_mismatch`.
- Expected: The completion receipt guard preserves the prior tenant/person/cohort report target validation from `0040`.
- Root cause layer: architecture and verification
- Harness fix: Add forward migration `0046` combining both guards, assert a valid report target and immutable completion receipt in the migrated fixture, and run active database integration tests for every changed SQL migration in `harness:check` with an explicit local database target.
- Regression check: Run `DATABASE_URL=<isolated local URL> pnpm --filter @entalent/database test:integration` and verify the harness selects that suite for a SQL migration.
- Status: fixed

## 2026-09-29: Conversation simulations missed committed style adapter

- Symptom: `terse-user` model gate stopped with `committed_style_repository_missing` before evaluating the coach.
- Expected: The simulation's in-memory adapters satisfy the same source-scoped style completion contract as the active worker.
- Root cause layer: verification
- Harness fix: Add source-bounded message history and an idempotent committed-style completion receipt to the simulation repositories; keep the production fail-closed contract.
- Regression check: Run `pnpm --filter @entalent/conversation-sim exec vitest run src/scenarios/terse-user.sim.test.ts` with model credentials and require the scenario report.
- Status: fixed

## 2026-09-29: Consultation simulation lacked an empty Pulse read adapter

- Symptom: `annna-intent-fidelity` model gate stopped at a Pulse capture question with `pulse_capture_repository_unavailable` before assessing intent fidelity.
- Expected: A consultation scenario with no captured Pulse evidence receives a scoped empty lookup result.
- Root cause layer: verification
- Harness fix: Supply empty Pulse and confirmation reads by default in the simulation harness, which has no survey state; keep explicit scenario survey repositories and the worker's missing-repository guard.
- Regression check: Run `pnpm --filter @entalent/conversation-sim exec vitest run src/scenarios/annna-intent-fidelity.sim.test.ts` with model credentials and require the scenario report.
- Status: fixed
- Follow-up: The scenario now reaches its report; its semantic assertions still fail, as in the 2026-09-08 gate.

## 2026-09-29: New simulation adapter test missed the Vitest include pattern

- Symptom: A focused `src/fakes/repositories.test.ts` run exited with no test files found.
- Expected: The small adapter regression executes under the conversation-sim package's configured Vitest pattern.
- Root cause layer: workflow
- Harness fix: Place the test under `src/scenarios/` with the `.sim.test.ts` suffix used by this package.
- Regression check: `pnpm --filter @entalent/conversation-sim exec vitest run src/scenarios/simulation-repositories.sim.test.ts` passes two tests.
- Status: fixed

## 2026-09-29: Annna model replay still infers an unstated testing motive

- Symptom: After the adapter repair, the exact Annna replay completed 15 turns but failed its semantic judge and correction acknowledgment assertion. The coach described Anna as checking whether it stayed inside the chat, although she had not stated that motive.
- Expected: A request about what the coach learned should list only stated conversation facts, and a correction should acknowledge the mistaken frame before answering.
- Root cause layer: architecture and verification
- Harness fix: Keep the exact transcript and hard assertions; compare this known preexisting failure against the 2026-09-08 gate before changing production prompts. Capture post-report assertions in the scenario artifact so `Deterministic checks all clear` cannot mask them.
- Regression check: Run the focused Annna scenario and inspect both the judge verdict and post-report Vitest assertions; the 2026-09-29 run remains failed.
- Status: open

## 2026-09-29: Memory-recall judge disagreed across identical one-run gates

- Symptom: The first PR #7 one-run model gate passed memory recall, while the second passed all hard assertions but its judge rejected a question about the source of Igor's nervousness as re-asking the already known Friday defense.
- Expected: The gate distinguishes an actual repeated question from a new uncertainty and gives a stable acceptance signal for unchanged code.
- Root cause layer: verification
- Harness fix: Preserve the judge rationale and transcript from both runs, then tighten the scenario criterion or add a deterministic check for exact repeated facts before relying on one judge sample as a regression verdict.
- Regression check: Compare `memory-recall` reports from the 2026-09-29 gate runs at `19-36-04` and `19-54-50` before attributing this failure to PR #7.
- Status: open

## 2026-09-29: PR #7 push and CI omitted integration targets

- Symptom: The first push pre-push harness lacked `DATABASE_URL`; after a local retry succeeded, GitHub's quality job failed with `database integration target required`.
- Expected: The required harness gate runs against a named, migrated PostgreSQL database and Redis in both local push and CI.
- Root cause layer: workflow and environment
- Harness fix: Pass isolated local database and Redis targets to the push hook; give the CI quality job PostgreSQL/Redis services, test environment variables, and a migration step before `harness:check`.
- Regression check: Re-run `pnpm harness:check -- --base 49f9845` locally with isolated targets and require both PR checks to pass on the amended head.
- Status: open

## 2026-09-29: Railway SSH and local restore verification used incompatible defaults

- Symptom: `railway ssh` stopped at host-key verification; local `pg_restore` could not read the production server's newer custom-format dump.
- Expected: A verified SSH host key allows internal preflight, and backup validation uses a compatible PostgreSQL client.
- Root cause layer: environment and tooling
- Harness fix: Use a dedicated known-hosts file for direct Railway SSH and validate the restricted backup with `pg_restore` on the production PostgreSQL image.
- Regression check: Require internal `SELECT 1`/Redis `PING` and a successful remote `pg_restore -l` before migration.
- Status: fixed
