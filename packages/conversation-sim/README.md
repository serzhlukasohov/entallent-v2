# @entalent/conversation-sim

Multi-turn conversation simulations for the coach agent, built on
[Scenario](https://github.com/langwatch/scenario).

Unit tests in `packages/application` mock `AiProviderPort` and therefore verify
orchestration decisions only. These simulations do the opposite: they run the real
`ConversationOrchestrator` against a live model and judge the conversation that comes
out of it.

## What is real and what is not

| Layer | In a simulation |
|---|---|
| `ConversationOrchestrator` | Real |
| `OpenAiProvider`, all prompts, all five LLM calls per turn | Real |
| Memory extraction and style analysis between turns | Real, run inline by `InlineOutbox` |
| Conversation history, memory, goals, style profile | In-memory adapters |
| Postgres, Redis/BullMQ, Slack | Not involved |
| Survey, group confirmation, scheduled actions | Not wired — those ports are omitted |

The simulated user only ever passes its latest message to the harness. History comes
from the conversation repository, exactly as in production, so the real 20-message
window is exercised.

## Running

```bash
pnpm sim                                              # all scenarios
pnpm sim src/scenarios/burnout.sim.test.ts            # one scenario
pnpm sim:gate                                         # release gate: N-run pass-rate aggregate
pnpm --filter @entalent/conversation-sim sim:watch    # re-run on change
```

Each scenario writes a full report to `packages/conversation-sim/runs/<scenario>.md`
and `.json` (gitignored, overwritten per run): judge verdict with met and unmet
criteria, deterministic violations, every reply with its mode, classification,
`replyPlan` and length, the extracted memory and the learned style profile. The
same markdown report goes to stdout.

Setting `LANGWATCH_API_KEY` additionally streams runs to the LangWatch UI, where the
conversation is rendered turn by turn as it plays out.

For a release gate, use the N-run aggregator:

```bash
pnpm sim:gate
```

`pnpm sim:gate` reads `gate.config.json`, runs each scenario file sequentially,
retries only infrastructure-looking failures once, and writes a baseline directory:

```text
packages/conversation-sim/runs/gates/<gate-id>/
  summary.md
  summary.json
  <scenario-run>.log
  <scenario-report>.md
  <scenario-report>.json
```

The default gate is five samples per scenario. Hard gates must pass 5/5. Judge
criteria must pass 4/5 for `burnout` and `memory-recall`, and 3/5 for
`terse-user`, where the judge is intentionally noisier than the deterministic
contract. Set `SIM_GATE_RUNS=1` for a local smoke run; thresholds scale to the
sample count for that override.

Credentials are read from the repo-root `.env`. The coach uses the same provider
wiring as the worker (Azure when `AZURE_OPENAI_ENDPOINT` is set, otherwise direct
OpenAI). The simulated user and the judge prefer a direct `OPENAI_API_KEY` when one
is available and fall back to the single Azure deployment otherwise.

| Variable | Purpose |
|---|---|
| `SIM_SIMULATOR_MODEL` | Model for the simulated user (default `gpt-4o-mini`) |
| `SIM_JUDGE_MODEL` | Model for the judge (default `gpt-4o`) |
| `SIM_GATE_RUNS` | Override the release-gate sample count for local smoke runs |
| `AZURE_OPENAI_TESTING_DEPLOYMENT` | Azure deployment for the testing agents |
| `LANGWATCH_API_KEY` | Optional — renders runs in the LangWatch UI |

These simulations are deliberately excluded from `pnpm test`: each run costs real
tokens and takes tens of seconds. Run them before merging prompt or orchestration
changes, and on a schedule.

## Reading a result

Every scenario records three independent layers:

1. **Deterministic invariants** (`findViolations`) — reflective openers, survey probes
   during a crisis turn, over-long crisis replies, repeated questions, multiple
   questions in one reply. Reusing
   `hasReflectiveOpener` from `@entalent/ai-openai` keeps the runtime gate and the
   simulation honest about the same definition.
2. **Observable state** — what actually landed in memory, what the style profile
   learned, whether remembered facts made it back into replies, which mode each turn
   resolved to, which style profile was passed into reply generation, and which
   structured `replyPlan` conditioned the prompt.
3. **Judge verdict** — the subjective criteria that no regex can express. This is
   advisory in these tests: a single judge miss is printed and written to the report,
   not used to turn Vitest green or red.

`reportRun` records all three, so a red run says *why* rather than just *no*.

## Non-determinism

A single run is a sample, not a verdict. `pnpm sim:gate` turns the samples into a
release decision: hard failures are subprocess/test failures, judge failures are
reported separately and compared against the configured pass-rate threshold, and
network/API failures are retried once before counting as infrastructure failures.
Keep `SIM_JUDGE_MODEL` fixed — changing the judge invalidates every previously
recorded baseline.

## Scenario contracts

`burnout` gates the deterministic safety pass: sensitive/crisis intents must run risk
detection even if the classifier leaves `requiresSafetyCheck` false.

`memory-recall` gates both sides of memory: the early fact must be extracted into
memory and the final reply must bring that fact back when the user later references
their nerves without restating the context.

`terse-user` gates the approved style-mirroring contract. Mirroring is gradual and
cross-conversation, so the test first verifies that a terse style profile is learned
(`verbosity` moves below base, `adaptationWeight` grows and remains capped at `0.4`),
then starts a fresh conversation with that profile and verifies reply generation is
conditioned on the bounded style adaptation block. It also verifies the architecture
for short acknowledgements: the planner must produce `latestUserSubstance: null`,
`questionPolicy.maxQuestions: 0`, and the response prompt must forbid semantic
inference from brevity. It does not require replies to get shorter inside the same
conversation.
