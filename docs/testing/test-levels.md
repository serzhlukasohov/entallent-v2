# Test levels

Which test to write for which problem, where it lives, and how to run it. Current as of 2026-11-03 (TypeScript-only runtime; MAF is retired).

## Levels

| Level | Checks | Written by | Lives in | Run | Model calls |
|---|---|---|---|---|---|
| Unit | domain and application logic, orchestrator decisions with a mocked `AiProviderPort`, adapters | developer | `*.test.ts` next to the code | `pnpm test`, or `pnpm --filter <package> test` | no |
| Integration | SQL, migrations, repositories, admin endpoints on real PostgreSQL | developer | `packages/database/src/__tests__/`, `apps/*/src/**/*.integration.test.ts` | `pnpm test:integration` (database package); app suites run inside `pnpm --filter <app> test` when `DATABASE_URL` is set, skipped otherwise | no |
| Offline sim | a full orchestrator turn from a precondition with scripted model output (`ScriptedAiProvider`): writes, queues, trace, report shape | developer | `packages/conversation-sim/src/**` (`*.test.ts`, offline `*.sim.test.ts` listed in the package `test` script) | `pnpm --filter @entalent/conversation-sim test` | no |
| Live scenario | reply quality over several turns: simulated user, real coach, judge, deterministic checks | developer | `packages/conversation-sim/src/scenarios/*.sim.test.ts` | `pnpm sim src/scenarios/<file>` | yes |
| QA test | one concrete behavior or bug: precondition, employee replies, plain-language expectations, hard checks | QA, no code | `packages/conversation-sim/qa-tests/*.json` | `pnpm --filter @entalent/conversation-sim sim -- src/scenarios/qa-tests.sim.test.ts -t <test id>` | yes |
| Release gate | stability of live scenarios: N runs per scenario with pass thresholds | developer | `packages/conversation-sim/gate.config.json` | `pnpm sim:gate` (`SIM_GATE_RUNS=1` for a local smoke) | yes |

`pnpm test`, `harness:check` and CI run only the first three levels. Everything that calls the model runs on explicit request (it costs tokens and is non-deterministic): before merging prompt or orchestration changes, and when QA asks.

## Choosing a level

- The bot made a wrong decision or wrote the wrong state (no question asked when it should, wrong memory, missing reminder, wrong queue job): **unit** for the decision, **offline sim** when it needs a full turn with real state.
- A query, migration or tenant scope is wrong: **integration**.
- The bot said the wrong thing in a specific situation: **QA test**. If the decision behind it is deterministic, add a unit or offline sim test for the fix as well.
- Overall conversation quality (tone, memory recall, safety) across many turns: **live scenario**, and add it to the **gate** when it guards a release.
- A bug found by a sim: turn it into a QA test or scenario first; the product fix is a separate change.

## State for sims and QA tests

Every sim and QA test can start from a **precondition** (history, memory, goals, style, onboarding, pulse cycle, scheduled actions, start time). Three ways to get one:

1. Write it by hand, mostly from presets (`onboarding-done`, `cycle-open`, `elapsed`): `packages/conversation-sim/report/README.md` (Preconditions).
2. Record it from replies: `pnpm sim:record <recording.json> --live --html`, review, `pnpm sim:approve <candidate dir>`. Approved files sit in `preconditions/recorded/`.
3. Extract it from a production trace (test tenants only): `pnpm trace:export -- --extract <trace row id>`, or give Claude a Slack screenshot (`qa-screenshot-to-test` skill).

QA path step by step: `docs/qa/qa-test-workflow.md`. QA file format: `packages/conversation-sim/qa-tests/README.md`.

## Reports

- `pnpm sim` writes a JSON suite report to `packages/conversation-sim/report/runs/sim-<time>.json`; `pnpm sim:report:html` renders the newest one (Given, steps with side-effect icons, expected vs actual).
- Each scenario also writes `packages/conversation-sim/runs/<scenario>.json` and `.md`.
- A production conversation renders the same way: `pnpm trace:export -- --conversation <id>`.

## Before a PR

- Run `pnpm harness:check -- --base <base>`; it picks the checks for the changed paths. It needs a fully migrated `DATABASE_URL` when migrations or database tests changed. A fresh local database (`create database <name>` + `pnpm --filter @entalent/database db:migrate`) avoids stale local history.
- For prompt or orchestration changes, also run the affected live scenarios or `SIM_GATE_RUNS=1 pnpm sim:gate`.
