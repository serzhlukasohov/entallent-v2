import { sql } from 'drizzle-orm';
import type {
  PulseInputRequest,
  PulseInputContext,
  PulseSettlementResult,
} from '@entalent/contracts';
import {
  PULSE_INPUT_CONTRACT,
  PULSE_REPORT_CALCULATION_CONTRACT,
  PULSE_REPORT_PRIVACY_POLICY_VERSION,
} from '@entalent/contracts';
import {
  lockPulseReportCycleExact,
  lockPulseReportSubject,
  type PulseReportExecutor,
} from './pulse-report-state';
export type PulseInputRow = Record<string, unknown>;
export async function pulseInputRows(
  tx: PulseReportExecutor,
  query: ReturnType<typeof sql>,
): Promise<PulseInputRow[]> {
  return (await tx.execute(query)) as PulseInputRow[];
}
const iso = (expression: ReturnType<typeof sql>) =>
  sql`to_char(${expression} at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const presentationFrames = new WeakMap<
  object,
  { tenantId: string; cycleId: string; purpose: string; frontier: string }
>();
/** Internal DB-authored frame, scoped to this transaction/callback; no caller time input. */
export async function withPulsePresentationFrame<T>(
  tx: PulseReportExecutor,
  inputs: readonly PulseInputRequest[],
  operation: () => Promise<T>,
): Promise<T | PulseSettlementResult> {
  const first = inputs[0];
  if (
    !first ||
    new Set(inputs.map((i) => i.scopeId)).size !== inputs.length ||
    inputs.some(
      (i) =>
        i.tenantId !== first.tenantId || i.cycleId !== first.cycleId || i.purpose !== first.purpose,
    )
  )
    return { status: 'blocked', reason: 'missing_native_scope' };
  if (presentationFrames.has(tx)) throw new Error('pulse_frame_nested');
  const observed = await observePulseInputFrontier(tx, first);
  if ('reason' in observed) return observed;
  presentationFrames.set(tx, {
    tenantId: first.tenantId,
    cycleId: first.cycleId,
    purpose: first.purpose,
    frontier: observed.context.frontier,
  });
  try {
    return await operation();
  } finally {
    presentationFrames.delete(tx);
  }
}
/** Call in READ COMMITTED transaction. Cycle precedes sorted subjects; generation is read last. */
export async function observePulseInputFrontier(
  tx: PulseReportExecutor,
  input: PulseInputRequest,
): Promise<PulseSettlementResult> {
  const cycle = (
    await pulseInputRows(
      tx,
      sql`select c.survey_definition_id,${iso(sql`c.period_start`)} start,${iso(sql`c.period_end`)} ending from survey_cycle_scoring_policies c join survey_report_scopes s on s.cycle_scoring_policy_id=c.id and s.tenant_id=c.tenant_id where c.id=${input.cycleId}::uuid and c.tenant_id=${input.tenantId}::uuid and s.id=${input.scopeId}::uuid`,
    )
  )[0];
  if (!cycle) return { status: 'blocked', reason: 'missing_native_scope' };
  await lockPulseReportCycleExact(tx, {
    tenantId: input.tenantId,
    surveyDefinitionId: String(cycle.survey_definition_id),
    periodStart: String(cycle.start),
    periodEnd: String(cycle.ending),
  });
  const subjects = await pulseInputRows(
    tx,
    sql`select user_id from survey_report_participants where tenant_id=${input.tenantId}::uuid and cycle_scoring_policy_id=${input.cycleId}::uuid order by user_id`,
  );
  for (const subject of subjects)
    await lockPulseReportSubject(tx, input.tenantId, String(subject.user_id));
  const frame = presentationFrames.get(tx);
  if (
    frame &&
    (frame.tenantId !== input.tenantId ||
      frame.cycleId !== input.cycleId ||
      frame.purpose !== input.purpose)
  )
    throw new Error('pulse_frame_mismatch');
  const c = (
    await pulseInputRows(
      tx,
      sql`select s.kind,s.history_key,s.boundary_fingerprint,f.status,f.formation_started_at::text,
    ${iso(frame ? sql`${frame.frontier}::timestamptz` : sql`case when ${input.purpose}='final' then f.report_data_cutoff else clock_timestamp() end`)} frontier,
    md5(coalesce((select string_agg(p.user_id::text,',' order by p.user_id) from survey_report_scope_memberships m join survey_report_participants p on p.id=m.participant_id where m.scope_id=s.id),'')) composition,
    md5(p.version||':'||p.rubrics::text||':'||coalesce((select string_agg(q.stable_key||':'||q.version||':'||q.canonical_meaning,',' order by q.stable_key) from survey_questions q where q.survey_definition_id=cycle.survey_definition_id),'')||':'||${PULSE_INPUT_CONTRACT}||':'||${PULSE_REPORT_CALCULATION_CONTRACT}||':'||${PULSE_REPORT_PRIVACY_POLICY_VERSION}) compatibility
    from survey_report_scopes s join survey_cycle_scoring_policies cycle on cycle.id=s.cycle_scoring_policy_id join survey_scoring_policies p on p.id=cycle.scoring_policy_id left join survey_report_final_timings f on f.tenant_id=s.tenant_id and f.cycle_scoring_policy_id=s.cycle_scoring_policy_id where s.tenant_id=${input.tenantId}::uuid and s.id=${input.scopeId}::uuid and s.cycle_scoring_policy_id=${input.cycleId}::uuid`,
    )
  )[0];
  if (!c) return { status: 'blocked', reason: 'missing_native_scope' };
  const requestedProjection =
    input.projection ?? (c.kind === 'team' ? 'team_lead_overall' : 'manager_overall');
  if (
    (c.kind === 'manager_overall' && requestedProjection !== 'manager_overall') ||
    (c.kind === 'team' && requestedProjection === 'manager_overall')
  )
    return { status: 'blocked', reason: 'missing_native_scope' };
  // Final team computation is identical for both views. Audience must be supplied
  // independently downstream; this canonical computation projection is not a recipient.
  const projection =
    input.purpose === 'final' && c.kind === 'team' ? 'team_lead_overall' : requestedProjection;
  const coverage = (
    await pulseInputRows(
      tx,
      sql`select 1 from survey_report_input_coverage cover join survey_report_cycle_openings o on o.tenant_id=cover.tenant_id where cover.tenant_id=${input.tenantId}::uuid and o.cycle_scoring_policy_id=${input.cycleId}::uuid and o.opened_at>=cover.supported_from`,
    )
  )[0];
  if (!coverage) return { status: 'blocked', reason: 'unverified_receipt' };
  if (input.purpose === 'final' && c.status !== 'started')
    return { status: 'pending', reason: 'formation_not_started' };
  if (input.purpose === 'intermediate' && c.status === 'started')
    return { status: 'blocked', reason: 'final_already_started' };
  if (input.purpose === 'final') {
    const problem = (
      await pulseInputRows(
        tx,
        sql`select case when w.trust<>'db-receipt-v1' or w.received_at is null then 'unverified_receipt'
       when b.survey_window_id is null then 'missing_binding' when w.failure_code is not null or w.native_verdict='blocked' or w.evidence='blocked' or w.finalization='blocked' then 'manual_reconciliation' else 'unresolved_stage' end reason
      from survey_report_participants p join survey_cycle_scoring_policies c on c.id=p.cycle_scoring_policy_id join survey_report_cycle_openings o on o.cycle_scoring_policy_id=c.id
      join survey_report_inbound_work w on w.tenant_id=p.tenant_id and w.user_id=p.user_id
      left join survey_report_window_bindings b on b.tenant_id=p.tenant_id and b.participant_id=p.id and b.cycle_scoring_policy_id=c.id
      left join survey_reporting_permissions rights on rights.tenant_id=p.tenant_id and rights.user_id=p.user_id
      join users u on u.id=p.user_id and u.tenant_id=p.tenant_id
      where p.tenant_id=${input.tenantId}::uuid and c.id=${input.cycleId}::uuid and u.deleted_at is null and u.status<>'deleted' and not coalesce(rights.full_reporting_denied,false)
       and (w.received_at is null or pulse_input_receipt_in_scope(w.tenant_id,w.user_id,c.id,w.received_at,${String(c.frontier)}::timestamptz,false))
       and (w.trust<>'db-receipt-v1' or b.survey_window_id is null or w.capture in ('pending','blocked') or w.native_verdict in ('pending','claimed','blocked') or not pulse_input_evidence_terminal(w.inbound_receipt_id) or w.finalization in ('pending','blocked'))
      order by w.received_at nulls first,w.inbound_receipt_id limit 1`,
      )
    )[0];
    if (problem)
      return {
        status: problem.reason === 'unresolved_stage' ? 'pending' : 'blocked',
        reason: problem.reason as
          'unverified_receipt' | 'missing_binding' | 'manual_reconciliation' | 'unresolved_stage',
      };
  }
  await tx.execute(
    sql`insert into survey_report_input_generations(tenant_id,cycle_id,generation) values(${input.tenantId}::uuid,${input.cycleId}::uuid,0) on conflict do nothing`,
  );
  const g = (
    await pulseInputRows(
      tx,
      sql`select generation from survey_report_input_generations where tenant_id=${input.tenantId}::uuid and cycle_id=${input.cycleId}::uuid`,
    )
  )[0]!;
  const context: PulseInputContext = {
    ...input,
    projection,
    frontier: String(c.frontier),
    formationStartedAt: c.formation_started_at ? String(c.formation_started_at) : null,
    generation: Number(g.generation),
    periodStart: String(cycle.start),
    periodEnd: String(cycle.ending),
    historyKey: String(c.history_key),
    boundaryFingerprint: String(c.boundary_fingerprint),
    compositionFingerprint: String(c.composition),
    compatibilitySignature: String(c.compatibility),
    scopeKind: c.kind as PulseInputContext['scopeKind'],
  };
  if (input.purpose === 'final')
    await tx.execute(
      sql`update survey_report_input_generations set certified_generation=generation,cutoff=${context.frontier}::timestamptz where tenant_id=${input.tenantId}::uuid and cycle_id=${input.cycleId}::uuid`,
    );
  return { status: input.purpose === 'final' ? 'settled' : 'observed', context };
}

/** Backend identity token includes the complete closed source inventory; never a recipient grant. */
export function pulseCandidateAuthorizationToken() {
  return sql`md5(c.context::text||c.metrics::text||extract(epoch from c.expires_at)::text||coalesce((select string_agg(source.user_id::text||':'||source.lineage_id::text||':'||source.revision_id::text,',' order by source.user_id,source.lineage_id,source.revision_id) from survey_report_candidate_sources source where source.candidate_id=c.id),''))`;
}
