---
title: 'Repair existing simulation evidence and gate'
type: bugfix
created: '2026-10-06'
status: complete
baseline_commit: c31f092a6a007833dd99e126a907e793dc499772
review_loop_iteration: 1
context: []
---

# LangWatch / Scenario project audit

Date: 2026-10-06. BMad analysis phase, Mary / business analyst.
Repository: enTalentNew. Reviewed HEAD: c31f092a6a007833dd99e126a907e793dc499772 plus the existing dirty working tree.
Status: repository audit complete; current live-model acceptance unverified.

## Decision

Expand coverage of critical AI behavior, not every project module through Scenario.
Keep deterministic unit, integration, queue, security, and UI checks as complementary layers.
Repair evidence quality before multiplying expensive live scenarios.

## Scope and acceptance criteria

- Identify integration boundaries, existing scenarios, evaluation rules, and CI entry points.
- Assess strengths and false-positive/false-negative risks from source and stored reports.
- Run selected deterministic checks against rebuilt workspace dependencies.
- Recommend a prioritized expansion with explicit acceptance criteria.
- Do not change runtime, prompts, workflow behavior, production, or existing unrelated edits.

This is a local repository analysis, not an audit of the remote LangWatch workspace or a market comparison.
No live models, external telemetry, Slack payloads, or production operations were invoked.

## Current architecture

`@langwatch/scenario` 0.4.15 is installed in `packages/conversation-sim`.
The integration is concentrated in that package; no LangWatch runtime instrumentation was found in apps.
Scenario executes conversations through `createCoachAgent` -> `CoachHarness` -> the real TypeScript `ConversationOrchestrator`.
The coach uses the real `OpenAiProvider` unless a scripted provider is injected.
Classification, risk detection, response planning/generation and inline memory/style use cases can be real.
Persistence is in memory. The outbox runs memory/style inline and simulates successful message delivery.
PostgreSQL, Redis/BullMQ and Slack are outside this harness.
Survey-evidence processing and team-report enqueue methods are no-ops; selected scenarios inject narrow survey reads.

User turns in the reviewed live tests are scripted. The user simulator adapter is largely present to satisfy Scenario's user-agent requirement.
Therefore this is mainly repeatable replay coverage, not a broad exploration of generated employee behavior.
Judge models default to gpt-4o; the simulator defaults to gpt-4o-mini.
Azure-only configuration can collapse testing agents onto the same deployment.

LangWatch telemetry is optional. Selected tests explicitly disable it, and GitHub simulation CI sets LANGWATCH_API_KEY empty.
The cloud UI is a viewing/reporting destination, not required for local execution.
The local JSON/Markdown reports and gate summary are the available evidence examined here.

## Inventory

There are 14 scenario test files and 10 entries in gate.config.json.

| Scenario / group | AI dependency | What it actually verifies |
| --- | --- | --- |
| burnout | live coach + judge | safety routing and subjective supportive response |
| memory-recall | live coach + judge | extraction, memory anchors, required grounding, final recall |
| terse-user | live coach + two judge verdicts | bounded learned style, next-conversation conditioning, question discipline |
| annna-intent-fidelity | live coach + judge | corrections, closing, direct address, unsupported personal memories |
| pulse-capture-exact-message | live coach, no judge | three source-selection variants and outbound provenance; survey reads mocked |
| crisis-self-harm | scripted AI | safety policy handling and escalation for injected crisis classification/risk |
| harassment | scripted AI | sensitive routing and survey blocking for injected harassment classification |
| privacy-manager-request | scripted AI | privacy response/risk plumbing with an already scripted refusal |
| proactivity-reminders | scripted AI / deterministic policy | scheduling, duplicate reminder suppression, risk postponement, opt-out cancellation |
| planning-memory | scripted AI | goal transitions, memory supersession, preparation/casual routing |
| resolved-detail-question-planning | live coach + judge/control | prevents reopening resolved clarification; absent from release gate |
| migration-baseline | deterministic metadata | manifest/gate mapping, not behavioral adequacy |
| reporting-disclosure-receipt | fake repository | delivered disclosure receipt semantics |
| simulation-repositories | fake repository | harness adapter contracts |

The last three files are also absent from the release gate. They are support tests, unlike the omitted live resolved-detail regression.
The package `test` script runs only `src/gate`; it does not run the structural scenario files.
`pnpm sim` includes live and deterministic scenarios. Ordinary deterministic CI is not a live-model acceptance gate.

## Evaluation and CI

Per-scenario checks combine deterministic transcript rules, observable state assertions and subjective judge criteria.
Most individual live tests warn on judge failure; `sim:gate` enforces aggregate judge thresholds.
Resolved-detail differs: it directly asserts judge success.
Default gate: five executions per configured scenario, 50 scenario-file executions total.
Four live judge scenario entries require respectively 4/5, 4/5, 3/5, 4/5 judge successes.
The fifth live entry, CAP-8, requires hard assertions only. Five entries use scripted AI.
Sensitive scenarios retain manual-review-required status even after automated thresholds pass.
Infrastructure retries are classified separately from product assertions; the classifier has five unit tests.

The workflow supports manual runs and opt-in daily/weekly schedules, with one/five samples respectively.
It has no pull-request trigger. Missing credentials or disabled schedule produce a skipped simulation.
CI treats manual_review_required as a warning/success; this does not constitute a recorded human acceptance.
The reviewed configuration cannot establish whether remote opt-in variables or branch protections are enabled.

## Strengths

- Exercises real orchestration and prompts instead of merely mocking every AI decision.
- Verifies memory, goals, style and provenance, not just attractive response text.
- Uses reproducible scripts and separate hard/judge results.
- Aggregates samples and avoids retrying obvious product assertions as transport failures.
- Includes known failures as regression cases and preserves human review for sensitive behavior.

## Evidence quality gaps

1. **Reports precede assertions.** Memory, terse, Annna and structural tests can write all-clear reports before later assertions fail. The existing open reflection entry is still applicable.
2. **Gate does not consume deterministic report status.** `runSample` defines hardPassed from exit status and report existence, ignoring `report.deterministic.passed`. CAP-8 writes a generic violations report without asserting those generic violations. A reported generic violation can therefore coexist with hardPassed=true. This is a source-confirmed logic gap, not a newly executed failing live run.
3. **Important regression omitted.** Resolved-detail planning is runnable through sim but absent from sim:gate.
4. **Safety/privacy recognition is mostly injected.** Scripted crisis, harassment and privacy cases do not prove live detection, live refusal quality or actual tenant/access isolation. Assertions over scripted response wording are weak evidence of model quality.
5. **Judges are not calibrated.** Stored failures document verdict variability. No reviewed human-labeled calibration set or judge confusion/error measures establish the chosen thresholds.
6. **Small, mostly English scripted suite.** It does not establish robustness to paraphrases, realistic ambiguity, multilingual conversations, attacks, long histories or broad product diversity.
7. **Limited reproducibility.** Reports record model environment labels and git SHA; a dirty tree lacks a patch hash. Azure deployment labels may not identify the underlying model revision. No prompt/fixture/judge version hashes, token/cost budget or latency acceptance are captured in the report schema.
8. **Simulation skips asynchronous behavior.** Inline memory/style and simulated delivery cannot reveal queue races, duplicate effects, database isolation or failed Slack delivery.
9. **Deterministic repetitions consume gate time.** Repeating the same scripted cases five times adds less evidence than new cases and should not be confused with five independent model samples.
10. **Documentation drifts.** README's survey-port omission description predates injected survey reads and its advisory-judge description does not describe the newer direct judge assertion.

## Verified results and limits

- Rebuilt dependencies: `pnpm --filter @entalent/conversation-sim... build` passed.
- Package typecheck: `pnpm --filter @entalent/conversation-sim typecheck` passed.
- Nine selected deterministic files: 21/21 tests passed, no external model calls.
- Included classifier, crisis, harassment, privacy, proactivity, planning, manifest and two fake-repository files.
- Test output: `/tmp/entalent-langwatch-audit-tests.log`.
- Latest stored complete gate: 2026-09-29T19-54-50-951Z, git 8e7dd71, dirty, one sample: failed. Memory hard checks passed but judge failed; terse passed; Annna hard assertions failed despite its judge passing.
- Earlier stored gate on that date gave a different memory judge result. This is historical evidence, not a current model verdict.
- Current live tests, remote LangWatch contents and remote CI configuration were not verified.

## Coverage strategy

| Product area | Recommended primary evidence |
| --- | --- |
| Intent fidelity, relevance, corrections, closing, human tone | live Scenario replay + calibrated judge + hard state assertions |
| Safety/privacy response quality | live synthetic scenarios + hard policy checks + human review |
| Memory and goal extraction, wrong memory correction | labeled extraction datasets + multi-turn replay |
| Pulse evidence A1-B3, uncertainty, negation and confirmation | labeled structured-output evaluation + exact provenance assertions |
| V2 report factuality and deidentification | synthetic input/report datasets, human review and leakage checks |
| Proactivity/reminders | policy unit tests + targeted live wording cases + queue integration |
| Tenant/auth boundaries, SQL, migrations, scoring arithmetic | deterministic unit/integration tests |
| Delivery/retry/idempotency | isolated PostgreSQL/Redis worker integration tests |
| Dashboard/onboarding | browser/UI tests |

Scenario can later drive an adapter backed by an isolated worker/API, but that is a new harness with real integration assertions, not a property of the current setup.

## Prioritized BMad follow-up

1. **Trustworthy results:** report all hard assertions, fail the gate on deterministic violations, test aggregation/threshold/manual-review rules, include resolved-detail and version fixtures/prompts/judges. Acceptance: deliberately bad artifacts fail; no failed hard test has an all-clear artifact.
2. **Calibrate one AI vertical:** select intent/correction or Pulse evidence; assemble 30-50 synthetic, human-labeled positive/negative/borderline cases and paraphrases. Compare unchanged baseline and candidate with fixed models. Measure judge disagreement, observed flakiness, latency and cost. Define acceptance from product risk rather than arbitrary pass rates.
3. **Cover critical AI journeys:** add safety, privacy, memory correction, Pulse confirmation, opt-out and multilingual cases with explicit hard-versus-subjective criteria.
4. **Add integration evidence:** isolated persistence/queue adapters for selected journeys; retain faster in-memory replay for prompt iteration.
5. **Choose rollout from pilot evidence:** cheap deterministic checks on PRs; bounded live AI gate for affected AI changes; wider opt-in scheduled evaluation; mandatory human review where policy requires it.

Do not revive the retired MAF runtime. Do not replace deterministic scoring/security/database checks with LLM judgments.

## Evidence pointers

- packages/conversation-sim/README.md, package.json, vitest.config.ts, gate.config.json
- packages/conversation-sim/src/harness/{coach-agent,coach-harness,assertions,report}.ts
- packages/conversation-sim/src/fakes/inline-outbox.ts
- packages/conversation-sim/src/scenarios/*.sim.test.ts
- packages/conversation-sim/src/gate/{run-gate,failure-classifier,failure-classifier.test}.ts
- .github/workflows/conversation-sim.yml
- docs/agent-failures.md: open report/assertion and judge-variability entries
- packages/conversation-sim/runs/gates/2026-09-29T19-54-50-951Z-8e7dd71/summary.json

Remaining for this audit: 0%. Current live-model acceptance and implementation of the recommendations are separate follow-up work.

## Repair scope authorized on 2026-10-06

<frozen-after-approval reason="existing harness repairs requested by the user">

Improve the existing tests without building new product scenarios or a new evaluation platform.
Preserve production behavior, existing judge criteria, unrelated local work and the retired-runtime boundary.
Given a hard assertion failure, the report must show it; given a deterministic violation, the gate must reject the sample; given the existing resolved-detail scenario, the gate must run it.
No live-model or external-service execution is required to validate these harness repairs.

</frozen-after-approval>

## Tasks & Acceptance

- [x] `packages/conversation-sim/src/harness/report.ts` -- record late assertions without losing judge evidence.
- [x] `packages/conversation-sim/src/gate/run-gate.ts` -- reject reported deterministic failures regardless of subprocess success.
- [x] `packages/conversation-sim/gate.config.json` and existing resolved-detail tests -- include the existing regression and preserve its strict assertions.
- [x] Existing deterministic tests -- verify failure evidence, gate classification and membership without external models.
- [x] Existing package test entry -- prevent deterministic harness checks from selecting live model tests through appended changed-file arguments.
- [x] Existing failure/task logs -- record repair and verification receipt.

Acceptance criteria:

- Given a report emitted before a later failed assertion, when Vitest finishes, then its JSON and Markdown record the failure and preserve the judge verdict.
- Given multiple reports in one failing test, when it finishes, then none of those reports remains all clear.
- Given a successful subprocess and a report with deterministic failure, when the gate evaluates it, then hardPassed is false with a product-failure explanation.
- Given a report with contradictory passed=true and nonempty violations, when the gate evaluates it, then the sample fails.
- Given the existing resolved-detail regression, when gate configuration is read, then the scenario is included with its existing strict judge policy.
- Given live scenario file paths appended to the ordinary test command, when deterministic checks run, then no live scenario is executed.

Verification: focused offline regressions, simulation typecheck/lint and `pnpm harness:check -- --base HEAD`. Current live AI quality remains a separate acceptance boundary.

## Repair verification receipt

Completed 2026-10-06. Reports capture late assertion and cleanup failures without leaking status across shared snapshots; gate rejects deterministic failures independently of process status; existing resolved-detail scenario is included at 5/5 hard and judge passes; ordinary tests exclude existing live scenarios.

Verification: 23/23 offline package regressions, simulation typecheck/lint, two BMad review layers after the cleanup-order repair, and `pnpm harness:check -- --base HEAD` passed.
Harness receipt: `runs/harness/receipt-1791283080186-2c934ff4.json`.
No live model acceptance was performed; preexisting live Annna and judge-calibration issues remain open. No production/runtime changes or new product scenarios.
Remaining for these harness repairs: 0%.

## Annna replay alignment follow-up authorized on 2026-10-06

<frozen-after-approval reason="user authorized diagnosis and repair of the observed replay failure">

Every reported reply plan and positional assertion must refer to its actual orchestration turn. Deterministic replies without generateResponse must have an explicit null plan slot; later generated replies must retain their own slot. Keep existing production source, prompts, live replay, judge and semantic hard expectations unchanged. Do not add features, product scenarios, deployments or retired runtime behavior.

</frozen-after-approval>

Corrected diagnosis: the original 2026-10-06 gate had deterministic bypasses at actual user turns 5, 9, 10 and 14. generateResponseCalls indexes 0..10 corresponded to actual turns 1,2,3,4,6,7,8,11,12,13,15. Report/assertions used the generation index as orchestration index. Therefore the reported turn11 closing was actually the final turn15 closing; actual turns11 and13 were both correction with user substance. No production classifier defect is proven by that gate.

An initial exploratory provider normalization/prompt patch was tested but discarded after this discovery; production source is restored. The first live verification folder annna-correction-20261006T113217Z uses that obsolete patch and invalid positional assertions and must not be treated as final acceptance.

Tasks & acceptance:

- [x] Existing coach-harness -- retain a response-call slot for every send, with null for deterministic bypass and a defined policy for multiple generation calls in one turn.
- [x] Existing report -- pair plans by actual orchestration turn, retaining final hard-failure evidence.
- [x] Existing Annna/resolved-detail/style assertions -- use the aligned slots instead of generation call ordinal.
- [x] Existing deterministic test -- execute generation -> bypass -> generation and verify correct plans and null report slot; test multiple generation calls if applicable.
- [x] Rebuilt original production dependencies, unchanged live Annna replay, review and final project harness.

Acceptance: Given a bypass in the middle of a conversation, both the next reported plan and its positional assertion still refer to the next actual user turn. Given the original live correction messages, the unchanged semantic expectations are evaluated at their own turns. All-call recording remains available for diagnostics. No production change is justified solely by the formerly misaligned artifact.

### Separately confirmed classification variance after alignment

The first correctly aligned live replay (`runs/annna-alignment-20261006/*sample-1.json`) identifies real turn 11 as request/address_new_substance with maxQuestions=1; actual turn13 is correction and actual turn15 is closing. This independently reproduces failure of the correction contract at the right turn; it is distinct from the misleading original closing artifact.

Additional authorized repair: narrowly normalize a direct first-person restated request followed by explicit rejection of the mentor interpretation (including acknowledgment prefix), and explain that distinction in classify prompt. Keep ambiguous source/evaluation/quoted content and true endings unchanged. Add existing-file regression tests for model request and closing outputs, safety preservation and independent positive/negative examples. Do not restore the unreviewed broad first matcher. Preserve the aligned harness and unchanged live semantic assertions.

### Final reviewed implementation scope

The alignment fix retains final generation call or null per completed send; failed sends append neither result nor aligned slot. New provider recovery is restricted to model request/ack; model closing remains untouched by that new path. Explicit correction prefix normalization retains its prior behavior. Guard is intentionally conservative and English; ambiguous forms continue through the model prompt.

Offline evidence: 225/225 full ai-openai tests, 15/15 harness/gate tests, package typechecks/lints, two final reviews with no actionable findings. Tests first reproduced wrong plan-slot association and real request-act mismatch; regression expectations and live replay semantic assertions stay strict.

### Final live evidence

Final focused Annna sample-3 in `packages/conversation-sim/runs/annna-final-focused-20261006` passes hard assertions and judge, with actual turns11/13 correction and turn15 closing. It completed around 67 seconds under an explicit diagnostic 900000ms limit. The normal global testTimeout remains unchanged. Earlier focused failures captured valid admissions rejected by the phrase catalog; acknowledgment meaning now remains the existing judge criterion, with the aggregate 4/5 threshold unchanged. Fixture facts are provided to the judge.

The broader one-sample gate `2026-10-06T11-57-32-609Z-c31f092` is still failed: terse subjective judgment, resolved-detail classification, and Annna timeout. Those are recorded as separate open issues. Do not treat the focused success as a full release gate or five-sample stability verdict.

### Completion

Final `pnpm harness:check -- --base HEAD` passed. Structured receipt: `runs/harness/receipt-1791289499593-a7741234.json`.
Completion criteria: correct turn/plan association including bypass/regeneration/failure recovery, evidenced request/ack correction repaired with safety preserved, no phrase-dependent false rejection, existing judge acknowledgment criterion retained, final focused live replay hard+judge pass, package regressions and deterministic project gate pass.
Remaining: 0% for this scoped Annna repair. Wider gate quality and five-sample model stability remain separate open follow-ups; no release/deployment is claimed.
