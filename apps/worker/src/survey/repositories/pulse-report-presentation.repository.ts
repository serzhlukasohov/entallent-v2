import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type {
  BuildPulseReportRequest,
  PulseAssemblyContext,
  PulsePreparedSection,
  PulsePresentationScope,
} from '@entalent/contracts';
import {
  assessPulseReportConfiguration,
  selectPulseReportBaseline,
  minimizePulseHistory,
  restrictPulsePresentationHistory,
  type PulseReportPresentationRepositoryPort,
} from '@entalent/application';
import {
  pulseInputRows,
  pulseCandidateAuthorizationToken,
  reportSourceFingerprint,
  readReportCycleExact,
  lockPulseReportCycleExact,
  lockPulseReportSubject,
  type PulseReportExecutor,
  withPulseReportSerializableRetry,
} from '@entalent/database';
import { DatabaseService } from '../../database/database.service';
import { readCompletedPulseFinals } from './pulse-report-history.repository';
function canonical(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object')
    return (
      '{' +
      Object.entries(v)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, x]) => JSON.stringify(k) + ':' + canonical(x))
        .join(',') +
      '}'
    );
  return JSON.stringify(v) ?? 'null';
}
const token = (v: unknown) => createHash('sha256').update(canonical(v)).digest('hex');
/** Frozen scope metadata and configuration are captured in one nonlocking statement. */
@Injectable()
export class PulseReportPresentationRepository implements PulseReportPresentationRepositoryPort {
  constructor(private readonly db: DatabaseService) {}
  read(input: BuildPulseReportRequest) {
    return this.readInTransaction(this.db.client, input);
  }
  async readInTransaction(
    tx: PulseReportExecutor,
    input: BuildPulseReportRequest,
    capturedRevision?: number,
  ): Promise<PulseAssemblyContext | null> {
    const [row] = await pulseInputRows(
      tx,
      sql`select t.locale source_locale,r.locale,r.calendar,r.revision,r.source_fingerprint,r.unavailable_reason,
    case when wc.tenant_id is null then null else jsonb_build_object('timezone',wc.timezone,'workingDays',wc.working_days,'workStart',wc.work_start,'workEnd',wc.work_end,'holidays',wc.holidays,'dateOverrides',wc.date_overrides) end source_calendar,
    to_char(c.period_start at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') period_start,to_char(c.period_end at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') period_end,
    f.status timing_status,f.config_revision timing_revision,f.timezone timing_timezone,f.formation_started_at::text formation_started_at,f.report_data_cutoff::text report_data_cutoff,
    (select jsonb_agg(jsonb_build_object('scopeId',s.id,'kind',s.kind,'label',s.label,'parentScopeId',s.parent_scope_id,'owner',s.opening_owner_person_id) order by (s.id=${input.overallScopeId}::uuid) desc,s.id)
     from survey_report_scopes s where s.tenant_id=c.tenant_id and s.cycle_scoring_policy_id=c.id and (s.id=${input.overallScopeId}::uuid or (${input.audience}='manager' and s.parent_scope_id=${input.overallScopeId}::uuid))) scopes
    from survey_cycle_scoring_policies c join survey_report_cycle_openings o on o.cycle_scoring_policy_id=c.id and o.tenant_id=c.tenant_id
    join tenants t on t.id=c.tenant_id left join tenant_work_calendars wc on wc.tenant_id=t.id
    left join survey_report_final_timings f on f.tenant_id=c.tenant_id and f.cycle_scoring_policy_id=c.id
    join lateral (select * from tenant_report_config_revisions cr where cr.tenant_id=t.id and ((${capturedRevision ?? null}::integer is not null and cr.revision=${capturedRevision ?? null}::integer) or (${capturedRevision ?? null}::integer is null and (${input.purpose}<>'final' or cr.revision=f.config_revision))) order by cr.revision desc limit 1) r on true
    where c.tenant_id=${input.tenantId}::uuid and c.id=${input.cycleId}::uuid`,
    );
    if (!row || row.unavailable_reason || !Array.isArray(row.scopes)) return null;
    const assessment = assessPulseReportConfiguration({
      locale: row.locale,
      calendar: row.calendar,
    });
    if (assessment.unavailableReason || !assessment.locale || !assessment.calendar) return null;

    if (input.purpose === 'intermediate' && capturedRevision === undefined) {
      if (
        reportSourceFingerprint({
          locale: row.source_locale,
          calendar: row.source_calendar as Record<string, unknown> | null,
        }) !== row.source_fingerprint
      )
        return null;
      const current = assessPulseReportConfiguration({
        locale: row.source_locale,
        calendar: row.source_calendar,
      });
      if (JSON.stringify(current) !== JSON.stringify(assessment)) return null;
    }
    const scopes = row.scopes as (PulsePresentationScope & { owner: string | null })[];
    if (
      !scopes.length ||
      scopes[0]!.scopeId !== input.overallScopeId ||
      scopes[0]!.kind !== (input.audience === 'team_lead' ? 'team' : 'manager_overall') ||
      scopes.slice(1).some((s) => s.kind !== 'team' || s.parentScopeId !== input.overallScopeId)
    )
      return null;
    return {
      request: { ...input },
      scopes: scopes.map(({ owner: _, ...s }) => s),
      locale: assessment.locale,
      timezone:
        input.purpose === 'final'
          ? String(row.timing_timezone)
          : (assessment.calendar as { timezone: string }).timezone,
      configRevision: Number(row.revision),
      configurationToken: token({
        revision: row.revision,
        locale: row.locale,
        calendar: row.calendar,
        scopes: scopes.map(({ owner: _, ...scope }) => scope),
        timing:
          input.purpose === 'final'
            ? [
                row.timing_status,
                row.formation_started_at,
                row.report_data_cutoff,
                row.timing_timezone,
              ]
            : null,
      }),
      periodStart: String(row.period_start),
      periodEnd: String(row.period_end),
    };
  }
  protected completed(tx: PulseReportExecutor, tenantId: string, historyKey: string) {
    return readCompletedPulseFinals(tx, tenantId, historyKey);
  }
  async validate(
    context: PulseAssemblyContext,
    sections: readonly PulsePreparedSection[],
  ): Promise<boolean> {
    return withPulseReportSerializableRetry(() =>
      this.db.client.transaction((tx) => this.validateInTransaction(tx, context, sections), {
        isolationLevel: 'read committed',
      }),
    );
  }
  /** Caller holds this transaction through atomic freeze or the single bounded publication. */
  async validateInTransaction(
    tx: PulseReportExecutor,
    context: PulseAssemblyContext,
    sections: readonly PulsePreparedSection[],
    pinnedObservation = false,
    restrictedHistory = false,
  ): Promise<boolean> {
    const req = context.request;
    // Nonlocking capture first; never acquire configuration/prior-cycle locks below subject locks.
    const fresh = await this.readInTransaction(
      tx,
      req,
      pinnedObservation ? context.configRevision : undefined,
    );
    if (!fresh || fresh.configurationToken !== context.configurationToken) return false;
    const cycle = await readReportCycleExact(tx, req.tenantId, req.cycleId);
    if (!cycle) return false;
    const currentIds = sections.map((s) => s.candidateId);
    const inventory = async () => {
      const histories = [];
      for (const s of sections)
        histories.push(
          (await this.completed(tx, req.tenantId, s.context.historyKey)).filter(
            (h) => h.cycleId !== req.cycleId && h.periodEnd <= s.context.periodStart,
          ),
        );
      const ids = [
        ...new Set([
          ...currentIds,
          ...histories
            .flat()
            .map((h) => h.candidateId)
            .filter((x): x is string => Boolean(x)),
        ]),
      ].sort();
      const subjects = await pulseInputRows(
        tx,
        sql`select distinct user_id from (select user_id from survey_report_candidate_sources where tenant_id=${req.tenantId}::uuid and candidate_id=any(${'{' + ids.join(',') + '}'}::uuid[]) union select user_id from survey_report_participants where tenant_id=${req.tenantId}::uuid and cycle_scoring_policy_id=${req.cycleId}::uuid) p order by user_id`,
      );
      const sources = await pulseInputRows(
        tx,
        sql`select candidate_id,user_id,lineage_id,revision_id from survey_report_candidate_sources where tenant_id=${req.tenantId}::uuid and candidate_id=any(${'{' + ids.join(',') + '}'}::uuid[]) order by candidate_id,user_id,lineage_id,revision_id`,
      );
      return { histories, ids, sources, subjects: subjects.map((s) => String(s.user_id)) };
    };
    const discovered = await inventory();
    for (const key of [...new Set(sections.map((s) => s.context.historyKey))].sort())
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${'pulse-publication-history:' + req.tenantId + ':' + key},0))`,
      );
    const before = await inventory();
    if (token(discovered) !== token(before)) return false;
    await lockPulseReportCycleExact(tx, cycle);
    for (const id of before.subjects) await lockPulseReportSubject(tx, req.tenantId, id);
    const after = await inventory();
    if (
      JSON.stringify(before.ids) !== JSON.stringify(after.ids) ||
      JSON.stringify(before.subjects) !== JSON.stringify(after.subjects) ||
      token(before.sources) !== token(after.sources)
    )
      return false;
    const afterContext = await this.readInTransaction(
      tx,
      req,
      pinnedObservation ? context.configRevision : undefined,
    );
    if (!afterContext || afterContext.configurationToken !== context.configurationToken)
      return false;
    const generations = await pulseInputRows(
      tx,
      sql`select generation from survey_report_input_generations where tenant_id=${req.tenantId}::uuid and cycle_id=${req.cycleId}::uuid`,
    );
    if (
      !pinnedObservation &&
      sections.some((s) => s.context.generation !== Number(generations[0]?.generation))
    )
      return false;
    if (before.ids.length) {
      await tx.execute(
        sql`select id from survey_report_input_candidates where tenant_id=${req.tenantId}::uuid and id=any(${'{' + before.ids.join(',') + '}'}::uuid[]) order by id for update nowait`,
      );
      await tx.execute(
        sql`select candidate_id from survey_report_candidate_sources where tenant_id=${req.tenantId}::uuid and candidate_id=any(${'{' + before.ids.join(',') + '}'}::uuid[]) order by candidate_id,user_id,lineage_id,revision_id for update nowait`,
      );
    }
    if (before.ids.length) {
      const ids = '{' + before.ids.join(',') + '}';
      await tx.execute(
        sql`select u.id from users u where u.tenant_id=${req.tenantId}::uuid and u.id in(select user_id from survey_report_candidate_sources where candidate_id=any(${ids}::uuid[])) order by u.id for update nowait`,
      );
      await tx.execute(
        sql`select w.insight_id from survey_report_topic_watermarks w where w.tenant_id=${req.tenantId}::uuid and w.insight_id in(select revision_id from survey_report_candidate_sources where candidate_id=any(${ids}::uuid[])) order by w.insight_id for update nowait`,
      );
      await tx.execute(
        sql`select i.id from survey_question_insights i where i.tenant_id=${req.tenantId}::uuid and i.id in(select revision_id from survey_report_candidate_sources where candidate_id=any(${ids}::uuid[])) order by i.id for update nowait`,
      );
      await tx.execute(
        sql`select a.inbound_receipt_id from survey_engagement_answer_revisions a where a.tenant_id=${req.tenantId}::uuid and a.inbound_receipt_id in(select revision_id from survey_report_candidate_sources where candidate_id=any(${ids}::uuid[])) order by a.inbound_receipt_id for update nowait`,
      );
      await tx.execute(
        sql`select e.inbound_receipt_id from survey_engagement_capture_events e where e.tenant_id=${req.tenantId}::uuid and e.inbound_receipt_id in(select revision_id from survey_report_candidate_sources where candidate_id=any(${ids}::uuid[])) order by e.inbound_receipt_id for update nowait`,
      );
    }
    const rows = await pulseInputRows(
      tx,
      sql`select c.id,${pulseCandidateAuthorizationToken()} authorization_token,c.context,c.metrics,c.invalidated_at is null and c.expires_at>clock_timestamp() and not exists(select 1 from survey_report_candidate_sources s left join users u on u.id=s.user_id and u.tenant_id=s.tenant_id left join survey_reporting_permissions p on p.tenant_id=s.tenant_id and p.user_id=s.user_id where s.candidate_id=c.id and (u.id is null or u.deleted_at is not null or u.status='deleted' or coalesce(p.full_reporting_denied,false) or exists(select 1 from survey_reporting_lineage_exclusions x where x.lineage_id=s.lineage_id) or not (exists(select 1 from survey_report_topic_watermarks w join survey_question_insights i on i.id=w.insight_id join tenants t on t.id=w.tenant_id where w.insight_id=s.revision_id and w.lineage_id=s.lineage_id and w.state='retained' and w.expires_at>clock_timestamp() and i.withdrawn_at is null and i.processed_at>clock_timestamp()-engagement_retention_days(t.retention_policy)*interval '1 day') or exists(select 1 from survey_engagement_answer_revisions a join survey_engagement_capture_events e on e.inbound_receipt_id=a.inbound_receipt_id join tenants t on t.id=a.tenant_id where a.inbound_receipt_id=s.revision_id and a.lineage_id=s.lineage_id and e.status='accepted' and a.expires_at>clock_timestamp() and a.answer_received_at>clock_timestamp()-engagement_retention_days(t.retention_policy)*interval '1 day')))) authorized from survey_report_input_candidates c where c.tenant_id=${req.tenantId}::uuid and c.cycle_id=${req.cycleId}::uuid and c.id=any(${'{' + currentIds.join(',') + '}'}::uuid[])`,
    );
    if (rows.length !== sections.length) return false;
    for (const [i, s] of sections.entries()) {
      const row = rows.find((r) => r.id === s.candidateId);
      if (
        !row?.authorized ||
        row.authorization_token !== s.candidateAuthorizationToken ||
        token(row.context) !== token(s.context) ||
        token(row.metrics) !== token(s.metrics)
      )
        return false;
      const old = s.baselineInventory ?? [];
      const now = after.histories[i]!;
      const baselines = Object.fromEntries(
        s.metrics.map((m) => [m.metricKey, selectPulseReportBaseline(s.context, m, now)]),
      );
      const selected =
        pinnedObservation || restrictedHistory
          ? restrictPulsePresentationHistory([{ ...s, baselineInventory: now, baselines }], req)[0]!
          : { ...s, baselines, baselineInventory: minimizePulseHistory(now, baselines) };
      // Old frozen producers included harmless statuses for metrics not displayed by this variant.
      const storedBaselines = pinnedObservation
        ? Object.fromEntries(
            Object.entries(s.baselines ?? {}).filter(
              ([key, value]) =>
                Object.prototype.hasOwnProperty.call(selected.baselines ?? {}, key) ||
                !['{"status":"baseline_established"}', '{"status":"no_previous_final"}'].includes(
                  canonical(value),
                ),
            ),
          )
        : (s.baselines ?? {});
      if (
        token(old) !== token(selected.baselineInventory) ||
        token(selected.baselines) !== token(storedBaselines)
      )
        return false;
    }
    return true;
  }
}
