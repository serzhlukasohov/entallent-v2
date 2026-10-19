---
review: adversary
target: ../ARCHITECTURE-SPINE.md
lens: "Construct two units one level down that each obey every AD to the letter yet still build incompatibly"
date: 2026-10-17
reviewer: adversarial pass (Claude)
grounding:
  - packages/conversation-sim/src/harness/coach-harness.ts (send() returns one responseText per inbound; turns[] is OrchestrateResult[]; harness stamps new Date())
  - packages/conversation-sim/src/harness/report.ts (ScenarioRunReport.turns carries mode/primaryIntent/replyPlan; no per-message metadata)
  - packages/conversation-sim/src/gate/run-gate.ts (scaleThreshold(hardPasses, config.runs, runs); runId = `${scenario}-${n}-attempt-${a}`; samples[] inside one summary)
  - packages/conversation-sim/src/gate/failure-classifier.ts (classifyFailure typed over ScenarioRunReport[] + Vitest stdout)
  - apps/api/src/dev/dev-simulate.controller.ts (GET messages returns id/direction/text/occurredAt/traceId only; unknown `after` returns ALL rows; reset-user defaults deep=false; simulate-message returns traceId+messageId)
  - packages/application/src/use-cases/conversation-orchestrator.ts (outbound saveMessage carries traceId + metadata incl. bundleReply/reportingDisclosureVersion; answer_then_bundle is one composed outbound; OrchestrateResult.outcome 'input_filtered' | 'processing_failed')
---

# Adversarial Review — Conversation Evaluation Regression Framework spine

## Verdict

The spine is sound at the paradigm level (pipes-and-filters, executor port, status precedence) but **under-specifies the data boundary it says it owns**. Of the 21 pairwise constructions below, 20 are legal under every AD as written. Six of them make the headline guarantee (AD-15: "a NOT ADEQUATE verdict on a complete L1 run blocks merge") either unreachable or trivially evadable. The fixes are almost all tightenings of AD-1/AD-3/AD-9/AD-13/AD-14 plus two new ADs; none change the paradigm.

Severity key: **S1** breaks the merge-gate guarantee or yields opposite statuses for identical product behaviour; **S2** silent masking or non-reproducible results; **S3** build-time incompatibility that will be caught, but by the second implementer, not the spine.

| # | Hole | Units | Sev | AD to tighten |
| --- | --- | --- | --- | --- |
| H1 | Which outbound is "reply:n" at L2 | L2 executor ↔ evaluator/rule registry | S1 | AD-3, AD-14 |
| H2 | Product silence becomes ERROR at L2 but a reply at L1 | L1 executor ↔ L2 executor ↔ score | S1 | AD-9, AD-3 |
| H3 | Case has no `levels`; every run INCOMPLETE forever | loader/runner ↔ score ↔ CI | S1 | AD-1, AD-9, AD-15 |
| H4 | ClockPort injected into orchestrator, wall clock in repositories | L0 executor ↔ ClockPort change | S1 | AD-5 |
| H5 | `advanceClock` is a step field, not a fixture; L2 may sleep 5 min, skip, or NOT_RUN | L2 executor ↔ L0/L1 executors ↔ schema | S1 | AD-1, AD-4 |
| H6 | Diff N when nightly N=1 meets a baseline from N=5 | diff ↔ CI ↔ baseline-accept ↔ CLI | S1 | AD-13, AD-11 |
| H7 | Baseline PASS, current NOT_RUN → "unchanged" | diff ↔ baseline-accept ↔ AD-4 | S2 | AD-13 |
| H8 | Checkpoint is not a schema concept; INVALID propagation to `conversation`/`state` unspecified | schema ↔ score ↔ executors | S2 | AD-1, AD-9 |
| H9 | One `StateSnapshot` but P-09 needs before+after; `stateQuery` absent from AD-1 schema | schema ↔ L1/L2 fixtures ↔ P-09 | S3 | AD-3, AD-1, AD-10 |
| H10 | Meaning checks at L0 with no judge | L0 executor ↔ evaluate | S2 | AD-7, AD-14 |
| H11 | "Recorded agreement" has no owner; `evaluate(case, run, judge)` cannot set `advisory` | calibrate ↔ config ↔ evaluate ↔ report | S2 | AD-8, AD-3 |
| H12 | Judge model: config pin vs `SIM_JUDGE_MODEL` env | config ↔ CLI/judge | S2 | AD-8, Conventions |
| H13 | `transcriptRef` the judge cannot reconstruct | calibrate ↔ criterion-judge | S2 | AD-8 |
| H14 | L2 cannot observe `bundleReply` / bundle-staged metadata; AD-12 forbids the only fix | rule registry ↔ L2 executor ↔ AD-12 | S1 | AD-6, AD-12 |
| H15 | Fixture failure: INVALID or ERROR? | executors ↔ score | S2 | AD-9, AD-4 |
| H16 | Retry unit: step or case? Reusing `failure-classifier` as typed is impossible | executors ↔ failure-classifier ↔ rules | S2 | Conventions, AD-4 |
| H17 | `reset-user` default `deep=false`; `personaReset` listed as a fixture makes L1 NOT_RUN | L2 executor ↔ loader ↔ L1 executor | S2 | AD-14, AD-4 |
| H18 | Proactive worker fires into the dev conversation during the 60 s poll | L2 executor ↔ L2 CI workflow | S2 | AD-14, AD-15 |
| H19 | PR changes prompt and accepts its own baseline in one PR | CI workflows ↔ baseline-accept | S2 | AD-15, AD-11 |
| H20 | Judge transport/schema failure has no status | criterion-judge ↔ score | S3 | AD-7, AD-9 |
| H21 | `index` base of `StepObservation` unspecified | L0 executor ↔ evaluate | S3 | AD-3 |

---

## H1 — Which outbound message is "reply:n" at L2

**Units:** `l2-application-executor.ts` + `dev-api-client.ts` ↔ `evaluate.ts` / `rules/registry.ts`.

**What the spine says:** `StepObservation.reply: { text, metadata } | null` (AD-3); L2 "polls `GET /dev/conversation/:id/messages?after=` at 500 ms up to 60 s" (AD-14).

**Construction A (legal):** after `POST /dev/simulate-message` returns `{ messageId, traceId }`, poll with `after=<messageId>`, take the **first** row with `direction: 'outbound'`, stop polling. `reply.metadata = {}` because the endpoint returns no metadata.

**Construction B (legal):** poll until 60 s or until two consecutive polls return no new rows, take **all** outbound rows, `reply.text = rows.map(r => r.text).join('\n\n')`.

**Why they collide:** the worker is asynchronous; a proactive check-in (`ProactiveSchedulerUseCase` in the same worker — production cadence is currently hourly) or a `simulate-checkin` from a stale job can land in the same conversation inside the window. A takes the check-in as the reply to step 2 and P-08's "asks what is behind" meaning check FAILs on a message the orchestrator never produced in response to the inbound. B concatenates the check-in into the reply and `too-many-questions` (P-07.C4) FAILs. L1 (`harness.send()` → `OrchestrateResult.responseText`) agrees with neither. Also: when `after=` is not found (e.g. the inbound row is not yet committed when the first poll fires, or the id is wrong), the endpoint returns **every row in the conversation**, so A's "first outbound" is the first message of the whole history.

**Tightened AD-3 text:**
> `StepObservation.reply` is the ordered set of outbound messages whose `traceId` equals the step's inbound `traceId`, exposed as `reply: { messages: ReplyMessage[], text: string } | null` where `text` is `messages.map(m => m.text).join('\n\n')` and `ReplyMessage = { id, text, occurredAt, metadata }`. Outbound messages observed in the step window whose `traceId` differs are recorded in `StepObservation.unsolicited: ReplyMessage[]` and never evaluated as the reply. Rules and the judge read `reply.text`; rules that need per-message data read `reply.messages`.

**Tightened AD-14 text:**
> L2 attributes replies by `traceId`, not by position. The poll uses `after=<inboundMessageId>` from the `simulate-message` response; a response that does not start strictly after that id (the endpoint's unknown-id fallback returns the full history) is an infrastructure error, not an observation. Polling ends at the first poll after which the trace has at least one outbound and the next poll adds none for that trace, or at the timeout.

---

## H2 — Product silence: `reply: null` at L1, ERROR at L2

**Units:** L1 executor ↔ L2 executor ↔ `score.ts`.

**What the spine says:** AD-9: "executor error at or before the step (… no reply within 60 s at L2) → ERROR". AD-3 allows `reply: null`.

**Construction A (L1, legal):** orchestrator returns `outcome: 'input_filtered'` with the fallback text, or a path that yields an empty `responseText`; executor records `reply: { text: '' }` (or `null`). Evaluate runs P-01's rule "reply exists" → FAIL. Status FAIL; run COMPLETE.

**Construction B (L2, legal):** same product decision, no outbound row for 60 s → executor throws `SuiteExecutionError{kind:'product'}` → AD-9 → ERROR. Run INCOMPLETE, verdict provisional, diff category "unchanged" (H7).

**Why it matters:** identical product behaviour yields FAIL at one level and ERROR at the other; the ERROR path exempts the criterion from the pass rate and from "regressed". A regression that makes the coach go silent is **invisible** at L2 and **blocking** at L1.

**Tightened AD-9 text:**
> ERROR is reserved for cases where the executor cannot determine what the product did: a thrown exception, a transport failure after retry, or an L2 timeout **with no terminal signal**. An observed decision not to reply (L1: `OrchestrateResult` with empty text or a non-success `outcome`; L2: a terminal marker — see AD-14) is `reply: null` with `turn.outcome` set, and criteria at that reply are evaluated: rules decide, meaning checks on a null reply are FAIL with evidence `no-reply`. The L2 timeout is `ERROR` only until the `/dev` read exposes job completion (AD-12 amendment, H14); until then L2 reports P-01 "reply exists" as `ERROR` and the report must flag the level as unable to distinguish silence from failure.

---

## H3 — Case has no `levels`; every run is INCOMPLETE forever

**Units:** `loader.ts`/`runner.ts` ↔ `score.ts` ↔ `conversation-sim.yml` (AD-15).

**What the spine says:** `SuiteCase` has `id, requirement, setup, steps, criteria, runProfile` (AD-1) — no `levels`. AD-4: unsupported fixture → every criterion NOT_RUN. AD-9: COMPLETE requires every status PASS/FAIL/NOT_TESTABLE. AD-15: a NOT ADEQUATE verdict on a **complete** L1 run blocks merge.

**Construction A (runner, legal):** `suite:run --level L1` runs all ten cases. P-06 needs `clock` plus scheduler driving; if L1 does not support a 7-day `clock` fixture, P-06's five criteria are NOT_RUN. Case-mapping says P-01/P-02 are "L0 setup, L1" and P-07/P-09/P-10 are "L1, L2" — but the schema cannot say so, so at L2 P-01's `clock` fixture → NOT_RUN. **Every L1 and L2 run has at least one NOT_RUN → INCOMPLETE → `provisional: true`.** AD-15's blocking clause never fires; the only thing that can fail the PR job is `suite:diff`, and H6/H7 show the diff is soft too.

**Construction B (score, legal):** a second implementer, noticing this, computes COMPLETE only over criteria that were "attempted". Now two scorers disagree on COMPLETE for the same `CaseRun[]`, and the CI step summary and the Markdown report (both "render the verdict") show different verdicts.

**Also unspecified:** P-06 has zero steps and `evaluatedAt: observation-window`; `SuiteExecutor.run(case, options)` has no way to express "drive `ProactiveSchedulerUseCase` over 7 simulated days" and `CaseRun` has no record for windowed outbound observations (`steps: []`, one `state`).

**Tightened AD-1 text:**
> `SuiteCase` carries `levels: Level[]` (the levels at which the case is meant to run) and `kind: 'conversation' | 'observation'`. The loader rejects a `conversation` case with zero steps and an `observation` case with any `reply:<n>` criterion. A criterion may further narrow with `levels?: Level[]`.

**Tightened AD-9 text:**
> COMPLETE and the layer table are computed over the criteria **in scope for the level**: those whose case (and criterion, if narrowed) declares the level. A criterion out of scope is emitted as `NOT_RUN` with reason `level-not-declared` and excluded from COMPLETE, pass rate, diff and verdict. A criterion in scope that is `NOT_RUN` for `unsupported-fixture:<name>` makes the run INCOMPLETE (that is a build bug, not a design choice).

**Tightened AD-3 text (observation cases):**
> `CaseRun.window?: { from: string, to: string, outbound: ReplyMessage[] }` is populated by executors for `observation` cases; `observation-window` criteria are evaluated over `window.outbound` and rules may read `window.from/to`.

---

## H4 — ClockPort in the orchestrator, wall clock in the repositories

**Units:** `l0-deterministic-executor.ts` + `fixtures/clock.ts` ↔ the AD-5 `ClockPort` change in `packages/application`.

**What the spine says:** AD-5: orchestrator, scheduler, check-in use case and quiet-hours take the clock; "no `new Date()` … on those paths for business-time decisions".

**Construction A (application change, legal):** the orchestrator computes "short gap" (P-04) as `clock.now() - lastOutbound.occurredAt`. `InMemoryConversationRepository.saveMessage` and `CoachHarness` (`userTimezoneUpdatedAt: new Date()`) are not "those paths" and keep stamping wall-clock `occurredAt`.

**Construction B (L0 executor, legal):** `FixedClock('2026-03-02T10:00:00Z')`, `advanceClock: 180000` between P-04's two steps.

**Why they collide:** step 1's outbound is stamped with real wall-clock (2026-10-17), the clock says March 2026 → the gap is negative or seven months; the greeting-restart decision flips; P-04.C1 fails or passes depending on the day the test is run — the exact flakiness AD-5 claims to prevent. Same for `TZ_REFRESH_DAYS` on `userTimezoneUpdatedAt`. Both units obey AD-5 to the letter.

**Tightened AD-5 text:**
> Every timestamp that is **persisted or compared** on the orchestrator / scheduler / check-in path derives from the same `ClockPort` instance: `ConversationRepositoryPort.saveMessage` callers pass `occurredAt: clock.now()` (or the in-memory repositories and `InlineOutbox` are constructed with the clock), `CoachHarness` accepts `clock` and uses it for `userTimezoneUpdatedAt` and seeded records. The L0 executor asserts after each case that no persisted `occurredAt` lies outside `[clock.start, clock.now()]` and fails the case as `ERROR kind:'product'` reason `clock-leak` otherwise. `FixedClock`/`AdvancingClock` are the only clocks a suite run constructs; `SystemClock` is forbidden under `suite/`.

---

## H5 — `advanceClock` at L2, and the 60 s inter-message wait

**Units:** L2 executor ↔ L0/L1 executors ↔ `schema.ts`.

**What the spine says:** `Step` has `advanceClock` (AD-1); L2 has no clock fixture (AD-5); `supports(fixture)` governs NOT_RUN (AD-4). Case-mapping: "at least 60 s between messages becomes a clock advance at L0/L1 and a real wait only at L2".

**Construction A (L2, legal):** P-04's `advanceClock: 180000` → `await sleep(180000)` (real three minutes; the weekly job can afford it). **B (legal):** `advanceClock` is a clock concern, L2 has no clock, ignore it and send step 2 immediately — P-04 is then run at L2 with a 2-second gap and "no greeting restart" passes vacuously. **C (legal):** treat it as `unsupported-fixture:clock` → NOT_RUN. All three obey AD-1/4/5 because `advanceClock` is a step field and `supports()` only sees `setup`.

**Second collision:** the suite's "≥ 60 s between messages" is in no schema field. L1 implementer realises it as `clock.advance(60000)` before every step — which also moves P-01's working-hours clock and P-04's gap by 60 s per step; L0 implementer does not. P-02 (`clock outside 09:00-18:00`) set to 17:59:30 flips to inside hours after step 1 at L1 only.

**Tightened AD-1 / AD-4 text:**
> A case with any `advanceClock` step implicitly requires the `clock` fixture; the loader adds it to `setup` so `supports('clock')` decides runnability at every level. `suite.config.json` carries `interMessageGapMs` (default 60000). Executors realise the gap uniformly **before** each step after the first: L0/L1 by `clock.advance(gapMs)`, L2 by a real wait; the realised gap is recorded as `StepObservation.gapMs`, and `advanceClock` is **in addition to** the gap. Case authors must set fixture clock values with the gap in mind; the loader warns when a `clock` fixture value is within `steps.length * interMessageGapMs` of a working-hours boundary.

---

## H6 — Who decides N for the diff when runs were executed on different days

**Units:** `diff.ts` ↔ `conversation-sim.yml` ↔ `suite:baseline:accept` ↔ `cli.ts`.

**What the spine says:** `suite:run [--runs N]`; `suite:diff --run <id>` (singular); AD-13 "the N-sample aggregate of a run set"; `minPasses(level, checkType)` "scaled like `run-gate.ts`"; nightly N=1, weekly N=5 (AD-15). Baseline is a status per `(suite, level, criterionId)` (AD-2).

**Construction A (CLI, legal):** `--runs 5` produces **five run ids** (as `run-gate.ts` does with `${scenario}-${n}-attempt-${a}`); `suite:diff --run <id>` diffs one sample. **B (CLI, legal):** one run id with `samples: 5` inside. The two cannot share a baseline file format or a CI step.

**Construction C (CI nightly, legal):** N=1, meaning threshold 4/5 scaled "like `scaleThreshold`" → `ceil(4/5 * 1) = 1/1`. One flaky judge sample → `regressed` → exactly what AD-13's *Prevents* line says cannot happen. **D (baseline-accept, legal):** accepts the nightly N=1 run; the baseline status of 23 meaning criteria is a single coin flip each; next week's N=5 diff reports phantom `fixed`/`regressed`.

**Tightened AD-11 / AD-13 text:**
> A run id names **one invocation** with `samples: N`; `SuiteRunReport.results[criterionId] = { status, passCount, n, samples: CriterionSample[] }`. Baselines store `{ status, passCount, n, runId, gitSha, acceptedAt, acceptedBy }` per criterion. `suite:baseline:accept` refuses a run whose `n < config.baseline.minSamples[level]` (default L0: 1, L1: 5, L2: 3) or that is INCOMPLETE (override `--allow-incomplete` records `provisional: true`). `suite:diff` on a run with `n < config.diff.minSamples[level]` emits `inconclusive` for meaning criteria instead of `regressed`; `inconclusive` never fails the diff. Rule criteria are diffed at any `n` (they are deterministic). The nightly N=1 L1 job therefore reports but cannot fail on meaning criteria; the PR-triggered L1 job runs with `--runs config.diff.minSamples.L1`.

---

## H7 — Baseline PASS, current NOT_RUN / ERROR / INVALID → "unchanged"

**Units:** `diff.ts` ↔ `suite:baseline:accept` ↔ AD-4's NOT_RUN.

**What the spine says:** AD-13 defines `regressed` (baseline PASS, passes below threshold), `fixed`, and "`unchanged` otherwise".

**Construction A (accept, legal):** stores every criterion with its full status, including NOT_RUN/ERROR/INVALID/advisory. **B (accept, legal):** stores only PASS/FAIL "because only those are diffable". A diff built against A treats a criterion missing from B as "new"; a diff built against B cannot distinguish "never ran" from "retired".

**Construction C (diff, legal):** a case that was PASS in the baseline becomes NOT_RUN this week because a fixture was renamed, a `levels` entry was dropped, or the L2 worker never booted (every L2 criterion ERROR). "PASS count below threshold"? The PASS count is 0 — but is that `regressed`? Implementer C says no (status is not FAIL) → `unchanged`. **A broken L2 job is reported as a clean diff.** Likewise baseline FAIL + current NOT_RUN → "unchanged", masking lost coverage on known-bad criteria.

**Tightened AD-13 text:**
> Baselines record the full `CriterionStatus` for every criterion in scope (H3). Diff categories: `regressed` (baseline PASS → PASS count below `minPasses`), `fixed`, `unchanged`, `lost-coverage` (baseline PASS or FAIL → current NOT_RUN/ERROR/INVALID or missing), `gained-coverage` (the reverse), `new` (criterion not in baseline), `retired` (baseline present, criterion now `not-testable: retired`), `inconclusive` (H6). `lost-coverage` fails the diff for S criteria and for rule criteria and is always listed first in the step summary; `new` criteria never fail the diff but appear with status.

---

## H8 — "Checkpoint" is not a schema concept; INVALID propagation is underspecified

**Units:** `schema.ts` (AD-1) ↔ `score.ts` (AD-9) ↔ executors.

**What the spine says:** AD-9: "a failed checkpoint before the criterion's step → INVALID". Case-mapping P-09: "checkpoint after 3 … Checkpoint failure marks step 4 INVALID"; "dependent criteria inherit INVALID". The AD-1 `Step` is `{ text, advanceClock? }` and `Criterion` has no dependency field.

**Construction A (schema author, legal):** a checkpoint is a criterion with `checkpoint: true` evaluated at `reply:3`; INVALID flows to criteria with `evaluatedAt` index > 3. **B (legal):** a checkpoint is `Step.checkpoint: Check[]` executed **by the executor** before sending step 4; the executor stops the case → remaining criteria are `NOT_RUN` ("step not reached"), not INVALID. A and B produce different statuses (INVALID vs NOT_RUN) for the same P-09 failure and different COMPLETE outcomes.

**Unspecified either way:** are `conversation`-scoped criteria (P-09.S "summaries count not greater than seen", "tells complete") INVALID or evaluated on the partial transcript? Are `state` criteria (dashboard 3/3) INVALID? Does a meaning check count as a checkpoint (parent AD-10 says deterministic outranks agent output; a judge deciding INVALID for the rest of the case violates that spirit)?

**Tightened AD-1 / AD-9 text:**
> `Step.checkpoint?: { checks: RuleCheck[], onFail: 'continue' | 'stop' }` — rule checks only; meaning checks may not gate later steps. The **evaluator**, not the executor, decides checkpoint outcomes (AD-3 boundary); executors always send every step unless `onFail: 'stop'` is set, in which case the executor evaluates the checkpoint rule inline (the rule function is pure and importable) and records `CaseRun.stoppedAtStep`. On a checkpoint failure at step k: criteria at `reply:n`/`after-step:n` with n > k → INVALID reason `checkpoint:<k>`; `conversation` and `state` criteria → INVALID unless the criterion declares `independentOfCheckpoints: true`; criteria at n ≤ k are evaluated normally. If the executor stopped, steps after k are additionally `NOT_RUN` for criteria whose check needs the reply, but INVALID takes precedence as AD-9 orders it.

---

## H9 — One `StateSnapshot`, but P-09 needs before and after; `stateQuery` is not in the schema

**Units:** `schema.ts` ↔ L1/L2 fixtures (`pulseCycle`, `disclosureDelivered`) ↔ P-09 criteria.

**What the spine says:** `CaseRun.state: StateSnapshot` (one, AD-3). AD-10 says a `state` criterion "declares `stateQuery`", but AD-1's `Criterion` shape has no `stateQuery`. Case-mapping P-09: "records count before run" and "S summaries count not greater than seen" compares before vs after.

**Construction A (L1 executor):** `state` = snapshot at end of run; the "before" count comes from the fixture's known seed (0 summaries) hard-coded in the rule params. **B (L2 executor):** `state` = snapshot taken **before** the run (because `survey-state` is read at setup) — rule "dashboard 3/3" reads a pre-run snapshot and FAILs always. Both are legal.

**Tightened AD-3 / AD-1 text:**
> `CaseRun.state: { before: StateSnapshot, after: StateSnapshot, afterStep: Record<number, StateSnapshot> }` where `before` is taken after fixtures are applied and before step 1, `after` at the end, and `afterStep[n]` only for steps that a `state` criterion names. `Criterion` gains `stateQuery?: { name: StateQueryName, at: 'before' | 'after' | 'after-step:<n>' }`, required when `evaluatedAt === 'state'` (Zod refinement). `StateSnapshot` is a map `StateQueryName → unknown` with a Zod schema per query name in `suite/fixtures/state-queries.ts`, shared by the repository-fake answer (L1) and the `/dev` answer (L2) so both executors must satisfy one type.

---

## H10 — Meaning checks at L0, where there is no judge

**Units:** L0 executor (AD-14: no network, fails fast on provider keys) ↔ `evaluate.ts` (AD-7: one judge call per meaning check).

**Construction A (evaluate):** calls `judge` for every meaning check regardless of level → at L0 reads `OPENAI_API_KEY` → L0 fails fast per AD-14 → the PR-blocking L0 job (AD-15) is red on every PR. **B (evaluate):** skips meaning checks at L0 and reports the criterion PASS if its rule passed (P-01.C1 has rule + meaning; P-01.C2 is meaning-only → PASS vacuously). **C:** meaning-only criteria → NOT_RUN → every L0 run INCOMPLETE (H3 again). All three obey AD-7/AD-9/AD-14.

**Tightened AD-7 / AD-14 text:**
> `evaluate(case, run, judge: CriterionJudge | null, trust)` — at L0 the runner passes `judge: null` and `evaluate` never imports a model. With `judge: null`, a meaning check yields `MeaningOutcome { status: 'NOT_RUN', reason: 'no-judge-at-level' }`; a criterion whose checks are **all** meaning is `NOT_RUN` and **out of scope** at that level (H3 scoping, counted in neither COMPLETE nor pass rate, shown in the coverage table as `judge-only`); a criterion with a rule check plus a meaning companion is decided by the rule alone and carries `meaningSkipped: true`. The L0 job's step summary lists judge-only criteria so nobody mistakes L0 green for full coverage.

---

## H11 — "Recorded agreement" has no owner, and `evaluate(case, run, judge)` cannot set `advisory`

**Units:** `judge/calibrate.ts` ↔ `suite.config.json` ↔ `evaluate.ts` ↔ `report.ts`.

**What the spine says:** AD-8: "When the recorded agreement for the pinned judge is missing or below threshold, every meaning status is emitted with `advisory: true`". AD-11: the report carries "judge agreement". AD-3: `evaluate(case, run, judge)` is "the only producer of `CriterionResult`".

**Construction A:** `calibrate.ts` prints agreement to stdout and the human copies it into `suite.config.json` as `recordedAgreement`; `score.ts` reads config and sets `advisory` on results it receives — violating AD-3's "only producer" only in spirit, but legal (it mutates, it doesn't produce). **B:** `calibrate.ts` writes `calibration/p-v1/agreement.json`; `evaluate.ts` reads it directly from disk inside the "pure" function; `report.ts` recomputes agreement from `labels.json` at report time with the live judge. Three places compute or copy agreement; two decide advisory.

**Tightened AD-8 / AD-3 text:**
> `suite:calibrate` is the sole writer of `calibration/<suiteId>/agreement.json` `{ schemaVersion, judgeModel, judgePromptVersion, labelsSha256, n, overall, kappa, perLayer, computedAt }`. The **runner** computes `JudgeTrust = { trusted: boolean, reason, agreement | null }` once per run from `suite.config.json` (pin, threshold, minLabels) and `agreement.json` (must match pin and current `labelsSha256`), and passes it to `evaluate(case, run, judge, trust)`; `evaluate` sets `advisory = !trust.trusted` on every meaning-derived `CriterionResult`. `score.ts` and `report.ts` read `advisory` and copy `trust` verbatim; neither recomputes it. `calibrate.ts` and `evaluate.ts` call the same `judgeCriterion(input: JudgeInput)` function.

---

## H12 — Judge model: config pin vs `SIM_JUDGE_MODEL`

**Units:** `suite.config.json` ↔ `cli.ts` / `judge/criterion-judge.ts`.

**What the spine says:** AD-8 pins `judgeModel` in config and says changing it invalidates agreement and baselines. Consistency Conventions: "existing `SIM_JUDGE_MODEL`, `SIM_SIMULATOR_MODEL` honored".

**Construction A:** `judgeModel()` (existing harness helper) reads `SIM_JUDGE_MODEL`; CI sets it to a cheaper model for nightly. Agreement was measured for the pinned model; the run is evaluated by another; `advisory` is false because the config pin matches `agreement.json`. **B:** CLI refuses env ≠ pin. Both legal.

**Tightened AD-8 text:**
> The effective judge model is `suite.config.json.judgeModel`. `SIM_JUDGE_MODEL` is honored only when it equals the pin or when `--allow-unpinned-judge` is passed; then `JudgeTrust.trusted = false` reason `unpinned-judge`, `baseline:accept` refuses the run, and `suite:diff` treats all meaning criteria as `inconclusive`. The report's `models.judge` is the model actually called, and `judgeTrust.pin` the configured one, so a mismatch is visible.

---

## H13 — `transcriptRef` the judge cannot reconstruct

**Units:** `judge/calibrate.ts` ↔ `judge/criterion-judge.ts`.

**What the spine says:** labels are `(criterionId, transcriptRef, status)` "imported from QA artifacts" (AD-8). The judge takes "the transcript up to the evaluated reply, the case's expected behavior, the criterion `passCondition` and `layer`" (AD-7).

**Construction A (calibrate):** `transcriptRef = 'runs/suites/<runId>/P-07.json#step:2'` — only suite-generated transcripts can be labeled; QA's existing Confluence/Slack transcripts (the actual "QA artifacts") cannot be imported; `minLabels: 40` is unreachable until the suite has run many times, so the judge is advisory for weeks and the baselines carry no meaning signal. **B (calibrate):** `transcriptRef` is a Confluence URL; `calibrate.ts` cannot build `JudgeInput`, so it compares the human label against the judge's output **stored in the referenced run** — a different judge call than `evaluate` would make, with a different transcript cut. Both legal.

**Tightened AD-8 text:**
> `labels.json` entries are self-contained: `{ criterionId, status, transcript: { turns: [{ role: 'user' | 'coach', text }], evaluatedReplyIndex }, source: { kind: 'qa-session' | 'suite-run', ref }, labeler, labeledAt }`. `suite:calibrate` builds `JudgeInput` from the entry and the case record exactly as `evaluate` does (same function, H11) and compares. A `suite:calibrate --import <qa-export.json>` adapter converts QA transcripts to this shape; the `ref` is provenance only and is never dereferenced by the judge.

---

## H14 — L2 cannot observe bundle metadata, and AD-12 forbids the only fix

**Units:** `rules/registry.ts` (P-09 "bundle staged metadata", P-10 `answer_then_bundle`) ↔ L2 executor ↔ AD-12 ("the only product-side change this spine authorizes is `ClockPort`").

**Facts:** the orchestrator stores `bundleReply`, `reportingDisclosureVersion`, mode, etc. in outbound `metadata`; `GET /dev/conversation/:id/messages` selects `id, direction, text, occurredAt, traceId` only. So at L2 `TurnTrace` and `reply.metadata` are empty.

**Construction A (rule):** `answer-then-bundle` rule: `turn?.bundleReply === 'answer_then_bundle' ? PASS : FAIL` → P-10.C2 FAILs at L2 forever. **B (rule):** `if (!turn) return PASS` → vacuous PASS at L2; the diff then reports P-10.C2 `fixed` the first time L2 runs. **C (L2 executor):** adds `metadata` to the `/dev` select — violates AD-12 as written.

**Tightened AD-6 text:**
> `RuleOutcome.status: 'PASS' | 'FAIL' | 'NOT_OBSERVABLE'`; each registry entry declares `requires: ObservationField[]` (`reply.text`, `reply.messages[].metadata.bundleReply`, `turn.mode`, `state.<query>` …). `evaluate` checks `requires` against the `CaseRun.observed: ObservationField[]` the executor declares before calling the rule; a missing field yields criterion `NOT_RUN` reason `unobservable:<field>@<level>` and the coverage table shows it. Rules never branch on `level`.

**Amended AD-12 text:**
> Product-side changes authorized by this spine: (1) `ClockPort` and its injection (AD-5); (2) **additive read-only fields on existing `/dev` GET endpoints** in `dev-simulate.controller.ts` (`metadata` and `jobStatus` on messages; counts on `survey-state`), which is development-module-only code with no production route. No change to orchestrator behaviour, prompts, or any non-dev route.

---

## H15 — Fixture failure: INVALID or ERROR?

**Units:** executors (fixture builders) ↔ `score.ts`.

**What the spine says:** AD-9: failed precondition → INVALID; executor error → ERROR; Conventions: infrastructure errors retry once. Case-mapping: "Fixture or precondition check failed before the step (e.g. no uncovered topic) → INVALID". `PreconditionResult[]` is unspecified.

**Construction A (L2):** `POST /dev/reset-user` returns 500 → `PreconditionResult { ok: false }` → every criterion INVALID; no retry (INVALID is not an error). **B (L2):** same 500 → `SuiteExecutionError{kind:'infrastructure'}` → retry → ERROR. **C (L1):** `pulseCycle` fixture seeds a window but the orchestrator finds no uncovered topic because the seed is wrong → INVALID in A's world, `FAIL` on "moves toward uncovered topic" in a build that only checks preconditions when the fixture builder throws.

**Tightened AD-9 / AD-4 text:**
> Each fixture builder returns `{ apply(): Promise<void>, verify(): Promise<PreconditionResult> }`. Failure **inside `apply()`** (exception, HTTP non-2xx, transport) is an executor error classified by kind and retried per Conventions; the case ends `ERROR` reason `fixture-apply:<name>`. A false `verify()` after a successful `apply()` (state not as declared: no uncovered topic, no pending bot question, disclosure not delivered) is `PreconditionResult { fixture, ok: false, detail }` and makes every criterion `INVALID` reason `precondition:<name>`; executors must call `verify()` for every fixture in `setup` and record all results in `CaseRun.preconditions`.

---

## H16 — Retry unit, and reusing `failure-classifier` as typed is impossible

**Units:** executors ↔ `gate/failure-classifier.ts` ↔ rules (`repeated-question`, P-08 "no two consecutive replies without a cause question").

**Facts:** `classifyFailure({ reports: ScenarioRunReport[], reportCount, output: string })` is typed over the old report and Vitest stdout; the suite has neither. Conventions: "infrastructure classification reuses `gate/failure-classifier.ts`; infrastructure errors retry once".

**Construction A (executor):** retries the **step**: re-sends the inbound. At L1 the transcript now has two identical inbounds; `repeated-question`/P-08 counting changes; at L2 the first job may still complete → two outbounds for two traceIds (H1's `unsolicited`). **B (executor):** retries the **case** from fixtures. Different transcripts, different statuses, both legal. **C (executor):** to satisfy "reuses failure-classifier", wraps its error into a fake `ScenarioRunReport` with `agentTurnErrors` — the classifier's transport regex then decides the kind by matching the error message string.

**Tightened Conventions / AD-4 text:**
> The retry unit is the **case**: on an infrastructure `SuiteExecutionError` the executor discards the `CaseRun`, re-applies fixtures (fresh persona) and re-runs; `CaseRun.attempt` records the attempt number; a step is never re-sent inside one attempt. Classification: extract the pure predicates `isTransportFailureMessage(text)` and `isTransportOnlyAgentFailure(errors)` from `failure-classifier.ts` into `gate/failure-kind.ts` and import those; `classifyFailure` itself stays for `run-gate.ts`. Judge transport failures are retried once **inside** `evaluate` per meaning check and never cause a case retry (H20).

---

## H17 — `reset-user` keeps history by default; `personaReset` as a fixture makes L1 NOT_RUN

**Units:** L2 executor ↔ `loader.ts` (case `setup`) ↔ L1 executor.

**Facts:** `POST /dev/reset-user` defaults `deep: false` (conversation history kept); it takes internal `userId` + `tenantId`, while `simulate-message` takes an external user id. Case-mapping lists `personaReset (L2)` as a fixture "used by P-07, P-09, P-10".

**Construction A (case author):** P-07 `setup: ['pulseCycle', 'disclosureDelivered', 'personaReset']` → L1 `supports('personaReset') === false` → P-07 NOT_RUN at L1 — the one level it must run at. **B (case author):** omits `personaReset`; L2 executor calls `reset-user` without `deep` → P-05 "no reference to history" is judged against last week's transcript → spurious FAIL; P-09's "records count before run" counts stale evidence.

**Tightened AD-4 / AD-14 text:**
> Isolation is an **executor obligation implied by `runProfile: 'isolated'`**, never a `setup` fixture; `personaReset` is removed from the fixture list. L2 isolation = a fresh external user id `suite-<runId>-<caseId>` resolved through `GET /dev/find-conversation`, then `POST /dev/reset-user { userId, tenantId, deep: true }`, then a verification that `GET …/messages` is empty; the resolved `{ externalUserId, userId, conversationId, tenantId }` is recorded in `CaseRun.subject`. L0/L1 isolation = new harness and repositories per case. `freshPersona` remains a fixture meaning "no seeded memory/style/survey state" and every executor supports it.

---

## H18 — The proactive worker fires into the dev conversation during the poll

**Units:** L2 executor ↔ `conversation-suite-l2.yml`.

**Facts:** the L2 workflow "starts `api` and `worker` from the checkout"; the same worker runs the proactive scheduler (currently hourly in production per project memory); `simulate-proactive-scan` and `force-checkin` exist on `/dev`. Nothing in AD-14/AD-15 disables proactive scheduling for L2.

**Construction A (workflow):** worker boots with defaults; a check-in lands mid-case; without traceId attribution (H1) it is the reply. **B (workflow):** sets whatever env disables scheduling. Both legal; results differ.

**Tightened AD-15 / AD-14 text:**
> The L2 workflow starts the worker with proactive scheduling disabled for conversation cases (the flag is to be named in the first L2 story and recorded in `suite.config.json.l2.workerEnv`), and the L2 executor fails the run as `ERROR kind:'infrastructure'` reason `unsolicited-outbound` if any `conversation` case observes an outbound with a foreign `traceId` **before** the step's reply — a signal the environment is not isolated. `observation` cases (P-06) at L2 are deferred until a `/dev` scheduler driver exists.

---

## H19 — A PR changes the prompt and accepts its own baseline

**Units:** `conversation-sim.yml` PR job ↔ `suite:baseline:accept`.

**What the spine says:** the L1 PR job "fails on a failing `suite:diff`"; baselines are committed JSON changed only by `baseline:accept` "so a baseline change is a reviewable diff in a PR" (AD-11).

**Construction A (CI):** diffs against `baselines/` **in the PR checkout**. A PR touching `prompts/**` also commits a regenerated baseline → diff clean → required check green. Reviewability is only as good as a reviewer noticing a 37-line JSON change. **B (CI):** diffs against the merge-base baseline. Both legal.

**Tightened AD-15 / AD-11 text:**
> The PR L1 job diffs against the baseline at the merge-base (`git show $(git merge-base HEAD origin/main):packages/conversation-sim/baselines/<suite>/L1.json`), never against the PR's own copy. A PR that modifies `baselines/**` must carry the label `baseline-change`, a `CODEOWNERS` review from the QA owner, and the `runs/suites/<runId>` artifact link in its description; the workflow fails when `baselines/**` changed without the label. `baseline:accept` refuses a run with `git.dirty: true` unless `--allow-dirty`, and writes `acceptedFrom: { runId, gitSha, ciRunUrl? }` into the baseline.

---

## H20 — Judge transport or schema failure has no status

**Units:** `judge/criterion-judge.ts` ↔ `score.ts`.

**What the spine says:** AD-9's ERROR is "executor error". AD-7 validates judge output with Zod. Nothing says what a judge timeout or schema violation produces.

**Construction A:** throw → `evaluate` throws → runner marks the whole case ERROR (including rule criteria that already passed). **B:** catch → `status: 'FAIL', reason: 'judge-error'` → counted as a product regression. **C:** catch → PASS with `advisory`. All legal.

**Tightened AD-7 / AD-9 text:**
> A judge call that fails transport (after one retry) or returns schema-invalid output yields the criterion `ERROR` reason `judge-transport` | `judge-invalid-output`, affects only that criterion, and makes the run INCOMPLETE. Judge ERRORs are listed separately in the report and the step summary, and the runner exits non-zero with a distinct code so CI can distinguish "coach regressed" from "judge infrastructure".

---

## H21 — `StepObservation.index` base

**Units:** L0 executor ↔ `evaluate.ts`.

**Construction A:** `index` is 0-based (array position); `reply:1` → `steps[1]`. **B:** `index` is 1-based like `CoachHarness` turns (`this.turns.length + 1`) and the suite documents ("reply 5 answers"). Off-by-one with no type error.

**Tightened AD-3 text:**
> `StepObservation.index` is 1-based and equals the step's position in `case.steps`; `reply:<n>` and `after-step:<n>` refer to it. The Zod schema refines `1 ≤ n ≤ steps.length` at load and `evaluate` asserts `run.steps[i].index === i + 1`.

---

## Proposed new ADs (consolidating the above)

**AD-17 — Observation attribution and completeness per level.** Replies are attributed by `traceId` (H1); product silence is `reply: null`, not ERROR (H2); each executor declares `CaseRun.observed: ObservationField[]` and rules declare `requires` (H14); `CaseRun.state` has `before/after/afterStep` (H9); `StepObservation.index` is 1-based (H21); `CaseRun.window` exists for observation cases (H3).

**AD-18 — Scope and isolation are declared in the case and owned by the runner.** `SuiteCase.levels` and `kind` (H3); `advanceClock` implies `clock` and `interMessageGapMs` is uniform (H5); isolation is implied by `runProfile`, not a fixture (H17); fixtures split `apply/verify` and map to ERROR/INVALID (H15); case-level retry (H16); checkpoints are rule-only step annotations with explicit propagation (H8).

**AD-13 (rewritten) — Samples, baselines and diff categories.** One run id = one invocation with `n` samples; baseline records `{status, passCount, n}`; `minSamples` per level for accept and diff; `inconclusive` and `lost-coverage` categories; merge-base baseline in CI; label + CODEOWNERS on `baselines/**` (H6, H7, H19).

**AD-8 (rewritten) — Judge trust pipeline.** `agreement.json` written only by `suite:calibrate`; `JudgeTrust` computed by the runner and passed to `evaluate`; self-contained labels; env may not silently override the pin; judge failures are per-criterion ERROR (H10, H11, H12, H13, H20).

**AD-5 (tightened) — Clock covers persisted timestamps too** (H4).

**AD-12 (amended) — Additive `/dev` read fields are authorized** (H14, H2).

## What the spine already gets right (not holes)

- The bundle is composed into one outbound (`composeBundleReplyText`), so "answer + bundle" does **not** create a two-message reply; the multi-outbound risk is from proactive check-ins and retries, not from bundling.
- Outbound messages already carry the inbound `traceId`, so H1's fix needs no product change.
- AD-2's keying by `criterionId` is correct and is what makes H7's `lost-coverage` category computable.
- AD-6's "wrap, don't copy" of `findViolations` is safe because those rules only read `responseText` and turn index.

## Count

21 holes (6 × S1, 12 × S2, 3 × S3), closable with two new ADs (AD-17, AD-18), two rewrites (AD-8, AD-13), one amendment (AD-12) and tightenings to AD-1, AD-3, AD-4, AD-5, AD-7, AD-9, AD-14, AD-15 and the Conventions table.
