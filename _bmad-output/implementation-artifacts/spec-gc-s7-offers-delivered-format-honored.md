---
title: 'GC round 3 S7: accepted offers are delivered; explicit format requests are honored (CAP-6 T7, CAP-9 T11)'
type: 'bugfix'
created: '2026-10-15'
status: 'in-review'
review_loop_iteration: 1
baseline_commit: '275febc'
context:
  - '{project-root}/_bmad-output/specs/spec-gc-testing-2026-10-12/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-gc-testing-2026-10-12/fix-plan.md'
  - '{project-root}/docs/adr/ADR-013-understanding-policy-rails.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** T7: the coach ends replies with "If you want, I can..." and when the employee accepts ("Yes, a bit more direct please") the next reply restates the previous content and repeats the offer; the short acceptance is classified as an acknowledgement, the pause contract forbids "restarting coaching", and offers are forbidden only under the correction contract. T11: "give me an outline with timings, a list with time slots" gets one prose paragraph because the hard style rule "no headers or bullet points" has no exception for an explicit format request.

**Approach:** ADR-013 D1: Turn Understanding gains `priorAssistantOffer`, `acceptsPriorOffer` and `formatRequest`; deterministic code validates them (acceptance without a prior offer fails closed to false, an unknown format fails closed to null). The reply plan maps an accepted offer to `answer_request` with a required grounding item `deliver_now` and the forbidden moves `offer_again` and `new_offer`; a request turn or an open, unanswered offer forbids `new_offer`. The reply prompt renders an offer-delivery contract (deliver the item now, no restatement, no new offer), lifts the no-list style rule only when `formatRequest` is set, and allows Slack-safe plain "-" or numbered lines within the existing length budget.

## Boundaries & Constraints

**Always:**
- Semantics come from the classifier's structured output; code only validates and maps. No regex, word list, or canned user-facing text decides whether a message is an acceptance, an offer, or a format request.
- The pause/acknowledgement contract never applies to a turn whose response move is `answer_request`.
- List formatting stays within the existing `maxReplyChars` budget and the one-question policy; no headers, no bold.
- Every new signal is visible in the reply plan handed to generation (`replyPlan.requiredGrounding`, `forbiddenMoves`, `formatRequest`) so sims and logs can assert on it.

**Ask First:** Any commit, push, deploy, or production read; adding a self-declared `containsOffer` field to `GeneratedResponse` (rejected here: TU already judges the latest assistant turn); any change to MAF/agent-service.

**Never:**
- No change to the bundle/clarification turns (S3) or to the cycle-progress work (S4/S5).
- No persistence of offer state in outbound metadata; "one open offer" is read from the transcript by the classifier each turn.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Accepted offer | Latest assistant turn offered X; employee: "Yes, a bit more direct please" | TU `priorAssistantOffer=true`, `acceptsPriorOffer=true`; plan `answer_request`, grounding `deliver_now`, forbidden `offer_again`+`new_offer`, zero questions; reply delivers X, no offer | N/A |
| Acceptance labelled acknowledgement | Classifier returns `dialogueAct=acknowledgement` with `acceptsPriorOffer=true` | Plan still `answer_request`; prompt shows the offer-delivery contract and no acknowledgement contract | N/A |
| Acceptance without a prior offer | `acceptsPriorOffer=true`, `priorAssistantOffer=false` | Contract parse sets `acceptsPriorOffer=false`; ordinary plan | fails closed |
| Open offer, employee moves on | `priorAssistantOffer=true`, `acceptsPriorOffer=false`, new substance | Plan forbids `new_offer`; otherwise unchanged | N/A |
| Deliverable requested | `dialogueAct=request`, no prior offer | Plan forbids `new_offer` so the item is delivered, not offered | N/A |
| Format request | `formatRequest='outline'` on a request turn | Prompt lifts the no-list rule for this turn: one item per line, plain "-" or "1." prefixes, within the length budget; reply has separated lines | N/A |
| Unknown format value | `formatRequest='table'` | Parsed as null; prose rule stays | fails closed |
| Older classifier payload | fields absent | `priorAssistantOffer=false`, `acceptsPriorOffer=false`, `formatRequest=null` | N/A |

</frozen-after-approval>

## Code Map

- `packages/contracts/src/ai.ts` -- `SituationClassificationSchema` gains `priorAssistantOffer`, `acceptsPriorOffer`, `formatRequest` with fail-closed parsing
- `packages/application/src/ports/ai-provider.port.ts` -- `ReplyPlan.requiredGrounding` source `prior_offer` / requirement `deliver_now`; `forbiddenMoves` `offer_again`, `new_offer`; `formatRequest`; question reason `offer_delivery`
- `packages/application/src/utils/reply-plan.ts` -- mapping rules above
- `packages/ai-openai/src/prompts/classify.ts` -- field definitions and rules for the three signals
- `packages/ai-openai/src/prompts/respond.ts` -- offer-delivery and format contracts open the system prompt; offer limits, conditional style rule, pause contract excludes `answer_request`
- `packages/application/src/utils/reply-length.ts` -- long budget (980) on a format-request turn
- `packages/ai-openai/src/openai-provider.ts` -- soft question gate on delivery turns (one repair, never fail-closed), list-aware length repair
- `packages/application/src/use-cases/conversation-orchestrator.ts` -- decision metadata counts only memory grounding
- `packages/conversation-sim/src/scenarios/offer-delivered.sim.test.ts`, `format-request-outline.sim.test.ts` -- live scenarios from the 2026-10-15 DM; `gate.config.json`, `package.json` test excludes

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/ai.test.ts` -- RED: defaults, fail-closed acceptance and format
- [x] `packages/application/src/utils/reply-plan.test.ts` -- RED: acceptance mapping, open-offer and request limits, format passthrough
- [x] `packages/ai-openai/src/prompts/respond.test.ts` / `classify.test.ts` -- RED: contract blocks and classifier rules
- [x] `packages/application/src/use-cases/conversation-orchestrator.test.ts` -- RED: acceptance labelled acknowledgement still reaches generation as `answer_request`
- [x] contracts, application port/util, ai-openai prompts -- GREEN
- [ ] conversation-sim scenarios (live when `.env` allows), gate config, `docs/agent-task-log.md` row, `pnpm harness:check -- --base main`

**Acceptance Criteria:**
- Given the live T7 sequence (offer, then "Yes, a bit more direct please"), when the turn is processed, then the reply plan is `answer_request` with `deliver_now` grounding and the reply contains the offered phrases and no new offer.
- Given the live T11 request for an outline with time slots, when the turn is processed, then the reply plan carries `formatRequest` and the reply has separated items with time slots.
- Given every existing reply-plan, prompt, orchestrator and worker test, when the suites run, then they stay green.

## Spec Change Log

- 2026-10-15: Checkpoint 1 was taken from the parent session's brief (design a-d of fix-plan S7); no human edit before implementation. `priorAssistantOffer` added beyond the brief so "one open offer per thread" has a typed source without persisting offer state.
- 2026-10-15 (review loop 1, patches only, no loopback): two blind reviewers raised 20 findings, 14 patched with their own RED tests (quoted question marks in delivered phrases no longer fail the turn: soft gate with one repair; format turns get the long budget and a list-aware length repair; `formatRequest` ignored on sensitive, support, pause turns; an accepted offer does not override emotional disclosure, closing, or correction; no offer limits in sensitive mode; memory and goal hints off on delivery turns; capability-decline carve-out in the offer limit; outline wording no longer asserts time slots; decision metadata counts memory grounding only; sim hard assertions loosened), 2 deferred (`deferred-work.md`), 4 rejected (by-design single-turn offer tracking, retired MAF runtime contract drift, cosmetic wording). After the patches a live sample showed the persona's trailing offer winning over the buried contract; the offer-delivery and format contracts now open the system prompt and delivery turns carry a zero-question policy (`format_request`). KEEP: fail-closed contract parsing; `answer_request` never under the pause contract; the offer item itself is read from the transcript, never persisted.

## Verification

**Commands:**
- `pnpm --filter @entalent/contracts exec vitest run src/ai.test.ts` -- expected: pass
- `pnpm --filter @entalent/application exec vitest run src/utils/reply-plan.test.ts src/use-cases/conversation-orchestrator.test.ts` -- expected: pass
- `pnpm --filter @entalent/ai-openai exec vitest run src/prompts` -- expected: pass
- `pnpm --filter @entalent/worker test` -- expected: pass
- `pnpm typecheck && pnpm lint` -- expected: pass
- `pnpm --filter @entalent/conversation-sim exec vitest run src/scenarios/offer-delivered.sim.test.ts src/scenarios/format-request-outline.sim.test.ts` -- expected: pass (live, needs Azure credentials)
- `pnpm harness:check -- --base main` -- expected: receipt path
