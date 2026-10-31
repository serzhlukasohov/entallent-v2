import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { parseLiteralEngagementAnswer, DEFAULT_RETENTION_POLICY } from '@entalent/domain';
import { engagementProbeSchema, ENGAGEMENT_ANSWER_CONTRACT } from '@entalent/contracts';
import type { CaptureEngagementAnswerInput, EngagementAnswerRepositoryPort, EngagementCaptureResult } from '@entalent/application';
import { lockPulseReportSubject } from '@entalent/database';
import { DatabaseService } from '../../database/database.service';

type Row = Record<string, unknown>;
@Injectable()
export class EngagementAnswerRepository implements EngagementAnswerRepositoryPort {
  constructor(private readonly db: DatabaseService) {}

  async capture(input: CaptureEngagementAnswerInput): Promise<EngagementCaptureResult> {
    return this.db.client.transaction(async (tx) => {
      await lockPulseReportSubject(tx, input.tenantId, input.userId);
      const notApplicable = async (): Promise<EngagementCaptureResult> => {
        await tx.execute(sql`update survey_report_inbound_work set capture='not_applicable' where inbound_receipt_id=${input.inboundMessageId}::uuid and tenant_id=${input.tenantId}::uuid and user_id=${input.userId}::uuid`);
        return { status: 'not_applicable', replayed: false };
      };
      const existing = await tx.execute(sql`select status,tenant_id,user_id from survey_engagement_capture_events where inbound_receipt_id=${input.inboundMessageId}::uuid`) as unknown as Row[];
      if (existing[0]) {
        if (existing[0]['tenant_id'] !== input.tenantId || existing[0]['user_id'] !== input.userId) throw new Error('engagement_source_ownership_mismatch');
        return { status: existing[0]['status'] as EngagementCaptureResult['status'], replayed: true };
      }
      const applicable = await tx.execute(sql`select 1 from survey_windows w
        join survey_report_window_bindings b on b.survey_window_id=w.id and b.tenant_id=w.tenant_id
        join survey_engagement_collection_contracts c on c.survey_definition_id=w.survey_definition_id and c.tenant_id=w.tenant_id
        where w.tenant_id=${input.tenantId}::uuid and w.user_id=${input.userId}::uuid limit 1`) as unknown as Row[];
      if (!applicable.length) return notApplicable();
      const sources = await tx.execute(sql`select m.*,m.received_at::text as receipt_time,t.retention_policy,
        clock_timestamp()::text as database_now from messages m join conversations c on c.id=m.conversation_id and c.tenant_id=m.tenant_id and c.user_id=m.user_id join tenants t on t.id=m.tenant_id
        where m.id=${input.inboundMessageId}::uuid and m.tenant_id=${input.tenantId}::uuid and m.user_id=${input.userId}::uuid and m.conversation_id=${input.conversationId}::uuid and m.direction='inbound'`) as unknown as Row[];
      const source = sources[0];
      if (source && !source['receipt_time'] && !source['persisted_at']) return notApplicable();
      if (!source || !source['receipt_time']) throw new Error('engagement_source_proof_unavailable');
      const received = String(source['receipt_time']);
      const terminal = async (status: Exclude<EngagementCaptureResult['status'], 'not_applicable'>, windowId: string | null = null, lineage: string | null = null) => {
        await tx.execute(sql`insert into survey_engagement_capture_events(inbound_receipt_id,tenant_id,user_id,status,answer_received_at,survey_window_id,lineage_id,contract_version)
          values(${input.inboundMessageId}::uuid,${input.tenantId}::uuid,${input.userId}::uuid,${status},${received}::timestamptz,${windowId}::uuid,${lineage}::uuid,${ENGAGEMENT_ANSWER_CONTRACT})`);
        return { status, replayed: false };
      };
      if (source['deleted_at']) return terminal('source_deleted');
      const policy = source['retention_policy'] as Record<string, unknown> | null;
      const configured = Number(policy?.['memoryRetentionDays']);
      const days = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_RETENTION_POLICY.memoryRetentionDays;
      const times = await tx.execute(sql`select (${received}::timestamptz + (${days}::numeric * interval '1 day'))::text as expires_at,
        ${received}::timestamptz + (${days}::numeric * interval '1 day') <= clock_timestamp() as expired`) as unknown as Row[];
      if (times[0]?.['expired']) return terminal('expired');
      // Delivery order is provider order; acknowledgement and attempt clocks prevent retrospective binding.
      const ambiguous = await tx.execute(sql`select delivery_recorded_at from messages
        where tenant_id=${input.tenantId}::uuid and user_id=${input.userId}::uuid and conversation_id=${input.conversationId}::uuid
          and direction='outbound'
          and engagement_delivery_ambiguous(persisted_at,delivery_attempted_at,delivery_recorded_at,${received}::timestamptz)
        order by delivery_recorded_at nulls first limit 1`) as unknown as Row[];
      if (ambiguous[0]) {
        if (!ambiguous[0]['delivery_recorded_at']) throw new Error('engagement_delivery_proof_unavailable');
        return terminal('ineligible');
      }
      const prompts = await tx.execute(sql`select id,sent_at::text as delivered_at,delivery_recorded_at::text as acknowledgement_at,metadata,text,deleted_at,engagement_delivery_proof,
        encode(sha256(convert_to(text,'UTF8')),'hex') as form_hash from messages
        where tenant_id=${input.tenantId}::uuid and user_id=${input.userId}::uuid and conversation_id=${input.conversationId}::uuid
          and direction='outbound' and sent_at<${received}::timestamptz and delivery_recorded_at<${received}::timestamptz
        order by sent_at desc,id desc limit 1`) as unknown as Row[];
      const prompt = prompts[0];
      const parsed = engagementProbeSchema.safeParse((prompt?.['metadata'] as Row | undefined)?.['engagementProbe']);
      if (prompt?.['deleted_at']) return terminal('ineligible');
      if (!parsed.success) {
        const metadata = prompt?.['metadata'] as Row | undefined;
        if (metadata?.['engagementProbe'] !== undefined) throw new Error('engagement_prompt_proof_unavailable');
        return notApplicable();
      }
      const probe = parsed.data;
      if (!prompt!['engagement_delivery_proof'] || probe.displayedFormHash !== prompt!['form_hash']) throw new Error('engagement_prompt_proof_unavailable');
      const windows = await tx.execute(sql`select w.id,b.cycle_scoring_policy_id,
        pulse_report_lineage(w.id,q.survey_question_id) as lineage_id
        from survey_windows w join survey_engagement_contract_questions q on q.survey_definition_id=w.survey_definition_id
        join survey_report_window_bindings b on b.survey_window_id=w.id and b.tenant_id=w.tenant_id
        join survey_engagement_collection_contracts envelope on envelope.survey_definition_id=w.survey_definition_id and envelope.tenant_id=w.tenant_id and envelope.contract_version=q.contract_version
        join survey_definitions d on d.id=w.survey_definition_id
        where w.id=${probe.surveyWindowId}::uuid and w.tenant_id=${input.tenantId}::uuid and w.user_id=${input.userId}::uuid
          and w.survey_definition_id=${probe.surveyDefinitionId}::uuid and q.survey_question_id=${probe.questionId}::uuid
          and q.question_version=${probe.questionVersion} and q.stable_key=${probe.stableKey} and q.contract_version=${probe.contractVersion}
          and d.version='v2-report-engagement-1.0.0' and d.configuration->>'engagementAnswerContract'=${probe.contractVersion}
          and ${received}::timestamptz>=w.period_end-interval '14 days'`) as unknown as Row[];
      const window = windows[0];
      if (!window || !window['lineage_id']) return terminal('ineligible');
      const lineage = String(window['lineage_id']);
      const admission = await tx.execute(sql`select pulse_report_admission(${input.tenantId}::uuid,${input.userId}::uuid,${probe.surveyWindowId}::uuid,${probe.questionId}::uuid,${input.inboundMessageId}::uuid) as decision`) as unknown as Row[];
      const decision = admission[0]?.['decision'];
      if (decision === 'missing_proof') throw new Error('engagement_admission_proof_unavailable');
      if (decision !== 'allowed') return terminal(decision === 'full_withdrawal' || decision === 'lineage_excluded' ? 'withdrawn' : 'ineligible', probe.surveyWindowId, lineage);
      const value = parseLiteralEngagementAnswer(String(source['text']));
      if (value === null) return terminal('invalid', probe.surveyWindowId, lineage);
      await terminal('accepted', probe.surveyWindowId, lineage);
      await tx.execute(sql`insert into survey_engagement_answer_revisions(inbound_receipt_id,tenant_id,user_id,survey_window_id,cycle_scoring_policy_id,lineage_id,survey_definition_id,survey_question_id,question_version,stable_key,contract_version,value,answer_received_at,prompt_message_id,prompt_sent_at,prompt_acknowledged_at,displayed_form_hash,permission_revision,proof_kind,expires_at)
        values(${input.inboundMessageId}::uuid,${input.tenantId}::uuid,${input.userId}::uuid,${probe.surveyWindowId}::uuid,${window['cycle_scoring_policy_id']}::uuid,${lineage}::uuid,${probe.surveyDefinitionId}::uuid,${probe.questionId}::uuid,${probe.questionVersion},${probe.stableKey},${probe.contractVersion},${value},${received}::timestamptz,${String(prompt!['id'])}::uuid,${String(prompt!['delivered_at'])}::timestamptz,${String(prompt!['acknowledgement_at'])}::timestamptz,${probe.displayedFormHash},coalesce((select revision from survey_reporting_permissions where tenant_id=${input.tenantId}::uuid and user_id=${input.userId}::uuid),0),'direct_explicit_answer',${String(times[0]!['expires_at'])}::timestamptz)`);
      return { status: 'accepted', replayed: false };
    }, { isolationLevel: 'read committed' });
  }

  async captureConversation(input: Omit<CaptureEngagementAnswerInput, 'inboundMessageId'>): Promise<void> {
    const rows = await this.db.client.execute(sql`select id from messages where tenant_id=${input.tenantId}::uuid and user_id=${input.userId}::uuid and conversation_id=${input.conversationId}::uuid and direction='inbound' order by received_at,id`) as unknown as Row[];
    for (const row of rows) await this.capture({ ...input, inboundMessageId: String(row['id']) });
  }

  async reconcileBacklog(input: { tenantId: string; userId: string; surveyWindowId: string; coverageSnapshotAt: Date }): Promise<string[]> {
    return this.db.client.transaction(async tx => {
      await lockPulseReportSubject(tx, input.tenantId, input.userId);
      const questions = await tx.execute(sql`select q.survey_question_id,
          pulse_report_admission(w.tenant_id,w.user_id,w.id,q.survey_question_id) as decision,
          clock_timestamp()>=w.period_end-interval '14 days' and clock_timestamp()<w.period_end as unlocked
        from survey_windows w join survey_report_window_bindings b on b.survey_window_id=w.id and b.tenant_id=w.tenant_id
        join survey_engagement_collection_contracts envelope on envelope.survey_definition_id=w.survey_definition_id and envelope.tenant_id=w.tenant_id
        join survey_engagement_contract_questions q on q.survey_definition_id=envelope.survey_definition_id and q.contract_version=envelope.contract_version
        join survey_questions question on question.id=q.survey_question_id
        where w.id=${input.surveyWindowId}::uuid and w.tenant_id=${input.tenantId}::uuid and w.user_id=${input.userId}::uuid
        order by question.display_order,q.survey_question_id`) as unknown as Row[];
      const covered = new Set((await tx.execute(this.coverageQuery(input.tenantId,input.userId,input.surveyWindowId)) as unknown as Row[]).map(r => String(r['survey_question_id'])));
      const allowedCovered: string[] = [];
      for (const question of questions) {
        const id=String(question['survey_question_id']);
        const allowed=question['decision']==='allowed';
        const done=!allowed || covered.has(id);
        if (allowed && covered.has(id)) allowedCovered.push(id);
        if (allowed && question['unlocked']) await tx.execute(sql`insert into pulse_backlog(survey_window_id,tenant_id,user_id,survey_question_id,position,status)
          select ${input.surveyWindowId}::uuid,${input.tenantId}::uuid,${input.userId}::uuid,${id}::uuid,coalesce(max(position),0)+1,${done ? 'done' : 'pending'}
          from pulse_backlog where survey_window_id=${input.surveyWindowId}::uuid and tenant_id=${input.tenantId}::uuid and user_id=${input.userId}::uuid on conflict do nothing`);
        if (done) await tx.execute(sql`update pulse_backlog set status='done',done_at=clock_timestamp(),updated_at=clock_timestamp()
          where tenant_id=${input.tenantId}::uuid and user_id=${input.userId}::uuid and survey_window_id=${input.surveyWindowId}::uuid and survey_question_id=${id}::uuid
            and status in ('pending','active')`);
        else await tx.execute(sql`update pulse_backlog set status='pending',done_at=null,resulted_in_coverage=null,updated_at=clock_timestamp()
          where tenant_id=${input.tenantId}::uuid and user_id=${input.userId}::uuid and survey_window_id=${input.surveyWindowId}::uuid and survey_question_id=${id}::uuid
            and status='done' and updated_at<=${input.coverageSnapshotAt.toISOString()}::timestamptz`);
      }
      return allowedCovered;
    }, { isolationLevel: 'read committed' });
  }

  async coveredQuestionIds(tenantId: string, userId: string, surveyWindowId: string): Promise<string[]> {
    const rows = await this.db.client.execute(this.coverageQuery(tenantId, userId, surveyWindowId)) as unknown as Row[];
    return rows.map((row) => String(row['survey_question_id']));
  }

  private coverageQuery(tenantId: string, userId: string, surveyWindowId: string) {
    return sql`select distinct a.survey_question_id from survey_engagement_answer_revisions a
      join survey_engagement_capture_events e on e.inbound_receipt_id=a.inbound_receipt_id and e.status='accepted'
      join tenants t on t.id=a.tenant_id
      left join survey_reporting_permissions p on p.tenant_id=a.tenant_id and p.user_id=a.user_id
      where a.tenant_id=${tenantId}::uuid and a.user_id=${userId}::uuid and a.survey_window_id=${surveyWindowId}::uuid
        and a.contract_version='engagement-1-10-v1' and a.expires_at>clock_timestamp() and a.answer_received_at>clock_timestamp()-(engagement_retention_days(t.retention_policy)*interval '1 day') and not coalesce(p.full_reporting_denied,false)
        and not exists(select 1 from survey_reporting_lineage_exclusions x where x.lineage_id=a.lineage_id)
        and not exists(select 1 from survey_engagement_capture_events later where later.tenant_id=a.tenant_id and later.user_id=a.user_id and later.lineage_id=a.lineage_id
          and later.status in ('accepted','expired','withdrawn','source_deleted') and (later.answer_received_at,later.inbound_receipt_id)>(a.answer_received_at,a.inbound_receipt_id))`;
  }
}
