import { describe, expect, it, vi } from 'vitest';
import {
  FinalizeQuestionInsightUseCase,
  type QuestionDeidentifierPort,
  type QuestionFinalizationContext,
  type QuestionFinalizationRepositoryPort,
  type QuestionScorerPort,
} from './finalize-question-insight.use-case';

const context: QuestionFinalizationContext = {
  workingInsightId: 'working', workingUpdatedAt: new Date('2026-09-28T10:01:00Z'),
  tenantId: 'tenant', userId: 'employee', surveyWindowId: 'cycle', surveyDefinitionId: 'definition',
  surveyQuestionId: 'question', questionVersion: '2', questionGroup: 'growth',
  confirmedSemanticSummary: 'Manager Mira moved my Project Atlas review to 2026-09-28.',
  confirmedAt: new Date('2026-09-28T10:00:00Z'), scoringPolicyVersion: 'company-v2',
  rubric: { version: 'growth-q1-v1', instructions: 'Assess the confirmed meaning.', anchors: [
    { score: 0, description: 'Clearly adverse.' }, { score: 100, description: 'Clearly favorable.' },
  ] },
  knownIdentifiers: ['Mira', 'Project Atlas'], sourceMessageIds: ['3de3fe64-536e-484e-9b52-fc421c067bb2'],
};

function setup(overrides: Partial<QuestionFinalizationContext> = {}) {
  const calls: string[] = [];
  const repository: QuestionFinalizationRepositoryPort = {
    listPendingConfirmedUsers: vi.fn().mockResolvedValue([]),
    listPendingConfirmedQuestions: vi.fn().mockResolvedValue([]),
    loadConfirmedQuestion: vi.fn().mockResolvedValue({ ...context, ...overrides }),
    persistFinalAndPurge: vi.fn().mockImplementation(async () => {
      calls.push('persist-and-purge');
      return 'finalized';
    }),
  };
  const scorer: QuestionScorerPort = {
    scoreConfirmedMeaning: vi.fn().mockImplementation(async () => {
      calls.push('score');
      return {
        score: 37, confidence: 0.86, modelId: 'model-v2', promptVersion: 'score-v2',
        direction: 'adverse', severity: 'high', rootCauseCategory: 'growth',
      };
    }),
  };
  const deidentifier: QuestionDeidentifierPort = {
    deidentify: vi.fn().mockImplementation(async () => {
      calls.push('deidentify');
      return 'Growth opportunity was delayed.';
    }),
  };
  const useCase = new FinalizeQuestionInsightUseCase(repository, scorer, deidentifier);
  const input = { tenantId: 'tenant', userId: 'employee', surveyWindowId: 'cycle', surveyQuestionId: 'question' };
  return { calls, repository, scorer, deidentifier, useCase, input };
}

describe('FinalizeQuestionInsightUseCase', () => {
  it('finalizes only pending confirmed questions and leaves a retry idempotent', async () => {
    const { repository, scorer, useCase } = setup();
    vi.mocked(repository.listPendingConfirmedQuestions)
      .mockResolvedValueOnce([{ surveyWindowId: 'cycle', surveyQuestionId: 'question' }])
      .mockResolvedValueOnce([]);

    expect(await useCase.executePending({ tenantId: 'tenant', userId: 'employee' })).toBe(1);
    expect(await useCase.executePending({ tenantId: 'tenant', userId: 'employee' })).toBe(0);
    expect(scorer.scoreConfirmedMeaning).toHaveBeenCalledOnce();
  });

  it('finalizes other confirmed questions when one fails and reports a safe batch error', async () => {
    const { repository, useCase } = setup();
    vi.mocked(repository.listPendingConfirmedQuestions).mockResolvedValue([
      { surveyWindowId: 'cycle', surveyQuestionId: 'first' },
      { surveyWindowId: 'cycle', surveyQuestionId: 'second' },
    ]);
    vi.mocked(repository.loadConfirmedQuestion)
      .mockRejectedValueOnce(new Error('private source detail'))
      .mockResolvedValueOnce({ ...context, surveyQuestionId: 'second' });

    await expect(useCase.executePending({ tenantId: 'tenant', userId: 'employee' }))
      .rejects.toThrow('question_finalization_batch_failed');
    expect(repository.loadConfirmedQuestion).toHaveBeenCalledTimes(2);
    expect(repository.persistFinalAndPurge).toHaveBeenCalledOnce();
    expect(vi.mocked(repository.persistFinalAndPurge).mock.calls[0][0].final.surveyQuestionId)
      .toBe('second');
  });

  it('scores confirmed private meaning before de-identification and persists only safe output', async () => {
    const { calls, repository, scorer, useCase, input } = setup();
    expect(await useCase.execute(input)).toBe('finalized');
    expect(calls).toEqual(['score', 'deidentify', 'persist-and-purge']);
    expect(scorer.scoreConfirmedMeaning).toHaveBeenCalledWith(expect.objectContaining({
      semanticSummary: context.confirmedSemanticSummary,
      scoringPolicyVersion: 'company-v2',
    }));
    expect(repository.persistFinalAndPurge).toHaveBeenCalledWith(expect.objectContaining({ final: expect.objectContaining({
      deidentifiedSummary: 'Growth opportunity was delayed.', score: 37,
      questionRubricVersion: 'growth-q1-v1', scoringPolicyVersion: 'company-v2',
      signalDirection: 'adverse', signalSeverity: 'high', rootCauseCategory: 'growth',
    }) }));
    const persisted = vi.mocked(repository.persistFinalAndPurge).mock.calls[0][0].final;
    expect(JSON.stringify(persisted)).not.toContain('Mira');
    expect(JSON.stringify(persisted)).not.toContain('Project Atlas');
    expect(JSON.stringify(persisted)).not.toContain('sourceMessageIds');
  });

  it('persists a recognition category for a confirmed recognition meaning', async () => {
    const { repository, scorer, useCase, input } = setup({ questionGroup: 'purpose' });
    vi.mocked(scorer.scoreConfirmedMeaning).mockResolvedValueOnce({
      score: 15, confidence: 0.8, modelId: 'model-v2', promptVersion: 'score-v2',
      direction: 'adverse', severity: 'high', rootCauseCategory: 'recognition',
    });
    expect(await useCase.execute(input)).toBe('finalized');
    expect(vi.mocked(repository.persistFinalAndPurge).mock.calls[0][0].final.rootCauseCategory)
      .toBe('recognition');
  });

  it('fails closed without an approved question rubric', async () => {
    const { repository, scorer, useCase, input } = setup({ rubric: null });
    await expect(useCase.execute(input)).rejects.toThrow('approved_question_rubric_missing');
    expect(scorer.scoreConfirmedMeaning).not.toHaveBeenCalled();
    expect(repository.persistFinalAndPurge).not.toHaveBeenCalled();
  });

  it('retries privacy rejection and uses a categorical safe fallback after bounded failures', async () => {
    const { repository, deidentifier, useCase, input } = setup();
    vi.mocked(deidentifier.deidentify)
      .mockResolvedValueOnce('Mira at Project Atlas on 2026-09-28')
      .mockRejectedValueOnce(new Error('provider unavailable'));
    expect(await useCase.execute(input)).toBe('finalized');
    expect(deidentifier.deidentify).toHaveBeenCalledTimes(2);
    const persisted = vi.mocked(repository.persistFinalAndPurge).mock.calls[0][0].final;
    expect(persisted.deidentifiedSummary).toContain('high adverse');
    expect(persisted.rootCauseCategory).toBe('growth');
    expect(persisted.deidentifiedSummary).not.toContain('Mira');
    expect(persisted.privacyPolicyVersion).toBe('question-deidentification-v2');
  });

  it('retries a de-identified candidate that still contains an external source message id', async () => {
    const { repository, deidentifier, useCase, input } = setup({
      sourceMessageIds: ['ref-A1B2C3'],
    });
    vi.mocked(deidentifier.deidentify)
      .mockResolvedValueOnce('Growth was delayed in message ref-A1B2C3.')
      .mockResolvedValueOnce('Growth opportunities were limited.');

    expect(await useCase.execute(input)).toBe('finalized');
    expect(deidentifier.deidentify).toHaveBeenCalledTimes(2);
    const persisted = vi.mocked(repository.persistFinalAndPurge).mock.calls[0][0].final;
    expect(persisted.deidentifiedSummary).toBe('Growth opportunities were limited.');
    expect(JSON.stringify(persisted)).not.toContain('ref-A1B2C3');
  });

  it('retries a newly introduced localized project identifier before persisting', async () => {
    const { repository, deidentifier, useCase, input } = setup({
      knownIdentifiers: [], confirmedSemanticSummary: 'Growth opportunities were limited.',
    });
    vi.mocked(deidentifier.deidentify)
      .mockResolvedValueOnce('Projekt Orion restricted training.')
      .mockResolvedValueOnce('Growth opportunities were limited.');
    expect(await useCase.execute(input)).toBe('finalized');
    expect(deidentifier.deidentify).toHaveBeenCalledTimes(2);
    const persisted = vi.mocked(repository.persistFinalAndPurge).mock.calls[0][0].final;
    expect(persisted.deidentifiedSummary).toBe('Growth opportunities were limited.');
    expect(JSON.stringify(persisted)).not.toContain('Orion');
  });

  it('never commits an invalid score or privacy-rejected text', async () => {
    const { repository, scorer, deidentifier, useCase, input } = setup();
    vi.mocked(scorer.scoreConfirmedMeaning).mockResolvedValueOnce({
      score: 101, confidence: 0.86, modelId: 'model-v2', promptVersion: 'score-v2',
      direction: 'adverse', severity: 'high', rootCauseCategory: 'growth',
    });
    await expect(useCase.execute(input)).rejects.toThrow('question_score_invalid');
    expect(deidentifier.deidentify).not.toHaveBeenCalled();
    expect(repository.persistFinalAndPurge).not.toHaveBeenCalled();
  });

  it('persists a confirmed unevaluable meaning without a numeric score', async () => {
    const { repository, scorer, useCase, input } = setup({
      confirmedSemanticSummary: 'The employee could not assess current manager support.',
      knownIdentifiers: [], sourceMessageIds: [],
    });
    vi.mocked(scorer.scoreConfirmedMeaning).mockResolvedValueOnce({
      outcome: 'insufficient_evidence', score: null, confidence: 0.2,
      modelId: 'model-v2', promptVersion: 'score-v2',
      direction: 'mixed', severity: 'low', rootCauseCategory: 'support',
    });
    expect(await useCase.execute(input)).toBe('finalized');
    expect(vi.mocked(repository.persistFinalAndPurge).mock.calls[0]?.[0].final)
      .toEqual(expect.objectContaining({ outcome: 'insufficient_evidence', score: null }));
  });

  it('rejects fractional scores', async () => {
    const { repository, scorer, useCase, input } = setup();
    vi.mocked(scorer.scoreConfirmedMeaning).mockResolvedValueOnce({
      score: 37.125, confidence: 0.86, modelId: 'model-v2', promptVersion: 'score-v2',
      direction: 'adverse', severity: 'high', rootCauseCategory: 'growth',
    });
    await expect(useCase.execute(input)).rejects.toThrow('question_score_invalid');
    expect(repository.persistFinalAndPurge).not.toHaveBeenCalled();
  });

  it('keeps safe direction and category metadata if the first fallback text collides with an identifier', async () => {
    const { repository, deidentifier, useCase, input } = setup({ knownIdentifiers: ['adverse'] });
    vi.mocked(deidentifier.deidentify).mockResolvedValue('Mira at Project Atlas');
    expect(await useCase.execute(input)).toBe('finalized');
    const persisted = vi.mocked(repository.persistFinalAndPurge).mock.calls[0][0].final;
    expect(persisted.deidentifiedSummary).toBe('A generalized work experience signal was identified.');
    expect(persisted.signalDirection).toBe('adverse');
    expect(persisted.rootCauseCategory).toBe('growth');
  });

  it('rejects a project name even when the model drops its label', async () => {
    const { repository, deidentifier, useCase, input } = setup({ knownIdentifiers: [] });
    vi.mocked(deidentifier.deidentify).mockResolvedValue('Atlas delayed opportunities.');

    expect(await useCase.execute(input)).toBe('finalized');
    const persisted = vi.mocked(repository.persistFinalAndPurge).mock.calls[0][0].final;
    expect(persisted.deidentifiedSummary).not.toContain('Atlas');
    expect(deidentifier.deidentify).toHaveBeenCalledTimes(2);
  });

  it('rejects a person named in the confirmed meaning without a role label', async () => {
    const { repository, deidentifier, useCase, input } = setup({
      knownIdentifiers: [],
      confirmedSemanticSummary: 'The review was blocked by Sarah, so growth slowed.',
    });
    vi.mocked(deidentifier.deidentify)
      .mockResolvedValueOnce('Sarah blocked the review and slowed growth.')
      .mockResolvedValueOnce('The review was blocked, slowing growth.');

    expect(await useCase.execute(input)).toBe('finalized');
    expect(deidentifier.deidentify).toHaveBeenCalledTimes(2);
    const persisted = vi.mocked(repository.persistFinalAndPurge).mock.calls[0][0].final;
    expect(persisted.deidentifiedSummary).toBe('The review was blocked, slowing growth.');
  });

  it.each([
    ['Sarah blocked the review, slowing growth.', 'Sarah blocked the review.', 'Sarah'],
    ['Łukasz wstrzymał rozmowę o rozwoju.', 'Łukasz wstrzymał rozmowę.', 'Łukasz'],
    ['Олена затримала розмову про розвиток.', 'Олена затримала розмову.', 'Олена'],
    ['The review was delayed. Sarah dismissed my concern.', 'The review was delayed. Sarah dismissed the concern.', 'Sarah'],
  ])('rejects a private name at a sentence start in an unlabeled source: %s',
    async (confirmedSemanticSummary, candidate, privateName) => {
      const { repository, deidentifier, useCase, input } = setup({
        knownIdentifiers: [], confirmedSemanticSummary,
      });
      vi.mocked(deidentifier.deidentify)
        .mockResolvedValueOnce(candidate)
        .mockResolvedValueOnce('A development conversation was delayed.');

      expect(await useCase.execute(input)).toBe('finalized');
      expect(deidentifier.deidentify).toHaveBeenCalledTimes(2);
      const persisted = vi.mocked(repository.persistFinalAndPurge).mock.calls[0][0].final;
      expect(persisted.deidentifiedSummary).not.toContain(privateName);
    });

  it.each([
    ['Anna Kowalska blocked the review.', 'Anna delayed the review.', 'Anna'],
    ['Łukasz Żuraw blocked the review.', 'Łukasz delayed the review.', 'Łukasz'],
    ['Олена Коваль затримала розмову.', 'Олена затримала розмову.', 'Олена'],
  ])('rejects the first word of an unlabeled full name at sentence start: %s',
    async (confirmedSemanticSummary, candidate, privateName) => {
      const { repository, deidentifier, useCase, input } = setup({
        knownIdentifiers: [], confirmedSemanticSummary,
      });
      vi.mocked(deidentifier.deidentify)
        .mockResolvedValueOnce(candidate)
        .mockResolvedValueOnce('A development conversation was delayed.');

      expect(await useCase.execute(input)).toBe('finalized');
      expect(deidentifier.deidentify).toHaveBeenCalledTimes(2);
      const persisted = vi.mocked(repository.persistFinalAndPurge).mock.calls[0][0].final;
      expect(persisted.deidentifiedSummary).not.toContain(privateName);
    });

  it('does not treat an Index term at the start as a person identifier', async () => {
    const { repository, deidentifier, useCase, input } = setup({
      knownIdentifiers: [],
      confirmedSemanticSummary: 'Growth opportunities were limited.',
    });
    vi.mocked(deidentifier.deidentify).mockResolvedValue('Growth opportunities were limited.');

    expect(await useCase.execute(input)).toBe('finalized');
    expect(deidentifier.deidentify).toHaveBeenCalledOnce();
    expect(vi.mocked(repository.persistFinalAndPurge).mock.calls[0][0].final.deidentifiedSummary)
      .toBe('Growth opportunities were limited.');
  });

  it('keeps a generic Index term at the start of a later sentence reportable', async () => {
    const { repository, deidentifier, useCase, input } = setup({
      knownIdentifiers: [],
      confirmedSemanticSummary: 'The review was delayed. Growth opportunities were limited.',
    });
    vi.mocked(deidentifier.deidentify)
      .mockResolvedValue('The review was delayed. Growth opportunities were limited.');

    expect(await useCase.execute(input)).toBe('finalized');
    expect(deidentifier.deidentify).toHaveBeenCalledOnce();
    expect(vi.mocked(repository.persistFinalAndPurge).mock.calls[0][0].final.deidentifiedSummary)
      .toBe('The review was delayed. Growth opportunities were limited.');
  });

  it('rejects a labeled Cyrillic project name after partial redaction', async () => {
    const { repository, deidentifier, useCase, input } = setup({
      knownIdentifiers: [], confirmedSemanticSummary: 'Проект Атлас задержал развитие.',
    });
    vi.mocked(deidentifier.deidentify).mockResolvedValue('Атлас задержал развитие.');

    expect(await useCase.execute(input)).toBe('finalized');
    const persisted = vi.mocked(repository.persistFinalAndPurge).mock.calls[0][0].final;
    expect(persisted.deidentifiedSummary).not.toContain('Атлас');
  });

  it.each([
    ['Projekt Feniks ogranicza możliwości rozwoju.', 'Feniks ogranicza możliwości rozwoju.', 'Feniks'],
    ['Проєкт Оріон заважає розвитку.', 'Оріон заважає розвитку.', 'Оріон'],
    ['Menedżer Anna ogranicza możliwości rozwoju.', 'Anna ogranicza możliwości rozwoju.', 'Anna'],
  ])('rejects a labeled private name after the model drops its label: %s',
    async (confirmedSemanticSummary, candidate, privateName) => {
      const { repository, deidentifier, useCase, input } = setup({
        knownIdentifiers: [], confirmedSemanticSummary,
      });
      vi.mocked(deidentifier.deidentify).mockResolvedValue(candidate);

      expect(await useCase.execute(input)).toBe('finalized');
      expect(deidentifier.deidentify).toHaveBeenCalledTimes(2);
      const persisted = vi.mocked(repository.persistFinalAndPurge).mock.calls[0][0].final;
      expect(persisted.deidentifiedSummary).not.toContain(privateName);
    });

  it('retries a local phone number and falls back without persisting it', async () => {
    const { repository, deidentifier, useCase, input } = setup();
    vi.mocked(deidentifier.deidentify).mockResolvedValue('Call 123 456 789 about growth.');

    expect(await useCase.execute(input)).toBe('finalized');
    expect(deidentifier.deidentify).toHaveBeenCalledTimes(2);
    const persisted = vi.mocked(repository.persistFinalAndPurge).mock.calls[0][0].final;
    expect(persisted.deidentifiedSummary).not.toContain('123 456 789');
    expect(persisted.privacyPolicyVersion).toBe('question-deidentification-v2');
  });

  it.each([
    'Call me at 2025550147 about growth.',
    'The conversation moved to <#C12345678|private-team>.',
    'Slack user U12345678 discussed growth.',
    'Contact sara@会社.jp about growth.',
  ])('retries a newly detected private identifier before finalization: %s', async (candidate) => {
    const { repository, deidentifier, useCase, input } = setup();
    vi.mocked(deidentifier.deidentify)
      .mockResolvedValueOnce(candidate)
      .mockResolvedValueOnce('Growth opportunities were limited.');

    expect(await useCase.execute(input)).toBe('finalized');
    expect(deidentifier.deidentify).toHaveBeenCalledTimes(2);
    const persisted = vi.mocked(repository.persistFinalAndPurge).mock.calls[0][0].final;
    expect(persisted.deidentifiedSummary).toBe('Growth opportunities were limited.');
    expect(persisted.score).toBe(37);
    expect(JSON.stringify(persisted)).not.toContain(candidate);
  });

  it('accepts a safe summary when the private project name precedes ordinary words', async () => {
    const { repository, deidentifier, useCase, input } = setup({
      knownIdentifiers: ['Project Atlas'],
      confirmedSemanticSummary: 'Project Atlas offered limited growth opportunities.',
    });
    vi.mocked(deidentifier.deidentify).mockResolvedValue('Growth opportunities were limited.');

    expect(await useCase.execute(input)).toBe('finalized');
    expect(vi.mocked(repository.persistFinalAndPurge).mock.calls[0][0].final.deidentifiedSummary)
      .toBe('Growth opportunities were limited.');
  });
});
