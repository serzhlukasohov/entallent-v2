import { Controller, Post, Get, Body, Param, HttpCode, Logger, Query } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { eq, and, desc, isNull, ne, asc, max as sqlMax } from 'drizzle-orm';
import { IngestionService } from '../channel/ingestion.service';
import { DatabaseService } from '../database/database.service';
import { QUEUE_NAMES } from '../queue/queue.module';
import { messages, memoryItems, scheduledActions, surveyEvidence, surveyWindows, pulseBacklog, surveyQuestions } from '@entalent/database';
import type { ConversationJob, CheckInJob } from '../queue/queue.types';

interface SimulateMessageDto {
  tenantId: string;
  userId?: string;
  userName?: string;
  text: string;
  conversationId?: string;
}

// Only available in development — not imported in production AppModule.
@Controller('dev')
export class DevSimulateController {
  private readonly logger = new Logger(DevSimulateController.name);

  constructor(
    private readonly ingestion: IngestionService,
    private readonly db: DatabaseService,
    @InjectQueue(QUEUE_NAMES.CONVERSATION) private readonly queue: Queue<ConversationJob | CheckInJob>,
    @InjectQueue(QUEUE_NAMES.PROACTIVE_SCAN) private readonly scanQueue: Queue<{ tenantId?: string }>,
  ) {}

  @Post('simulate-message')
  @HttpCode(202)
  async simulate(@Body() body: SimulateMessageDto) {
    const externalUserId = body.userId ?? 'dev-user-1';
    const externalConversationId = body.conversationId ?? `dev-conv-${externalUserId}`;
    const externalWorkspaceId = 'dev-workspace';

    const { userId } = await this.ingestion.findOrCreateUser({
      tenantId: body.tenantId,
      channelType: 'dev',
      externalWorkspaceId,
      externalUserId,
      displayName: body.userName ?? 'Dev User',
    });

    const { conversationId } = await this.ingestion.findOrCreateConversation({
      tenantId: body.tenantId,
      userId,
      channelType: 'dev',
      externalConversationId,
    });

    const traceId = randomUUID();

    const { messageId } = await this.ingestion.saveInboundMessage({
      conversationId,
      tenantId: body.tenantId,
      userId,
      text: body.text,
      occurredAt: new Date(),
      traceId,
    });

    await this.queue.add('process', {
      messageId,
      conversationId,
      userId,
      tenantId: body.tenantId,
      externalWorkspaceId,
      externalConversationId,
      traceId,
    });

    this.logger.log(`Dev: enqueued traceId=${traceId} "${body.text.slice(0, 60)}"`);

    return { traceId, messageId, conversationId, userId };
  }

  /** Triggers an agent-initiated check-in: the mentor writes first. */
  @Post('simulate-checkin')
  @HttpCode(202)
  async simulateCheckIn(@Body() body: Omit<SimulateMessageDto, 'text'>) {
    const externalUserId = body.userId ?? 'dev-user-1';
    const externalConversationId = body.conversationId ?? `dev-conv-${externalUserId}`;
    const externalWorkspaceId = 'dev-workspace';

    const { userId } = await this.ingestion.findOrCreateUser({
      tenantId: body.tenantId,
      channelType: 'dev',
      externalWorkspaceId,
      externalUserId,
      displayName: body.userName ?? 'Dev User',
    });

    const { conversationId } = await this.ingestion.findOrCreateConversation({
      tenantId: body.tenantId,
      userId,
      channelType: 'dev',
      externalConversationId,
    });

    const traceId = randomUUID();

    await this.queue.add('check-in', {
      conversationId,
      userId,
      tenantId: body.tenantId,
      externalWorkspaceId,
      externalConversationId,
      traceId,
    });

    this.logger.log(`Dev: enqueued check-in traceId=${traceId} for user=${externalUserId}`);

    return { traceId, conversationId, userId };
  }

  /** Triggers a proactive-scan immediately (bypasses the hourly repeat) for testing. */
  @Post('simulate-proactive-scan')
  @HttpCode(202)
  async simulateProactiveScan(@Body() body: { tenantId?: string }) {
    await this.scanQueue.add('scan', { tenantId: body.tenantId });
    this.logger.log(`Dev: enqueued proactive-scan tenantId=${body.tenantId ?? 'all'}`);
    return { enqueued: true, tenantId: body.tenantId ?? null };
  }

  /**
   * Finds or creates a user+conversation and returns their IDs — no worker job enqueued.
   * Use this in scripts to get a conversationId without triggering the agent.
   */
  @Get('find-conversation')
  async findConversation(
    @Query('tenantId') tenantId: string,
    @Query('userId') externalUserId: string = 'dev-user-1',
    @Query('userName') displayName: string = 'Dev User',
  ) {
    const externalConversationId = `dev-conv-${externalUserId}`;
    const externalWorkspaceId = 'dev-workspace';

    const { userId } = await this.ingestion.findOrCreateUser({
      tenantId,
      channelType: 'dev',
      externalWorkspaceId,
      externalUserId,
      displayName,
    });

    const { conversationId } = await this.ingestion.findOrCreateConversation({
      tenantId,
      userId,
      channelType: 'dev',
      externalConversationId,
    });

    return { conversationId, userId };
  }

  /** Returns all messages in a conversation, newest last. */
  @Get('conversation/:conversationId/messages')
  async getMessages(
    @Param('conversationId') conversationId: string,
    @Query('after') afterMessageId?: string,
  ) {
    const rows = await this.db.client
      .select({
        id: messages.id,
        direction: messages.direction,
        text: messages.text,
        occurredAt: messages.occurredAt,
        traceId: messages.traceId,
      })
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(messages.occurredAt);

    // If caller provides afterMessageId, return only messages that came after it
    if (afterMessageId) {
      const idx = rows.findIndex(r => r.id === afterMessageId);
      return idx >= 0 ? rows.slice(idx + 1) : rows;
    }

    return rows;
  }

  /** Returns active memory items for a user — what the AI remembers about them. */
  @Get('user/:userId/memory')
  async getMemory(@Param('userId') userId: string) {
    const items = await this.db.client
      .select({
        id: memoryItems.id,
        category: memoryItems.category,
        canonicalKey: memoryItems.canonicalKey,
        content: memoryItems.content,
        confidence: memoryItems.confidence,
        importance: memoryItems.importance,
        sensitivity: memoryItems.sensitivity,
        expectedLifetime: memoryItems.validUntil,
        createdAt: memoryItems.createdAt,
      })
      .from(memoryItems)
      .where(and(eq(memoryItems.userId, userId), eq(memoryItems.status, 'active')))
      .orderBy(desc(memoryItems.importance));

    return { count: items.length, items };
  }

  /** Returns scheduled follow-up actions for a user. */
  @Get('user/:userId/scheduled-actions')
  async getScheduledActions(@Param('userId') userId: string) {
    const actions = await this.db.client
      .select({
        id: scheduledActions.id,
        type: scheduledActions.type,
        intent: scheduledActions.intent,
        status: scheduledActions.status,
        dueAt: scheduledActions.dueAt,
        attemptCount: scheduledActions.attemptCount,
      })
      .from(scheduledActions)
      .where(eq(scheduledActions.userId, userId))
      .orderBy(desc(scheduledActions.createdAt));

    return { count: actions.length, actions };
  }

  /** Returns survey evidence collected for a user across all windows. */
  @Get('user/:userId/survey-state')
  async getSurveyState(@Param('userId') userId: string) {
    const rows = await this.db.client
      .select({
        id: surveyEvidence.id,
        surveyQuestionId: surveyEvidence.surveyQuestionId,
        polarity: surveyEvidence.polarity,
        strength: surveyEvidence.strength,
        completeness: surveyEvidence.completeness,
        confidence: surveyEvidence.confidence,
        evidenceSummary: surveyEvidence.evidenceSummary,
        createdAt: surveyEvidence.createdAt,
      })
      .from(surveyEvidence)
      .innerJoin(surveyWindows, eq(surveyEvidence.surveyWindowId, surveyWindows.id))
      .where(and(eq(surveyWindows.userId, userId), isNull(surveyEvidence.supersededAt)))
      .orderBy(desc(surveyEvidence.createdAt));

    return { count: rows.length, evidence: rows };
  }

  /**
   * Fast-forwards through the pulse backlog for a user by simulating N steps.
   * Each step:
   *   1. Force-marks any 'active' entry as ignored (simulates 48h timeout).
   *   2. Finds the next 'pending' non-engagement entry and marks it 'active'.
   * Returns the sequence of questions that would be probed.
   * Only works in development mode.
   */
  @Post('simulate-proactive-cycle')
  @HttpCode(200)
  async simulateProactiveCycle(
    @Body() body: { userId: string; tenantId: string; steps: number },
  ): Promise<{
    steps: Array<{
      stepIndex: number;
      questionId: string;
      stableKey: string;
      title: string;
      group: string;
      wasForceIgnored: boolean;
    }>;
  }> {
    const { userId, tenantId: _tenantId, steps } = body;

    // Find the active survey window for this user
    const [window] = await this.db.client
      .select({ id: surveyWindows.id })
      .from(surveyWindows)
      .where(and(eq(surveyWindows.userId, userId), eq(surveyWindows.status, 'active')))
      .limit(1);

    if (!window) {
      return { steps: [] };
    }

    const windowId = window.id;
    const result: Array<{
      stepIndex: number;
      questionId: string;
      stableKey: string;
      title: string;
      group: string;
      wasForceIgnored: boolean;
    }> = [];

    for (let i = 0; i < steps; i++) {
      // Step 1: force-ignore any active entry
      const [activeEntry] = await this.db.client
        .select({ id: pulseBacklog.id, surveyQuestionId: pulseBacklog.surveyQuestionId, ignoreCount: pulseBacklog.ignoreCount })
        .from(pulseBacklog)
        .where(and(eq(pulseBacklog.userId, userId), eq(pulseBacklog.surveyWindowId, windowId), eq(pulseBacklog.status, 'active')))
        .limit(1);

      let wasForceIgnored = false;
      if (activeEntry) {
        const [{ maxPos }] = await this.db.client
          .select({ maxPos: sqlMax(pulseBacklog.position) })
          .from(pulseBacklog)
          .where(and(eq(pulseBacklog.userId, userId), eq(pulseBacklog.surveyWindowId, windowId)));

        await this.db.client
          .update(pulseBacklog)
          .set({
            status: 'pending',
            position: (maxPos ?? 0) + 1,
            ignoreCount: activeEntry.ignoreCount + 1,
            resultedInCoverage: false,
            updatedAt: new Date(),
          })
          .where(eq(pulseBacklog.id, activeEntry.id));
        wasForceIgnored = true;
      }

      // Step 2: find next pending non-engagement entry
      const [nextEntry] = await this.db.client
        .select({
          id: pulseBacklog.id,
          surveyQuestionId: pulseBacklog.surveyQuestionId,
          stableKey: surveyQuestions.stableKey,
          title: surveyQuestions.title,
          questionGroup: surveyQuestions.questionGroup,
        })
        .from(pulseBacklog)
        .innerJoin(surveyQuestions, eq(pulseBacklog.surveyQuestionId, surveyQuestions.id))
        .where(
          and(
            eq(pulseBacklog.userId, userId),
            eq(pulseBacklog.surveyWindowId, windowId),
            eq(pulseBacklog.status, 'pending'),
            ne(surveyQuestions.questionGroup, 'engagement'),
          ),
        )
        .orderBy(asc(pulseBacklog.position))
        .limit(1);

      if (!nextEntry) break;

      // Mark it active with sentAt = now
      await this.db.client
        .update(pulseBacklog)
        .set({ status: 'active', proactiveSentAt: new Date(), updatedAt: new Date() })
        .where(eq(pulseBacklog.id, nextEntry.id));

      result.push({
        stepIndex: i + 1,
        questionId: nextEntry.surveyQuestionId,
        stableKey: nextEntry.stableKey,
        title: nextEntry.title,
        group: nextEntry.questionGroup,
        wasForceIgnored,
      });
    }

    this.logger.log(`Dev: simulated ${result.length}/${steps} proactive cycle steps for user=${userId}`);
    return { steps: result };
  }
}
