---
title: 'CAP-5: Explain product message use and AI identity truthfully'
type: 'bugfix'
created: '2026-09-16'
status: 'done'
baseline_commit: '7b4de2a4c76c68e84aa7894597cb39826ccb9200'
review_loop_iteration: 1
context:
  - '{project-root}/docs/collected-product-requirements.md'
  - '{project-root}/PRIVACY.md'
  - '{project-root}/_bmad-output/specs/spec-generic-conversation-bug-backlog/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-generic-conversation-bug-backlog/bug-catalog.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-cap-4-unconfirmed-reportability.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Exact D02-03 and equivalent direct questions about how EnTalent uses messages can fall through to free-form generation, allowing false exclusivity such as “only to reply here” and omitting known memory/action, pulse-measurement, and safety processing. The same turn also asks whether the mentor is a real person.

**Approach:** Add one typed `data_use_explanation` intent at the existing latest-turn normalization boundary and one localized deterministic answer at the orchestrator boundary. Reuse current safety precedence, language selection, and response delivery; keep reporting disclosure/version semantics separate and unchanged.

## Boundaries & Constraints

**Always:** Answer that the mentor is an AI assistant, not a human. State only documented product uses: conversational assistance; optional private memory and relevant goals/tasks/reminders; pulse measurement with the existing confirmed, de-identified, non-withdrawn reporting gate; safety processing; product retention rules; and audited internal admin/debug access. Keep private memory and unconfirmed material non-reportable. Safety remains primary. A transparency turn must not confirm, correct, exclude, stage, or enqueue a report.

**Ask First:** Commit, push, deploy, production data mutation, or any Slack payload requires explicit authorization for this CAP-5 slice.

**Never:** Claim messages are used “only” for the current reply; invent model-training, human-review, HR-notification, crisis-escalation, confidentiality, third-party, or exact tenant-retention behavior. Do not count this broad answer as the versioned REQ-015 disclosure, alter `reporting-disclosure-v1`, change the passive survey-evidence pipeline, or modify retired MAF/`agent-service`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Exact D02-03 | `What do you use my messages for? Are you a real person?` with any non-safety model intent | Promote to `data_use_explanation`; return one complete deterministic answer without free-form generation | Set `surveyAllowed=false`; preserve existing survey state |
| Explicit follow-up | Direct question naming memory, tasks, pulse reporting, or safety checks | Use the same typed route and complete answer | Do not make tenant-specific guesses |
| Safety plus transparency | A safety-sensitive turn also asks about data use | Keep safety primary and transparency secondary; blocking safety suppresses the policy answer | Fail closed through existing safety handling |
| Transform/evaluation control | Translation, rewrite, paraphrase, proofreading, or another-chatbot evaluation quotes D02-03 | Do not promote quoted content | Preserve ordinary request handling |
| Descriptive or mixed-action control | A statement describes data use, or the turn also asks for a reminder/action | Do not take over the whole turn | Preserve model handling and existing action semantics |
| Localized output | Recognized EN/RU/UK request or locale tag | Return equivalent localized policy; unknown locale falls back to English | Canonical reporting disclosure stays byte-for-byte unchanged |

</frozen-after-approval>

## Code Map

- `packages/contracts/src/ai.ts` -- typed situation-intent contract consumed by provider and orchestrator.
- `packages/ai-openai/src/prompts/classify.ts` -- model-facing intent list and direct product-transparency guidance.
- `packages/ai-openai/src/openai-provider.ts` -- sole latest-turn normalization boundary; owns safety and text-transform precedence.
- `packages/application/src/utils/reporting-disclosure.ts` -- existing localized employee-facing privacy/reporting policy text; add the separate data-use answer without changing disclosure text/version.
- `packages/application/src/use-cases/conversation-orchestrator.ts` -- deterministic typed-response selection and survey-state guards.
- Focused tests: `packages/ai-openai/src/openai-provider.test.ts` and `packages/application/src/use-cases/conversation-orchestrator.test.ts`.

## Tasks & Acceptance

**Execution:**
- [x] Add exact D02-03 provider and consumer RED tests before production code.
- [x] Add `data_use_explanation` to the shared contract/prompt and narrowly normalize direct latest-turn requests, preserving safety and transform/evaluation controls.
- [x] Add localized EN/RU/UK deterministic text and select it in the orchestrator without creating a reporting-disclosure receipt.
- [x] Record local and later production evidence in the bug catalog and harness docs without staging unrelated artifacts.

**Acceptance Criteria:**
- Given exact D02-03 with a wrong model classification, when the active TypeScript path runs, then one deterministic, product-grounded answer covers AI identity and documented uses and contains no unsupported exclusivity.
- Given an awaiting confirmation, when D02-03 arrives, then no confirmation/report lifecycle mutation occurs and free-form generation is skipped.
- Given safety, quoted transforms/evaluations, descriptive statements, or mixed actionable requests, when normalization runs, then precedence and ordinary handling remain intact.
- Given CAP-3/4/7 and proactive regressions, when affected suites run, then access/reportability answers, relevance, canonical disclosure text/version, and one-time delivery remain unchanged.

## Spec Change Log

## Verification

**Commands:**
- `pnpm exec tsx scripts/agent-harness.ts reflection --changed-path packages/ai-openai/src/openai-provider.ts` and the application utility path -- expected: relevant failures loaded or exit 2.
- `pnpm --filter @entalent/ai-openai exec vitest run src/openai-provider.test.ts` -- expected: D02-03 RED observed, then focused suite passes.
- `pnpm --filter @entalent/application exec vitest run src/use-cases/conversation-orchestrator.test.ts src/use-cases/proactive-check-in.use-case.test.ts` -- expected: CAP-5 and preservation regressions pass.
- Affected package typecheck/lint, `git diff --check`, then `pnpm harness:check -- --base 7b4de2a4c76c68e84aa7894597cb39826ccb9200` -- expected: PASS with no retired-runtime path touched.

**Local evidence:**
- RED observed before production edits: provider returned `casual_conversation` instead of `data_use_explanation`; orchestrator returned free-form `reply` instead of the deterministic policy.
- GREEN: provider 69/69; orchestrator/proactive 103/103; contracts, AI provider, and application typecheck/lint pass; `git diff --check` passes.
- Blind/Edge review findings for reporting-route precedence, RU/UK recovery, quoted/control false positives, polite transforms/evaluations, mixed-action loss, hallucinated reminders, safety ordering, locale assertions, and `surveyAllowed=true` confirmation-state protection were reproduced and fixed. Passive survey-evidence enqueueing remains unchanged per the frozen boundary.
- Harness: `runs/harness/receipt-1789571774123-d024aad4.json` passed for the full CAP-5 diff from baseline `7b4de2a4c76c68e84aa7894597cb39826ccb9200`.
- Production: commit `b82b9f6` pushed to `origin/codex/grill-session-docs`; pre-push harness `runs/harness/receipt-1789588344843-41b6ba0d.json`; worker deployment `59aca7b4-85b8-47fc-be5b-bc14ddceac08` reached `SUCCESS`; preflight `runs/harness/receipt-1789588709264-3bb3cfc8.json` confirmed PostgreSQL and Redis. QA identity had zero active survey windows and zero pending/awaiting confirmation states before and after the smoke. Exact D02-03 inbound `1789588823.744549` received one complete deterministic reply `1789588827.123789`; both persisted under trace `38d2de36-b6ed-4d9f-b83c-55347dd18498` without a `reportingDisclosureVersion` receipt, and no late duplicate appeared.

## Suggested Review Order

**Runtime behavior**

- Entry point recognizes transparency intent before survey-state work.
  [`conversation-orchestrator.ts:179`](../../packages/application/src/use-cases/conversation-orchestrator.ts#L179)

- Deterministic localized answer bypasses free-form generation while preserving safety precedence.
  [`conversation-orchestrator.ts:441`](../../packages/application/src/use-cases/conversation-orchestrator.ts#L441)

**Classification boundary**

- Shared latest-turn normalizer handles direct requests and rejects control or mixed-action false positives.
  [`openai-provider.ts:452`](../../packages/ai-openai/src/openai-provider.ts#L452)

- Provider composes reporting normalization before broader data-use normalization.
  [`openai-provider.ts:217`](../../packages/ai-openai/src/openai-provider.ts#L217)

**Policy content**

- One localized policy table states documented uses without changing disclosure semantics.
  [`reporting-disclosure.ts:15`](../../packages/application/src/utils/reporting-disclosure.ts#L15)

- Classifier prompt describes the typed route and its exclusions.
  [`classify.ts:40`](../../packages/ai-openai/src/prompts/classify.ts#L40)

**Contracts and regression proof**

- Shared intent enum exposes the route to provider and application layers.
  [`ai.ts:22`](../../packages/contracts/src/ai.ts#L22)

- Provider regressions cover exact, localized, safety, reporting, control, and mixed-action cases.
  [`openai-provider.test.ts:376`](../../packages/ai-openai/src/openai-provider.test.ts#L376)

- Orchestrator regression proves complete copy and zero survey mutation.
  [`conversation-orchestrator.test.ts:573`](../../packages/application/src/use-cases/conversation-orchestrator.test.ts#L573)
