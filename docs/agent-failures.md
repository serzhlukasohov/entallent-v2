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
- Status: open | fixed | obsolete
```

## Open Failures

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

## Obsolete / Retired Failures

These entries are retained as historical evidence but are not active work because MAF and `agent-service` are no longer supported.

## 2026-08-19: packaged Python runtime schema drifted from canonical OpenAPI
- Symptom: `test_python_service_packages_shared_runtime_openapi_schema` fails because the packaged Python schema omits `greeting_opens_conversation`.
- Expected: The deployable Python artifact must exactly match `packages/contracts/runtime/openapi.json`.
- Root cause layer: workflow
- Harness fix: Keep the packaged schema synchronized whenever the canonical runtime schema changes.
- Regression check: `agent-service/.venv/bin/python -m pytest agent-service/tests/unit/test_runtime_contract.py -q`
- Status: fixed

## 2026-08-20: Model-provider mypy baseline is not clean
- Symptom: Whole-file mypy reports three pre-existing errors at lines 721, 782, and 857 outside the engagement diff.
- Expected: Typed runtime verification should distinguish new errors from baseline debt.
- Root cause layer: verification
- Harness fix: None planned; do not spend current verification effort on the retired model-provider path.
- Regression check: Not active while MAF and `agent-service` remain unsupported.
- Status: obsolete

## Fixed Failures

## 2026-08-28: Mixed rejection plus request escaped correction policy
- Symptom: One exact Annna sample classified `No, you keep circling` plus the corrected criteria request as `request`, allowing an unnecessary rubric offer after the direct answer.
- Expected: An explicit rejection controls response shape even when the same message contains a new request: answer it directly, ask zero questions, and stop.
- Root cause layer: architecture
- Harness fix: Add a classifier example and a deterministic provider-boundary normalization for unambiguous rejection-prefixed requests; keep the exact scenario strict on `correction`, zero questions, and no extra offer.
- Regression check: `pnpm --filter @entalent/ai-openai test -- openai-provider.test.ts prompts/classify.test.ts prompts/respond.test.ts` plus turn 13 of the exact Annna scenario.
- Status: fixed

## 2026-08-28: Explicit `No, forget` varied into acknowledgement
- Symptom: The third exact Annna sample classified the final `No, forget` as `acknowledgement`, reopened the discussion, and asked another question.
- Expected: Unambiguous stop phrases must always become typed `closing` with no topic anchor, follow-up, or additional offer.
- Root cause layer: architecture
- Harness fix: Normalize bounded explicit stop phrases at the provider boundary to `closing` while preserving safety fields; keep the scenario's closing-plan and zero-question assertions.
- Regression check: `pnpm --filter @entalent/ai-openai test -- openai-provider.test.ts` plus turn 15 of the exact Annna scenario.
- Status: fixed

## 2026-08-28: Exact evaluator rejected valid correction wording
- Symptom: Hard assertions rejected valid acknowledgements such as `overreading`, `earlier read was too far off`, and `over-reading`; the post-fix judge also explicitly said no third-person violation was visible but still marked that binary criterion false.
- Expected: The evaluator should accept semantically equivalent admissions and use deterministic checks for exact pronoun constraints without weakening the required correction, direct answer, or no-circling contracts.
- Root cause layer: verification
- Harness fix: Expand only the acknowledgement-synonym matcher, move the no-third-person criterion to a deterministic assertion across all 15 coach replies, and retain typed-plan, content, question, stale-frame, memory, and closing assertions.
- Regression check: `pnpm --filter @entalent/conversation-sim exec vitest run src/scenarios/annna-intent-fidelity.sim.test.ts`
- Status: fixed

## 2026-08-28: Memory extraction copied mentor-authored conclusions into employee state
- Symptom: Exact Annna replay stored `Employee thinks belonging is probably the hardest` after the employee said `have no idea`; another sample turned `No, forget` into a goal.
- Expected: Only the employee's latest explicit assertion or adoption may create or change employee memory; the just-generated mentor reply and closing language are never evidence or goals.
- Root cause layer: architecture
- Harness fix: Bound each extraction to the latest employee message, structurally omit the trailing mentor reply, keep earlier turns as context only, and explicitly reject closing/rejection goals.
- Regression check: `pnpm --filter @entalent/ai-openai test -- prompts/memory.test.ts` plus the exact Annna scenario's mentor-sourced-memory and invalid-closing-goal assertions.
- Status: fixed

## 2026-08-28: Rejected framing returned from stored memory after correction
- Symptom: The correction reply dropped pulse-check/report framing, but two turns later stored project context caused the bot to ask whether criteria should target regular chat or pulse-check answers.
- Expected: A rejected frame must remain suppressed through the immediate corrected exchange without deleting otherwise valid project context.
- Root cause layer: architecture
- Harness fix: Persist correction evidence in outbound decision metadata, suppress response memory for the next two mentor replies, and add a responder-level recent-correction contract that follows the latest request without reviving pre-correction topics.
- Regression check: `pnpm --filter @entalent/application test -- conversation-orchestrator.test.ts` and `pnpm --filter @entalent/ai-openai test -- prompts/respond.test.ts`.
- Status: fixed

## 2026-08-28: Slack Socket Mode explicit disconnect crashed the production API
- Symptom: The production API exited while the Slack client was connecting because `@slack/socket-mode@1.3.6`/`finity` treated `server explicit disconnect` as an unhandled state-machine event; restarting the API restored service.
- Expected: A transient or explicit Socket Mode disconnect should reconnect or fail without terminating the API process.
- Root cause layer: architecture
- Harness fix: Upgrade `@slack/socket-mode` to `2.0.7`, which removes the Finity lifecycle and handles server disconnect through the WebSocket close/reconnect path; keep a regression for disconnect-before-handshake.
- Regression check: `pnpm --filter @entalent/api test -- slack-socket-mode.lifecycle.test.ts`
- Status: fixed

## 2026-08-28: Leading acknowledgement hid a substantive correction
- Symptom: In the exact Annna replay, the message beginning with `yes` and then rejecting the pulse-check interpretation was classified as `acknowledgement / continue_existing_thread`, so the next reply retained manager/report framing.
- Expected: A substantive clarification or rejection must be `correction` even when it begins with a backchannel such as `yes`.
- Root cause layer: instructions
- Harness fix: Restrict `acknowledgement` to messages that are entirely backchannels and state that an explicit correction wins over a leading acknowledgement.
- Regression check: `pnpm --filter @entalent/ai-openai test -- prompts/classify.test.ts prompts/respond.test.ts`; production exact replay must persist `dialogueAct=correction` for the combined `yes`/correction turn.
- Status: fixed

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
- Symptom: `pnpm prepush` passes monorepo typecheck, lint, and package tests, then `test:scripts` fails with `listen EPERM` for the TSX IPC socket. On 2026-08-29 the escalation also exposed that the default script suite still included a retired live-MAF smoke test.
- Expected: Complete ordinary pre-push verification without invoking retired MAF tooling.
- Root cause layer: workflow
- Harness fix: Remove the retired live-MAF test from `test:scripts`; rerun `pnpm prepush` outside the sandbox only for the remaining TypeScript-owned script checks when TSX IPC is denied.
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

## 2026-08-28: Numeric probe metadata was passed to an unused persistence shape
- Symptom: Root typecheck rejected `responseType` on the hidden proactive-request persistence payload.
- Expected: New metadata should cross only boundaries that consume it.
- Root cause layer: architecture
- Harness fix: Remove the unused field and keep `responseType` only in the runtime candidate context.
- Regression check: `pnpm --filter @entalent/worker typecheck`
- Status: fixed

## 2026-08-28: Agent-service verification used an unavailable global pytest
- Symptom: `pytest tests/unit/test_model_provider_prompt.py` failed with `command not found` despite the repository virtualenv being present.
- Expected: Python verification should use the project-owned interpreter.
- Root cause layer: workflow
- Harness fix: Use `agent-service/.venv/bin/python -m pytest` in local verification commands.
- Regression check: `agent-service/.venv/bin/python -m pytest agent-service/tests/unit/test_model_provider_prompt.py -q`
- Status: fixed

## 2026-08-28: Narrow response type widened in a prompt fixture
- Symptom: Root typecheck rejected a numeric-probe fixture because its `responseType` literal widened to `string` after the runtime contract became an enum.
- Expected: Fixtures for closed contract values should retain literal types.
- Root cause layer: verification
- Harness fix: Mark the fixture discriminator `as const` and keep root typecheck in the handoff gate.
- Regression check: `pnpm typecheck`
- Status: fixed

## 2026-08-28: Python scope guard matched a harmless word substring
- Symptom: The full Python suite rejected validator prose because the word “requests” contains the forbidden substring `requests`.
- Expected: Runtime policy wording should not trip the repository's coarse forbidden-fragment scan.
- Root cause layer: verification
- Harness fix: Use equivalent wording without the forbidden fragment and always run the full Python suite after prompt changes.
- Regression check: `agent-service/.venv/bin/python -m pytest agent-service/tests/unit/test_scope.py -q`
- Status: fixed

## 2026-08-20: Targeted conversation sim command ran the full suite
- Symptom: Passing `-- terse-user.sim.test.ts` through the package script made Vitest run nine scenario files; live cases then failed on blocked DNS.
- Expected: Only the requested terse-user scenario should run.
- Root cause layer: workflow
- Harness fix: Use `pnpm --filter @entalent/conversation-sim exec vitest run src/scenarios/terse-user.sim.test.ts` for one scenario.
- Regression check: Confirm Vitest reports exactly one test file before treating the run as evidence.
- Status: fixed

## 2026-08-20: Live model verification lacked authorized egress
- Symptom: The corrected live terse-user simulation was rejected because it would send scenario text to Azure OpenAI without explicit egress authorization; later direct-intent and exact Annna reruns repeated this when they also included LangWatch telemetry.
- Expected: Live prompt verification should run only with an explicitly approved destination and payload.
- Root cause layer: environment
- Harness fix: Keep exact private-transcript scenarios out of LangWatch, request explicit approval for the remaining Azure scenario egress, and use deterministic prompt regressions as the safe default.
- Regression check: Before a live sim with private transcript text, confirm LangWatch reporting is disabled and explicit approval exists for the model-provider destination; otherwise do not run it.
- Status: fixed

## 2026-08-28: Closing turn created durable anti-goal memories
- Symptom: The production Annna replay classified `No, forget` as `closing` and replied without a question, but memory extraction stored four active `goal` items phrased as “Employee no longer wants to continue…” from that closing turn.
- Expected: A closing turn may cancel or complete an existing goal, but must not create durable memory, a new goal, or a follow-up from the decision to stop the current thread.
- Root cause layer: architecture
- Harness fix: Enforce the closing boundary in `MemoryExtractionUseCase` using the persisted outbound `dialogueAct`; discard memory items, goal creates, and follow-ups while retaining explicit cancel/complete proposals.
- Regression check: `pnpm --filter @entalent/application test -- memory-extraction.use-case.test.ts`; the exact Annna scenario rejects paraphrased “no longer wants to continue” goal memories.
- Status: fixed

## 2026-08-28: Git staging initially ran without repository-write escalation
- Symptom: `git add -u` failed because the managed sandbox could not create `.git/index.lock`.
- Expected: Explicitly authorized commit operations should write the Git index successfully.
- Root cause layer: tooling
- Harness fix: Run Git index mutations with repository-write escalation in the managed desktop sandbox.
- Regression check: `git diff --cached --check` after staging.
- Status: fixed

## 2026-08-28: Railway readiness initially ran inside the network sandbox
- Symptom: The first production readiness run failed DNS lookup for Railway's API.
- Expected: The read-only deployment verification should reach Railway after an authorized push.
- Root cause layer: environment
- Harness fix: Run Railway-backed readiness with network escalation in the managed desktop sandbox.
- Regression check: `pnpm maf:agent-service:readiness` completes with service, variable, and deployment-envelope checks.
- Status: fixed

## 2026-08-28: MAF-only smoke was used for a TypeScript feature
- Symptom: `maf-proactive-selected-probe-smoke.ts` reported `selected_probe_missing` while the supported TypeScript path was under acceptance.
- Expected: Retired MAF smoke and `agent-service` verification must not be used for TypeScript-only product work.
- Root cause layer: verification
- Harness fix: Exclude MAF smoke from the verification plan and use TypeScript selector/outbound evidence instead.
- Regression check: The task verification list contains no `maf:*`, `agent-service`, Python runtime, or MAF OpenAPI command.
- Status: obsolete

## 2026-08-28: Survey evaluator omitted an explicit numeric rating field
- Symptom: Production evaluation recognized the employee's reply `7` but omitted optional `numericValue`, leaving `survey_assessments.score` null and the engagement backlog incomplete.
- Expected: An explicit 0–10 answer to the exact preceding numeric probe should persist even when the model omits the redundant structured number.
- Root cause layer: architecture
- Harness fix: Treat the deterministically parsed inbound rating as source of truth, require exact probe binding, and reject any conflicting model-provided value (`b4a583f`).
- Regression check: `pnpm --filter @entalent/application test -- survey-evidence.use-case.test.ts`; production replay stores `7.00`, while qualitative-only text stores no score.
- Status: fixed

## 2026-08-28: Inline queue-cleanup script used shell-interpreted template literals
- Symptom: Backticks in a `tsx -e` command were expanded by the outer shell, producing `command not found` diagnostics and suppressing the script's removal summary; the guarded removal itself completed.
- Expected: Production cleanup commands should preserve JavaScript source exactly and report every removed target.
- Root cause layer: tooling
- Harness fix: Avoid template literals in shell-embedded scripts; use string concatenation or a reviewed temporary script, then perform an independent read-only absence check.
- Regression check: Query the exact job IDs after cleanup and require `remaining=[]`; the verification passed for all seven jobs.
- Status: fixed

## 2026-08-28: Engagement implementation crossed the retired MAF boundary
- Symptom: Commit `b2fec85` added numeric-probe behavior to `agent-service`, the MAF runtime contract, and proactive MAF worker wiring even though MAF is unsupported and out of scope.
- Expected: Engagement scheduling, quantitative extraction, persistence, and focus changes must remain in the supported TypeScript application/worker/AI path.
- Root cause layer: instructions
- Harness fix: Restore every MAF-facing file to its pre-feature bytes and add an explicit no-MAF boundary check to engagement verification.
- Regression check: Diff the final tree against `b2fec85^` for `agent-service`, runtime OpenAPI/contracts, `agent-runtime.port.ts`, and proactive MAF `responseType` wiring; require no feature delta.
- Status: fixed

## 2026-08-29: Worker suite required retired MAF wiring
- Symptom: The first full worker test run failed because a source-inspection test still required `recordShadowCandidate` and primary/canary MAF wiring in `ConversationModule`.
- Expected: The worker must remain TypeScript-only even while retired MAF artifacts stay available as unreferenced archive code.
- Root cause layer: verification
- Harness fix: Replace the obsolete rollout assertion with a quarantine regression that rejects MAF router, client, and proactive-branch references in the active worker module and processor.
- Regression check: `pnpm --filter @entalent/worker test` passes 117/117 and includes the TypeScript-only module/processor boundary assertions.
- Status: fixed
