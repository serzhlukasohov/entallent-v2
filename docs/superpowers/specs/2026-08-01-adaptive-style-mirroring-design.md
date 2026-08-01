# Adaptive style mirroring (gradual linguistic accommodation)

**Date:** 2026-08-01
**Status:** Approved (design)

## Problem

The agent's reply style is fixed. People build rapport through *linguistic
accommodation* (Communication Accommodation Theory): they gradually converge
toward each other's tone, register, humor, and phrasing. We want the agent to do
the same — subtly adopt the employee's communication style over time — while
keeping its own base persona dominant.

## Goal

After each conversation, the agent adapts its style toward the employee by a small
step (~5-10%), accumulating across conversations up to a hard cap (≤40% of the
style is the user's; ≥60% remains the base persona). Adaptation is gradual,
measurable, capped, and safe (never mirrors hostility/profanity; freezes in
crisis).

## Approach (chosen)

**Structured per-user style profile + EMA blend + prompt conditioning.** A
persisted profile tracks the employee's observed style per dimension (smoothed
across conversations) and a global adaptation weight that ramps up per
conversation to a 0.4 cap. The respond prompt is conditioned on `base*(1-w) +
user*w` per dimension.

Industry framing: this is the "user style profile + prompt conditioning" pattern
used by companion/personalization products, with an EMA user model (as in
recommender personalization). Alternatives considered and rejected:
- *Reflection/narrative memory* (Generative Agents / MemGPT): a free-text "how they
  talk" note — flexible but the 5-10% step and 40% cap cannot be enforced.
- *Few-shot from the user's own utterances*: cheap, but adaptation strength is
  uncontrollable, risks parroting, and carries no cross-conversation model.
- *Style embeddings / per-user fine-tune (LoRA)*: heavy, needs data volume, not
  incremental-per-user. Out of scope.

## Design

### Component 1: Per-user style profile (persistence)

New table `user_style_profiles` (one row per user+tenant — the profile is a numeric
singleton that does not fit the `memory_items` "list of facts" model):

- `userId`, `tenantId` (unique together)
- `dimensions jsonb` — observed user level `u[dim] ∈ [0,1]` per axis:
  - `register`: 0 = formal / «вы», 1 = casual / «ты»
  - `humor`: 0 = earnest, 1 = playful
  - `verbosity`: 0 = terse/clipped, 1 = elaborate
  - `emoji`: 0 = none, 1 = frequent
- `phrases jsonb` — up to 5 characteristic expressions/emoji with a frequency
  count (profanity/hostility excluded at capture time)
- `adaptationWeight` numeric `w ∈ [0, 0.4]`
- `conversationsAnalyzed` int, `updatedAt` timestamp

### Component 2: Adaptation math (pure function, single source of truth)

A pure module (unit-tested) that consumes the current profile + one conversation's
observed signal and returns the next profile. It is the ONE place the 5-10%/40%
rules live:

- EMA toward the user per dimension: `u ← u + α·(observed − u)`, `α = 0.3`.
- Weight ramp: if the conversation had enough user signal (≥ `MIN_USER_TURNS`, e.g.
  3 non-trivial user turns), `w ← min(0.4, w + 0.075)`; otherwise `w` unchanged.
- Phrase merge: dedupe, increment counts, keep the top ≤5 by frequency/recency.
- Effective render level per dimension (used by Component 4): `base[dim]*(1-w) +
  u[dim]*w`, so the base persona is always ≥60%.

### Component 3: Style analyzer (post-conversation)

An AI call (parallel to `extractMemory`) that reads ONLY the employee's turns from
the just-ended conversation and returns `observed[dim] ∈ [0,1]` per axis plus
candidate characteristic phrases/emoji. Guardrail at capture: it must exclude
profanity, hostility, and sarcasm-directed-at-others from both the dimension
scoring intent and the phrase candidates.

Trigger: enqueue a dedicated `style-analysis` job at the same point the orchestrator
enqueues memory extraction (`conversation-orchestrator.ts` ~line 239), processed by
a new worker processor that calls the analyzer, then Component 2, then persists the
profile. Separate job = separate concern, shared timing.

### Component 4: Renderer → respond prompt

A function that turns the profile into a compact "style adaptation" block for
`buildRespondSystemPrompt`, scaled by `w`:
- Translate each effective dimension level into concrete, soft guidance (e.g. high
  register→"lean a bit more casual, ты is fine"; higher humor→"a little more
  playful"; higher emoji→"an occasional emoji is fine"; verbosity→length nudge).
- If `w` is low / few conversations analyzed, emit little or nothing (cold start).
- May list ≤2 of the user's characteristic phrases as "expressions you can
  occasionally echo — sparingly, never forced."
- The block explicitly states the base persona stays primary and adaptation is
  subtle (≤40%). It sits with the style guidance, not overriding the persona or the
  reflective-opener rules.

### Component 5: Guardrails

- Capture-side (Component 3): never record profanity/hostility/cruelty as style to
  adopt.
- Render-side (Component 4): the adaptation block is omitted entirely when
  `strategy.mode` is `crisis` or `sensitive` — the base empathetic tone owns those
  turns.
- Cap: `w ≤ 0.4` guarantees the base persona dominates.

### Component 6: Evals (extend the promptfoo harness)

A `style-adaptation` suite (real-prompt provider) asserting: (a) with a high-`w`
profile the reply shows the adaptation (e.g. more casual when the profile says so),
(b) the base persona markers are still present (no wholesale takeover), (c) the
adaptation block is absent in a crisis-mode render. Deterministic checks where
possible (e.g. the renderer omits the block in crisis) + `llm-rubric` for tone.

### Data flow

```
conversation ends → enqueue style-analysis (alongside memory extraction)
  → analyzer reads USER turns → observed[dim] + phrase candidates (guardrail-filtered)
  → adaptation math (EMA u, ramp w≤0.4, merge phrases) → persist profile

reply generation → load profile → renderer builds style block (base*(1-w)+u*w),
  omitted in crisis/sensitive → buildRespondSystemPrompt → model
```

### Testing

- Unit: adaptation math — EMA converges, `w` ramps by 0.075 and caps at 0.4, no
  ramp without enough signal, phrase list dedupes/caps at 5.
- Unit: renderer — cold start emits ~nothing; high-`w` emits scaled guidance; crisis
  mode emits nothing; base persona always ≥60% framing present.
- Unit: analyzer guardrail (mock AI) — profanity/hostility candidates dropped.
- Eval: `style-adaptation` suite (base preserved / adaptation bounded / off in
  crisis).

## Out of scope (v1)

- Within-conversation adaptation (v1 updates only between conversations).
- Style embeddings / per-user fine-tuning.
- Adapting anything beyond the four axes + a small phrase set.
- Mirroring profanity/edginess (conservative guardrail chosen).

## Notes / risks

- Cold start: with no profile, `w=0` and the agent behaves exactly as today.
- Over-mirroring / parroting: bounded by `w≤0.4`, sparse phrase use, and the evals.
- The analyzer adds one post-conversation LLM call per conversation (like memory
  extraction) — acceptable, off the reply hot path.
