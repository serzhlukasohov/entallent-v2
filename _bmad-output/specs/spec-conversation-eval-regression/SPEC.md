---
id: SPEC-conversation-eval-regression
companions:
  - brownfield.md
  - case-mapping.md
  - architecture-diagrams.md
  - ../../planning-artifacts/architecture/architecture-conversation-eval-regression-2026-10-17/ARCHITECTURE-SPINE.md
sources: []
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Derived from `.memlog.md`. Confluence pages 189333505 (suite) and 176029697 (framework) are provenance; `case-mapping.md` holds the transcribed cases; the adopted `ARCHITECTURE-SPINE.md` (AD-1..AD-18) fixes the how.

# Conversation Evaluation Regression Framework

## Why

QA runs the Framework v2.1.1 suites by hand in Slack: 10 P-cases, 37 criteria, 60-second waits, one run per persona per pulse cycle. A run cannot be repeated per commit, so prompt and orchestration changes ship and regress a round later (GC round 3 brought 13 tester reports, three of them regressions of round-2 fixes). The repository already holds most of the machinery: LangWatch Scenario drives `packages/conversation-sim` against the real orchestrator, a deterministic scripted-model path exists, and development-only `/dev` endpoints exercise the full API, queue, worker and database path without Slack. What is missing is the layer that turns the Confluence suite into executable cases, scores them per criterion the way the framework prescribes, and tells regressions apart from noise. This spec is that layer, for the P-suite first and the other three suites next.

## Capabilities

- **CAP-1 — Case as data**
  - **intent:** The primary executable unit is an atomic test: seeded state and seeded conversation history, exactly one user turn or proactive trigger, and the criteria evaluated on that one reply or that step's effects. Each Confluence P-case is decomposed into atomic tests, one per evaluated moment; a small set of P-cases also runs as verbatim multi-turn smoke journeys mirroring the Confluence case. Every test carries the id, requirement, setup fixtures and a criteria table with layer, evaluated reply, pass condition and check type.
  - **success:** Every testable criterion of the conversation cases P-01..P-05 and P-07..P-10 is covered by an atomic test, and P-06 by its observation test; at least two P-cases (including P-09) exist as smoke journeys; loading rejects a test whose expected behavior has no criterion, or a criterion missing layer, evaluatedAt or checkType (framework 3.1 rule).

- **CAP-2 — Framework statuses and verdict**
  - **intent:** Every criterion of a run receives exactly one framework status, and the run is scored and judged per framework sections 5 and 6.
  - **success:** Report shows PASS / FAIL / NOT TESTABLE / INVALID / ERROR / NOT RUN per criterion; pass rate per layer is PASS/(PASS+FAIL); any S FAIL yields NOT ADEQUATE; a run with ERROR, INVALID or unplanned NOT RUN is INCOMPLETE with a provisional verdict; pass rates and the verdict count atomic and observation tests, and smoke journeys are reported separately.

- **CAP-3 — Rule-based checks**
  - **intent:** Criteria tagged rule-based are decided by named deterministic checks, without a model call.
  - **success:** The same transcript yields the same status on every run; each rule is one entry in a registry that a case references by name; the registry reuses the existing `findViolations` rules.

- **CAP-4 — Meaning-based checks with calibration**
  - **intent:** Criteria tagged meaning-based are decided by an LLM judge on the reply named by evaluatedAt, and the judge is trusted only after it agrees with human labels.
  - **success:** One structured PASS/FAIL/reason/evidence per criterion, judged by meaning with the transcript up to that reply; a PASS carries a verbatim fragment of the evaluated reply as evidence, and fixture context is reference, never evidence; the report carries the judge's agreement with the labeled calibration set; below the threshold, meaning-based statuses are marked advisory and excluded from the verdict; every meaning-based FAIL is listed for QA review.

- **CAP-5 — Deterministic executor (L0)**
  - **intent:** Cases whose criteria are rule-based or depend on time can run offline, deterministically and in seconds.
  - **success:** With a scripted model and an injected clock, P-06 (initiation, 48-hour spacing, working hours, timezone), the working-hours setup of P-01 and the gap of P-04 (L0 evaluates only rules over orchestrator-produced inputs (time, cadence, message metadata, state, events), never over reply text the test scripted) pass or fail from the scheduler and orchestrator code alone; the executor runs in PR CI.

- **CAP-6 — Orchestrator executor (L1)**
  - **intent:** Cases run against the real orchestration and prompts with a live model, in the exact state the suite setup describes.
  - **success:** P-01..P-05 and P-07..P-10 run via `CoachHarness` with fixtures for pulse cycle (window, uncovered topics, index progress 0/3), pending bot question, fresh persona and delivered disclosure; criteria the suite checks on the dashboard are asserted on repository state and labeled with the substituted method.

- **CAP-7 — Application executor (L2)**
  - **intent:** The same case records can verify what only the full application path shows: queueing, persistence and dashboard counts.
  - **success:** Through the development endpoints against local API, worker, Postgres and Redis, P-09 dashboard criteria read from `survey-state` and the admin read model; `reset-user` restores the persona before each run; a failed precondition marks the case INVALID instead of FAIL. L2 runs the smoke journeys only; atomic tests run at L0 and L1, because seeding history at L2 would need a development write path. An L2 report shows the verdict as n/a (journeys only); journey rule and S regressions fail the diff, journey meaning results are reported.

- **CAP-8 — Baseline and regression diff**
  - **intent:** Each run is persisted per criterion with git sha, models and level, and compared with the last accepted baseline.
  - **success:** The diff lists criteria that moved PASS to FAIL (regression) and FAIL to PASS (fixed); thresholds apply per criterion over N runs; a seeded prompt regression (removing the cause question in P-08) is flagged in one gate run.

- **CAP-9 — CI schedule by level**
  - **intent:** Each executor runs where its cost and signal fit.
  - **success:** L0 on every PR in `ci.yml`; L1 nightly and required on PRs touching prompts, the orchestrator or `packages/conversation-sim`; L2 weekly with docker services; results appear in the GitHub step summary and as artifacts.

- **CAP-10 — Requirement coverage**
  - **intent:** The report shows which EP1 requirement each case and criterion verifies, and why a criterion is not testable.
  - **success:** Report includes the CF requirement to case to criterion table; NOT TESTABLE criteria carry the reason from the suite.

- **CAP-11 — Optional observability**
  - **intent:** Runs can be viewed in LangWatch cloud without becoming dependent on it.
  - **success:** With `LANGWATCH_API_KEY` set, L1 runs stream to LangWatch; without it, results are identical locally.

- **CAP-12 — Step evidence and vacuous-pass guards**
  - **intent:** Every L0/L1 run records what happened inside each step, and a criterion cannot pass on state that already held before the step.
  - **success:** Each run carries an ordered event log (port, method, step, result) for model calls, repository writes and outbox effects; change-type state criteria assert the change caused by the evaluated step and are INVALID when already satisfied in the before-snapshot, while invariant state criteria are checked as they stand; every rule has an L0 fixture on which it must FAIL.

## Constraints

- TypeScript-only; retired MAF and `agent-service` untouched.
- LangWatch Scenario stays the L1 driver; no second simulation framework and no Langfuse integration.
- Rule checks live in the test framework only; no lexical heuristic migrates into product code (ADR-013 D2).
- L0 and L1 need no Postgres or Redis; the `conversation-sim` `test` script stays offline.
- L2 targets only the local docker stack through development-only `/dev` endpoints, never Railway production.
- Suite texts are sent verbatim through scripted steps (the full sequence in smoke journeys, the single evaluated turn and the seeded history in atomic tests); the user simulator is not used for suite cases.
- The judge is pinned per suite version by fingerprint (provider, model, decoding settings, prompt hash, output schema hash, guidance hash); changing any part requires recalibration and a new baseline. When the judge and a human label disagree, the criterion's judge guidance is clarified; labels are never changed to match judge output.
- Existing `ScenarioRunReport` and gate summary consumers keep working (additive fields or a new schemaVersion).
- Case data is canonical in the repository and versioned with the code it tests.
- Product-side changes are limited to those the spine's AD-12 authorizes: `ClockPort` injection, the proactive cadence policy moved from worker SQL into `packages/application`, additive read-only `/dev` GET fields, and the failure-kind extraction inside `conversation-sim`.
- Meaning-based statuses count toward the verdict only after judge calibration passes (spine AD-8); until then the PR gate decides on rule and S criteria.

## Non-goals

- Automating the Slack channel end to end (signing, Socket Mode, delivery).
- Replacing manual QA runs or the framework's human review of judge FAIL verdicts.
- Editing the Confluence framework or suites.
- A UI for results beyond Markdown, JSON and CI summaries.
- Covering the Conversation Quality, Safety & Trust and D suites in the first slice; the case format must not preclude them.
- Changing prompts or orchestration to make cases pass; a failing case is a finding.

## Success signal

One command runs P-01..P-10 at L0 and L1, prints the framework scoring table and verdict, writes per-criterion JSON, and a seeded prompt regression flips the next run to a flagged diff. QA accepts the report in place of the manual sheet for the P-suite's testable criteria.

## Decisions taken

- First slice is L0 plus L1 on P-01..P-10; L2 is the second slice.
- Human labels for judge calibration come from QA manual-run artifacts produced under the execution playbook, imported into the self-contained label format (spine AD-8).
- Confluence remains the human-readable mirror of case data, updated by hand.
- L0 P-06 tests the specified cadence with configuration as input; the temporary hourly production override is not the requirement; the cadence predicates move into an application policy so L0 can reach them.
- The P-suite runs in the framework's Isolated profile (fresh persona per case); Sequential and Anytime profiles are not needed for the first slice.
- Atomic tests are the primary unit and verbatim smoke journeys complement them; L0/L1 runs record a per-step event log; judge verdicts carry evidence from the reply; amended on 2026-10-24 by `planning-artifacts/sprint-change-proposal-2026-10-24.md` and `sprint-change-proposal-2026-10-24-b.md` (source manifest per suite, QA-approved seeds, L0 limited to time, cadence and rule criteria).
- Cases are typed TypeScript modules; one executor port with three adapters; `ClockPort` instead of fake timers; baselines committed in the repository; everything lives under `packages/conversation-sim`; a per-criterion structured judge instead of the Scenario verdict.

## Open Questions

- Working hours: the suite requires proactive messages only 09:00-18:00 local, while code default quiet hours are 22:00-08:00. Which is the requirement? Under current defaults P-06 fails by design.
- Confluence open items 1-4 and 7 (bot-initiated vs continuation, weekends, reactive effect on the 48-hour timer, P-05 opening, what the bot may say about progress) block two NOT TESTABLE criteria and the P-06 rule definitions.
- Judge calibration: agreement threshold and minimum labeled set size before meaning-based statuses count toward the verdict.
- LangWatch cloud account for QA review of judge verdicts, or local artifacts and CI summaries only?
- When QA edits a case: repository PR by QA, or a generator from Confluence?
- Numeric thresholds left as assumptions in the spine: agreement 0.85 and kappa 0.6 over at least 40 labels, `minSamples` L1 5 / L2 3 for baselines and 3 for diffs, meaning pass threshold 80 percent of samples, budgets 600 coach and 150 judge calls per sample set.
- Does a QA CODEOWNERS entry for `baselines/**` exist, or must one be created?
- Does QA accept atomic decomposition plus verbatim smoke journeys as the report that replaces the manual sheet? Which P-cases are the smoke journeys (proposed: P-09, P-10)?
