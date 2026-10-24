# Brownfield — What Exists and What Is Missing

Baseline: `main` at `079f149`, 2026-10-17. Active runtime: TypeScript only.

## 1. Existing layers

| Layer | Location | What it gives the framework |
| --- | --- | --- |
| Live simulation driver | `packages/conversation-sim`, `@langwatch/scenario` ^0.4.15 | `run()` with scripted `user()` / `agent()` / `judge()` steps, `judgeAgent`, `userSimulatorAgent`; optional streaming to LangWatch cloud via `LANGWATCH_API_KEY` |
| Orchestrator harness | `src/harness/coach-harness.ts`, `coach-agent.ts` | Real `ConversationOrchestrator` and `OpenAiProvider` with in-memory conversation, memory, goal and style repositories; `InlineOutbox` runs extraction inline; options for timezone, seed memory, style profile, scheduled actions, survey repo, `questionConfirmationRepo` |
| Deterministic path | `src/fakes/scripted-ai.ts` | `ScriptedAiProvider` with `makeClassification` / `makeRisk`; used by `proactivity-reminders`, `crisis-self-harm`, `harassment`, `privacy-manager-request`, `planning-memory` |
| Rule checks | `src/harness/assertions.ts` | `findViolations`: reflective opener, too many questions, survey during crisis, crisis reply length, repeated question; `countQuestions` |
| Report | `src/harness/report.ts` | `ScenarioRunReport` schemaVersion 1: judge verdict, deterministic violations, per-turn mode/intent/risk/replyPlan, memory, style; Markdown and JSON per scenario under `runs/` |
| Gate | `src/gate/run-gate.ts`, `gate.config.json`, `failure-classifier.ts` | N samples per scenario file, hard vs judge pass thresholds per scenario, infra retry on transport errors, `manual_review_required` status, `summary.json` with git sha and models |
| CI | `.github/workflows/conversation-sim.yml`, `ci.yml` | Nightly 1-run and weekly 5-run gate, opt-in via `CONVERSATION_SIM_SCHEDULED_ENABLED`; `ci.yml` runs the deterministic harness gate |
| Application path | `apps/api/src/dev/dev-simulate.controller.ts` | `POST simulate-message`, `simulate-checkin`, `simulate-proactive-scan`, `simulate-proactive-cycle`, `force-checkin`, `reset-user`, `backfill-evidence`; `GET find-conversation`, `conversation/:id/messages?after=`, `user/:id/memory`, `user/:id/scheduled-actions`, `user/:id/survey-state`; `ApiKeyGuard`; development `AppModule` only |
| Dev chat | `scripts/chat.ts` | Reference client for the `/dev` path: post, poll outbound by `after`, 30 s timeout |
| Scheduler logic | `packages/application/src/use-cases/proactive-scheduler.use-case.ts`, `proactive-check-in.use-case.ts`, `utils/quiet-hours.ts` | Quiet-hours guard per user timezone (`DEFAULT_QUIET_HOURS` 22:00-08:00), check-in enqueue; cadence currently overridden to hourly in production for testing |
| Prior regression spec | `_bmad-output/specs/spec-maf-first-feature-regression-framework/` | Feature regression matrix and gate tiers; its MAF-primary premise is retired, the gate-tier idea (PR / feature / production-sensitive / release) carries over |

## 2. Closest existing scenario per suite case

| Suite case | Nearest scenario | Reuse |
| --- | --- | --- |
| P-10 | `answer-then-bundle.sim.test.ts` | Ready-bundle fixture, `answer_then_bundle` metadata assertion, judge rubric on the answer part |
| P-09 | `pulse-capture-exact-message.sim.test.ts`, `answer-then-bundle` | Bundle staging, byte-exact statement check |
| P-07 | none | Needs uncovered-topic fixture and probe-hint observation |
| P-08 | `annna-intent-fidelity.sim.test.ts` | Fidelity judge criteria (no added emotional weight) |
| P-06 | `proactivity-reminders.sim.test.ts`, `proactive-scheduler.test.ts` | Scheduler use case under test, scripted model |
| P-01..P-05 | `terse-user`, `memory-recall` | Harness options (timezone, seeded history) |

## 3. Gaps the spec closes

| Gap | Evidence | Capability |
| --- | --- | --- |
| No case format tied to Confluence IDs | Scenarios are hand-written `.sim.test.ts`; traceability lives in comments | CAP-1, CAP-10 |
| Results per scenario, not per criterion | `ScenarioRunReport.judge.metCriteria` is a flat list; gate thresholds are per scenario file | CAP-2, CAP-8 |
| No framework statuses | Only hard/judge pass booleans; no NOT TESTABLE / INVALID / ERROR split beyond `agent-turn-error` | CAP-2 |
| No baseline diff | `summary.json` per gate, no comparison between gates | CAP-8 |
| Judge uncalibrated | No labeled set; judge marked "noisier than the deterministic contract" in README | CAP-4 |
| No injectable clock | 7 direct `Date` uses in `conversation-orchestrator.ts`; `getLocalHour` reads `new Date()` | CAP-5 |
| No pulse-cycle fixtures | Harness takes `questionConfirmationRepo` and `surveyRepo` but no uncovered-topic or index-progress seed | CAP-6 |
| No application-level tests | `/dev` endpoints used only by `scripts/chat.ts` | CAP-7 |
| Scheduled live runs opt-in and per scenario | Workflow variable disabled; no PR trigger on prompt changes | CAP-9 |

## 4. Known product discrepancies the suite will expose

- Working hours 09:00-18:00 (suite) vs quiet hours 22:00-08:00 (code). P-06 criterion 3 fails under defaults. The suite's P-06 note already records bot messages sent at night in the test DM during the Safety & Trust run on 2026-10-02.
- Pulse cadence overridden to hourly in production since 2026-07-31 (test override); P-06 criterion 2 (48 hours) must be evaluated against configuration, not the override.
- Round-3 CAPs for topic steering (CAP-1), cause before closure (CAP-2) and completion statement (CAP-3) are open in `spec-gc-testing-2026-10-12`; P-07, P-08 and P-09 are their acceptance cases and are expected red until those land.
