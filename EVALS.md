# AI Evaluation Framework

## Overview

`packages/conversation-sim` is the canonical model-backed evaluation suite. It exercises the shipped TypeScript conversation path, applies deterministic scenario assertions, records JSON/Markdown reports, and uses an LLM judge only where configured. Sensitive scenarios still require human review.

## Running evals

Set `OPENAI_API_KEY`, or the complete Azure OpenAI environment described in `.env.example`, before running live simulations.

```bash
# Fast local/release sample
SIM_GATE_RUNS=1 pnpm sim:gate

# Configured release gate
pnpm sim:gate

# All simulation tests
pnpm sim
```

Reports are written under `packages/conversation-sim/runs/gates/`. A missing model credential blocks the run; infrastructure failures may retry, while report-backed assertions remain product failures.

## Adding a regression

1. Add or update a production-shaped scenario in `packages/conversation-sim/src/scenarios/`.
2. Keep deterministic assertions in the scenario and use the judge only for genuinely semantic criteria.
3. Add the scenario to `packages/conversation-sim/src/gate/gate.config.json` when it belongs in the release gate.
4. Run the smallest focused scenario first, then `SIM_GATE_RUNS=1 pnpm sim:gate` when model egress is approved.

## Automation

`.github/workflows/conversation-sim.yml` provides manual and opt-in scheduled runs. It uploads reports, treats `manual_review_required` as a warning, and never merges or deploys. Scheduled execution remains disabled until `CONVERSATION_SIM_SCHEDULED_ENABLED=true` is explicitly configured.
