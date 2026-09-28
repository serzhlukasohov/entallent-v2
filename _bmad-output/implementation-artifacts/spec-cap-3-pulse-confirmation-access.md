---
title: 'CAP-3: Explain pulse confirmation without implying individual access'
type: 'bugfix'
created: '2026-09-14'
status: 'done'
baseline_commit: 'e5e9b0526ce40785dffa6dde2cb2aada826d35d8'
review_loop_iteration: 0
context:
  - '{project-root}/docs/collected-product-requirements.md'
  - '{project-root}/PRIVACY.md'
  - '{project-root}/_bmad-output/specs/spec-generic-conversation-bug-backlog/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-generic-conversation-bug-backlog/bug-catalog.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The two D02-01 questions about a manager opening personal EnTalent data and HR reading confirmed pulse answers are not reliably recognized as reporting explanations. When recognized, the deterministic reply still describes aggregation without saying that confirmation does not grant individual access, so free-form or incomplete answers can imply unsupported administrator visibility.

**Approach:** Recognize those explicit access questions from the latest employee turn at the existing classification-normalization boundary, then answer them with one deterministic localized explanation that preserves the canonical disclosure while stating the confirmation/access boundary.

## Boundaries & Constraints

**Always:** Treat confirmation as approval of the exact shown de-identified summary and eligibility for aggregate team reporting. State that confirmation does not change permissions or let standard manager/HR reporting views open individual messages, answers, personal summaries, tasks, goals, or identity. Preserve safety as the primary intent, CAP-7 relevance behavior, awaiting-confirmation semantics, disclosure receipt deduplication, English/Russian/Ukrainian locale fallback, and cohort-safe manager reporting.

**Ask First:** Commit, push, deploy, production data mutation, or any Slack payload requires the user's explicit authorization for this CAP-3 slice.

**Never:** Claim that no internal administrator can ever access stored data; audited system-admin/debug access is separate from employee confirmation. Do not change the generic proactive disclosure or `REPORTING_DISCLOSURE_VERSION`, broaden manager/HR product access, touch retired MAF/`agent-service`, or add a second policy engine.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Manager access | `We're in EnTalent on Slack. I mean my manager's EnTalent access: can they open my messages, personal summary or tasks?` with a non-reporting model intent | Promote to `reporting_explanation`; deterministic answer denies standard manager-view access and explains aggregate eligibility | Do not call free-form response generation |
| HR after confirmation | `If I confirm a pulse summary, does that let HR read my own answers?` with reporting intent | Keep `reporting_explanation`; say confirmation approves the shown summary but grants no individual HR access | Reject speculative admin/setup wording |
| Safety plus access | A safety-sensitive turn also asks about reporting access | Keep safety primary and add reporting as secondary; safety blocking still suppresses disclosure | Fail closed through existing safety path |
| Unrelated reporting context | Descriptive or answer-quality text mentions managers/reports without asking about individual access | Do not promote it to `reporting_explanation` | Preserve CAP-7 ordinary-answer route |

</frozen-after-approval>

## Code Map

- `packages/ai-openai/src/openai-provider.ts` -- latest-turn reporting-intent normalizer; current access vocabulary and promotion behavior are incomplete.
- `packages/ai-openai/src/openai-provider.test.ts` -- provider-level regression proving the raw D02-01 wording survives model misclassification without CAP-7 false positives.
- `packages/application/src/utils/reporting-disclosure.ts` -- canonical localized disclosure and the narrow deterministic access-explanation copy.
- `packages/application/src/use-cases/conversation-orchestrator.ts` -- deterministic reporting-explanation branch; proactive disclosure callers must remain unchanged.
- `packages/application/src/use-cases/conversation-orchestrator.test.ts` -- consumer-visible policy assertions and safety/confirmation preservation.

## Tasks & Acceptance

**Execution:**
- [x] `packages/ai-openai/src/openai-provider.test.ts` -- add exact D02-01 RED cases for promotion, retention, safety precedence, and the existing unrelated-context negative control.
- [x] `packages/ai-openai/src/openai-provider.ts` -- minimally extend latest-turn recognition and promote explicit access requests while preserving any safety intent.
- [x] `packages/application/src/use-cases/conversation-orchestrator.test.ts` -- add the exact HR question as a RED consumer regression with positive policy assertions and negative speculative-access assertions.
- [x] `packages/application/src/utils/reporting-disclosure.ts` and `packages/application/src/use-cases/conversation-orchestrator.ts` -- return a localized access explanation only for deterministic reporting questions, reusing the unchanged generic disclosure.
- [x] `_bmad-output/specs/spec-generic-conversation-bug-backlog/bug-catalog.md`, `docs/agent-failures.md`, and `docs/agent-task-log.md` -- record verified status, failure layer, checks, and remaining production evidence without staging unrelated records.

**Acceptance Criteria:**
- Given either exact D02-01 question, when classification and orchestration run, then the employee receives one deterministic product-grounded answer without free-form model generation.
- Given a recognized access explanation, when its text is inspected, then it says confirmation approves the shown de-identified summary for aggregate eligibility and does not grant manager/HR individual access, and it omits `assume admins may see`, `visible to people who administer`, `depending on setup`, or any claim that confirmation changes permissions.
- Given a safety-sensitive access question or unrelated manager/reporting context, when normalization runs, then safety remains primary and unrelated content is not promoted.
- Given proactive pulse disclosure and existing receipt state, when the affected suites run, then disclosure text/version, one-time delivery, confirmation handling, and CAP-7 behavior remain unchanged.

## Spec Change Log

## Verification

**Commands:**
- `pnpm exec tsx scripts/agent-harness.ts reflection --changed-path packages/ai-openai/src/openai-provider.ts` -- expected: relevant open failures loaded, or exit 2 with no eligible failures.
- `pnpm exec tsx scripts/agent-harness.ts reflection --changed-path packages/application/src/use-cases/conversation-orchestrator.ts` -- expected: relevant open failures loaded, or exit 2 with no eligible failures.
- `pnpm --filter @entalent/ai-openai exec vitest run src/openai-provider.test.ts` -- expected: all provider tests pass after the D02-01 RED failure is observed.
- `pnpm --filter @entalent/application exec vitest run src/use-cases/conversation-orchestrator.test.ts src/use-cases/proactive-check-in.use-case.test.ts` -- expected: CAP-3 policy and existing disclosure/safety/confirmation regressions pass.
- `pnpm --filter @entalent/ai-openai typecheck && pnpm --filter @entalent/application typecheck` -- expected: both packages pass.
- `pnpm harness:check -- --base e5e9b0526ce40785dffa6dde2cb2aada826d35d8` -- expected: structured PASS receipt and no retired-runtime path touched.

## Suggested Review Order

**Deterministic policy boundary**

- Route every recognized reporting question through one safety-aware deterministic branch.
  [`conversation-orchestrator.ts:430`](../../packages/application/src/use-cases/conversation-orchestrator.ts#L430)

- Keep access truth and the unchanged aggregate disclosure in one localized helper.
  [`reporting-disclosure.ts:9`](../../packages/application/src/utils/reporting-disclosure.ts#L9)

**Latest-turn normalization**

- Promote the exact access request while preserving any safety intent as primary.
  [`openai-provider.ts:426`](../../packages/ai-openai/src/openai-provider.ts#L426)

**Regression evidence**

- Cover both exact D02-01 questions, safety ordering, and the false-positive control.
  [`openai-provider.test.ts:301`](../../packages/ai-openai/src/openai-provider.test.ts#L301)

- Prove deterministic delivery, policy wording, and no free-form fallthrough.
  [`conversation-orchestrator.test.ts:451`](../../packages/application/src/use-cases/conversation-orchestrator.test.ts#L451)
