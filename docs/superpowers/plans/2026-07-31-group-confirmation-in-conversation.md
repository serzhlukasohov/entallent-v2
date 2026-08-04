# Group Confirmation Woven Into Conversation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the group-confirmation ("did I understand you correctly?") as a normal reply inside the conversation instead of a standalone injected Slack message, and detect the employee's answer by meaning (LLM) instead of keywords.

**Architecture:** When a question group completes it is marked `pending_confirmation` (no message sent). On the employee's next inbound message the `ConversationOrchestrator` produces a *confirmation-mode reply* through the normal response generator (correct language, saved to history, only the "is that right?" question). The following inbound message is interpreted by a new AI call into `agree | correct | unclear`, which drives scoring/report (agree), reopening (correct), or a no-op (unclear). The standalone `GroupConfirmationProcessor` / `group-confirmation` queue path is removed.

**Tech Stack:** TypeScript, NestJS, BullMQ, Drizzle ORM, Zod, Vitest, Azure OpenAI (via `@entalent/ai-openai`).

## Global Constraints

- Package manager: `pnpm` with workspace filters (e.g. `pnpm --filter @entalent/application test`). Do NOT use `npx vitest` (not on PATH).
- Tests: Vitest. Run a single package's suite with `pnpm --filter <pkg> test`.
- Group state statuses are plain `text` in `survey_group_states.status`. Current values: `in_progress`, `pending_confirmation`, `confirmed`. This plan adds `awaiting_confirmation`. No DB migration/enum change needed (column is free-text).
- AI JSON calls go through `OpenAiProvider.complete(system, user, model, maxTokens?)` which parses `response_format: json_object` and throws on `finish_reason==='length'`. Reuse it.
- Confirmation reply must contain exactly ONE question ("did I get that right?") and no probe / no other question.
- Preserve conversation language automatically by generating confirm text through `generateResponse` (never send `generateGroupSummary` output raw to the employee).

---

## File Structure

- `packages/contracts/src/ai.ts` — add `confirmation` conversation mode + `ConfirmationResponseSchema`/type.
- `packages/application/src/ports/ai-provider.port.ts` — add `confirmationRequest` to `ResponseContext`; add `interpretConfirmationResponse` to `AiProviderPort`.
- `packages/application/src/ports/survey.repository.port.ts` — add `findAwaitingConfirmationGroups`.
- `packages/ai-openai/src/prompts/confirm-interpret.ts` — NEW prompt for interpreting the employee's confirmation reply.
- `packages/ai-openai/src/prompts/respond.ts` — add `confirmationRequest` branch (confirm-only reply).
- `packages/ai-openai/src/openai-provider.ts` — implement `interpretConfirmationResponse`.
- `packages/ai-openai/src/ai-provider-router.ts` — passthrough for `interpretConfirmationResponse`.
- `apps/worker/src/survey/repositories/group-state.repository.ts` — add `findAwaitingConfirmationGroups`.
- `apps/worker/src/survey/repositories/survey.repository.ts` — delegate `findAwaitingConfirmationGroups`.
- `packages/application/src/use-cases/survey-evidence.use-case.ts` — stop enqueuing standalone confirmation; relax completion idempotency for reopened groups.
- `packages/application/src/use-cases/conversation-orchestrator.ts` — Phase A (surface) + Phase B (interpret) replacing keyword `handleGroupConfirmation`.
- Removal: `apps/worker/src/survey/group-confirmation.processor.ts`, `group-confirmation` queue registration, `enqueueGroupConfirmation` (outbox port + impls), dead `group-confirmation.use-case.ts`.

---

### Task 1: Contracts — confirmation mode + interpretation schema

**Files:**
- Modify: `packages/contracts/src/ai.ts:172-183` (mode enum) and after `SurveyEvidenceEvaluationSchema` block
- Test: `packages/contracts/src/ai.test.ts`

**Interfaces:**
- Produces: `ConfirmationResponseSchema`, type `ConfirmationResponse = { verdict: 'agree'|'correct'|'unclear'; correctionNote?: string }`; `'confirmation'` added to `ConversationModeSchema`.

- [ ] **Step 1: Write the failing test**

Add to `packages/contracts/src/ai.test.ts`:

```typescript
import { ConfirmationResponseSchema, ConversationModeSchema } from './ai';

describe('ConfirmationResponseSchema', () => {
  it('accepts a valid agree verdict', () => {
    const r = ConfirmationResponseSchema.parse({ verdict: 'agree' });
    expect(r.verdict).toBe('agree');
  });

  it('accepts correct with a note', () => {
    const r = ConfirmationResponseSchema.parse({ verdict: 'correct', correctionNote: 'not about pay' });
    expect(r.correctionNote).toBe('not about pay');
  });

  it('rejects an unknown verdict', () => {
    expect(() => ConfirmationResponseSchema.parse({ verdict: 'maybe' })).toThrow();
  });

  it('allows confirmation as a conversation mode', () => {
    expect(ConversationModeSchema.parse('confirmation')).toBe('confirmation');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @entalent/contracts test -- --run ai.test.ts`
Expected: FAIL — `ConfirmationResponseSchema` is not exported / `'confirmation'` rejected.

- [ ] **Step 3: Implement**

In `packages/contracts/src/ai.ts`, add `'confirmation'` to the mode enum:

```typescript
export const ConversationModeSchema = z.enum([
  'normal',
  'supportive',
  'coaching',
  'sensitive',
  'crisis',
  'survey_probe',
  'proactive_follow_up',
  'onboarding',
  'celebration',
  'confirmation',
]);
```

Add after the `SurveyEvidenceEvaluationSchema` block (around line 168):

```typescript
// ── Group Confirmation Response Interpreter ─────────────────────────────────

export const ConfirmationResponseSchema = z.object({
  verdict: z.enum(['agree', 'correct', 'unclear']),
  correctionNote: z.string().optional(),
});
export type ConfirmationResponse = z.infer<typeof ConfirmationResponseSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @entalent/contracts test -- --run ai.test.ts`
Expected: PASS

- [ ] **Step 5: Build contracts (downstream packages import from dist)**

Run: `pnpm --filter @entalent/contracts build`
Expected: build success.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/ai.ts packages/contracts/src/ai.test.ts
git commit -m "feat(contracts): add confirmation mode and ConfirmationResponse schema"
```

---

### Task 2: AI — interpret confirmation reply

**Files:**
- Create: `packages/ai-openai/src/prompts/confirm-interpret.ts`
- Modify: `packages/application/src/ports/ai-provider.port.ts` (ResponseContext + AiProviderPort)
- Modify: `packages/ai-openai/src/openai-provider.ts` (implement method)
- Modify: `packages/ai-openai/src/ai-provider-router.ts` (passthrough)
- Test: `packages/ai-openai/src/openai-provider.test.ts`

**Interfaces:**
- Consumes: `ConfirmationResponse`, `ConfirmationResponseSchema` from `@entalent/contracts`; `OpenAiProvider.complete`.
- Produces: `AiProviderPort.interpretConfirmationResponse(turns: ConversationTurn[], summary: string): Promise<ConfirmationResponse>`; `ResponseContext.confirmationRequest?: { questionGroup: string; evidence: Array<{ stableKey: string; evidenceSummary: string; polarity: string }> }`.

- [ ] **Step 1: Write the failing test**

Add to `packages/ai-openai/src/openai-provider.test.ts` (uses the existing `createMock`/`makeProvider` harness in that file):

```typescript
describe('OpenAiProvider.interpretConfirmationResponse', () => {
  beforeEach(() => createMock.mockReset());

  it('parses an agree verdict', async () => {
    createMock.mockResolvedValue({
      choices: [{ finish_reason: 'stop', message: { content: '{"verdict":"agree"}' } }],
    });
    const provider = makeProvider();
    const r = await provider.interpretConfirmationResponse(
      [{ role: 'user', content: "yes, that's right", timestamp: new Date() }],
      'You value autonomy...',
    );
    expect(r.verdict).toBe('agree');
  });

  it('parses a correct verdict with a note', async () => {
    createMock.mockResolvedValue({
      choices: [{ finish_reason: 'stop', message: { content: '{"verdict":"correct","correctionNote":"not about money"}' } }],
    });
    const provider = makeProvider();
    const r = await provider.interpretConfirmationResponse(
      [{ role: 'user', content: 'not quite', timestamp: new Date() }],
      'summary',
    );
    expect(r.verdict).toBe('correct');
    expect(r.correctionNote).toBe('not about money');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @entalent/ai-openai test -- --run openai-provider.test.ts`
Expected: FAIL — `interpretConfirmationResponse` is not a function.

- [ ] **Step 3: Create the prompt file**

Create `packages/ai-openai/src/prompts/confirm-interpret.ts`:

```typescript
import type { ConversationTurn } from '@entalent/application';
import { sanitizeTurnContent, INJECTION_GUARD } from './sanitize';

export function buildConfirmInterpretSystemPrompt(): string {
  return `You judge whether an employee agreed with a summary an AI mentor just proposed.

The mentor paraphrased its understanding of one topic and asked "did I get that right?".
Read the employee's latest reply and decide:
- "agree": they confirm it is accurate (even loosely — "yes", "more or less", "correct", "yeah that's right").
- "correct": they push back, disagree, or add a correction that changes the picture.
- "unclear": they neither confirm nor correct (changed subject, asked something, ambiguous).

If "correct", put a one-sentence description of what they corrected in correctionNote.
Judge by meaning, in any language. Do not require specific keywords.

Return JSON only:
{ "verdict": "agree" | "correct" | "unclear", "correctionNote": "..." }${INJECTION_GUARD}`;
}

export function buildConfirmInterpretUserPrompt(
  turns: ConversationTurn[],
  summary: string,
): string {
  const transcript = turns
    .slice(-6)
    .map((t) => `[${t.role === 'user' ? 'Employee' : 'AI Mentor'}]: ${sanitizeTurnContent(t.content)}`)
    .join('\n');

  return `SUMMARY THE MENTOR PROPOSED:
${sanitizeTurnContent(summary)}

--- UNTRUSTED CONVERSATION (most recent last) ---
${transcript}
--- END ---

Classify the employee's most recent reply. Return JSON only.`;
}
```

- [ ] **Step 4: Add the port members**

In `packages/application/src/ports/ai-provider.port.ts`, add to `ResponseContext` (after `topicConfirmed`):

```typescript
  /**
   * Set when a question group has completed and the agent should reflect its
   * understanding back and ask for confirmation IN THIS REPLY (confirm-only, no
   * other question, no probe).
   */
  confirmationRequest?: {
    questionGroup: string;
    evidence: Array<{ stableKey: string; evidenceSummary: string; polarity: string }>;
  };
```

Add the import and method to `AiProviderPort`:

```typescript
import type {
  SituationClassification,
  RiskDetection,
  MemoryProposal,
  ReplyStrategy,
  GeneratedResponse,
  SurveyEvidenceEvaluation,
  GroupSummary,
  GroupReport,
  ConfirmationResponse,
} from '@entalent/contracts';
```

```typescript
  interpretConfirmationResponse(
    turns: ConversationTurn[],
    summary: string,
  ): Promise<ConfirmationResponse>;
```

- [ ] **Step 5: Implement in the provider**

In `packages/ai-openai/src/openai-provider.ts` add the import:

```typescript
import { buildConfirmInterpretSystemPrompt, buildConfirmInterpretUserPrompt } from './prompts/confirm-interpret';
```

Add `ConfirmationResponseSchema` and `type ConfirmationResponse` to the existing `@entalent/contracts` import block, then add the method (place after `scoreSentiment`):

```typescript
  async interpretConfirmationResponse(
    turns: ConversationTurn[],
    summary: string,
  ): Promise<ConfirmationResponse> {
    const raw = await this.complete(
      buildConfirmInterpretSystemPrompt(),
      buildConfirmInterpretUserPrompt(turns, summary),
      this.analysisModel,
      512,
    );
    return ConfirmationResponseSchema.parse(JSON.parse(raw));
  }
```

- [ ] **Step 6: Add router passthrough**

In `packages/ai-openai/src/ai-provider-router.ts` add `ConfirmationResponse` to the `@entalent/contracts` type import, then add:

```typescript
  async interpretConfirmationResponse(
    turns: ConversationTurn[],
    summary: string,
  ): Promise<ConfirmationResponse> {
    return this.withFallback((p) => p.interpretConfirmationResponse(turns, summary));
  }
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm --filter @entalent/ai-openai test -- --run openai-provider.test.ts`
Expected: PASS

- [ ] **Step 8: Build packages**

Run: `pnpm --filter @entalent/application build && pnpm --filter @entalent/ai-openai build`
Expected: build success (confirms port + provider typecheck).

- [ ] **Step 9: Commit**

```bash
git add packages/ai-openai/src/prompts/confirm-interpret.ts packages/ai-openai/src/openai-provider.ts packages/ai-openai/src/ai-provider-router.ts packages/ai-openai/src/openai-provider.test.ts packages/application/src/ports/ai-provider.port.ts
git commit -m "feat(ai): interpretConfirmationResponse + confirmationRequest response context"
```

---

### Task 3: respond.ts — confirmation-only reply branch

**Files:**
- Modify: `packages/ai-openai/src/prompts/respond.ts`
- Test: `packages/ai-openai/src/prompts/respond.test.ts` (create if absent)

**Interfaces:**
- Consumes: `ResponseContext.confirmationRequest`.
- Produces: system prompt that, when `confirmationRequest` is set, instructs a confirm-only reply.

- [ ] **Step 1: Write the failing test**

Create `packages/ai-openai/src/prompts/respond.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildRespondSystemPrompt } from './respond';
import type { ReplyStrategy } from '@entalent/contracts';

const strategy: ReplyStrategy = {
  mode: 'confirmation',
  tone: 'warm',
  includeFollowUpQuestion: false,
  maxResponseLength: 'medium',
  forbiddenPatterns: [],
};

describe('buildRespondSystemPrompt confirmation branch', () => {
  it('emits confirm-only instructions when confirmationRequest is set', () => {
    const prompt = buildRespondSystemPrompt(strategy, {
      userName: 'Test',
      confirmationRequest: {
        questionGroup: 'autonomy',
        evidence: [{ stableKey: 'q12', evidenceSummary: 'values ownership', polarity: 'positive' }],
      },
    });
    expect(prompt).toMatch(/only one question/i);
    expect(prompt).toContain('autonomy');
  });

  it('does not emit confirm instructions otherwise', () => {
    const prompt = buildRespondSystemPrompt(strategy, { userName: 'Test' });
    expect(prompt).not.toMatch(/did i get that right/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @entalent/ai-openai test -- --run respond.test.ts`
Expected: FAIL — no confirm-only text present.

- [ ] **Step 3: Implement**

In `packages/ai-openai/src/prompts/respond.ts`, near the existing `topicConfirmedHint` block, add:

```typescript
  const confirmationHint = context.confirmationRequest
    ? `\nIMPORTANT — this reply is a confirmation check for the "${context.confirmationRequest.questionGroup}" topic. Do ALL of this in one message:
1. First, briefly and warmly acknowledge or round off what the employee just said — no abrupt jump.
2. Then paraphrase, in 2-4 sentences, your understanding of this topic based on what they've shared:
${context.confirmationRequest.evidence.map((e) => `   • (${e.polarity}) ${e.evidenceSummary}`).join('\n')}
3. End with exactly ONE question — some natural phrasing of "did I get that right?".
Ask NOTHING else. Do not raise a new topic. Do not include any survey probe or follow-up question. Only one question total, and it is the confirmation question.`
    : '';
```

Include it in the returned prompt string alongside `topicConfirmedHint` (prepend it the same way, e.g. `return \`${topicConfirmedHint}${confirmationHint}You are ...\``).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @entalent/ai-openai test -- --run respond.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/ai-openai/src/prompts/respond.ts packages/ai-openai/src/prompts/respond.test.ts
git commit -m "feat(ai): confirm-only reply branch in respond prompt"
```

---

### Task 4: Repo — find groups awaiting confirmation

**Files:**
- Modify: `packages/application/src/ports/survey.repository.port.ts:51` (add method to interface)
- Modify: `apps/worker/src/survey/repositories/group-state.repository.ts`
- Modify: `apps/worker/src/survey/repositories/survey.repository.ts` (delegate)

**Interfaces:**
- Produces: `SurveyRepositoryPort.findAwaitingConfirmationGroups(userId: string): Promise<SurveyGroupStateRecord[]>`.

- [ ] **Step 1: Add to the port interface**

In `packages/application/src/ports/survey.repository.port.ts`, after `findPendingConfirmationGroups`:

```typescript
  findAwaitingConfirmationGroups(userId: string): Promise<SurveyGroupStateRecord[]>;
```

- [ ] **Step 2: Implement in group-state repository**

In `apps/worker/src/survey/repositories/group-state.repository.ts`, add after `findPendingConfirmationGroups`:

```typescript
  async findAwaitingConfirmationGroups(userId: string): Promise<SurveyGroupStateRecord[]> {
    const rows = await this.db.client
      .select()
      .from(surveyGroupStates)
      .where(
        and(
          eq(surveyGroupStates.userId, userId),
          eq(surveyGroupStates.status, 'awaiting_confirmation'),
        ),
      );
    return rows.map(mapGroupState);
  }
```

- [ ] **Step 3: Delegate in SurveyRepository**

In `apps/worker/src/survey/repositories/survey.repository.ts`, after the `findPendingConfirmationGroups` delegate (line 203-205):

```typescript
  findAwaitingConfirmationGroups(userId: string): Promise<SurveyGroupStateRecord[]> {
    return this.groupStateRepo.findAwaitingConfirmationGroups(userId);
  }
```

- [ ] **Step 4: Build to typecheck**

Run: `pnpm --filter @entalent/application build && pnpm --filter @entalent/worker build`
Expected: build success.

- [ ] **Step 5: Commit**

```bash
git add packages/application/src/ports/survey.repository.port.ts apps/worker/src/survey/repositories/group-state.repository.ts apps/worker/src/survey/repositories/survey.repository.ts
git commit -m "feat(survey): findAwaitingConfirmationGroups repo method"
```

---

### Task 5: Stop standalone confirmation; allow reopened groups to re-complete

**Files:**
- Modify: `packages/application/src/use-cases/survey-evidence.use-case.ts` (`checkGroupCompletion`)
- Test: `packages/application/src/use-cases/survey-evidence.use-case.test.ts`

**Interfaces:**
- Consumes: existing `surveyRepo`, `ai`, `outbox`.
- Produces: `checkGroupCompletion` upserts `pending_confirmation` and does NOT call `outbox.enqueueGroupConfirmation`; re-fires when an existing group state is `in_progress`.

- [ ] **Step 1: Write the failing test**

Add to `packages/application/src/use-cases/survey-evidence.use-case.test.ts`. Extend `makeSurveyRepo` so a full group completes: return two questions in the same group, both `scored` assessments, `findGroupState` → null, and add an `outbox` mock. Add:

```typescript
it('completing a group upserts pending_confirmation and does NOT enqueue standalone confirmation', async () => {
  const outbox = { enqueueGroupConfirmation: vi.fn(), enqueueGroupReport: vi.fn() } as any;
  const surveyRepo = makeSurveyRepo('scored');
  // group of one question fully covered
  (surveyRepo.findQuestionsForWindow as any).mockResolvedValue([makeQuestion('q-1', 'autonomy')]);
  (surveyRepo.findAssessmentsForWindow as any).mockResolvedValue([{ surveyQuestionId: 'q-1', status: 'scored' }]);
  (surveyRepo.findGroupState as any).mockResolvedValue(null);

  const useCase = new SurveyEvidenceExtractionUseCase(
    makeAi('scored'), makeConversationRepo(), surveyRepo, outbox, makePulseService(),
  );

  await useCase.execute(BASE_INPUT);

  expect(outbox.enqueueGroupConfirmation).not.toHaveBeenCalled();
  expect(surveyRepo.upsertGroupState).toHaveBeenCalledWith(
    expect.objectContaining({ questionGroup: 'autonomy', status: 'pending_confirmation' }),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @entalent/application test -- --run survey-evidence`
Expected: FAIL — `enqueueGroupConfirmation` is called.

- [ ] **Step 3: Implement**

In `checkGroupCompletion` (`survey-evidence.use-case.ts`), change the idempotency guard so reopened groups can re-complete:

```typescript
    // Idempotency: skip if a group state already exists UNLESS it was reopened
    // (in_progress) after a correction — that must be allowed to re-complete.
    const existingState = await this.surveyRepo.findGroupState(input.userId, windowId, questionGroup);
    if (existingState && existingState.status !== 'in_progress') return;
```

Remove the `if (this.outbox) { await this.outbox.enqueueGroupConfirmation({...}); }` block at the end of the method. Keep the `upsertGroupState({... status: 'pending_confirmation', aiSummary })` call.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @entalent/application test -- --run survey-evidence`
Expected: PASS (all survey-evidence tests).

- [ ] **Step 5: Commit**

```bash
git add packages/application/src/use-cases/survey-evidence.use-case.ts packages/application/src/use-cases/survey-evidence.use-case.test.ts
git commit -m "feat(survey): stop standalone group confirmation; reopen re-completes"
```

---

### Task 6: Orchestrator Phase A — surface confirmation in a reply

**Files:**
- Modify: `packages/application/src/use-cases/conversation-orchestrator.ts`
- Test: `packages/application/src/use-cases/conversation-orchestrator.test.ts` (CREATE)

**Interfaces:**
- Consumes: `surveyRepo.findPendingConfirmationGroups`, `surveyRepo.findQuestionsForWindow`, `surveyRepo.findEvidenceForQuestion`, `surveyRepo.findOrCreateActiveWindow`, `surveyRepo.upsertGroupState`, `aiProvider.generateResponse`, `ResponseContext.confirmationRequest`.
- Produces: when a group is `pending_confirmation` and none is `awaiting_confirmation`, the turn's reply is generated with `confirmationRequest`, no probe, `mode: 'confirmation'`; after saving the outbound message the group is upserted to `awaiting_confirmation`.

- [ ] **Step 1: Write the failing test (create the orchestrator test harness)**

Create `packages/application/src/use-cases/conversation-orchestrator.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { ConversationOrchestrator } from './conversation-orchestrator';

function baseMocks() {
  const conversationRepo = {
    findById: vi.fn().mockResolvedValue({ id: 'c-1', channelType: 'slack', userDisplayName: 'Sam', userTimezone: 'UTC' }),
    findRecentMessages: vi.fn().mockResolvedValue([
      { id: 'm-1', direction: 'inbound', text: 'hey', occurredAt: new Date(), metadata: undefined },
    ]),
    saveMessage: vi.fn().mockResolvedValue({ id: 'out-1' }),
  } as any;
  const aiProvider = {
    classifySituation: vi.fn().mockResolvedValue({ primaryIntent: 'casual_conversation', urgency: 'low', surveyAllowed: true, requiresSafetyCheck: false, reminderRequest: null }),
    detectRisk: vi.fn(),
    generateResponse: vi.fn().mockResolvedValue({ text: 'reply', confidence: 0.9, containsSurveyProbe: false }),
    interpretConfirmationResponse: vi.fn(),
  } as any;
  const outbox = { enqueueMessageSend: vi.fn(), enqueueMemoryExtraction: vi.fn(), enqueueSurveyEvidence: vi.fn(), enqueueGroupReport: vi.fn() } as any;
  const surveyRepo = {
    findPendingConfirmationGroups: vi.fn().mockResolvedValue([]),
    findAwaitingConfirmationGroups: vi.fn().mockResolvedValue([]),
    findOrCreateActiveWindow: vi.fn().mockResolvedValue({ id: 'w-1' }),
    findQuestionsForWindow: vi.fn().mockResolvedValue([{ id: 'q-1', stableKey: 'q12', questionGroup: 'autonomy' }]),
    findEvidenceForQuestion: vi.fn().mockResolvedValue([{ evidenceSummary: 'values ownership', polarity: 'positive', createdAt: new Date() }]),
    upsertGroupState: vi.fn().mockResolvedValue({}),
    findTeamByMemberId: vi.fn().mockResolvedValue(null),
  } as any;
  const featureFlags = { isEnabled: vi.fn().mockResolvedValue(true) } as any;
  return { conversationRepo, aiProvider, outbox, surveyRepo, featureFlags };
}

const INPUT = {
  messageId: 'm-1', conversationId: 'c-1', userId: 'u-1', tenantId: 't-1',
  externalWorkspaceId: 'ws', externalConversationId: 'ec', traceId: 'tr',
};

describe('ConversationOrchestrator group confirmation — surface (Phase A)', () => {
  it('surfaces confirmation with confirmationRequest, no probe, and sets awaiting_confirmation', async () => {
    const m = baseMocks();
    m.surveyRepo.findPendingConfirmationGroups.mockResolvedValue([
      { surveyWindowId: 'w-1', userId: 'u-1', tenantId: 't-1', questionGroup: 'autonomy', aiSummary: 's' },
    ]);
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    await orch.orchestrate(INPUT);

    const ctxArg = m.aiProvider.generateResponse.mock.calls[0][2];
    expect(ctxArg.confirmationRequest).toMatchObject({ questionGroup: 'autonomy' });
    expect(ctxArg.surveyProbeQuestion).toBeUndefined();
    expect(m.surveyRepo.upsertGroupState).toHaveBeenCalledWith(
      expect.objectContaining({ questionGroup: 'autonomy', status: 'awaiting_confirmation' }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @entalent/application test -- --run conversation-orchestrator`
Expected: FAIL — `confirmationRequest` undefined / status not set.

- [ ] **Step 3: Implement Phase A in the orchestrator**

In `orchestrate`, after the risk/escalation handling and BEFORE building `strategy`, insert:

```typescript
    // ── Group confirmation surfacing (Phase A) ──────────────────────────────
    // If a group is ripe (pending_confirmation) and none is already awaiting a
    // reply, weave a confirm-only message into THIS reply.
    let confirmationRequest: ResponseContext['confirmationRequest'];
    let surfacedGroup: string | undefined;
    if (this.surveyRepo && !confirmationHandled) {
      const pending = await this.surveyRepo.findPendingConfirmationGroups(userId);
      if (pending.length > 0) {
        const group = pending[0];
        const evidence = await this.collectGroupEvidence(userId, group.surveyWindowId, group.questionGroup);
        if (evidence.length > 0) {
          confirmationRequest = { questionGroup: group.questionGroup, evidence };
          surfacedGroup = group.questionGroup;
        }
      }
    }
```

Add a private helper:

```typescript
  private async collectGroupEvidence(
    userId: string,
    windowId: string,
    questionGroup: string,
  ): Promise<Array<{ stableKey: string; evidenceSummary: string; polarity: string }>> {
    if (!this.surveyRepo) return [];
    const questions = await this.surveyRepo.findQuestionsForWindow(windowId);
    const groupQs = questions.filter((q) => q.questionGroup === questionGroup);
    const out: Array<{ stableKey: string; evidenceSummary: string; polarity: string }> = [];
    for (const q of groupQs) {
      const evidence = await this.surveyRepo.findEvidenceForQuestion(userId, q.id, windowId);
      const latest = [...evidence].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
      if (latest) out.push({ stableKey: q.stableKey, evidenceSummary: latest.evidenceSummary, polarity: latest.polarity });
    }
    return out;
  }
```

Gate the probe so it never rides on a confirmation turn — change the `probeQuestion` line:

```typescript
    const probeQuestion =
      !confirmationHandled && !confirmationRequest && speculativeProbeAllowed && !risk.surveyMustBeBlocked
        ? speculativeProbe
        : null;
```

When building the strategy, force confirmation mode:

```typescript
    const strategy = confirmationRequest
      ? { mode: 'confirmation' as const, tone: 'warm' as const, includeFollowUpQuestion: false, maxResponseLength: 'medium' as const, forbiddenPatterns: [] }
      : buildReplyStrategy(classification, risk, probeQuestion?.id);
```

Pass `confirmationRequest` into `generateResponse` context (add to the object at the `generateResponse` call):

```typescript
      confirmationRequest,
```

After the outbound message is saved (`const outbound = await this.conversationRepo.saveMessage(...)`), mark the group awaiting:

```typescript
    if (surfacedGroup && this.surveyRepo) {
      const pending = await this.surveyRepo.findPendingConfirmationGroups(userId);
      const g = pending.find((p) => p.questionGroup === surfacedGroup);
      if (g) {
        await this.surveyRepo.upsertGroupState({
          surveyWindowId: g.surveyWindowId,
          userId: g.userId,
          tenantId: g.tenantId,
          questionGroup: g.questionGroup,
          status: 'awaiting_confirmation',
          aiSummary: g.aiSummary ?? undefined,
        });
      }
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @entalent/application test -- --run conversation-orchestrator`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/application/src/use-cases/conversation-orchestrator.ts packages/application/src/use-cases/conversation-orchestrator.test.ts
git commit -m "feat(orchestrator): surface group confirmation as a woven reply (Phase A)"
```

---

### Task 7: Orchestrator Phase B — interpret reply, score/report/reopen

**Files:**
- Modify: `packages/application/src/use-cases/conversation-orchestrator.ts` (replace keyword `handleGroupConfirmation`)
- Test: `packages/application/src/use-cases/conversation-orchestrator.test.ts`

**Interfaces:**
- Consumes: `surveyRepo.findAwaitingConfirmationGroups`, `aiProvider.interpretConfirmationResponse`, existing scoring helpers (`computeEngagementIndex`, `computeOpenEndedQuestionScore`, `computeGroupIndex`, `aiProvider.scoreSentiment`), `outbox.enqueueGroupReport`, `surveyRepo.findTeamByMemberId`, `ResponseContext.topicConfirmed`.
- Produces: `agree` → `confirmed` + report enqueued + `topicConfirmed` context; `correct` → `in_progress`; `unclear` → no state change.

- [ ] **Step 1: Write the failing tests**

Add to `conversation-orchestrator.test.ts`:

```typescript
describe('ConversationOrchestrator group confirmation — interpret (Phase B)', () => {
  it('agree → confirms group and enqueues report', async () => {
    const m = baseMocks();
    m.surveyRepo.findAwaitingConfirmationGroups.mockResolvedValue([
      { surveyWindowId: 'w-1', userId: 'u-1', tenantId: 't-1', questionGroup: 'growth', aiSummary: 'You want more ownership.' },
    ]);
    m.surveyRepo.findTeamByMemberId.mockResolvedValue({ teamId: 'team-1' });
    m.aiProvider.interpretConfirmationResponse.mockResolvedValue({ verdict: 'agree' });
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    await orch.orchestrate(INPUT);

    expect(m.surveyRepo.upsertGroupState).toHaveBeenCalledWith(
      expect.objectContaining({ questionGroup: 'growth', status: 'confirmed' }),
    );
    expect(m.outbox.enqueueGroupReport).toHaveBeenCalled();
    const ctxArg = m.aiProvider.generateResponse.mock.calls[0][2];
    expect(ctxArg.topicConfirmed).toMatchObject({ questionGroup: 'growth' });
  });

  it('correct → reopens group to in_progress and does not report', async () => {
    const m = baseMocks();
    m.surveyRepo.findAwaitingConfirmationGroups.mockResolvedValue([
      { surveyWindowId: 'w-1', userId: 'u-1', tenantId: 't-1', questionGroup: 'growth', aiSummary: 's' },
    ]);
    m.aiProvider.interpretConfirmationResponse.mockResolvedValue({ verdict: 'correct', correctionNote: 'not about promotion' });
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );

    await orch.orchestrate(INPUT);

    expect(m.surveyRepo.upsertGroupState).toHaveBeenCalledWith(
      expect.objectContaining({ questionGroup: 'growth', status: 'in_progress' }),
    );
    expect(m.outbox.enqueueGroupReport).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @entalent/application test -- --run conversation-orchestrator`
Expected: FAIL — new Phase B behavior not present.

- [ ] **Step 3: Replace keyword detection with Phase B**

Replace the current block (lines ~74-81) that computes `pendingConfirmation`/`confirmedGroup`/`confirmationHandled` with a call to a new `handleAwaitingConfirmation` that returns which group (if any) was just confirmed:

```typescript
    // ── Group confirmation interpretation (Phase B) ─────────────────────────
    const confirmedGroup = this.surveyRepo
      ? await this.handleAwaitingConfirmation(turns, input)
      : false;
    const confirmationHandled = confirmedGroup !== false;
```

Replace the whole `handleGroupConfirmation` method with:

```typescript
  /**
   * If a group is awaiting a confirmation reply, interpret the employee's latest
   * message by meaning. Returns the group name on agreement (so the reply can
   * acknowledge and move on), otherwise false.
   */
  private async handleAwaitingConfirmation(
    turns: ConversationTurn[],
    input: OrchestrateInput,
  ): Promise<string | false> {
    if (!this.surveyRepo || !this.outbox) return false;
    const surveyRepo = this.surveyRepo;

    const awaiting = await surveyRepo.findAwaitingConfirmationGroups(input.userId);
    if (awaiting.length === 0) return false;
    const group = awaiting[0];

    const verdict = await this.aiProvider.interpretConfirmationResponse(turns, group.aiSummary ?? '');

    if (verdict.verdict === 'unclear') return false;

    if (verdict.verdict === 'correct') {
      await surveyRepo.upsertGroupState({
        surveyWindowId: group.surveyWindowId,
        userId: group.userId,
        tenantId: group.tenantId,
        questionGroup: group.questionGroup,
        status: 'in_progress',
        aiSummary: group.aiSummary ?? undefined,
      });
      return false;
    }

    // verdict === 'agree' → compute score, confirm, trigger report
    const employeeScore = await this.computeGroupScore(group.surveyWindowId, group.questionGroup, input.userId);

    await surveyRepo.upsertGroupState({
      surveyWindowId: group.surveyWindowId,
      userId: group.userId,
      tenantId: group.tenantId,
      questionGroup: group.questionGroup,
      status: 'confirmed',
      aiSummary: group.aiSummary ?? undefined,
      employeeScore,
      confirmedAt: new Date(),
    });

    const team = await surveyRepo.findTeamByMemberId(input.userId);
    if (team) {
      await this.outbox.enqueueGroupReport({
        teamId: team.teamId,
        questionGroup: group.questionGroup,
        traceId: `group-report-${group.surveyWindowId}-${group.questionGroup}`,
      });
    }

    return group.questionGroup;
  }
```

Extract the existing scoring math (currently inside `handleGroupConfirmation`) into `computeGroupScore(windowId, questionGroup, userId): Promise<number | undefined>`, preserving the engagement vs open-ended branches verbatim (uses `computeEngagementIndex`, `computeOpenEndedQuestionScore`, `computeGroupIndex`, `this.aiProvider.scoreSentiment`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @entalent/application test -- --run conversation-orchestrator`
Expected: PASS (Phase A + Phase B tests).

- [ ] **Step 5: Build application**

Run: `pnpm --filter @entalent/application build`
Expected: build success.

- [ ] **Step 6: Commit**

```bash
git add packages/application/src/use-cases/conversation-orchestrator.ts packages/application/src/use-cases/conversation-orchestrator.test.ts
git commit -m "feat(orchestrator): interpret confirmation reply by meaning (Phase B)"
```

---

### Task 8: Remove the standalone confirmation infrastructure

**Files:**
- Delete: `apps/worker/src/survey/group-confirmation.processor.ts`
- Delete: `packages/application/src/use-cases/group-confirmation.use-case.ts` (dead — only exported)
- Modify: `apps/worker/src/survey/survey.module.ts` (remove processor, queue registration, outbox `enqueueGroupConfirmation` factory line)
- Modify: `apps/worker/src/queue/queue.module.ts:16,51` (remove `GROUP_CONFIRMATION`)
- Modify: `apps/worker/src/conversation/outbox.service.ts` (remove queue inject + `enqueueGroupConfirmation`)
- Modify: `packages/application/src/ports/outbox.port.ts` (remove `GroupConfirmationPayload` + `enqueueGroupConfirmation`)
- Modify: `packages/application/src/index.ts:5,41-42` (drop `GroupConfirmationPayload`, `GroupConfirmationUseCase` exports)
- Modify: mocks in `packages/application/src/use-cases/proactive-check-in.use-case.test.ts:77`, `follow-up-execution.test.ts:102`, `follow-up-scheduler.test.ts:40` (remove `enqueueGroupConfirmation: vi.fn()` lines)
- Modify: `apps/api/src/queue/queue.module.ts` if it registers `GROUP_CONFIRMATION` (remove)

**Interfaces:**
- Produces: no `GROUP_CONFIRMATION` queue, no `enqueueGroupConfirmation` anywhere. `OutboxPort` no longer declares it.

- [ ] **Step 1: Delete the standalone senders**

```bash
git rm apps/worker/src/survey/group-confirmation.processor.ts packages/application/src/use-cases/group-confirmation.use-case.ts
```

- [ ] **Step 2: Remove outbox member**

In `packages/application/src/ports/outbox.port.ts` delete the `GroupConfirmationPayload` interface (lines ~45-51) and the `enqueueGroupConfirmation(payload: GroupConfirmationPayload): Promise<void>;` line. In `packages/application/src/index.ts` remove `GroupConfirmationPayload` from the outbox type export and delete the two `GroupConfirmationUseCase` export lines.

- [ ] **Step 3: Remove worker wiring**

In `apps/worker/src/survey/survey.module.ts`: remove the `GroupConfirmationProcessor` import + provider, the `{ name: QUEUE_NAMES.GROUP_CONFIRMATION }` registration, and the `enqueueGroupConfirmation` line in the outbox `useFactory` (and its `GroupConfirmationPayload` import/inject if now unused). In `apps/worker/src/conversation/outbox.service.ts` remove the `GROUP_CONFIRMATION` `@InjectQueue`, the `groupConfirmationQueue` field, and the `enqueueGroupConfirmation` method (and the `GroupConfirmationPayload` import). In `apps/worker/src/queue/queue.module.ts` remove the `GROUP_CONFIRMATION` key and its `registerQueue` entry. Remove `GROUP_CONFIRMATION` from `apps/api/src/queue/queue.module.ts` if present.

- [ ] **Step 4: Clean test mocks**

Delete the `enqueueGroupConfirmation: vi.fn(),` line in `proactive-check-in.use-case.test.ts`, `follow-up-execution.test.ts`, and `follow-up-scheduler.test.ts`.

- [ ] **Step 5: Build everything + run affected suites**

Run:
```bash
pnpm --filter @entalent/application build && pnpm --filter @entalent/worker build && pnpm --filter @entalent/api build
pnpm --filter @entalent/application test
pnpm --filter @entalent/ai-openai test
```
Expected: all builds succeed; all tests pass. Fix any remaining references the compiler flags (grep `enqueueGroupConfirmation` / `GROUP_CONFIRMATION` / `GroupConfirmationUseCase` — expect zero non-dist hits).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(survey): remove standalone group-confirmation queue/processor path"
```

---

## Deployment (after all tasks)

The confirmation logic runs in the **worker** (orchestrator + provider). The `interpretConfirmationResponse` prompt and `respond.ts` changes are bundled into the worker via `@entalent/ai-openai`. Deploy per the project convention (GitHub auto-deploy is broken):

```bash
railway up --service worker --detach
```

No API redeploy is required for this feature (no API surface changed) unless Task 8 edits `apps/api/src/queue/queue.module.ts`, in which case also `railway up --service api --detach`.

## Self-Review Notes (spec coverage)

- Standalone send removed → Task 8. Language fix → Task 3 + Task 6 (generated via response generator). Keyword detection removed → Task 7. State machine + `awaiting_confirmation` → Tasks 4-7. Confirm-only reply → Task 3 + Task 6 strategy/probe suppression. LLM interpretation → Task 2 + Task 7. Reopen-on-correct + re-completion guard → Task 5 + Task 7. One-group-at-a-time (`pending[0]` / `awaiting[0]`) → Tasks 6-7.
