# Review — Rubric Walker (good-spine checklist)

- Target: `ARCHITECTURE-SPINE.md` (Conversation Evaluation Regression Framework, draft 2026-10-17)
- Reviewer: rubric-walker
- Date: 2026-10-17
- Evidence base: spine, `SPEC.md`, `brownfield.md`, `case-mapping.md`, parent spine AD-2/9/10, `packages/conversation-sim` (README, `coach-harness.ts`, `run-gate.ts`, `gate.config.json`, `scenarios/config.ts`, `harness/assertions.ts`), `packages/application/src/ports/`, `use-cases/proactive-scheduler.use-case.ts`, `use-cases/proactive-check-in.use-case.ts`, `utils/quiet-hours.ts`, `apps/worker/src/proactive/proactive-scheduler.repository.ts`, `apps/api/src/dev/*`, `.github/workflows/ci.yml`, `conversation-sim.yml`, `pnpm-lock.yaml`.

## Gate verdict

**REVISE BEFORE EPICS** — the spine is well-shaped (one port, data boundary, verbatim statuses, additive artifacts) and ratifies the brownfield, but one critical and four high findings would let the L0/L2 executor stories and the CI story diverge or stall. All are fixable with amendments to AD-1, AD-3, AD-5, AD-10, AD-12, AD-14 and AD-15; no re-architecture is needed.

---

## Checklist verdicts

| # | Item | Verdict | Evidence summary |
| --- | --- | --- | --- |
| 1 | Fixes the real divergence points below; misses none | **Partial** | Case shape, executor port, evaluation boundary, status precedence, baseline keying and CI placement are fixed. Missed: where the 48-hour cadence decision lives (C-1), how L2 answers `stateQuery` (H-2), how preconditions/checkpoints/observation windows are declared (H-3). |
| 2 | Every Rule enforceable and prevents its divergence | **Partial** | AD-2, AD-3, AD-4, AD-6, AD-9, AD-11, AD-13, AD-16 are checkable. AD-5 ("business-time decisions") and AD-14 L0 ("would be read") are judgment calls without a mechanical check (H-4, M-2). AD-15 is enforceable but as written fails its own goal on GitHub (H-1). |
| 3 | Nothing under Deferred lets two units diverge now | **Pass with notes** | Profiles, suites, HTML export, Slack smoke are safely deferred (schema carries `runProfile`/`layer` as extensible literals). "L2 CI service topology" is inside one story. "Token budget caps" deferral leaves cost control undecided while AD-15 puts L1 on PRs (M-5). |
| 4 | Technology and versions plausible and consistent | **Pass** | Verified in `pnpm-lock.yaml` / `node_modules`: `@langwatch/scenario@0.4.15`, `ai@6.0.240(zod@3.25.76)`, `vitest@3.2.7` (sim) / `2.1.9` (others), `tsx@4.23.1`, `typescript@5.9.3`, Node 24 in `ci.yml` and `conversation-sim.yml`, `pnpm@9.12.0`. Note `zod@4.4.3` also resolves in the lock; pin `^3.25` in `conversation-sim` so `ai`'s peer stays on the already-resolved 3.25.76 (L-1). |
| 5 | Ratifies the brownfield | **Pass with notes** | Reuses `CoachHarness`, `ScriptedAiProvider`, `findViolations`, `failure-classifier`, `judgeModel()`, run-id format, `/dev` endpoints, `*.port.ts` naming in `packages/application/src/ports/`. Two inaccuracies: `judgeModel()` lives in `src/scenarios/config.ts` (not `harness/`), `report.ts` is `harness/report.ts` (not `report/`), so AD-12's import list omits a module the suite must import (L-2). AD-6 "phrase lists never in product code" contradicts the existing shared `hasReflectiveOpener` from `@entalent/ai-openai` that `assertions.ts` deliberately imports (M-6). |
| 6 | Covers CAP-1..CAP-11 via the map | **Pass** | Every CAP has a `Lives in` and `Governed by` row; each AD binds at least one CAP. CAP-7 success criterion ("P-09 dashboard criteria read from survey-state and the admin read model") is mapped but not satisfiable as specified (H-2). |
| 7 | No AD weakens parent AD-2, AD-9, AD-10 | **Pass** | AD-2: framework only observes; L2 goes through product `/dev` path. AD-10: rule statuses outrank judge, S decided first, meaning checks only when no rule failed (AD-9). Parent AD-9 is reinterpreted from "MAF canary" to "suite blocks merge on gated paths" — a legitimate extension, not a contradiction. C-1's fix must not move policy into test code (see fix options). |
| 8 | Every owned dimension decided/deferred/open | **Partial** | Data shapes (AD-1/3, gaps in H-3), state mutation (AD-2 inherited, AD-4 fixtures), ownership (AD-6/12), error handling (Conventions + AD-9), config (Conventions), CI envelope (AD-15), observability (AD-16, logging convention), L2 security (AD-14 host allowlist). Missing: cost control (M-5), baseline invalidation mechanics (M-3), L2 tenant/reset semantics (M-4). |
| 9 | [ASSUMPTION] decisions are real trade-offs with recoverable alternatives | **Pass with notes** | AD-1 (TS modules vs YAML/generator): alternative stated, Zod schema keeps it recoverable. AD-7 (per-criterion judge vs Scenario verdict): alternative stated. AD-8 (0.85 / 40): listed in Open Questions; simple agreement on a PASS-heavy label set inflates easily — add a kappa floor (L-3). AD-11 (committed baselines vs artifacts): in Open Questions, recoverable. AD-13 thresholds: stated; N=1 nightly case unhandled (M-1). |

---

## Findings

### Critical

#### C-1 — AD-5 / AD-14 / CAP-5: the 48-hour spacing and silence cadence for P-06 live in worker SQL, not in `ProactiveSchedulerUseCase`; L0 cannot test them "from the scheduler code alone" with a `ClockPort`

- **Targets:** AD-5, AD-12, AD-14, Capability map row CAP-5, Open Questions.
- **Evidence:** `proactive-scheduler.use-case.ts` lines 33-35: "The repository does the heavy filtering (silence, cadence, active risk) in SQL; this use case applies the per-user quiet-hours guard". `apps/worker/src/proactive/proactive-scheduler.repository.ts` lines 73-74, 90-91, 98 compute `m.occurred_at > now() - make_interval(days => minCheckInGapDays)` and a `qaCadence` 2 h / 4 h override, all against Postgres `now()`. The use case only receives `CheckInCandidate[]`.
- **Why critical:** `case-mapping.md` assigns P-06 C1 (at least one initiation) and C2 (48 h spacing) to L0 as rule checks, and SPEC CAP-5 success says they "pass or fail from the scheduler and orchestrator code alone". With the spine as written, an L0 story must implement `findCheckInCandidates` in an in-memory fake, so the 48-hour rule would test the fake, not the product. A second story could instead decide to port the SQL into the use case (a product change AD-12 forbids: "The only product-side change this spine authorizes is `ClockPort`"). Two stories, two incompatible answers; the result is a green P-06 that proves nothing, which is exactly the "L1 and L2 disagree on what a criterion means" divergence the spine claims to prevent.
- **Proposed fix (choose one and write it into AD-5/AD-12):**
  1. *Preferred (architecturally right, honest cost):* Add a second authorized product change: extract the cadence predicate into an application-level pure policy (`packages/application/src/policies/check-in-cadence.ts`: `isEligibleForCheckIn({ lastInboundAt, lastProactiveAt, now, minSilenceDays, minCheckInGapDays })`) that both the Drizzle repository (as a post-filter or by generating the SQL bounds from `clock.now()`) and the L0 fixture call. This keeps the deterministic policy in application code (parent AD-10) and makes L0 P-06 C2 a real test. Cost: one worker repository change plus its test; the SQL pre-filter can remain for performance as long as the policy is the authority.
  2. *Cheap / fits current code:* Declare in AD-14 and the case-mapping that P-06 C1/C2 are **L2-only** (driven through `POST /dev/simulate-proactive-scan` with seeded `occurred_at` timestamps) and `NOT_RUN` at L0 with reason `unsupported-fixture:cadence`; L0 keeps only the quiet-hours/timezone criterion (C3) and the restatement/S criteria stay at L1. This contradicts the SPEC CAP-5 success text and must be reflected back into the spec as a scope correction.
  Either way, AD-12's "only product-side change" sentence must enumerate the authorized changes explicitly.

### High

#### H-1 — AD-15: a `pull_request` trigger with `paths` plus "required check" stalls every non-matching PR, and the existing `authorize` opt-in gate would skip the check on matching ones

- **Targets:** AD-15, Capability map row CAP-9.
- **Evidence:** `conversation-sim.yml` currently has only `workflow_dispatch` and `schedule` triggers and an `authorize` job that exits early unless `CONVERSATION_SIM_SCHEDULED_ENABLED == 'true'` or the event is a dispatch. GitHub branch-protection required checks are matched by job name; a workflow filtered by `paths` never reports on PRs that do not touch those paths, so the PR shows "Expected — waiting for status" indefinitely. PRs from forks receive no secrets under `pull_request`.
- **Why high:** the CI story will either (a) implement exactly what AD-15 says and break merging for every dashboard/API PR, or (b) invent its own workaround (separate workflow, `pull_request_target`, `paths-ignore` no-op job). Each is a different design.
- **Proposed fix:** Rewrite the AD-15 rule to: a separate `conversation-suite-l1-pr.yml` with `on: pull_request` and **no** `paths` filter; a first `changes` job using `dorny/paths-filter` (or `git diff --name-only` against `github.event.pull_request.base.sha`) that sets `run_l1`; the `l1` job runs when `run_l1 == 'true'` and otherwise emits a single `::notice` and exits 0 under the **same job name** so the required check is always reported. State that the check is `pull_request` (same-repo branches only; fork PRs get a skipped-with-notice result) and that the `authorize` opt-in variable applies to scheduled runs only. Add an explicit per-run token/cost envelope (see M-5).

#### H-2 — AD-10 / AD-14 / AD-12: L2 `stateQuery` for P-09 ("Autonomy 3/3", "summaries count not greater than seen") has no `/dev` source, and AD-12 forbids adding one

- **Targets:** AD-10, AD-12, AD-14, Capability map rows CAP-7 and CAP-10.
- **Evidence:** `GET /dev/user/:userId/survey-state` (`dev-simulate.controller.ts` lines 244-268) returns `surveyEvidence` rows (`polarity`, `strength`, `completeness`, `confidence`) — not applied question-confirmation verdicts or staged bundle counts. No `/dev` GET exposes `questionConfirmation` state. `case-mapping.md` section 3 names "`survey-state` and admin read model" and "admin summaries endpoint" without a route; `apps/api/src/admin/` has `pulse-overview` and `survey-coverage` controllers, neither is named in the spine. AD-12: "The only product-side change this spine authorizes is `ClockPort`".
- **Why high:** the L2 story has three incompatible options (new `/dev` read, admin endpoint, direct Postgres read from the executor), and the third violates AD-14's "L2 reads via `/dev`" and AD-2 (framework bypassing the product path). The L1 `substituted` answer (repository fakes) is clear; the L2 `observed` answer is not.
- **Proposed fix:** In AD-10 add a table `StateQueryName → L1 accessor → L2 HTTP source`, e.g. `questionProgress(group)` → `questionConfirmationRepo.appliedVerdicts` → `GET /dev/user/:id/question-confirmation`; `stagedBundleCount` → repo → same endpoint; `surveyEvidenceCount` → `surveyRepo` → `GET /dev/user/:id/survey-state.count`. Amend AD-12 to authorize **additive, read-only `GET` endpoints in `dev-simulate.controller.ts`** (development-only module, `ApiKeyGuard`) as the second product-side change, with the constraint that they read existing repositories and add no new write path. Alternatively name the admin controller routes and state that L2 sends `X-Api-Key: ADMIN_API_KEY` to both `/dev` and `/admin`.

#### H-3 — AD-1 / AD-3 / AD-9: preconditions, checkpoints and observation windows are referenced by the precedence rule but have no declared shape in `SuiteCase` or `CaseRun`

- **Targets:** AD-1 (SuiteCase shape), AD-3 (CaseRun shape), AD-9 (INVALID precedence), Structural Seed `schema.ts`.
- **Evidence:** AD-9 says "failed precondition for the case or a failed checkpoint before the criterion's step → INVALID"; AD-3's `CaseRun` has `preconditions: PreconditionResult[]` but `SuiteCase` (AD-1) declares only `setup: FixtureRef[]`, `steps: Step[]` (text + `advanceClock`) and `criteria`. There is no place to declare the P-09 checkpoint after step 3 ("summary covers three topics") or the P-07 precondition ("at least one uncovered topic"), and no `observationWindow` for P-06 (0 steps, 7 simulated days, several users/timezones) nor an `events`/`initiations` observation in `CaseRun` for proactive sends. `evaluatedAt: 'observation-window'` exists but nothing produces the window.
- **Why high:** one story will model the P-09 checkpoint as a criterion with `evaluatedAt: 'after-step:3'` whose FAIL cascades, another as a `Step.checkpoint` attribute; the INVALID semantics then differ between L1 and L2 and the schema cannot validate either.
- **Proposed fix:** Extend AD-1: `Step` gains `checkpoint?: { rule: RuleName, params?, invalidates: 'following-steps' }`; `SuiteCase` gains `preconditions: Array<{ stateQuery: StateQueryName, expect: ... }>` evaluated after fixtures and before step 1; `SuiteCase` gains `observationWindow?: { durationMs, tickMs, actors: Array<{ userId, timezone }> }` with `steps: []`. Extend AD-3: `CaseRun` gains `checkpoints: CheckpointResult[]` and `events: ObservedEvent[]` (`{ at, kind: 'proactive-initiation' | 'enqueue' | 'outbound', actorId, payload }`) so `observation-window` criteria have data. Keep the rule that `evaluate` is the only producer of statuses.

#### H-4 — AD-5: "no `new Date()` or `Date.now()` remains on those paths for business-time decisions" is not reviewer-checkable, and the change surface is wider than listed

- **Targets:** AD-5, Verification Notes.
- **Evidence:** `conversation-orchestrator.ts` lines 218, 290, 1045, 1841, 1854, 1865: three are `occurredAt` stamps, one is the timezone refresh age check, three are inside module-level free functions (`parseReminderIso`-style nudge, `computeRiskExpiry`, `describeLocalTime`) that are not methods and therefore cannot "take the clock" via the constructor without a signature change. `proactive-check-in.use-case.ts` lines 114, 189, 220 (`findLatestDeliveredReportingDisclosure(... new Date())`, outbound `occurredAt`, `recordProbeSent(... new Date())`) are not in the Verification Notes. The orchestrator constructor already has 14 positional optional parameters (lines 115-130); a 15th positional `clock` is a DI-drift hazard in `apps/worker` wiring.
- **Why high:** "business-time decision" vs "timestamp" is a per-reviewer judgment; L0 P-01/P-02/P-04 depend on the orchestrator's local-time description and gap logic actually using the injected clock, so a missed call site makes those cases silently flaky rather than failing.
- **Proposed fix:** (1) Make the rule mechanical: an ESLint `no-restricted-syntax` rule (selectors `NewExpression[callee.name="Date"][arguments.length=0]` and `CallExpression[callee.object.name="Date"][callee.property.name="now"]`) scoped via `overrides` to the four listed files plus `proactive-check-in.use-case.ts`, with `// eslint-disable-next-line` + reason as the only escape hatch (so a reviewer greps for the disables). (2) State the injection shape: `ClockPort` is passed as the **last** optional constructor parameter defaulting to `SystemClock`, and free functions receive `now: Date` as a parameter. (3) List `proactive-check-in.use-case.ts` in the change surface and add `recordProbeSent`/disclosure lookups to the "business-time" set (they feed P-06 C2 and the `disclosureDelivered` fixture).

### Medium

#### M-1 — AD-13: the N=1 nightly job has no meaning-check threshold; a single judge flake becomes a flagged regression

- **Targets:** AD-13, AD-15.
- **Evidence:** AD-13 thresholds are "rule N/N; meaning 4/5 at N=5, scaled like `run-gate.ts`". Scaling 4/5 to N=1 gives 1/1, so one judge miss on a nightly run marks `regressed`, which AD-13's Prevents clause says it exists to avoid.
- **Fix:** State that `suite:diff` reports meaning-criterion movement as `advisory` when `N < minSamplesForMeaning` (suggest 3) and only rule criteria can fail the nightly diff; the weekly N=5 run is the authoritative meaning diff. Put `minSamplesForMeaning` in `suite.config.json`.

#### M-2 — AD-14 L0: "fails fast if `OPENAI_API_KEY` or `AZURE_OPENAI_*` would be read" cannot be implemented as stated, and `ci.yml` always sets `OPENAI_API_KEY`

- **Targets:** AD-14.
- **Evidence:** `ci.yml` quality job env sets `OPENAI_API_KEY: sk-test-placeholder`; `createLiveProvider()` in `coach-harness.ts` is called whenever `options.aiProvider` is absent. "Would be read" is a counterfactual.
- **Fix:** Rule: the L0 executor constructs `CoachHarness` with `aiProvider: ScriptedAiProvider` always and never imports `scenarios/config.ts` or `OpenAiProvider`; enforce with a colocated test that fails if `l0-deterministic-executor.ts`'s static import graph contains `@entalent/ai-openai` provider factories or `scenarios/config`, and run L0 with `env: { ...process.env, OPENAI_API_KEY: undefined, AZURE_OPENAI_ENDPOINT: undefined }` in the CLI so an accidental live call fails loudly.

#### M-3 — AD-8 / AD-11: "changing `judgeModel` or `judgePromptVersion` invalidates all baselines" has no mechanism

- **Targets:** AD-8, AD-11, AD-13.
- **Evidence:** Baseline file shape in AD-11 lists per-criterion results, git sha, models, judge agreement, but AD-13's `suite:diff` rule does not say what happens when the run's judge pin differs from the baseline's.
- **Fix:** Baseline JSON carries `judge: { model, promptVersion, agreement }`; `suite:diff` refuses (`exit 2`, status `baseline-invalid`) when either differs from `suite.config.json`, and `suite:baseline:accept` refuses a run whose judge pin differs from config. Also record `coachModel` and `OPENAI_MODEL_BALANCED` so a model swap on the coach side is visible in the diff header.

#### M-4 — AD-14 L2: `reset-user` and persona isolation semantics are underspecified

- **Targets:** AD-14, fixture `personaReset`.
- **Evidence:** `POST /dev/reset-user` requires `tenantId` or `DEFAULT_TENANT_ID` (controller lines 454-456) and defaults `deep: false`, which keeps conversation history; the Isolated profile needs an empty conversation. `find-conversation` creates the `dev` conversation and needs `tenantId`, `userId`, `userName`.
- **Fix:** Add `SUITE_L2_TENANT_ID` (required) to the config convention; `personaReset` calls `reset-user` with `deep: true` **or** the executor derives a fresh `userId` per `(runId, caseId)` so no reset is needed; say which. Record the chosen `userId`/`conversationId` in `CaseRun.state`.

#### M-5 — Cost control is deferred while AD-15 puts live L1 runs on pull requests

- **Targets:** AD-15, Deferred ("Parallel case execution and token budget caps").
- **Evidence:** A P-suite L1 run is ~10 cases × 1-5 steps × 5 model calls per turn plus up to 23 judge calls, per sample; weekly N=5 multiplies by five; the PR trigger adds an unbounded number of runs per day.
- **Fix:** Decide now, cheaply: `suite.config.json` carries `maxJudgeCallsPerRun` and `maxCoachCallsPerRun`; the runner aborts with `ERROR` statuses and `provisional: true` when exceeded; the report records `usage` from the `ai` SDK result per call. Keep parallelism deferred.

#### M-6 — AD-6 contradicts the brownfield's deliberate sharing of `hasReflectiveOpener` from product code

- **Targets:** AD-6.
- **Evidence:** `assertions.ts` line 1 imports `hasReflectiveOpener` from `@entalent/ai-openai`; README: "Reusing `hasReflectiveOpener` ... keeps the runtime gate and the simulation honest about the same definition." AD-6 Prevents "Phrase lists ... leaking into prompts or orchestrator code" and Rule "Term and phrase lists live beside the rule as data."
- **Fix:** Split the rule: wrapped legacy rules keep their existing definition source (product-shared where it already is); **new** suite rules (`no-greeting-restart`, `no-internal-terms`, `single-question`) keep their lists under `suite/rules/` and must not be imported by product code (AD-12). This also aligns with ADR-013 D2 (lexical rules validate structure in tests, never override semantics in product).

#### M-7 — AD-8 gating means the first-slice L1 "required check" is rule-only; the spine should say so

- **Targets:** AD-8, AD-9, AD-15, SPEC success signal.
- **Evidence:** Until `>= 40` labels and agreement `>= 0.85` exist, all 23 meaning criteria are `advisory` and excluded from pass rate and verdict; the PR gate then decides on ~12 rule criteria. This is a sound design, but epics will otherwise assume meaning criteria gate from day one.
- **Fix:** Add a sentence to AD-15: "Until calibration passes, the PR check fails only on rule-criterion and S regressions; the report header states `meaning checks: advisory (uncalibrated)`." Confirm the SPEC CAP-8 success case (P-08 cause question) is a rule criterion — it is per `case-mapping.md`, so the success signal survives.

### Low

#### L-1 — Stack: pin `zod` as `^3.25.76`, not just "3.25.76"

- `pnpm-lock.yaml` resolves both `zod@3.25.76` (peer of `ai@6.0.240`) and `zod@4.4.3`. Say `^3.25` explicitly so the `conversation-sim` devDependency dedupes onto the `ai` peer instead of pulling v4 with a different `z.infer` surface.

#### L-2 — AD-12 import list and Structural Seed omit `scenarios/config.ts` and misname `report/`

- `judgeModel()` is exported from `packages/conversation-sim/src/scenarios/config.ts`; the report module is `harness/report.ts`. Add `scenarios/config` to the allowed imports (or move `judgeModel` to `harness/models.ts` as part of the first story) and fix the path.

#### L-3 — AD-8: simple agreement on a PASS-heavy label set is inflated; add a kappa floor

- Suggest `agreementThreshold: 0.85` **and** `kappaFloor: 0.6`, both reported; otherwise a judge that always says PASS clears 0.85 on a set that is 85 % PASS.

#### L-4 — AD-15 path filter misses two files that change coaching behaviour

- Add `packages/application/src/utils/quiet-hours.ts` (P-06 C3) and `packages/ai-openai/src/openai-provider.ts` (ADR-013 notes its regex normalizers rewrite classifier output) to the `paths` list; `proactive-*.ts` also matches `*.test.ts`, which is harmless but worth a note.

#### L-5 — AD-14 L2: say how the API is started so `/dev` mounts

- `shouldMountDevModule()` mounts `DevModule` whenever `NODE_ENV !== 'production'`; the L2 workflow should run `api` with `NODE_ENV=test` and set `ADMIN_API_KEY` (otherwise `ApiKeyGuard` passes through with a warning, which is acceptable for CI but should be a stated choice).

#### L-6 — AD-9 "verbatim" to Framework v2.1.1 sections 5/6 is not verifiable from the repository

- The framework page (Confluence 176029697) is provenance only. Add the status table and verdict thresholds as a quoted appendix in `case-mapping.md` or the spine so "verbatim" can be reviewed without Confluence access.

#### L-7 — Logging convention: record `usage` tokens per model call in the report

- Cheap, enables M-5 and later cost trend; `ai` `generateObject`/`generateText` return `usage`.

---

## Summary of required amendments (for the author)

| Finding | AD | Amendment |
| --- | --- | --- |
| C-1 | AD-5, AD-12, AD-14 | Decide where the cadence predicate lives (application policy, preferred) or demote P-06 C1/C2 to L2-only and correct SPEC CAP-5 |
| H-1 | AD-15 | Separate PR workflow, change-detection job, always-reporting job name, no `paths` on a required check |
| H-2 | AD-10, AD-12 | `StateQueryName → L1 accessor → L2 route` table; authorize additive read-only `/dev` GETs |
| H-3 | AD-1, AD-3 | Add `preconditions`, `Step.checkpoint`, `observationWindow`, `CaseRun.checkpoints/events` |
| H-4 | AD-5 | ESLint-enforced no-`Date` rule on named files; last-param `ClockPort` with `SystemClock` default; add `proactive-check-in.use-case.ts` |
| M-1..M-7 | AD-6, AD-8, AD-11, AD-13, AD-14, AD-15 | Thresholds at N<3, L0 provider isolation test, baseline invalidation mechanics, L2 tenant/reset, cost caps, legacy-rule sharing, uncalibrated-gate statement |
| L-1..L-7 | Stack, AD-12, AD-8, AD-15, AD-14, AD-9, Conventions | Pins, paths, kappa floor, appendix, usage logging |
