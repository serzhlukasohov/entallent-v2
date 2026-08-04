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
pnpm --filter @entalent/conversation-sim sim:watch    # re-run on change
```

Each scenario writes a full report to `packages/conversation-sim/runs/<scenario>.md`
(gitignored, overwritten per run): judge verdict with met and unmet criteria,
deterministic violations, every reply with its mode, classification and length, the
extracted memory and the learned style profile. The same report goes to stdout.

Setting `LANGWATCH_API_KEY` additionally streams runs to the LangWatch UI, where the
conversation is rendered turn by turn as it plays out.

To measure a pass rate rather than a single sample:

```bash
for i in $(seq 5); do pnpm sim src/scenarios/burnout.sim.test.ts; done
```

Credentials are read from the repo-root `.env`. The coach uses the same provider
wiring as the worker (Azure when `AZURE_OPENAI_ENDPOINT` is set, otherwise direct
OpenAI). The simulated user and the judge prefer a direct `OPENAI_API_KEY` when one
is available and fall back to the single Azure deployment otherwise.

| Variable | Purpose |
|---|---|
| `SIM_SIMULATOR_MODEL` | Model for the simulated user (default `gpt-4o-mini`) |
| `SIM_JUDGE_MODEL` | Model for the judge (default `gpt-4o`) |
| `AZURE_OPENAI_TESTING_DEPLOYMENT` | Azure deployment for the testing agents |
| `LANGWATCH_API_KEY` | Optional — renders runs in the LangWatch UI |

These simulations are deliberately excluded from `pnpm test`: each run costs real
tokens and takes tens of seconds. Run them before merging prompt or orchestration
changes, and on a schedule.

## Reading a result

Every scenario asserts on three independent layers:

1. **Deterministic invariants** (`findViolations`) — reflective openers, survey probes
   during a crisis turn, over-long crisis replies, repeated questions. Reusing
   `hasReflectiveOpener` from `@entalent/ai-openai` keeps the runtime gate and the
   simulation honest about the same definition.
2. **Observable state** — what actually landed in memory, what the style profile
   learned, which mode each turn resolved to.
3. **Judge verdict** — the subjective criteria that no regex can express.

`reportRun` records all three, so a red run says *why* rather than just *no*.

## Non-determinism

A single run is a sample, not a verdict. Before treating a scenario as a gate, run it
several times and record a pass rate; a one-off failure of a judge criterion is normal
variance, a consistent one is a finding. Keep `SIM_JUDGE_MODEL` fixed — changing the
judge invalidates every previously recorded baseline.

## Known finding: risk detection is skipped on `burnout_signal`

The `burnout` scenario is intermittently red on
`classification.requiresSafetyCheck === true`. When it fails, the classifier returns
`primaryIntent: 'burnout_signal'` but leaves `requiresSafetyCheck` false, so
`detectRisk` never runs and `risk.severity` stays `none`:

```156:158:packages/application/src/use-cases/conversation-orchestrator.ts
      classification.requiresSafetyCheck
        ? this.aiProvider.detectRisk(turns, { userName })
        : Promise.resolve(safeDefault()),
```

The reply still reads well, because `buildReplyStrategy` maps the intent to
`sensitive` mode on its own — which is exactly why the gap is invisible from the
outside. But no risk signal is persisted, no escalation can fire, and
`surveyMustBeBlocked` is never evaluated. Whether safety runs is left entirely to one
model's judgement on one field. Forcing the safety pass for the intents that already
map to `sensitive` or `crisis` would make it deterministic.

## Known red: `terse-user`

The style profile learns a terse user correctly (`verbosity ≈ 0.09` against a base of
`0.5`, adaptation weight at the `0.4` cap), and `applyTerseStyle` does set
`maxResponseLength: 'short'`. The replies still do not get shorter. Two independent
runs produced reply lengths of `128, 201, 135, 118, 180, 179, 178, 162` and
`143, 129, 279, 259, 195, 227, 208, 199` — in both, later replies were *longer* than
earlier ones against a user answering in single words.

`short` renders as "1-2 sentences" in `buildRespondSystemPrompt`, which does not stop
the model from writing two long sentences. The verbosity axis of style adaptation is
therefore effectively inert in the generated text. This scenario stays red until that
is addressed.
