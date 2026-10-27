import { BadRequestException, ConflictException, Controller, Post, Get, Body, Param, HttpCode, Logger, Query, UseGuards } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, type JobType } from 'bullmq';
import { randomUUID } from 'crypto';
import { eq, and, desc, isNull, ne, asc, inArray, or, max as sqlMax } from 'drizzle-orm';
import { IngestionService } from '../channel/ingestion.service';
import { DatabaseService } from '../database/database.service';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { QUEUE_NAMES } from '../queue/queue.module';
import {
  messages, memoryItems, scheduledActions, surveyEvidence, surveyWindows, pulseBacklog, surveyQuestions, conversations, workspaceConnections,
  surveyQuestionWorkingInsights, surveyQuestionConfirmationBundles, surveyQuestionVerdictReceipts,
} from '@entalent/database';
import { UserResetService, type UserResetResult } from '../admin/user-reset.service';
import { OnboardingRestartService } from '../onboarding/onboarding-restart.service';
import type { ConversationJob, CheckInJob } from '../queue/queue.types';
import type { SurveyEvidencePayload } from '@entalent/application';

interface SimulateMessageDto {
  tenantId: string;
  userId?: string;
  userName?: string;
  text: string;
  conversationId?: string;
}

interface ForceCheckInDto {
  userIds?: string[];
  tenantId: string;
}

export interface DevUserResetResult extends UserResetResult {
  onboarding: { stateDeleted: boolean; deliveryRequeued: boolean; introQueued: boolean };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Newest jobs read per BullMQ state (each type of a group) when resolving `jobStatus`; older jobs resolve to `null`. */
export const DEV_JOB_SCAN_LIMIT = 500;

export type DevJobStatus = 'queued' | 'processing' | 'completed' | 'failed';

// Scanned in lifecycle order so a job that moves state between two scans is still seen in the later one.
const DEV_JOB_STATE_GROUPS: ReadonlyArray<{ status: DevJobStatus; types: JobType[] }> = [
  { status: 'queued', types: ['waiting', 'delayed', 'prioritized', 'paused', 'waiting-children'] },
  { status: 'processing', types: ['active'] },
  { status: 'failed', types: ['failed'] },
  { status: 'completed', types: ['completed'] },
];

// Across distinct jobs of one message, the highest-ranked status wins.
const DEV_JOB_STATUS_PRECEDENCE: Record<DevJobStatus, number> = { processing: 3, queued: 2, failed: 1, completed: 0 };

const DEV_V2_QUESTION_GROUPS = ['autonomy', 'growth', 'purpose', 'belonging'] as const;

export interface DevMessageRow {
  id: string;
  direction: string;
  text: string;
  occurredAt: Date;
  traceId: string | null;
  messageType: string;
  sentAt: Date | null;
  metadata: unknown;
  jobStatus: DevJobStatus | null;
}

export interface DevQuestionConfirmationState {
  surveyWindowId: string | null;
  group: string | null;
  questions: Array<{ surveyQuestionId: string; stableKey: string; questionGroup: string; status: string }>;
  progress: { answered: number; total: number };
  appliedVerdicts: Array<{ inboundMessageId: string; questionGroup: string; verdictKind: string; appliedAt: Date }>;
  stagedBundleCount: number;
  pendingClarification: {
    surveyQuestionId: string; questionGroup: string; clarificationAttempts: number; promptSent: boolean;
  } | null;
}

// Only available in development — not imported in production AppModule.
@Controller('dev')
@UseGuards(ApiKeyGuard)
export class DevSimulateController {
  private readonly logger = new Logger(DevSimulateController.name);

  constructor(
    private readonly ingestion: IngestionService,
    private readonly db: DatabaseService,
    @InjectQueue(QUEUE_NAMES.CONVERSATION) private readonly queue: Queue<ConversationJob | CheckInJob>,
    @InjectQueue(QUEUE_NAMES.PROACTIVE_SCAN) private readonly scanQueue: Queue<{ tenantId?: string; unitId?: string }>,
    @InjectQueue(QUEUE_NAMES.SURVEY_EVIDENCE) private readonly surveyEvidenceQueue: Queue<SurveyEvidencePayload>,
    private readonly resetService: UserResetService,
    private readonly onboardingRestart: OnboardingRestartService,
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

    const requestId = randomUUID();
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
      requestId,
      eventId: `dev:${requestId}`,
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

  /**
   * Returns all messages in a conversation, newest last. Inbound rows carry the `jobStatus` of their
   * conversation queue job; an `after` id that is not a message of this conversation is a 400.
   */
  @Get('conversation/:conversationId/messages')
  async getMessages(
    @Param('conversationId') conversationId: string,
    @Query('after') afterMessageId?: string,
  ): Promise<DevMessageRow[]> {
    const allRows = await this.db.client
      .select({
        id: messages.id,
        direction: messages.direction,
        text: messages.text,
        occurredAt: messages.occurredAt,
        traceId: messages.traceId,
        messageType: messages.messageType,
        sentAt: messages.sentAt,
        metadata: messages.metadata,
      })
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(messages.occurredAt);

    let rows = allRows;
    if (afterMessageId) {
      const idx = allRows.findIndex(r => r.id === afterMessageId);
      if (idx < 0) throw new BadRequestException('after message not found in conversation');
      rows = allRows.slice(idx + 1);
    }

    const inboundIds = rows.filter((r) => r.direction === 'inbound').map((r) => r.id);
    const statuses = inboundIds.length > 0
      ? await this.resolveJobStatuses(conversationId, inboundIds)
      : new Map<string, DevJobStatus>();
    return rows.map((r) => ({
      ...r,
      jobStatus: r.direction === 'inbound' ? statuses.get(r.id) ?? null : null,
    }));
  }

  /** Read-only, bounded scan of the conversation queue; a queue read error propagates. */
  private async resolveJobStatuses(conversationId: string, messageIds: string[]): Promise<Map<string, DevJobStatus>> {
    const wanted = new Set(messageIds);
    // Per job id: the message it carries and the state of the latest group it was seen in.
    const jobsById = new Map<string, { messageId: string; status: DevJobStatus }>();
    for (const group of DEV_JOB_STATE_GROUPS) {
      const jobs = await this.queue.getJobs(group.types, 0, DEV_JOB_SCAN_LIMIT - 1, false);
      for (const job of jobs) {
        const data = job?.data as Partial<ConversationJob> | undefined;
        if (!data || data.conversationId !== conversationId || typeof data.messageId !== 'string') continue;
        if (!wanted.has(data.messageId)) continue;
        jobsById.set(String(job.id), { messageId: data.messageId, status: group.status });
      }
    }
    const statuses = new Map<string, DevJobStatus>();
    for (const { messageId, status } of jobsById.values()) {
      const current = statuses.get(messageId);
      if (current === undefined || DEV_JOB_STATUS_PRECEDENCE[status] > DEV_JOB_STATUS_PRECEDENCE[current]) {
        statuses.set(messageId, status);
      }
    }
    return statuses;
  }

  /**
   * Raw V2 question-confirmation state of the user's active survey window: reads the same tables as the
   * worker repository with the L1 fake's counting semantics. It skips the worker's v2-mode/policy checks,
   * its periodEnd check, its three-questions-per-group rule and its pending-clarification prompt/summary
   * checks, and returns no statement text.
   */
  @Get('user/:userId/question-confirmation')
  async getQuestionConfirmation(
    @Param('userId') userId: string,
    @Query('tenantId') tenantIdInput?: string,
    @Query('group') groupInput?: string,
  ): Promise<DevQuestionConfirmationState> {
    const tenantId = typeof tenantIdInput === 'string' ? tenantIdInput.trim() : '';
    if (!tenantId) throw new BadRequestException('tenantId is required');
    if (!UUID_PATTERN.test(tenantId)) throw new BadRequestException('tenantId must be a UUID');
    if (typeof userId !== 'string' || !UUID_PATTERN.test(userId)) throw new BadRequestException('userId must be a UUID');
    const group = typeof groupInput === 'string' && groupInput !== '' ? groupInput : null;
    if (group !== null && !(DEV_V2_QUESTION_GROUPS as readonly string[]).includes(group)) {
      throw new BadRequestException(`group must be one of ${DEV_V2_QUESTION_GROUPS.join('|')}`);
    }

    const windows = await this.db.client
      .select({ id: surveyWindows.id, surveyDefinitionId: surveyWindows.surveyDefinitionId })
      .from(surveyWindows)
      .where(and(
        eq(surveyWindows.tenantId, tenantId),
        eq(surveyWindows.userId, userId),
        eq(surveyWindows.status, 'active'),
      ))
      .limit(2);
    if (windows.length === 0) {
      return {
        surveyWindowId: null, group, questions: [], progress: { answered: 0, total: 0 },
        appliedVerdicts: [], stagedBundleCount: 0, pendingClarification: null,
      };
    }
    if (windows.length > 1) throw new ConflictException('multiple active survey windows');
    const window = windows[0]!;

    const windowQuestions = await this.db.client
      .select({
        id: surveyQuestions.id,
        stableKey: surveyQuestions.stableKey,
        questionGroup: surveyQuestions.questionGroup,
        displayOrder: surveyQuestions.displayOrder,
      })
      .from(surveyQuestions)
      .innerJoin(surveyWindows, eq(surveyWindows.surveyDefinitionId, surveyQuestions.surveyDefinitionId))
      .where(and(
        eq(surveyWindows.id, window.id),
        eq(surveyWindows.tenantId, tenantId),
        eq(surveyWindows.userId, userId),
        eq(surveyQuestions.responseType, 'open_ended'),
        inArray(surveyQuestions.questionGroup, [...DEV_V2_QUESTION_GROUPS]),
      ))
      .orderBy(asc(surveyQuestions.displayOrder));

    const working = await this.db.client
      .select({
        surveyQuestionId: surveyQuestionWorkingInsights.surveyQuestionId,
        status: surveyQuestionWorkingInsights.status,
        clarificationAttempts: surveyQuestionWorkingInsights.clarificationAttempts,
        purgedAt: surveyQuestionWorkingInsights.purgedAt,
        promptSentAt: messages.sentAt,
      })
      .from(surveyQuestionWorkingInsights)
      .leftJoin(messages, and(
        eq(messages.id, surveyQuestionWorkingInsights.clarificationPromptMessageId),
        eq(messages.tenantId, tenantId),
        eq(messages.userId, userId),
      ))
      .where(and(
        eq(surveyQuestionWorkingInsights.tenantId, tenantId),
        eq(surveyQuestionWorkingInsights.userId, userId),
        eq(surveyQuestionWorkingInsights.surveyWindowId, window.id),
      ));
    const workingByQuestion = new Map(working.map((row) => [row.surveyQuestionId, row]));

    const questions = windowQuestions
      .filter((question) => group === null || question.questionGroup === group)
      .map((question) => ({
        surveyQuestionId: question.id,
        stableKey: question.stableKey,
        questionGroup: question.questionGroup,
        status: workingByQuestion.get(question.id)?.status ?? 'no_data',
      }));

    const receipts = await this.db.client
      .select({
        inboundMessageId: surveyQuestionVerdictReceipts.inboundMessageId,
        questionGroup: surveyQuestionVerdictReceipts.questionGroup,
        verdictKind: surveyQuestionVerdictReceipts.verdictKind,
        appliedAt: surveyQuestionVerdictReceipts.appliedAt,
      })
      .from(surveyQuestionVerdictReceipts)
      .leftJoin(surveyQuestionConfirmationBundles,
        eq(surveyQuestionConfirmationBundles.id, surveyQuestionVerdictReceipts.bundleId))
      .leftJoin(surveyQuestionWorkingInsights,
        eq(surveyQuestionWorkingInsights.id, surveyQuestionVerdictReceipts.workingInsightId))
      .where(and(
        eq(surveyQuestionVerdictReceipts.tenantId, tenantId),
        eq(surveyQuestionVerdictReceipts.userId, userId),
        group === null ? undefined : eq(surveyQuestionVerdictReceipts.questionGroup, group),
        or(
          eq(surveyQuestionConfirmationBundles.surveyWindowId, window.id),
          eq(surveyQuestionWorkingInsights.surveyWindowId, window.id),
        ),
      ))
      .orderBy(asc(surveyQuestionVerdictReceipts.appliedAt));

    // Every bundle of the window in any status, regardless of `group` (the L1 fake's stagedBundleCount()).
    const bundles = await this.db.client
      .select({ id: surveyQuestionConfirmationBundles.id })
      .from(surveyQuestionConfirmationBundles)
      .where(and(
        eq(surveyQuestionConfirmationBundles.tenantId, tenantId),
        eq(surveyQuestionConfirmationBundles.userId, userId),
        eq(surveyQuestionConfirmationBundles.surveyWindowId, window.id),
      ));

    const pendingQuestion = windowQuestions.find((question) => {
      const row = workingByQuestion.get(question.id);
      return row?.status === 'pending_clarification' && row.purgedAt === null;
    });
    const pendingRow = pendingQuestion ? workingByQuestion.get(pendingQuestion.id) : undefined;

    return {
      surveyWindowId: window.id,
      group,
      questions,
      progress: {
        answered: questions.filter((question) => question.status === 'confirmed').length,
        total: questions.length,
      },
      appliedVerdicts: receipts,
      stagedBundleCount: bundles.length,
      pendingClarification: pendingQuestion && pendingRow
        ? {
            surveyQuestionId: pendingQuestion.id,
            questionGroup: pendingQuestion.questionGroup,
            clarificationAttempts: pendingRow.clarificationAttempts,
            promptSent: pendingRow.promptSentAt !== null && pendingRow.promptSentAt !== undefined,
          }
        : null,
    };
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
    const { userId, steps } = body;

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
            resultedInCoverage: null,
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

  /**
   * Force-enqueues a proactive check-in for specific users (or all users in a tenant),
   * bypassing the silence/gap scheduler filters. Useful for immediate testing.
   */
  @Post('force-checkin')
  @HttpCode(202)
  async forceCheckIn(@Body() body: ForceCheckInDto | null | undefined): Promise<{ enqueued: number; users: string[] }> {
    const tenantId = typeof body?.tenantId === 'string' ? body.tenantId.trim() : '';
    if (!tenantId) {
      throw new BadRequestException('tenantId is required');
    }
    if (!UUID_PATTERN.test(tenantId)) {
      throw new BadRequestException('tenantId must be a UUID');
    }
    const requestedUserIds = body?.userIds;
    if (requestedUserIds !== undefined && (!Array.isArray(requestedUserIds) || requestedUserIds.some((id) => typeof id !== 'string'))) {
      throw new BadRequestException('userIds must be an array of strings');
    }

    const rows = await this.db.client
      .select({
        userId: conversations.userId,
        tenantId: conversations.tenantId,
        conversationId: conversations.id,
        channelType: conversations.channelType,
        externalConversationId: conversations.externalConversationId,
        externalWorkspaceId: workspaceConnections.externalWorkspaceId,
      })
      .from(conversations)
      .leftJoin(
        workspaceConnections,
        and(
          eq(workspaceConnections.tenantId, conversations.tenantId),
          eq(workspaceConnections.channelType, conversations.channelType),
          eq(workspaceConnections.status, 'active'),
        ),
      )
      .where(
        and(
          eq(conversations.status, 'active'),
          eq(conversations.tenantId, tenantId),
        ),
      )
      .orderBy(desc(conversations.createdAt));

    // Pick the most recent conversation per user, optionally filtered to requested userIds
    const seen = new Set<string>();
    const candidates = rows.filter((r) => {
      if (requestedUserIds && !requestedUserIds.includes(r.userId)) return false;
      if (seen.has(r.userId)) return false;
      seen.add(r.userId);
      return true;
    });

    for (const c of candidates) {
      await this.queue.add('check-in', {
        conversationId: c.conversationId,
        userId: c.userId,
        tenantId: c.tenantId,
        externalWorkspaceId: c.externalWorkspaceId ?? 'dev-workspace',
        externalConversationId: c.externalConversationId,
        traceId: `force-checkin-${c.userId}-${Date.now()}`,
      });
    }

    this.logger.log(`Dev: force-checkin enqueued ${candidates.length} users`);
    return { enqueued: candidates.length, users: candidates.map((c) => c.userId) };
  }

  /**
   * Resets a user's state for a clean re-test and restarts their onboarding v2. Pass `{ deep: true }` for a full
   * conversation wipe. The intro is re-sent right away when the person has an org onboarding delivery.
   */
  @Post('reset-user')
  @HttpCode(200)
  async resetUser(@Body() body: { userId: string; tenantId?: string; deep?: boolean }): Promise<DevUserResetResult> {
    const tenantId = body.tenantId ?? process.env['DEFAULT_TENANT_ID'] ?? '';
    if (!tenantId) throw new BadRequestException('tenantId is required');
    const result = await this.resetService.resetUser({
      tenantId,
      userId: body.userId,
      deleteConversationHistory: body.deep ?? false,
    });
    const restart = await this.onboardingRestart.restart({ tenantId, personId: body.userId });
    if (restart.unitId) {
      await this.scanQueue.add('onboarding-only', { tenantId, unitId: restart.unitId }, {
        jobId: `dev-onboarding-restart-${body.userId}-${Date.now()}`, attempts: 1,
      });
    }

    this.logger.log(`Dev: reset user=${body.userId} deep=${body.deep ?? false} onboardingIntroQueued=${Boolean(restart.unitId)}`);
    return {
      ...result,
      onboarding: { stateDeleted: restart.stateDeleted, deliveryRequeued: restart.deliveryRequeued, introQueued: Boolean(restart.unitId) },
    };
  }

  /**
   * Re-extracts survey evidence across a user's full recent conversation history.
   * Recovers findings from periods when live extraction was failing — enqueues one
   * backfill job per active conversation; the worker slides windows over the history.
   */
  @Post('backfill-evidence')
  @HttpCode(202)
  async backfillEvidence(
    @Body() body: { userId: string; tenantId?: string; conversationId?: string },
  ): Promise<{ enqueued: number; conversations: string[] }> {
    const { userId } = body;

    const rows = await this.db.client
      .select({
        conversationId: conversations.id,
        tenantId: conversations.tenantId,
      })
      .from(conversations)
      .where(
        and(
          eq(conversations.userId, userId),
          eq(conversations.status, 'active'),
          body.conversationId ? eq(conversations.id, body.conversationId) : undefined,
        ),
      );

    for (const c of rows) {
      await this.surveyEvidenceQueue.add('evaluate', {
        conversationId: c.conversationId,
        userId,
        tenantId: body.tenantId ?? c.tenantId,
        inboundMessageId: '', // unused in backfill mode
        traceId: `backfill-${userId}-${Date.now()}`,
        mode: 'backfill',
      });
    }

    this.logger.log(`Dev: enqueued survey-evidence backfill for ${rows.length} conversations (user=${userId})`);
    return { enqueued: rows.length, conversations: rows.map((c) => c.conversationId) };
  }
}
