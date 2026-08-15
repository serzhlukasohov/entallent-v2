# Regression Gates

## Test Layers

| Layer | Purpose | Existing home |
| --- | --- | --- |
| Contract tests | MAF request/response schema, metadata, runtime result validity | `packages/contracts`, `agent-service/tests` |
| Adapter tests | Worker builds correct MAF context and handles result side effects | `apps/worker`, `packages/application` |
| Integration tests | API/worker/agent-service/Postgres/Redis path with deterministic model or fake | `apps/api`, `apps/worker`, scripts |
| Conversation simulations | Multi-turn product regressions with DB side effects | `packages/conversation-sim` |
| Live judged evals | Real model quality, safety, naturalness, privacy, survey subtlety | `evals`, live MAF smoke scripts |

## Command Gates

Every PR:

```bash
pnpm typecheck
pnpm test
cd agent-service && pytest
```

Feature PR:

```bash
SIM_GATE_RUNS=1 pnpm sim:gate
pnpm maf:primary:app:smoke
```

Runtime, safety, survey, proactive, or Slack changes:

```bash
pnpm maf:primary:app:smoke
pnpm maf:agent-service:readiness
```

Release:

```bash
pnpm sim
pnpm maf:prod:acceptance
pnpm maf:prod:regression
```

## Implementation Order

1. Add missing MAF-first test tags or names so primary runtime coverage is visible.
2. Create the first Slack AI mentor end-to-end regression around MAF primary.
3. Add the smallest shared setup helper only after a second feature needs the same setup.
4. Add judged live evals after deterministic coverage exists for that feature.
