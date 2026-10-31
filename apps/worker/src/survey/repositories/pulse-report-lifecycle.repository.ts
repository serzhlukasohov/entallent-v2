import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import {
  pulseInputRows,
  lockReportConfiguration,
  boundPulsePublicationLocks,
  pulsePublicationHash,
  readReportCycleExact,
  lockPulseReportCycleExact,
  lockPulseReportSubject,
} from '@entalent/database';
import {
  PULSE_INDEX_KEYS,
  type BuildPulseReportRequest,
  type PulseAssemblyLease,
  type PulseAssemblyContext,
  type PulsePreparedSection,
} from '@entalent/contracts';
import {
  PreparePulseReportInputsUseCase,
  pulseUsedCandidateIds,
  restrictPulsePresentationHistory,
} from '@entalent/application';
import { DatabaseService } from '../../database/database.service';
import { PulseReportPresentationRepository } from './pulse-report-presentation.repository';
import { readCompletedPulseFinals } from './pulse-report-history.repository';
import { PulseReportFinalScheduleRepository } from './pulse-report-final-schedule.repository';
/** Optional predicate over a `survey_report_scopes` alias. Omitted keeps the RPT-07 all-scope behavior. */
export type PulseLifecycleScopeFilter = (scopeAlias: SQL) => SQL;
const scopeWhere = (filter: PulseLifecycleScopeFilter | undefined, scopeId: SQL) =>
  filter
    ? sql` and exists(select 1 from survey_report_scopes fs where fs.id=${scopeId} and ${filter(sql.raw('fs'))})`
    : sql``;
@Injectable()
export class PulseReportLifecycleRepository {
  constructor(
    private readonly db: DatabaseService,
    private readonly inputs: PreparePulseReportInputsUseCase,
    private readonly presentation: PulseReportPresentationRepository,
    private readonly schedule: PulseReportFinalScheduleRepository,
    private readonly leaseWindowMs = 120000,
  ) {}
  get renewalIntervalMs() {
    return Math.max(10, Math.floor(this.leaseWindowMs / 3));
  }
  async renew(lease: PulseAssemblyLease): Promise<boolean> {
    const [owner] = await pulseInputRows(
      this.db.client,
      sql`update survey_report_obligations o set lease_until=clock_timestamp()+${this.leaseWindowMs}*interval '1 millisecond' where id=${lease.obligationId}::uuid and tenant_id=${lease.tenantId}::uuid and assembly_token=${lease.token} and status='assembling' and lease_until>clock_timestamp() and exists(select 1 from survey_report_assembly_inputs i where i.obligation_id=o.id and i.tenant_id=o.tenant_id and i.expires_at>clock_timestamp()) returning id`,
    );
    return Boolean(owner);
  }
  async observe(
    request: BuildPulseReportRequest,
  ): Promise<{ status: string; obligationId?: string }> {
    const timing = await this.schedule.refresh(request.tenantId, request.cycleId);
    if (!timing) return { status: 'blocked' };
    if (request.purpose === 'final') {
      const begun = await this.schedule.begin(
        request.tenantId,
        request.cycleId,
        timing.configRevision,
      );
      if (begun.status !== 'started') return { status: begun.status };
    }
    const context = await this.presentation.read(request);
    if (!context) return { status: 'blocked' };
    const result = await this.inputs.preparePresentationSet(
      context.scopes.map((s, i) => ({
        tenantId: request.tenantId,
        cycleId: request.cycleId,
        scopeId: s.scopeId,
        purpose: request.purpose,
        projection:
          request.audience === 'team_lead'
            ? 'team_lead_overall'
            : i === 0
              ? 'manager_overall'
              : 'manager_team',
      })),
    );
    if (result.status !== 'prepared') return { status: result.status };
    const prepared = {
      ...result,
      sections: restrictPulsePresentationHistory(result.sections, request),
    };
    if (
      request.purpose === 'intermediate' &&
      !prepared.sections[0]!.metrics.some(
        (m) => m.metricKey === request.indexKey && m.status === 'eligible',
      )
    )
      return { status: 'not_ready' };
    return this.db.client.transaction(
      async (tx) => {
        await boundPulsePublicationLocks(tx);
        // Configuration precedes history/cycle/subjects only for new initiation.
        await lockReportConfiguration(tx, request.tenantId);
        for (const key of [...new Set(prepared.sections.map((s) => s.context.historyKey))].sort())
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${'pulse-publication-history:' + request.tenantId + ':' + key},0))`,
          );
        const freshTiming = await this.schedule.refreshInTransaction(
          tx,
          request.tenantId,
          request.cycleId,
        );
        if (!freshTiming) return { status: 'blocked' };
        if (request.purpose === 'intermediate') {
          const [fence] = await pulseInputRows(
            tx,
            sql`select status='started' or final_due_at<=clock_timestamp() due from survey_report_final_timings where tenant_id=${request.tenantId}::uuid and cycle_scoring_policy_id=${request.cycleId}::uuid`,
          );
          if (!fence || fence.due || freshTiming.status === 'blocked')
            return { status: 'final_due' };
        }
        if (
          !(await this.presentation.validateInTransaction(
            tx,
            context,
            prepared.sections,
            false,
            true,
          ))
        )
          return { status: 'invalidated' };
        const [row] = await pulseInputRows(
          tx,
          sql`insert into survey_report_obligations(tenant_id,cycle_id,scope_id,audience,purpose,index_key,frontier,config_revision)
    values(${request.tenantId}::uuid,${request.cycleId}::uuid,${request.overallScopeId}::uuid,${request.audience},${request.purpose},${request.indexKey ?? 'final'},${prepared.sections[0]!.context.frontier}::timestamptz,${context.configRevision})
    on conflict(tenant_id,cycle_id,scope_id,audience,purpose,index_key) do update set status='observing',assembly_token=survey_report_obligations.assembly_token+1,lease_until=null,disposition=null,next_action_at=clock_timestamp()
    where excluded.purpose='final' and survey_report_obligations.status in ('blocked','pending','canceled') and not exists(select 1 from survey_report_native_snapshots s where s.obligation_id=survey_report_obligations.id) returning id`,
        );
        if (!row) {
          const [existing] = await pulseInputRows(
            tx,
            sql`select id,status from survey_report_obligations where tenant_id=${request.tenantId}::uuid and cycle_id=${request.cycleId}::uuid and scope_id=${request.overallScopeId}::uuid and audience=${request.audience} and purpose=${request.purpose} and index_key=${request.indexKey ?? 'final'}`,
          );
          return {
            status: String(existing?.status ?? 'blocked'),
            obligationId: existing ? String(existing.id) : undefined,
          };
        }
        const ids = pulseUsedCandidateIds(prepared.sections);
        await tx.execute(
          sql`insert into survey_report_assembly_inputs(obligation_id,tenant_id,context,sections,source_candidate_ids,expires_at) values(${String(row.id)}::uuid,${request.tenantId}::uuid,${JSON.stringify(context)}::jsonb,${JSON.stringify(prepared.sections)}::jsonb,${'{' + ids.join(',') + '}'}::uuid[],pulse_candidate_content_deadline(${request.tenantId}::uuid,${'{' + ids.join(',') + '}'}::uuid[])) on conflict(obligation_id) do update set context=excluded.context,sections=excluded.sections,source_candidate_ids=excluded.source_candidate_ids,expires_at=excluded.expires_at`,
        );
        return { status: 'observing', obligationId: String(row.id) };
      },
      { isolationLevel: 'read committed' },
    );
  }
  /** Reconcile expired restricted copies before treating their aggregate deadline as current-source loss. */
  private async reconcileInputExpiry(tenantId: string, obligationId: string): Promise<boolean> {
    try {
      return await this.db.client.transaction(
        async (tx) => {
          await boundPulsePublicationLocks(tx);
          const readCache = async () =>
            (
              await pulseInputRows(
                tx,
                sql`select i.context,i.sections,i.source_candidate_ids,i.expires_at<=clock_timestamp() or pulse_candidate_content_deadline(i.tenant_id,i.source_candidate_ids)<=clock_timestamp() expired from survey_report_assembly_inputs i where i.tenant_id=${tenantId}::uuid and i.obligation_id=${obligationId}::uuid`,
              )
            )[0];
          const cached = await readCache();
          if (!cached) {
            await tx.execute(
              sql`select id from survey_report_obligations where id=${obligationId}::uuid and tenant_id=${tenantId}::uuid for update nowait`,
            );
            await tx.execute(
              sql`update survey_report_obligations o set status='canceled',disposition='assembly_inputs_missing',lease_until=null where id=${obligationId}::uuid and tenant_id=${tenantId}::uuid and status in ('observing','assembling','pending','blocked') and not exists(select 1 from survey_report_native_snapshots where obligation_id=o.id) and not exists(select 1 from survey_report_assembly_inputs where obligation_id=o.id and tenant_id=o.tenant_id)`,
            );
            return true;
          }
          if (!cached.expired) return true;
          const context = cached.context as PulseAssemblyContext,
            sections = cached.sections as PulsePreparedSection[];
          const keys = [...new Set(sections.map((s) => s.context.historyKey))].sort();
          for (const key of keys)
            await tx.execute(
              sql`select pg_advisory_xact_lock(hashtextextended(${'pulse-publication-history:' + tenantId + ':' + key},0))`,
            );
          const inventory = async () => {
            const history = [];
            for (const key of keys)
              history.push(
                ...(await readCompletedPulseFinals(tx, tenantId, key)).filter(
                  (h) =>
                    h.cycleId !== context.request.cycleId && h.periodEnd <= context.periodStart,
                ),
              );
            const ids = [
                ...new Set([
                  ...sections.map((s) => s.candidateId),
                  ...history.flatMap((h) => (h.candidateId ? [h.candidateId] : [])),
                ]),
              ].sort(),
              literal = '{' + ids.join(',') + '}';
            const sources = await pulseInputRows(
              tx,
              sql`select candidate_id,user_id,lineage_id,revision_id from survey_report_candidate_sources where tenant_id=${tenantId}::uuid and candidate_id=any(${literal}::uuid[]) order by candidate_id,user_id,lineage_id,revision_id`,
            );
            const subjects = await pulseInputRows(
              tx,
              sql`select distinct user_id from(select user_id from survey_report_candidate_sources where tenant_id=${tenantId}::uuid and candidate_id=any(${literal}::uuid[]) union select user_id from survey_report_participants where tenant_id=${tenantId}::uuid and cycle_scoring_policy_id=${context.request.cycleId}::uuid) subjects order by user_id`,
            );
            return { ids, literal, sources, subjects: subjects.map((s) => String(s.user_id)) };
          };
          const before = await inventory(),
            cycle = await readReportCycleExact(tx, tenantId, context.request.cycleId);
          if (!cycle) return false;
          await lockPulseReportCycleExact(tx, cycle);
          for (const subject of before.subjects)
            await lockPulseReportSubject(tx, tenantId, subject);
          if (pulsePublicationHash(before) !== pulsePublicationHash(await inventory()))
            return false;
          await tx.execute(
            sql`select id from survey_report_input_candidates where tenant_id=${tenantId}::uuid and id=any(${before.literal}::uuid[]) order by id for update nowait`,
          );
          await tx.execute(
            sql`select candidate_id from survey_report_candidate_sources where tenant_id=${tenantId}::uuid and candidate_id=any(${before.literal}::uuid[]) order by candidate_id,user_id,lineage_id,revision_id for update nowait`,
          );
          await tx.execute(
            sql`select id from tenants where id=${tenantId}::uuid for update nowait`,
          );
          await tx.execute(
            sql`select id from survey_report_obligations where id=${obligationId}::uuid and tenant_id=${tenantId}::uuid for update nowait`,
          );
          await tx.execute(
            sql`select obligation_id from survey_report_assembly_inputs where obligation_id=${obligationId}::uuid and tenant_id=${tenantId}::uuid for update nowait`,
          );
          const now = await readCache();
          if (
            !now ||
            pulsePublicationHash([now.context, now.sections, now.source_candidate_ids]) !==
              pulsePublicationHash([cached.context, cached.sections, cached.source_candidate_ids])
          )
            return false;
          const used = '{' + (cached.source_candidate_ids as string[]).join(',') + '}';
          const expired = await pulseInputRows(
            tx,
            sql`select id from survey_report_input_candidates where tenant_id=${tenantId}::uuid and id=any(${used}::uuid[]) and pulse_candidate_content_deadline(${tenantId}::uuid,ARRAY[id])<=clock_timestamp() order by id`,
          );
          for (const candidate of expired) {
            await tx.execute(
              sql`update survey_report_input_candidates set invalidated_at=coalesce(invalidated_at,clock_timestamp()),metrics='[]'::jsonb where id=${String(candidate.id)}::uuid and tenant_id=${tenantId}::uuid`,
            );
            await tx.execute(
              sql`select pulse_native_scrub_candidate_dependencies(${tenantId}::uuid,${String(candidate.id)}::uuid)`,
            );
          }
          // A prior-only purge has kept the same current sections; refresh their remaining content deadline.
          await tx.execute(
            sql`update survey_report_assembly_inputs set expires_at=pulse_candidate_content_deadline(tenant_id,source_candidate_ids) where obligation_id=${obligationId}::uuid and tenant_id=${tenantId}::uuid`,
          );
          return true;
        },
        { isolationLevel: 'read committed' },
      );
    } catch {
      return false;
    }
  }
  async claim(tenantId: string, obligationId: string): Promise<PulseAssemblyLease | null> {
    // Bounded retry closes expiry between reconciliation, owner CAS and the restricted lookup.
    for (let retry = 0; retry < 2; retry++) {
      if (!(await this.reconcileInputExpiry(tenantId, obligationId))) return null;
      const [row] = await pulseInputRows(
        this.db.client,
        sql`update survey_report_obligations set status='assembling',assembly_token=assembly_token+1,lease_until=clock_timestamp()+${this.leaseWindowMs}*interval '1 millisecond' where id=${obligationId}::uuid and tenant_id=${tenantId}::uuid and status in ('observing','assembling','pending','blocked') and next_action_at<=clock_timestamp() and (lease_until is null or lease_until<clock_timestamp()) and not exists(select 1 from survey_report_native_snapshots s where s.obligation_id=survey_report_obligations.id) returning assembly_token`,
      );
      if (!row) return null;
      const token = Number(row.assembly_token),
        lease = await this.load(tenantId, obligationId, token);
      if (!lease) {
        // An expired prior/lease is not proof that the current observation is invalid.
        await this.db.client.execute(
          sql`update survey_report_obligations set status='pending',disposition='assembly_expiry_reconcile_required',lease_until=null,next_action_at=clock_timestamp() where id=${obligationId}::uuid and tenant_id=${tenantId}::uuid and assembly_token=${token} and status='assembling' and not exists(select 1 from survey_report_native_snapshots where obligation_id=${obligationId}::uuid)`,
        );
        continue;
      }
      const refreshed = await this.rebaseHistory(lease);
      if (refreshed) return refreshed;
      if (!(await this.load(tenantId, obligationId, token))) {
        await this.defer(lease, 'lease_lost');
        continue;
      }
      await this.defer(lease, 'invalidated');
      return null;
    }
    return null;
  }
  async load(
    tenantId: string,
    obligationId: string,
    token: number,
  ): Promise<PulseAssemblyLease | null> {
    const [row] = await pulseInputRows(
      this.db.client,
      sql`select i.context,i.sections from survey_report_obligations o join survey_report_assembly_inputs i on i.obligation_id=o.id and i.tenant_id=o.tenant_id where o.id=${obligationId}::uuid and o.tenant_id=${tenantId}::uuid and o.assembly_token=${token} and o.status='assembling' and o.lease_until>clock_timestamp() and i.expires_at>clock_timestamp()`,
    );
    if (!row) return null;
    const context = row.context as PulseAssemblyContext;
    return {
      tenantId,
      obligationId,
      token,
      request: context.request,
      context,
      sections: row.sections as PulsePreparedSection[],
    };
  }
  async rebaseHistory(lease: PulseAssemblyLease): Promise<PulseAssemblyLease | null> {
    const current = await this.load(lease.tenantId, lease.obligationId, lease.token);
    if (!current || pulsePublicationHash(current) !== pulsePublicationHash(lease)) return null;
    const sections = restrictPulsePresentationHistory(
      await this.inputs.refreshHistoricalSelection(current.sections),
      current.request,
    );
    if (pulsePublicationHash(sections) === pulsePublicationHash(current.sections)) return current;
    // Fresh transaction reacquires complete new inventory/subject union; never append historical locks late.
    return this.db.client.transaction(async (tx) => {
      await boundPulsePublicationLocks(tx);
      if (!(await this.presentation.validateInTransaction(tx, current.context, sections, true)))
        return null;
      const [owner] = await pulseInputRows(
        tx,
        sql`update survey_report_obligations set assembly_token=assembly_token+1 where id=${current.obligationId}::uuid and tenant_id=${current.tenantId}::uuid and assembly_token=${current.token} and status='assembling' and lease_until>clock_timestamp() and not exists(select 1 from survey_report_native_snapshots where obligation_id=${current.obligationId}::uuid) returning assembly_token`,
      );
      if (!owner) return null;
      await tx.execute(
        sql`update survey_report_assembly_inputs set sections=${JSON.stringify(sections)}::jsonb,source_candidate_ids=${'{' + pulseUsedCandidateIds(sections).join(',') + '}'}::uuid[],expires_at=pulse_candidate_content_deadline(${current.tenantId}::uuid,${'{' + pulseUsedCandidateIds(sections).join(',') + '}'}::uuid[]) where obligation_id=${current.obligationId}::uuid and tenant_id=${current.tenantId}::uuid`,
      );
      return { ...current, token: Number(owner.assembly_token), sections };
    });
  }
  async validate(lease: PulseAssemblyLease): Promise<boolean> {
    const current = await this.load(lease.tenantId, lease.obligationId, lease.token);
    if (!current || pulsePublicationHash(current) !== pulsePublicationHash(lease)) return false;
    return this.db.client.transaction((tx) =>
      this.presentation.validateInTransaction(tx, lease.context, lease.sections, true),
    );
  }
  async defer(lease: PulseAssemblyLease, reason: string) {
    // A generic validation/lease failure cannot prove current-source loss. Reconcile under the
    // publication lock order; only authoritative current invalidation may terminally cancel.
    const reconciled = await this.reconcileInputExpiry(lease.tenantId, lease.obligationId);
    const pending = !reconciled || ['invalidated', 'pending', 'lease_lost'].includes(reason);
    await this.db.client.execute(
      sql`update survey_report_obligations set status=${pending ? 'pending' : 'blocked'},disposition=${reconciled ? reason : 'expiry_reconciliation_pending'},lease_until=null,next_action_at=clock_timestamp()+interval '1 minute' where id=${lease.obligationId}::uuid and tenant_id=${lease.tenantId}::uuid and assembly_token=${lease.token} and status='assembling'`,
    );
  }
  /** Fair DB cursors advance even when the first page contains blocked or ineligible scopes. */
  async discover(limit = 25, filter?: PulseLifecycleScopeFilter) {
    return this.db.client.transaction(async (tx) => {
      await tx.execute(sql`insert into survey_report_scope_observations(tenant_id,cycle_id,scope_id)
    select s.tenant_id,s.cycle_scoring_policy_id,s.id from survey_report_scopes s join survey_report_cycle_openings o on o.tenant_id=s.tenant_id and o.cycle_scoring_policy_id=s.cycle_scoring_policy_id
    where not exists(select 1 from survey_report_scope_observations seen where seen.scope_id=s.id)${scopeWhere(filter, sql`s.id`)} order by s.tenant_id,s.cycle_scoring_policy_id,s.id limit ${Math.min(100, Math.max(1, limit))} on conflict do nothing`);
      const rows = await pulseInputRows(
        tx,
        sql`select seen.tenant_id,seen.cycle_id,seen.scope_id,s.kind,g.generation from survey_report_scope_observations seen join survey_report_scopes s on s.id=seen.scope_id left join survey_report_input_generations g on g.tenant_id=seen.tenant_id and g.cycle_id=seen.cycle_id where seen.next_observation_at<=clock_timestamp()${scopeWhere(filter, sql`seen.scope_id`)} order by seen.scan_cursor_at,seen.scope_id limit ${Math.min(100, Math.max(1, limit))} for update of seen skip locked`,
      );
      const requests: BuildPulseReportRequest[] = [];
      for (const row of rows) {
        await tx.execute(
          sql`update survey_report_scope_observations set scan_cursor_at=clock_timestamp(),next_observation_at=clock_timestamp()+interval '1 minute',observed_generation=${row.generation === null ? null : Number(row.generation ?? 0)} where scope_id=${String(row.scope_id)}::uuid`,
        );
        const base = {
          tenantId: String(row.tenant_id),
          cycleId: String(row.cycle_id),
          overallScopeId: String(row.scope_id),
          audience: row.kind === 'team' ? ('team_lead' as const) : ('manager' as const),
        };
        requests.push({ ...base, purpose: 'final' });
        for (const indexKey of PULSE_INDEX_KEYS)
          requests.push({ ...base, purpose: 'intermediate', indexKey });
      }
      return requests;
    });
  }
  /** `filter` restricts formation-phase rows only; delivery-phase rows always page so RPT-07 fences keep running. */
  async repair(limit = 25, filter?: PulseLifecycleScopeFilter) {
    return this.db.client.transaction(async (tx) => {
      const rows = await pulseInputRows(
        tx,
        sql`select o.tenant_id,o.id obligation_id,s.id snapshot_id from survey_report_obligations o left join survey_report_native_snapshots s on s.obligation_id=o.id where o.status in ('observing','assembling','pending','blocked','snapshot_ready','delivering') and o.next_action_at<=clock_timestamp()${filter ? sql` and (s.id is not null or exists(select 1 from survey_report_scopes fs where fs.id=o.scope_id and ${filter(sql.raw('fs'))}))` : sql``} order by o.repair_cursor_at,o.id limit ${Math.min(100, Math.max(1, limit))} for update of o skip locked`,
      );
      for (const row of rows)
        await tx.execute(
          sql`update survey_report_obligations set repair_cursor_at=clock_timestamp() where id=${String(row.obligation_id)}::uuid`,
        );
      return rows;
    });
  }
}
