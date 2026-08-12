---
baseline_commit: dce563c5366311a340b0b7f5c30ddddb34d81ad2
---

# Story 8.2: Add Local MAF Shadow Validation

Status: done
Epic: 8 - Fast-Track Live MAF Validation
Story ID: 8.2

## Story

As a migration owner,
I want a deterministic local validation harness for the TypeScript-to-Python MAF shadow path,
so that we can prove the worker-side router/client boundary before running a real provider-backed smoke test.

## Acceptance Criteria

1. Given local validation runs without agent-service/provider config, when MAF shadow is selected, then TypeScript remains user-facing and validation reports a redacted invalid diagnostic without calling Python or leaking request content.
2. Given a contract-valid Python candidate response is returned through `MafAgentRuntimeClient`, when local validation runs in `maf_shadow`, then TypeScript remains user-facing while redacted evidence reports a valid candidate with `diagnostics.modelCalls: 1`.
3. Given the Python candidate HTTP call fails or returns an invalid runtime result, when local validation runs, then TypeScript remains user-facing and evidence contains only stable fail-closed reason codes/paths.
4. Given validation evidence is serialized, then it must not include raw Slack/user text, current reply text, candidate reply text, prompts, bearer tokens, service secrets, provider bodies, memory content, risk evidence, action payloads, or stack traces.
5. Given this story is complete, when the diff is inspected, then it must not enable user-facing `maf_canary`, change worker routing semantics, add Python-owned writes, command tools, deployment/Railway mutation, `agent-framework-hosting`, or dashboard/admin UI.
6. Given a developer reads the docs, when they want to validate the local shadow path, then they can see that the deterministic harness is safe to run without live credentials and that a real provider smoke test remains a later manual step.

## Tasks / Subtasks

- [x] Add a local TypeScript shadow validation harness. (AC: 1-4)
  - [x] Reuse `AgentRuntimeRouter` and `MafAgentRuntimeClient` rather than duplicating routing or HTTP request construction.
  - [x] Force `maf_shadow` for validation while returning the TypeScript result unchanged.
  - [x] Capture only redacted candidate evidence.
  - [x] Fail closed when MAF config, HTTP, or response validation fails.
- [x] Add focused automated coverage. (AC: 1-5)
  - [x] Cover missing config without a fetch call.
  - [x] Cover a valid Python candidate response with `modelCalls: 1`.
  - [x] Cover HTTP/contract failure with stable diagnostics.
  - [x] Cover evidence redaction for raw current and candidate content.
- [x] Update docs and tracking. (AC: 5-6)
  - [x] Update `docs/maf-runtime-client.md` with the local shadow validation semantics.
  - [x] Keep sprint status aligned during implementation and review.
- [x] Run and record verification. (AC: 1-6)
  - [x] Run focused application tests.
  - [x] Run router/client regression tests.
  - [x] Run `git diff --check`.
  - [x] Parse sprint status YAML.

### Review Findings

- [x] [Review][Patch] Diagnostic evidence could leak token-like values through a broad safe regex [packages/application/src/use-cases/maf-shadow-local-validation.ts:54]
- [x] [Review][Patch] Malformed diagnostic arrays could throw while building fail-closed evidence [packages/application/src/use-cases/maf-shadow-local-validation.ts:159]
- [x] [Review][Patch] Missing shadow records could produce invalid evidence without a stable diagnostic [packages/application/src/use-cases/maf-shadow-local-validation.ts:106]
- [x] [Review][Patch] Contract-invalid RuntimeResult was not tested through `MafAgentRuntimeClient` boundary validation [packages/application/src/use-cases/maf-shadow-local-validation.test.ts:224]
- [x] [Review][Patch] Sprint status metadata comments had a stale `last_updated` value [_bmad-output/implementation-artifacts/sprint-status.yaml:2]

## Dev Notes

### Current Architecture Context

- Story 8.1 validates the Python app/provider path through `/runtime/process-message`, but does not exercise TypeScript-owned shadow diagnostics.
- Story 5.5 already added `AgentRuntimeRouter` shadow candidate execution: only `maf_shadow` calls `processCandidate`, and the TypeScript runtime result remains user-facing.
- Story 5.1 already added `MafAgentRuntimeClient.processCandidate`, which validates outgoing canonical `RuntimeProcessMessageRequest` and incoming `RuntimeResult` with `@entalent/contracts`.
- The user has chosen a fast path because there are no real users yet, but asked to wait for a fuller ready state before running real provider credentials.

### Existing Code To Reuse

- `packages/application/src/use-cases/agent-runtime-router.ts`
- `packages/application/src/use-cases/maf-agent-runtime-client.ts`
- `packages/application/src/use-cases/agent-runtime-router.test.ts`
- `packages/application/src/use-cases/maf-agent-runtime-client.test.ts`
- `docs/maf-runtime-client.md`

### Implementation Guidance

Prefer a small application-layer helper that creates a router with a forced `maf_shadow` evaluator and an injected MAF candidate provider. Tests should use `MafAgentRuntimeClient` with an injected fetch implementation so the boundary uses the same request/response validation as production code without network or live credentials.

The helper should return redacted evidence only: validation status, trace ID if safe, user-facing mode/intent/risk severity, candidate runtime version, model/tool/retry counts, action/memory candidate counts, and safe diagnostic codes/paths. It should not return `ProcessMessageResult`, `RuntimeResult`, request payloads, or raw shadow records.

### Out Of Scope

- Running a real OpenAI/Azure provider smoke test.
- User-facing MAF replies or changing `maf_canary` router behavior.
- Python-owned persistence or writes to messages, risk, memory, goals, follow-ups, survey evidence, ledgers, runtime-control flags, diagnostics, baseline evidence, or Slack.
- Command tools, write APIs, streaming, dashboard/admin UI, deployment mutation, Railway mutation, or ownership transfer.
- `agent-framework-hosting`.

### Testing Requirements

- Tests must pass with no live credentials and no network access.
- Tests must prove TypeScript remains user-facing in success and failure cases.
- Evidence redaction tests must prove raw request text, raw current reply text, raw candidate reply text, secrets/tokens, provider bodies, stack traces, memory content, risk evidence, and action payloads are not serialized.

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-08-07: Story created and started after Story 8.1 completed local Python live model validation.
- 2026-08-07: Implemented application-layer local shadow validation helper using `AgentRuntimeRouter` and `MafAgentRuntimeClient`.
- 2026-08-07: Verification completed; story moved to review.
- 2026-08-07: BMAD code review found redaction, malformed diagnostic, missing diagnostic, invalid-contract coverage, and sprint metadata findings; patches applied and verified.

### Completion Notes List

- Added `runMafShadowLocalValidation` to force local `maf_shadow` validation through the existing router/client boundary.
- Evidence remains redacted and limited to validation status, safe trace/attempt IDs, user-facing mode/intent/risk severity, candidate diagnostics counts, action/memory counts, and stable diagnostic fields.
- Missing config, HTTP failure, and response validation failures stay fail-closed while TypeScript remains user-facing.
- Updated MAF runtime docs to distinguish deterministic shadow validation from the later manual live-provider smoke test.
- Review fixes now use field-specific evidence allowlists, tolerate malformed diagnostic arrays, synthesize stable fallback diagnostics if shadow recording is absent, and verify contract-invalid runtime responses through `MafAgentRuntimeClient`.

### Change Log

- 2026-08-07: Created Story 8.2 as in-progress.
- 2026-08-07: Implemented local MAF shadow validation helper and moved Story 8.2 to review.
- 2026-08-07: Addressed BMAD review findings and moved Story 8.2 to done.

### File List

- `_bmad-output/implementation-artifacts/8-2-add-local-maf-shadow-validation.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `docs/maf-runtime-client.md`
- `packages/application/src/index.ts`
- `packages/application/src/use-cases/maf-shadow-local-validation.ts`
- `packages/application/src/use-cases/maf-shadow-local-validation.test.ts`

### Verification

- `pnpm --filter @entalent/application test -- src/use-cases/maf-shadow-local-validation.test.ts` - passed before review (5 tests), then passed after review fixes (8 tests).
- `pnpm --filter @entalent/application test -- src/use-cases/agent-runtime-router.test.ts src/use-cases/maf-agent-runtime-client.test.ts src/use-cases/maf-shadow-local-validation.test.ts` - passed (59 tests, existing Vite CJS deprecation warning).
- `pnpm --filter @entalent/application typecheck` - passed.
- `pnpm --filter @entalent/application test` - passed before review (222 tests), then passed after review fixes (225 tests, existing Vite CJS deprecation warning).
- `pnpm --filter @entalent/application build` - passed before and after review fixes.
- `pnpm --filter @entalent/application lint` - passed.
- `ruby -e "require 'yaml'; YAML.load_file('_bmad-output/implementation-artifacts/sprint-status.yaml'); puts 'yaml ok'"` - passed.
- `git diff --check` - passed.
