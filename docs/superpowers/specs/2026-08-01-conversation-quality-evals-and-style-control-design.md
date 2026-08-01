# Conversation quality: measurable evals + architectural style control

**Date:** 2026-08-01
**Status:** Approved (design)

## Problem

Reply style/quality in `packages/ai-openai/src/prompts/respond.ts` is controlled
entirely by a growing list of **negative prompt rules** ("don't start with…",
"don't nod along…"). Two systemic issues:

1. **Rules get gamed.** The model routes around specific bans with new phrasings.
   Example: after banning "Это звучит" / "Похоже", it opened replies with "Вот это
   уже звучит как…" and "Вот это, похоже, и есть корень:" — the same reflective
   "verdict-on-their-words" opener, new words.
2. **Changes are blind.** There is no measurement, so no one can tell whether a
   prompt edit improved naturalness or regressed something else.

There IS an eval harness (`evals/` using promptfoo, datasets: empathy, proactivity,
safety, memory, injection) and prompt-run metadata logging (`llm_runs`), but the
eval datasets test **hand-simplified stub prompts**, not the real
`buildRespondSystemPrompt`. So they cannot catch real respond-prompt regressions.

## Goal

Make conversation quality **measurable** (so prompt changes stop being blind) and
control style **architecturally** rather than by accreting prohibitions — shifting
from "list of don'ts" to "few positive exemplars + measurement", with a cheap
runtime backstop. No extra LLM call on the common path.

## Approach (chosen)

Two layers, built together:
- **Layer 1 — Measurement:** run promptfoo against the *real* production prompt and
  add a naturalness suite (deterministic checks + LLM-rubric judge), seeded from
  real transcripts.
- **Layer 2 — Runtime:** few-shot good/bad exemplars in the respond prompt (0 extra
  calls) as the primary lever, plus a deterministic opener detector that triggers a
  single regeneration only when it fires.

A shared anti-pattern module is the single source of truth used by both the runtime
detector and the eval assertions.

Alternatives considered/rejected: always-on critic/rewrite pass (rejected — extra
LLM call every reply, latency); fine-tuning (deferred — needs curated data, heavy);
prompt-rules-only (status quo — the problem).

## Design

### Component 1: Shared style anti-pattern module

`packages/ai-openai/src/prompts/style-antipatterns.ts` (NEW):
- Exports `OPENER_ANTIPATTERNS: RegExp[]` — patterns for the reflective/label opener
  (e.g. `/^\s*вот это\b/i`, `/^\s*(это )?звучит как\b/i`, `/^\s*похоже,/i`,
  `/^\s*то,?\s*что ты (описыва|говор)/i`), matched against the reply's FIRST
  sentence/line only.
- Exports `hasReflectiveOpener(text: string): boolean`.
- This module is the ONE definition consumed by both the runtime gate (Component 3)
  and the eval assertions (Component 4). No duplicated regexes.

### Component 2: Few-shot exemplars in the respond prompt

`packages/ai-openai/src/prompts/respond-examples.ts` (NEW) + wired into
`buildRespondSystemPrompt`:
- 3-4 compact BAD→GOOD pairs. BAD = opens with a verdict/label on the user's words;
  GOOD = leads straight with substance (a specific observation / one sharp question).
- Rendered as a short "How a good reply differs from a bad one" block near the end
  of the system prompt (positive exemplars, not more prohibitions).
- The existing pattern-level negative rule (already added) stays as a backstop.
- Kept in a separate file so `respond.ts` stays focused.

### Component 3: Runtime opener gate (single regeneration, no always-on cost)

In `OpenAiProvider.generateResponse` (`openai-provider.ts`):
- After generating + parsing the reply, run `hasReflectiveOpener(text)`.
- If it fires, regenerate ONCE with an intensified instruction appended to the
  system prompt (e.g. "Your previous draft opened by labeling what they said. Do
  NOT. Delete that opener; start with the substance."). Use the second result
  regardless (no infinite loop).
- Common path = zero extra calls; the extra call happens only on a detected miss.
- Applies to all `generateResponse` callers (live replies + proactive).

### Component 4: Evals against the real prompt

`evals/` (extend existing promptfoo setup):
- **Real-prompt provider:** a promptfoo custom prompt (JS function) that imports the
  built `buildRespondSystemPrompt`/`buildRespondUserPrompt` from `@entalent/ai-openai`
  and renders them from test `vars` (turns, strategy, context). This replaces the
  stub prompts for the response-generation suites so evals exercise production code.
- **`evals/datasets/naturalness.yaml` (NEW):** cases seeded from real transcripts,
  including the observed openers. Two assertion layers per case:
  1. deterministic `javascript` assert that calls `hasReflectiveOpener` (via the
     built module) on `output.text` → must be false;
  2. `llm-rubric` assert scoring: "Does the reply open with a verdict/label on what
     the employee just said? Is the opener formulaic? Rate naturalness." → must pass
     the rubric. Catches novel variants the regex misses.
- Add the suite to `promptfooconfig.yaml`. Record a baseline pass rate.

### Data flow

```
respond prompt (persona + few-shot exemplars + backstop rules)
  → generateResponse → hasReflectiveOpener(text)?
      no  → use reply
      yes → regenerate once with intensified instruction → use reply

evals: test vars → real buildRespond* prompt → model → assertions
  (hasReflectiveOpener == false)  +  (llm-rubric naturalness pass)
```

### Testing

- Unit: `style-antipatterns.test.ts` — `hasReflectiveOpener` true on the observed
  openers and their variants, false on good openers (leads-with-substance, a
  question, a between-the-lines naming that is NOT the opener).
- Unit: `openai-provider` gate — mock the client to return a reflective-opener draft
  first and a clean draft second; assert one regeneration happened and the clean
  reply is returned; assert NO regeneration when the first draft is clean.
- Eval: `naturalness.yaml` runs green against the real prompt; baseline recorded.
- Existing suites still pass (empathy/etc. now run against the real prompt — expect
  to fix/adjust any that relied on the stub).

## Out of scope (v1)

- Always-on critic/rewrite pass; fine-tuning a style model.
- Expanding evals beyond naturalness + wiring the real prompt into the other
  response suites (do naturalness first; migrate others opportunistically).
- Storing raw prompt/output text in `llm_runs` (privacy — keep metadata-only).

## Notes / risks

- Migrating the empathy/proactivity suites to the real prompt may surface existing
  failures (the stub was lenient). That is the point — but budget time to triage.
- The regex detector is deliberately narrow (first-sentence openers); the LLM-rubric
  is the net for everything else. Keep the regex list small and shared.
