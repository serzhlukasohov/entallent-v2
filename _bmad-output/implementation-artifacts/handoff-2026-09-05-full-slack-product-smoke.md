# Handoff: PR #5 Slack product smoke and next blocker

Date: 2026-09-05
Branch: `codex/grill-session-docs`
PR: https://github.com/serzhlukasohov/entallent-v2/pull/5
Slack DM used for production smoke: `D0BJDC2MPE2`
Production Slack human: `U09GT50APCM`
Production tenant: `7d1e0163-6d53-4713-bd24-254690cc5090`
Production user: `5d2f17fd-a125-4239-8f43-31adbbd8ff42`

## Current state

The branch is pushed and the local working tree was clean before this handoff file was created.

The latest code fix deployed to Railway worker is:

- Commit `99af807` — `Normalize confirmation label before validation`
- Railway worker deployment `9f50b47b-aa3b-4cdd-bc4c-b0ccb63297b4` — `SUCCESS`

Docs/evidence commits after that:

- `74378ed` — `Record Slack confirmation label verification`
- `d3de1e9` — `Record full Slack product smoke blocker`

## What was fixed

### 1. Confirmation prompt leaked the technical `confirmationSummary:` label

Observed in real Slack after reset:

- Prompt Slack ts: `1788620652.225249`
- User-visible prompt contained `confirmationSummary:`.
- DB confirmation invariants still worked, but the Slack UX exposed an internal field name.

Fixes made:

- `packages/ai-openai/src/openai-provider.ts`
  - rejects invalid confirmation drafts;
  - strips a simple exposed `confirmationSummary:` prefix at the OpenAI provider boundary before validation.
- `packages/ai-openai/src/openai-provider.test.ts`
  - regression verifies one provider call produces clean user-visible text.
- `packages/application/src/use-cases/conversation-orchestrator.ts`
  - existing safety guard remains the cross-provider fail-closed protection.
- `packages/application/src/use-cases/conversation-orchestrator.test.ts`
  - safety-net regression exists.

Verification before deploy:

- `pnpm --filter @entalent/ai-openai test -- src/openai-provider.test.ts` — 28/28
- `pnpm --filter @entalent/application test -- src/use-cases/conversation-orchestrator.test.ts` — 46/46
- `pnpm --filter @entalent/ai-openai typecheck`
- `pnpm --filter @entalent/ai-openai lint`
- `pnpm --filter @entalent/application typecheck`
- `pnpm --filter @entalent/application lint`
- `git diff --check`
- `git push` pre-push hook ran full `pnpm typecheck && pnpm lint && pnpm test` successfully.

Production verification after deploy:

- QA inbound: `1788625181.572739`
- Clean confirmation prompt: `1788625190.977569`
- DB for prompt:
  - `label_present=false`
  - `metadata.confirmationSummary=true`
  - `summary_in_text=true`
  - `purpose.status=awaiting_confirmation`
- Confirmation inbound: `1788625265.827379`
- Bot ack: `1788625274.747389`
- DB after confirmation:
  - `purpose.status=confirmed`
  - `confirmation_message_id=ed0302b3-0230-4b92-8d0b-ab6ace26ae28`
  - `confirmation_prompt_message_id=8e8a9b33-b6c9-4047-8f73-b088d7bc12b0`

## Full Slack product smoke result

User asked to check the whole product through Slack after the fix.

Production active survey groups found in DB:

- `autonomy`
- `belonging`
- `engagement`
- `growth`
- `purpose`

Already confirmed at the start of full smoke:

- `autonomy=confirmed`
- `purpose=confirmed`

Slack turns sent for `belonging` coverage:

- `1788630307.036599`
- `1788630347.494009`
- `1788630387.852369`
- `1788630579.811119`
- `1788630629.043149`
- `1788630701.902929`

Observed behavior:

- Normal conversational replies worked.
- Survey evidence persisted.
- `belonging` and `engagement` reached `pending_confirmation`.
- Bot repeatedly sent only the reporting disclosure text.
- Bot did not surface a confirmation prompt for the additional pending groups.

Production DB evidence after the full smoke:

- `belonging.status=pending_confirmation`
- `engagement.status=pending_confirmation`
- `belonging.reporting_disclosure_shown_at=null`
- `engagement.reporting_disclosure_shown_at=null`
- `belonging.confirmation_prompt_message_id=null`
- `engagement.confirmation_prompt_message_id=null`

Important: this is a new blocker found by full-product Slack testing. It is not a regression in the `confirmationSummary:` label fix.

## Next blocker to fix

Problem:

Additional pending groups repeat disclosure without progressing to confirmation prompt.

Expected behavior:

Once a pending group has enough evidence and reporting disclosure has been delivered, the next safe user turn should record/bind that disclosure receipt for the target pending group and stage a confirmation prompt with exact displayed summary proof.

Likely area to inspect next:

- `packages/application/src/use-cases/conversation-orchestrator.ts`
- survey disclosure / pending confirmation selection logic
- worker delivery activation path that records delivered disclosure / prompt state
- `apps/worker/src/survey/repositories/group-state.repository.ts`

Suggested next implementation plan:

1. Reproduce locally with a focused orchestrator or worker repository test: existing confirmed groups plus two additional groups in `pending_confirmation` with no prompt.
2. Identify where disclosure-only response is generated and why it does not bind `reporting_disclosure_shown_at` to `belonging`/`engagement`.
3. Fix at the shared state-transition boundary, not in Slack-specific code.
4. Keep the invariant that confirmed states require:
   - delivered disclosure before confirmation;
   - delivered prompt with `metadata.confirmationSummary`;
   - prompt text contains the exact summary;
   - no user-visible `confirmationSummary:` label.
5. Run targeted tests, typecheck/lint, push, deploy only affected Railway service, then rerun real Slack smoke.

## Do not repeat

- Do not revive MAF for this work; the supported path is the TypeScript runtime.
- Do not send sensitive psychological-safety/manager-accusation payloads through Slack. One prior sensitive payload was auto-review rejected.
- Use neutral synthetic QA language when testing real Slack.
- Do not reset production data unless the user explicitly asks again.

## Existing docs updated

- `docs/agent-failures.md`
  - `2026-09-05: Confirmation label retry failed closed without Slack reply`
  - `2026-09-05: Additional pending groups repeat disclosure without confirmation prompt`
- `docs/agent-task-log.md`
  - label fix implementation/deploy rows
  - full Slack product smoke partial row

## Recommended first prompt for the new Codex session

Continue in `/Users/serzh/Documents/enTalentNew` on branch `codex/grill-session-docs`. Read `_bmad-output/implementation-artifacts/handoff-2026-09-05-full-slack-product-smoke.md`, `docs/agent-failures.md`, and `docs/agent-task-log.md`. Use BMad and Ponytail. Fix the current blocker: additional pending survey groups (`belonging` and `engagement`) repeat disclosure-only messages and never stage a confirmation prompt after real Slack evidence. Do not reset production data unless explicitly authorized. First reproduce locally with a focused test, propose the smallest shared-boundary fix, then implement, test, push, deploy only the affected Railway service, and rerun real Slack smoke in `D0BJDC2MPE2`.
