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
    const [
      messagesDeleted,
      surveyEvidenceExpired,
      memoryItemsExpired,
      riskSignalsExpired,
      temporaryGroupStatesExpired,
      confirmedGroupStatesExpired,
      withdrawnGroupStatesExpired,
      auditLogsDeleted,
      reportSnapshotsDeleted,
    ] = await Promise.all([
      this.count(sql`
        update messages
        set deleted_at = ${params.now}
        where tenant_id = ${params.tenantId}::uuid
          and occurred_at < ${params.messagesCutoff}
          and deleted_at is null
        returning id
      `),
      this.count(sql`
        update survey_evidence
        set superseded_at = ${params.now}
        where created_at < ${params.messagesCutoff}
          and superseded_at is null
          and exists (
            select 1
            from survey_windows
            where survey_windows.id = survey_evidence.survey_window_id
              and survey_windows.tenant_id = ${params.tenantId}::uuid
          )
        returning id
      `),
      this.count(sql`
        update memory_items
        set status = 'deleted', updated_at = ${params.now}
        where tenant_id = ${params.tenantId}::uuid
          and status <> 'deleted'
          and (created_at < ${params.memoryCutoff} or expires_at <= ${params.now})
        returning id
      `),
      this.count(sql`
        update risk_signals
        set status = 'expired', resolved_at = ${params.now}
        where tenant_id = ${params.tenantId}::uuid
          and status = 'active'
          and (detected_at < ${params.riskSignalCutoff} or expires_at <= ${params.now})
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
          updated_at = ${params.now}
        where tenant_id = ${params.tenantId}::uuid
          and status in ('in_progress', 'pending_confirmation', 'awaiting_confirmation')
          and created_at < ${params.memoryCutoff}
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
          updated_at = ${params.now}
        where tenant_id = ${params.tenantId}::uuid
          and status = 'confirmed'
          and confirmed_at < ${params.memoryCutoff}
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
          updated_at = ${params.now}
        where tenant_id = ${params.tenantId}::uuid
          and status = 'withdrawn'
          and withdrawn_at < ${params.auditLogCutoff}
        returning id
      `),
      this.count(sql`
        delete from audit_logs
        where tenant_id = ${params.tenantId}::uuid
          and created_at < ${params.auditLogCutoff}
        returning id
      `),
      this.count(sql`
        delete from survey_report_snapshots
        where tenant_id = ${params.tenantId}::uuid
          and created_at < ${params.auditLogCutoff}
        returning id
      `),
    ]);

    return {
      messagesDeleted,
      surveyEvidenceExpired,
      memoryItemsExpired,
      riskSignalsExpired,
      temporaryGroupStatesExpired,
      confirmedGroupStatesExpired,
      withdrawnGroupStatesExpired,
      auditLogsDeleted,
      reportSnapshotsDeleted,
    };
  }

  private async count(statement: SQL): Promise<number> {
    const rows = await this.db.client.execute(statement) as unknown as unknown[];
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
