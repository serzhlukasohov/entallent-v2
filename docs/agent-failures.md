# Agent Failure Log

Use this file to turn agent misses into harness improvements.

## Template

```md
## YYYY-MM-DD: short title
- Symptom:
- Expected:
- Root cause layer: instructions | context | architecture | verification | environment | workflow | tooling
- Harness fix:
- Regression check:
- Status: open
```

## Open Failures

No open failures recorded yet.

## Fixed Failures

## 2026-08-18: Slack connector attribution flipped ambiguous turn language
- Symptom: Production Slack smoke answered `ok` in English after a Russian conversation.
- Expected: Short ambiguous turns should inherit the recent Russian user-turn language.
- Root cause layer: verification
- Harness fix: Add a production-shaped regression with Slack connector attribution appended to an ambiguous user turn.
- Regression check: `pnpm --filter @entalent/application test -- conversation-orchestrator.test.ts`
- Status: fixed

## 2026-08-15: contextual support smoke repeated stock fallback
- Symptom: Production Slack smoke repeated the stock support phrase after the user pushed back that the reply was too generic.
- Expected: A context-rich support turn should route through the model path instead of repeating deterministic support fallback.
- Root cause layer: verification
- Harness fix: Add a production-shaped regression where a previous stock support reply forces the next support-emotion turn onto the model path.
- Regression check: `agent-service/.venv/bin/python -m pytest agent-service/tests/unit/test_model_provider.py -q`
- Status: fixed
