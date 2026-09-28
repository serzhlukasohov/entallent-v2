---
title: 'CAP-10: Preserve English after an accidental Ukrainian keyboard slip'
type: 'bugfix'
created: '2026-09-13'
status: 'done'
review_loop_iteration: 0
baseline_commit: '78b175cef1cb52af81436954d7a291bf765856a6'
context:
  - '{project-root}/_bmad-output/specs/spec-generic-conversation-bug-backlog/SPEC.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** When an English message quotes one accidental Ukrainian/Cyrillic token, `inferLanguage()` treats the presence of any Cyrillic character as decisive. The reply can therefore acknowledge an English-language correction in Ukrainian, reproducing D05-05 and violating CAP-10.

**Approach:** Make mixed-script inference follow the dominant meaningful script so an English-majority correction remains English. Preserve existing behavior for genuinely Ukrainian, Russian, and English messages; keep this slice limited to language selection rather than prompt style or rapid-message coalescing.

## Boundaries & Constraints

**Always:** Start with the exact D05-05 regression and observe the expected RED before production code. Reuse the existing language-policy boundary and test conventions. Keep the supported TypeScript runtime, existing locale support, and all current language tests green. After deterministic checks pass, verify once through a clearly synthetic real Slack conversation using the authorized Slack connector: establish English, send one accidental Ukrainian token, then send an English correction and wait for each reply before the next turn.

**Ask First:** Commit, push, deploy, production reset, database mutation, or any Slack payload beyond the single synthetic CAP-10 sequence requires separate approval unless already explicitly requested in the active user turn.

**Never:** Modify or invoke MAF or `agent-service`; add a second language detector; introduce a dependency; hardcode the exact transcript; solve CAP-9 debounce/coalescing in this slice; expose secrets or non-synthetic personal content in Slack evidence.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| D05-05 regression | English correction containing quoted `нуі`, with previous/profile language Ukrainian | `responseLanguage='en'`; acknowledgment text is English | Test fails if Cyrillic presence alone wins |
| Genuine Ukrainian | Ukrainian-majority message | Ukrainian remains selected | Existing behavior must not regress |
| Genuine English | English-only message | English remains selected | Existing behavior must not regress |
| Mixed-script tie or no letters | Equal meaningful Latin/Cyrillic evidence, or punctuation/digits only | Preserve the existing fallback language contract | Do not invent a new locale |

</frozen-after-approval>

## Code Map

- `packages/application/src/utils/language-policy.ts` — owns `inferLanguage()` and currently selects Cyrillic from any matching character.
- `packages/application/src/use-cases/conversation-orchestrator.ts` — consumes the inferred response language for the typed reply plan.
- `packages/application/src/use-cases/conversation-orchestrator.test.ts` — existing language-selection regression patterns and downstream behavior coverage.
- `packages/application/src/utils/language-policy.test.ts` — preferred focused unit regression if direct policy coverage is absent.
- `_bmad-output/specs/spec-generic-conversation-bug-backlog/bug-catalog.md` — record final CAP-10 evidence and status after verification.

## Tasks & Acceptance

**Execution:**
- [x] `packages/application/src/utils/language-policy.test.ts` — exact D05-05 RED captured (`expected en`, received `uk`); final policy matrix passes 23/23.
- [x] `packages/application/src/utils/language-policy.ts` — select the dominant meaningful script, ignore concrete transport/code artifacts, and preserve locale fallback for ties.
- [x] `packages/application/src/use-cases/conversation-orchestrator.test.ts` — no new consumer test needed; existing orchestrator and proactive consumers pass 82/82 against the shared policy.
- [x] `_bmad-output/specs/spec-generic-conversation-bug-backlog/bug-catalog.md` — deterministic, deploy, and two real Slack receipts recorded.

**Acceptance Criteria:**
- Given Ukrainian is the previous or profile language, when the current message is the exact English D05-05 correction containing one quoted Ukrainian token, then the selected response language is English.
- Given a genuinely Ukrainian-majority message, when language is inferred, then Ukrainian remains selected.
- Given the authorized synthetic Slack sequence, when the user explains the keyboard slip in English, then the next bot reply is in English and no production data outside that conversation is mutated.

## Spec Change Log

- 2026-09-13 — Implementation review hardened mixed-script inference against Slack/URL/email/code artifacts, equal-script fallback, natural hyphen/slash compounds, and Ukrainian apostrophe variants. No approved intent or runtime boundary changed.

## Verification

**Commands:**
- `pnpm --filter @entalent/application exec vitest run src/utils/language-policy.test.ts src/use-cases/conversation-orchestrator.test.ts src/use-cases/proactive-check-in.use-case.test.ts` — passed 105/105.
- `pnpm --filter @entalent/application typecheck` — passed.
- `pnpm --filter @entalent/application exec eslint src/utils/language-policy.ts src/utils/language-policy.test.ts` — passed.
- `pnpm harness:check -- --base HEAD` — `status=passed`; receipt `runs/harness/receipt-1789303654134-f51e7ba5.json`.
- Pre-push harness — `status=passed`; receipt `runs/harness/receipt-1789378337394-88af946f.json`.
- `pnpm harness:preflight` — PostgreSQL `localhost:5434` and Redis `localhost:6380` reachable; receipt `runs/harness/receipt-1789378477255-2872eefd.json`.
- Railway production worker deployment `1d4db80c-9768-4bd1-b021-f5ab1da93160` — `SUCCESS`.
- Blind Hunter and Edge Case Hunter final passes — no remaining high/medium CAP-10 findings.

**Manual checks:**
- D05-style correction: Ukrainian setup reply `1789378619.346709`; English correction with quoted `нуі` `1789378692.689599`; one English bot reply `1789378698.034309`.
- Compound/Unicode edge: Ukrainian setup reply `1789378730.747019`; English correction with `пʼять`, `English-language`, and `yes/no` `1789378752.933369`; one English bot reply `1789378757.410849`.
- Isolated `нуі` also preserved the ongoing English conversation; final channel read-back showed exactly one bot reply per inbound and no duplicate delivery.

## Suggested Review Order

**Language decision**

- Compare meaningful script words once, with ties delegated to the existing fallback.
  [`language-policy.ts:50`](../../packages/application/src/utils/language-policy.ts#L50)

- Remove only concrete transport and code artifacts before language inference.
  [`language-policy.ts:65`](../../packages/application/src/utils/language-policy.ts#L65)

**Regression evidence**

- Reproduce the exact D05-05 English correction after a Ukrainian keyboard slip.
  [`language-policy.test.ts:11`](../../packages/application/src/utils/language-policy.test.ts#L11)

- Preserve genuine languages, fallback ties, and transport-artifact boundaries.
  [`language-policy.test.ts:19`](../../packages/application/src/utils/language-policy.test.ts#L19)

- Cover natural compounds and all supported Ukrainian apostrophe forms.
  [`language-policy.test.ts:91`](../../packages/application/src/utils/language-policy.test.ts#L91)
