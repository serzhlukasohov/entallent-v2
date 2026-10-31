import { Injectable } from '@nestjs/common';
import type { QuestionFinalizationScope } from '@entalent/application';
import { sql } from 'drizzle-orm';
import { lockPulseReportSubject, pulseInputRows } from '@entalent/database';
import { DatabaseService } from '../../database/database.service';
export interface PulseProgressSource {
  tenantId: string;
  userId: string;
  conversationId: string;
  inboundMessageId: string;
}
/** Privileged normal processing adapter; never injected into report readers. */
@Injectable()
export class PulseReportProgressRepository {
  constructor(private readonly db: DatabaseService) {}
  async finalizationScope(source: PulseProgressSource): Promise<QuestionFinalizationScope> {
    const rows = await pulseInputRows(this.db.client, sql`select exists(
      select 1 from survey_report_inbound_work work
      join survey_report_window_bindings binding on binding.tenant_id=work.tenant_id
      join survey_report_participants participant on participant.id=binding.participant_id
        and participant.user_id=work.user_id
      where work.inbound_receipt_id=${source.inboundMessageId}::uuid
        and work.tenant_id=${source.tenantId}::uuid and work.user_id=${source.userId}::uuid
        and work.conversation_id=${source.conversationId}::uuid and work.trust='db-receipt-v1'
        and pulse_input_receipt_in_scope(work.tenant_id,work.user_id,binding.cycle_scoring_policy_id,work.received_at,null,false)
    ) as native`);
    return rows[0]?.native === true ? 'native_only' : 'legacy_only';
  }

  async completeEvidence(source: PulseProgressSource, apply: () => Promise<void>): Promise<void> {
    await this.db.withTransaction(async () => {
      await lockPulseReportSubject(this.db.client, source.tenantId, source.userId);
      await apply();
      await this.db.client.execute(
        sql`update survey_report_inbound_work set evidence='applied' where inbound_receipt_id=${source.inboundMessageId}::uuid and tenant_id=${source.tenantId}::uuid and user_id=${source.userId}::uuid and conversation_id=${source.conversationId}::uuid`,
      );
    });
  }
  async recoveryBatch(limit = 100) {
    return this.db.client.transaction(async (tx) => {
      const rows = await pulseInputRows(
        tx,
        sql`select w.inbound_receipt_id,w.tenant_id,w.user_id,w.conversation_id,w.capture,w.native_verdict,w.evidence,w.finalization,w.failure_code,
    a.external_workspace_id,a.external_conversation_id,a.event_id,a.request_id,a.trace_id,
    effect.inbound_message_id is not null committed,
    exists(select 1 from conversation_dispatch_intents i where i.inbound_message_id=w.inbound_receipt_id and i.kind='survey_evidence' and i.completed_at is null) evidence_pending
    from survey_report_inbound_work w
    left join conversation_job_admissions a on a.message_id=w.inbound_receipt_id and a.tenant_id=w.tenant_id and a.user_id=w.user_id
    left join conversation_turn_effects effect on effect.inbound_message_id=w.inbound_receipt_id and effect.tenant_id=w.tenant_id and effect.user_id=w.user_id
    where exists(select 1 from survey_report_participants p join survey_cycle_scoring_policies c on c.id=p.cycle_scoring_policy_id join survey_report_cycle_openings o on o.cycle_scoring_policy_id=c.id join survey_report_final_timings f on f.cycle_scoring_policy_id=c.id and f.tenant_id=c.tenant_id where p.tenant_id=w.tenant_id and p.user_id=w.user_id and f.status='started' and w.received_at>=greatest(c.period_start,o.opened_at) and w.received_at<least(c.period_end,coalesce(p.collection_stopped_at,c.period_end),f.report_data_cutoff))
     and (w.capture='pending' or w.native_verdict in ('pending','claimed','blocked') or w.evidence='pending' or w.finalization='pending')
    order by w.recovery_cursor_at,w.inbound_receipt_id limit ${limit} for update of w skip locked`,
      );
      for (const r of rows)
        await tx.execute(
          sql`update survey_report_inbound_work set recovery_cursor_at=clock_timestamp() where inbound_receipt_id=${String(r.inbound_receipt_id)}::uuid`,
        );
      return rows;
    });
  }
  async reconcileOnly(r: PulseProgressSource) {
    await this.db.client.execute(
      sql`update survey_report_inbound_work set failure_code='manual_reconciliation' where inbound_receipt_id=${r.inboundMessageId}::uuid and tenant_id=${r.tenantId}::uuid and user_id=${r.userId}::uuid`,
    );
  }
}
