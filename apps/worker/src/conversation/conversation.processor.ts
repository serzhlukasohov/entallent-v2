import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, OnApplicationShutdown } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Job } from 'bullmq';
import { and, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { detect as detectLanguage } from 'tinyld';
import {
  AGENT_RUNTIME_PORT,
  FEATURE_FLAGS,
  ProactiveCheckInUseCase,
  RUNTIME_CONTROL_FLAGS,
  PulseBacklogService,
  buildReplyPlan,
} from '@entalent/application';
import type { AgentRuntimePort, ConversationTurn, ProactivePulseConfig } from '@entalent/application';
import type { RuntimeContext, SituationClassification } from '@entalent/contracts';
import { conversations, memoryItems, messages, tenants, userStyleProfiles, users } from '@entalent/database';
import { QUEUE_NAMES } from '../queue/queue.module';
import { AiService } from './ai.service';
import { LlmRunRepository } from './llm-run.repository';
import { DatabaseService } from '../database/database.service';
import { FeatureFlagRepository } from '../feature-flags/feature-flag.repository';
import { RuntimeControlFlagRepository } from '../feature-flags/runtime-control-flag.repository';

export type ConversationJob = {
  requestId: string;
  eventId: string;
  messageId: string;
  conversationId: string;
  userId: string;
  tenantId: string;
  externalWorkspaceId: string;
  externalConversationId: string;
  traceId: string;
};

export type CheckInJob = Omit<ConversationJob, 'requestId' | 'eventId' | 'messageId'>;

const DEFAULT_PULSE_CONFIG: ProactivePulseConfig = { engagementUnlockDays: 14, ignoreWindowHours: 48 };
const MAF_MEMORY_CONTEXT_LIMIT = 12;

@Processor(QUEUE_NAMES.CONVERSATION)
export class ConversationProcessor extends WorkerHost implements OnApplicationShutdown {
  private readonly logger = new Logger(ConversationProcessor.name);

  constructor(
    @Inject(AGENT_RUNTIME_PORT)
    private readonly agentRuntime: AgentRuntimePort,
    private readonly checkInUseCase: ProactiveCheckInUseCase,
    private readonly pulseBacklogService: PulseBacklogService,
    private readonly runtimeControls: RuntimeControlFlagRepository,
    private readonly featureFlags: FeatureFlagRepository,
    private readonly ai: AiService,
    private readonly llmRunRepo: LlmRunRepository,
    private readonly db: DatabaseService,
  ) {
    super();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker.close();
  }

  async process(job: Job<ConversationJob | CheckInJob>): Promise<void> {
    if (job.name === 'check-in') {
      await this.processCheckIn(job as Job<CheckInJob>);
      return;
    }
    await this.processInbound(job as Job<ConversationJob>);
  }

  private async processCheckIn(job: Job<CheckInJob>): Promise<void> {
    this.logger.log(`Processing check-in job ${job.id}`, {
      conversationId: job.data.conversationId,
    });

    try {
      // Load tenant policy to pass pulse cadence config to the use case
      const [tenantRow] = await this.db.client
        .select({ policy: tenants.proactiveMessagingPolicy })
        .from(tenants)
        .where(eq(tenants.id, job.data.tenantId))
        .limit(1);

      const policy = (tenantRow?.policy ?? {}) as Record<string, unknown>;
      const testQuestionGroup = normalizeOptionalString(process.env.PULSE_TEST_QUESTION_GROUP);
      const pulseConfig: ProactivePulseConfig = {
        engagementUnlockDays:
          typeof policy['engagementUnlockDays'] === 'number'
            ? policy['engagementUnlockDays']
            : DEFAULT_PULSE_CONFIG.engagementUnlockDays,
        ignoreWindowHours:
          typeof policy['ignoreWindowHours'] === 'number'
            ? policy['ignoreWindowHours']
            : DEFAULT_PULSE_CONFIG.ignoreWindowHours,
        ...(testQuestionGroup ? { questionGroup: testQuestionGroup } : {}),
      };

      if (await this.shouldUseMafForCheckIn(job.data)) {
        const result = await this.processMafCheckIn(job, pulseConfig);
        this.logger.log(
          `Check-in job ${job.id} done via MAF — text="${result.responseText.slice(0, 60)}"`,
        );
        return;
      }

      const result = await this.checkInUseCase.execute({ ...job.data, pulseConfig });
      this.logger.log(
        `Check-in job ${job.id} done — probe=${result.probeQuestionId ?? 'none'} text="${result.responseText.slice(0, 60)}"`,
      );
    } catch (err) {
      this.logger.error(`Check-in job ${job.id} failed: ${(err as Error).message}`, (err as Error).stack);
      throw err;
    }
  }

  private async shouldUseMafForCheckIn(job: CheckInJob): Promise<boolean> {
    const context = {
      tenantId: job.tenantId,
      userId: job.userId,
      externalWorkspaceId: job.externalWorkspaceId,
    };

    if (await this.runtimeControls.isEnabled(RUNTIME_CONTROL_FLAGS.MAF_RUNTIME_DISABLED, context)) {
      return false;
    }
    if (await this.runtimeControls.isUserDenylisted(context)) {
      return false;
    }
    return this.runtimeControls.isEnabled(RUNTIME_CONTROL_FLAGS.MAF_RUNTIME_PRIMARY, context);
  }

  private async processMafCheckIn(
    job: Job<CheckInJob>,
    pulseConfig: ProactivePulseConfig,
  ): Promise<Awaited<ReturnType<AgentRuntimePort['processMessage']>>> {
    const requestId = randomUUID();
    const eventId = randomUUID();
    const messageId = randomUUID();
    const now = new Date();
    const surveyEnabled = await this.featureFlags.isEnabled(FEATURE_FLAGS.CONVERSATIONAL_SURVEY, {
      tenantId: job.data.tenantId,
      userId: job.data.userId,
    });
    const probeResult = surveyEnabled ? await this.selectOptionalProbeQuestion(job, pulseConfig) : null;

    const mafCandidateContext = await this.loadProactiveMafCandidateContext(job.data, {
      messageId,
      messageCreatedAt: now,
      probeQuestion: probeResult?.question ?? null,
    });
    await this.persistProactiveRuntimeRequestMessage(job.data, {
      messageId,
      text: mafCandidateContext.messageText ?? 'Start a proactive pulse check-in.',
      occurredAt: now,
      userLocale: normalizeOptionalString(mafCandidateContext.userLocale),
      probeQuestion: probeResult?.question
        ? {
            id: probeResult.question.id,
            stableKey: probeResult.question.stableKey,
            title: probeResult.question.title,
            questionGroup: probeResult.question.questionGroup,
          }
        : null,
    });

    const result = await this.agentRuntime.processMessage({
      requestId,
      eventId,
      runtimeAttempt: runtimeAttemptNumberFromJob(job),
      requestPurpose: 'proactive_check_in',
      messageId,
      conversationId: job.data.conversationId,
      userId: job.data.userId,
      tenantId: job.data.tenantId,
      externalWorkspaceId: job.data.externalWorkspaceId,
      externalConversationId: job.data.externalConversationId,
      traceId: job.data.traceId,
      ...mafCandidateContext,
    });

    if (
      probeResult &&
      result.replyMetadata?.containsSurveyProbe === true &&
      result.replyMetadata.surveyProbeQuestionId === probeResult.question.id
    ) {
      try {
        await this.pulseBacklogService.recordProbeSent(
          job.data.userId,
          probeResult.windowId,
          probeResult.question.id,
          now,
        );
      } catch (err) {
        this.logger.warn(
          `Check-in job ${job.id} committed MAF reply but failed to record probe sent: ${(err as Error).message}`,
        );
      }
    }

    return result;
  }

  private async persistProactiveRuntimeRequestMessage(
    job: CheckInJob,
    request: {
      messageId: string;
      text: string;
      occurredAt: Date;
      userLocale?: string;
      probeQuestion: {
        id: string;
        stableKey: string;
        title: string;
        questionGroup: string;
      } | null;
    },
  ): Promise<void> {
    await this.db.client.insert(messages).values({
      id: request.messageId,
      tenantId: job.tenantId,
      conversationId: job.conversationId,
      userId: job.userId,
      direction: 'inbound',
      senderType: 'system',
      text: request.text,
      normalizedText: request.text.toLowerCase(),
      messageType: 'proactive_check_in_request',
      metadata: {
        runtimePurpose: 'proactive_check_in',
        synthetic: true,
        hiddenFromConversationContext: true,
        ...(request.userLocale ? { userLocale: request.userLocale } : {}),
        ...(request.probeQuestion
          ? {
              surveyProbeQuestionId: request.probeQuestion.id,
              surveyProbeStableKey: request.probeQuestion.stableKey,
              surveyProbeTitle: request.probeQuestion.title,
              surveyProbeQuestionGroup: request.probeQuestion.questionGroup,
            }
          : {}),
      },
      occurredAt: request.occurredAt,
      receivedAt: request.occurredAt,
      traceId: job.traceId,
      deletedAt: request.occurredAt,
    });
  }

  private async selectOptionalProbeQuestion(
    job: Job<CheckInJob>,
    pulseConfig: ProactivePulseConfig,
  ): Promise<Awaited<ReturnType<PulseBacklogService['getNextProbeQuestion']>>> {
    try {
      return await this.pulseBacklogService.getNextProbeQuestion(
        job.data.userId,
        job.data.tenantId,
        pulseConfig,
      );
    } catch (err) {
      this.logger.warn(
        `Check-in job ${job.id} could not load optional pulse probe: ${(err as Error).message}`,
      );
      return null;
    }
  }

  private async processInbound(job: Job<ConversationJob>): Promise<void> {
    this.logger.log(`Processing conversation job ${job.id}`, {
      messageId: job.data.messageId,
      conversationId: job.data.conversationId,
    });

    const start = Date.now();
    let status: 'success' | 'error' = 'success';

    try {
      const mafCandidateContext = await this.loadMafCandidateContext(job.data);
      const result = await this.agentRuntime.processMessage({
        requestId: job.data.requestId,
        eventId: normalizeMafRuntimeEventId(job.data.eventId, job.data.requestId),
        runtimeAttempt: runtimeAttemptNumberFromJob(job),
        messageId: job.data.messageId,
        conversationId: job.data.conversationId,
        userId: job.data.userId,
        tenantId: job.data.tenantId,
        externalWorkspaceId: job.data.externalWorkspaceId,
        externalConversationId: job.data.externalConversationId,
        traceId: job.data.traceId,
        ...mafCandidateContext,
      });

      this.logger.log(
        `Job ${job.id} done — mode=${result.mode} intent=${result.classification.primaryIntent} risk=${result.risk.severity}`,
      );
    } catch (err) {
      status = 'error';
      this.logger.error(`Job ${job.id} failed (attempt ${job.attemptsMade}): ${(err as Error).message}`, (err as Error).stack);
      throw err;
    } finally {
      await this.llmRunRepo
        .record({
          tenantId: job.data.tenantId,
          userId: job.data.userId,
          taskType: 'conversation',
          model: 'gpt-4o',
          latencyMs: Date.now() - start,
          status,
          traceId: job.data.traceId,
        })
        .catch(() => {
          /* non-critical */
        });
    }
  }

  private async loadMafCandidateContext(
    job: ConversationJob,
  ): Promise<Partial<Parameters<AgentRuntimePort['processMessage']>[0]>> {
    try {
      const [currentMessage] = await this.db.client
        .select({
          text: messages.text,
          occurredAt: messages.occurredAt,
          externalThreadId: messages.externalThreadId,
          userPreferredName: users.preferredName,
          userTimezone: users.timezone,
          userLocale: users.locale,
          styleDimensions: userStyleProfiles.dimensions,
          stylePhrases: userStyleProfiles.phrases,
          styleAdaptationWeight: userStyleProfiles.adaptationWeight,
        })
        .from(messages)
        .leftJoin(users, and(eq(users.id, messages.userId), eq(users.tenantId, messages.tenantId)))
        .leftJoin(userStyleProfiles, and(eq(userStyleProfiles.userId, messages.userId), eq(userStyleProfiles.tenantId, messages.tenantId)))
        .where(
          and(
            eq(messages.id, job.messageId),
            eq(messages.tenantId, job.tenantId),
            eq(messages.conversationId, job.conversationId),
            eq(messages.userId, job.userId),
            isNull(messages.deletedAt),
          ),
        )
        .limit(1);

      if (!currentMessage) {
        return {};
      }

      const recentRows = await this.db.client
        .select({
          text: messages.text,
          metadata: messages.metadata,
          senderType: messages.senderType,
          direction: messages.direction,
          occurredAt: messages.occurredAt,
        })
        .from(messages)
        .where(
          and(
            eq(messages.tenantId, job.tenantId),
            eq(messages.conversationId, job.conversationId),
            isNull(messages.deletedAt),
            threadScopePredicate(currentMessage.externalThreadId),
          ),
        )
        .orderBy(desc(messages.occurredAt))
        .limit(8);

      const memoryContextNow = new Date();
      const memoryRows = await this.db.client
        .select({
          id: memoryItems.id,
          tenantId: memoryItems.tenantId,
          userId: memoryItems.userId,
          category: memoryItems.category,
          content: memoryItems.content,
          importance: memoryItems.importance,
          status: memoryItems.status,
          expiresAt: memoryItems.expiresAt,
          supersededById: memoryItems.supersededById,
          createdAt: memoryItems.createdAt,
        })
        .from(memoryItems)
        .where(mafMemoryContextWhere(job, memoryContextNow))
        .orderBy(desc(memoryItems.importance), desc(memoryItems.createdAt), desc(memoryItems.id))
        .limit(MAF_MEMORY_CONTEXT_LIMIT);

      const threadId = normalizeOptionalString(currentMessage.externalThreadId);
      const recentTurns = recentRows
        .slice()
        .reverse()
        .flatMap((row) => toRecentTurn(row));
      const runtimeMemoryItems = toRuntimeMemoryItems(memoryRows, job, memoryContextNow);
      const styleAdaptation = toRuntimeStyleAdaptation(currentMessage);
      const replyContext = await this.buildInboundReplyContext({
        userName: normalizeOptionalString(currentMessage.userPreferredName) ?? 'there',
        timezone: normalizeOptionalString(currentMessage.userTimezone),
        turns: recentTurns,
        memoryItems: runtimeMemoryItems,
        lastReplyAskedQuestion: lastOutboundReplyShapeAskedQuestion(recentRows),
      });

      return {
        messageText: stripSlackConnectorFooter(currentMessage.text),
        messageCreatedAt: toIsoString(currentMessage.occurredAt),
        eventId: normalizeMafRuntimeEventId(job.eventId, job.requestId),
        userDisplayName: normalizeOptionalString(currentMessage.userPreferredName),
        userTimezone: normalizeOptionalString(currentMessage.userTimezone),
        userLocale: resolveEffectiveLocale(normalizeOptionalString(currentMessage.userLocale), recentTurns),
        conversationThreadId: threadId,
        conversationSessionKey: [
          job.externalWorkspaceId,
          job.userId,
          job.externalConversationId,
          threadId ?? 'dm',
        ].join(':'),
        runtimeContext: {
          recentTurns,
          memoryItems: runtimeMemoryItems,
          goals: [],
          ...(styleAdaptation ? { styleAdaptation } : {}),
          ...replyContext,
        },
      };
    } catch {
      return {};
    }
  }

  private async loadProactiveMafCandidateContext(
    job: CheckInJob,
    options: {
      messageId: string;
      messageCreatedAt: Date;
      probeQuestion: {
        id: string;
        stableKey: string;
        title: string;
        questionGroup: string;
        probeStrategies: string[];
      } | null;
    },
  ): Promise<Partial<Parameters<AgentRuntimePort['processMessage']>[0]>> {
    const [conversationRow] = await this.db.client
      .select({
        userPreferredName: users.preferredName,
        userTimezone: users.timezone,
        userLocale: users.locale,
        styleDimensions: userStyleProfiles.dimensions,
        stylePhrases: userStyleProfiles.phrases,
        styleAdaptationWeight: userStyleProfiles.adaptationWeight,
      })
      .from(conversations)
      .leftJoin(users, and(eq(users.id, conversations.userId), eq(users.tenantId, conversations.tenantId)))
      .leftJoin(userStyleProfiles, and(eq(userStyleProfiles.userId, conversations.userId), eq(userStyleProfiles.tenantId, conversations.tenantId)))
      .where(
        and(
          eq(conversations.id, job.conversationId),
          eq(conversations.tenantId, job.tenantId),
          eq(conversations.userId, job.userId),
        ),
      )
      .limit(1);

    if (!conversationRow) {
      throw new Error(`Conversation ${job.conversationId} not found for check-in user ${job.userId}`);
    }

    const recentRows = await this.db.client
      .select({
        text: messages.text,
        metadata: messages.metadata,
        senderType: messages.senderType,
        direction: messages.direction,
        occurredAt: messages.occurredAt,
      })
      .from(messages)
      .where(
          and(
            eq(messages.tenantId, job.tenantId),
            eq(messages.conversationId, job.conversationId),
            eq(messages.userId, job.userId),
            isNull(messages.deletedAt),
          ),
        )
      .orderBy(desc(messages.occurredAt))
      .limit(8);

    const memoryContextNow = new Date();
    const memoryRows = await this.db.client
      .select({
        id: memoryItems.id,
        tenantId: memoryItems.tenantId,
        userId: memoryItems.userId,
        category: memoryItems.category,
        content: memoryItems.content,
        importance: memoryItems.importance,
        status: memoryItems.status,
        expiresAt: memoryItems.expiresAt,
        supersededById: memoryItems.supersededById,
        createdAt: memoryItems.createdAt,
      })
      .from(memoryItems)
      .where(mafMemoryContextWhere(job, memoryContextNow))
      .orderBy(desc(memoryItems.importance), desc(memoryItems.createdAt), desc(memoryItems.id))
      .limit(MAF_MEMORY_CONTEXT_LIMIT);

    const recentTurns = recentRows
      .slice()
      .reverse()
      .flatMap((row) => toRecentTurn(row));
    const effectiveLocale = resolveEffectiveLocale(
      normalizeOptionalString(conversationRow?.userLocale),
      recentTurns,
    );
    const runtimeMemoryItems = toRuntimeMemoryItems(memoryRows, job, memoryContextNow);
    const styleAdaptation = toRuntimeStyleAdaptation(conversationRow);

    return {
      messageText: options.probeQuestion
        ? `Start a proactive pulse check-in about ${options.probeQuestion.title}.`
        : 'Start a proactive pulse check-in.',
      messageCreatedAt: options.messageCreatedAt.toISOString(),
      userDisplayName: normalizeOptionalString(conversationRow?.userPreferredName),
      userTimezone: normalizeOptionalString(conversationRow?.userTimezone),
      userLocale: effectiveLocale,
      conversationSessionKey: [
        job.externalWorkspaceId,
        job.userId,
        job.externalConversationId,
        'dm',
      ].join(':'),
      runtimeContext: {
        recentTurns,
        memoryItems: runtimeMemoryItems,
        goals: [],
        ...(styleAdaptation ? { styleAdaptation } : {}),
        replyPolicy: {
          maxChars: maxReplyChars('short'),
          maxQuestions: 1,
          allowReflectiveOpener: false,
          allowListFormatting: false,
        },
      },
      proactiveContext: {
        reason: 'pulse_check_in',
        ...(options.probeQuestion
          ? {
              probeQuestion: {
                id: options.probeQuestion.id,
                stableKey: options.probeQuestion.stableKey,
                title: options.probeQuestion.title,
                group: options.probeQuestion.questionGroup,
                probeStrategies: options.probeQuestion.probeStrategies,
              },
            }
          : {}),
      },
    };
  }

  private async buildInboundReplyContext(input: {
    userName: string;
    timezone?: string;
    turns: RuntimeContext['recentTurns'];
    memoryItems: RuntimeContext['memoryItems'];
    lastReplyAskedQuestion: boolean;
  }): Promise<Pick<RuntimeContext, 'replyPlan' | 'replyPlanning' | 'replyPolicy'>> {
    try {
      const turns = input.turns.map((turn): ConversationTurn => ({
        role: turn.role,
        content: turn.content,
        timestamp: new Date(turn.timestamp),
      }));
      const classification = await this.ai.classifySituation(turns, {
        userName: input.userName,
        now: new Date().toISOString(),
        timezone: input.timezone,
      });
      const includeFollowUpQuestion = includeFollowUpQuestionFor(classification);
      const replyPlan = buildReplyPlan({
        classification,
        memoryItems: input.memoryItems,
        includeFollowUpQuestion,
        lastReplyAskedQuestion: input.lastReplyAskedQuestion,
        sensitiveMode: isSensitiveClassification(classification),
      });
      const maxQuestions = replyPlan.questionPolicy.maxQuestions;
      const maxChars = maxReplyCharsForReplyPlan(
        replyPlan,
        maxReplyChars(maxResponseLengthFor(classification)),
      );
      return {
        replyPlan,
        replyPolicy: {
          maxChars,
          maxQuestions,
          allowReflectiveOpener: false,
          allowListFormatting: false,
        },
      };
    } catch (err) {
      this.logger.warn(`Failed to build inbound reply plan: ${(err as Error).message}`);
      return {
        replyPlanning: {
          status: 'unavailable',
          reason: 'classifier_failed',
        },
      };
    }
  }
}

export function runtimeAttemptNumberFromJob(job: Pick<Job, 'attemptsMade'>): number {
  return job.attemptsMade + 1;
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

export function resolveEffectiveLocale(
  storedLocale: string | undefined,
  recentTurns: RuntimeContext['recentTurns'],
): string | undefined {
  const recentUserText = recentTurns
    .filter((turn) => turn.role === 'user')
    .slice(-5)
    .map((turn) => turn.content)
    .join('\n');

  const detectedLocale = normalizeOptionalString(detectLanguage(recentUserText));
  if (!detectedLocale || detectedLocale === storedLocale?.split('-')[0]) {
    return storedLocale;
  }
  return detectedLocale;
}

function normalizeMafRuntimeEventId(eventId: string | undefined, fallbackEventId?: string): string | undefined {
  if (eventId && eventIdRegex.test(eventId)) {
    return eventId;
  }

  return fallbackEventId && eventIdRegex.test(fallbackEventId) ? fallbackEventId : undefined;
}

const eventIdRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function threadScopePredicate(externalThreadId: string | null): SQL {
  const threadId = normalizeOptionalString(externalThreadId);
  if (threadId) {
    return eq(messages.externalThreadId, threadId);
  }

  return or(
    isNull(messages.externalThreadId),
    and(
      eq(messages.direction, 'outbound'),
      eq(messages.senderType, 'agent'),
      sql`${messages.externalThreadId} = ${messages.externalMessageId}`,
    ),
  ) ?? isNull(messages.externalThreadId);
}

function mafMemoryContextWhere(job: Pick<ConversationJob, 'tenantId' | 'userId'>, now: Date): SQL {
  return and(
    eq(memoryItems.tenantId, job.tenantId),
    eq(memoryItems.userId, job.userId),
    eq(memoryItems.status, 'active'),
    isNull(memoryItems.supersededById),
    or(isNull(memoryItems.expiresAt), gt(memoryItems.expiresAt, now)),
  ) as SQL;
}

function toRuntimeMemoryItems(rows: Array<{
  id: string;
  tenantId?: string;
  userId?: string;
  category: string;
  content: string;
  importance: string | number;
  status?: string;
  expiresAt?: Date | string | null;
  supersededById?: string | null;
  createdAt?: Date | string;
}>, job: Pick<ConversationJob, 'tenantId' | 'userId'>, now: Date): RuntimeContext['memoryItems'] {
  const nowMs = now.getTime();
  return rows
    .filter((row) => {
      const expiresAtMs = toOptionalMillis(row.expiresAt);
      return (
        row.tenantId === job.tenantId &&
        row.userId === job.userId &&
        row.status === 'active' &&
        !row.supersededById &&
        (expiresAtMs === null || expiresAtMs > nowMs)
      );
    })
    .sort(
      (a, b) =>
        Number(b.importance) - Number(a.importance) ||
        toMillis(b.createdAt) - toMillis(a.createdAt) ||
        b.id.localeCompare(a.id),
    )
    .slice(0, MAF_MEMORY_CONTEXT_LIMIT)
    .map((row) => ({
      id: row.id,
      category: row.category,
      content: row.content,
      importance: Number(row.importance),
    }));
}

function toRuntimeStyleAdaptation(row: {
  styleDimensions?: unknown;
  stylePhrases?: unknown;
  styleAdaptationWeight?: string | number | null;
}): RuntimeContext['styleAdaptation'] | undefined {
  const dimensions = toStyleDimensions(row.styleDimensions);
  if (!dimensions) {
    return undefined;
  }
  const weight = Math.max(0, Math.min(0.4, Number(row.styleAdaptationWeight ?? 0)));
  if (!Number.isFinite(weight) || weight <= 0) {
    return undefined;
  }
  const phrases = Array.isArray(row.stylePhrases)
    ? row.stylePhrases
        .map((phrase) => typeof phrase === 'string' ? phrase : (phrase as { text?: unknown })?.text)
        .filter((text): text is string => typeof text === 'string' && text.trim().length > 0)
        .slice(0, 5)
    : [];
  return { dimensions, weight, phrases };
}

function toStyleDimensions(value: unknown): NonNullable<RuntimeContext['styleAdaptation']>['dimensions'] | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const register = clampStyleDimension(record['register']);
  const humor = clampStyleDimension(record['humor']);
  const verbosity = clampStyleDimension(record['verbosity']);
  const emoji = clampStyleDimension(record['emoji']);
  if (register === null || humor === null || verbosity === null || emoji === null) {
    return undefined;
  }
  return { register, humor, verbosity, emoji };
}

function clampStyleDimension(value: unknown): number | null {
  const dimension = Number(value);
  if (!Number.isFinite(dimension)) {
    return null;
  }
  return Math.max(0, Math.min(1, dimension));
}

function toMillis(value: Date | string | undefined): number {
  return value ? new Date(value).getTime() : 0;
}

function toOptionalMillis(value: Date | string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const millis = new Date(value).getTime();
  return Number.isFinite(millis) ? millis : 0;
}

function toRecentTurn(row: {
  text: string;
  senderType: string;
  direction: string;
  occurredAt: Date | string;
}): Array<{
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}> {
  const content = stripSlackConnectorFooter(row.text);
  if (!content) {
    return [];
  }

  try {
    return [{
      role: row.senderType === 'agent' || row.direction === 'outbound' ? 'assistant' : 'user',
      content,
      timestamp: toIsoString(row.occurredAt),
    }];
  } catch {
    return [];
  }
}

function stripSlackConnectorFooter(text: string): string {
  return text.replace(/\s*\*Sent using\*\s+<@[UW][A-Z0-9]+(?:\|[^>]+)?>\s*$/u, '').trim();
}

function includeFollowUpQuestionFor(classification: SituationClassification): boolean {
  const mode = conversationModeFor(classification);
  return mode === 'coaching' || mode === 'supportive' || mode === 'normal';
}

function conversationModeFor(classification: SituationClassification): string {
  switch (classification.primaryIntent) {
    case 'support':
      return 'supportive';
    case 'coaching':
    case 'goal_setting':
    case 'progress_update':
      return 'coaching';
    case 'survey_opportunity':
      return 'survey_probe';
    case 'potential_crisis':
      return 'crisis';
    case 'burnout_signal':
    case 'harassment_signal':
      return 'sensitive';
    case 'celebration':
      return 'celebration';
    case 'onboarding':
      return 'onboarding';
    case 'casual_conversation':
    default:
      return 'normal';
  }
}

function isSensitiveClassification(classification: SituationClassification): boolean {
  const mode = conversationModeFor(classification);
  return mode === 'sensitive' || mode === 'crisis';
}

function maxResponseLengthFor(classification: SituationClassification): 'short' | 'medium' {
  return classification.urgency === 'high' ? 'short' : 'medium';
}

function maxReplyChars(maxResponseLength: 'short' | 'medium' | 'long'): number {
  if (maxResponseLength === 'short') {
    return 360;
  }
  if (maxResponseLength === 'medium') {
    return 680;
  }
  return 980;
}

function maxReplyCharsForReplyPlan(
  replyPlan: RuntimeContext['replyPlan'],
  defaultMaxChars: number,
): number {
  if (
    replyPlan?.latestUserSubstance === null &&
    replyPlan.mayInferFromBrevity === false &&
    (replyPlan.dialogueAct === 'acknowledgement' ||
      replyPlan.dialogueAct === 'greeting' ||
      replyPlan.dialogueAct === 'social_checkin')
  ) {
    return Math.min(defaultMaxChars, 120);
  }
  return defaultMaxChars;
}

function lastOutboundReplyShapeAskedQuestion(rows: Array<{
  direction: string;
  metadata: unknown;
}>): boolean {
  const lastOutbound = rows.find((row) => row.direction === 'outbound');
  return typedReplyShapeAskedQuestion(lastOutbound?.metadata);
}

function typedReplyShapeAskedQuestion(metadata: unknown): boolean {
  if (typeof metadata !== 'object' || metadata === null) {
    return false;
  }
  const replyShape = (metadata as Record<string, unknown>)['replyShape'];
  if (typeof replyShape !== 'object' || replyShape === null) {
    return false;
  }
  return (replyShape as Record<string, unknown>)['askedQuestion'] === true;
}
