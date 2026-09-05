---
title: 'Localize survey confirmation and close confirmed topics'
type: 'bugfix'
created: '2026-09-05'
status: 'done'
review_loop_iteration: 1
baseline_commit: '39b917989cc29325ffdc53eba129b2302341a7db'
context:
  - 'docs/agent-failures.md'
  - 'docs/agent-task-log.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Real Slack evidence shows two conflicting response contracts in the supported TypeScript runtime: Russian survey confirmation prompts can end with the literal English phrase "did I get that right?", and a successfully confirmed group can still inherit the normal follow-up policy and ask another question instead of closing with an acknowledgement.

**Approach:** Correct the two existing shared boundaries: make the confirmation instruction request its final question in the already-resolved response language, and make a successfully handled confirmation disable the ordinary follow-up question before the existing reply plan and provider validation run. Reuse the current language policy, `topicConfirmed` hint, reply plan, and question-count retry path; add no renderer, translation table, contract type, or dependency.

## Boundaries & Constraints

**Always:** Keep TypeScript as owner of survey state and outbound policy; preserve exact `confirmationSummary` persistence, disclosure receipt ordering, CAS confirmation, report enqueueing, safety gates, and the one-question confirmation-request contract. Apply the no-follow-up rule only when confirmation actually succeeds. Test behavior before implementation and keep the change at shared prompt/orchestration boundaries.

**Ask First:** Pushing a new commit, manually deploying Railway, or sending a new real Slack message. A manual deployment must identify project `reasonable-adaptation`, environment `production`, service `worker`, commit, and latest deployment status; deploy no other service.

**Never:** Reset or mutate production survey data for setup; extend the retired MAF path; add language detection, post-processing, a translation dictionary, or a deterministic acknowledgement renderer for this defect; treat `correct`, `unclear`, missing disclosure proof, or a lost confirmation CAS as a successful confirmation.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Russian confirmation request | `confirmationRequest` with `responseLanguage: ru` | Prompt requires exactly one natural confirmation question in Russian and contains no quoted English exemplar | Existing provider validation retries malformed question structure |
| Other response language | Any valid resolved language code | Confirmation instruction names that resolved language without hard-coded translated copy | Existing language fallback remains unchanged |
| Successful agreement | `interpretConfirmationResponse=agree` and confirmation CAS succeeds | `topicConfirmed` is present; strategy disables follow-up; reply plan allows zero questions; visible reply acknowledges and does not ask another question | Existing provider zero-question retry removes a violating draft |
| Non-successful confirmation | `correct`, `unclear`, missing proof, or CAS returns false | Do not apply the confirmed-topic output contract | Preserve current transition/no-report behavior |

</frozen-after-approval>

## Code Map

- `packages/ai-openai/src/prompts/respond.ts` -- builds localized generation instructions; currently embeds the English confirmation phrase.
- `packages/ai-openai/src/prompts/respond.test.ts` -- prompt regression coverage, currently separates confirmation and Russian-language cases.
- `packages/application/src/use-cases/conversation-orchestrator.ts` -- converts successful confirmation state into generation context and reply policy.
- `packages/application/src/use-cases/conversation-orchestrator.test.ts` -- Phase B confirmation tests and reply-plan assertions.
- `packages/ai-openai/src/openai-provider.ts` -- question-count validation/retry boundary; must validate the corrected draft before returning it.
- `packages/ai-openai/src/openai-provider.test.ts` -- zero-question retry regression, including an invalid corrected draft.

## Tasks & Acceptance

**Execution:**
- [x] `packages/ai-openai/src/prompts/respond.test.ts` -- add a failing Russian confirmation-request regression, then update `packages/ai-openai/src/prompts/respond.ts` to express the final-question instruction in the resolved language without literal English wording.
- [x] `packages/application/src/use-cases/conversation-orchestrator.test.ts` -- extend the successful `agree` case with failing output-policy assertions, then update `packages/application/src/use-cases/conversation-orchestrator.ts` so only a successfully handled confirmation disables the ordinary follow-up before reply-plan construction.
- [x] `packages/ai-openai/src/openai-provider.test.ts` -- add a failing zero-question retry regression, then update `packages/ai-openai/src/openai-provider.ts` to reject a corrected draft that still exceeds the existing question limit.
- [x] `docs/agent-failures.md` and `docs/agent-task-log.md` -- record the local fix and keep production verification open until the approved Slack cycle passes.

**Acceptance Criteria:**
- Given Russian Slack conversation context and a pending group ready for confirmation, when the response prompt is built, then it requires exactly one Russian confirmation question and does not contain `did I get that right?`.
- Given an employee agrees with the displayed summary and the compare-and-set confirmation succeeds, when the reply is generated, then `topicConfirmed.questionGroup` identifies the closed group, `includeFollowUpQuestion` is false, and `replyPlan.questionPolicy.maxQuestions` is zero.
- Given confirmation does not succeed, when the normal reply plan is built, then this change does not suppress its existing follow-up policy.
- Given the focused tests pass, when the affected packages are typechecked and the repository gate is run, then no regression is reported in prompt, application, or worker-owned behavior.

## Spec Change Log

- Iteration 1: Edge Case Hunter found that the provider returned the corrective generation without rechecking the zero-question limit, so the planned contract could still leak a follow-up question. Added provider-boundary RED/GREEN work and verification to avoid accepting a second invalid draft. KEEP: localized prompt instruction without a translation table; successful-`agree` follow-up suppression; CAS-loss preservation test; no renderer or new abstraction.

## Verification

**Commands:**
- `pnpm --filter @entalent/ai-openai test -- respond.test.ts` -- prompt RED then GREEN.
- `pnpm --filter @entalent/ai-openai test -- openai-provider.test.ts` -- corrected zero-question draft is revalidated and rejected when still invalid.
- `pnpm --filter @entalent/application test -- conversation-orchestrator.test.ts` -- orchestration RED then GREEN.
- `pnpm --filter @entalent/ai-openai typecheck && pnpm --filter @entalent/application typecheck && pnpm --filter @entalent/worker typecheck` -- affected TypeScript boundaries compile.
- `pnpm prepush` -- root typecheck, lint, package tests, and script tests pass; rerun only sandbox-blocked script tests outside the sandbox.
- After separately approved push/deploy: Railway `worker` deployment reports `SUCCESS`, then one explicitly approved real Slack lifecycle in `D0BJDC2MPE2` shows localized confirmation and a question-free acknowledgement without production reset.

**Results:**
- Focused GREEN: prompt 23/23, provider 29/29, orchestrator 50/50.
- `pnpm prepush`: typecheck, lint, and all package tests passed; script tests hit the known sandbox TSX IPC restriction.
- `pnpm test:scripts` outside the sandbox: all three script checks passed.

## Suggested Review Order

**Confirmed-topic policy**

- Successful confirmation suppresses ordinary follow-up before reply-plan construction.
  [`conversation-orchestrator.ts:330`](../../packages/application/src/use-cases/conversation-orchestrator.ts#L330)

- Phase B tests prove successful and lost-CAS paths remain distinct.
  [`conversation-orchestrator.test.ts:1062`](../../packages/application/src/use-cases/conversation-orchestrator.test.ts#L1062)

**Generation contracts**

- Confirmation requests name the already-resolved response language without translated copy.
  [`respond.ts:77`](../../packages/ai-openai/src/prompts/respond.ts#L77)

- Corrective drafts are rechecked against the existing hard question limit.
  [`openai-provider.ts:293`](../../packages/ai-openai/src/openai-provider.ts#L293)

- Provider tests cover both successful correction and fail-closed repetition.
  [`openai-provider.test.ts:360`](../../packages/ai-openai/src/openai-provider.test.ts#L360)

- Prompt regression captures the production-observed Russian/English mix.
  [`respond.test.ts:41`](../../packages/ai-openai/src/prompts/respond.test.ts#L41)

**Verification trail**

- Failure stays open until the separately approved production Slack cycle passes.
  [`agent-failures.md:305`](../../docs/agent-failures.md#L305)

- Review-only architecture gaps remain explicitly deferred from this patch.
  [`deferred-work.md:118`](deferred-work.md#L118)
