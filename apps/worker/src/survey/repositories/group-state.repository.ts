import { Injectable } from '@nestjs/common';
import { and, eq, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { messages, surveyGroupStates } from '@entalent/database';
import type {
  ConfirmGroupStateParams,
  StageGroupConfirmationParams,
  SurveyGroupStateRecord,
  TransitionAwaitingGroupStateParams,
  UpsertGroupStateParams,
} from '@entalent/application';
import { DatabaseService } from '../../database/database.service';

export interface ActivateDeliveredConfirmationParams {
  confirmationPromptMessageId: string;
  tenantId: string;
  conversationId: string;
  deliveredAt: Date;
}

@Injectable()
export class GroupStateRepository {
  constructor(private readonly db: DatabaseService) {}

  async findGroupState(
    userId: string,
    windowId: string,
    questionGroup: string,
  ): Promise<SurveyGroupStateRecord | null> {
    const [row] = await this.db.client
      .select()
      .from(surveyGroupStates)
      .where(and(
        eq(surveyGroupStates.userId, userId),
        eq(surveyGroupStates.surveyWindowId, windowId),
        eq(surveyGroupStates.questionGroup, questionGroup),
      ))
      .limit(1);
    return row ? mapGroupState(row) : null;
  }

  async findPendingConfirmationGroups(
    userId: string,
    tenantId: string,
  ): Promise<SurveyGroupStateRecord[]> {
    const rows = await this.db.client
      .select()
      .from(surveyGroupStates)
      .where(and(
        eq(surveyGroupStates.userId, userId),
        eq(surveyGroupStates.tenantId, tenantId),
        eq(surveyGroupStates.status, 'pending_confirmation'),
        isNull(surveyGroupStates.confirmationPromptMessageId),
        sql`not exists (
          select 1 from ${surveyGroupStates} active
          where active.tenant_id = ${tenantId}
            and active.user_id = ${userId}
            and active.confirmation_prompt_message_id is not null
            and active.status in ('pending_confirmation', 'awaiting_confirmation')
        )`,
      ));
    return rows.map((row) => mapGroupState(row));
  }

  async findAwaitingConfirmationGroups(
    userId: string,
    tenantId: string,
    conversationId: string,
  ): Promise<SurveyGroupStateRecord[]> {
    const rows = await this.db.client
      .select({
        groupState: surveyGroupStates,
        confirmationSummary: sql<string>`${messages.metadata}->>'confirmationSummary'`,
      })
      .from(surveyGroupStates)
      .innerJoin(messages, eq(messages.id, surveyGroupStates.confirmationPromptMessageId))
      .where(and(
        eq(surveyGroupStates.userId, userId),
        eq(surveyGroupStates.tenantId, tenantId),
        inArray(surveyGroupStates.status, ['pending_confirmation', 'awaiting_confirmation']),
        eq(messages.tenantId, tenantId),
        eq(messages.userId, userId),
        eq(messages.conversationId, conversationId),
        eq(messages.direction, 'outbound'),
        isNotNull(messages.sentAt),
        isNull(messages.deletedAt),
        sql`btrim(${messages.metadata}->>'confirmationSummary') <> ''`,
        sql`strpos(${messages.text}, ${messages.metadata}->>'confirmationSummary') > 0`,
      ));
    return rows.map(({ groupState, confirmationSummary }) =>
      mapGroupState(groupState, { confirmationSummary }));
  }

  async upsertGroupState(params: UpsertGroupStateParams): Promise<SurveyGroupStateRecord> {
    const [row] = await this.db.client
      .insert(surveyGroupStates)
      .values({
        surveyWindowId: params.surveyWindowId,
        userId: params.userId,
        tenantId: params.tenantId,
        questionGroup: params.questionGroup,
        status: params.status,
        employeeScore: params.employeeScore !== undefined ? String(params.employeeScore) : undefined,
        personalRecs: params.personalRecs as never,
        reportSentAt: params.reportSentAt,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          surveyGroupStates.surveyWindowId,
          surveyGroupStates.userId,
          surveyGroupStates.questionGroup,
        ],
        set: {
          status: params.status,
          employeeScore: params.employeeScore !== undefined ? String(params.employeeScore) : undefined,
          personalRecs: params.personalRecs as never,
          reportSentAt: params.reportSentAt,
          updatedAt: new Date(),
        },
        setWhere: eq(surveyGroupStates.status, 'in_progress'),
      })
      .returning();
    if (row) return mapGroupState(row);

    const existing = await this.findGroupState(params.userId, params.surveyWindowId, params.questionGroup);
    if (!existing) throw new Error(`Group state upsert lost row: ${params.questionGroup}`);
    return existing;
  }

  async stageGroupConfirmation(params: StageGroupConfirmationParams): Promise<boolean> {
    const rows = await this.db.client
      .update(surveyGroupStates)
      .set({
        aiSummary: null,
        confirmationPromptMessageId: params.confirmationPromptMessageId,
        confirmedAt: null,
        reportingDisclosureVersion: null,
        reportingDisclosureShownAt: null,
        confirmationMessageId: null,
        updatedAt: new Date(),
      })
      .where(and(
        eq(surveyGroupStates.surveyWindowId, params.surveyWindowId),
        eq(surveyGroupStates.userId, params.userId),
        eq(surveyGroupStates.tenantId, params.tenantId),
        eq(surveyGroupStates.questionGroup, params.questionGroup),
        eq(surveyGroupStates.status, 'pending_confirmation'),
        isNull(surveyGroupStates.confirmationPromptMessageId),
        eq(surveyGroupStates.updatedAt, params.expectedUpdatedAt),
        sql`exists (
          select 1 from ${messages}
          where ${messages.id} = ${params.confirmationPromptMessageId}
            and ${messages.conversationId} = ${params.conversationId}
            and ${messages.tenantId} = ${params.tenantId}
            and ${messages.userId} = ${params.userId}
            and ${messages.direction} = 'outbound'
            and ${messages.sentAt} is null
            and ${messages.deletedAt} is null
            and btrim(${messages.metadata}->>'confirmationSummary') <> ''
            and strpos(${messages.text}, ${messages.metadata}->>'confirmationSummary') > 0
        )`,
      ))
      .returning({ id: surveyGroupStates.id });
    return rows.length === 1;
  }

  async activateDeliveredConfirmation(
    params: ActivateDeliveredConfirmationParams,
  ): Promise<boolean> {
    const deliveredAtIso = params.deliveredAt.toISOString();
    const rows = await this.db.client
      .update(surveyGroupStates)
      .set({ status: 'awaiting_confirmation', updatedAt: new Date() })
      .where(and(
        eq(surveyGroupStates.confirmationPromptMessageId, params.confirmationPromptMessageId),
        eq(surveyGroupStates.tenantId, params.tenantId),
        eq(surveyGroupStates.status, 'pending_confirmation'),
        sql`exists (
          select 1 from ${messages}
          where ${messages.id} = ${params.confirmationPromptMessageId}
            and ${messages.id} = ${surveyGroupStates.confirmationPromptMessageId}
            and ${messages.conversationId} = ${params.conversationId}
            and ${messages.tenantId} = ${params.tenantId}
            and ${messages.tenantId} = ${surveyGroupStates.tenantId}
            and ${messages.userId} = ${surveyGroupStates.userId}
            and ${messages.direction} = 'outbound'
            and ${messages.sentAt} = ${deliveredAtIso}::timestamptz
            and ${messages.deletedAt} is null
            and btrim(${messages.metadata}->>'confirmationSummary') <> ''
            and strpos(${messages.text}, ${messages.metadata}->>'confirmationSummary') > 0
        )`,
      ))
      .returning({ id: surveyGroupStates.id });
    return rows.length === 1;
  }

  async transitionAwaitingGroupState(
    params: TransitionAwaitingGroupStateParams,
  ): Promise<boolean> {
    const correctionProof = params.status === 'in_progress'
      ? (() => {
        const responseOccurredAtIso = params.responseOccurredAt.toISOString();
        return and(
          sql`exists (
            select 1 from ${messages}
            where ${messages.id} = ${params.confirmationPromptMessageId}
              and ${messages.conversationId} = ${params.conversationId}
              and ${messages.tenantId} = ${params.tenantId}
              and ${messages.userId} = ${params.userId}
              and ${messages.direction} = 'outbound'
              and ${messages.sentAt} is not null
              and ${messages.sentAt} < ${responseOccurredAtIso}::timestamptz
              and ${messages.deletedAt} is null
          )`,
          sql`exists (
            select 1 from ${messages}
            where ${messages.id} = ${params.responseMessageId}
              and ${messages.conversationId} = ${params.conversationId}
              and ${messages.tenantId} = ${params.tenantId}
              and ${messages.userId} = ${params.userId}
              and ${messages.direction} = 'inbound'
              and ${messages.occurredAt} = ${responseOccurredAtIso}::timestamptz
              and ${messages.deletedAt} is null
          )`,
        );
      })()
      : undefined;
    const rows = await this.db.client
      .update(surveyGroupStates)
      .set({
        status: params.status,
        aiSummary: null,
        confirmationPromptMessageId: null,
        confirmedAt: null,
        reportingDisclosureVersion: null,
        reportingDisclosureShownAt: null,
        confirmationMessageId: null,
        updatedAt: new Date(),
      })
      .where(and(
        eq(surveyGroupStates.surveyWindowId, params.surveyWindowId),
        eq(surveyGroupStates.userId, params.userId),
        eq(surveyGroupStates.tenantId, params.tenantId),
        eq(surveyGroupStates.questionGroup, params.questionGroup),
        inArray(surveyGroupStates.status, ['pending_confirmation', 'awaiting_confirmation']),
        eq(surveyGroupStates.confirmationPromptMessageId, params.confirmationPromptMessageId),
        correctionProof,
      ))
      .returning({ id: surveyGroupStates.id });
    return rows.length === 1;
  }

  async confirmGroupState(params: ConfirmGroupStateParams): Promise<boolean> {
    if (params.reportingDisclosureShownAt.getTime() >= params.confirmedAt.getTime()) return false;
    const confirmedAtIso = params.confirmedAt.toISOString();
    const rows = await this.db.client
      .update(surveyGroupStates)
      .set({
        status: 'confirmed',
        aiSummary: params.expectedConfirmationSummary,
        employeeScore: params.employeeScore !== undefined ? String(params.employeeScore) : undefined,
        confirmedAt: params.confirmedAt,
        reportingDisclosureVersion: params.reportingDisclosureVersion,
        reportingDisclosureShownAt: params.reportingDisclosureShownAt,
        confirmationMessageId: params.confirmationMessageId,
        updatedAt: new Date(),
      })
      .where(and(
        eq(surveyGroupStates.surveyWindowId, params.surveyWindowId),
        eq(surveyGroupStates.userId, params.userId),
        eq(surveyGroupStates.tenantId, params.tenantId),
        eq(surveyGroupStates.questionGroup, params.questionGroup),
        inArray(surveyGroupStates.status, ['pending_confirmation', 'awaiting_confirmation']),
        eq(surveyGroupStates.confirmationPromptMessageId, params.confirmationPromptMessageId),
        sql`exists (
          select 1 from ${messages}
          where ${messages.id} = ${params.confirmationPromptMessageId}
            and ${messages.id} = ${surveyGroupStates.confirmationPromptMessageId}
            and ${messages.conversationId} = ${params.conversationId}
            and ${messages.tenantId} = ${params.tenantId}
            and ${messages.userId} = ${params.userId}
            and ${messages.direction} = 'outbound'
            and ${messages.sentAt} is not null
            and ${messages.sentAt} < ${confirmedAtIso}::timestamptz
            and ${messages.deletedAt} is null
            and btrim(${messages.metadata}->>'confirmationSummary') <> ''
            and strpos(${messages.text}, ${messages.metadata}->>'confirmationSummary') > 0
            and ${messages.metadata}->>'confirmationSummary' = ${params.expectedConfirmationSummary}
        )`,
        sql`exists (
          select 1 from ${messages}
          where ${messages.id} = ${params.confirmationMessageId}
            and ${messages.conversationId} = ${params.conversationId}
            and ${messages.tenantId} = ${params.tenantId}
            and ${messages.userId} = ${params.userId}
            and ${messages.direction} = 'inbound'
            and ${messages.occurredAt} = ${params.confirmedAt}
            and ${messages.deletedAt} is null
        )`,
      ))
      .returning({ id: surveyGroupStates.id });
    return rows.length === 1;
  }

  async findConfirmedGroupStates(
    userIds: string[],
    questionGroup: string,
  ): Promise<SurveyGroupStateRecord[]> {
    if (userIds.length === 0) return [];
    const rows = await this.db.client
      .select()
      .from(surveyGroupStates)
      .where(and(
        inArray(surveyGroupStates.userId, userIds),
        eq(surveyGroupStates.questionGroup, questionGroup),
        eq(surveyGroupStates.status, 'confirmed'),
        isNotNull(surveyGroupStates.confirmedAt),
        isNotNull(surveyGroupStates.reportingDisclosureVersion),
        sql`btrim(${surveyGroupStates.reportingDisclosureVersion}) <> ''`,
        isNotNull(surveyGroupStates.reportingDisclosureShownAt),
        isNotNull(surveyGroupStates.confirmationMessageId),
        isNotNull(surveyGroupStates.confirmationPromptMessageId),
        isNotNull(surveyGroupStates.aiSummary),
        sql`btrim(${surveyGroupStates.aiSummary}) <> ''`,
        lt(surveyGroupStates.reportingDisclosureShownAt, surveyGroupStates.confirmedAt),
        sql`exists (
          select 1 from ${messages} displayed
          join ${messages} response
            on response.id = ${surveyGroupStates.confirmationMessageId}
          where displayed.id = ${surveyGroupStates.confirmationPromptMessageId}
            and displayed.tenant_id = ${surveyGroupStates.tenantId}
            and displayed.user_id = ${surveyGroupStates.userId}
            and displayed.direction = 'outbound'
            and displayed.sent_at is not null
            and displayed.sent_at < ${surveyGroupStates.confirmedAt}
            and displayed.deleted_at is null
            and btrim(displayed.metadata->>'confirmationSummary') <> ''
            and strpos(displayed.text, displayed.metadata->>'confirmationSummary') > 0
            and displayed.metadata->>'confirmationSummary' = ${surveyGroupStates.aiSummary}
            and response.tenant_id = ${surveyGroupStates.tenantId}
            and response.user_id = ${surveyGroupStates.userId}
            and response.conversation_id = displayed.conversation_id
            and response.direction = 'inbound'
            and response.occurred_at = ${surveyGroupStates.confirmedAt}
            and response.deleted_at is null
        )`,
      ));
    return rows.map((row) => mapGroupState(row, { reportableSummary: row.aiSummary }));
  }
}

function mapGroupState(
  row: typeof surveyGroupStates.$inferSelect,
  projection: { confirmationSummary?: string | null; reportableSummary?: string | null } = {},
): SurveyGroupStateRecord {
  return {
    id: row.id,
    surveyWindowId: row.surveyWindowId,
    userId: row.userId,
    tenantId: row.tenantId,
    questionGroup: row.questionGroup,
    status: row.status,
    aiSummary: row.aiSummary,
    confirmationSummary: projection.confirmationSummary ?? null,
    reportableSummary: projection.reportableSummary ?? null,
    employeeScore: row.employeeScore !== null ? Number(row.employeeScore) : null,
    personalRecs: row.personalRecs,
    confirmedAt: row.confirmedAt,
    reportingDisclosureVersion: row.reportingDisclosureVersion,
    reportingDisclosureShownAt: row.reportingDisclosureShownAt,
    confirmationMessageId: row.confirmationMessageId,
    confirmationPromptMessageId: row.confirmationPromptMessageId,
    reportSentAt: row.reportSentAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
