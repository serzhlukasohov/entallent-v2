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

## 2026-08-19: TS quality baseline gate exposes memory and terse-turn failures
- Symptom: `SIM_GATE_RUNS=1 pnpm sim:gate` passed six scenarios but failed memory recall's required grounding assertion and the terse-user judge; the console mislabeled the memory assertion as `infra_failed`.
- Expected: The baseline gate should distinguish product assertions from infrastructure failures and eventually pass the memory/turn-taking scenarios consistently.
- Root cause layer: verification
- Harness fix: Correct the gate failure classification and use Story 11.2 to address terse question pacing; re-evaluate memory grounding without expanding Story 11.1.
- Regression check: `SIM_GATE_RUNS=1 pnpm sim:gate`
- Status: open

## 2026-08-19: packaged Python runtime schema drifted from canonical OpenAPI
- Symptom: `test_python_service_packages_shared_runtime_openapi_schema` fails because the packaged Python schema omits `greeting_opens_conversation`.
- Expected: The deployable Python artifact must exactly match `packages/contracts/runtime/openapi.json`.
- Root cause layer: workflow
- Harness fix: Generate or copy the packaged schema from the canonical file during build and run parity in the default CI/pre-push path.
- Regression check: `agent-service/.venv/bin/pytest agent-service/tests/unit/test_runtime_contract.py::test_python_service_packages_shared_runtime_openapi_schema -q`
- Status: open

## 2026-08-18: classifier emits unsupported closing intent
- Symptom: Live Slack closing turn ("Спасибо, пока достаточно. Вернусь к этому позже.") was retried three times and produced no outbound reply.
- Expected: Closing/stop-style turns should either map to an existing supported intent (for example `casual_conversation`) with a short close, or be handled as intentional no-follow-up without failing the job.
- Root cause layer: architecture
- Harness fix: Add a production-shaped classifier contract regression for closing turns and decide whether closing is a first-class intent or a dialogue act only.
- Regression check: `pnpm --filter @entalent/ai-openai test -- openai-provider.test.ts` plus `pnpm --filter @entalent/application test -- conversation-orchestrator.test.ts`
- Status: open

## Fixed Failures

## 2026-08-19: TSX IPC socket blocked by the workspace sandbox
- Symptom: direct `pnpm exec tsx ...` verification failed with `listen EPERM` for its temporary IPC socket.
- Expected: local script tests and migrations should run without being mistaken for product failures.
- Root cause layer: environment
- Harness fix: Run TSX-backed verification outside the filesystem sandbox with the scoped `pnpm exec tsx` approval.
- Regression check: `pnpm exec tsx scripts/typescript-conversation-decision-report.test.ts`
- Status: fixed

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
