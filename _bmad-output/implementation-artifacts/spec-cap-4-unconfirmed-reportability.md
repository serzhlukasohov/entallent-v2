---
title: 'CAP-4: Explain that unconfirmed pulse answers are not reportable'
type: 'bugfix'
created: '2026-09-16'
status: 'done'
baseline_commit: 'd32499075588c7b7b433ba0a65619d302d498492'
review_loop_iteration: 0
context:
  - '{project-root}/docs/collected-product-requirements.md'
  - '{project-root}/PRIVACY.md'
  - '{project-root}/_bmad-output/specs/spec-generic-conversation-bug-backlog/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-generic-conversation-bug-backlog/bug-catalog.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-cap-3-pulse-confirmation-access.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-cap-7-relevant-pulse-disclosure.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The exact D02-02 question about using unconfirmed answers in team reports is not guaranteed to reach the deterministic reporting path. When it does, the current answer explains confirmation and access but does not separate temporary storage from report eligibility, allowing a free-form or incomplete reply to imply that unconfirmed answers may be rolled into reports.

**Approach:** Recognize the narrow unconfirmed/reportability question at the existing latest-turn normalization boundary, then extend the existing localized deterministic reporting explanation with the truthful storage/reportability boundary. Reuse the current intent, safety precedence, response branch, and unchanged canonical disclosure.

## Boundaries & Constraints

**Always:** State that conversation or temporary working state may still be retained under product retention rules, but storage alone never makes it reportable. Unconfirmed pulse answers and temporary summaries must not contribute to team-report scoring, aggregation, themes, recommendations, intermediate reports, or final reports. Only a confirmed, de-identified, non-withdrawn exact shown summary may contribute to team-level reporting. Preserve CAP-3 access wording, CAP-7 relevance, safety precedence, awaiting-confirmation behavior, disclosure receipt deduplication, and EN/RU/UK output fallback.

**Ask First:** Commit, push, deploy, production data mutation, or any Slack payload requires explicit authorization for this CAP-4 slice.

**Never:** Say that unconfirmed means deleted or never stored; say `possibly`, `depending on setup`, or that unconfirmed data may be rolled into reporting; change durable report gates, schema, repositories, prompt-only policy, the generic proactive disclosure, or `REPORTING_DISCLOSURE_VERSION`; touch retired MAF/`agent-service`; add a new intent or second policy engine.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Exact D02-02 | `And if I don't confirm it, can my answers still be used in team reports?` with a non-reporting model intent | Promote to `reporting_explanation`; answer `no`, distinguish retention from reportability, and omit free-form generation | Do not interpret the question as confirmation or mutate survey state |
| Safety plus reportability | A safety-sensitive turn also asks whether unconfirmed answers enter reports | Keep safety primary and reporting secondary; safety blocking suppresses the explanation | Fail closed through the existing safety route |
| Descriptive negative control | A non-question statement mentions unconfirmed answers or reporting | Do not promote it | Preserve the ordinary response path |
| Localized output | Recognized request with `en`, `ru`, `uk`, or a locale tag | Return semantically equivalent policy text; unknown locale falls back to English | Keep the canonical appended disclosure byte-for-byte unchanged |

</frozen-after-approval>

## Code Map

- `packages/ai-openai/src/openai-provider.ts` -- sole latest-turn reporting normalizer; D02-02 currently depends on model classification.
- `packages/ai-openai/src/openai-provider.test.ts` -- classification promotion, safety-ordering, and false-positive regressions.
- `packages/application/src/utils/reporting-disclosure.ts` -- single localized deterministic reporting explanation plus unchanged disclosure.
- `packages/application/src/use-cases/conversation-orchestrator.ts` -- unchanged deterministic consumer and safety/reporting boundary.
- `packages/application/src/use-cases/conversation-orchestrator.test.ts` -- employee-visible policy and no-mutation assertions.

## Tasks & Acceptance

**Execution:**
- [x] `packages/ai-openai/src/openai-provider.test.ts` and `packages/ai-openai/src/openai-provider.ts` -- add exact D02-02 RED coverage, then narrowly promote the request through the existing safety-preserving normalizer without widening unrelated reporting matches.
- [x] `packages/application/src/use-cases/conversation-orchestrator.test.ts` and `packages/application/src/utils/reporting-disclosure.ts` -- add the exact consumer RED and minimally extend the shared EN/RU/UK deterministic explanation; keep orchestration and proactive disclosure code unchanged.
- [x] `_bmad-output/specs/spec-generic-conversation-bug-backlog/bug-catalog.md`, `docs/agent-failures.md`, and `docs/agent-task-log.md` -- record local and later production evidence without staging unrelated artifacts.

**Acceptance Criteria:**
- Given exact D02-02 with a non-reporting model result, when classification and orchestration run, then one deterministic answer is returned without free-form generation, confirmation interpretation, survey-state confirmation, or report enqueueing.
- Given the answer text, when policy assertions inspect it, then it clearly separates permitted temporary retention from prohibited reportability and names the confirmed, de-identified, non-withdrawn gate.
- Given a safety-sensitive reporting question or unrelated descriptive text, when normalization runs, then safety remains primary and unrelated content is not promoted.
- Given existing CAP-3/CAP-7/proactive tests, when the affected suites run, then access wording, relevance, disclosure text/version, one-time delivery, and confirmation handling remain intact.

## Spec Change Log

- 2026-09-16: Production smoke exposed quoted reporting questions inside explicit translation requests as a false-positive promotion. Commit `7b4de2a` keeps translation/rewrite/paraphrase/proofread intent primary while preserving exact D02-02 handling.

## Verification

**Commands:**
- `pnpm exec tsx scripts/agent-harness.ts reflection --changed-path packages/ai-openai/src/openai-provider.ts` -- expected: relevant failures loaded or exit 2.
- `pnpm exec tsx scripts/agent-harness.ts reflection --changed-path packages/application/src/utils/reporting-disclosure.ts` -- expected: relevant failures loaded or exit 2.
- `pnpm --filter @entalent/ai-openai exec vitest run src/openai-provider.test.ts` -- expected: D02-02 RED observed, then full focused suite passes.
- `pnpm --filter @entalent/application exec vitest run src/use-cases/conversation-orchestrator.test.ts src/use-cases/proactive-check-in.use-case.test.ts` -- expected: CAP-4 and preservation regressions pass.
- `pnpm --filter @entalent/ai-openai typecheck && pnpm --filter @entalent/application typecheck` -- expected: both packages pass.
- `pnpm harness:check -- --base d32499075588c7b7b433ba0a65619d302d498492` -- expected: structured PASS receipt with no retired-runtime path touched.

**Production evidence:**
- Commits `b739286` and `7b4de2a` are pushed; production worker deployment `623d0710-d2b3-4ab3-825d-c28440dcb2ac` completed with `SUCCESS`.
- Final focused checks passed: provider 47/47, orchestrator/proactive 97/97, follow-up harness `runs/harness/receipt-1789562641878-0c108268.json`, pre-push harness `runs/harness/receipt-1789562714722-6f5df628.json`, and preflight `runs/harness/receipt-1789562962297-a37846ae.json`.
- Slack channel `D0BJDC2MPE2`: translation control inbound `1789562978.295899` received the requested Polish translation; exact D02-02 inbound `1789563008.191069` received the deterministic reportability boundary. A read-back after 20 seconds showed exactly one reply per inbound and no late duplicates.
- A descriptive-statement control was not sent because the connector rejected it as potentially mutating confirmation state; no workaround was attempted.

## Suggested Review Order

**Classification boundary**

- Exact-turn promotion preserves safety and disables survey mutation for D02-02.
  [`openai-provider.ts:428`](../../packages/ai-openai/src/openai-provider.ts#L428)

**Employee-facing policy**

- Shared localized text separates retention from confirmed report eligibility.
  [`reporting-disclosure.ts:10`](../../packages/application/src/utils/reporting-disclosure.ts#L10)

**Regression coverage**

- Provider cases cover misclassification, safety, quotes, and descriptive statements.
  [`openai-provider.test.ts:342`](../../packages/ai-openai/src/openai-provider.test.ts#L342)

- Consumer cases cover no mutation, localization, forbidden claims, and safety suppression.
  [`conversation-orchestrator.test.ts:524`](../../packages/application/src/use-cases/conversation-orchestrator.test.ts#L524)
