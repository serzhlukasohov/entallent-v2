import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Job } from 'bullmq';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { AGENT_RUNTIME_PORT, ProactiveCheckInUseCase } from '@entalent/application';
import type { AgentRuntimePort, ProactivePulseConfig } from '@entalent/application';
import { memoryItems, messages, tenants, users } from '@entalent/database';
import { QUEUE_NAMES } from '../queue/queue.module';
import { LlmRunRepository } from './llm-run.repository';
import { DatabaseService } from '../database/database.service';

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

@Processor(QUEUE_NAMES.CONVERSATION)
export class ConversationProcessor extends WorkerHost implements OnApplicationShutdown {
  private readonly logger = new Logger(ConversationProcessor.name);

  constructor(
    @Inject(AGENT_RUNTIME_PORT)
    private readonly agentRuntime: AgentRuntimePort,
    private readonly checkInUseCase: ProactiveCheckInUseCase,
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
      const pulseConfig: ProactivePulseConfig = {
        engagementUnlockDays:
          typeof policy['engagementUnlockDays'] === 'number'
            ? policy['engagementUnlockDays']
            : DEFAULT_PULSE_CONFIG.engagementUnlockDays,
        ignoreWindowHours:
          typeof policy['ignoreWindowHours'] === 'number'
            ? policy['ignoreWindowHours']
            : DEFAULT_PULSE_CONFIG.ignoreWindowHours,
      };

      const result = await this.checkInUseCase.execute({ ...job.data, pulseConfig });
      this.logger.log(
        `Check-in job ${job.id} done — probe=${result.probeQuestionId ?? 'none'} text="${result.responseText.slice(0, 60)}"`,
      );
    } catch (err) {
      this.logger.error(`Check-in job ${job.id} failed: ${(err as Error).message}`, (err as Error).stack);
      throw err;
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
        })
        .from(messages)
        .leftJoin(users, and(eq(users.id, messages.userId), eq(users.tenantId, messages.tenantId)))
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

      const memoryRows = await this.db.client
        .select({
          id: memoryItems.id,
          category: memoryItems.category,
          content: memoryItems.content,
          importance: memoryItems.importance,
        })
        .from(memoryItems)
        .where(
          and(
            eq(memoryItems.tenantId, job.tenantId),
            eq(memoryItems.userId, job.userId),
            eq(memoryItems.status, 'active'),
          ),
        )
        .orderBy(desc(memoryItems.importance), desc(memoryItems.createdAt))
        .limit(12);

      const threadId = normalizeOptionalString(currentMessage.externalThreadId);
      return {
        messageText: currentMessage.text,
        messageCreatedAt: toIsoString(currentMessage.occurredAt),
        eventId: normalizeMafRuntimeEventId(job.eventId, job.requestId),
        userDisplayName: normalizeOptionalString(currentMessage.userPreferredName),
        userTimezone: normalizeOptionalString(currentMessage.userTimezone),
        userLocale: normalizeOptionalString(currentMessage.userLocale),
        conversationThreadId: threadId,
        conversationSessionKey: [
          job.externalWorkspaceId,
          job.userId,
          job.externalConversationId,
          threadId ?? 'dm',
        ].join(':'),
        runtimeContext: {
          recentTurns: recentRows
            .slice()
            .reverse()
            .flatMap((row) => toRecentTurn(row)),
          memoryItems: memoryRows.map((row) => ({
            id: row.id,
            category: row.category,
            content: row.content,
            importance: Number(row.importance),
          })),
          goals: [],
        },
      };
    } catch {
      return {};
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
  return threadId ? eq(messages.externalThreadId, threadId) : isNull(messages.externalThreadId);
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
  const content = row.text.trim();
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
