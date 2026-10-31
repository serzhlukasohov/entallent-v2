import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { lockPulseReportCycleExact, type PulseReportExecutor } from './pulse-report-state';

export interface ReportConfigSource {
  locale: unknown;
  calendar: Record<string, unknown> | null;
}
export interface ReportConfigAssessment {
  locale: string | null;
  calendar: unknown;
  unavailableReason: string | null;
}
export interface ReportConfigRevisionRow extends ReportConfigAssessment {
  tenantId: string;
  revision: number;
  sourceFingerprint: string;
  capturedAt: string;
}
export interface ReportCycleExact {
  tenantId: string;
  cycleScoringPolicyId: string;
  surveyDefinitionId: string;
  periodStart: string;
  periodEnd: string;
}
export type ReportScheduleResolver = (input: {
  periodStart: string;
  periodEnd: string;
  calendar: never;
}) =>
  | {
      status: 'scheduled';
      algorithmVersion: string;
      timezone: string;
      localDate: string;
      localWorkEnd: string;
      finalDueAt: string;
    }
  | {
      status: 'blocked';
      reason: string;
      timezone?: string;
      localDate?: string;
      localWorkEnd?: string;
    };
export class ReportConfigurationConflict extends Error {
  readonly code = 'stale_config_revision';
  constructor() {
    super('stale_config_revision');
    this.name = 'ReportConfigurationConflict';
  }
}

export async function lockReportConfiguration(
  tx: PulseReportExecutor,
  tenantId: string,
): Promise<void> {
  const rows = (await tx.execute(
    sql`select id from tenants where id=${tenantId}::uuid for no key update`,
  )) as { id: string }[];
  if (!rows.length) throw new Error('report_configuration_tenant_missing');
}
export async function readReportConfigSource(
  tx: PulseReportExecutor,
  tenantId: string,
): Promise<ReportConfigSource> {
  const rows =
    (await tx.execute(sql`select t.locale, case when c.tenant_id is null then null else jsonb_build_object(
    'timezone',c.timezone,'workingDays',c.working_days,'workStart',c.work_start,'workEnd',c.work_end,
    'holidays',c.holidays,'dateOverrides',c.date_overrides) end as calendar
    from tenants t left join tenant_work_calendars c on c.tenant_id=t.id where t.id=${tenantId}::uuid`)) as ReportConfigSource[];
  if (!rows.length) throw new Error('report_configuration_tenant_missing');
  return rows[0]!;
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export function reportSourceFingerprint(source: ReportConfigSource): string {
  return createHash('sha256').update(stable(source)).digest('hex');
}
export async function readReportConfigHead(
  tx: PulseReportExecutor,
  tenantId: string,
): Promise<ReportConfigRevisionRow | null> {
  const rows =
    (await tx.execute(sql`select tenant_id as "tenantId", revision, locale, calendar, unavailable_reason as "unavailableReason", source_fingerprint as "sourceFingerprint", to_char(captured_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "capturedAt"
    from tenant_report_config_revisions where tenant_id=${tenantId}::uuid order by revision desc limit 1`)) as ReportConfigRevisionRow[];
  return rows[0] ?? null;
}
export async function appendReportConfigRevision(
  tx: PulseReportExecutor,
  tenantId: string,
  source: ReportConfigSource,
  assessment: ReportConfigAssessment,
  actor: { type: string; id: string | null },
): Promise<ReportConfigRevisionRow> {
  const head = await readReportConfigHead(tx, tenantId);
  const revision = (head?.revision ?? 0) + 1;
  await tx.execute(sql`insert into tenant_report_config_revisions (tenant_id,revision,locale,calendar,unavailable_reason,source_fingerprint,actor_type,actor_id)
    values (${tenantId}::uuid,${revision},${assessment.locale},${assessment.calendar === null ? null : JSON.stringify(assessment.calendar)}::jsonb,${assessment.unavailableReason},${reportSourceFingerprint(source)},${actor.type},${actor.id})`);
  return (await readReportConfigHead(tx, tenantId))!;
}
/** Call only after the tenant lock. Initial capture records now, never invented historical time. */
export async function ensureReportConfigHead(
  tx: PulseReportExecutor,
  tenantId: string,
  assess: (source: ReportConfigSource) => ReportConfigAssessment,
): Promise<ReportConfigRevisionRow> {
  const head = await readReportConfigHead(tx, tenantId);
  if (head) return head;
  const source = await readReportConfigSource(tx, tenantId);
  return appendReportConfigRevision(tx, tenantId, source, assess(source), {
    type: 'initial_capture',
    id: null,
  });
}
export async function readReportCycleExact(
  tx: PulseReportExecutor,
  tenantId: string,
  cycleId: string,
): Promise<ReportCycleExact | null> {
  const rows =
    (await tx.execute(sql`select c.tenant_id as "tenantId",c.id as "cycleScoringPolicyId",c.survey_definition_id as "surveyDefinitionId",to_char(c.period_start at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "periodStart",to_char(c.period_end at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "periodEnd"
    from survey_cycle_scoring_policies c join survey_report_cycle_openings o on o.tenant_id=c.tenant_id and o.cycle_scoring_policy_id=c.id
    where c.tenant_id=${tenantId}::uuid and c.id=${cycleId}::uuid`)) as ReportCycleExact[];
  return rows[0] ?? null;
}
export async function refreshReportFinalTiming(
  tx: PulseReportExecutor,
  cycle: ReportCycleExact,
  head: ReportConfigRevisionRow,
  resolve: ReportScheduleResolver,
): Promise<void> {
  await lockPulseReportCycleExact(tx, cycle);
  const source = await readReportConfigSource(tx, cycle.tenantId);
  const result =
    reportSourceFingerprint(source) !== head.sourceFingerprint
      ? { status: 'blocked' as const, reason: 'source_out_of_sync' }
      : head.unavailableReason
        ? { status: 'blocked' as const, reason: head.unavailableReason }
        : resolve({ ...cycle, calendar: head.calendar as never });
  const scheduled = result.status === 'scheduled';
  await tx.execute(sql`insert into survey_report_final_timings (tenant_id,cycle_scoring_policy_id,config_revision,algorithm_version,status,blocked_reason,timezone,local_date,local_work_end,final_due_at)
    values (${cycle.tenantId}::uuid,${cycle.cycleScoringPolicyId}::uuid,${head.revision},'company-working-close-v1',${scheduled ? 'scheduled' : 'blocked'},${scheduled ? null : result.reason},${'timezone' in result ? (result.timezone ?? null) : null},${'localDate' in result ? (result.localDate ?? null) : null},${'localWorkEnd' in result ? (result.localWorkEnd ?? null) : null},${scheduled ? result.finalDueAt : null}::timestamptz)
    on conflict (tenant_id,cycle_scoring_policy_id) do update set config_revision=excluded.config_revision,algorithm_version=excluded.algorithm_version,status=excluded.status,blocked_reason=excluded.blocked_reason,timezone=excluded.timezone,local_date=excluded.local_date,local_work_end=excluded.local_work_end,final_due_at=excluded.final_due_at
    where survey_report_final_timings.status<>'started'`);
}
export async function refreshPendingReportFinalTimings(
  tx: PulseReportExecutor,
  tenantId: string,
  head: ReportConfigRevisionRow,
  resolve: ReportScheduleResolver,
): Promise<string[]> {
  const cycles =
    (await tx.execute(sql`select c.tenant_id as "tenantId",c.id as "cycleScoringPolicyId",c.survey_definition_id as "surveyDefinitionId",to_char(c.period_start at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "periodStart",to_char(c.period_end at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "periodEnd"
  from survey_cycle_scoring_policies c join survey_report_cycle_openings o on o.tenant_id=c.tenant_id and o.cycle_scoring_policy_id=c.id
  left join survey_report_final_timings f on f.tenant_id=c.tenant_id and f.cycle_scoring_policy_id=c.id
  where c.tenant_id=${tenantId}::uuid and f.status in ('blocked','scheduled')
  order by c.survey_definition_id,c.period_start,c.period_end`)) as ReportCycleExact[];
  for (const cycle of cycles) await refreshReportFinalTiming(tx, cycle, head, resolve);
  return cycles.map((c) => c.cycleScoringPolicyId);
}
export async function readReportFinalTiming(
  tx: PulseReportExecutor,
  tenantId: string,
  cycleId: string,
) {
  const rows =
    (await tx.execute(sql`select f.tenant_id as "tenantId",f.cycle_scoring_policy_id as "cycleScoringPolicyId",f.config_revision as "configRevision",r.locale,f.algorithm_version as "algorithmVersion",f.status,f.blocked_reason as "blockedReason",f.timezone,f.local_date as "localDate",f.local_work_end as "localWorkEnd",to_char(f.final_due_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "finalDueAt",to_char(f.formation_started_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "formationStartedAt",to_char(f.report_data_cutoff at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "reportDataCutoff",(extract(epoch from f.formation_started_at-f.final_due_at)*1000)::double precision as "observedDelayMs"
 from survey_report_final_timings f join tenant_report_config_revisions r on r.tenant_id=f.tenant_id and r.revision=f.config_revision
 where f.tenant_id=${tenantId}::uuid and f.cycle_scoring_policy_id=${cycleId}::uuid`)) as Record<
      string,
      unknown
    >[];
  return rows[0] ?? null;
}
