import { createHash } from 'node:crypto';
import { Injectable, Optional } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import {
  REPORTING_RIGHTS_PROTOCOL_VERSION, REPORTING_RIGHTS_ROOT_MENU_TTL_SECONDS, reportingRightsButtonValue,
  type OutgoingAction, type PulseLanguageResource, type ReportingRightsRenderView,
} from '@entalent/contracts';
import {
  reportingRightsButton, reportingRightsRootActions, reportingRightsText, reportingRightsTopicButtons, reportingRightsTopicTitle,
  type ReportingRightsAdmissionRecord, type ReportingRightsApplicationStorePort, type ReportingRightsMenuOpening, type ReportingRightsMenuPort,
  type ReportingRightsSettlement,
} from '@entalent/application';
import { messages, surveyReportingRightsAdmissions, surveyReportingRightsMenus } from '@entalent/database';
import { DatabaseService } from '../../database/database.service';
import { PulseLanguageRepository } from './pulse-language.repository';
import type { MessageSendJob } from '../../message-send/message-send.processor';

const MAX_TOPICS = 100;
/** Deterministic RFC4122-shaped id for idempotent outbound rows. */
function stableId(...parts: string[]): string {
  const b = createHash('sha256').update(parts.join('\u0000')).digest().subarray(0, 16);
  b[6] = (b[6]! & 0x0f) | 0x50;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
type AdmissionRow = typeof surveyReportingRightsAdmissions.$inferSelect;
type MenuRow = typeof surveyReportingRightsMenus.$inferSelect;
const toAdmission = (row: AdmissionRow): ReportingRightsAdmissionRecord => ({
  id: row.id, tenantId: row.tenantId, userId: row.userId, menuId: row.menuId, requestId: row.requestId,
  targetKind: row.targetKind as ReportingRightsAdmissionRecord['targetKind'], lineageIds: [...row.lineageIds],
  receivedAt: row.receivedAt, status: row.status as ReportingRightsAdmissionRecord['status'], confirmationMessageId: row.confirmationMessageId,
});

/**
 * "Open or not-yet-final" lineage filter. The authoritative finality signal is a genuine native final
 * assembly (`survey_report_final_completions` for a `final` candidate of the cycle, written only by RPT-07
 * snapshot assembly). Once any final completed for a cycle it is historical: withdrawing there is the
 * separately approved historical-cycle path, so it is not offered. Already excluded lineages and subjects
 * with a full denial offer no topics.
 */
const OPEN_LINEAGE = (alias: string) => sql.raw(`not exists (select 1 from survey_reporting_lineage_exclusions e where e.lineage_id = ${alias}.id)
  and not exists (select 1 from survey_report_final_completions f join survey_report_input_candidates i on i.id = f.candidate_id
    where i.tenant_id = ${alias}.tenant_id and i.cycle_id = ${alias}.cycle_scoring_policy_id and i.purpose = 'final')`);

@Injectable()
export class ReportingRightsRepository implements ReportingRightsApplicationStorePort, ReportingRightsMenuPort {
  private readonly languages: PulseLanguageRepository;
  constructor(private readonly db: DatabaseService, @Optional() languages?: PulseLanguageRepository) {
    this.languages = languages ?? new PulseLanguageRepository(db);
  }

  async openMenu(input: Parameters<ReportingRightsMenuPort['openMenu']>[0]): Promise<ReportingRightsMenuOpening | null> {
    const [denied] = await this.db.client.execute(sql`select 1 from survey_reporting_permissions
      where tenant_id = ${input.tenantId}::uuid and user_id = ${input.userId}::uuid and full_reporting_denied`) as unknown as unknown[];
    if (denied) return { status: 'already_withdrawn' };
    // One root menu per turn: a retried turn reuses it instead of leaving orphans.
    const id = stableId('reporting-rights-root', input.tenantId, input.userId, input.turnKey);
    const lineages = await this.db.client.execute(sql`select l.id from survey_report_question_lineages l
      join survey_cycle_scoring_policies c on c.id = l.cycle_scoring_policy_id and c.tenant_id = l.tenant_id
      join survey_questions q on q.id = l.survey_question_id
      where l.tenant_id = ${input.tenantId}::uuid and l.user_id = ${input.userId}::uuid and ${OPEN_LINEAGE('l')}
      order by c.period_start desc, q.display_order, l.question_stable_key, l.id limit ${MAX_TOPICS}`) as unknown as { id: string }[];
    await this.db.client.insert(surveyReportingRightsMenus).values({
      id, tenantId: input.tenantId, userId: input.userId, conversationId: input.conversationId, channelType: input.channelType,
      externalWorkspaceId: input.externalWorkspaceId, externalChannelId: input.externalChannelId, locale: input.locale, kind: 'root',
      lineageIds: lineages.map((row) => row.id),
      expiresAt: sql`clock_timestamp() + make_interval(secs => ${REPORTING_RIGHTS_ROOT_MENU_TTL_SECONDS})` as unknown as Date,
    }).onConflictDoNothing();
    const menu = await this.menu(input.tenantId, input.userId, id);
    if (!menu || menu.kind !== 'root') throw new Error('reporting_rights_menu_missing');
    return { status: 'menu', menuId: menu.id, actions: reportingRightsRootActions(menu.id, menu.lineageIds.length, await this.rightsResource(menu.locale)) };
  }

  async loadAdmission(tenantId: string, admissionId: string): Promise<ReportingRightsAdmissionRecord | null> {
    const [row] = await this.db.client.select().from(surveyReportingRightsAdmissions)
      .where(and(eq(surveyReportingRightsAdmissions.tenantId, tenantId), eq(surveyReportingRightsAdmissions.id, admissionId))).limit(1);
    return row ? toAdmission(row) : null;
  }

  async recordApplyAttempt(admission: ReportingRightsAdmissionRecord): Promise<number> {
    const [row] = await this.db.client.update(surveyReportingRightsAdmissions).set({ applyAttempts: sql`${surveyReportingRightsAdmissions.applyAttempts} + 1` })
      .where(and(eq(surveyReportingRightsAdmissions.tenantId, admission.tenantId), eq(surveyReportingRightsAdmissions.id, admission.id)))
      .returning({ attempts: surveyReportingRightsAdmissions.applyAttempts });
    if (!row) throw new Error('reporting_rights_admission_missing');
    return row.attempts;
  }

  async isTargetCurrent(admission: ReportingRightsAdmissionRecord): Promise<boolean> {
    if (admission.targetKind === 'full_reporting') return true;
    const rows = await this.db.client.execute(sql`select count(*)::int n from survey_report_question_lineages l
      where l.tenant_id = ${admission.tenantId}::uuid and l.user_id = ${admission.userId}::uuid
        and l.id = any(ARRAY[${sql.join(admission.lineageIds.map((id) => sql`${id}::uuid`), sql`, `)}]::uuid[])
        and (exists (select 1 from survey_reporting_lineage_exclusions e where e.lineage_id = l.id and e.request_id = ${admission.requestId})
          or (${OPEN_LINEAGE('l')}))`) as unknown as { n: number }[];
    return rows[0]?.n === admission.lineageIds.length;
  }

  async settle(admission: ReportingRightsAdmissionRecord, settlement: ReportingRightsSettlement) {
    return this.db.withTransaction(async () => {
      const tx = this.db.client;
      const [locked] = await tx.select().from(surveyReportingRightsAdmissions).where(and(
        eq(surveyReportingRightsAdmissions.tenantId, admission.tenantId), eq(surveyReportingRightsAdmissions.id, admission.id),
      )).for('update');
      if (!locked) throw new Error('reporting_rights_admission_missing');
      if (locked.status !== 'admitted') return { status: locked.status as ReportingRightsAdmissionRecord['status'], confirmationMessageId: locked.confirmationMessageId };
      const menu = await this.menu(admission.tenantId, admission.userId, admission.menuId);
      if (!menu) throw new Error('reporting_rights_menu_missing');
      // Every terminal outcome tells the employee, in the menu's language, what happened; texts are content-free.
      const resource = await this.rightsResource(menu.locale);
      let text: string;
      if (settlement.status === 'failed') text = reportingRightsText(resource, 'not_applied');
      else if (settlement.status === 'rejected') text = reportingRightsText(resource, 'stale');
      else if (admission.targetKind === 'full_reporting') text = reportingRightsText(resource, 'done.full');
      else {
        const titles = await this.topicTitles(admission.tenantId, admission.userId, admission.lineageIds, menu.locale);
        text = admission.lineageIds.every((id) => titles.has(id))
          ? reportingRightsText(resource, 'done.partial', { topic: admission.lineageIds.map((id) => titles.get(id)!).join(', ') })
          : reportingRightsText(resource, 'done.topic');
      }
      const confirmationMessageId = stableId('reporting-rights-settle', admission.id);
      await this.persistOutbound(menu, confirmationMessageId, text, { reportingRightsAdmissionId: admission.id, reportingRightsView: settlement.status === 'applied' ? 'done' : settlement.status === 'failed' ? 'not_applied' : 'stale' });
      await tx.update(surveyReportingRightsAdmissions).set({
        status: settlement.status, settledAt: sql`clock_timestamp()` as unknown as Date, confirmationMessageId,
        failureReason: settlement.status === 'applied' ? null : settlement.reason,
        permissionRevision: settlement.status === 'applied' ? settlement.receipt.permissionRevision : null,
      }).where(eq(surveyReportingRightsAdmissions.id, admission.id));
      return { status: settlement.status, confirmationMessageId };
    });
  }

  /** Persists the menu step for one click and returns the message-send job; idempotent per click. */
  async render(input: { tenantId: string; menuId: string; view: ReportingRightsRenderView; page: number; clickTs: string }): Promise<MessageSendJob | null> {
    const [menu] = await this.db.client.select().from(surveyReportingRightsMenus)
      .where(and(eq(surveyReportingRightsMenus.tenantId, input.tenantId), eq(surveyReportingRightsMenus.id, input.menuId))).limit(1);
    if (!menu) return null;
    const resource = await this.rightsResource(menu.locale);
    let text: string;
    let actions: OutgoingAction[] = [];
    const stale = () => { text = reportingRightsText(resource, 'stale'); actions = []; };
    if (input.view === 'topics') {
      if (menu.kind !== 'root') return null;
      if (!menu.lineageIds.length) {
        text = reportingRightsText(resource, 'topics.empty');
        actions = reportingRightsRootActions(menu.id, 0, resource);
      } else {
        const titles = await this.topicTitles(menu.tenantId, menu.userId, menu.lineageIds, menu.locale);
        const page = reportingRightsTopicButtons({ menuId: menu.id, lineageIds: menu.lineageIds, page: input.page, titles, resource });
        if (!page) stale();
        else {
          text = reportingRightsText(resource, 'topics.prompt', { topics: page.titles.map((title) => `• ${title}`).join('\n') });
          actions = page.actions;
        }
      }
    } else if (input.view === 'confirm') {
      if (menu.kind !== 'confirm') return null;
      const titles = await this.topicTitles(menu.tenantId, menu.userId, menu.lineageIds, menu.locale);
      if (menu.targetKind === 'partial_reporting' && !menu.lineageIds.every((id) => titles.has(id))) stale();
      else {
        text = menu.targetKind === 'full_reporting'
          ? reportingRightsText(resource, 'confirm.full')
          : reportingRightsText(resource, 'confirm.partial', { topic: menu.lineageIds.map((id) => titles.get(id)!).join(', ') });
        actions = [
          reportingRightsButton('confirm', reportingRightsText(resource, 'button.confirm'), reportingRightsButtonValue(menu.id)),
          reportingRightsButton('cancel', reportingRightsText(resource, 'button.cancel'), reportingRightsButtonValue(menu.id)),
        ].filter((action): action is OutgoingAction => action !== null);
      }
    } else if (input.view === 'cancelled') {
      text = reportingRightsText(resource, 'cancelled');
    } else if (input.view === 'already_submitted') {
      text = reportingRightsText(resource, 'already_submitted');
    } else {
      stale();
    }
    const messageId = stableId('reporting-rights-render', menu.id, input.view, String(input.page), input.clickTs);
    await this.persistOutbound(menu, messageId, text!, { reportingRightsView: input.view, ...(actions.length ? { reportingRightsActions: actions } : {}) });
    return this.sendJob(menu, messageId);
  }

  async messageSendJob(tenantId: string, messageId: string): Promise<MessageSendJob | null> {
    const [row] = await this.db.client.select({ menuId: sql<string>`${messages.metadata}->>'reportingRightsMenuId'` }).from(messages)
      .where(and(eq(messages.tenantId, tenantId), eq(messages.id, messageId))).limit(1);
    if (!row?.menuId) return null;
    const [menu] = await this.db.client.select().from(surveyReportingRightsMenus)
      .where(and(eq(surveyReportingRightsMenus.tenantId, tenantId), eq(surveyReportingRightsMenus.id, row.menuId))).limit(1);
    return menu ? this.sendJob(menu, messageId) : null;
  }

  /** Repair: admissions committed but never applied (lost Redis job, crash before settle). */
  async findUnapplied(limit = 100): Promise<{ tenantId: string; admissionId: string }[]> {
    const rows = await this.db.client.execute(sql`select tenant_id, id from survey_reporting_rights_admissions
      where status = 'admitted' and received_at < clock_timestamp() - interval '30 seconds' order by received_at, id limit ${limit}`) as unknown as { tenant_id: string; id: string }[];
    return rows.map((row) => ({ tenantId: row.tenant_id, admissionId: row.id }));
  }

  /** Repair: settled admissions whose confirmation DM was persisted but never attempted. */
  async findUnsentConfirmations(limit = 100): Promise<{ tenantId: string; messageId: string }[]> {
    const rows = await this.db.client.execute(sql`select a.tenant_id, a.confirmation_message_id from survey_reporting_rights_admissions a
      join messages m on m.id = a.confirmation_message_id and m.tenant_id = a.tenant_id
      where a.status in ('applied', 'rejected', 'failed') and a.settled_at < clock_timestamp() - interval '1 minute'
        and m.sent_at is null and m.delivery_attempted_at is null order by a.settled_at, a.id limit ${limit}`) as unknown as { tenant_id: string; confirmation_message_id: string }[];
    return rows.map((row) => ({ tenantId: row.tenant_id, messageId: row.confirmation_message_id }));
  }

  private async menu(tenantId: string, userId: string, menuId: string): Promise<MenuRow | null> {
    const [row] = await this.db.client.select().from(surveyReportingRightsMenus).where(and(
      eq(surveyReportingRightsMenus.tenantId, tenantId), eq(surveyReportingRightsMenus.userId, userId), eq(surveyReportingRightsMenus.id, menuId),
    )).limit(1);
    return row ?? null;
  }

  private sendJob(menu: MenuRow, messageId: string): MessageSendJob {
    return { messageId, tenantId: menu.tenantId, conversationId: menu.conversationId, channelType: menu.channelType, externalWorkspaceId: menu.externalWorkspaceId, externalChannelId: menu.externalChannelId };
  }

  private async persistOutbound(menu: MenuRow, id: string, text: string, metadata: Record<string, unknown>): Promise<void> {
    await this.db.client.insert(messages).values({
      id, tenantId: menu.tenantId, conversationId: menu.conversationId, userId: menu.userId, direction: 'outbound', senderType: 'agent',
      messageType: 'reporting_rights', text, occurredAt: new Date(),
      metadata: { reportingRightsProtocol: REPORTING_RIGHTS_PROTOCOL_VERSION, reportingRightsMenuId: menu.id, reportingRightsLocale: menu.locale, ...metadata },
    }).onConflictDoNothing();
  }

  /** Accepted `reporting_rights` resource for the locale; English source when the locale is unavailable. */
  private async rightsResource(locale: string): Promise<PulseLanguageResource | null> {
    if (locale === 'en') return null;
    return this.languages.read(locale, 'reporting_rights');
  }

  /** Titles keyed by lineage id; a lineage whose definition cannot be resolved is simply absent (stale). */
  private async topicTitles(tenantId: string, userId: string, lineageIds: string[], locale: string): Promise<Map<string, string>> {
    if (!lineageIds.length) return new Map();
    const rows = await this.db.client.execute(sql`select l.id, l.question_stable_key, q.title from survey_report_question_lineages l
      join survey_questions q on q.id = l.survey_question_id
      where l.tenant_id = ${tenantId}::uuid and l.user_id = ${userId}::uuid
        and l.id = any(ARRAY[${sql.join(lineageIds.map((id) => sql`${id}::uuid`), sql`, `)}]::uuid[])`) as unknown as { id: string; question_stable_key: string; title: string }[];
    const engagement = locale === 'en' ? null : await this.languages.read(locale, 'engagement');
    const definitions = locale === 'en' ? null : await this.languages.read(locale, 'definitions', tenantId);
    return new Map(rows.flatMap((row) => {
      const title = reportingRightsTopicTitle({ locale, stableKey: row.question_stable_key, title: row.title, engagement, definitions }).trim();
      return title ? [[row.id, title] as const] : [];
    }));
  }
}
