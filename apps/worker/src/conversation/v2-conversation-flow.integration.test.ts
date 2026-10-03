import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Queue, QueueEvents, Worker, type Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import {
  conversationDispatchIntents, conversationJobAdmissions, conversationJobReceipts,
  conversationMessageSendAttempts,
  conversationTurnEffects, conversations, createDbClient, messages,
  pulseBacklog, surveyDefinitions, surveyQuestions,
  surveyQuestionConfirmationBundles, surveyQuestionInsights, surveyQuestionWorkingInsights,
  surveyQuestionVerdictReceipts,
  surveyAssessments, surveyEvidence, surveyScoringPolicies, surveyWindowScoringPolicies,
  surveyWindows, scheduledActions, tenants, users,
} from '@entalent/database';
import {
  ConversationOrchestrator, ExpireQuestionInsightsAtCutoffUseCase, FEATURE_FLAGS,
  FinalizeQuestionInsightUseCase, RecoverConfirmedQuestionInsightsUseCase, SelectQuestionInsightInputsUseCase,
  SurveyEvidenceExtractionUseCase, LEGACY_V2_QUESTION_GROUP_BY_STABLE_KEY, type SurveyEvidencePayload,
} from '@entalent/application';
import { ConversationProcessor, type ConversationJob } from './conversation.processor';
import { ConversationRepository } from './repositories/conversation.repository';
import { MessageSendProcessor } from '../message-send/message-send.processor';
import { QuestionInsightRepository } from '../survey/repositories/question-insight.repository';
import { SurveyEvidenceProcessor } from '../survey/survey-evidence.processor';
import { QuestionCutoffProcessor } from '../survey/question-cutoff.processor';
import { SurveyRepository } from '../survey/repositories/survey.repository';
import { DatabaseService } from '../database/database.service';

const databaseUrl = process.env['DATABASE_URL'];
const redisUrl = process.env['REDIS_URL'];
const enabled = process.env['V2_CONVERSATION_QUEUE_TEST'] === '1';
const approvedRubrics = JSON.parse(readFileSync(resolve(__dirname,
  '../../../../scripts/data/v2-scoring-policy-1.0.0.json'), 'utf8')) as Record<string, {
  title: string; canonicalMeaning: string; questionGroup: string; version: string;
}>;

describe.runIf(enabled)('V2 conversation through BullMQ and migrated PostgreSQL', () => {
  const client = databaseUrl ? createDbClient(databaseUrl) : null;
  const transactionDb = databaseUrl
    ? new DatabaseService({ get: () => databaseUrl } as never)
    : null;
  const tenantIds: string[] = [];

  beforeAll(() => {
    if (!databaseUrl || !redisUrl || !client) throw new Error('isolated_postgres_and_redis_required');
    const db = new URL(databaseUrl);
    const redis = new URL(redisUrl);
    if (!['127.0.0.1', 'localhost'].includes(db.hostname) || !db.port
      || !['127.0.0.1', 'localhost'].includes(redis.hostname) || redis.pathname !== '/15') {
      throw new Error('isolated_postgres_and_redis_required');
    }
    transactionDb!.onModuleInit();
  });

  afterAll(async () => {
    if (transactionDb) await transactionDb.onModuleDestroy();
    if (!client) return;
    for (const tenantId of tenantIds) await client.db.delete(tenants).where(eq(tenants.id, tenantId));
    await client.sql.end({ timeout: 2 });
  });

  it.each([
    { verdictKind: 'agree', questionGroup: 'autonomy' },
    { verdictKind: 'agree', questionGroup: 'autonomy', approvedPolicy: true },
    { verdictKind: 'partial', questionGroup: 'autonomy' },
    { verdictKind: 'partial_unrelated', questionGroup: 'autonomy' },
    { verdictKind: 'decline', questionGroup: 'autonomy' },
    { verdictKind: 'reject', questionGroup: 'autonomy' },
    { verdictKind: 'agree', questionGroup: 'belonging' },
    { verdictKind: 'agree', questionGroup: 'belonging', approvedPolicy: true },
    { verdictKind: 'agree', questionGroup: 'growth' },
    { verdictKind: 'agree', questionGroup: 'growth', approvedPolicy: true },
    { verdictKind: 'agree', questionGroup: 'growth', approvedPolicy: true, insufficientEvidence: true },
    { verdictKind: 'agree', questionGroup: 'purpose' },
    { verdictKind: 'agree', questionGroup: 'purpose', approvedPolicy: true },
    { verdictKind: 'agree', questionGroup: 'autonomy', afterCutoff: true },
    { verdictKind: 'agree', questionGroup: 'autonomy', afterCutoff: true, missedEnqueue: true },
    { verdictKind: 'agree', questionGroup: 'autonomy', afterCutoff: true,
      missedEnqueue: true, lateApiReceipt: true },
    { verdictKind: 'agree', questionGroup: 'autonomy', afterCutoff: true, lostMessageJob: true },
    { verdictKind: 'unrelated', questionGroup: 'autonomy', afterCutoff: true, receiptRetryUnavailable: true },
    { verdictKind: 'agree', questionGroup: 'autonomy', deliveryEnqueuedThenError: true },
    { verdictKind: 'agree', questionGroup: 'autonomy', concurrentThird: true },
    { verdictKind: 'agree', questionGroup: 'autonomy', afterVerdictBeforeOutboundError: true },
    { verdictKind: 'partial', questionGroup: 'autonomy', afterVerdictBeforeOutboundError: true },
    { verdictKind: 'decline', questionGroup: 'autonomy', afterVerdictBeforeOutboundError: true },
    { verdictKind: 'reject', questionGroup: 'autonomy', afterVerdictBeforeOutboundError: true },
    { verdictKind: 'partial', questionGroup: 'autonomy', clarificationBeforeOutboundError: true },
  ] as const)(
    'captures $questionGroup questions, resolves $verdictKind, and cleans up analytical copies approvedPolicy=$approvedPolicy insufficientEvidence=$insufficientEvidence afterCutoff=$afterCutoff missedEnqueue=$missedEnqueue lateApiReceipt=$lateApiReceipt lostMessageJob=$lostMessageJob receiptRetryUnavailable=$receiptRetryUnavailable deliveryEnqueuedThenError=$deliveryEnqueuedThenError concurrentThird=$concurrentThird afterVerdictBeforeOutboundError=$afterVerdictBeforeOutboundError clarificationBeforeOutboundError=$clarificationBeforeOutboundError',
    async (scenario) => {
    const { verdictKind, questionGroup } = scenario;
    const approvedPolicy = 'approvedPolicy' in scenario && scenario.approvedPolicy === true;
    const insufficientEvidence = 'insufficientEvidence' in scenario
      && scenario.insufficientEvidence === true;
    const afterCutoff = 'afterCutoff' in scenario && scenario.afterCutoff === true;
    const missedEnqueue = 'missedEnqueue' in scenario && scenario.missedEnqueue === true;
    const lateApiReceipt = 'lateApiReceipt' in scenario && scenario.lateApiReceipt === true;
    const lostMessageJob = 'lostMessageJob' in scenario && scenario.lostMessageJob === true;
    const receiptRetryUnavailable = 'receiptRetryUnavailable' in scenario
      && scenario.receiptRetryUnavailable === true;
    const deliveryEnqueuedThenError = 'deliveryEnqueuedThenError' in scenario
      && scenario.deliveryEnqueuedThenError === true;
    const concurrentThird = 'concurrentThird' in scenario && scenario.concurrentThird === true;
    const afterVerdictBeforeOutboundError = 'afterVerdictBeforeOutboundError' in scenario
      && scenario.afterVerdictBeforeOutboundError === true;
    const clarificationBeforeOutboundError = 'clarificationBeforeOutboundError' in scenario
      && scenario.clarificationBeforeOutboundError === true;
    if (!client || !redisUrl) return;
    const db = client.db;
    const [tenant] = await db.insert(tenants).values({ name: `V2 queue fixture ${randomUUID()}` }).returning();
    const tenantId = tenant!.id;
    tenantIds.push(tenantId);
    const [user] = await db.insert(users).values({
      tenantId, preferredName: 'Sam', timezone: 'UTC', locale: 'en',
    }).returning();
    const userId = user!.id;
    const [otherUser] = await db.insert(users).values({
      tenantId, preferredName: 'Other', timezone: 'UTC', locale: 'en',
    }).returning();
    const [definition] = await db.insert(surveyDefinitions).values({
      tenantId, name: 'Synthetic V2 queue fixture',
      version: approvedPolicy ? 'v2-policy-1.0.0' : `fixture-${randomUUID()}`,
    }).returning();
    const topicMap = approvedPolicy
      ? Object.fromEntries(Object.entries(approvedRubrics).map(([key, rubric]) => [key, rubric.questionGroup]))
      : LEGACY_V2_QUESTION_GROUP_BY_STABLE_KEY;
    const questions = await db.insert(surveyQuestions).values(
      Object.entries(topicMap).map(([stableKey, questionGroup], index) => ({
        surveyDefinitionId: definition!.id, stableKey,
        title: approvedPolicy ? approvedRubrics[stableKey]!.title : stableKey,
        canonicalMeaning: approvedPolicy ? approvedRubrics[stableKey]!.canonicalMeaning : `Synthetic ${stableKey}`,
        dimension: questionGroup, questionGroup,
        version: approvedPolicy ? approvedRubrics[stableKey]!.version : 'v2', displayOrder: index,
      })),
    ).returning();
    const rubric = { version: 'synthetic-queue-v1', instructions: 'Synthetic test only.', anchors: [
      { score: 0, description: 'Low' }, { score: 100, description: 'High' },
    ] };
    const [policy] = await db.insert(surveyScoringPolicies).values({
      tenantId, version: approvedPolicy ? '1.0.0' : 'synthetic-queue-v1',
      rubrics: approvedPolicy ? approvedRubrics
        : Object.fromEntries(questions.map((question) => [question.stableKey, rubric])),
      approvedAt: new Date(),
    }).returning();
    const now = Date.now();
    const [window] = await db.insert(surveyWindows).values({
      tenantId, userId, surveyDefinitionId: definition!.id,
      periodStart: new Date(now - 86_400_000),
      periodEnd: new Date(now + (verdictKind === 'partial_unrelated' || afterCutoff ? 8_000 : 86_400_000)),
    }).returning();
    await db.insert(surveyWindowScoringPolicies).values({
      surveyWindowId: window!.id, tenantId, scoringPolicyId: policy!.id,
    });
    await db.insert(pulseBacklog).values(questions.map((question, index) => ({
      surveyWindowId: window!.id, tenantId, userId, surveyQuestionId: question.id,
      position: index + 1,
    })));
    const externalConversationId = `queue-${randomUUID()}`;
    const [conversation] = await db.insert(conversations).values({
      tenantId, userId, channelType: 'dev', externalConversationId,
    }).returning();
    const conversationId = conversation!.id;
    await db.insert(messages).values({
      tenantId, userId, conversationId, direction: 'outbound', senderType: 'agent',
      text: 'Your reflections can be used in aggregated reporting.',
      metadata: { reportingDisclosureVersion: 'reporting-disclosure-v1' },
      occurredAt: new Date(now - 120_000), sentAt: new Date(now - 119_000),
    });
    const examples = approvedPolicy ? {
      autonomy: {
        inbound: 'I choose my methods, my ideas influence decisions, and I know what results are expected.',
        statements: ['You choose how to do your work.', 'Your ideas influence decisions.',
          'You understand the expected results.'],
      },
      belonging: {
        inbound: 'I feel included, I can raise concerns safely, and my manager helps with blockers.',
        statements: ['You feel included in the team.', 'You feel safe raising concerns.',
          'Your manager helps with work blockers.'],
      },
      growth: {
        inbound: 'My work builds useful skills, feedback helps me improve, and I can access future opportunities.',
        statements: ['Your work builds useful skills.', 'Feedback helps you improve.',
          'You can access future growth opportunities.'],
      },
      purpose: {
        inbound: 'My work matters to me, I see its contribution, and my good work is noticed.',
        statements: ['Your work feels meaningful.', 'You see how it contributes to others.',
          'Your good work is noticed.'],
      },
    }[questionGroup] : {
      autonomy: {
        inbound: 'I choose methods, set priorities, and can raise concerns.',
        statements: ['You can choose methods.', 'You set priorities.', 'You can raise concerns.'],
      },
      belonging: {
        inbound: 'I feel welcome, my supervisor checks in, and I can speak safely.',
        statements: ['You feel welcome.', 'Your supervisor checks in.', 'You can speak safely.'],
      },
      growth: {
        inbound: 'My role is clear, I learn new skills, and we discuss progress.',
        statements: ['Your role is clear.', 'You learn new skills.', 'You discuss progress.'],
      },
      purpose: {
        inbound: 'My work is recognized, meaningful, and helps the organization.',
        statements: ['Your work is recognized.', 'Your work feels meaningful.',
          'Your work helps the organization.'],
      },
    }[questionGroup];
    const [firstInbound] = await db.insert(messages).values({
      tenantId, userId, conversationId, direction: 'inbound', senderType: 'user',
      text: examples.inbound,
      occurredAt: new Date(now - 60_000),
    }).returning();
    const statements: string[] = [...examples.statements];
    const groupQuestions = questions.filter((question) => question.questionGroup === questionGroup)
      .sort((a, b) => a.displayOrder - b.displayOrder);
    const repo = new ConversationRepository(transactionDb!);
    let failBeforeOutboundForMessageId: string | null = null;
    let preOutboundFailures = 0;
    const persistMessage = repo.saveMessage.bind(repo);
    vi.spyOn(repo, 'saveMessage').mockImplementation(async (params) => {
      if (params.metadata?.['sourceInboundMessageId'] === failBeforeOutboundForMessageId
        && preOutboundFailures === 0) {
        preOutboundFailures += 1;
        throw new Error('synthetic_post_verdict_pre_outbound_failure');
      }
      return persistMessage(params);
    });
    const questionRepo = new QuestionInsightRepository(transactionDb!, {
      findCurrentHierarchyIdentifiers: async () => [],
    } as never);
    if (approvedPolicy) {
      expect(questions).toHaveLength(12);
      expect(policy!.version).toBe('1.0.0');
      expect(await questionRepo.getWindowMode({ tenantId, userId, surveyWindowId: window!.id }))
        .toBe('v2');
    }
    const surveyEvidenceRepo = new SurveyRepository(transactionDb!, {} as never, {
      findTeamByMemberId: async () => null,
    } as never);
    const bundleText = `I hear that ${statements.join(' ')} Is that fair?`;
    const ai = {
      classifySituation: vi.fn(async (turns: Array<{ content: string }>) => ({
        primaryIntent: 'casual_conversation', secondaryIntents: [], emotionalState: [],
        urgency: 'low', confidence: 0.9, surveyAllowed: true, requiresSafetyCheck: false,
        reasoningSummary: 'synthetic', reminderRequest: null,
        dialogueAct: turns.at(-1)?.content.startsWith('Yes') ? 'acknowledgement' : 'new_substance',
        latestUserSubstance: turns.at(-1)?.content ?? '', topicAnchor: null,
      })),
      composeQuestionBundle: vi.fn(async () => ({
        text: bundleText,
        statements: groupQuestions.map((question, index) => ({
          surveyQuestionId: question.id, statement: statements[index],
        })),
      })),
      interpretQuestionBundleResponse: vi.fn(async () => verdictKind === 'partial'
        || verdictKind === 'partial_unrelated' || verdictKind === 'decline'
        ? { kind: 'partial' as const,
          acceptedQuestionIds: [groupQuestions[0]!.id, groupQuestions[2]!.id],
          disputedQuestionIds: verdictKind === 'partial' || verdictKind === 'partial_unrelated'
            ? [groupQuestions[1]!.id] : [],
          declinedQuestionIds: verdictKind === 'decline' ? [groupQuestions[1]!.id] : [] }
        : { kind: verdictKind }),
      composeQuestionClarification: vi.fn(async () => 'What would you change about your priorities?'),
      interpretQuestionClarificationResponse: vi.fn(async (turns: Array<{ content: string }>) =>
        turns.at(-1)?.content === 'What is the weather like?'
          ? { kind: 'unrelated' as const }
          : { kind: 'clarified' as const,
            correctedSummary: 'Urgent work can override your planned priorities.' }),
      evaluateSurveyEvidence: vi.fn(async (turns: Array<{ content: string }>) => ({
        candidateQuestionIds: groupQuestions.map((question) => question.id),
        voluntaryReopenQuestionIds: turns.at(-1)?.content === 'I changed my mind; let us discuss priorities.'
          ? [groupQuestions[1]!.id] : [],
        evidence: turns.some((turn) => turn.content === firstInbound!.text)
          && !turns.some((turn) => turn.content.startsWith('Could you reflect')
            || turn.content.startsWith('Yes'))
          ? groupQuestions.map((question, index) => ({
            questionId: question.id, evidenceSummary: statements[index],
            polarity: 'positive' as const, strength: 0.9, completeness: 1,
            confidence: 0.9, followUpProbeNeeded: false, thresholdReached: true,
            assessmentShouldRemainUnknown: false,
          })) : [],
      })),
      generateResponse: vi.fn(async () => ({
        text: 'Thanks for confirming.', confidence: 0.9, containsSurveyProbe: false,
      })),
    };
    const surveyRepo = {
      findAwaitingConfirmationGroups: async () => [],
      findPendingConfirmationGroups: async () => [],
    };
    const featureFlags = {
      isEnabled: async (flag: string) => flag === FEATURE_FLAGS.CONVERSATIONAL_SURVEY,
    };
    const redis = new URL(redisUrl);
    const connection = {
      host: redis.hostname, port: Number(redis.port) || 6379, db: 15,
      maxRetriesPerRequest: null,
    };
    const conversationQueue = new Queue(`v2-conversation-${randomUUID()}`, { connection });
    const messageQueue = new Queue(`v2-message-send-${randomUUID()}`, { connection });
    const evidenceQueue = new Queue<SurveyEvidencePayload>(`v2-survey-evidence-${randomUUID()}`, { connection });
    const conversationEvents = new QueueEvents(conversationQueue.name, { connection });
    const messageEvents = new QueueEvents(messageQueue.name, { connection });
    const evidenceEvents = new QueueEvents(evidenceQueue.name, { connection });
    const sentJobs: Job[] = [];
    const evidenceJobs: Job<SurveyEvidencePayload>[] = [];
    const profileHydrationJobs: Array<{ inboundMessageId?: string }> = [];
    const followUpJobs: Array<{ scheduledActionId: string; dueAt: Date }> = [];
    let failAfterReplyEnqueue = false;
    let failBeforeReplyEnqueue = false;
    const outbox = {
      enqueueMessageSend: async (payload: {
        messageId: string; tenantId: string; conversationId: string;
        channelType: string; externalWorkspaceId: string; externalChannelId: string;
      }) => {
        if (failBeforeReplyEnqueue) {
          failBeforeReplyEnqueue = false;
          throw new Error('synthetic_redis_send_enqueue_failure');
        }
        const jobId = `message-send-${payload.messageId}`;
        const sentJob = await messageQueue.add('send', {
          messageId: payload.messageId, tenantId: payload.tenantId,
          conversationId: payload.conversationId, channelType: payload.channelType,
          externalWorkspaceId: payload.externalWorkspaceId,
          externalChannelId: payload.externalChannelId,
        }, { jobId });
        if (!sentJobs.some((job) => job.id === sentJob.id)) sentJobs.push(sentJob);
        if (failAfterReplyEnqueue && sentJobs.length === 3) {
          failAfterReplyEnqueue = false;
          throw new Error('synthetic_post_enqueue_failure');
        }
      },
      enqueueMemoryExtraction: async () => undefined,
      enqueueStyleAnalysis: async () => undefined,
      enqueueSurveyEvidence: async (payload: SurveyEvidencePayload) => {
        const jobId = `survey-evidence-${payload.inboundMessageId}`;
        const evidenceJob = await evidenceQueue.add('evaluate', payload, { jobId });
        if (!evidenceJobs.some((job) => job.id === evidenceJob.id)) evidenceJobs.push(evidenceJob);
      },
      enqueueProfileHydration: async (payload: { inboundMessageId?: string }) => {
        profileHydrationJobs.push(payload);
      },
      enqueueFollowUpExecution: async (payload: { scheduledActionId: string; dueAt: Date }) => {
        followUpJobs.push(payload);
      },
    };
    const orchestrator = new ConversationOrchestrator(
      repo, ai as never, outbox as never, undefined, surveyRepo as never,
      undefined, undefined, featureFlags, undefined, undefined, undefined, undefined,
      questionRepo,
      { run: (callback) => transactionDb!.withTransaction(callback) },
    );
    let failReceiptForMessageId: string | null = null;
    let receiptFailures = 0;
    const markProcessed = repo.markInboundConversationJobProcessed.bind(repo);
    vi.spyOn(repo, 'markInboundConversationJobProcessed').mockImplementation(async (input) => {
      if (input.messageId === failReceiptForMessageId && receiptFailures === 0) {
        receiptFailures += 1;
        throw new Error('synthetic_receipt_write_failed');
      }
      await markProcessed(input);
    });
    const conversationProcessor = new ConversationProcessor(
      orchestrator, {} as never, { record: async () => undefined } as never,
      transactionDb!, repo, surveyEvidenceRepo, conversationQueue,
    );
    const messageProcessor = new MessageSendProcessor(
      {} as never, repo, { activateDeliveredConfirmation: async () => undefined } as never,
      questionRepo,
    );
    const scoreConfirmedMeaning = vi.fn(async ({ questionId }: { questionId: string }) => ({
        outcome: insufficientEvidence && questionId === groupQuestions[1]!.id
          ? 'insufficient_evidence' as const : 'scored' as const,
        score: insufficientEvidence && questionId === groupQuestions[1]!.id ? null : 63,
        confidence: 0.8, modelId: 'synthetic-model',
        promptVersion: 'synthetic-prompt', direction: 'favorable' as const,
        severity: 'low' as const,
        rootCauseCategory: groupQuestions.find((question) => question.id === questionId)?.stableKey
          === 'purpose_recognition' ? 'recognition' as const : questionGroup,
    }));
    const finalizer = new FinalizeQuestionInsightUseCase(questionRepo, {
      scoreConfirmedMeaning,
    }, { deidentify: async () => 'Generalized work experience is favorable.' });
    const selectReportInputs = (reportKind: 'intermediate' | 'final' = 'intermediate',
      reportNow = new Date()) => new SelectQuestionInsightInputsUseCase(questionRepo).execute({
      tenantId, userId, surveyWindowId: window!.id,
      surveyDefinitionId: definition!.id, questionGroup,
      requiredQuestionIds: groupQuestions.map((question) => question.id),
      reportKind, now: reportNow,
    });
    const evidenceProcessor = new SurveyEvidenceProcessor(
      new SurveyEvidenceExtractionUseCase(ai as never, repo, surveyEvidenceRepo, undefined, questionRepo),
      finalizer,
    );
    let conversationWorker: Worker | undefined;
    let messageWorker: Worker | undefined;
    let evidenceWorker: Worker | undefined;
    try {
      await Promise.all([conversationEvents.waitUntilReady(), messageEvents.waitUntilReady(),
        evidenceEvents.waitUntilReady()]);
      conversationWorker = new Worker(conversationQueue.name,
        (job) => conversationProcessor.process(job), { connection, concurrency: 2 });
      messageWorker = new Worker(messageQueue.name,
        (job) => messageProcessor.process(job), { connection });
      evidenceWorker = new Worker(evidenceQueue.name,
        (job) => evidenceProcessor.process(job), { connection });
      const forgedEvidence = await evidenceQueue.add('evaluate', {
        conversationId, userId: otherUser!.id, tenantId,
        inboundMessageId: firstInbound!.id, traceId: 'v2-forged-owner',
      });
      await expect(forgedEvidence.waitUntilFinished(evidenceEvents, 10_000))
        .rejects.toThrow('survey_evidence_processing_failed');
      expect(ai.evaluateSurveyEvidence).not.toHaveBeenCalled();
      expect(scoreConfirmedMeaning).not.toHaveBeenCalled();
      const jobData = (messageId: string, traceId: string): ConversationJob => ({
        requestId: randomUUID(), eventId: randomUUID(), messageId, conversationId,
        userId, tenantId, externalWorkspaceId: 'synthetic-dev-workspace',
        externalConversationId, traceId,
      });
      const admit = async (messageId: string, queuedAt: Date | null = new Date()) => {
        await db.insert(conversationJobAdmissions).values({
          messageId, tenantId, userId, conversationId,
          externalWorkspaceId: 'synthetic-dev-workspace', externalConversationId,
          eventId: randomUUID(), requestId: randomUUID(), traceId: randomUUID(), queuedAt,
        });
      };
      await admit(firstInbound!.id);
      const forgedConversation = await conversationQueue.add('process', {
        ...jobData(firstInbound!.id, 'v2-forged-conversation-owner'), userId: otherUser!.id,
      }, { attempts: 1 });
      await expect(forgedConversation.waitUntilFinished(conversationEvents, 10_000))
        .rejects.toThrow('conversation_job_admission_scope_mismatch');
      expect(ai.classifySituation).not.toHaveBeenCalled();
      const firstJob = await conversationQueue.add('process', jobData(firstInbound!.id, 'v2-capture-first'));
      await firstJob.waitUntilFinished(conversationEvents, 10_000);
      expect(sentJobs).toHaveLength(1);
      expect(await db.select().from(conversationTurnEffects)
        .where(eq(conversationTurnEffects.inboundMessageId, firstInbound!.id))).toHaveLength(1);
      const firstIntents = await db.select().from(conversationDispatchIntents)
        .where(eq(conversationDispatchIntents.inboundMessageId, firstInbound!.id));
      expect(firstIntents).toHaveLength(2);
      expect(firstIntents).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'message_send', targetId: sentJobs[0]!.data.messageId,
          lastQueuedAt: expect.any(Date) }),
        expect.objectContaining({ kind: 'survey_evidence', targetId: firstInbound!.id,
          lastQueuedAt: expect.any(Date) }),
      ]));
      await sentJobs[0]!.waitUntilFinished(messageEvents, 10_000);
      expect(ai.composeQuestionBundle).not.toHaveBeenCalled();
      expect(evidenceJobs).toHaveLength(1);
      await evidenceJobs[0]!.waitUntilFinished(evidenceEvents, 10_000);
      const captured = await db.select().from(surveyQuestionWorkingInsights)
        .where(eq(surveyQuestionWorkingInsights.surveyWindowId, window!.id));
      expect(captured).toHaveLength(3);
      expect(captured.map((row) => row.workingSummary)).toEqual(expect.arrayContaining(statements));
      expect(captured.every((row) => row.readyForConfirmation
        && row.sourceMessageIds.includes(firstInbound!.id))).toBe(true);
      expect(await db.select().from(surveyEvidence)
        .where(eq(surveyEvidence.surveyWindowId, window!.id))).toHaveLength(0);
      expect(await db.select().from(surveyAssessments)
        .where(eq(surveyAssessments.surveyWindowId, window!.id))).toHaveLength(0);
      await evidenceWorker.close();
      evidenceWorker = undefined;

      const [firstReply] = await db.select().from(messages)
        .where(eq(messages.id, sentJobs[0]!.data.messageId));
      const [secondInbound] = await db.insert(messages).values({
        tenantId, userId, conversationId, direction: 'inbound', senderType: 'user',
        text: 'Could you reflect that back to me?',
        occurredAt: new Date(firstReply!.sentAt!.getTime() + 1_000),
      }).returning();
      await admit(secondInbound!.id);
      const secondJob = await conversationQueue.add('process', jobData(secondInbound!.id, 'v2-bundle-second'));
      await secondJob.waitUntilFinished(conversationEvents, 10_000);
      expect(sentJobs).toHaveLength(2);
      await sentJobs[1]!.waitUntilFinished(messageEvents, 10_000);
      expect(JSON.stringify(sentJobs[1]!.data)).not.toContain(bundleText);
      const [bundle] = await db.select().from(surveyQuestionConfirmationBundles)
        .where(eq(surveyQuestionConfirmationBundles.surveyWindowId, window!.id));
      expect(bundle).toMatchObject({ status: 'awaiting_confirmation', displayedText: bundleText });
      expect(ai.composeQuestionBundle).toHaveBeenCalledOnce();

      const [deliveredPrompt] = await db.select().from(messages)
        .where(eq(messages.id, bundle!.promptMessageId!));
      const [thirdInbound] = await db.insert(messages).values({
        tenantId, userId, conversationId, direction: 'inbound', senderType: 'user',
        text: verdictKind === 'partial' || verdictKind === 'partial_unrelated'
          || verdictKind === 'decline'
          ? verdictKind === 'partial' || verdictKind === 'partial_unrelated'
            ? 'The methods and concerns points are right, but priorities can be overridden by urgent work.'
            : 'The methods and concerns points are right, but please skip the priorities point.'
          : verdictKind === 'reject' ? 'No, none of those points are right.' : 'Yes, that is right.',
        occurredAt: new Date(deliveredPrompt!.sentAt!.getTime() + 1_000),
        receivedAt: lateApiReceipt
          ? new Date(window!.periodEnd.getTime() + 1_000) : new Date(),
      }).returning();
      await admit(thirdInbound!.id, missedEnqueue ? null : new Date());
      if (missedEnqueue || receiptRetryUnavailable) {
        if (missedEnqueue) {
          expect(await conversationQueue.getJob(`conversation-${thirdInbound!.id}`)).toBeUndefined();
        }
      }
      if (afterCutoff) {
        await new Promise((resolve) => setTimeout(resolve,
          Math.max(0, window!.periodEnd.getTime() - Date.now() + 25)));
        expect(await surveyEvidenceRepo.expireTemporaryQuestionInsightsForClosedWindows({
          tenantId, now: new Date(),
        })).toBe(0);
        const [heldBundle] = await db.select().from(surveyQuestionConfirmationBundles)
          .where(eq(surveyQuestionConfirmationBundles.id, bundle!.id));
        expect(heldBundle).toMatchObject({
          status: 'awaiting_confirmation', displayedText: bundleText,
        });
      }
      if (afterCutoff && !missedEnqueue && !lostMessageJob) failReceiptForMessageId = thirdInbound!.id;
      if (deliveryEnqueuedThenError) failAfterReplyEnqueue = true;
      if (lostMessageJob) failBeforeReplyEnqueue = true;
      if (afterVerdictBeforeOutboundError) failBeforeOutboundForMessageId = thirdInbound!.id;
      if (afterVerdictBeforeOutboundError && verdictKind === 'agree') {
        await expect(db.insert(surveyQuestionVerdictReceipts).values({
          inboundMessageId: thirdInbound!.id,
          tenantId, userId: otherUser!.id, conversationId,
          questionGroup, verdictKind: 'agree', bundleId: bundle!.id,
        })).rejects.toThrow('survey_question_verdict_receipt_scope_mismatch');
      }
      if (receiptRetryUnavailable) await conversationWorker.pause();
      if (missedEnqueue) {
        const cutoffProcessor = new QuestionCutoffProcessor(
          new ExpireQuestionInsightsAtCutoffUseCase(surveyEvidenceRepo),
          new RecoverConfirmedQuestionInsightsUseCase(questionRepo, finalizer),
          {} as never, surveyEvidenceRepo, conversationQueue,
        );
        await cutoffProcessor.process({ name: 'cutoff' } as Job);
        const [admission] = await db.select({ queuedAt: conversationJobAdmissions.queuedAt })
          .from(conversationJobAdmissions)
          .where(eq(conversationJobAdmissions.messageId, thirdInbound!.id));
        expect(admission?.queuedAt).toBeInstanceOf(Date);
      }
      const thirdJob = missedEnqueue
        ? await conversationQueue.getJob(`conversation-${thirdInbound!.id}`)
        : await conversationQueue.add('process', jobData(thirdInbound!.id, 'v2-bundle-verdict'),
          receiptRetryUnavailable ? { jobId: `conversation-${thirdInbound!.id}` }
            : lostMessageJob ? { attempts: 1 }
            : deliveryEnqueuedThenError || afterVerdictBeforeOutboundError
              ? { attempts: 2, backoff: { type: 'fixed', delay: 100 } }
              : undefined);
      const concurrentJob = concurrentThird
        ? await conversationQueue.add('process', jobData(thirdInbound!.id, 'v2-concurrent-verdict'))
        : null;
      expect(thirdJob).toBeDefined();
      const receiptEnqueueFailure = receiptRetryUnavailable
        ? vi.spyOn(conversationQueue, 'add').mockRejectedValueOnce(new Error('synthetic_redis_failure'))
        : null;
      if (receiptRetryUnavailable) await conversationWorker.resume();
      if (lostMessageJob) {
        await expect(thirdJob!.waitUntilFinished(conversationEvents, 10_000))
          .rejects.toThrow('conversation_processing_failed');
        expect(await db.select().from(conversationTurnEffects)
          .where(eq(conversationTurnEffects.inboundMessageId, thirdInbound!.id))).toHaveLength(1);
        expect(await db.select().from(conversationJobReceipts)
          .where(eq(conversationJobReceipts.messageId, thirdInbound!.id))).toHaveLength(0);
        expect((await surveyEvidenceRepo.findQueuedTimelyQuestionRepliesWithoutReceipt(new Date()))
          .map((reply) => reply.messageId)).toContain(thirdInbound!.id);
        const cutoffProcessor = new QuestionCutoffProcessor(
          new ExpireQuestionInsightsAtCutoffUseCase(surveyEvidenceRepo),
          new RecoverConfirmedQuestionInsightsUseCase(questionRepo, finalizer),
          {} as never, surveyEvidenceRepo, conversationQueue, repo, messageQueue,
        );
        await cutoffProcessor.process({ name: 'cutoff' } as Job);
        const processJobs = await conversationQueue.getJobs(['waiting', 'active', 'completed']);
        const recoveredProcess = processJobs.find((candidate) =>
          candidate.id?.startsWith(`conversation-recovery-${thirdInbound!.id}-`));
        expect(recoveredProcess).toBeDefined();
        await recoveredProcess!.waitUntilFinished(conversationEvents, 10_000);
        const [effect] = await db.select().from(conversationTurnEffects)
          .where(eq(conversationTurnEffects.inboundMessageId, thirdInbound!.id));
        const sendJobs = await messageQueue.getJobs(['waiting', 'active', 'completed']);
        const recoveredSend = sendJobs.find((candidate) =>
          candidate.id?.startsWith(`message-send-recovery-${effect!.outboundMessageId}-`));
        expect(recoveredSend).toBeDefined();
        await recoveredSend!.waitUntilFinished(messageEvents, 10_000);
        expect(await db.select().from(conversationJobReceipts)
          .where(eq(conversationJobReceipts.messageId, thirdInbound!.id))).toHaveLength(1);
        expect(ai.interpretQuestionBundleResponse).toHaveBeenCalledOnce();
        expect(await db.select().from(surveyQuestionVerdictReceipts)
          .where(eq(surveyQuestionVerdictReceipts.inboundMessageId, thirdInbound!.id))).toHaveLength(1);
        const [outbound] = await db.select().from(messages)
          .where(eq(messages.id, effect!.outboundMessageId));
        expect(outbound?.sentAt).toBeInstanceOf(Date);
        expect(await db.select().from(conversationMessageSendAttempts)
          .where(eq(conversationMessageSendAttempts.outboundMessageId, effect!.outboundMessageId)))
          .toHaveLength(1);
        expect(await repo.findCommittedAdmissionsWithUnqueuedDispatches(new Date()))
          .toEqual([]);
        await db.insert(conversationDispatchIntents).values({
          inboundMessageId: firstInbound!.id, kind: 'profile_hydration',
          targetId: firstInbound!.id,
          availableAt: new Date(Date.now() - 120_000),
          createdAt: new Date(Date.now() - 120_000),
        });
        expect((await repo.findCommittedAdmissionsWithUnqueuedDispatches(new Date()))
          .map((admission) => admission.messageId)).toContain(firstInbound!.id);
        await cutoffProcessor.process({ name: 'cutoff' } as Job);
        const committedJobs = await conversationQueue.getJobs(['waiting', 'active', 'completed']);
        const profileRecovery = committedJobs.find((candidate) =>
          candidate.id?.startsWith(`conversation-recovery-${firstInbound!.id}-`));
        expect(profileRecovery).toBeDefined();
        await profileRecovery!.waitUntilFinished(conversationEvents, 10_000);
        expect(profileHydrationJobs.filter((payload) => payload.inboundMessageId === firstInbound!.id))
          .toHaveLength(1);
        const dueAt = new Date(Date.now() + 3_600_000);
        const [action] = await db.insert(scheduledActions).values({
          tenantId, userId, conversationId, type: 'user_reminder',
          intent: 'send the report', context: {}, dueAt, timezone: 'UTC',
          status: 'pending', sourceMessageIds: [secondInbound!.id],
        }).returning();
        await db.insert(conversationDispatchIntents).values({
          inboundMessageId: secondInbound!.id, kind: 'follow_up_execution',
          targetId: action!.id, availableAt: new Date(Date.now() - 120_000),
          createdAt: new Date(Date.now() - 120_000),
        });
        expect(await repo.findUnqueuedCommittedFollowUps({
          inboundMessageId: secondInbound!.id, tenantId, userId, conversationId,
        })).toEqual([{ scheduledActionId: action!.id, dueAt }]);
        await cutoffProcessor.process({ name: 'cutoff' } as Job);
        const reminderRecovery = (await conversationQueue.getJobs(['waiting', 'active', 'completed']))
          .find((candidate) => candidate.id?.startsWith(`conversation-recovery-${secondInbound!.id}-`));
        expect(reminderRecovery).toBeDefined();
        await reminderRecovery!.waitUntilFinished(conversationEvents, 10_000);
        expect(followUpJobs.filter((payload) => payload.scheduledActionId === action!.id))
          .toHaveLength(1);
        expect(await repo.findUnqueuedCommittedFollowUps({
          inboundMessageId: secondInbound!.id, tenantId, userId, conversationId,
        })).toEqual([]);
        const [purgedBundle] = await db.select().from(surveyQuestionConfirmationBundles)
          .where(eq(surveyQuestionConfirmationBundles.id, bundle!.id));
        expect(purgedBundle!.displayedText).toBeNull();
        return;
      }
      await thirdJob!.waitUntilFinished(conversationEvents, 10_000);
      if (concurrentJob) await concurrentJob.waitUntilFinished(conversationEvents, 10_000);
      receiptEnqueueFailure?.mockRestore();
      if (concurrentThird) {
        expect(sentJobs).toHaveLength(3);
        expect(await db.select().from(conversationTurnEffects)
          .where(eq(conversationTurnEffects.inboundMessageId, thirdInbound!.id))).toHaveLength(1);
        expect(await db.select().from(conversationDispatchIntents)
          .where(eq(conversationDispatchIntents.inboundMessageId, thirdInbound!.id))).toHaveLength(2);
      }
      if (afterVerdictBeforeOutboundError) {
        expect(preOutboundFailures).toBe(1);
        expect((await conversationQueue.getJob(thirdJob!.id!))?.attemptsMade).toBe(2);
        expect(ai.interpretQuestionBundleResponse).toHaveBeenCalledTimes(2);
        expect(sentJobs).toHaveLength(3);
        await sentJobs[2]!.waitUntilFinished(messageEvents, 10_000);
        const verdictReceipts = await db.select().from(surveyQuestionVerdictReceipts)
          .where(eq(surveyQuestionVerdictReceipts.inboundMessageId, thirdInbound!.id));
        expect(verdictReceipts).toHaveLength(1);
        expect(verdictReceipts[0]).toMatchObject({
          verdictKind: verdictKind === 'decline' ? 'partial' : verdictKind,
          tenantId, userId, conversationId,
        });
        if (verdictKind === 'agree') {
          await expect(db.update(surveyQuestionVerdictReceipts).set({ questionGroup: 'growth' })
            .where(eq(surveyQuestionVerdictReceipts.inboundMessageId, thirdInbound!.id)))
            .rejects.toThrow('survey_question_verdict_receipt_immutable');
          await expect(db.delete(surveyQuestionVerdictReceipts)
            .where(eq(surveyQuestionVerdictReceipts.inboundMessageId, thirdInbound!.id)))
            .rejects.toThrow('survey_question_verdict_receipt_immutable');
        }
        expect(await db.select().from(conversationJobReceipts)
          .where(eq(conversationJobReceipts.messageId, thirdInbound!.id))).toHaveLength(1);
        return;
      }
      if (deliveryEnqueuedThenError) {
        expect((await conversationQueue.getJob(thirdJob!.id!))?.attemptsMade).toBe(2);
        expect(ai.interpretQuestionBundleResponse).toHaveBeenCalledOnce();
        expect(sentJobs).toHaveLength(3);
        await Promise.all(sentJobs.slice(2).map((job) => job.waitUntilFinished(messageEvents, 10_000)));
        const delivered = await db.select().from(messages).where(eq(messages.conversationId, conversationId));
        expect(new Set(sentJobs.slice(2).map((job) => job.data.messageId)).size).toBe(1);
        expect(delivered.filter((message) => message.id === sentJobs[2]!.data.messageId
          && message.direction === 'outbound' && message.sentAt)).toHaveLength(1);
        expect(await db.select().from(conversationTurnEffects)
          .where(eq(conversationTurnEffects.inboundMessageId, thirdInbound!.id))).toHaveLength(1);
        const thirdIntents = await db.select().from(conversationDispatchIntents)
          .where(eq(conversationDispatchIntents.inboundMessageId, thirdInbound!.id));
        expect(thirdIntents).toHaveLength(2);
        expect(thirdIntents).toEqual(expect.arrayContaining([
          expect.objectContaining({ kind: 'message_send', targetId: sentJobs[2]!.data.messageId,
            lastQueuedAt: expect.any(Date) }),
          expect.objectContaining({ kind: 'survey_evidence', targetId: thirdInbound!.id,
            lastQueuedAt: expect.any(Date) }),
        ]));
        expect(JSON.stringify(thirdIntents)).not.toContain(examples.inbound);
        expect(await db.select().from(conversationJobReceipts)
          .where(eq(conversationJobReceipts.messageId, thirdInbound!.id))).toHaveLength(1);
        expect(ai.interpretQuestionBundleResponse).toHaveBeenCalledOnce();
        return;
      }
      if (receiptRetryUnavailable) {
        expect(receiptFailures).toBe(1);
        expect(await db.select().from(conversationJobReceipts)
          .where(eq(conversationJobReceipts.messageId, thirdInbound!.id))).toHaveLength(0);
        expect((await conversationQueue.getJob(thirdJob!.id!))?.attemptsMade).toBe(1);
        const cutoffProcessor = new QuestionCutoffProcessor(
          new ExpireQuestionInsightsAtCutoffUseCase(surveyEvidenceRepo),
          new RecoverConfirmedQuestionInsightsUseCase(questionRepo, finalizer),
          {} as never, surveyEvidenceRepo, conversationQueue,
        );
        await cutoffProcessor.process({ name: 'cutoff' } as Job);
        const receiptJob = await conversationQueue.getJob(`receipt-${thirdInbound!.id}`);
        expect(receiptJob?.name).toBe('receipt-retry');
        await receiptJob!.waitUntilFinished(conversationEvents, 10_000);
        expect(await db.select().from(conversationJobReceipts)
          .where(eq(conversationJobReceipts.messageId, thirdInbound!.id))).toHaveLength(1);
        expect(sentJobs).toHaveLength(3);
        await sentJobs[2]!.waitUntilFinished(messageEvents, 10_000);
        expect(ai.interpretQuestionBundleResponse).toHaveBeenCalledOnce();
        const expired = await db.select().from(surveyQuestionWorkingInsights)
          .where(eq(surveyQuestionWorkingInsights.surveyWindowId, window!.id));
        expect(expired).toHaveLength(3);
        expect(expired.every((row) => row.status === 'no_data' && row.workingSummary === null))
          .toBe(true);
        return;
      }
      if (afterCutoff && !missedEnqueue && !receiptRetryUnavailable) {
        expect(receiptFailures).toBe(1);
        const receiptJob = await conversationQueue.getJob(`receipt-${thirdInbound!.id}`);
        expect(receiptJob?.name).toBe('receipt-retry');
        await receiptJob!.waitUntilFinished(conversationEvents, 10_000);
        expect((await conversationQueue.getJob(thirdJob!.id!))?.attemptsMade).toBe(1);
      }
      expect(sentJobs).toHaveLength(3);
      await sentJobs[2]!.waitUntilFinished(messageEvents, 10_000);
      if (concurrentThird) {
        expect(ai.interpretQuestionBundleResponse.mock.calls.length).toBeGreaterThanOrEqual(1);
        expect(ai.interpretQuestionBundleResponse.mock.calls.length).toBeLessThanOrEqual(2);
      } else {
        expect(ai.interpretQuestionBundleResponse).toHaveBeenCalledOnce();
      }
      const afterVerdict = await db.select().from(surveyQuestionWorkingInsights)
        .where(eq(surveyQuestionWorkingInsights.surveyWindowId, window!.id));
      expect(afterVerdict).toHaveLength(3);
      const statusByQuestion = new Map(afterVerdict.map((row) => [row.surveyQuestionId, row.status]));
      expect(groupQuestions.map((question) => statusByQuestion.get(question.id))).toEqual(
        verdictKind === 'partial' || verdictKind === 'partial_unrelated'
          ? ['confirmed', 'pending_clarification', 'confirmed']
          : verdictKind === 'decline' ? ['confirmed', 'declined', 'confirmed']
          : verdictKind === 'reject' ? ['reset', 'reset', 'reset']
            : ['confirmed', 'confirmed', 'confirmed'],
      );
      if (verdictKind === 'partial' || verdictKind === 'partial_unrelated') {
        expect(ai.composeQuestionClarification).toHaveBeenCalledOnce();
        const [partialBundle] = await db.select().from(surveyQuestionConfirmationBundles)
          .where(eq(surveyQuestionConfirmationBundles.id, bundle!.id));
        expect(JSON.stringify(partialBundle?.components)).toContain(statements[1]);
        expect(JSON.stringify(partialBundle?.components)).not.toContain(statements[0]);
        expect(JSON.stringify(partialBundle?.components)).not.toContain(statements[2]);
      }
      if (verdictKind === 'decline') {
        const declined = afterVerdict.find((row) => row.surveyQuestionId === groupQuestions[1]!.id)!;
        expect(declined).toMatchObject({
          workingSummary: null, confirmedSemanticSummary: null, sourceMessageIds: [],
        });
        expect(declined.purgedAt).not.toBeNull();
        const [backlog] = await db.select().from(pulseBacklog)
          .where(eq(pulseBacklog.surveyQuestionId, groupQuestions[1]!.id));
        expect(backlog).toMatchObject({ status: 'done', resultedInCoverage: false });
      }

      expect(evidenceJobs).toHaveLength(3);
      evidenceWorker = new Worker(evidenceQueue.name,
        (job) => evidenceProcessor.process(job), { connection });
      await Promise.all(evidenceJobs.slice(1).map((job) => job.waitUntilFinished(evidenceEvents, 10_000)));
      if (verdictKind === 'reject') {
        expect(await db.select().from(surveyQuestionInsights)
          .where(eq(surveyQuestionInsights.surveyWindowId, window!.id))).toHaveLength(0);
        expect(scoreConfirmedMeaning).not.toHaveBeenCalled();
        expect(await selectReportInputs()).toEqual({
          intermediateEligible: false, intermediateQuestions: [], finalQuestions: [], questionTrends: [],
        });
        expect(afterVerdict.every((row) => row.workingSummary === null
          && row.confirmedSemanticSummary === null && row.sourceMessageIds.length === 0
          && row.purgedAt !== null)).toBe(true);
        const [rejectedBundle] = await db.select().from(surveyQuestionConfirmationBundles)
          .where(eq(surveyQuestionConfirmationBundles.id, bundle!.id));
        expect(rejectedBundle).toMatchObject({
          status: 'rejected', displayedText: null, components: null,
        });
        expect(rejectedBundle?.purgedAt).not.toBeNull();
        const backlog = await db.select().from(pulseBacklog)
          .where(eq(pulseBacklog.surveyWindowId, window!.id));
        expect(groupQuestions.map((question) => backlog.find((row) =>
          row.surveyQuestionId === question.id)?.status)).toEqual(['pending', 'pending', 'pending']);
        expect(await db.select().from(messages).where(eq(messages.id, firstInbound!.id)))
          .toHaveLength(1);
        expect(await db.select().from(messages).where(eq(messages.id, bundle!.promptMessageId!)))
          .toHaveLength(1);
        return;
      }
      if (verdictKind === 'partial' || verdictKind === 'partial_unrelated') {
        const interimRows = await db.select().from(surveyQuestionInsights)
          .where(eq(surveyQuestionInsights.surveyWindowId, window!.id));
        expect(interimRows).toHaveLength(2);
        const [clarificationPrompt] = await db.select().from(messages)
          .where(eq(messages.id, sentJobs[2]!.data.messageId));
        const [fourthInbound] = await db.insert(messages).values({
          tenantId, userId, conversationId, direction: 'inbound', senderType: 'user',
          text: verdictKind === 'partial_unrelated'
            ? 'What is the weather like?'
            : 'Urgent work sometimes overrides the priorities I planned.',
          occurredAt: new Date(clarificationPrompt!.sentAt!.getTime() + 1_000),
        }).returning();
        await admit(fourthInbound!.id);
        if (clarificationBeforeOutboundError) failBeforeOutboundForMessageId = fourthInbound!.id;
        const fourthJob = await conversationQueue.add('process', jobData(fourthInbound!.id, 'v2-clarified'),
          clarificationBeforeOutboundError ? { attempts: 2, backoff: { type: 'fixed', delay: 100 } } : undefined);
        await fourthJob.waitUntilFinished(conversationEvents, 10_000);
        if (clarificationBeforeOutboundError) {
          expect(preOutboundFailures).toBe(1);
          expect((await conversationQueue.getJob(fourthJob.id!))?.attemptsMade).toBe(2);
          expect(await db.select().from(surveyQuestionVerdictReceipts)
            .where(eq(surveyQuestionVerdictReceipts.inboundMessageId, fourthInbound!.id)))
            .toHaveLength(1);
        }
        expect(sentJobs).toHaveLength(4);
        await sentJobs[3]!.waitUntilFinished(messageEvents, 10_000);
        expect(ai.interpretQuestionClarificationResponse)
          .toHaveBeenCalledTimes(clarificationBeforeOutboundError ? 2 : 1);
        expect(evidenceJobs).toHaveLength(4);
        await evidenceJobs[3]!.waitUntilFinished(evidenceEvents, 10_000);
        if (verdictKind === 'partial_unrelated') {
          const [stillPending] = await db.select().from(surveyQuestionWorkingInsights)
            .where(eq(surveyQuestionWorkingInsights.surveyQuestionId, groupQuestions[1]!.id));
          expect(stillPending).toMatchObject({ status: 'pending_clarification' });
          expect(stillPending.confirmedSemanticSummary).toBeNull();
          expect(await db.select().from(surveyQuestionInsights)
            .where(eq(surveyQuestionInsights.surveyWindowId, window!.id))).toHaveLength(2);
          expect(scoreConfirmedMeaning).toHaveBeenCalledTimes(2);
          const [pendingBundle] = await db.select().from(surveyQuestionConfirmationBundles)
            .where(eq(surveyQuestionConfirmationBundles.id, bundle!.id));
          expect(JSON.stringify(pendingBundle?.components)).toContain(statements[1]);
          expect(await db.select().from(messages).where(eq(messages.id, bundle!.promptMessageId!)))
            .toHaveLength(1);
          await new Promise((resolve) => setTimeout(resolve,
            Math.max(0, window!.periodEnd.getTime() - Date.now() + 25)));
          const cutoffQueue = new Queue(`v2-cutoff-${randomUUID()}`, { connection });
          const cutoffEvents = new QueueEvents(cutoffQueue.name, { connection });
          let cutoffWorker: Worker | undefined;
          try {
            await cutoffEvents.waitUntilReady();
            const cutoffProcessor = new QuestionCutoffProcessor(
              new ExpireQuestionInsightsAtCutoffUseCase(surveyEvidenceRepo),
              new RecoverConfirmedQuestionInsightsUseCase(questionRepo, finalizer),
              cutoffQueue,
              { findUndispatchedTimelyQuestionReplies: async () => [],
                findQueuedTimelyQuestionRepliesWithoutReceipt: async () => [] } as never,
              {} as never,
            );
            cutoffWorker = new Worker(cutoffQueue.name,
              (job) => cutoffProcessor.process(job), { connection });
            const cutoffJob = await cutoffQueue.add('cutoff', {});
            await cutoffJob.waitUntilFinished(cutoffEvents, 10_000);
            const [expired] = await db.select().from(surveyQuestionWorkingInsights)
              .where(eq(surveyQuestionWorkingInsights.surveyQuestionId, groupQuestions[1]!.id));
            expect(expired).toMatchObject({
              status: 'no_data', workingSummary: null, confirmedSemanticSummary: null,
              sourceMessageIds: [],
            });
            expect(expired.purgedAt).not.toBeNull();
            const [expiredBundle] = await db.select().from(surveyQuestionConfirmationBundles)
              .where(eq(surveyQuestionConfirmationBundles.id, bundle!.id));
            expect(expiredBundle).toMatchObject({
              status: 'purged', displayedText: null, components: null,
            });
            expect(await db.select().from(surveyQuestionInsights)
              .where(eq(surveyQuestionInsights.surveyWindowId, window!.id))).toHaveLength(2);
            expect(scoreConfirmedMeaning).toHaveBeenCalledTimes(2);
            const reportInputs = await selectReportInputs('final',
              new Date(window!.periodEnd.getTime() + 1));
            expect(reportInputs.intermediateEligible).toBe(false);
            expect(reportInputs.intermediateQuestions).toEqual([]);
            expect(reportInputs.finalQuestions.map((row) => row.questionId)).toEqual([
              groupQuestions[0]!.id, groupQuestions[2]!.id,
            ]);
            expect(reportInputs.questionTrends).toHaveLength(2);
            expect(reportInputs).not.toHaveProperty('indexScore');
            expect(await db.select().from(messages).where(eq(messages.id, firstInbound!.id)))
              .toHaveLength(1);
          } finally {
            await cutoffWorker?.close();
            await cutoffEvents.close();
            await cutoffQueue.obliterate({ force: true });
            await cutoffQueue.close();
          }
          return;
        }
      }
      const finalRows = await db.select().from(surveyQuestionInsights)
        .where(eq(surveyQuestionInsights.surveyWindowId, window!.id));
      expect(finalRows).toHaveLength(verdictKind === 'decline' ? 2 : 3);
      expect(finalRows.filter((row) => row.outcome === 'scored')
        .map((row) => ({ questionId: row.surveyQuestionId, score: Number(row.score) }))
        .sort((left, right) => left.questionId.localeCompare(right.questionId)))
        .toEqual(groupQuestions.filter((question) => verdictKind !== 'decline'
          || question.id !== groupQuestions[1]!.id)
          .filter((question) => !insufficientEvidence || question.id !== groupQuestions[1]!.id)
          .map((question) => ({ questionId: question.id, score: 63 }))
          .sort((left, right) => left.questionId.localeCompare(right.questionId)));
      if (insufficientEvidence) {
        const unscored = finalRows.find((row) => row.surveyQuestionId === groupQuestions[1]!.id);
        expect(unscored).toMatchObject({ outcome: 'insufficient_evidence', score: null });
        expect(unscored!.deidentifiedSummary).not.toBe('');
      }
      if (approvedPolicy) expect(finalRows.every((row) => row.scoringPolicyVersion === '1.0.0'
        && row.questionRubricVersion === '1.0.0')).toBe(true);
      if (approvedPolicy && questionGroup === 'purpose') {
        expect(finalRows.filter((row) => row.rootCauseCategory === 'recognition')).toHaveLength(1);
      }
      expect(scoreConfirmedMeaning).toHaveBeenCalledTimes(verdictKind === 'decline' ? 2 : 3);
      const reportInputs = afterCutoff
        ? await selectReportInputs('final', new Date(window!.periodEnd.getTime() + 1))
        : await selectReportInputs();
      expect(reportInputs.intermediateEligible).toBe(verdictKind !== 'decline' && !insufficientEvidence);
      expect(reportInputs.finalQuestions.map((row) => row.questionId)).toEqual(
        afterCutoff ? groupQuestions.map((question) => question.id) : []);
      expect(reportInputs.intermediateQuestions.map((row) => row.questionId)).toEqual(
        verdictKind === 'decline' || afterCutoff || insufficientEvidence
          ? [] : groupQuestions.map((question) => question.id));
      expect(reportInputs.questionTrends).toHaveLength(verdictKind === 'decline' || insufficientEvidence
        ? 0 : 3);
      expect(reportInputs).not.toHaveProperty('indexScore');
      if (insufficientEvidence) {
        const finalInputs = await selectReportInputs('final', new Date(window!.periodEnd.getTime() + 1));
        expect(finalInputs.finalQuestions).toHaveLength(3);
        expect(finalInputs.finalQuestions.find((row) => row.questionId === groupQuestions[1]!.id))
          .toMatchObject({ outcome: 'insufficient_evidence', score: null });
        expect(finalInputs.questionTrends).toHaveLength(2);
        expect(finalInputs).not.toHaveProperty('indexScore');
      }
      if (verdictKind === 'decline') {
        const [declineReply] = await db.select().from(messages)
          .where(eq(messages.id, sentJobs[2]!.data.messageId));
        const [reopenInbound] = await db.insert(messages).values({
          tenantId, userId, conversationId, direction: 'inbound', senderType: 'user',
          text: 'I changed my mind; let us discuss priorities.',
          occurredAt: new Date(declineReply!.sentAt!.getTime() + 1_000),
        }).returning();
        await admit(reopenInbound!.id);
        const reopenJob = await conversationQueue.add('process', jobData(reopenInbound!.id, 'v2-reopen'));
        await reopenJob.waitUntilFinished(conversationEvents, 10_000);
        expect(evidenceJobs).toHaveLength(4);
        await evidenceJobs[3]!.waitUntilFinished(evidenceEvents, 10_000);
        const [reopened] = await db.select().from(surveyQuestionWorkingInsights)
          .where(eq(surveyQuestionWorkingInsights.surveyQuestionId, groupQuestions[1]!.id));
        expect(reopened).toMatchObject({ status: 'reset', workingSummary: null });
        const [reopenedBacklog] = await db.select().from(pulseBacklog)
          .where(eq(pulseBacklog.surveyQuestionId, groupQuestions[1]!.id));
        expect(reopenedBacklog).toMatchObject({ status: 'pending', doneAt: null });
        expect(await db.select().from(surveyQuestionInsights)
          .where(eq(surveyQuestionInsights.surveyWindowId, window!.id))).toHaveLength(2);
        expect(scoreConfirmedMeaning).toHaveBeenCalledTimes(2);
      }
      const purged = await db.select().from(surveyQuestionWorkingInsights)
        .where(eq(surveyQuestionWorkingInsights.surveyWindowId, window!.id));
      expect(purged.every((row) => row.workingSummary === null
        && row.confirmedSemanticSummary === null && row.sourceMessageIds.length === 0)).toBe(true);
      const [purgedBundle] = await db.select().from(surveyQuestionConfirmationBundles)
        .where(eq(surveyQuestionConfirmationBundles.id, bundle!.id));
      expect(purgedBundle).toMatchObject({
        status: 'purged', displayedText: null, components: null,
      });
      expect(await db.select().from(messages).where(eq(messages.id, firstInbound!.id)))
        .toHaveLength(1);
      expect(await db.select().from(messages).where(eq(messages.id, bundle!.promptMessageId!)))
        .toHaveLength(1);
    } finally {
      await conversationWorker?.close();
      await messageWorker?.close();
      await evidenceWorker?.close();
      await conversationEvents.close();
      await messageEvents.close();
      await evidenceEvents.close();
      await conversationQueue.obliterate({ force: true });
      await messageQueue.obliterate({ force: true });
      await evidenceQueue.obliterate({ force: true });
      await conversationQueue.close();
      await messageQueue.close();
      await evidenceQueue.close();
    }
  }, 30_000);

  it('processes a queued source after twenty newer messages without reading future turns', async () => {
    if (!client || !redisUrl) return;
    const db = client.db;
    const [tenant] = await db.insert(tenants).values({ name: `Delayed queue ${randomUUID()}` }).returning();
    tenantIds.push(tenant!.id);
    const [user] = await db.insert(users).values({ tenantId: tenant!.id }).returning();
    const [conversation] = await db.insert(conversations).values({
      tenantId: tenant!.id, userId: user!.id, channelType: 'dev', externalConversationId: randomUUID(),
    }).returning();
    const start = Date.now() - 120_000;
    const [source] = await db.insert(messages).values({
      tenantId: tenant!.id, userId: user!.id, conversationId: conversation!.id,
      direction: 'inbound', senderType: 'user', text: 'I can choose my methods.',
      occurredAt: new Date(start),
    }).returning();
    await db.insert(messages).values(Array.from({ length: 20 }, (_, index) => ({
      tenantId: tenant!.id, userId: user!.id, conversationId: conversation!.id,
      direction: 'inbound' as const, senderType: 'user' as const,
      text: `Newer turn ${index}`, occurredAt: new Date(start + (index + 1) * 1_000),
    })));
    const conversationRepo = new ConversationRepository({ client: db } as never);
    expect((await conversationRepo.findRecentMessages(conversation!.id, 15)).some((m) => m.id === source!.id))
      .toBe(false);
    const questionId = randomUUID();
    const windowId = randomUUID();
    const ai = { evaluateSurveyEvidence: vi.fn(async () => ({
      evidence: [{ questionId, evidenceSummary: 'Methods can be chosen.',
        polarity: 'positive', strength: 0.9, completeness: 1, confidence: 0.9,
        assessmentShouldRemainUnknown: false }],
    })) };
    const surveyRepo = {
      findOrCreateActiveWindow: async () => ({
        id: windowId, tenantId: tenant!.id, userId: user!.id,
        periodStart: new Date(start - 86_400_000), periodEnd: new Date(start + 86_400_000),
      }),
      findQuestionsForWindow: async () => [{
        id: questionId, stableKey: 'q12_expectations', questionGroup: 'autonomy',
        canonicalMeaning: 'Choice of methods', responseType: 'open_ended', version: 'v2',
      }],
      findAssessmentsForWindow: async () => [],
    };
    const captureMeaning = vi.fn(async () => 'captured');
    const questionCapture = { getWindowMode: async () => 'v2', captureMeaning };
    const useCase = new SurveyEvidenceExtractionUseCase(
      ai as never, conversationRepo, surveyRepo as never, undefined, questionCapture as never,
    );
    const processor = new SurveyEvidenceProcessor(useCase, { executePending: async () => 0 } as never);
    const redis = new URL(redisUrl);
    const connection = { host: redis.hostname, port: Number(redis.port) || 6379, db: 15,
      maxRetriesPerRequest: null };
    const queue = new Queue<SurveyEvidencePayload>(`v2-delayed-source-${randomUUID()}`, { connection });
    const events = new QueueEvents(queue.name, { connection });
    let worker: Worker | undefined;
    try {
      await events.waitUntilReady();
      const job = await queue.add('evaluate', {
        conversationId: conversation!.id, userId: user!.id, tenantId: tenant!.id,
        inboundMessageId: source!.id, traceId: 'v2-delayed-source',
      });
      worker = new Worker(queue.name, (queuedJob) => processor.process(queuedJob), { connection });
      await job.waitUntilFinished(events, 10_000);
      expect(ai.evaluateSurveyEvidence).toHaveBeenCalledWith(
        [{ role: 'user', content: source!.text, timestamp: source!.occurredAt }],
        expect.anything(), { focusLatestEmployeeMessage: true },
      );
      expect(captureMeaning).toHaveBeenCalledWith(expect.objectContaining({
        sourceMessageId: source!.id, meaning: 'Methods can be chosen.',
      }));
    } finally {
      await worker?.close();
      await events.close();
      await queue.obliterate({ force: true });
      await queue.close();
    }
  }, 20_000);
});
