import { describe, expect, it } from 'vitest';
import {
  CLARIFICATION_PROMPT_DELIVERED_AT,
  InMemoryQuestionConfirmationRepository,
  SEEDED_CLARIFICATION_PROMPT_ID,
  type SimQuestion,
} from '../../fakes/question-confirmation';

const SCOPE = { tenantId: 't', userId: 'u', conversationId: 'c' };

function question(id: string, status: SimQuestion['status'] = 'ready'): SimQuestion {
  return { surveyQuestionId: id, questionVersion: 'v1', questionGroup: 'autonomy', workingSummary: `Summary ${id}.`, status };
}

async function withStagedBundle(ids: string[]): Promise<{ repo: InMemoryQuestionConfirmationRepository; bundleId: string }> {
  const repo = new InMemoryQuestionConfirmationRepository();
  repo.seedWindow({ tenantId: 't', userId: 'u', surveyWindowId: 'w', questions: ids.map((id) => question(id)) });
  const bundleId = await repo.stageQuestionConfirmationBundle({
    ...SCOPE,
    surveyWindowId: 'w',
    questionGroup: 'autonomy',
    promptMessageId: 'prompt-1',
    displayedText: 'Fair?',
    components: ids.map((id) => ({ surveyQuestionId: id, questionVersion: 'v1', statement: `Summary ${id}.`, expectedWorkingSummary: `Summary ${id}.` })),
  });
  return { repo, bundleId };
}

async function statuses(repo: InMemoryQuestionConfirmationRepository): Promise<Record<string, string>> {
  const snapshot = await repo.findCycleProgress({ tenantId: 't', userId: 'u' });
  return Object.fromEntries(snapshot!.groups.flatMap((group) => group.questions.map((q) => [q.surveyQuestionId, q.status])));
}

describe('InMemoryQuestionConfirmationRepository', () => {
  it('stages a ready bundle as awaiting and counts it', async () => {
    const { repo, bundleId } = await withStagedBundle(['q1', 'q2']);
    expect(repo.stagedBundleCount()).toBe(1);
    expect(await statuses(repo)).toEqual({ q1: 'awaiting', q2: 'awaiting' });
    expect(await repo.findAwaitingQuestionBundle({ tenantId: 't', userId: 'u' })).toMatchObject({ id: bundleId });
    expect(await repo.hasReadyQuestionBundle({ tenantId: 't', userId: 'u' })).toBe(false);
  });

  it('agree confirms every question and records the verdict for the inbound', async () => {
    const { repo, bundleId } = await withStagedBundle(['q1', 'q2']);
    expect(await repo.applyQuestionBundleVerdict({ inboundMessageId: 'in-1', bundleId, verdict: { kind: 'agree' } })).toBe(true);
    expect(repo.questionProgress()).toEqual({ answered: 2, total: 2 });
    expect(await repo.findAppliedQuestionVerdictForInbound({ inboundMessageId: 'in-1' })).toEqual({
      kind: 'bundle', verdictKind: 'agree', questionGroup: 'autonomy',
    });
    expect(await repo.findAppliedQuestionVerdictForInbound({ inboundMessageId: 'other' })).toBeNull();
    expect(await repo.findAwaitingQuestionBundle({ tenantId: 't', userId: 'u' })).toBeNull();
    // A closed bundle takes no second verdict.
    expect(await repo.applyQuestionBundleVerdict({ inboundMessageId: 'in-2', bundleId, verdict: { kind: 'reject' } })).toBe(false);
  });

  it('reject disputes every question', async () => {
    const { repo, bundleId } = await withStagedBundle(['q1', 'q2']);
    await repo.applyQuestionBundleVerdict({ inboundMessageId: 'in-1', bundleId, verdict: { kind: 'reject' } });
    expect(repo.questionProgress()).toEqual({ answered: 0, total: 2 });
    expect(await statuses(repo)).toEqual({ q1: 'disputed', q2: 'disputed' });
  });

  it('partial confirms accepted, sends disputed to pending_clarification and declines declined questions', async () => {
    const { repo, bundleId } = await withStagedBundle(['q1', 'q2', 'q3']);
    await repo.applyQuestionBundleVerdict({
      inboundMessageId: 'in-1',
      bundleId,
      verdict: { kind: 'partial', acceptedQuestionIds: ['q1'], disputedQuestionIds: ['q2'], declinedQuestionIds: ['q3'] },
    });
    expect(repo.questionProgress()).toEqual({ answered: 1, total: 3 });
    expect(await statuses(repo)).toEqual({ q1: 'confirmed', q2: 'pending_clarification', q3: 'declined' });
  });

  it('partial: the first disputed statement gets a pending clarification with no prompt yet, as in production', async () => {
    const { repo, bundleId } = await withStagedBundle(['q1', 'q2', 'q3']);
    const verdict = { kind: 'partial' as const, acceptedQuestionIds: ['q1'], disputedQuestionIds: ['q3', 'q2'], declinedQuestionIds: [] };
    const preview = await repo.previewPendingQuestionClarificationAfterBundleVerdict({
      tenantId: 't', userId: 'u', bundleId, disputedQuestionIds: verdict.disputedQuestionIds,
    });
    const expected = {
      workingInsightId: 'working-insight-q2', tenantId: 't', userId: 'u', surveyWindowId: 'w', surveyQuestionId: 'q2',
      questionVersion: 'v1', questionGroup: 'autonomy', workingSummary: 'Summary q2.', disputedStatement: 'Summary q2.',
      clarificationPromptMessageId: null, clarificationPromptSentAt: null,
    };
    // Bundle order decides, not the order the ids were given in.
    expect(preview).toEqual(expected);
    // A preview writes nothing.
    expect(repo.pendingClarification()).toBeNull();

    await repo.applyQuestionBundleVerdict({ inboundMessageId: 'in-1', bundleId, verdict });
    expect(repo.pendingClarification()).toEqual(expected);
    expect(await repo.findPendingQuestionClarification({ tenantId: 't', userId: 'u' })).toEqual(expected);
    expect(await repo.previewPendingQuestionClarificationAfterVerdict({ workingInsightId: 'working-insight-q2' })).toMatchObject({
      workingInsightId: 'working-insight-q3', surveyQuestionId: 'q3', clarificationPromptMessageId: null,
    });

    // Staging the question marks it delivered; resolving it moves on to the next disputed statement.
    expect(await repo.stageQuestionClarificationPrompt({ workingInsightId: 'working-insight-q2', promptMessageId: 'p-1' })).toBe(true);
    expect(repo.pendingClarification()).toMatchObject({
      clarificationPromptMessageId: 'p-1', clarificationPromptSentAt: CLARIFICATION_PROMPT_DELIVERED_AT,
    });
    await repo.applyQuestionClarificationVerdict({
      workingInsightId: 'working-insight-q2', inboundMessageId: 'in-2', verdict: { kind: 'clarified', correctedSummary: 'Corrected q2.' },
    });
    expect(repo.pendingClarification()).toMatchObject({ workingInsightId: 'working-insight-q3' });
    expect(await repo.previewPendingQuestionClarificationAfterVerdict({ workingInsightId: 'working-insight-q3' })).toBeNull();
  });

  it('preview: null without disputed statements, throws on a stale bundle or an unknown id', async () => {
    const { repo, bundleId } = await withStagedBundle(['q1', 'q2']);
    const scope = { tenantId: 't', userId: 'u' };
    expect(await repo.previewPendingQuestionClarificationAfterBundleVerdict({ ...scope, bundleId, disputedQuestionIds: [] })).toBeNull();
    await expect(
      repo.previewPendingQuestionClarificationAfterBundleVerdict({ ...scope, bundleId: 'other', disputedQuestionIds: ['q1'] }),
    ).rejects.toThrow('v2_clarification_preview_bundle_stale');
    await expect(
      repo.previewPendingQuestionClarificationAfterBundleVerdict({ ...scope, bundleId, disputedQuestionIds: ['q9'] }),
    ).rejects.toThrow('v2_clarification_preview_mapping_invalid');
    await expect(
      repo.previewPendingQuestionClarificationAfterBundleVerdict({ ...scope, bundleId, disputedQuestionIds: ['q1', 'q1'] }),
    ).rejects.toThrow('v2_clarification_preview_mapping_invalid');
    await expect(repo.previewPendingQuestionClarificationAfterVerdict({ workingInsightId: 'none' })).rejects.toThrow(
      'v2_clarification_preview_scope_mismatch',
    );
  });

  it('ready bundle: needs every question of the group ready or closed, and nothing awaiting or pending (production rule)', async () => {
    const repo = new InMemoryQuestionConfirmationRepository();
    const scope = { tenantId: 't', userId: 'u' };
    repo.seedWindow({ tenantId: 't', userId: 'u', surveyWindowId: 'w', questions: [question('q1'), question('q2'), question('q3', 'pending')] });
    expect(await repo.findReadyQuestionBundle(scope)).toBeNull();
    expect(await repo.hasReadyQuestionBundle(scope)).toBe(false);

    repo.seedWindow({ tenantId: 't', userId: 'u', surveyWindowId: 'w', questions: [question('q1'), question('q2', 'confirmed'), question('q3')] });
    expect((await repo.findReadyQuestionBundle(scope))?.questions.map((entry) => entry.surveyQuestionId)).toEqual(['q1', 'q3']);

    // A later group qualifies when the first one does not.
    repo.seedWindow({
      tenantId: 't', userId: 'u', surveyWindowId: 'w',
      questions: [question('q1'), question('q2', 'pending'), { ...question('b1'), questionGroup: 'belonging' }],
    });
    expect(await repo.findReadyQuestionBundle(scope)).toMatchObject({ questionGroup: 'belonging', questions: [{ surveyQuestionId: 'b1' }] });

    repo.seedPendingClarification({
      workingInsightId: 'wi-1', tenantId: 't', userId: 'u', surveyWindowId: 'w', surveyQuestionId: 'q2', questionVersion: 'v1',
      questionGroup: 'autonomy', workingSummary: 'Summary q2.', disputedStatement: 'Summary q2.',
      clarificationPromptMessageId: null, clarificationPromptSentAt: null,
    });
    expect(await repo.findReadyQuestionBundle(scope)).toBeNull();
  });

  it('ready bundle: none while a staged bundle awaits its verdict', async () => {
    const { repo } = await withStagedBundle(['q1']);
    repo.seedWindow({ tenantId: 't', userId: 'u', surveyWindowId: 'w', questions: [question('q1'), question('q2')] });
    expect(await repo.findReadyQuestionBundle({ tenantId: 't', userId: 'u' })).toBeNull();
  });

  it('a seeded pending clarification was already asked and delivered', () => {
    const repo = new InMemoryQuestionConfirmationRepository();
    repo.seedWindow({ tenantId: 't', userId: 'u', surveyWindowId: 'w', questions: [question('q1', 'disputed')] });
    repo.seedPendingClarification({
      workingInsightId: 'wi-1', tenantId: 't', userId: 'u', surveyWindowId: 'w', surveyQuestionId: 'q1', questionVersion: 'v1',
      questionGroup: 'autonomy', workingSummary: 'Summary q1.', disputedStatement: 'Summary q1.',
      clarificationPromptMessageId: null, clarificationPromptSentAt: null,
    });
    expect(repo.pendingClarification()).toMatchObject({
      clarificationPromptMessageId: SEEDED_CLARIFICATION_PROMPT_ID,
      clarificationPromptSentAt: CLARIFICATION_PROMPT_DELIVERED_AT,
    });
  });

  function withPending(): InMemoryQuestionConfirmationRepository {
    const repo = new InMemoryQuestionConfirmationRepository();
    repo.seedWindow({ tenantId: 't', userId: 'u', surveyWindowId: 'w', questions: [question('q1', 'disputed')] });
    repo.seedPendingClarification({
      workingInsightId: 'wi-1', tenantId: 't', userId: 'u', surveyWindowId: 'w', surveyQuestionId: 'q1', questionVersion: 'v1',
      questionGroup: 'autonomy', workingSummary: 'Summary q1.', disputedStatement: 'Summary q1.',
      clarificationPromptMessageId: null, clarificationPromptSentAt: null,
    });
    return repo;
  }

  it('clarified rewrites the summary, makes the question ready again and clears the clarification', async () => {
    const repo = withPending();
    expect(await repo.stageQuestionClarificationPrompt({ workingInsightId: 'wi-1', promptMessageId: 'p-1' })).toBe(true);
    expect(repo.pendingClarification()?.clarificationPromptMessageId).toBe('p-1');
    expect(await repo.applyQuestionClarificationVerdict({
      workingInsightId: 'wi-1', inboundMessageId: 'in-1', verdict: { kind: 'clarified', correctedSummary: 'Corrected.' },
    })).toBe(true);
    expect(repo.pendingClarification()).toBeNull();
    expect(await statuses(repo)).toEqual({ q1: 'ready' });
    expect((await repo.findReadyQuestionBundle({ tenantId: 't', userId: 'u' }))?.questions[0]?.workingSummary).toBe('Corrected.');
    expect(await repo.findAppliedQuestionVerdictForInbound({ inboundMessageId: 'in-1' })).toEqual({
      kind: 'clarification', verdictKind: 'clarified', questionGroup: 'autonomy',
    });
    expect(repo.questionProgress()).toEqual({ answered: 0, total: 1 });
  });

  it('declined closes the question as not collected', async () => {
    const repo = withPending();
    await repo.applyQuestionClarificationVerdict({ workingInsightId: 'wi-1', inboundMessageId: 'in-1', verdict: { kind: 'declined' } });
    expect(await statuses(repo)).toEqual({ q1: 'declined' });
    expect(await repo.findAppliedQuestionVerdictForInbound({ inboundMessageId: 'in-1' })).toEqual({
      kind: 'clarification', verdictKind: 'declined', questionGroup: 'autonomy', questionNotCollected: true,
    });
    expect(await repo.applyQuestionClarificationVerdict({ workingInsightId: 'wi-1', inboundMessageId: 'in-2', verdict: { kind: 'declined' } })).toBe(false);
  });

  it('stages a corrected statement as a one-statement awaiting bundle', async () => {
    const repo = new InMemoryQuestionConfirmationRepository();
    repo.seedWindow({ tenantId: 't', userId: 'u', surveyWindowId: 'w', questions: [question('q1', 'ready')] });
    const id = await repo.stageCorrectedStatementConfirmation({
      ...SCOPE, surveyWindowId: 'w', questionGroup: 'autonomy', workingInsightId: 'wi-1', surveyQuestionId: 'q1',
      questionVersion: 'v1', promptMessageId: 'p-1', displayedText: 'So: corrected. Right?', statement: 'Corrected.',
      expectedWorkingSummary: 'Corrected.',
    });
    expect(repo.stagedBundleCount()).toBe(1);
    expect(await statuses(repo)).toEqual({ q1: 'awaiting' });
    expect(await repo.findAwaitingQuestionBundle({ tenantId: 't', userId: 'u' })).toMatchObject({
      id, kind: 'corrected_statement', components: [{ surveyQuestionId: 'q1', questionVersion: 'v1', statement: 'Corrected.' }],
    });
    await repo.applyQuestionBundleVerdict({ inboundMessageId: 'in-1', bundleId: id, verdict: { kind: 'agree' } });
    expect(repo.questionProgress()).toEqual({ answered: 1, total: 1 });
  });

  it('reports nothing outside the seeded window scope', async () => {
    const repo = new InMemoryQuestionConfirmationRepository();
    expect(await repo.findCycleProgress({ tenantId: 't', userId: 'u' })).toBeNull();
    expect(repo.questionProgress()).toEqual({ answered: 0, total: 0 });
  });
});
