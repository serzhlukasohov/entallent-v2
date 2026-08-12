---
baseline_commit: dce563c5366311a340b0b7f5c30ddddb34d81ad2
---

# Story 8.3: Run Live TypeScript-To-Python MAF Shadow Smoke

Status: done
Epic: 8 - Fast-Track Live MAF Validation
Story ID: 8.3

## Story

As a migration owner,
I want a one-command live smoke test for the TypeScript-to-Python MAF shadow path,
so that we can prove the worker-side runtime boundary can obtain a real Microsoft Agent Framework model candidate before making MAF user-facing.

## Acceptance Criteria

1. Given root `.env` contains Azure OpenAI or OpenAI credentials, when the live shadow smoke command runs, then it starts local `agent-service`, calls it over HTTP through `MafAgentRuntimeClient`, and reports `status: "valid"` with `modelCalls: 1`.
2. Given `AGENT_SERVICE_MODEL_PROVIDER` or `AGENT_SERVICE_MODEL_NAME` is absent, when equivalent OpenAI/Azure aliases are present in `.env`, then the smoke command infers local smoke-only provider/model settings without changing production configuration files.
3. Given the live shadow smoke runs, then TypeScript remains the user-facing path and Python MAF output is candidate-only.
4. Given evidence is printed, then it contains only redacted stable fields and does not include raw user text, current reply text, candidate reply text, prompts, bearer tokens, service secrets, provider bodies, memory content, risk evidence, action payloads, or stack traces.
5. Given the Python service fails to start, HTTP fails, the runtime result is invalid, or `modelCalls` is not exactly `1`, then the command exits non-zero with safe diagnostic evidence.
6. Given this story is complete, when the diff is inspected, then it must not enable user-facing `maf_canary`, alter production worker routing semantics, add Python-owned writes, command tools, deployment/Railway mutation, `agent-framework-hosting`, or dashboard/admin UI.

## Tasks / Subtasks

- [x] Add an application-layer live shadow smoke helper. (AC: 1, 3, 4, 5)
  - [x] Reuse `runMafShadowLocalValidation` and `MafAgentRuntimeClient`.
  - [x] Treat `modelCalls !== 1` as a failed live smoke.
  - [x] Return only redacted evidence.
- [x] Add a root one-command live smoke script. (AC: 1, 2, 4, 5)
  - [x] Load root `.env` through the existing `dotenv-cli` script.
  - [x] Infer local smoke provider/model from existing aliases when canonical `AGENT_SERVICE_*` names are absent.
  - [x] Start local `agent-service` on an ephemeral loopback port and wait for `/health/live`.
  - [x] Shut down the child service after the smoke completes or fails.
- [x] Add automated coverage without live network. (AC: 1-6)
  - [x] Cover valid live shadow evidence using injected fetch.
  - [x] Cover invalid `modelCalls` failure evidence.
  - [x] Cover HTTP/contract failure evidence and redaction.
  - [x] Cover local smoke env inference without exposing secret values.
- [x] Update docs and tracking. (AC: 1-6)
  - [x] Add the one-command smoke usage to `docs/maf-runtime-client.md`.
  - [x] Update this story's Dev Agent Record.
  - [x] Keep sprint status aligned.
- [x] Run and record verification. (AC: 1-6)
  - [x] Run focused application tests.
  - [x] Run application typecheck/build/lint.
  - [x] Run the live shadow smoke using root `.env`.
  - [x] Run `git diff --check`.
  - [x] Parse sprint status YAML.

### Review Findings

- [x] [Review][Patch] Explicit disabled or malformed `AGENT_SERVICE_MODEL_PROVIDER` could be overridden by alias inference [packages/application/src/use-cases/maf-shadow-live-smoke.ts:146]
- [x] [Review][Patch] Parent interrupt could orphan the local agent-service child process [scripts/live-maf-shadow-smoke.ts:42]
- [x] [Review][Patch] Child stderr was piped but not drained [scripts/live-maf-shadow-smoke.ts:86]
- [x] [Review][Patch] Script failure reason could leak token-like error messages [scripts/live-maf-shadow-smoke.ts:150]
- [x] [Review][Patch] Health probes lacked per-request timeout and startup error handling [scripts/live-maf-shadow-smoke.ts:91]
- [x] [Review][Patch] Invalid RuntimeResult and full redaction requirements needed focused coverage [packages/application/src/use-cases/maf-shadow-live-smoke.test.ts:143]

## Dev Notes

### Current Architecture Context

- Story 8.1 proved Python `agent-service` can execute Microsoft Agent Framework model calls and return a contract-valid candidate result.
- Story 8.2 proved the TypeScript router/client shadow boundary can record redacted candidate evidence without live credentials.
- This story connects those two pieces through real loopback HTTP while preserving candidate-only behavior.
- TypeScript remains the side-effect owner and user-facing runtime. This story must not make `maf_canary` user-facing.

### Existing Code To Reuse

- `packages/application/src/use-cases/maf-shadow-local-validation.ts`
- `packages/application/src/use-cases/maf-agent-runtime-client.ts`
- `packages/application/src/use-cases/agent-runtime-router.ts`
- `agent-service/src/agent_service/main.py`
- `agent-service/src/agent_service/api/runtime.py`
- `agent-service/src/agent_service/smoke/live_model.py`
- `docs/maf-runtime-client.md`

### Implementation Guidance

Prefer a TypeScript helper under `packages/application/src/use-cases` plus a root `scripts/live-maf-shadow-smoke.ts` entrypoint. The script may start local `uvicorn` using `agent-service/.venv/bin/python` and `PYTHONPATH=agent-service/src`, then call the helper with the loopback service URL.

The root command should use `dotenv -e .env -- pnpm exec tsx ...` so local secrets remain in env and are not printed. It may infer `AGENT_SERVICE_MODEL_PROVIDER=azure_openai` when Azure env vars are present, and may use `OPENAI_MODEL_BALANCED` as the local smoke model name when `AGENT_SERVICE_MODEL_NAME` is absent.

### Out Of Scope

- User-facing MAF replies or changing `maf_canary` router behavior.
- Production worker route changes, staged rollout changes, or feature-flag changes.
- Python-owned persistence or writes to messages, risk, memory, goals, follow-ups, survey evidence, ledgers, runtime-control flags, diagnostics, baseline evidence, or Slack.
- Command tools, write APIs, streaming, dashboard/admin UI, deployment mutation, Railway mutation, or ownership transfer.
- `agent-framework-hosting`.

### Testing Requirements

- Automated tests must not require live credentials or network access.
- The live smoke command may require network escalation only when actually calling Azure/OpenAI.
- Evidence redaction tests must cover raw request text, current reply text, candidate reply text, token-like values, provider bodies, memory content, risk evidence, action payloads, and stack traces.

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-08-07: Story created and started after Story 8.2 completed deterministic TypeScript shadow validation and the manual Python live smoke succeeded through Azure OpenAI.
- 2026-08-07: Implemented `runMafShadowLiveSmoke`, env inference, one-command root smoke script, docs, and focused tests.
- 2026-08-07: Live shadow smoke succeeded using root `.env` with Azure OpenAI aliases and `OPENAI_MODEL_BALANCED`.
- 2026-08-07: BMAD code review found env inference, child cleanup, stderr draining, safe failure reason, startup timeout/error handling, and focused coverage findings; patches applied and verified.

### Completion Notes List

- Added a TypeScript live shadow smoke helper that wraps `runMafShadowLocalValidation` and `MafAgentRuntimeClient`.
- Added local smoke env inference for Azure/OpenAI aliases without returning secret values.
- Added `pnpm maf:shadow:smoke`, which loads root `.env`, starts local `agent-service` on an ephemeral loopback port, waits for `/health/live`, calls Python over HTTP, and prints redacted evidence.
- Live smoke passed with `status: "valid"`, `validationStatus: "contract_valid"`, `shadow.modelCalls: 1`, and `runtimeVersion: "agent-service-maf-core/1.13.0"`.
- Review fixes now fail closed for explicit disabled/malformed providers, drain child stderr without printing it, terminate the child on interrupt, bound health probes, sanitize startup failure reasons, and use the canonical Python smoke request shape for stable live model validation.

### Change Log

- 2026-08-07: Created Story 8.3 as in-progress.
- 2026-08-07: Implemented live TypeScript-to-Python MAF shadow smoke and moved Story 8.3 to review.
- 2026-08-07: Addressed BMAD review findings and moved Story 8.3 to done.

### File List

- `_bmad-output/implementation-artifacts/8-3-run-live-typescript-to-python-maf-shadow-smoke.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `docs/maf-runtime-client.md`
- `package.json`
- `packages/application/src/index.ts`
- `packages/application/src/use-cases/maf-shadow-live-smoke.ts`
- `packages/application/src/use-cases/maf-shadow-live-smoke.test.ts`
- `packages/application/src/use-cases/maf-shadow-local-validation.ts`
- `scripts/live-maf-shadow-smoke.ts`

### Verification

- `pnpm --filter @entalent/application test -- src/use-cases/maf-shadow-live-smoke.test.ts src/use-cases/maf-shadow-local-validation.test.ts` - passed before review (14 tests), then passed after review fixes (18 tests).
- `pnpm --filter @entalent/application test -- src/use-cases/maf-shadow-live-smoke.test.ts src/use-cases/maf-shadow-local-validation.test.ts src/use-cases/maf-agent-runtime-client.test.ts src/use-cases/agent-runtime-router.test.ts` - passed (68 tests, existing Vite CJS deprecation warning).
- `pnpm --filter @entalent/application typecheck` - passed.
- `pnpm --filter @entalent/application lint` - passed.
- `pnpm maf:shadow:smoke` - passed before and after review fixes with live Azure/OpenAI model call and redacted evidence.
- `pnpm --filter @entalent/application test` - passed before review (231 tests), then passed after review fixes (235 tests, existing Vite CJS deprecation warning).
- `pnpm --filter @entalent/application build` - passed before and after review fixes.
- `git diff --check` - passed.
- `ruby -e "require 'yaml'; YAML.load_file('_bmad-output/implementation-artifacts/sprint-status.yaml'); puts 'yaml ok'"` - passed.
