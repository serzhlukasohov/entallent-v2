# Conversation Quality: Evals + Style Control — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make reply naturalness measurable (promptfoo evals against the *real* respond prompt) and control style architecturally (few-shot exemplars + a cheap runtime opener-gate) instead of by accreting prompt prohibitions.

**Architecture:** One shared anti-pattern module (`style-antipatterns.ts`) is the single source of truth for the reflective-opener detector, used by both a runtime gate in `generateResponse` (regenerate once on a detected miss — zero extra calls on the common path) and by eval assertions. Few-shot BAD→GOOD exemplars go into the respond prompt. The existing promptfoo suite is pointed at the real `buildRespond*` builders and gains a `naturalness` dataset (deterministic check + LLM-rubric).

**Tech Stack:** TypeScript, Vitest, promptfoo (`npx promptfoo`), Azure/OpenAI via `@entalent/ai-openai`.

## Global Constraints

- Package manager: pnpm workspace filters (e.g. `pnpm --filter @entalent/ai-openai test`). Never `npx vitest`.
- Tests: Vitest for unit tests; promptfoo for evals (evals hit a live model — run on demand, not in the unit-test path).
- Reuse `OpenAiProvider.complete(system, user, model, maxTokens?)` for any model call.
- The reflective-opener detector is defined ONCE in `style-antipatterns.ts` and imported everywhere (runtime + evals). No duplicated regexes.
- Detector matches only the reply's FIRST sentence/line (openers), to stay narrow; the LLM-rubric is the net for novel variants.
- After any change under `packages/ai-openai`, run `pnpm --filter @entalent/ai-openai build` before running evals (evals `require` the built `dist`).

---

## File Structure

- `packages/ai-openai/src/prompts/style-antipatterns.ts` — NEW: `OPENER_ANTIPATTERNS`, `hasReflectiveOpener`.
- `packages/ai-openai/src/prompts/style-antipatterns.test.ts` — NEW: detector unit tests.
- `packages/ai-openai/src/prompts/respond-examples.ts` — NEW: `RESPOND_STYLE_EXAMPLES` few-shot block.
- `packages/ai-openai/src/prompts/respond.ts` — MODIFY: inject examples block; export nothing new.
- `packages/ai-openai/src/openai-provider.ts` — MODIFY: opener gate in `generateResponse`.
- `packages/ai-openai/src/openai-provider.test.ts` — MODIFY: gate tests.
- `packages/ai-openai/src/index.ts` — MODIFY: export `buildRespondSystemPrompt`, `buildRespondUserPrompt`, `hasReflectiveOpener`, `OPENER_ANTIPATTERNS`.
- `evals/providers/respond-prompt.js` — NEW: promptfoo prompt function that renders the real prompt from vars.
- `evals/datasets/naturalness.yaml` — NEW: naturalness suite.
- `evals/promptfooconfig.yaml` — MODIFY: register the naturalness suite.

---

### Task 1: Shared reflective-opener detector

**Files:**
- Create: `packages/ai-openai/src/prompts/style-antipatterns.ts`
- Test: `packages/ai-openai/src/prompts/style-antipatterns.test.ts`
- Modify: `packages/ai-openai/src/index.ts`

**Interfaces:**
- Produces: `OPENER_ANTIPATTERNS: RegExp[]`; `hasReflectiveOpener(text: string): boolean`.

- [ ] **Step 1: Write the failing test**

Create `packages/ai-openai/src/prompts/style-antipatterns.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { hasReflectiveOpener } from './style-antipatterns';

describe('hasReflectiveOpener', () => {
  it('flags observed verdict-on-their-words openers', () => {
    expect(hasReflectiveOpener("That's already sounding like a very clear-eyed take: results matter to you.")).toBe(true);
    expect(hasReflectiveOpener('That, it seems, is the real root: not just noise, but noise that spreads.')).toBe(true);
    expect(hasReflectiveOpener('Sounds like a classic overload.')).toBe(true);
    expect(hasReflectiveOpener("What you're describing is burnout.")).toBe(true);
  });

  it('does not flag replies that lead with substance or a question', () => {
    expect(hasReflectiveOpener("And when your lead said 'yeah, yeah' — was that indifference, or did he just not have an answer?")).toBe(false);
    expect(hasReflectiveOpener('Your role seems clear enough, but decisions still route through Roma — is that what slows things down?')).toBe(false);
    expect(hasReflectiveOpener('Okay. Which part of this makes you angriest?')).toBe(false);
  });

  it('only inspects the opener, not later sentences', () => {
    // A between-the-lines naming later in the reply is fine.
    expect(hasReflectiveOpener("Let's take it in order. Sounds like it's not really about the deadlines.")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @entalent/ai-openai test -- --run style-antipatterns.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

Create `packages/ai-openai/src/prompts/style-antipatterns.ts`:

```typescript
/**
 * Reflective "verdict-on-their-words" opener patterns — the formulaic way the model
 * opens a reply by labeling/characterizing what the employee just said instead of
 * leading with substance ("That's starting to sound like…", "Sounds like…", "What
 * you're describing is…"). Single source of truth for both the runtime gate and evals.
 * Matched ONLY against the reply's first sentence/line.
 */
export const OPENER_ANTIPATTERNS: RegExp[] = [
  /^that(?:'s|\s+is)?\s+(?:already\s+|starting\s+to\s+)?sound(?:s|ing)?\s+like\b/i,
  /^(?:it\s+)?sounds\s+like\b/i,
  /^(?:it\s+)?seems\s+like\b/i,
  /^what\s+you(?:'re|\s+are)\s+(?:describing|saying)\b/i,
  /^so,?\s+(?:what\s+)?you(?:'re|\s+are)\s+saying\b/i,
  /^that,\s+it\s+seems,\s+is\b/i,
  /^that(?:'s|\s+is)\s+(?:really\s+|probably\s+)?(?:the\s+)?(?:real\s+)?(?:root|core|crux|heart|problem|issue)\b/i,
];

/** True if the reply OPENS with a reflective label on the user's own words. */
export function hasReflectiveOpener(text: string): boolean {
  if (!text) return false;
  const firstLine = text.trimStart().split(/(?<=[.!?…])\s|\n/)[0] ?? '';
  const opener = firstLine.trim();
  return OPENER_ANTIPATTERNS.some((re) => re.test(opener));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @entalent/ai-openai test -- --run style-antipatterns.test.ts`
Expected: PASS

- [ ] **Step 5: Export from index**

In `packages/ai-openai/src/index.ts` add:

```typescript
export { OPENER_ANTIPATTERNS, hasReflectiveOpener } from './prompts/style-antipatterns';
```

- [ ] **Step 6: Build + commit**

Run: `pnpm --filter @entalent/ai-openai build`
Expected: build success.

```bash
git add packages/ai-openai/src/prompts/style-antipatterns.ts packages/ai-openai/src/prompts/style-antipatterns.test.ts packages/ai-openai/src/index.ts
git commit -m "feat(ai): shared reflective-opener detector (style-antipatterns)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Few-shot style exemplars in the respond prompt

**Files:**
- Create: `packages/ai-openai/src/prompts/respond-examples.ts`
- Modify: `packages/ai-openai/src/prompts/respond.ts`
- Test: `packages/ai-openai/src/prompts/respond.test.ts` (exists)

**Interfaces:**
- Consumes: nothing new.
- Produces: `RESPOND_STYLE_EXAMPLES: string` rendered inside `buildRespondSystemPrompt`.

- [ ] **Step 1: Write the failing test**

Add to `packages/ai-openai/src/prompts/respond.test.ts`:

```typescript
import { RESPOND_STYLE_EXAMPLES } from './respond-examples';

describe('buildRespondSystemPrompt few-shot exemplars', () => {
  const strat: ReplyStrategy = {
    mode: 'normal', tone: 'warm', includeFollowUpQuestion: true,
    maxResponseLength: 'medium', forbiddenPatterns: [],
  };
  it('includes the BAD→GOOD exemplars block', () => {
    const prompt = buildRespondSystemPrompt(strat, { userName: 'Test' });
    expect(prompt).toContain(RESPOND_STYLE_EXAMPLES.trim().slice(0, 24));
  });
  it('exemplars demonstrate leading with substance, not labeling', () => {
    expect(RESPOND_STYLE_EXAMPLES.toLowerCase()).toContain('that, it seems');   // shown as the BAD pattern
    expect(RESPOND_STYLE_EXAMPLES).toMatch(/BAD/);
    expect(RESPOND_STYLE_EXAMPLES).toMatch(/GOOD/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @entalent/ai-openai test -- --run respond.test.ts`
Expected: FAIL — `respond-examples` not found.

- [ ] **Step 3: Create the exemplars**

Create `packages/ai-openai/src/prompts/respond-examples.ts`:

```typescript
/**
 * Few-shot exemplars for reply STYLE. Models imitate concrete good/bad examples more
 * reliably than they obey prohibitions. Each pair contrasts a reflective "label their
 * words" opener (BAD) with a reply that leads straight with substance (GOOD).
 */
export const RESPOND_STYLE_EXAMPLES = `How a good reply differs from a bad one (do NOT copy content, copy the MOVE):

Employee: "in all the chaos, with so many things pulling at everyone, people start spreading themselves thin"
BAD (opens by labeling what they said): "That, it seems, is the real root: not just noise, but noise that infects everyone around it…"
GOOD (leads with substance / a real question): "Have you figured out what to cut off first so the chaos stops spreading — or is it still unclear what to grab onto?"

Employee: "you do your part well, but the result gets lost somewhere down the line"
BAD: "That's already sounding like a very clear-eyed take: results matter to you…"
GOOD: "Where exactly does it get lost — in the handoff to others, or when priorities shift midway?"`;
```

- [ ] **Step 4: Wire it into the prompt**

In `packages/ai-openai/src/prompts/respond.ts`, import at top:

```typescript
import { RESPOND_STYLE_EXAMPLES } from './respond-examples';
```

Then include it in the returned system prompt, immediately BEFORE the `Hard rules:`
section (so exemplars sit with the style guidance). Concatenate `\n\n${RESPOND_STYLE_EXAMPLES}\n` ahead of the `Hard rules:` block string.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @entalent/ai-openai test -- --run respond.test.ts`
Expected: PASS (new + existing respond tests).

- [ ] **Step 6: Commit**

```bash
git add packages/ai-openai/src/prompts/respond-examples.ts packages/ai-openai/src/prompts/respond.ts packages/ai-openai/src/prompts/respond.test.ts
git commit -m "feat(ai): few-shot BAD->GOOD reply exemplars in respond prompt

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Runtime opener gate (regenerate once on a detected miss)

**Files:**
- Modify: `packages/ai-openai/src/openai-provider.ts` (`generateResponse`)
- Test: `packages/ai-openai/src/openai-provider.test.ts`

**Interfaces:**
- Consumes: `hasReflectiveOpener` from `./prompts/style-antipatterns`.
- Produces: `generateResponse` returns a reply whose opener passed the detector (or the single regenerated draft).

- [ ] **Step 1: Write the failing test**

Add to `packages/ai-openai/src/openai-provider.test.ts` (uses existing `createMock`/`makeProvider`):

```typescript
import { ReplyStrategy } from '@entalent/contracts';

describe('OpenAiProvider.generateResponse opener gate', () => {
  beforeEach(() => createMock.mockReset());
  const strat = { mode: 'normal', tone: 'warm', includeFollowUpQuestion: true, maxResponseLength: 'medium', forbiddenPatterns: [] } as ReplyStrategy;

  it('regenerates once when the first draft opens with a reflective label', async () => {
    createMock
      .mockResolvedValueOnce({ choices: [{ finish_reason: 'stop', message: { content: '{"text":"That, it seems, is the real root: noise.","confidence":0.9,"containsSurveyProbe":false}' } }] })
      .mockResolvedValueOnce({ choices: [{ finish_reason: 'stop', message: { content: '{"text":"What is stopping you from cutting that off first?","confidence":0.9,"containsSurveyProbe":false}' } }] });
    const provider = makeProvider();
    const res = await provider.generateResponse([{ role: 'user', content: 'chaos', timestamp: new Date() }], strat, { userName: 'X' });
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(res.text).toBe('What is stopping you from cutting that off first?');
  });

  it('does not regenerate when the first draft is clean', async () => {
    createMock.mockResolvedValue({ choices: [{ finish_reason: 'stop', message: { content: '{"text":"What is stopping you from cutting that off first?","confidence":0.9,"containsSurveyProbe":false}' } }] });
    const provider = makeProvider();
    await provider.generateResponse([{ role: 'user', content: 'chaos', timestamp: new Date() }], strat, { userName: 'X' });
    expect(createMock).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @entalent/ai-openai test -- --run openai-provider.test.ts`
Expected: FAIL — second draft not used / only one call.

- [ ] **Step 3: Implement the gate**

In `packages/ai-openai/src/openai-provider.ts` add the import:

```typescript
import { hasReflectiveOpener } from './prompts/style-antipatterns';
```

Add a module-level constant near the other prompt imports:

```typescript
const OPENER_RETRY_INSTRUCTION =
  '\n\nYour previous draft OPENED by labeling what the employee just said (a "verdict on their words"). Do NOT do that. Delete that opening sentence entirely and start with the substance — a specific observation or one sharp question.';
```

Replace `generateResponse` with:

```typescript
  async generateResponse(
    turns: ConversationTurn[],
    strategy: ReplyStrategy,
    context: ResponseContext,
  ): Promise<GeneratedResponse> {
    const system = buildRespondSystemPrompt(strategy, context);
    const user = buildRespondUserPrompt(turns, context);

    const first = GeneratedResponseSchema.parse(
      JSON.parse(await this.complete(system, user, this.generationModel)),
    );
    if (!hasReflectiveOpener(first.text)) return first;

    // One corrective regeneration — the common path never reaches here.
    return GeneratedResponseSchema.parse(
      JSON.parse(await this.complete(system + OPENER_RETRY_INSTRUCTION, user, this.generationModel)),
    );
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @entalent/ai-openai test -- --run openai-provider.test.ts`
Expected: PASS (all provider tests).

- [ ] **Step 5: Build + commit**

Run: `pnpm --filter @entalent/ai-openai build`

```bash
git add packages/ai-openai/src/openai-provider.ts packages/ai-openai/src/openai-provider.test.ts
git commit -m "feat(ai): opener gate — regenerate once when a reply opens with a reflective label

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Export real prompt builders + promptfoo real-prompt provider

**Files:**
- Modify: `packages/ai-openai/src/index.ts`
- Create: `evals/providers/respond-prompt.js`

**Interfaces:**
- Consumes: `buildRespondSystemPrompt`, `buildRespondUserPrompt` from the built `@entalent/ai-openai`.
- Produces: a promptfoo prompt function file usable as `file://providers/respond-prompt.js`.

- [ ] **Step 1: Export the builders**

In `packages/ai-openai/src/index.ts` add:

```typescript
export { buildRespondSystemPrompt, buildRespondUserPrompt } from './prompts/respond';
```

Run: `pnpm --filter @entalent/ai-openai build`
Expected: build success; `dist/index.js` now exports the builders.

- [ ] **Step 2: Write the eval provider (with a self-check)**

Create `evals/providers/respond-prompt.js`:

```javascript
// promptfoo prompt function: renders the REAL production respond prompt from test vars,
// so evals exercise buildRespondSystemPrompt/buildRespondUserPrompt, not a stub.
const { buildRespondSystemPrompt, buildRespondUserPrompt } = require('@entalent/ai-openai');

module.exports = async function ({ vars }) {
  const strategy = vars.strategy || {
    mode: 'normal', tone: 'warm', includeFollowUpQuestion: true,
    maxResponseLength: 'medium', forbiddenPatterns: [],
  };
  const context = vars.context || { userName: vars.userName || 'there' };
  const turns = (vars.turns || []).map((t) => ({
    role: t.role, content: t.content, timestamp: new Date(),
  }));
  return [
    { role: 'system', content: buildRespondSystemPrompt(strategy, context) },
    { role: 'user', content: buildRespondUserPrompt(turns, context) },
  ];
};
```

- [ ] **Step 3: Verify it loads against the built package**

Run:
```bash
node -e "const f=require('./evals/providers/respond-prompt.js'); f({vars:{userName:'X',turns:[{role:'user',content:'hi'}]}}).then(m=>console.log(m[0].content.slice(0,40)))"
```
Expected: prints the first ~40 chars of the real system prompt (not an error). If it errors with "Cannot find module '@entalent/ai-openai'", run the Step 1 build first.

- [ ] **Step 4: Commit**

```bash
git add packages/ai-openai/src/index.ts evals/providers/respond-prompt.js
git commit -m "feat(evals): export real respond builders + promptfoo real-prompt provider

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Naturalness eval suite

**Files:**
- Create: `evals/datasets/naturalness.yaml`
- Modify: `evals/promptfooconfig.yaml`

**Interfaces:**
- Consumes: `evals/providers/respond-prompt.js`; `hasReflectiveOpener` from `@entalent/ai-openai` (in the JS assert).

- [ ] **Step 1: Create the dataset**

Create `evals/datasets/naturalness.yaml`:

```yaml
description: Naturalness — replies must not open by labeling the employee's words

prompts:
  - file://../providers/respond-prompt.js

tests:
  - description: reply to a "chaos/noise" observation must not open with a verdict-label
    vars:
      userName: Vika
      turns:
        - role: assistant
          content: "Where is your output leaking the most right now?"
        - role: user
          content: "in all the chaos, with so many things pulling at everyone, people start spreading themselves thin"
    assert:
      - type: javascript
        value: |
          const { hasReflectiveOpener } = require('@entalent/ai-openai');
          const text = JSON.parse(output).text || '';
          return hasReflectiveOpener(text)
            ? { pass: false, score: 0, reason: 'Opens with a reflective label: ' + text.slice(0, 60) }
            : { pass: true, score: 1, reason: 'ok' };
      - type: llm-rubric
        value: |
          The reply must NOT open by labeling or characterizing what the employee just said
          (e.g. "That's starting to sound like…", "That's the real root…", "What you're describing is…").
          It should lead with substance — a specific observation or a single genuine question.
          Fail if the first sentence is a verdict on the employee's words.

  - description: reply to "the result gets lost down the line" must lead with substance
    vars:
      userName: Vika
      turns:
        - role: user
          content: "you do your part well, but the result gets lost somewhere down the line"
    assert:
      - type: javascript
        value: |
          const { hasReflectiveOpener } = require('@entalent/ai-openai');
          return !hasReflectiveOpener(JSON.parse(output).text || '');
      - type: llm-rubric
        value: |
          The first sentence must not restate/label what the employee said. Leading with a
          concrete question or observation passes; a reflective "verdict" opener fails.
```

- [ ] **Step 2: Register the suite**

In `evals/promptfooconfig.yaml`, add under `tests:`:

```yaml
  - $ref: ./datasets/naturalness.yaml
```

- [ ] **Step 3: Build the package the evals import**

Run: `pnpm --filter @entalent/ai-openai build`
Expected: success (evals `require('@entalent/ai-openai')` at run time).

- [ ] **Step 4: Run the naturalness suite and record a baseline**

Run (needs `OPENAI_API_KEY` in env; this makes real model calls):
```bash
npx promptfoo eval --config evals/datasets/naturalness.yaml
```
Expected: the suite runs and reports pass/fail per case. Record the baseline pass rate in the commit message. It is acceptable for some `llm-rubric` cases to fail on the first baseline — that is the measurement we now have. The deterministic `hasReflectiveOpener` asserts should pass given Tasks 2-3.

- [ ] **Step 5: Commit**

```bash
git add evals/datasets/naturalness.yaml evals/promptfooconfig.yaml
git commit -m "feat(evals): naturalness suite (deterministic + llm-rubric) against real prompt

Baseline: <fill in pass rate from Step 4>

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review Notes (spec coverage)

- Shared anti-pattern module (single source of truth) → Task 1. Few-shot exemplars → Task 2. Runtime gate, single regen, no always-on cost → Task 3. Real-prompt evals → Task 4. Naturalness dataset (deterministic + llm-rubric), config wiring, baseline → Task 5.
- Types consistent across tasks: `hasReflectiveOpener(text: string): boolean` (Tasks 1/3/5), `RESPOND_STYLE_EXAMPLES: string` (Task 2), exported builders (Task 4) consumed by the provider (Task 4) and dataset (Task 5).
- Out of scope (per spec): always-on critic, fine-tuning, migrating the other eval suites to the real prompt (naturalness first), storing raw text in `llm_runs`.
- Note for executor: evals hit a live model and are run manually (Task 5 Step 4); unit tests (Tasks 1-3) are the CI-safe gate.
