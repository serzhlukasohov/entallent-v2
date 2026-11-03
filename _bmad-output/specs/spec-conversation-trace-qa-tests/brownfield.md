# Brownfield notes

Existing pieces this spec builds on (checked 2026-10-31).

- `packages/conversation-sim/src/harness/coach-harness.ts`: wires the production `ConversationOrchestrator` to in-memory adapters and a live or scripted AI provider. Seeds user, timezone, memory, style; pulse, onboarding and confirmation state come in as ports.
- `packages/conversation-sim/src/harness/trace.ts`: `TraceEvent` model (`inbound`, `llm`, `write`, `queue`, `warning`, `error`, `decision`) and `traceWrites`, a proxy that records state-changing port calls. `RecordingAiProvider` in `coach-harness.ts` records model calls. This is the model to share with production (CAP-6).
- `packages/conversation-sim/src/harness/report.ts`: per-scenario `runs/*.json` (schemaVersion 1) with turns, classification, reply plan, response inputs, effects, trace.
- `packages/conversation-sim/report/`: `run-sim.mjs` (default JSON suite report), `from-sim-run.mjs` (Given, steps with icons, actual result), `render-report.mjs` + `test-report.template.html` (HTML on request), `suite-report.schema.json`. CAP-7 reuses this renderer.
- `apps/worker/src/conversation/conversation.module.ts`: the single factory that builds `ConversationOrchestrator` from injected repositories and services — the composition root for trace decorators. The orchestrator is a singleton, so per-turn trace context must be carried per job (the worker already uses `AsyncLocalStorage` in `database.service.ts`).
- `packages/database/src/schema/llm-runs.ts`: `llm_runs` stores model-call metrics only (tokens, latency, cost, `traceId`), no content.
- `packages/database/src/schema/conversation-job-admissions.ts`: `conversation_turn_effects` and dispatch intents deliberately exclude response text, meaning and queue payloads.
- `feature_flags` table exists for per-tenant switches.
