import type { Queue } from 'bullmq';
import { Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import {
  parseReportingRightsActionId, parseReportingRightsButtonValue, REPORTING_RIGHTS_ACTION_PREFIX, REPORTING_RIGHTS_CONFIRM_MENU_TTL_SECONDS, REPORTING_RIGHTS_JOB_RETENTION,
  reportingRightsApplyJobId, reportingRightsRenderJobId, type ReportingRightsJob,
} from '@entalent/contracts';
import { surveyReportingRightsAdmissions, surveyReportingRightsMenus } from '@entalent/database';
import {
  ReportingRightsIntakeUseCase, reportingRightsRequestId, type ReportingRightsAdmissionRecord, type ReportingRightsAdmissionStorePort,
  type ReportingRightsClickOutcome, type ReportingRightsJobPort, type ReportingRightsMenuRecord, type ReportingRightsSubject,
} from '@entalent/application';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import type { SlackInteractionEvent } from './slack-interaction';

/** True for a block_actions body whose single action belongs to the rights protocol (admit before ack). */
export function isReportingRightsInteractionBody(body: Record<string, unknown>): boolean {
  if (body['type'] !== 'block_actions' || !Array.isArray(body['actions']) || body['actions'].length !== 1) return false;
  const action = body['actions'][0] as { action_id?: unknown } | null;
  return typeof action?.action_id === 'string' && action.action_id.startsWith(REPORTING_RIGHTS_ACTION_PREFIX);
}
export function isReportingRightsActionId(actionId: string): boolean { return actionId.startsWith(REPORTING_RIGHTS_ACTION_PREFIX); }

export interface ReportingRightsInteractionDeps {
  findWorkspaceIdentity(channelType: string, externalWorkspaceId: string): Promise<{ tenantId: string } | null>;
  findLinkedPersonId(params: { tenantId: string; channelType: string; externalWorkspaceId: string; externalUserId: string }): Promise<string | null>;
  intake: Pick<ReportingRightsIntakeUseCase, 'handleClick'>;
  debug(message: string): void;
  warn?(message: string): void;
}

/** Content-free error code for logs: a typed snake_case code, otherwise `unclassified` (never raw messages). */
export function reportingRightsErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  return /^[a-z][a-z0-9_]{2,80}$/.test(message) ? message : 'unclassified';
}

/**
 * Verifies a signed rights click and hands it to the intake use case. Tenant and subject come only from the
 * signed workspace/user and the linked-person lookup; the button value is a server menu token. Logs carry
 * typed reasons and IDs only.
 */
export async function handleReportingRightsInteraction(event: SlackInteractionEvent, deps: ReportingRightsInteractionDeps): Promise<ReportingRightsClickOutcome> {
  const p = event.payload;
  const drop = (reason: Extract<ReportingRightsClickOutcome, { outcome: 'dropped' }>['reason']): ReportingRightsClickOutcome => {
    deps.debug(`Dropping reporting-rights interaction: ${reason}`);
    return { outcome: 'dropped', reason };
  };
  if (!p.externalChannelId.startsWith('D')) return drop('not_dm');
  const action = parseReportingRightsActionId(p.actionId);
  if (!action) return drop('unknown_action');
  const value = parseReportingRightsButtonValue(p.value);
  if (!value) return drop('invalid_value');
  const workspace = await deps.findWorkspaceIdentity('slack', p.externalWorkspaceId);
  if (!workspace) return drop('unknown_workspace');
  const personId = await deps.findLinkedPersonId({
    tenantId: workspace.tenantId, channelType: 'slack', externalWorkspaceId: p.externalWorkspaceId, externalUserId: p.externalUserId,
  });
  if (!personId) return drop('unlinked_user');
  const outcome = await deps.intake.handleClick({
    tenantId: workspace.tenantId, userId: personId, channelType: 'slack', externalWorkspaceId: p.externalWorkspaceId,
    externalUserId: p.externalUserId, externalChannelId: p.externalChannelId, action, menuId: value.menuId,
    ...(value.index !== undefined ? { index: value.index } : {}), actionTs: p.actionTs,
  });
  if (outcome.outcome === 'dropped') deps.debug(`Dropping reporting-rights interaction: ${outcome.reason}`);
  // The DB state is already committed; a lost transport is repaired (apply) or only logged (render/notice).
  if ('enqueued' in outcome && outcome.enqueued === false) deps.warn?.(`reporting_rights_enqueue_failed outcome=${outcome.outcome}`);
  return outcome;
}

type MenuRow = typeof surveyReportingRightsMenus.$inferSelect;
type AdmissionRow = typeof surveyReportingRightsAdmissions.$inferSelect;
const toAdmission = (row: AdmissionRow): ReportingRightsAdmissionRecord => ({
  id: row.id, tenantId: row.tenantId, userId: row.userId, menuId: row.menuId, requestId: row.requestId,
  targetKind: row.targetKind as ReportingRightsAdmissionRecord['targetKind'], lineageIds: [...row.lineageIds],
  receivedAt: row.receivedAt, status: row.status as ReportingRightsAdmissionRecord['status'], confirmationMessageId: row.confirmationMessageId,
});

/** PostgreSQL store for API-side admission. Every statement is scoped by the verified subject. */
@Injectable()
export class ReportingRightsAdmissionRepository implements ReportingRightsAdmissionStorePort {
  constructor(private readonly db: DatabaseService) {}

  async findMenu(subject: ReportingRightsSubject, menuId: string): Promise<ReportingRightsMenuRecord | null> {
    const [row] = await this.db.client.select({
      menu: surveyReportingRightsMenus,
      expired: sql<boolean>`${surveyReportingRightsMenus.expiresAt} <= clock_timestamp()`,
      admitted: sql<boolean>`exists(select 1 from survey_reporting_rights_admissions a where a.menu_id = ${surveyReportingRightsMenus.id})`,
    }).from(surveyReportingRightsMenus).where(this.owned(subject, menuId)).limit(1);
    if (!row) return null;
    const menu: MenuRow = row.menu;
    return {
      id: menu.id, tenantId: menu.tenantId, userId: menu.userId, conversationId: menu.conversationId, externalChannelId: menu.externalChannelId,
      kind: menu.kind as 'root' | 'confirm', targetKind: menu.targetKind as ReportingRightsMenuRecord['targetKind'], lineageIds: [...menu.lineageIds],
      expired: row.expired, cancelled: menu.cancelledAt !== null, admitted: row.admitted,
    };
  }

  async stageConfirm(input: Parameters<ReportingRightsAdmissionStorePort['stageConfirm']>[0]): Promise<{ menuId: string } | null> {
    const id = randomUUID();
    // Copies routing from the parent; the lineage target is a subset of the parent's stored options.
    const rows = await this.db.client.execute(sql`insert into survey_reporting_rights_menus
      (id, tenant_id, user_id, conversation_id, channel_type, external_workspace_id, external_channel_id, locale, kind, parent_menu_id, target_kind, lineage_ids, expires_at)
      select ${id}::uuid, parent.tenant_id, parent.user_id, parent.conversation_id, parent.channel_type, parent.external_workspace_id, parent.external_channel_id, parent.locale,
        'confirm', parent.id, ${input.targetKind}, ARRAY[${sql.join(input.lineageIds.map((l) => sql`${l}::uuid`), sql`, `)}]::uuid[],
        clock_timestamp() + make_interval(secs => ${REPORTING_RIGHTS_CONFIRM_MENU_TTL_SECONDS})
      from survey_reporting_rights_menus parent
      where parent.tenant_id = ${input.subject.tenantId}::uuid and parent.user_id = ${input.subject.userId}::uuid and parent.id = ${input.parentMenuId}::uuid
        and parent.kind = 'root' and parent.expires_at > clock_timestamp()
        and ARRAY[${sql.join(input.lineageIds.map((l) => sql`${l}::uuid`), sql`, `)}]::uuid[] <@ parent.lineage_ids
      returning id`) as unknown as { id: string }[];
    return rows[0] ? { menuId: rows[0].id } : null;
  }

  async cancel(subject: ReportingRightsSubject, menuId: string): Promise<boolean> {
    return this.db.client.transaction(async (tx) => {
      const locked = await tx.execute(sql`select id from survey_reporting_rights_menus where tenant_id = ${subject.tenantId}::uuid and user_id = ${subject.userId}::uuid
        and id = ${menuId}::uuid and kind = 'confirm' for update`) as unknown as unknown[];
      if (!locked.length) return false;
      const [admitted] = await tx.select({ id: surveyReportingRightsAdmissions.id }).from(surveyReportingRightsAdmissions).where(eq(surveyReportingRightsAdmissions.menuId, menuId)).limit(1);
      if (admitted) return false;
      const updated = await tx.update(surveyReportingRightsMenus).set({ cancelledAt: sql`clock_timestamp()` })
        .where(and(this.owned(subject, menuId), sql`${surveyReportingRightsMenus.cancelledAt} is null`)).returning({ id: surveyReportingRightsMenus.id });
      return updated.length > 0;
    });
  }

  async admit(input: Parameters<ReportingRightsAdmissionStorePort['admit']>[0]): Promise<Awaited<ReturnType<ReportingRightsAdmissionStorePort['admit']>>> {
    return this.db.client.transaction(async (tx) => {
      // The menu row lock serializes Confirm against Cancel and concurrent duplicate clicks.
      const menus = await tx.execute(sql`select id, target_kind, lineage_ids from survey_reporting_rights_menus
        where tenant_id = ${input.subject.tenantId}::uuid and user_id = ${input.subject.userId}::uuid and id = ${input.menuId}::uuid
          and kind = 'confirm' and cancelled_at is null and expires_at > clock_timestamp() for update`) as unknown as { id: string; target_kind: string; lineage_ids: string[] }[];
      const existing = async () => {
        const [row] = await tx.select().from(surveyReportingRightsAdmissions).where(and(
          eq(surveyReportingRightsAdmissions.tenantId, input.subject.tenantId), eq(surveyReportingRightsAdmissions.userId, input.subject.userId),
          sql`(${surveyReportingRightsAdmissions.menuId} = ${input.menuId}::uuid or (${surveyReportingRightsAdmissions.channelType} = ${input.channelType}
            and ${surveyReportingRightsAdmissions.externalWorkspaceId} = ${input.externalWorkspaceId} and ${surveyReportingRightsAdmissions.externalUserId} = ${input.externalUserId}
            and ${surveyReportingRightsAdmissions.actionTs} = ${input.actionTs}))`,
        )).limit(1);
        return row;
      };
      const prior = await existing();
      if (prior) return { status: 'admitted' as const, admission: toAdmission(prior), created: false };
      const menu = menus[0];
      if (!menu) return { status: 'menu_unavailable' as const };
      const id = randomUUID();
      const [row] = await tx.insert(surveyReportingRightsAdmissions).values({
        id, tenantId: input.subject.tenantId, userId: input.subject.userId, menuId: menu.id, channelType: input.channelType,
        externalWorkspaceId: input.externalWorkspaceId, externalUserId: input.externalUserId, actionTs: input.actionTs,
        requestId: reportingRightsRequestId(id), targetKind: menu.target_kind, lineageIds: menu.lineage_ids,
      }).onConflictDoNothing().returning();
      if (row) return { status: 'admitted' as const, admission: toAdmission(row), created: true };
      const raced = await existing();
      if (!raced) throw new Error('reporting_rights_admission_conflict');
      return { status: 'admitted' as const, admission: toAdmission(raced), created: false };
    });
  }

  private owned(subject: ReportingRightsSubject, menuId: string) {
    return and(eq(surveyReportingRightsMenus.tenantId, subject.tenantId), eq(surveyReportingRightsMenus.userId, subject.userId), eq(surveyReportingRightsMenus.id, menuId));
  }
}

/** BullMQ transport for rights jobs; deterministic ids make duplicate clicks and repairs collapse. */
export class ReportingRightsQueueJobs implements ReportingRightsJobPort {
  constructor(private readonly queue: Pick<Queue<ReportingRightsJob>, 'add'>) {}
  async enqueue(job: ReportingRightsJob): Promise<void> {
    if (job.kind === 'apply') await this.queue.add('apply', job, { jobId: reportingRightsApplyJobId(job.admissionId), ...REPORTING_RIGHTS_JOB_RETENTION });
    else if (job.kind === 'render') await this.queue.add('render', job, { jobId: reportingRightsRenderJobId(job.menuId, job.view, job.page ?? 0, job.clickTs), ...REPORTING_RIGHTS_JOB_RETENTION });
    else await this.queue.add('sweep', job, { ...REPORTING_RIGHTS_JOB_RETENTION });
  }
}
