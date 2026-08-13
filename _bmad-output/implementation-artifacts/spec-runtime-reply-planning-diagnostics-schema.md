---
title: 'Runtime Reply Planning Diagnostics Schema'
type: 'bugfix'
created: '2026-08-13'
status: 'done'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-remove-runtime-reply-text-heuristics.md'
---

<frozen-after-approval reason="human-owned intent - do not modify unless human renegotiates">

## Intent

**Problem:** Production Slack smoke for a short acknowledgement (`понял`) failed closed with `maf_runtime_boundary_request_invalid`. Worker logs showed the classifier returned `primaryIntent='acknowledgement'` (a dialogue-act label), the worker correctly degraded to `replyPlanning={status:'unavailable', reason:'classifier_failed'}`, but the canonical OpenAPI runtime schema rejected `context.replyPlanning` even though the TypeScript runtime type already includes it.

**Approach:** Synchronize the canonical runtime schema with the existing TypeScript contract by allowing `replyPlanning` diagnostics in `RuntimeContext`. Also tighten the classifier prompt so `primaryIntent` and `dialogueAct` labels are explicitly separated.

## Boundaries & Constraints

**Always:** Preserve fail-closed behavior for truly invalid canonical requests. Keep malformed classifier output from crashing or bypassing MAF primary. Keep the fix contract-based: no text regexes, no user-message heuristics, no special casing `понял`.

**Ask First:** Adding new classifier labels, changing runtime fallback policy, or relaxing UUID/session/idempotency validation.

**Never:** Do not infer intent from raw message text in the runtime client. Do not silently map arbitrary invalid classifier fields into valid values.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Classifier schema mismatch | Worker builds runtime context with `replyPlanning.status='unavailable'` and no `replyPlan` | Runtime request validates and reaches MAF; MAF can generate using normal context | Boundary still rejects unrelated invalid fields |
| Short acknowledgement | Latest message is an acknowledgement and classifier output is valid | Typed reply plan remains `acknowledgement/continue_existing_thread`, `maxQuestions=0` | Existing reply policy applies |
| Model confuses labels | Classifier prompt describes acknowledgement | Prompt says acknowledgement belongs to `dialogueAct`, not `primaryIntent` | Schema validation remains authoritative |

</frozen-after-approval>

## Code Map

- `packages/contracts/runtime/openapi.json` -- Canonical runtime boundary schema.
- `agent-service/src/agent_service/contracts/openapi.json` -- Embedded Python copy of the runtime schema.
- `packages/contracts/src/runtime-contract.test.ts` -- Runtime schema regression coverage.
- `packages/ai-openai/src/prompts/classify.ts` -- Classifier prompt contract for primary intent vs dialogue act.
- `packages/ai-openai/src/prompts/classify.test.ts` -- Prompt regression coverage.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/runtime/openapi.json` and `agent-service/src/agent_service/contracts/openapi.json` -- Add `RuntimeReplyPlanningDiagnostics` and allow `context.replyPlanning` -- Keeps TypeScript type and runtime boundary schema aligned.
- [x] `packages/contracts/src/runtime-contract.test.ts` -- Add a valid request test with `replyPlanning={status:'unavailable', reason:'classifier_failed'}` -- Reproduces the production failure path.
- [x] `packages/ai-openai/src/prompts/classify.ts` and `packages/ai-openai/src/prompts/classify.test.ts` -- Strengthen classifier instructions separating primary intent from dialogue act -- Reduces malformed classifier output without runtime text heuristics.

**Acceptance Criteria:**
- Given a valid runtime request whose context contains `replyPlanning.status='unavailable'`, when it is validated against canonical OpenAPI, then validation succeeds.
- Given a classifier prompt, when it is inspected, then it explicitly says `acknowledgement` is a `dialogueAct` value and must not be used as `primaryIntent`.

## Design Notes

`replyPlanning` is diagnostic contract state, not generated prose policy. Allowing it through the boundary is safer than dropping the field because Python can still see that typed planning failed and avoid assuming a typed plan exists. This keeps strict boundary validation intact while eliminating a schema drift bug.

## Verification

**Commands:**
- `pnpm --filter @entalent/contracts test -- runtime-contract.test.ts` -- expected: pass.
- `pnpm --filter @entalent/ai-openai test -- classify.test.ts` -- expected: pass.
- `pnpm --filter @entalent/contracts typecheck` -- expected: pass.
- `pnpm --filter @entalent/ai-openai typecheck` -- expected: pass.
- `git diff --check` -- expected: pass.
