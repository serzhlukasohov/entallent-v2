import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  assessPulseReportConfiguration,
  resolvePulseReportFinalSchedule,
} from '@entalent/application';
import {
  canonicalCompanyLocale,
  ReportCalendarMutationSchema,
  ReportCalendarSchema,
} from '@entalent/contracts';
import {
  appendReportConfigRevision,
  auditLogs,
  ensureReportConfigHead,
  lockReportConfiguration,
  readReportConfigHead,
  readReportConfigSource,
  refreshPendingReportFinalTimings,
  ReportConfigurationConflict,
  reportSourceFingerprint,
  withPulseReportSerializableRetry,
} from '@entalent/database';
import { DatabaseService } from '../database/database.service';
import {
  actorId,
  assertHierarchyActorAuthorized,
  type HierarchyActor,
} from '../hierarchy/hierarchy-authorization';

export class ReportConfigurationError extends Error {
  constructor(
    readonly code: 'invalid_calendar' | 'invalid_locale' | 'operator_required' | 'invalid_revision',
  ) {
    super(code);
  }
}
@Injectable()
export class ReportConfigurationService {
  constructor(private readonly db: DatabaseService) {}
  async read(tenantId: string) {
    const source = await readReportConfigSource(this.db.client, tenantId);
    const head = await readReportConfigHead(this.db.client, tenantId);
    if (!head) return { ...assessPulseReportConfiguration(source), tenantId, revision: 0, sourceFingerprint: reportSourceFingerprint(source) };
    return { ...head, unavailableReason: reportSourceFingerprint(source) === head.sourceFingerprint ? head.unavailableReason : 'source_out_of_sync' };
  }
  async current(tenantId: string) {
    return withPulseReportSerializableRetry(() =>
      this.db.client.transaction(
        async (tx) => {
          await lockReportConfiguration(tx, tenantId);
          const head = await ensureReportConfigHead(tx, tenantId, assessPulseReportConfiguration);
          const source = await readReportConfigSource(tx, tenantId);
          return {
            ...head,
            unavailableReason:
              reportSourceFingerprint(source) === head.sourceFingerprint
                ? head.unavailableReason
                : 'source_out_of_sync',
          };
        },
        { isolationLevel: 'serializable' },
      ),
    );
  }
  async saveCalendar(
    tenantId: string,
    input: unknown,
    operator: string,
    expectedConfigRevision: number,
  ) {
    if (!operator.trim()) throw new ReportConfigurationError('operator_required');
    if (!ReportCalendarMutationSchema.safeParse(input).success)
      throw new ReportConfigurationError('invalid_calendar');
    return this.save(tenantId, { calendar: input }, expectedConfigRevision, {
      type: 'internal_operator',
      operatorId: operator,
    });
  }
  async saveLanguage(
    tenantId: string,
    input: unknown,
    expectedConfigRevision: number,
    actor: HierarchyActor,
  ) {
    const locale = canonicalCompanyLocale(input);
    if (typeof input !== 'string' || !locale) throw new ReportConfigurationError('invalid_locale');
    return this.save(tenantId, { locale }, expectedConfigRevision, actor);
  }
  private async save(
    tenantId: string,
    mutation: { calendar?: unknown; locale?: string },
    expected: number,
    actor: HierarchyActor,
  ) {
    if (!Number.isInteger(expected) || expected < 0)
      throw new ReportConfigurationError('invalid_revision');
    return withPulseReportSerializableRetry(() =>
      this.db.client.transaction(
        async (tx) => {
          await lockReportConfiguration(tx, tenantId);
          await assertHierarchyActorAuthorized(tx, tenantId, actor);
          const before = await readReportConfigSource(tx, tenantId),
            head = await readReportConfigHead(tx, tenantId);
          if ((head?.revision ?? 0) !== expected) throw new ReportConfigurationConflict();
          const after = { ...before };
          if (mutation.calendar !== undefined) {
            const parsed = ReportCalendarMutationSchema.parse(mutation.calendar);
            const merged = ReportCalendarSchema.safeParse({
              ...parsed,
              holidays: parsed.holidays ?? before.calendar?.['holidays'] ?? [],
              dateOverrides: parsed.dateOverrides ?? before.calendar?.['dateOverrides'] ?? [],
            });
            if (!merged.success) throw new ReportConfigurationError('invalid_calendar');
            after.calendar = merged.data;
          }
          if (mutation.locale !== undefined) after.locale = mutation.locale;
          const fingerprint = reportSourceFingerprint(after);
          if (
            head?.sourceFingerprint === fingerprint &&
            reportSourceFingerprint(before) === fingerprint
          )
            return { configuration: head, calendar: after.calendar, changed: false };
          if (mutation.calendar !== undefined) {
            const c = after.calendar!;
            await tx.execute(sql`insert into tenant_work_calendars (tenant_id,timezone,working_days,work_start,work_end,holidays,date_overrides,updated_by)
      values (${tenantId}::uuid,${c['timezone']},${`{${(c['workingDays'] as number[]).join(',')}}`}::smallint[],${c['workStart']},${c['workEnd']},${JSON.stringify(c['holidays'])}::jsonb,${JSON.stringify(c['dateOverrides'])}::jsonb,${actorId(actor)})
      on conflict(tenant_id) do update set timezone=excluded.timezone,working_days=excluded.working_days,work_start=excluded.work_start,work_end=excluded.work_end,holidays=excluded.holidays,date_overrides=excluded.date_overrides,updated_by=excluded.updated_by,updated_at=clock_timestamp()`);
          }
          if (mutation.locale !== undefined)
            await tx.execute(
              sql`update tenants set locale=${mutation.locale} where id=${tenantId}::uuid`,
            );
          const configuration = await appendReportConfigRevision(
            tx,
            tenantId,
            after,
            assessPulseReportConfiguration(after),
            { type: actor.type, id: actorId(actor) },
          );
          const affectedCycleIds = await refreshPendingReportFinalTimings(
            tx,
            tenantId,
            configuration,
            resolvePulseReportFinalSchedule,
          );
          await tx
            .insert(auditLogs)
            .values({
              tenantId,
              actorType: actor.type,
              actorId: actorId(actor),
              action:
                mutation.calendar !== undefined
                  ? 'org.work_calendar.configure'
                  : 'org.report_language.configure',
              resourceType: 'tenant',
              resourceId: tenantId,
              metadata: {
                before,
                after,
                beforeRevision: head?.revision ?? 0,
                afterRevision: configuration.revision,
                affectedCycleIds,
                reconciliation: reportSourceFingerprint(before) === fingerprint,
              },
            });
          return { configuration, calendar: after.calendar, changed: true };
        },
        { isolationLevel: 'serializable' },
      ),
    );
  }
}
