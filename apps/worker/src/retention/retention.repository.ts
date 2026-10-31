import { lockPulseReportSubject, withPulseReportSerializableRetry } from '@entalent/database';
import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { DEFAULT_RETENTION_POLICY } from '@entalent/domain';
import type {
  RetentionCleanupParams,
  RetentionCleanupRepositoryPort,
  RetentionCleanupResult,
  RetentionPolicy,
  RetentionTenant,
} from '@entalent/application';
import { DatabaseService } from '../database/database.service';

type Row = Record<string, unknown>;

@Injectable()
export class RetentionRepository implements RetentionCleanupRepositoryPort {
  constructor(
    private readonly db: DatabaseService,
    private readonly tenantId?: string,
  ) {}

  async findRetentionTenants(): Promise<RetentionTenant[]> {
    const rows = await this.db.client.execute(
      this.tenantId
        ? sql`
          select id as tenant_id, retention_policy
          from tenants
          where status = 'active'
            and id = ${this.tenantId}::uuid
        `
        : sql`
          select id as tenant_id, retention_policy
          from tenants
          where status = 'active'
        `,
    ) as unknown as Row[];

    return rows.map((row) => ({
      tenantId: String(row['tenant_id']),
      retentionPolicy: normalizeRetentionPolicy(row['retention_policy']),
    }));
  }

  async applyRetention(params: RetentionCleanupParams): Promise<RetentionCleanupResult> {
    await this.cleanupReportInputMetadata(params);
    await this.cleanupEngagementAnswers(params);
    const now = params.now.toISOString();
    const messagesCutoff = params.messagesCutoff.toISOString();
    const memoryCutoff = params.memoryCutoff.toISOString();
    const riskSignalCutoff = params.riskSignalCutoff.toISOString();
    const auditLogCutoff = params.auditLogCutoff.toISOString();
    const [
      messagesDeleted,
      surveyEvidenceExpired,
      surveyAssessmentsExpired,
      memoryItemsExpired,
      riskSignalsExpired,
      temporaryGroupStatesExpired,
      confirmedGroupStatesExpired,
      withdrawnGroupStatesExpired,
      workingQuestionInsightsExpired,
      questionBundlesExpired,
      questionInsightsDeleted,
      reportSnapshotsDeleted,
      v2ReportSnapshotsDeleted,
    ] = await Promise.all([
      this.count(sql`
        update messages
        set deleted_at = coalesce(deleted_at, ${now}::timestamptz),
          text = '[deleted]', normalized_text = null, metadata = '{}'::jsonb
        where tenant_id = ${params.tenantId}::uuid
          and occurred_at < ${messagesCutoff}::timestamptz
          and (deleted_at is null or text <> '[deleted]'
            or normalized_text is not null or metadata <> '{}'::jsonb)
        returning id
      `),
      this.count(sql`
        update survey_evidence
        set superseded_at = coalesce(superseded_at, ${now}::timestamptz),
          evidence_summary = '[deleted]', source_message_ids = ARRAY[]::uuid[]
        where created_at < ${messagesCutoff}::timestamptz
          and (superseded_at is null or evidence_summary <> '[deleted]'
            or cardinality(source_message_ids) > 0)
          and exists (
            select 1
            from survey_windows
            where survey_windows.id = survey_evidence.survey_window_id
              and survey_windows.tenant_id = ${params.tenantId}::uuid
          )
        returning id
      `),
      this.count(sql`
        update survey_assessments
        set reasoning_summary = null, evidence_ids = ARRAY[]::uuid[],
          score = null, confidence = '0', status = 'suppressed'
        where calculated_at < ${messagesCutoff}::timestamptz
          and (reasoning_summary is not null or cardinality(evidence_ids) > 0
            or score is not null or status <> 'suppressed')
          and exists (
            select 1 from survey_windows
            where survey_windows.id = survey_assessments.survey_window_id
              and survey_windows.tenant_id = ${params.tenantId}::uuid
          )
        returning id
      `),
      this.count(sql`
        update memory_items
        set status = 'deleted', content = '[deleted]', structured_value = null,
          canonical_key = null, source_message_ids = ARRAY[]::uuid[],
          updated_at = ${now}::timestamptz
        where tenant_id = ${params.tenantId}::uuid
          and (created_at < ${memoryCutoff}::timestamptz
            or expires_at <= ${now}::timestamptz or status = 'deleted')
          and (status <> 'deleted' or content <> '[deleted]'
            or structured_value is not null or canonical_key is not null
            or cardinality(source_message_ids) > 0)
        returning id
      `),
      this.count(sql`
        update risk_signals
        set status = 'expired', resolved_at = coalesce(resolved_at, ${now}::timestamptz),
          recommended_action = null
        where tenant_id = ${params.tenantId}::uuid
          and (detected_at < ${riskSignalCutoff}::timestamptz
            or expires_at <= ${now}::timestamptz)
          and (status <> 'expired' or recommended_action is not null)
        returning id
      `),
      this.count(sql`
        update survey_group_states
        set
          status = 'expired',
          ai_summary = null,
          employee_score = null,
          personal_recs = null,
          deidentification_decision = null,
          confirmation_prompt_message_id = null,
          confirmed_at = null,
          reporting_disclosure_version = null,
          reporting_disclosure_shown_at = null,
          confirmation_message_id = null,
          withdrawn_at = null,
          withdrawal_message_id = null,
          updated_at = ${now}::timestamptz
        where tenant_id = ${params.tenantId}::uuid
          and status in ('in_progress', 'pending_confirmation', 'awaiting_confirmation')
          and created_at < ${memoryCutoff}::timestamptz
        returning id
      `),
      this.count(sql`
        update survey_group_states
        set
          status = 'expired',
          ai_summary = null,
          employee_score = null,
          personal_recs = null,
          deidentification_decision = null,
          confirmation_prompt_message_id = null,
          confirmed_at = null,
          reporting_disclosure_version = null,
          reporting_disclosure_shown_at = null,
          confirmation_message_id = null,
          report_sent_at = null,
          updated_at = ${now}::timestamptz
        where tenant_id = ${params.tenantId}::uuid
          and status = 'confirmed'
          and confirmed_at < ${memoryCutoff}::timestamptz
        returning id
      `),
      this.count(sql`
        update survey_group_states
        set
          status = 'expired',
          ai_summary = null,
          employee_score = null,
          personal_recs = null,
          deidentification_decision = null,
          confirmation_prompt_message_id = null,
          confirmed_at = null,
          reporting_disclosure_version = null,
          reporting_disclosure_shown_at = null,
          confirmation_message_id = null,
          withdrawn_at = null,
          withdrawal_message_id = null,
          report_sent_at = null,
          updated_at = ${now}::timestamptz
        where tenant_id = ${params.tenantId}::uuid
          and status = 'withdrawn'
          and withdrawn_at < ${auditLogCutoff}::timestamptz
        returning id
      `),
      this.count(sql`
        update survey_question_working_insights
        set status = 'no_data', ready_for_confirmation = false,
          working_summary = null, confirmed_semantic_summary = null,
          source_message_ids = ARRAY[]::uuid[], confirmation_bundle_id = null,
          clarification_prompt_message_id = null, confirmation_message_id = null,
          confirmed_at = null, purged_at = ${now}::timestamptz,
          updated_at = ${now}::timestamptz
        where tenant_id = ${params.tenantId}::uuid
          and created_at < ${memoryCutoff}::timestamptz
          and purged_at is null
        returning id
      `),
      this.count(sql`
        update survey_question_confirmation_bundles
        set displayed_text = null, components = null,
          status = 'purged', purged_at = ${now}::timestamptz
        where tenant_id = ${params.tenantId}::uuid
          and created_at < ${memoryCutoff}::timestamptz
          and purged_at is null
        returning id
      `),
      // Revision receipt metadata cascades with expired insights; content-free lineage exclusions
      // and negative permission state deliberately survive analytical retention until subject erasure.
      this.count(sql`
        with subjects as materialized (
          select pg_advisory_xact_lock(hashtextextended('pulse-report-subject:'||${params.tenantId}::uuid::text||':'||subject.user_id::text,0))
          from (select distinct user_id from survey_question_insights where tenant_id=${params.tenantId}::uuid order by user_id) subject
        ), expired as (
          delete from survey_question_insights
          where tenant_id = ${params.tenantId}::uuid
            and processed_at < ${memoryCutoff}::timestamptz
            and (select count(*) from subjects)>=0
          returning id, tenant_id, user_id, survey_window_id,
            survey_question_id, withdrawn_at
        ), retained as (
          insert into audit_logs
            (tenant_id, actor_type, actor_id, action, resource_type,
              resource_id, reason, metadata, idempotency_key, created_at)
          select expired.tenant_id, 'system', 'retention-cleanup',
            'v2.question_insight_withdrawal_retained', 'survey_question_insight',
            expired.id::text, 'Content-free withdrawal history after insight retention',
            jsonb_build_object(
              'userId', expired.user_id, 'surveyWindowId', expired.survey_window_id,
              'surveyQuestionId', expired.survey_question_id,
              'withdrawnAt', expired.withdrawn_at),
            'v2-retention-withdrawal:' || expired.id::text, expired.withdrawn_at
          from expired where expired.withdrawn_at is not null
          on conflict (tenant_id, idempotency_key) do nothing
          returning id
        )
        select expired.id from expired
        cross join (select count(*) from retained) audit_receipt
      `),
      this.count(sql`
        delete from survey_report_snapshots
        where tenant_id = ${params.tenantId}::uuid
          and created_at < ${auditLogCutoff}::timestamptz
        returning id
      `),
      this.count(sql`
        delete from survey_v2_report_snapshots
        where tenant_id = ${params.tenantId}::uuid
          and created_at < ${auditLogCutoff}::timestamptz
        returning id
      `),
    ]);
    const auditLogsDeleted = await this.count(sql`
      delete from audit_logs
      where tenant_id = ${params.tenantId}::uuid
        and created_at < ${auditLogCutoff}::timestamptz
      returning id
    `);

    return {
      messagesDeleted,
      surveyEvidenceExpired,
      surveyAssessmentsExpired,
      memoryItemsExpired,
      riskSignalsExpired,
      temporaryGroupStatesExpired,
      confirmedGroupStatesExpired,
      withdrawnGroupStatesExpired,
      workingQuestionInsightsExpired,
      questionBundlesExpired,
      questionInsightsDeleted,
      auditLogsDeleted,
      reportSnapshotsDeleted: reportSnapshotsDeleted + v2ReportSnapshotsDeleted,
    };
  }

  private async cleanupReportInputMetadata(params:RetentionCleanupParams):Promise<void>{
    await withPulseReportSerializableRetry(()=>this.db.client.transaction(async tx=>{
      await tx.execute(sql`select pulse_publication_payload_purge(${params.tenantId}::uuid,${params.auditLogCutoff.toISOString()}::timestamptz)`);
      await tx.execute(sql`update survey_report_input_coverage set supported_from=greatest(supported_from,${params.auditLogCutoff.toISOString()}::timestamptz) where tenant_id=${params.tenantId}::uuid`);
      await tx.execute(sql`update survey_report_input_candidates set invalidated_at=coalesce(invalidated_at,clock_timestamp()) where tenant_id=${params.tenantId}::uuid and (expires_at<=clock_timestamp() or (context->>'periodStart')::timestamptz<${params.auditLogCutoff.toISOString()}::timestamptz)`);
      await tx.execute(sql`delete from survey_report_input_candidates c where tenant_id=${params.tenantId}::uuid and expires_at<=clock_timestamp() and not exists(select 1 from survey_report_final_completions f where f.candidate_id=c.id)`);
      await tx.execute(sql`delete from survey_report_inbound_work where tenant_id=${params.tenantId}::uuid and recorded_at<${params.auditLogCutoff.toISOString()}::timestamptz`);
      await tx.execute(sql`delete from survey_report_shown_components where tenant_id=${params.tenantId}::uuid and recorded_at<${params.auditLogCutoff.toISOString()}::timestamptz`);
      await tx.execute(sql`delete from survey_report_topic_watermarks where tenant_id=${params.tenantId}::uuid and confirmation_received_at<${params.auditLogCutoff.toISOString()}::timestamptz`);
    }));
  }

  private async cleanupEngagementAnswers(params: RetentionCleanupParams): Promise<void> {
    const subjects = await this.db.client.execute(sql`select distinct user_id from (
      select user_id from survey_engagement_capture_events where tenant_id=${params.tenantId}::uuid
      union select w.user_id from survey_windows w join survey_report_window_bindings b on b.survey_window_id=w.id
        join survey_engagement_contract_questions q on q.survey_definition_id=w.survey_definition_id
        where w.tenant_id=${params.tenantId}::uuid
    ) subjects order by user_id`) as unknown as { user_id: string }[];
    for (const subject of subjects) await this.db.client.transaction(async (tx) => {
      await lockPulseReportSubject(tx, params.tenantId, subject.user_id);
      // Write content-free replay tombstones before the generic private-message cleanup.
      await tx.execute(sql`insert into survey_engagement_capture_events(inbound_receipt_id,tenant_id,user_id,status,answer_received_at)
        select id,tenant_id,user_id,'source_deleted',received_at from messages where tenant_id=${params.tenantId}::uuid
          and user_id=${subject.user_id}::uuid and direction='inbound' and received_at is not null
          and occurred_at<${params.messagesCutoff.toISOString()}::timestamptz on conflict do nothing`);
      await tx.execute(sql`update survey_engagement_capture_events e set status='expired' where e.tenant_id=${params.tenantId}::uuid
        and e.user_id=${subject.user_id}::uuid and e.status='accepted' and exists(select 1 from survey_engagement_answer_revisions a
          where a.inbound_receipt_id=e.inbound_receipt_id and (a.answer_received_at<=clock_timestamp()-(engagement_retention_days((select retention_policy from tenants where id=${params.tenantId}::uuid))*interval '1 day') or a.expires_at<=clock_timestamp()))`);
      await tx.execute(sql`delete from survey_engagement_answer_revisions where tenant_id=${params.tenantId}::uuid
        and user_id=${subject.user_id}::uuid and (answer_received_at<=clock_timestamp()-(engagement_retention_days((select retention_policy from tenants where id=${params.tenantId}::uuid))*interval '1 day') or expires_at<=clock_timestamp())`);
    });
  }

  private async count(statement: SQL): Promise<number> {
    const rows = await withPulseReportSerializableRetry(()=>this.db.client.execute(statement)) as unknown as unknown[];
    return rows.length;
  }
}

function normalizeRetentionPolicy(value: unknown): RetentionPolicy {
  const policy = isRow(value) ? value : {};
  return {
    messagesRetentionDays: readPositiveNumber(policy['messagesRetentionDays'], DEFAULT_RETENTION_POLICY.messagesRetentionDays),
    memoryRetentionDays: readPositiveNumber(policy['memoryRetentionDays'], DEFAULT_RETENTION_POLICY.memoryRetentionDays),
    riskSignalRetentionDays: readPositiveNumber(policy['riskSignalRetentionDays'], DEFAULT_RETENTION_POLICY.riskSignalRetentionDays),
    auditLogRetentionDays: readPositiveNumber(policy['auditLogRetentionDays'], DEFAULT_RETENTION_POLICY.auditLogRetentionDays),
  };
}

function readPositiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isRow(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
