import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import type { Job } from 'bullmq';
import {
  conversations, messages, pulseBacklog, surveyDefinitions, surveyQuestions,
  surveyQuestionInsights, surveyQuestionWorkingInsights, surveyScoringPolicies, surveyWindowScoringPolicies,
  surveyWindows, tenants, users,
} from '@entalent/database';
import { FinalizeQuestionInsightUseCase, RecoverConfirmedQuestionInsightsUseCase, SelectQuestionInsightInputsUseCase, LEGACY_V2_QUESTION_GROUP_BY_STABLE_KEY } from '@entalent/application';
import type { SurveyEvidenceExtractionUseCase, SurveyEvidencePayload } from '@entalent/application';
import { SurveyEvidenceProcessor } from '../survey-evidence.processor';
import { QuestionCutoffProcessor } from '../question-cutoff.processor';
import { QuestionInsightRepository } from './question-insight.repository';

const databaseUrl = process.env['DATABASE_URL'];

describe.runIf(Boolean(databaseUrl))('V2 repository on fully migrated PostgreSQL', () => {
  const client = databaseUrl ? postgres(databaseUrl, { max: 1 }) : null;
  const db = client ? drizzle(client) : null;
  const repository = db
    ? new QuestionInsightRepository({ client: db } as never, {
      findCurrentHierarchyIdentifiers: async () => ['Project Atlas'],
    } as never)
    : null;
  let tenantId: string | null = null;

  beforeAll(async () => {
    if (!client) return;
    const [row] = await client`select to_regclass('public.survey_question_working_insights') as table_name`;
    if (!row?.['table_name']) throw new Error('v2_migrated_schema_required');
  });

  afterAll(async () => {
    if (db && tenantId) await db.delete(tenants).where(eq(tenants.id, tenantId));
    await client?.end();
  });

  it('reopens a declined question after a newer scoped employee message', async () => {
    if (!db || !repository) return;
    const [tenant] = await db.insert(tenants).values({ name: `V2 fixture ${randomUUID()}` }).returning();
    tenantId = tenant!.id;
    const [user] = await db.insert(users).values({ tenantId }).returning();
    const [definition] = await db.insert(surveyDefinitions).values({
      tenantId, name: 'Synthetic V2 fixture', version: 'fixture-v2',
    }).returning();
    const questions = await db.insert(surveyQuestions).values(
      Object.entries(LEGACY_V2_QUESTION_GROUP_BY_STABLE_KEY).map(([stableKey, questionGroup]) => ({
        surveyDefinitionId: definition!.id,
        stableKey,
        title: stableKey,
        canonicalMeaning: `Synthetic ${stableKey}`,
        dimension: questionGroup,
        questionGroup,
        version: 'v2',
      })),
    ).returning();
    const question = questions.find((item) => item.stableKey === 'q12_expectations')!;
    const rubric = { version: 'synthetic-fixture-v1', instructions: 'Synthetic test only.', anchors: [
      { score: 0, description: 'Low' }, { score: 100, description: 'High' },
    ] };
    const rubrics = Object.fromEntries(questions.map((item) => [item.stableKey, rubric]));
    const [policy] = await db.insert(surveyScoringPolicies).values({
      tenantId, version: 'synthetic-fixture-v1', rubrics, approvedAt: new Date(),
    }).returning();
    const now = Date.now();
    const declinedAt = new Date(now - 3_600_000);
    const [window] = await db.insert(surveyWindows).values({
      tenantId, userId: user!.id, surveyDefinitionId: definition!.id,
      periodStart: new Date(now - 86_400_000), periodEnd: new Date(now + 86_400_000),
    }).returning();
    await db.insert(surveyWindowScoringPolicies).values({
      surveyWindowId: window!.id, tenantId, scoringPolicyId: policy!.id,
    });
    const [conversation] = await db.insert(conversations).values({
      tenantId, userId: user!.id, channelType: 'dev', externalConversationId: randomUUID(),
    }).returning();
    const [oldMessage, newMessage] = await db.insert(messages).values([
      { tenantId, userId: user!.id, conversationId: conversation!.id,
        direction: 'inbound', senderType: 'user', text: 'Earlier text.',
        occurredAt: new Date(now - 7_200_000) },
      { tenantId, userId: user!.id, conversationId: conversation!.id,
        direction: 'inbound', senderType: 'user', text: 'I changed my mind; let us discuss this.',
        occurredAt: new Date(now - 60_000) },
    ]).returning();
    await db.insert(surveyQuestionWorkingInsights).values({
      tenantId, userId: user!.id, surveyWindowId: window!.id,
      surveyQuestionId: question.id, questionVersion: question.version,
      status: 'declined', purgedAt: declinedAt,
    });
    await db.insert(pulseBacklog).values({
      tenantId, userId: user!.id, surveyWindowId: window!.id,
      surveyQuestionId: question.id, position: 1, status: 'done', doneAt: declinedAt,
    });

    expect(await repository.getWindowMode({ tenantId, userId: user!.id,
      surveyWindowId: window!.id })).toBe('v2');
    const reopen = {
      tenantId, userId: user!.id, conversationId: conversation!.id,
      surveyWindowId: window!.id, surveyQuestionId: question.id,
      questionVersion: question.version, sourceMessageId: newMessage!.id,
    };
    expect(await repository.reopenDeclinedQuestion({
      ...reopen, sourceMessageId: oldMessage!.id,
    })).toBe(false);
    expect(await repository.reopenDeclinedQuestion(reopen)).toBe(true);
    expect(await repository.reopenDeclinedQuestion(reopen)).toBe(false);
    expect(await repository.captureMeaning({
      ...reopen, meaning: 'I want more choice in my work methods.', sufficientMeaning: false,
    })).toBe('captured');

    const [working] = await db.select().from(surveyQuestionWorkingInsights)
      .where(eq(surveyQuestionWorkingInsights.surveyQuestionId, question.id));
    const [backlog] = await db.select().from(pulseBacklog)
      .where(eq(pulseBacklog.surveyQuestionId, question.id));
    expect(working).toMatchObject({
      status: 'collecting', workingSummary: 'I want more choice in my work methods.',
      sourceMessageIds: [newMessage!.id], purgedAt: null,
    });
    expect(backlog).toMatchObject({ status: 'pending', doneAt: null });

    const confirmedQuestion = questions.find((item) => item.stableKey === 'role_clarity')!;
    await db.insert(surveyQuestionWorkingInsights).values({
      tenantId, userId: user!.id, surveyWindowId: window!.id,
      surveyQuestionId: confirmedQuestion.id, questionVersion: confirmedQuestion.version,
      status: 'confirmed', workingSummary: 'Private working text about Project Atlas.',
      confirmedSemanticSummary: 'Project Atlas offered limited growth opportunities.',
      sourceMessageIds: [newMessage!.id], confirmedAt: newMessage!.occurredAt,
    });
    const externalSourceId = '1725367200.000001';
    await db.update(messages).set({ externalMessageId: externalSourceId })
      .where(eq(messages.id, newMessage!.id));
    const loaded = await repository.loadConfirmedQuestion({
      tenantId, userId: user!.id, surveyWindowId: window!.id,
      surveyQuestionId: confirmedQuestion.id,
    });
    expect(loaded && loaded !== 'already_finalized' ? loaded.sourceMessageIds : [])
      .toContain(externalSourceId);
    const scorer = { scoreConfirmedMeaning: async () => ({
      score: 37, confidence: 0.86, modelId: 'synthetic-model',
      promptVersion: 'synthetic-prompt', direction: 'adverse' as const,
      severity: 'moderate' as const, rootCauseCategory: 'growth' as const,
    }) };
    const deidentifier = { deidentify: async ({ attempt }: { attempt: number }) => attempt === 1
      ? 'Growth opportunities were limited until 28 сентября.'
      : 'Growth opportunities were limited.' };
    const finalizer = new FinalizeQuestionInsightUseCase(repository, scorer, deidentifier);
    const processor = new SurveyEvidenceProcessor({
      assertConversationOwner: async () => undefined,
      execute: async () => { throw new Error('private evidence-model output'); },
    } as unknown as SurveyEvidenceExtractionUseCase, finalizer);
    await expect(processor.process({ data: {
      tenantId, userId: user!.id, conversationId: conversation!.id,
      inboundMessageId: newMessage!.id, traceId: 'synthetic-v2',
    } } as Job<SurveyEvidencePayload>)).rejects.toThrow('survey_evidence_processing_failed');
    expect(await finalizer.executePending({ tenantId, userId: user!.id })).toBe(0);

    const [final] = await db.select().from(surveyQuestionInsights)
      .where(eq(surveyQuestionInsights.surveyQuestionId, confirmedQuestion.id));
    const [purged] = await db.select().from(surveyQuestionWorkingInsights)
      .where(eq(surveyQuestionWorkingInsights.surveyQuestionId, confirmedQuestion.id));
    expect(final).toMatchObject({
      deidentifiedSummary: 'Growth opportunities were limited.',
      scoringPolicyVersion: 'synthetic-fixture-v1',
      questionRubricVersion: 'synthetic-fixture-v1',
      modelId: 'synthetic-model',
      privacyPolicyVersion: 'question-deidentification-v2',
    });
    expect(Number(final?.score)).toBe(37);
    await db.update(surveyQuestionInsights).set({ rootCauseCategory: 'recognition' })
      .where(eq(surveyQuestionInsights.id, final!.id));
    const [recognized] = await db.select({ category: surveyQuestionInsights.rootCauseCategory })
      .from(surveyQuestionInsights).where(eq(surveyQuestionInsights.id, final!.id));
    expect(recognized?.category).toBe('recognition');
    expect(JSON.stringify(final)).not.toContain('Project Atlas');
    expect(JSON.stringify(final)).not.toContain('Private working text');
    expect(purged).toMatchObject({
      workingSummary: null, confirmedSemanticSummary: null,
      sourceMessageIds: [], confirmationMessageId: null,
    });
    expect(purged?.purgedAt).not.toBeNull();
    expect(await db.select().from(messages).where(eq(messages.id, newMessage!.id)))
      .toHaveLength(1);
    const [laterMessage] = await db.insert(messages).values({
      tenantId, userId: user!.id, conversationId: conversation!.id,
      direction: 'inbound', senderType: 'user', text: 'Further private growth detail.',
      occurredAt: new Date(),
    }).returning();
    expect(await repository.captureMeaning({
      tenantId, userId: user!.id, conversationId: conversation!.id,
      surveyWindowId: window!.id, surveyQuestionId: confirmedQuestion.id,
      questionVersion: confirmedQuestion.version, sourceMessageId: laterMessage!.id,
      meaning: 'Further private growth detail.', sufficientMeaning: true,
    })).toBe('captured');
    const [reopened] = await db.select().from(surveyQuestionWorkingInsights)
      .where(eq(surveyQuestionWorkingInsights.surveyQuestionId, confirmedQuestion.id));
    expect(reopened?.workingSummary).toBe('Further private growth detail.');
    expect(reopened?.purgedAt).toBeNull();

    const selector = new SelectQuestionInsightInputsUseCase(repository);
    const growthIds = questions.filter((item) => item.questionGroup === 'growth').map((item) => item.id);
    const growthInput = {
      tenantId, userId: user!.id, surveyWindowId: window!.id,
      surveyDefinitionId: definition!.id, questionGroup: 'growth', requiredQuestionIds: growthIds,
      reportKind: 'final' as const, now: new Date(window!.periodEnd.getTime() + 1),
    };
    await expect(selector.execute({ ...growthInput, now: new Date(window!.periodEnd.getTime() - 1) }))
      .rejects.toThrow('question_insight_final_before_cutoff');
    expect(await selector.execute({ ...growthInput, reportKind: 'intermediate', now: new Date() }))
      .toEqual({ intermediateEligible: false, intermediateQuestions: [], finalQuestions: [], questionTrends: [] });
    const partial = await selector.execute(growthInput);
    expect(partial.intermediateEligible).toBe(false);
    expect(partial.finalQuestions.map((item) => item.questionId)).toEqual([confirmedQuestion.id]);
    expect(partial.questionTrends).toEqual([{
      questionId: confirmedQuestion.id, direction: 'baseline', delta: null,
      baselineReason: 'no_prior_score',
    }]);
    expect(partial).not.toHaveProperty('indexScore');
    expect(await selector.execute({
      ...growthInput, questionGroup: 'purpose',
      requiredQuestionIds: questions.filter((item) => item.questionGroup === 'purpose').map((item) => item.id),
    })).toEqual({ intermediateEligible: false, intermediateQuestions: [], finalQuestions: [], questionTrends: [] });

    const [otherUser] = await db.insert(users).values({ tenantId }).returning();
    expect(await repository.findWindowPeriod({
      tenantId, userId: otherUser!.id, surveyWindowId: window!.id,
      surveyDefinitionId: definition!.id,
    })).toBeNull();
    const mislabeledQuestion = questions.find((item) => item.stableKey === 'q12_recognition')!;
    const mismatchedWindowQuestion = questions.find((item) => item.stableKey === 'professional_growth')!;
    const mismatchedRecord = {
      tenantId, surveyWindowId: window!.id, surveyDefinitionId: definition!.id,
      questionGroup: 'growth', deidentifiedSummary: 'Synthetic mismatched scope.',
      score: '40', signalDirection: 'mixed' as const, signalSeverity: 'low' as const,
      rootCauseCategory: 'growth' as const, scoringPolicyVersion: policy!.version,
      questionRubricVersion: rubric.version, modelId: 'synthetic-model',
      promptVersion: 'synthetic-prompt', confidence: '0.8',
      privacyPolicyVersion: 'question-deidentification-v1',
      confirmedAt: newMessage!.occurredAt, scoredAt: newMessage!.occurredAt,
    };
    await expect(db.insert(surveyQuestionInsights).values({
      ...mismatchedRecord, userId: user!.id, questionGroup: 'purpose',
      surveyQuestionId: mislabeledQuestion.id, questionVersion: mislabeledQuestion.version,
      score: null,
    })).rejects.toThrow('survey_question_insights_score_range');
    await expect(db.insert(surveyQuestionInsights).values({
      ...mismatchedRecord, userId: otherUser!.id,
      surveyQuestionId: mismatchedWindowQuestion.id,
      questionVersion: mismatchedWindowQuestion.version,
    })).rejects.toThrow('survey_insight_v2_window_user_mismatch');
    await expect(db.insert(surveyQuestionInsights).values({
      ...mismatchedRecord, userId: user!.id,
      surveyQuestionId: mislabeledQuestion.id,
      questionVersion: mislabeledQuestion.version,
    })).rejects.toThrow('survey_insight_v2_final_scope_mismatch');
    await db.insert(surveyQuestionInsights).values({
      ...mismatchedRecord, userId: user!.id,
      questionGroup: 'purpose', surveyQuestionId: mislabeledQuestion.id,
      questionVersion: mislabeledQuestion.version,
      confirmedAt: window!.periodEnd,
      scoredAt: new Date(window!.periodEnd.getTime() + 1),
    });
    expect(await selector.execute({
      ...growthInput, questionGroup: 'purpose',
      requiredQuestionIds: questions.filter((item) => item.questionGroup === 'purpose').map((item) => item.id),
    })).toEqual({ intermediateEligible: false, intermediateQuestions: [], finalQuestions: [], questionTrends: [] });
    expect(await repository.findFinalizedQuestions({ ...growthInput, userId: otherUser!.id }))
      .toEqual([]);
    expect((await repository.findFinalizedQuestions(growthInput)).map((item) => item.questionId))
      .toEqual([confirmedQuestion.id]);

    const day = 86_400_000;
    const firstPriorEnd = new Date(window!.periodStart.getTime() - 90 * day);
    const firstPriorStart = new Date(firstPriorEnd.getTime() - 90 * day);
    const [firstPriorWindow] = await db.insert(surveyWindows).values({
      tenantId, userId: user!.id, surveyDefinitionId: definition!.id,
      periodStart: firstPriorStart, periodEnd: firstPriorEnd, status: 'closed',
    }).returning();
    await db.insert(surveyWindowScoringPolicies).values({
      tenantId, surveyWindowId: firstPriorWindow!.id, scoringPolicyId: policy!.id,
    });
    const insertPriorScore = async (surveyWindowId: string, scoringPolicyVersion: string,
      score: string, confirmedAt: Date) => db.insert(surveyQuestionInsights).values({
      tenantId: tenant!.id, userId: user!.id, surveyWindowId,
      surveyDefinitionId: definition!.id, surveyQuestionId: confirmedQuestion.id,
      questionVersion: confirmedQuestion.version, questionGroup: 'growth',
      deidentifiedSummary: 'Generalized growth signal.', score,
      signalDirection: 'mixed', signalSeverity: 'low', rootCauseCategory: 'growth',
      scoringPolicyVersion, questionRubricVersion: 'synthetic-fixture-v1',
      modelId: 'synthetic-model', promptVersion: 'synthetic-prompt', confidence: '0.8',
      privacyPolicyVersion: 'deidentification-v1', confirmedAt, scoredAt: confirmedAt,
    });
    await insertPriorScore(firstPriorWindow!.id, policy!.version, '36.999',
      new Date(firstPriorEnd.getTime() - day));
    const samePolicy = await selector.execute(growthInput);
    expect(samePolicy.questionTrends[0]).toMatchObject({
      questionId: confirmedQuestion.id, direction: 'improving',
    });
    expect(samePolicy.questionTrends[0]?.delta).toBeGreaterThan(0);

    const invalidPriorEnd = new Date(firstPriorEnd.getTime() + day);
    const [invalidPriorWindow] = await db.insert(surveyWindows).values({
      tenantId, userId: user!.id, surveyDefinitionId: definition!.id,
      periodStart: firstPriorEnd, periodEnd: invalidPriorEnd, status: 'closed',
    }).returning();
    await db.insert(surveyWindowScoringPolicies).values({
      tenantId, surveyWindowId: invalidPriorWindow!.id, scoringPolicyId: policy!.id,
    });
    await insertPriorScore(invalidPriorWindow!.id, policy!.version, '90', invalidPriorEnd);
    expect((await selector.execute(growthInput)).questionTrends[0]).toMatchObject({
      questionId: confirmedQuestion.id, direction: 'improving',
    });

    const [olderPolicy] = await db.insert(surveyScoringPolicies).values({
      tenantId, version: 'synthetic-fixture-v0', rubrics, approvedAt: new Date(),
    }).returning();
    const [latestPriorWindow] = await db.insert(surveyWindows).values({
      tenantId, userId: user!.id, surveyDefinitionId: definition!.id,
      periodStart: firstPriorEnd, periodEnd: window!.periodStart, status: 'closed',
    }).returning();
    await db.insert(surveyWindowScoringPolicies).values({
      tenantId, surveyWindowId: latestPriorWindow!.id, scoringPolicyId: olderPolicy!.id,
    });
    await insertPriorScore(latestPriorWindow!.id, olderPolicy!.version, '20',
      new Date(window!.periodStart.getTime() - day));
    const newBaseline = await selector.execute(growthInput);
    expect(newBaseline.questionTrends[0]).toEqual({
      questionId: confirmedQuestion.id, direction: 'baseline', delta: null,
      baselineReason: 'policy_version_changed',
    });

    await db.insert(surveyQuestionWorkingInsights).values(
      questions.filter((item) => item.questionGroup === 'growth' && item.id !== confirmedQuestion.id)
        .map((item) => ({
          tenantId: tenant!.id, userId: user!.id, surveyWindowId: window!.id,
          surveyQuestionId: item.id, questionVersion: item.version,
          status: 'confirmed', confirmedSemanticSummary: 'Growth opportunities were limited.',
          sourceMessageIds: [newMessage!.id], confirmedAt: newMessage!.occurredAt,
        })),
    );
    expect(await repository.listPendingConfirmedUsers()).toContainEqual({ tenantId, userId: user!.id });
    const retryQuestion = questions.find((item) => item.stableKey === 'professional_growth')!;
    const faultRepository = new QuestionInsightRepository({ client: {
      transaction: (work: (tx: unknown) => Promise<unknown>) => db.transaction(async (tx) => {
        await work(tx);
        throw new Error('injected_commit_failure');
      }),
    } } as never, {} as never);
    const faultFinalizer = new FinalizeQuestionInsightUseCase({
      listPendingConfirmedUsers: repository.listPendingConfirmedUsers.bind(repository),
      listPendingConfirmedQuestions: repository.listPendingConfirmedQuestions.bind(repository),
      loadConfirmedQuestion: repository.loadConfirmedQuestion.bind(repository),
      persistFinalAndPurge: faultRepository.persistFinalAndPurge.bind(faultRepository),
    }, scorer, deidentifier);
    const retryInput = { tenantId, userId: user!.id, surveyWindowId: window!.id,
      surveyQuestionId: retryQuestion.id };
    await expect(faultFinalizer.execute(retryInput)).rejects.toThrow('injected_commit_failure');
    expect(await db.select().from(surveyQuestionInsights)
      .where(eq(surveyQuestionInsights.surveyQuestionId, retryQuestion.id))).toHaveLength(0);
    const [stillPrivate] = await db.select().from(surveyQuestionWorkingInsights)
      .where(eq(surveyQuestionWorkingInsights.surveyQuestionId, retryQuestion.id));
    expect(stillPrivate).toMatchObject({
      status: 'confirmed', confirmedSemanticSummary: 'Growth opportunities were limited.',
      purgedAt: null,
    });
    expect(await finalizer.execute(retryInput)).toBe('finalized');
    const [retriedWorking] = await db.select().from(surveyQuestionWorkingInsights)
      .where(eq(surveyQuestionWorkingInsights.surveyQuestionId, retryQuestion.id));
    expect(retriedWorking).toMatchObject({
      confirmedSemanticSummary: null, sourceMessageIds: [],
    });
    expect(retriedWorking?.purgedAt).not.toBeNull();
    const twoQuestionPartial = await selector.execute(growthInput);
    expect(twoQuestionPartial.intermediateEligible).toBe(false);
    expect(twoQuestionPartial.finalQuestions.map((item) => item.questionId))
      .toEqual(growthIds.slice(0, 2));
    expect(twoQuestionPartial).not.toHaveProperty('indexScore');
    const recovery = new RecoverConfirmedQuestionInsightsUseCase(repository, finalizer);
    const lifecycle = new QuestionCutoffProcessor(
      { execute: async () => ({ tenantsProcessed: 0, expiredQuestionCount: 0 }) } as never,
      recovery,
      {} as never,
      { findUndispatchedTimelyQuestionReplies: async () => [],
        findQueuedTimelyQuestionRepliesWithoutReceipt: async () => [] } as never,
      {} as never,
    );
    await lifecycle.process({ name: 'cutoff' } as Job);
    expect(await repository.listPendingConfirmedUsers()).not.toContainEqual({ tenantId, userId: user!.id });
    const complete = await selector.execute(growthInput);
    expect(complete.intermediateEligible).toBe(true);
    expect(complete.finalQuestions.map((item) => item.questionId)).toEqual(growthIds);
    expect(complete).not.toHaveProperty('indexScore');

    const lateWorkingQuestion = questions.find((item) => item.stableKey === 'purpose_meaning')!;
    await db.insert(surveyQuestionWorkingInsights).values({
      tenantId, userId: user!.id, surveyWindowId: window!.id,
      surveyQuestionId: lateWorkingQuestion.id, questionVersion: lateWorkingQuestion.version,
      status: 'confirmed', confirmedSemanticSummary: 'Late synthetic meaning.',
      confirmedAt: window!.periodEnd,
    });
    expect(await repository.loadConfirmedQuestion({
      tenantId, userId: user!.id, surveyWindowId: window!.id,
      surveyQuestionId: lateWorkingQuestion.id,
    })).toBeNull();

    const readySupplement = await repository.findReadyQuestionBundle({ tenantId, userId: user!.id });
    expect(readySupplement?.questions.map((question) => question.surveyQuestionId))
      .toEqual([confirmedQuestion.id]);
    const supplementStatement = 'Current growth opportunities cannot yet be assessed.';
    const supplementText = `I hear that ${supplementStatement} Is that fair?`;
    const [supplementPrompt] = await db.insert(messages).values({
      tenantId, userId: user!.id, conversationId: conversation!.id,
      direction: 'outbound', senderType: 'agent', text: supplementText,
      occurredAt: new Date(laterMessage!.occurredAt.getTime() + 1_000),
    }).returning();
    const supplementBundleId = await repository.stageQuestionConfirmationBundle({
      tenantId, userId: user!.id, conversationId: conversation!.id,
      surveyWindowId: window!.id, questionGroup: 'growth',
      promptMessageId: supplementPrompt!.id, displayedText: supplementText,
      components: [{ surveyQuestionId: confirmedQuestion.id,
        questionVersion: confirmedQuestion.version, statement: supplementStatement,
        expectedWorkingSummary: reopened!.workingSummary! }],
    });
    const sentAt = new Date(laterMessage!.occurredAt.getTime() + 2_000);
    await db.update(messages).set({ sentAt }).where(eq(messages.id, supplementPrompt!.id));
    await repository.activateDeliveredQuestionBundle({
      promptMessageId: supplementPrompt!.id, tenantId, conversationId: conversation!.id, deliveredAt: sentAt,
    });
    const [supplementReply] = await db.insert(messages).values({
      tenantId, userId: user!.id, conversationId: conversation!.id,
      direction: 'inbound', senderType: 'user', text: 'Yes, that is fair.',
      occurredAt: new Date(sentAt.getTime() + 1_000),
    }).returning();
    expect((await repository.findAwaitingQuestionBundle({
      tenantId, userId: user!.id, conversationId: conversation!.id,
      inboundMessageId: supplementReply!.id,
    }))?.components).toHaveLength(1);
    expect(await repository.applyQuestionBundleVerdict({
      tenantId, userId: user!.id, conversationId: conversation!.id,
      inboundMessageId: supplementReply!.id, bundleId: supplementBundleId,
      verdict: { kind: 'agree' },
    })).toBe(true);
    const unscoredFinalizer = new FinalizeQuestionInsightUseCase(repository, {
      scoreConfirmedMeaning: async () => ({
        outcome: 'insufficient_evidence' as const, score: null, confidence: 0.2,
        modelId: 'synthetic-model', promptVersion: 'synthetic-prompt',
        direction: 'mixed' as const, severity: 'low' as const, rootCauseCategory: 'growth' as const,
      }),
    }, { deidentify: async () => 'Growth opportunities could not be assessed.' });
    expect(await unscoredFinalizer.execute({
      tenantId, userId: user!.id, surveyWindowId: window!.id, surveyQuestionId: confirmedQuestion.id,
    })).toBe('finalized');
    const history = await db.select().from(surveyQuestionInsights)
      .where(and(
        eq(surveyQuestionInsights.surveyQuestionId, confirmedQuestion.id),
        eq(surveyQuestionInsights.surveyWindowId, window!.id),
      ));
    expect(history).toHaveLength(2);
    expect(history.filter((row) => row.isCurrent)).toMatchObject([{
      outcome: 'insufficient_evidence', score: null,
    }]);
    expect(history.filter((row) => !row.isCurrent)).toHaveLength(1);
    expect(await repository.findFinalizedQuestions({
      tenantId, userId: user!.id, surveyWindowId: window!.id,
      surveyDefinitionId: definition!.id, questionGroup: 'growth',
    })).toContainEqual(expect.objectContaining({ questionId: confirmedQuestion.id,
      outcome: 'insufficient_evidence', score: null,
      deidentifiedSummary: 'Growth opportunities could not be assessed.' }));
    const unscoredFinal = await selector.execute(growthInput);
    expect(unscoredFinal.intermediateEligible).toBe(false);
    expect(unscoredFinal.finalQuestions).toContainEqual(expect.objectContaining({
      questionId: confirmedQuestion.id, outcome: 'insufficient_evidence', score: null,
    }));
    expect(unscoredFinal.questionTrends).not.toContainEqual(expect.objectContaining({
      questionId: confirmedQuestion.id,
    }));
    expect(await selector.execute({ ...growthInput, reportKind: 'intermediate' }))
      .toEqual({ intermediateEligible: false, intermediateQuestions: [],
        finalQuestions: [], questionTrends: [] });
  });
});
