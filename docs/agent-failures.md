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

## 2026-08-27: Slack Socket Mode explicit disconnect crashed the production API
- Symptom: The production API exited while the Slack client was connecting because `@slack/socket-mode`/`finity` treated `server explicit disconnect` as an unhandled state-machine event; restarting the API restored service.
- Expected: A transient or explicit Socket Mode disconnect should reconnect or fail without terminating the API process.
- Root cause layer: architecture
- Harness fix: Keep reconnect hardening separate from prompt changes; add a lifecycle regression around disconnect-during-connect before changing the adapter.
- Regression check: Exercise an explicit disconnect while the Socket Mode client is connecting and verify the API remains healthy and reconnects.
- Status: open

## 2026-08-20: Local Slack connector smoke blocked by sandbox infra limits
- Symptom: API/worker dev processes fail to start (`AggregateError ... connect EPERM ... 127.0.0.1:5432/6380`) and `curl /api/v1/channel/slack/events` returns `000` because local services are unreachable in this environment.
- Expected: A signed Slack event should be accepted and processed, producing conversation queue work and outbound commit metadata.
- Root cause layer: environment
- Harness fix: Add a lightweight connector-check prerequisite step that verifies DB/Redis reachability and aborts with explicit guidance before sending any Slack payloads.
- Regression check: `node -e "require('net').createConnection({host:'localhost',port:5434})" && node -e "require('net').createConnection({host:'localhost',port:6380})"`
- Status: open

## 2026-08-19: TS quality gate misclassifies scenario assertions
- Symptom: Story 11.2 made `terse-user` pass hard/judge, but `memory-recall` again failed its required-grounding assertion and the console mislabeled the product assertion as `infra_failed`, causing an unnecessary retry. Story 11.3 and the 2026-08-22 intent-fidelity gate repeated the class when stale terse-user zero-question assertions contradicted the acknowledged-thread policy introduced by `9ddd4a6`.
- Expected: The gate should report the memory assertion as a hard product failure without an infrastructure retry; turn-taking scenarios should remain green.
- Root cause layer: verification
- Harness fix: Removed the two obsolete terse-user zero-question assertions while retaining the one-question ceiling and no-brevity-inference checks. Still classify scenario assertion failures separately from model/network failures in the gate runner; address memory grounding in its own story.
- Regression check: `SIM_GATE_RUNS=1 pnpm sim:gate`
- Status: open

## 2026-08-19: packaged Python runtime schema drifted from canonical OpenAPI
- Symptom: `test_python_service_packages_shared_runtime_openapi_schema` fails because the packaged Python schema omits `greeting_opens_conversation`.
- Expected: The deployable Python artifact must exactly match `packages/contracts/runtime/openapi.json`.
- Root cause layer: workflow
- Harness fix: Generate or copy the packaged schema from the canonical file during build and run parity in the default CI/pre-push path.
- Regression check: `agent-service/.venv/bin/pytest agent-service/tests/unit/test_runtime_contract.py::test_python_service_packages_shared_runtime_openapi_schema -q`
- Status: open

## Fixed Failures

## 2026-08-28: Slack acceptance targeted the wrong app DM
- Symptom: A connector-authored marker appeared in `D09GVMU5S3G` at Slack timestamp `1787867291.624999`, but no enTalent ingress followed because that DM belongs to the separate `AI Agent Bot` app. The production EnTalent DM is `D0BJDC2MPE2`, with bot user `U0BJ018K3CP`.
- Expected: Live acceptance must resolve the product app identity and channel before treating missing ingress as connector or filtering behavior.
- Root cause layer: workflow
- Harness fix: Verify the DM title and bot author before replay. Use `D0BJDC2MPE2` for EnTalent; both authenticated Slack Web and the ChatGPT Slack connector reach the product there, so do not weaken the production anti-loop filter.
- Regression check: Send one connector marker to `D0BJDC2MPE2` and confirm a reply authored by `U0BJ018K3CP` before continuing.
- Status: fixed

## 2026-08-20: metadata trace test expected unsorted keys
- Symptom: `conversation-orchestrator.test.ts` failed after adding `continuityDecision` and `goalDecision` because the test sorted actual metadata keys but the expected list was not sorted.
- Expected: Metadata shape regression should verify keys without failing on a mechanical ordering mismatch.
- Root cause layer: verification
- Harness fix: Keep expected key lists sorted whenever the assertion calls `Object.keys(...).sort()`.
- Regression check: `pnpm --filter @entalent/application test -- conversation-orchestrator.test.ts`
- Status: fixed

## 2026-08-20: Story 11.3 review patch missed fixture and timestamp propagation
- Symptom: Focused orchestrator tests failed after review fixes because owner-aware fixtures were incomplete, an acknowledgement assertion was stale, and the computed inbound timestamp was not passed to continuity resolution.
- Expected: Review patches and their production-shaped fixtures should pass the focused regression before broader verification.
- Root cause layer: workflow
- Harness fix: Run the focused test immediately after each review patch and keep required conversation identity fields in the shared fixture.
- Regression check: `pnpm --filter @entalent/application test -- conversation-orchestrator.test.ts`
- Status: fixed

## 2026-08-20: TSX IPC socket blocks full pre-push inside sandbox
- Symptom: `pnpm prepush` passed monorepo typecheck, lint, and package tests, then `test:scripts` failed with `listen EPERM` for the TSX IPC socket.
- Expected: Complete script-test verification despite the sandbox IPC restriction.
- Root cause layer: environment
- Harness fix: Rerun the scoped `pnpm test:scripts` check outside the sandbox when TSX IPC is denied; the outside-sandbox verification passed.
- Regression check: `pnpm test:scripts`
- Status: fixed

## 2026-08-19: Story 11.2 consumer typecheck read stale declarations
- Symptom: The focused `ai-openai` typecheck rejected new `ReplyPlan` reasons before `application` declarations were rebuilt.
- Expected: Consumer verification should use declarations generated from the current source.
- Root cause layer: workflow
- Harness fix: Build changed upstream packages before focused consumer typechecks, or use root `pnpm typecheck` which orders the dependency graph.
- Regression check: `pnpm --filter @entalent/application build` then `pnpm --filter @entalent/ai-openai typecheck`
- Status: fixed

## 2026-08-19: Story 11.2 test mock missed lint suppression
- Symptom: The first full pre-push stopped on one new `as any` test mock without the repository's required local ESLint suppression.
- Expected: Focused implementation verification should catch lint errors before the broad handoff check.
- Root cause layer: verification
- Harness fix: Run lint for each changed package after focused tests and before the full pre-push.
- Regression check: `pnpm --filter @entalent/application lint`
- Status: fixed

## 2026-08-19: Cross-contract rollback left one stale test reason
- Symptom: After removing two story-local reason enums to avoid MAF/OpenAPI expansion, one reply-plan test still expected the removed acknowledgement reason.
- Expected: Mechanical contract rollback should update every source and test occurrence before verification.
- Root cause layer: workflow
- Harness fix: Run an exact removed-symbol scan before rerunning focused tests.
- Regression check: `rg 'acknowledgement_pauses_conversation|closing_ends_conversation' packages`
- Status: fixed

## 2026-08-18: classifier emits unsupported closing intent
- Symptom: Live Slack closing turn ("Спасибо, пока достаточно. Вернусь к этому позже.") was retried three times and produced no outbound reply.
- Expected: Closing/stop-style turns should map to a valid intent and produce a short, question-free close.
- Root cause layer: architecture
- Harness fix: Normalize known misplaced dialogue-act labels at the classifier boundary and keep closing as a typed `dialogueAct`.
- Regression check: `pnpm --filter @entalent/ai-openai test -- openai-provider.test.ts` plus `pnpm --filter @entalent/application test -- conversation-orchestrator.test.ts`
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

## 2026-08-20: MAF prompt rewrite changed a regression marker's case
- Symptom: The focused prompt test failed because `Do not paraphrase` replaced the asserted lowercase marker.
- Expected: Engagement wording changes should preserve unrelated prompt contracts.
- Root cause layer: verification
- Harness fix: Preserve the existing marker while extending the sentence and run the focused prompt test immediately.
- Regression check: `agent-service/.venv/bin/python -m pytest agent-service/tests/unit/test_model_provider_prompt.py -q`
- Status: fixed

## 2026-08-20: Targeted conversation sim command ran the full suite
- Symptom: Passing `-- terse-user.sim.test.ts` through the package script made Vitest run nine scenario files; live cases then failed on blocked DNS.
- Expected: Only the requested terse-user scenario should run.
- Root cause layer: workflow
- Harness fix: Use `pnpm --filter @entalent/conversation-sim exec vitest run src/scenarios/terse-user.sim.test.ts` for one scenario.
- Regression check: Confirm Vitest reports exactly one test file before treating the run as evidence.
- Status: fixed

## 2026-08-20: Live model verification lacked authorized egress
- Symptom: The corrected live terse-user simulation was rejected because it would send scenario text to Azure OpenAI without explicit egress authorization; the 2026-08-22 direct-intent fix repeated this when a targeted rerun also included LangWatch telemetry.
- Expected: Live prompt verification should run only with an explicitly approved destination and payload.
- Root cause layer: environment
- Harness fix: Request explicit approval for Azure scenario egress or use deterministic prompt regressions as the safe default.
- Regression check: Before a live sim, confirm explicit approval for its Azure OpenAI and LangWatch destinations/payload; otherwise do not run it and use targeted direct-TypeScript prompt tests.
- Status: open

## 2026-08-20: Model-provider mypy baseline is not clean
- Symptom: Whole-file mypy reports three pre-existing errors at lines 721, 782, and 857 outside the engagement diff.
- Expected: Typed runtime verification should distinguish new errors from baseline debt.
- Root cause layer: verification
- Harness fix: Fix the existing annotations or add a checked mypy baseline before requiring whole-file cleanliness for scoped prompt edits.
- Regression check: `agent-service/.venv/bin/mypy agent-service/src/agent_service/workflows/model_provider.py`
- Status: open
