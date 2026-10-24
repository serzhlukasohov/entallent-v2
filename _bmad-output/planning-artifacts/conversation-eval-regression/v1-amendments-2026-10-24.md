# Change Input: Amendments from the v1 Evaluation Framework

- Date: 2026-10-24
- Decided by: Illia (review of PR #31 planning artifacts)
- Intended consumer: `bmad-correct-course` for SPEC-conversation-eval-regression, the architecture spine `architecture-conversation-eval-regression-2026-10-17`, and Epics 12-13.
- Source studied: the first product version, `enTalent-ai/entalentai`, `apps/orchestrator/src/runtime-v2/eval/` (README, stateful behavioral catalog, semantic judge, calibration) and `docs/testing/` (run findings 2026-09-07..2026-09-13).

## Why

The v1 product ran a provider-neutral evaluation harness for several months. Its findings documents record failure modes that the current spine does not yet guard against: judges crediting content that only existed in state, launcher configuration drift invalidating calibration silently, green rows that proved nothing because the expected state already held, and multi-turn runs whose failures were hard to localize. The amendments below adopt the parts that address those failure modes at low cost. Items considered and rejected are listed so they are not re-proposed.

## Accepted amendments

### A1. Atomic test is the primary unit; Confluence cases run verbatim as smoke journeys

- **Change:** The primary executable unit is an atomic test: seeded state plus seeded conversation history, exactly one user turn (or one proactive trigger), and the criteria evaluated on that one reply or that one step's effects. Each P-case is decomposed into atomic tests, one per evaluated moment.
- **Smoke journeys:** A small set (2-3) of the Confluence P-cases additionally runs as full multi-turn journeys with the suite texts sent verbatim, so QA keeps a one-to-one link between the report and the Confluence document.
- **Coverage:** The coverage table becomes CF requirement -> P-case -> atomic test -> criterion.
- **Rationale:** A failure is localized to one moment; no checkpoint cascade marks later criteria INVALID; the conversation prefix is deterministic, so a different bot reply in step 2 cannot change what step 4 tests; fewer model calls per criterion.
- **Known cost:** Seeded history is authored, so an atomic test does not prove the bot would reach that state on its own; the smoke journeys cover that. Criteria that are cross-turn by nature (P-08 "no two consecutive replies without a cause question", P-09 "summaries count not greater than seen") become "seeded history of N turns + one new turn".
- **Open question for QA:** The spec's success signal says QA accepts the report in place of the manual sheet. Confirm QA accepts atomic decomposition plus verbatim smoke journeys as that report.
- **Affects:** AD-1 (case shape: seeded history, single-turn steps), AD-18 (checkpoints apply only to smoke journeys), SPEC constraint "suite texts are sent verbatim" (applies to smoke journeys and to the single turn of each atomic test), CAP-1, CAP-10, Stories 12.1, 12.4.

### A2. Per-step event log at L0 and L1

- **Change:** The L0 and L1 executors wrap the ports the harness wires into the orchestrator (AI provider, repositories, outbox, scheduler-facing ports) with recording proxies. Each run produces an ordered event log: `{ stepIndex, seq, port, method, argsSummary, result | error, durationMs }`. Model calls record the effective request settings and the response.
- **Use:** Diagnostics (what happened on which step), and the substrate for A5 per-step state checks.
- **Scope:** L0 and L1 only. L2 is deferred until it is verified which audit tables cover every write by `traceId`.
- **Privacy:** Logs contain employee-like text; `runs/` stays gitignored and CI artifacts keep a bounded retention.
- **v1 precedent:** NDJSON recorder per (scenario, sample) with verbatim requests, raw arguments and world snapshots; `committedCapabilityCount` per turn.
- **Affects:** AD-3 (`CaseRun` gains `events`), AD-17 (new observation field), Stories 12.7, 13.4.

### A3. Judge verdict carries an evidence fragment from the current reply

- **Change:** For every meaning check the judge returns `{ status, reason, evidence }`, where `evidence` is a verbatim fragment of the evaluated reply that supports the verdict. The evaluator verifies that `evidence` is a substring of that reply; a missing or non-matching fragment for a PASS is `ERROR` reason `judge-invalid-output`. A FAIL for an absent behavior may carry `evidence: null`.
- **Not a golden text:** The judge still decides by meaning, not wording. A reworded reply that satisfies the criterion passes; the fragment is quoted from whatever the bot said in this run.
- **Rule:** Fixture context given to the judge (for example the canonical questions for P-07) is reference only, never evidence that the bot said something.
- **Rationale:** v1 found a single-pass judge crediting values that existed only in state; requiring a fragment of the actual reply makes that impossible and speeds QA review of FAIL verdicts.
- **Affects:** AD-7 (output schema and evaluator check), Story 13.1.

### A4. Wider judge fingerprint; fix the criterion, not the label

- **Change:** The calibration pin that invalidates `agreement.json` and baselines extends from `{ judgeModel, judgePromptVersion }` to `{ provider, judgeModel, decoding (temperature, reasoning effort, max output tokens), judgePromptSha256, outputSchemaSha256 }`. The prompt is identified by content hash instead of a hand-maintained version number. Every report prints the effective judge settings.
- **Rule:** When the judge and a human label disagree, the criterion wording is clarified; labels are never changed to match judge output.
- **Thresholds:** Keep the spine's assumptions (agreement 0.85, kappa 0.6, at least 40 labels). v1 required every calibration case to pass, but its cases were developer-authored and narrow; QA labels carry natural noise.
- **v1 precedent:** A launcher silently substituted temperature 0.8; calibration cached under a fingerprint of model, provider, decoding, prompts, schemas and corpus.
- **Affects:** AD-8, AD-11 (baseline `judge` block), Story 13.2.

### A5. Guards against vacuous passes

- **Per-step change:** `state` criteria assert the change caused by the evaluated step, read from the A2 event log, not only the absolute end state.
- **Already satisfied:** If a `state` criterion's expected outcome already holds in `state.before`, the criterion is `INVALID` reason `precondition:already-satisfied`.
- **Negative example per rule:** Every rule registry entry ships with at least one L0 fixture on which it must FAIL, next to the fixture on which it must PASS.
- **Affects:** AD-6, AD-9 (new INVALID reason), AD-10, Stories 12.2, 12.3.

## Deferred (add only when evidence appears)

- **Two-stage judge for S "nothing invented" criteria** (stage 1 extracts claims from the reply only, stage 2 checks each against the user's words). Meaning statuses are advisory until calibration passes, so low agreement on S criteria will show up there first; add the second stage then. Per-claim calibration labels are deferred with it.
- **Boundary tests per criterion** pinning criterion wording; add one when a concrete judge-human disagreement is resolved by rewording.
- **Event log at L2.**

## Rejected

- **Accumulating samples across reruns of the same commit.** Needs cross-run artifact storage in CI; rerun discipline is a process concern. N samples per criterion (AD-13) and retained CI artifacts are sufficient.
- **Full seed-consistency validator.** Would duplicate domain logic; A5 "already satisfied" covers the main vacuous-pass case.
- **Lints against fitting product prompts or code to test inputs.** The framework observes the product as it is; preventing overfitting during fixes belongs to code review.
- **Anything from `enTalent-ai/entalent-e2e`** (Cucumber, real Slack, regex reply assertions). Out of scope.

## Requested outputs from Correct Course

1. Sprint change proposal for this change.
2. Updated SPEC (capabilities, constraints, success signal, open questions), architecture spine (AD-1, AD-3, AD-6, AD-7, AD-8, AD-9, AD-10, AD-11, AD-17, AD-18), and Epics 12-13 stories with acceptance criteria.
3. Story 12.1 regenerated against the amended AD-1, and `sprint-status.yaml` updated.
4. A note that the implementation readiness report of 2026-10-19 is superseded until readiness is re-checked.
