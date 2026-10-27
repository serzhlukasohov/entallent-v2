---
title: 'Story 14.3: Weekly L2 Workflow and the First L2 Baseline'
type: 'feature'
created: '2026-10-26'
status: 'done'
baseline_revision: '9ea29b2a7855e193f3068344901b03488859725c'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-14-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-14-2-l2-application-executor-with-isolation-and-reply-attribution.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** L2 can only be run by hand (`run-live.ts run --level L2`). There is no CI job that builds a disposable stack and runs it. `ci --level L2` is refused. The worker has no way to switch off proactive scheduling, so the `l2.workerEnv` the executor must require does not exist. And on a real stack every L2 case would fail at isolation: `POST /dev/reset-user` answers 404 for a dev-only user that has no `people` row.

**Approach:**
- Add the worker env toggle `PROACTIVE_SCAN_ENABLED` and record it as `suite.config.json` `l2.workerEnv`. The L2 path refuses to start without it.
- Wire `ci --level L2` through `run-live.ts` with `--live-app`.
- Add the opt-in weekly `.github/workflows/conversation-suite-l2.yml`. It starts Postgres/Redis services, migrates and seeds, starts api and worker from the checkout, then runs `ci --level L2 --runs 3 --include-unbaselined`.
- Show L2 journey results in the CI summary.
- Prove offline that an n = 3 L2 run can be accepted as `baselines/<suite>/L2.json` and diffed.

**User decisions (2026-10-25/26, recorded as intent):**
- QA suite `p-v1` (12.4) is out of scope and empty. Smoke scenarios come later in `smoke-v1`, and no L1 or L2 baseline exists.
- Scheduled simulations are opt-in, and model egress is a human boundary (AGENTS.md). So "the first L2 baseline is committed" is replaced by: everything needed to produce and accept it is built and proven offline. A human produces the first real L2 baseline later, once `smoke-v1` has L2 journeys. No baseline is committed.
- The workflow is inert unless a repository variable enables it. It uses only secret names existing workflows already reference and adds no secret. It never receives secrets on fork PRs. It targets only a disposable localhost stack built inside the job (`NODE_ENV` not production, proactive scheduling off).
- Nothing in this story runs a live model or a real stack locally. The YAML is validated by parsing, and the scripts it calls are tested.

**Planning decisions:**
1. **Variable.** A dedicated `CONVERSATION_SUITE_L2_ENABLED` gates both `schedule` and `workflow_dispatch`, because L2 cost and risk differ from L1. Enabling nightly L1 must not enable L2.
2. **Toggle.** `PROACTIVE_SCAN_ENABLED` (default `true`; `false`/`0` disables) is a product change in `packages/config` and `apps/worker`, required by the AC because no env disables the scan today. When disabled, the worker does not register the repeatable `scan` job, and it ignores any `scan` job it receives (a stale repeatable in a reused Redis). It still processes `onboarding-only` jobs (explicit dev triggers). `question-cutoff` (5-minute survey cutoff) is not proactive scheduling and stays on. Its sends carry their own trace and are filed `unsolicited` (documented).
3. **`l2.workerEnv`** is a map `{ "PROACTIVE_SCAN_ENABLED": "false" }`, the env the stack's worker must be started with. The workflow derives the worker's env from it (single source).
4. **reset-user 404.** `OnboardingRestartService.restart` throws NotFound when no `people` row exists, which is always the case for a `find-conversation` dev user. The deep reset has already committed in its own statement by then. So the executor treats `resetUser` HTTP 404 as success. The persona was just created by `find-conversation`, so a missing user is impossible. The following `find-conversation` plus the empty-conversation check remain the isolation guard. `apps/api` stays unchanged, and a dev-controller fix is recorded as deferred.
5. **Artifacts.** `runs/suites/**` (reports plus `case-runs.json`, consistent with 13.7) plus the stack logs, 14 days.
6. **Budgets.** Only the judge budget applies at L2. Coach calls run in the stack's worker (14.2).

## Boundaries & Constraints

**Always:**

- **Workflow** `.github/workflows/conversation-suite-l2.yml`, `name: Conversation suite L2`:
  - `on:` only `schedule` (weekly, `'41 4 * * 1'`) and `workflow_dispatch` with no inputs. No `pull_request`, `pull_request_target` or `push`.
  - `permissions: contents: read` and `concurrency: { group: conversation-suite-l2, cancel-in-progress: false }`.
  - One job, `suite-l2` (`name: Suite L2 weekly run`, `if: vars.CONVERSATION_SUITE_L2_ENABLED == 'true'`, `runs-on: ubuntu-latest`, `timeout-minutes: 240`).
  - Services are copied from `ci.yml`: `pgvector/pgvector:pg16` and `redis:7-alpine` with the same health options.
  - Job env (literal, no secrets):
    - `DATABASE_URL: postgresql://postgres:postgres@localhost:5432/entalent_test`
    - `REDIS_URL: redis://localhost:6379`
    - `FIELD_ENCRYPTION_KEY` (the `ci.yml` all-zero literal)
    - `NODE_ENV: test`
    - `API_PORT: '3000'`
    - `WORKER_PORT: '3001'`
  - Steps, in order:
    1. Checkout (`fetch-depth: 0`, `persist-credentials: false`).
    2. pnpm.
    3. Node `'24'` with pnpm cache.
    4. `pnpm install --frozen-lockfile`.
    5. `pnpm turbo run build --filter=@entalent/api... --filter=@entalent/worker... --filter=@entalent/conversation-sim^...`.
    6. `Check L2 credentials`: the 13.7 `l1-gate.ts credentials` step, with presence booleans for the five names. It fails closed with `::error::`.
    7. Create `packages/conversation-sim/runs/l2-stack/`.
    8. Apply migrations (the same root command `ci.yml` uses) and seed, with the seed output to `runs/l2-stack/seed.log`. Then `l2-stack.ts tenant-from-seed` writes `tenant_id` to `$GITHUB_OUTPUT` (step `id: tenant`).
    9. Generate the admin key: `openssl rand -hex 32`, `::add-mask::`, and append `ADMIN_API_KEY` to `$GITHUB_ENV`.
    10. Start the api: `nohup pnpm --filter @entalent/api start > …/api.log 2>&1 &`, with `OPENAI_API_KEY: sk-test-placeholder` (the API calls no model) and no secrets.
    11. Start the worker. `l2-stack.ts worker-env --output "$RUNNER_TEMP/l2-worker.env"` writes the env file, which is sourced with `set -a`. Then `nohup pnpm --filter @entalent/worker start > …/worker.log 2>&1 &`, with the five secrets plus `OPENAI_MODEL_BALANCED: ${{ secrets.AZURE_OPENAI_TESTING_DEPLOYMENT }}`.
    12. Wait for health: `curl -fsS --retry 90 --retry-delay 2 --retry-all-errors` on the api `/api/v1/health/ready` and on the worker's ready route.
    13. The run step, in `packages/conversation-sim`: `node --import tsx src/suite/run-live.ts ci --level L2 --runs 3 --include-unbaselined --live-model --live-app --summary "$GITHUB_STEP_SUMMARY"`. Its env is `SUITE_L2_API_BASE: http://127.0.0.1:3000`, `SUITE_L2_TENANT_ID: ${{ steps.tenant.outputs.tenant_id }}`, the five secrets and `LANGWATCH_API_KEY: ''`. A single command, so it exits with the ci code.
    14. Upload with `if: always()`: `packages/conversation-sim/runs/suites/**` and `packages/conversation-sim/runs/l2-stack/*.log`, name `suite-l2-weekly-${{ github.run_id }}-${{ github.run_attempt }}`, `if-no-files-found: ignore`, `retention-days: 14`.
    15. Link the artifact URL in the step summary.
  - Only steps 11 and 13 carry secret values. `--live-model` and `--live-app` appear only in step 13.
- **`l2-stack.ts`** (new, `packages/conversation-sim/src/suite/`; no DB or network access):
  - `tenant-from-seed <log>`: prints the single UUID from the seed's `Tenant ID: <uuid>` line. It exits 1 naming the problem when there is none, more than one, or a non-UUID.
  - `worker-env --output <file>`: writes `KEY=VALUE` lines from `suite.config.json` `l2.workerEnv`. It exits 1 when `l2.workerEnv` is absent.
  - It never prints secret values.
- **Config.** `SuiteConfigSchema` gains optional strict `l2: { workerEnv: record<^[A-Z][A-Z0-9_]*$, ^[A-Za-z0-9._:/-]+$> with ≥ 1 key }`. `suite.config.json` sets `"l2": { "workerEnv": { "PROACTIVE_SCAN_ENABLED": "false" } }`.
- **Refusal.** The `L2ApplicationExecutor` options gain a required `workerEnv`, and the constructor throws when it is missing or empty. `run-live.ts` at L2 (run and ci) loads `suite.config.json` and exits 1 with `[suite] run:live --level L2 refuses: suite.config.json l2.workerEnv is absent (...)` before building anything. It passes `l2.workerEnv` to the executor.
- **`cli.ts` ci at L2** behaves like L1:
  - It needs an injected run judge, so the default entry refuses with `unsupportedLevel('L2')`.
  - It skips `no L2 tests` and handles `missing-baseline` / `--include-unbaselined` the same way.
  - `--runs` defaults to `diff.minSamples.L2`.
  - L0 and L1 output stays byte-identical.
  - `run-live.ts` accepts `ci --level L2` only with `--live-app`.
- **`report.ts` `renderCiSummary`**, at `level === 'L2'` only: after the `Layers: n/a (journeys only)` line, a `**Journey results:**` line with counts per status from `report.journeys.counts`, and a `| Key | Status |` table of journey keys. No reasons, evidence or text. L0 and L1 summaries are unchanged.
- **Worker:**
  - `packages/config/src/env.ts`: `PROACTIVE_SCAN_ENABLED`, following the `QUIET_HOURS_ENABLED` pattern.
  - `apps/worker/src/proactive/proactive-scan.processor.ts`: when disabled, skip the registration and log `Proactive scan disabled (PROACTIVE_SCAN_ENABLED=false)`; in `process()`, return early on non-`onboarding-only` jobs.
- **Executor reset:** `resetUser` `DevApiError` with status 404 is tolerated, with a comment explaining why. Any other status still fails `dev-api:resetUser`.
- **Docs:**
  - `packages/conversation-sim/README.md` gains `### Weekly L2 run`, covering:
    - the variable and how to enable it;
    - the secrets;
    - the `l2.workerEnv` name;
    - the stack built in the job;
    - artifacts;
    - budgets (judge only);
    - fixtures `pulseCycle`/`disclosureDelivered` unsatisfiable on a deep-reset persona, which L2 journeys must avoid for now;
    - onboarding/reset findings and cutoff sends as `unsolicited`;
    - first-baseline human steps.
  - Update the L2 executor section and HELP/doc comments.

**Never:**
- No change to other workflows, `packages/application`, `apps/api`, `agent-service` or MAF paths, budgets, diff semantics or the default-entry L1/L2 refusals.
- No committed `baselines/**`, no `smoke-v1`/`p-v1` case, no new secret, no secret value in output, no live model or real stack run, and no local migration run.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Empty suites | fake `ci --level L2 --runs 3 --include-unbaselined` via run-live deps | both skipped `no L2 tests`, nothing-to-check line, exit 0 | none |
| Unbaselined L2 | suite with an L2 journey, no merge-base L2.json, fake transport | runs n = 3, diff `no baseline`, summary has journey results, exit 0 | none |
| Accept + diff | that run report, then `baseline:accept`, then ci again | `baselines/<suite>/L2.json` written in temp dir; second ci diffs journeys | n = 2 refused by accept |
| Default entry | `main(['ci','--level','L2'])` | exit 1, L2 live-app refusal message | refusal |
| No live-app | run-live `ci --level L2 --live-model` | exit 1 before building | refusal |
| No workerEnv | run-live L2 with config lacking `l2` | exit 1 naming `l2.workerEnv`; executor ctor without workerEnv throws | refusal |
| Reset 404 | fake reset-user answers 404 | isolation continues; empty check decides | 500 still `dev-api:resetUser` |
| Seed log | one / zero / two `Tenant ID:` lines | prints UUID / exit 1 / exit 1 | names problem only |
| Worker toggle | `PROACTIVE_SCAN_ENABLED=false` | no repeatable registered; `scan` job ignored; `onboarding-only` runs | none |

</intent-contract>

## Code Map

- `packages/conversation-sim/src/suite/cli.ts`:
  - `ciCommand` (~521): the L2 throw at :524, the L1 judge check at :525, `runs` at :530.
  - `ciLevelSkip` (:665), `nothingToCheckText` (:631), `ciSamplesLines`, `unsupportedLevel` (:916).
  - HELP (~110-155) and header doc (~43-60).
- `packages/conversation-sim/src/suite/run-live.ts`: L2 `ci` refusal (~93), `createExecutor` (~110). Add the config load via `loadSuiteConfig(join(cliDeps.packageDir, 'suite.config.json'))` from `./config`.
- `packages/conversation-sim/src/suite/executors/l2-application-executor.ts`: constructor options; `isolate()` (:292), where `resetUser` is at :295.
- `packages/conversation-sim/src/suite/executors/dev-api-client.ts:121`: `DevApiError.status`.
- `packages/conversation-sim/src/suite/schema.ts:940`: `SuiteConfigSchema` (strict). Add `l2` as optional.
- `packages/conversation-sim/src/suite/report.ts:280`: `renderCiSummary`. Journey results come from `report.journeys` (`JourneySectionSchema`: `keys`, `counts`) and `report.results[key].status`.
- `packages/conversation-sim/src/suite/baseline.ts:46`: `baselineRefusals` (minSamples per level; journeys count as in-scope test criteria). Read-only.
- `packages/conversation-sim/src/suite/l1-gate.ts`: the `credentials` command, reused unchanged by the L2 workflow.
- `packages/conversation-sim/src/suite/conversation-sim-workflow.test.ts`: the indent-based `block`/`items` helpers and the secret-allowlist pattern to copy.
- Tests to extend:
  - `cli.test.ts` `describe('suite:ci')`, using `ciHarness` and the 13.7 L1 fake judge/executor cases.
  - `run-live.test.ts`, `l2-application-executor.test.ts`, `report.test.ts`, `schema.test.ts`/`config.test.ts`, `executors/import-graph.test.ts` (`l2-stack.ts` reaches no executor).
- Product facts (read-only):
  - `apps/api/src/dev/dev-simulate.controller.ts:693` `resetUser` runs `resetService.resetUser` and then `onboardingRestart.restart` (`apps/api/src/onboarding/onboarding-restart.service.ts:27`, NotFound without a `people` row; the intro is queued only when `unitId` is set).
  - `packages/database/src/seed.ts:98` prints `Tenant ID: <uuid>`. The seed is not idempotent; every run creates a new tenant.
  - Dev routes mount whenever `NODE_ENV !== 'production'`. `ApiKeyGuard` requires `X-Api-Key` when `ADMIN_API_KEY` is set.
  - `apps/worker/src/message-send/message-send.processor.ts:106` skips Slack for channel `dev`.
  - Both apps use `start = node dist/main.js` and validate `DATABASE_URL`, `REDIS_URL`, `FIELD_ENCRYPTION_KEY`, and `OPENAI_API_KEY` or the full Azure trio.
  - The api has no model code.
  - The worker ready route is in the worker health controller; verify its exact path.
- `apps/worker/src/proactive/proactive-scan.processor.ts:37` `onModuleInit` and `process`. Tests in `proactive-scan.processor.test.ts`.
- `packages/config/src/env.ts:57-64`: proactive knobs and the `QUIET_HOURS_ENABLED` pattern.
- `.github/workflows/ci.yml`: the service blocks, the migrate command and the env literals to copy.

## Tasks & Acceptance

**Execution:**
- `packages/config/src/env.ts`, `apps/worker/src/proactive/proactive-scan.processor.ts` (+ test): the `PROACTIVE_SCAN_ENABLED` toggle (worker toggle row).
- `packages/conversation-sim/src/suite/schema.ts`, `suite.config.json`: the `l2.workerEnv` config.
- `packages/conversation-sim/src/suite/executors/l2-application-executor.ts` (+ test): the `workerEnv` requirement and reset-404 tolerance.
- `packages/conversation-sim/src/suite/run-live.ts` (+ test): the L2 ci path, the workerEnv refusal and passing it through.
- `packages/conversation-sim/src/suite/cli.ts` (+ `cli.test.ts`): ci at L2. Cover the empty, unbaselined, accept-then-diff (n = 3 accepted, n = 2 refused) and default-entry rows using temp dirs and a fake transport executor.
- `packages/conversation-sim/src/suite/report.ts` (+ test): the L2 journey results in the CI summary.
- `packages/conversation-sim/src/suite/l2-stack.ts` (+ `l2-stack.test.ts`): `tenant-from-seed` and `worker-env`.
- `.github/workflows/conversation-suite-l2.yml`: the workflow per Boundaries.
- `packages/conversation-sim/src/suite/conversation-suite-l2-workflow.test.ts`:
  - triggers and absent PR triggers;
  - the variable gate;
  - services;
  - step order;
  - the worker env sourced from `l2-stack.ts worker-env`;
  - the run command;
  - the secret allowlist (literal five);
  - secrets only in the worker and run steps;
  - the upload paths and retention;
  - `NODE_ENV: test`;
  - only `127.0.0.1`/`localhost` URLs.
- `packages/conversation-sim/README.md` and `docs/agent-task-log.md`.

**Acceptance Criteria:**
- Given the package tests, `pnpm --filter @entalent/conversation-sim test`, `typecheck` and `lint` pass offline. The worker proactive test, `pnpm --filter @entalent/config build` and the `@entalent/worker` focused test, and root `pnpm typecheck` also pass.
- Given the workflow file, when parsed as YAML, then it has exactly the job `suite-l2`, the triggers `schedule` and `workflow_dispatch`, and the job `if` on `CONVERSATION_SUITE_L2_ENABLED`.
- Given `pnpm suite:ci --level L0`, its output is unchanged.
- Given the diff, nothing changed outside `packages/conversation-sim/`, `packages/config/src/env.ts`, `apps/worker/src/proactive/`, the new workflow, `docs/agent-task-log.md` and BMad artifacts.

## Spec Change Log

## Review Triage Log

### 2026-10-26 — Review pass
- verdicts: 32 findings — high 0, medium 1, low 17, false 8, maybe-false 6
- findings:
  - `[low]` `[reject]` (blind) `workerEnv` is required but never compared with the running worker's env. The AC asks for a refusal when `l2.workerEnv` is absent, and the README says outright that the suite cannot see the worker's env. A runtime check would need a new product read surface, which is more than a direct fix. A manual run against a hand-started worker is the only exposure.
  - `[low]` `[reject]` (blind) No provenance of `workerEnv` or the worker's coach model in reports or baselines. `models.coach: null` at L2 is 14.2's planning decision 3. Adding a report field changes the report schema for a cosmetic audit trail.
  - `[low]` `[reject]` (blind) A disabled toggle leaves a stale repeatable `scan` in a reused Redis. It is ignored and logged once an hour. The CI Redis is disposable. Removing it requires a BullMQ repeatable-removal API call plus a test, which is not a direct correction.
  - `[low]` `[patch]` (blind) The toggle also stops onboarding dispatch, the reminder sweep and role reconcile, which are part of the scan. Patched: the env.ts comment and the README now state this, and that `onboarding-only` jobs still run.
  - `[low]` `[reject]` (blind) Typos such as `FALSE` or `off` leave the scan on. The parser copies the spec-mandated `QUIET_HOURS_ENABLED` pattern, and the L2 value is written from `suite.config.json` by `l2-stack.ts`, never typed. Changing the parser means editing the spec.
  - `[false]` `[reject]` (blind) The reset-user 404 should be fixed in the API, and every 404 is swallowed. This is intent planning decision 4 (apps/api unchanged), so the fix would edit the spec. A missing route is caught earlier: `find-conversation` on the same router would already 404 and fail.
  - `[false]` `[reject]` (blind) The workflow has never run. The user decided there is no real stack or model run, and the gap is recorded under Residual risks.
  - `[low]` `[patch]` (blind) `tenant-from-seed` depends on the seed's console text. Patched: a producer pin test reads `seed.ts` and parses its rendered `Tenant ID:` line.
  - `[low]` `[reject]` (blind) The YAML parse is not automated. The package has no YAML dependency (13.7 used the same approach), and adding one for a check already made by the verification command is not worth it.
  - `[maybe-false]` `[reject]` (blind) A crashed api or worker is undetected mid-run. To settle it, check whether the cases then fail as infrastructure errors naming the dev API operation: `DevApiError` maps to `dev-api:<op>`, and the logs are uploaded `always()`. If true, it is only low.
  - `[maybe-false]` `[reject]` (blind) The 240-minute timeout has no basis. Settling it needs real L2 suite sizes, and none exist. If true, it is only low, because the upload runs `always()`.
  - `[false]` `[reject]` (blind) The spec is not in the reviewed diff. That is deliberate, per the review protocol: the claims file goes to the edge-case layer only.
  - `[low]` `[reject]` (blind) The L2 journey table has no size cap against the 1 MiB summary limit. It has one row per journey criterion key, not per sample, so it is unlikely to be met.
  - `[low]` `[patch]` (blind) A doubled blank line in `cli.test.ts`. Patched: removed.
  - `[low]` `[reject]` (edge) Case-insensitive parsing of `PROACTIVE_SCAN_ENABLED`. Same as the blind typo row.
  - `[low]` `[reject]` (edge) The `l2.workerEnv` schema does not require that the scan is disabled. The AC is "refuses when absent", the committed config disables it, and an extra domain refine adds a guard for a misconfiguration nobody has shown.
  - `[low]` `[reject]` (edge) The executor accepts a non-empty `workerEnv` that does not disable the scan. Same as the previous row.
  - `[false]` `[reject]` (edge) A 404 from `UserResetService` (user not found) is treated as a completed reset. `userId` and `tenantId` come from `find-conversation` on the same client and tenant a moment earlier, so the user exists. A just-created user also has no state, and the empty check follows.
  - `[low]` `[patch]` (edge) With the toggle off, `POST /dev/simulate-proactive-scan` enqueues a scan that is silently dropped. This happens only on a stack started with the toggle off. Patched: documented in the env.ts comment and the README.
  - `[low]` `[reject]` (edge) A stale repeatable in a reused Redis. Same as the blind row.
  - `[false]` `[reject]` (edge, claim) "A missing user is impossible". Same refutation as the 404 row above.
  - `[medium]` `[patch]` (verification-gap) `PROACTIVE_SCAN_ENABLED` parsing and its default are untested, so a regression could silently stop production check-ins. Patched: worker tests call `validateEnv`, covering absent -> true, `'false'` -> false and `'0'` -> false.
  - `[low]` `[patch]` (verification-gap) The seed-log contract is checked only against a hand-written fixture. Grouped with the blind seed row and patched with the producer pin test.
  - `[low]` `[patch]` (verification-gap other) The dev scan trigger is a silent no-op while the toggle is off. Grouped with the edge row and documented.
  - `[false]` `[reject]` (verification-gap other) The comment saying the seed is not idempotent contradicts `seed.ts`. The insert uses a random default id, so `onConflictDoNothing` on the primary key never conflicts and every run creates a new tenant. The "already exists" branch is dead.
  - `[maybe-false]` `[reject]` (intent a) It runs `ci` over every suite instead of literal `suite:run --suite p-v1`. The intent allowed wiring `ci`. `p-v1` is in the loop, which is the same aggregate 13.6 and 13.7 used. If anything is off, it is only low.
  - `[maybe-false]` `[reject]` (intent b/c) "Proactive scheduling disabled" and the refusal are verified at the config and unit level, not on a running worker. A real stack run is excluded by the user. The worker parsing gap is patched (row above).
  - `[maybe-false]` `[reject]` (intent d) The seed and health wiring are only string-checked. A real run is excluded. The seed producer pin was added, and the worker ready route was confirmed in `apps/worker/src/health/health.controller.ts`.
  - `[false]` `[reject]` (intent e) The real artifact-to-accept path is untested. The intent replaced the committed baseline with an offline proof: accept n = 3 and diff, plus refuse n = 2, all on fakes. The human steps are in the README.
  - `[false]` `[reject]` (intent f) That the workflow passes `--summary` is only string-tested. The workflow cannot run before push (user decision), and the summary rendering is tested.
  - `[low]` `[patch]` (intent g) 13.7's hash-pin pattern was not copied. Patched: a sha256 pin of the workflow's `on:`, `permissions:` and job `if:` surface, with a refresh comment.
  - `[maybe-false]` `[reject]` (intent h) Scope additions: the reset-404 tolerance, the worker/config toggle and the `FakeStack` fixture move. These are intent planning decisions 2 and 4, and the AC requires the toggle because no env existed. The fixture move is test-only. If anything is off, it is only low.

## Design Notes

The workflow reuses `ci` rather than separate `suite:run` and `suite:diff` calls, so L2 inherits per-suite looping (`p-v1` and `smoke-v1`), skipping, exit precedence (2 > 3 > 4 > 1) and the summary. That is the same choice 13.6 and 13.7 made for the literal per-suite AC. Today both suites have no L2 tests, so an enabled run builds the stack and passes with nothing to check. This doubles as a smoke test of the stack boot.

## Verification

**Commands:**
- `pnpm --filter @entalent/conversation-sim test`, `typecheck`, `lint`. Expected: pass.
- `pnpm --filter @entalent/config build && pnpm --filter @entalent/worker exec vitest run src/proactive/proactive-scan.processor.test.ts`. Expected: pass.
- `python3 -c "import yaml; d=yaml.safe_load(open('.github/workflows/conversation-suite-l2.yml')); print(list(d['jobs']), list(d[True]))"`. Expected: `['suite-l2'] ['schedule', 'workflow_dispatch']`.
- `pnpm suite:ci --level L0`. Expected: exit 0, unchanged.
- `pnpm typecheck`, then `pnpm harness:check -- --base 3af7d0ed02bbe34e7178f4be8755f56f373162c5`. Expected: pass; report the receipt path.

## Auto Run Result

Status: done

**Summary:** An opt-in weekly L2 workflow and an offline-proven L2 baseline path.

- **Workflow.** `.github/workflows/conversation-suite-l2.yml` runs on a weekly schedule (`41 4 * * 1`) and on `workflow_dispatch`, only when `vars.CONVERSATION_SUITE_L2_ENABLED == 'true'`. It has no PR or push trigger.
  - It builds a disposable stack inside the job: Postgres and Redis services, migrations, seed, the tenant read from the seed log, and a masked per-run `ADMIN_API_KEY`.
  - It starts the api with `NODE_ENV=test` and a placeholder model key, and the worker with env from `suite.config.json` `l2.workerEnv` (`PROACTIVE_SCAN_ENABLED=false`).
  - It waits for both ready routes, then runs `run-live.ts ci --level L2 --runs 3 --include-unbaselined --live-model --live-app --summary`.
  - It uploads `runs/suites/**` and the stack logs for 14 days.
  - It uses the five existing secret names only, passed to the worker step and the run step only.
- **Worker toggle.** `PROACTIVE_SCAN_ENABLED` is new in `packages/config`. The worker skips registering the scan and ignores every `scan` job when it is set to false.
- **Refusal.** The L2 executor and `run-live.ts` refuse to start without `l2.workerEnv`.
- **`ci --level L2`** is wired like L1. The default entry still refuses it.
- **CI summary.** At L2 it lists journey results.
- **reset-user 404.** The executor treats a 404 from reset-user as a completed reset. That 404 comes from the onboarding restart for a dev user without a `people` row.
- **Baseline acceptance** is proven offline: an n = 3 run is accepted into `baselines/<suite>/L2.json` in a temp dir and diffed, and n = 2 is refused. No baseline is committed.

**Files changed:**
- `.github/workflows/conversation-suite-l2.yml` (new): the weekly L2 job.
- `packages/config/src/env.ts`: the `PROACTIVE_SCAN_ENABLED` toggle.
- `apps/worker/src/proactive/proactive-scan.processor.ts` and its test: the toggle, plus `validateEnv` parsing tests.
- `packages/conversation-sim/suite.config.json` and `src/suite/schema.ts`: `l2.workerEnv`.
- `src/suite/executors/l2-application-executor.ts`: the `workerEnv` requirement and the reset-404 tolerance.
- `src/suite/run-live.ts` and `src/suite/cli.ts`: the L2 `ci` path, the refusal, and the help/doc text.
- `src/suite/report.ts`: L2 journey results in the CI summary.
- `src/suite/l2-stack.ts` (new): `tenant-from-seed` and `worker-env`.
- Tests:
  - New: `conversation-suite-l2-workflow.test.ts` (structure, five-secret allowlist, sha256 pin of the opt-in surface) and `l2-stack.test.ts` (including a pin of the seed producer line).
  - Moved: the fake dev stack to `executors/__fixtures__/fake-dev-stack.ts`.
  - Updated: `cli`, `run-live`, executor, `report`, `config` and `import-graph` tests.
- `packages/conversation-sim/README.md`: the "Weekly L2 run" section and L2 executor updates.
- `docs/agent-task-log.md`: one row.

**Review:** 32 findings: high 0, medium 1, low 17, false 8, maybe-false 6.
- **Patched (7 rows):**
  - toggle parsing tests (medium)
  - toggle scope documented (also covers the dev scan trigger)
  - seed producer pin (two rows)
  - workflow opt-in sha256 pin
  - doubled blank line
- **Deferred:** none.
- **Rejected,** with reasons in the triage log:
  - The executor cannot see the worker's env, and there is no provenance field. Both would need a new product or report surface.
  - A stale repeatable in a reused Redis is ignored by the toggle; the CI Redis is disposable.
  - Typo-tolerant parsing and a "must disable" refine: the spec-mandated pattern; the value is tool-written.
  - Fixing the 404 in the API: planning decision 4.
  - The workflow has never run, and no YAML parse in CI: user decision; no YAML dependency.
  - Crash detection mid-run and the timeout basis: maybe-false, low.
  - The summary table size: unlikely.
  - The spec missing from the diff: deliberate.
  - Seed idempotency comment: false; it is accurate.
  - Intent divergences: these are the user's no-live-run boundary and recorded planning decisions.

**Follow-up review recommended:** false. One medium entry was patched (`validateEnv` parsing tests), and no high. Patched counts by entry verdict: medium 1, low 5.

**Verification:**
- `pnpm --filter @entalent/conversation-sim test`: 60 files, 1200 tests. `typecheck` and `lint` are clean.
- Worker `proactive-scan.processor.test.ts`: 14 tests.
- Root `pnpm typecheck`: 24/24.
- YAML parse: `['suite-l2'] ['schedule', 'workflow_dispatch']`.
- `pnpm suite:ci --level L0`: exit 0, unchanged.
- `pnpm harness:check -- --base 3af7d0ed02bbe34e7178f4be8755f56f373162c5`: passed, receipt `runs/harness/receipt-1792973976397-3a008c42.json`.

**Residual risks:**
- The workflow has never run on GitHub. Seed without `.env`, api and worker boot, and the ready routes are checked only structurally.
- The worker log is uploaded unmasked.
- The worker conversation path for a dev user with no `people` row is unverified.
- `question-cutoff` sends stay on; they are filed `unsolicited`.
- `pulseCycle` and `disclosureDelivered` cannot be satisfied at L2 (documented).
- Carried from 14.2: the dev-api zod schemas have not been checked against the real controllers.
- The onboarding-intro risk is largely settled by code reading: without a `people` row the intro is never queued.
