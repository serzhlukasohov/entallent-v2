import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type {
  PulseCompletedFinal,
  PulseInputContext,
  PulseMetricCandidate,
} from '@entalent/contracts';
import type { PulseReportHistoryRepositoryPort } from '@entalent/application';
import {
  type PulseReportExecutor,
  pulseInputRows,
  pulseCandidateAuthorizationToken,
} from '@entalent/database';
import { DatabaseService } from '../../database/database.service';
@Injectable()
export class PulseReportHistoryRepository implements PulseReportHistoryRepositoryPort {
  constructor(private readonly db: DatabaseService) {}
  async completed(tenantId: string, historyKey: string): Promise<PulseCompletedFinal[]> {
    return readCompletedPulseFinals(this.db.client, tenantId, historyKey);
  }
}

export async function readCompletedPulseFinals(
  tx: PulseReportExecutor,
  tenantId: string,
  historyKey: string,
): Promise<PulseCompletedFinal[]> {
  const rows = await pulseInputRows(
    tx,
    sql`select c.id from survey_report_final_completions f join survey_report_input_candidates c on c.id=f.candidate_id join survey_report_native_snapshots native on native.id=f.canonical_snapshot_id and native.tenant_id=c.tenant_id and native.cycle_id=c.cycle_id and native.purpose='final' where c.tenant_id=${tenantId}::uuid and c.purpose='final' and c.context->>'historyKey'=${historyKey}`,
  );
  return readPulseFinalCandidates(
    tx,
    tenantId,
    historyKey,
    rows.map((r) => String(r.id)),
  );
}
/** Restricted inventory seam also permits synthetic completed-history fixtures without bypassing the completion guard. */
export async function readPulseFinalCandidates(
  tx: PulseReportExecutor,
  tenantId: string,
  historyKey: string,
  candidateIds: readonly string[],
): Promise<PulseCompletedFinal[]> {
  if (!candidateIds.length) return [];

  const rows = await pulseInputRows(
    tx,
    sql`select c.id candidate_id,${pulseCandidateAuthorizationToken()} authorization_token,c.context,c.metrics,c.invalidated_at is null and c.expires_at>clock_timestamp() and not exists(select 1 from survey_report_candidate_sources s left join users u on u.id=s.user_id and u.tenant_id=s.tenant_id left join survey_reporting_permissions p on p.tenant_id=s.tenant_id and p.user_id=s.user_id where s.candidate_id=c.id and (u.id is null or u.deleted_at is not null or u.status='deleted' or coalesce(p.full_reporting_denied,false) or exists(select 1 from survey_reporting_lineage_exclusions x where x.lineage_id=s.lineage_id) or not (exists(select 1 from survey_report_topic_watermarks w join survey_question_insights i on i.id=w.insight_id join tenants t on t.id=w.tenant_id where w.insight_id=s.revision_id and w.lineage_id=s.lineage_id and w.state='retained' and w.expires_at>clock_timestamp() and i.withdrawn_at is null and i.processed_at>clock_timestamp()-engagement_retention_days(t.retention_policy)*interval '1 day') or exists(select 1 from survey_engagement_answer_revisions a join survey_engagement_capture_events e on e.inbound_receipt_id=a.inbound_receipt_id join tenants t on t.id=a.tenant_id where a.inbound_receipt_id=s.revision_id and a.lineage_id=s.lineage_id and e.status='accepted' and a.expires_at>clock_timestamp() and a.answer_received_at>clock_timestamp()-engagement_retention_days(t.retention_policy)*interval '1 day')))) authorized from survey_report_input_candidates c where c.id=any(${'{' + candidateIds.join(',') + '}'}::uuid[]) and c.tenant_id=${tenantId}::uuid and c.purpose='final' and c.context->>'historyKey'=${historyKey} order by c.context->>'periodEnd' desc,c.context->>'periodStart' desc`,
  );
  return rows.map((r) => {
    const c = r.context as PulseInputContext;
    return {
      candidateId: String(r.candidate_id),
      authorizationToken: String(r.authorization_token),
      cycleId: c.cycleId,
      periodStart: c.periodStart,
      periodEnd: c.periodEnd,
      historyKey: c.historyKey,
      boundaryFingerprint: c.boundaryFingerprint,
      compositionFingerprint: c.compositionFingerprint,
      compatibilitySignature: c.compatibilitySignature,
      authorized: Boolean(r.authorized),
      metrics: r.metrics as PulseMetricCandidate[],
    };
  });
}
