import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type {
  PulseAllowedDataset,
  PulseAllowedTopic,
  PulseInputRequest,
  PulseMetricCandidate,
  PulsePreparationResult,
  PulseInputContext,
  PulsePreparedSet,
} from '@entalent/contracts';
import {
  PULSE_REPORT_CALCULATION_CONTRACT,
  PULSE_REPORT_PRIVACY_POLICY_VERSION,
} from '@entalent/contracts';
import type { PulseReportInputRepositoryPort } from '@entalent/application';
import {
  observePulseInputFrontier,
  pulseCandidateAuthorizationToken,
  withPulsePresentationFrame,
  pulseInputRows,
  withPulseReportSerializableRetry,
  type PulseReportExecutor,
} from '@entalent/database';
import { DatabaseService } from '../../database/database.service';
/** Permanent analytical/proof/progress access only. This class cannot read private message or working tables. */
@Injectable()
export class PulseReportInputRepository implements PulseReportInputRepositoryPort {
  constructor(private readonly db: DatabaseService) {}
  async prepare(
    input: PulseInputRequest,
    compute: (d: PulseAllowedDataset) => {
      metrics: PulseMetricCandidate[];
      finalGate: 'eligible' | 'insufficient_data' | null;
    },
  ): Promise<PulsePreparationResult> {
    return withPulseReportSerializableRetry(() =>
      this.db.client.transaction(
        async (tx) => {
          return this.prepareInTransaction(tx, input, compute);
        },
        { isolationLevel: 'read committed' },
      ),
    );
  }
  async preparePresentationSet(
    inputs: readonly PulseInputRequest[],
    compute: (d: PulseAllowedDataset) => {
      metrics: PulseMetricCandidate[];
      finalGate: 'eligible' | 'insufficient_data' | null;
    },
  ): Promise<PulsePreparedSet> {
    return withPulseReportSerializableRetry(() =>
      this.db.client.transaction(
        async (tx) => {
          const result = await withPulsePresentationFrame(tx, inputs, async () => {
            const sections = [];
            for (const input of inputs) {
              const prepared = await this.prepareInTransaction(tx, input, compute);
              if (prepared.status !== 'prepared') return prepared;
              sections.push(prepared);
            }
            return { status: 'prepared' as const, sections };
          });
          if (result.status !== 'prepared' && !('reason' in result))
            return { status: 'blocked', reason: 'invalidated' };
          return result as PulsePreparedSet;
        },
        { isolationLevel: 'read committed' },
      ),
    );
  }
  private async prepareInTransaction(
    tx: PulseReportExecutor,
    input: PulseInputRequest,
    compute: (d: PulseAllowedDataset) => {
      metrics: PulseMetricCandidate[];
      finalGate: 'eligible' | 'insufficient_data' | null;
    },
  ): Promise<PulsePreparationResult> {
    const observed = await observePulseInputFrontier(tx, input);
    if ('reason' in observed) return observed;
    const context = observed.context;
    const selected = await this.select(tx, context);
    if (typeof selected === 'string') return { status: 'blocked', reason: selected } as const;
    const computed = compute(selected);
    const [candidate] = await pulseInputRows(
      tx,
      sql`insert into survey_report_input_candidates(tenant_id,cycle_id,scope_id,purpose,frontier,generation,calculation_contract,context,metrics,expires_at)
    values(${input.tenantId}::uuid,${input.cycleId}::uuid,${input.scopeId}::uuid,${input.purpose},${context.frontier}::timestamptz,${context.generation},${PULSE_REPORT_CALCULATION_CONTRACT},${JSON.stringify(context)}::jsonb,${JSON.stringify(computed.metrics)}::jsonb,clock_timestamp()+engagement_retention_days((select retention_policy from tenants where id=${input.tenantId}::uuid))*interval '1 day')
    on conflict(tenant_id,cycle_id,scope_id,purpose,frontier,generation,calculation_contract) do update set calculation_contract=excluded.calculation_contract
    returning id,invalidated_at,context,metrics,expires_at>clock_timestamp() as live,(xmax=0) as inserted`,
    );
    if (candidate) {
      const priorSources = await pulseInputRows(
        tx,
        sql`select lineage_id,revision_id from survey_report_candidate_sources where candidate_id=${String(candidate.id)}::uuid order by lineage_id,revision_id`,
      );
      const expected = selected.topics.map((t) => t.lineageId + ':' + t.revisionId).sort();
      const prior = priorSources
        .map((t) => String(t.lineage_id) + ':' + String(t.revision_id))
        .sort();
      if (
        !candidate.live ||
        !sameFrozenContext(candidate.context, context) ||
        JSON.stringify(
          (candidate.metrics as PulseMetricCandidate[]).map((m) => [
            m.metricKey,
            m.kind,
            m.rawMean,
            m.completeCount,
            m.status,
            m.requiredCount,
          ]),
        ) !==
          JSON.stringify(
            computed.metrics.map((m) => [
              m.metricKey,
              m.kind,
              m.rawMean,
              m.completeCount,
              m.status,
              m.requiredCount,
            ]),
          ) ||
        (!candidate.inserted && JSON.stringify(expected) !== JSON.stringify(prior))
      ) {
        await tx.execute(
          sql`update survey_report_input_candidates set invalidated_at=coalesce(invalidated_at,clock_timestamp()) where id=${String(candidate.id)}::uuid`,
        );
        await tx.execute(
          sql`update survey_report_input_generations set generation=generation+1,certified_generation=null where tenant_id=${input.tenantId}::uuid and cycle_id=${input.cycleId}::uuid`,
        );
        return { status: 'blocked', reason: 'invalidated' } as const;
      }
    }
    if (!candidate || candidate.invalidated_at)
      return { status: 'blocked', reason: 'invalidated' } as const;
    for (const t of selected.topics)
      await tx.execute(
        sql`insert into survey_report_candidate_sources(candidate_id,tenant_id,user_id,lineage_id,revision_id) values(${String(candidate.id)}::uuid,${input.tenantId}::uuid,${t.subjectId}::uuid,${t.lineageId}::uuid,${t.revisionId}::uuid) on conflict do nothing`,
      );
    const [authorization] = await pulseInputRows(
      tx,
      sql`select ${pulseCandidateAuthorizationToken()} token from survey_report_input_candidates c where c.id=${String(candidate.id)}::uuid`,
    );
    return {
      status: 'prepared',
      candidateId: String(candidate.id),
      candidateAuthorizationToken: String(authorization!.token),
      context,
      ...computed,
      questionKeys: selected.questionKeys,
      qualitative: selected.topics.filter((t) => t.kind === 'index'),
    } as const;
  }
  private async select(
    tx: PulseReportExecutor,
    c: PulseInputContext,
  ): Promise<PulseAllowedDataset | 'missing_proof' | 'integrity_conflict'> {
    const members = await pulseInputRows(
      tx,
      sql`select p.user_id from survey_report_scope_memberships m join survey_report_participants p on p.id=m.participant_id and p.tenant_id=m.tenant_id and p.cycle_scoring_policy_id=m.cycle_scoring_policy_id join users u on u.id=p.user_id and u.tenant_id=p.tenant_id left join survey_reporting_permissions r on r.tenant_id=p.tenant_id and r.user_id=p.user_id where m.tenant_id=${c.tenantId}::uuid and m.cycle_scoring_policy_id=${c.cycleId}::uuid and m.scope_id=${c.scopeId}::uuid and u.deleted_at is null and u.status<>'deleted' and not coalesce(r.full_reporting_denied,false) order by p.user_id`,
    );
    const keys = await pulseInputRows(
      tx,
      sql`select q.stable_key,q.question_group,case when e.survey_question_id is not null then 'engagement' else q.question_group end metric_key from survey_cycle_scoring_policies cp join survey_questions q on q.survey_definition_id=cp.survey_definition_id left join survey_engagement_contract_questions e on e.survey_question_id=q.id and e.contract_version='engagement-1-10-v1' where cp.tenant_id=${c.tenantId}::uuid and cp.id=${c.cycleId}::uuid order by q.display_order,q.id`,
    );
    const questionKeys: Record<string, string[]> = {};
    for (const k of keys) {
      const group = String(k.metric_key);
      (questionKeys[group] ??= []).push(String(k.stable_key));
    }
    // Missing numeric catalog remains an empty final metric rather than borrowing a legacy scale.
    if (c.purpose === 'final' && (!questionKeys.engagement || questionKeys.engagement.length !== 3))
      return 'missing_proof';
    const bounds = sql`m.tenant_id=${c.tenantId}::uuid and m.scope_id=${c.scopeId}::uuid and m.cycle_scoring_policy_id=${c.cycleId}::uuid`;
    const topics: PulseAllowedTopic[] = [];
    const open = await pulseInputRows(
      tx,
      sql`with states as (
    select mark.*,q.stable_key,q.question_group,q.version,q.survey_definition_id,p.collection_stopped_at,cp.period_start,cp.period_end,o.opened_at,
    rank() over(partition by mark.user_id,mark.lineage_id order by mark.confirmation_received_at desc,mark.confirmation_message_id desc) position
    from survey_report_topic_watermarks mark join survey_report_question_lineages l on l.id=mark.lineage_id and l.tenant_id=mark.tenant_id and l.user_id=mark.user_id
    join survey_report_participants p on p.tenant_id=l.tenant_id and p.user_id=l.user_id and p.cycle_scoring_policy_id=l.cycle_scoring_policy_id
    join survey_report_scope_memberships m on m.participant_id=p.id and m.tenant_id=p.tenant_id and m.cycle_scoring_policy_id=p.cycle_scoring_policy_id
    join survey_cycle_scoring_policies cp on cp.id=l.cycle_scoring_policy_id and cp.scoring_policy_id=l.scoring_policy_id
    join survey_report_cycle_openings o on o.cycle_scoring_policy_id=cp.id and o.tenant_id=cp.tenant_id
    join survey_questions q on q.id=l.survey_question_id and q.survey_definition_id=cp.survey_definition_id and q.version=l.question_version and q.stable_key=l.question_stable_key
    where ${bounds} and l.answer_kind='open_ended' and pulse_input_receipt_in_scope(mark.tenant_id,mark.user_id,cp.id,mark.confirmation_received_at,${c.frontier}::timestamptz,false)
   ) select s.*,i.id retained_id,i.deidentified_summary,i.summary_support,i.outcome,i.score,i.withdrawn_at,i.privacy_policy_version,i.signal_direction,i.signal_severity,i.root_cause_category,
    exists(select 1 from survey_report_inbound_work proof where proof.inbound_receipt_id=s.confirmation_message_id and proof.tenant_id=s.tenant_id and proof.user_id=s.user_id and proof.received_at=s.confirmation_received_at and proof.trust='db-receipt-v1') and not exists(select 1 from jsonb_array_elements(s.accepted_source_receipts) receipt left join survey_report_inbound_work proof on proof.inbound_receipt_id=(receipt->>'messageId')::uuid and proof.tenant_id=s.tenant_id and proof.user_id=s.user_id where proof.trust is distinct from 'db-receipt-v1' or proof.received_at is distinct from (receipt->>'receivedAt')::timestamptz) trusted_proof,
    r.proof_status,r.confirmation_received_at=s.confirmation_received_at and r.confirmation_message_id=s.confirmation_message_id and r.accepted_source_receipts=s.accepted_source_receipts as has_proof,
    (s.expires_at>clock_timestamp() and i.processed_at>clock_timestamp()-engagement_retention_days(t.retention_policy)*interval '1 day') live,
    coalesce(rights.full_reporting_denied,false) full_denied,exists(select 1 from survey_reporting_lineage_exclusions x where x.lineage_id=s.lineage_id) partial_denied,
    not exists(select 1 from jsonb_array_elements(s.accepted_source_receipts) receipt where coalesce(not (pulse_input_receipt_in_scope(s.tenant_id,s.user_id,${c.cycleId}::uuid,(receipt->>'receivedAt')::timestamptz,${c.frontier}::timestamptz,false)),true)) sources_timely,
    exists(select 1 from survey_report_window_bindings b join survey_report_participants bp on bp.id=b.participant_id where b.survey_window_id=i.survey_window_id and b.tenant_id=s.tenant_id and b.cycle_scoring_policy_id=${c.cycleId}::uuid and bp.user_id=s.user_id) binding_valid
    from states s join tenants t on t.id=s.tenant_id join users u on u.id=s.user_id and u.tenant_id=s.tenant_id
    left join survey_question_insights i on i.id=s.insight_id and i.tenant_id=s.tenant_id and i.user_id=s.user_id and i.survey_question_id=(select survey_question_id from survey_report_question_lineages where id=s.lineage_id) and i.question_version=s.version and i.survey_definition_id=s.survey_definition_id
    left join survey_report_insight_revisions r on r.insight_id=i.id and r.lineage_id=s.lineage_id and r.tenant_id=s.tenant_id and r.user_id=s.user_id
    left join survey_reporting_permissions rights on rights.tenant_id=s.tenant_id and rights.user_id=s.user_id
    where s.position=1 and u.deleted_at is null and u.status<>'deleted'`,
    );
    const seen = new Map<string, string>();
    for (const r of open) {
      const identity = String(r.user_id) + ':' + String(r.lineage_id);
      const signature = JSON.stringify([
        r.state,
        r.accepted_source_receipts,
        r.outcome,
        r.score,
        r.deidentified_summary,
        r.privacy_policy_version,
        r.signal_direction,
        r.signal_severity,
        r.root_cause_category,
      ]);
      if (seen.has(identity)) {
        if (seen.get(identity) !== signature) return 'integrity_conflict';
        continue;
      }
      seen.set(identity, signature);
      if (r.full_denied || r.partial_denied || r.state !== 'retained' || r.withdrawn_at) continue;
      if (
        !r.retained_id ||
        r.proof_status !== 'receipt_backed' ||
        !r.has_proof ||
        !r.trusted_proof ||
        !r.binding_valid ||
        !Array.isArray(r.accepted_source_receipts) ||
        r.accepted_source_receipts.length === 0 ||
        r.privacy_policy_version !== PULSE_REPORT_PRIVACY_POLICY_VERSION
      )
        return 'missing_proof';
      if (!r.live || !r.sources_timely) continue;
      topics.push({
        subjectId: String(r.user_id),
        lineageId: String(r.lineage_id),
        revisionId: String(r.insight_id),
        questionKey: String(r.stable_key),
        questionGroup: String(r.question_group),
        kind: 'index',
        value: r.outcome === 'scored' ? Number(r.score) : null,
        safeSummary: String(r.deidentified_summary),
        summarySupport: r.summary_support as PulseAllowedTopic['summarySupport'],
        signalDirection: String(r.signal_direction),
        signalSeverity: String(r.signal_severity),
        rootCauseCategory: String(r.root_cause_category),
        support: 'safe_permanent_summary',
      });
    }
    const numeric = await pulseInputRows(
      tx,
      sql`with states as (
    select e.*,l.question_stable_key,q.question_group,q.id question_id,
      rank() over(partition by e.user_id,e.lineage_id order by e.answer_received_at desc,e.inbound_receipt_id desc) position
    from survey_engagement_capture_events e join survey_report_question_lineages l on l.id=e.lineage_id and l.tenant_id=e.tenant_id and l.user_id=e.user_id
    join survey_report_participants p on p.tenant_id=l.tenant_id and p.user_id=l.user_id and p.cycle_scoring_policy_id=l.cycle_scoring_policy_id
    join survey_report_scope_memberships m on m.participant_id=p.id and m.tenant_id=p.tenant_id and m.cycle_scoring_policy_id=p.cycle_scoring_policy_id
    join survey_cycle_scoring_policies cp on cp.id=l.cycle_scoring_policy_id and cp.scoring_policy_id=l.scoring_policy_id
    join survey_report_cycle_openings o on o.cycle_scoring_policy_id=cp.id and o.tenant_id=cp.tenant_id
    join survey_engagement_collection_contracts envelope on envelope.tenant_id=cp.tenant_id and envelope.survey_definition_id=cp.survey_definition_id
    join survey_engagement_contract_questions cq on cq.survey_definition_id=envelope.survey_definition_id and cq.contract_version=envelope.contract_version and cq.survey_question_id=l.survey_question_id and cq.question_version=l.question_version
    join survey_questions q on q.id=cq.survey_question_id and q.survey_definition_id=cp.survey_definition_id and q.version=cq.question_version and q.stable_key=cq.stable_key
    where ${bounds} and l.answer_kind='numeric_1_10_integer' and l.answer_contract='engagement-1-10-v1' and e.status in ('accepted','withdrawn','expired','source_deleted') and pulse_input_receipt_in_scope(e.tenant_id,e.user_id,cp.id,e.answer_received_at,${c.frontier}::timestamptz,true)
   ) select s.*,a.value,a.inbound_receipt_id revision_id,a.proof_kind,a.contract_version answer_contract,
    (a.expires_at>clock_timestamp() and a.answer_received_at>clock_timestamp()-engagement_retention_days(t.retention_policy)*interval '1 day') live,
    coalesce(r.full_reporting_denied,false) full_denied,exists(select 1 from survey_reporting_lineage_exclusions x where x.lineage_id=s.lineage_id) partial_denied,
    exists(select 1 from survey_report_window_bindings b join survey_report_participants p on p.id=b.participant_id where b.survey_window_id=a.survey_window_id and b.tenant_id=s.tenant_id and b.cycle_scoring_policy_id=${c.cycleId}::uuid and p.user_id=s.user_id) binding_valid
    from states s join tenants t on t.id=s.tenant_id join users u on u.id=s.user_id and u.tenant_id=s.tenant_id
    left join survey_engagement_answer_revisions a on a.inbound_receipt_id=s.inbound_receipt_id and a.tenant_id=s.tenant_id and a.user_id=s.user_id and a.lineage_id=s.lineage_id and a.survey_question_id=s.question_id and a.answer_received_at=s.answer_received_at and a.cycle_scoring_policy_id=${c.cycleId}::uuid
    left join survey_reporting_permissions r on r.tenant_id=s.tenant_id and r.user_id=s.user_id where s.position=1 and u.deleted_at is null and u.status<>'deleted'`,
    );
    for (const r of numeric) {
      if (r.full_denied || r.partial_denied || r.status !== 'accepted') continue;
      if (
        !r.revision_id ||
        r.proof_kind !== 'direct_explicit_answer' ||
        r.answer_contract !== 'engagement-1-10-v1' ||
        !r.binding_valid
      )
        return 'missing_proof';
      if (!r.live) continue;
      topics.push({
        subjectId: String(r.user_id),
        lineageId: String(r.lineage_id),
        revisionId: String(r.revision_id),
        questionKey: String(r.question_stable_key),
        questionGroup: String(r.question_group),
        kind: 'engagement',
        value: Number(r.value),
        support: 'literal_answer',
      });
    }
    return { context: c, roster: members.map((r) => String(r.user_id)), questionKeys, topics };
  }
}

function sameFrozenContext(stored: unknown, expected: PulseInputContext): boolean {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return false;
  const retained = stored as Record<string, unknown>;
  const keys = Object.keys(expected).sort();
  return (
    JSON.stringify(Object.keys(retained).sort()) === JSON.stringify(keys) &&
    keys.every((key) => retained[key] === expected[key as keyof PulseInputContext])
  );
}
