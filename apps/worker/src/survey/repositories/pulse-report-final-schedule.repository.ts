import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  assessPulseReportConfiguration,
  resolvePulseReportFinalSchedule,
  type PulseReportFinalScheduleRepositoryPort,
} from '@entalent/application';
import type {
  BeginPulseReportFinalFormationResult,
  PulseReportFinalTiming,
  ReportScheduleUnavailable,
} from '@entalent/contracts';
import {
  ensureReportConfigHead,
  lockPulseReportCycleExact,
  lockReportConfiguration,
  readReportConfigSource,
  readReportCycleExact,
  readReportFinalTiming,
  refreshReportFinalTiming,
  reportSourceFingerprint,
  withPulseReportSerializableRetry,
} from '@entalent/database';
import { DatabaseService } from '../../database/database.service';
type Tx = Parameters<Parameters<DatabaseService['client']['transaction']>[0]>[0];
/** No queue, sender or legacy scheduler invokes this boundary in RPT-04. */
@Injectable()
export class PulseReportFinalScheduleRepository implements PulseReportFinalScheduleRepositoryPort {
  constructor(private readonly db: DatabaseService) {}
  async read(tenantId: string, cycleId: string): Promise<PulseReportFinalTiming | null> {
    return (await readReportFinalTiming(
      this.db.client,
      tenantId,
      cycleId,
    )) as unknown as PulseReportFinalTiming | null;
  }
  async refreshInTransaction(tx: Tx, tenantId: string, cycleId: string) {
    const cycle = await readReportCycleExact(tx, tenantId, cycleId);
    if (!cycle) return null;
    const head = await ensureReportConfigHead(tx, tenantId, assessPulseReportConfiguration);
    await refreshReportFinalTiming(tx, cycle, head, resolvePulseReportFinalSchedule);
    return (await readReportFinalTiming(
      tx,
      tenantId,
      cycleId,
    )) as unknown as PulseReportFinalTiming;
  }
  async refresh(tenantId: string, cycleId: string) {
    return withPulseReportSerializableRetry(() =>
      this.db.client.transaction(
        async (tx) => {
          await lockReportConfiguration(tx, tenantId);
          return this.refreshInTransaction(tx, tenantId, cycleId);
        },
        { isolationLevel: 'serializable' },
      ),
    );
  }
  async begin(
    tenantId: string,
    cycleId: string,
    expectedConfigRevision: number,
  ): Promise<BeginPulseReportFinalFormationResult> {
    return withPulseReportSerializableRetry(() =>
      this.db.client.transaction(
        async (tx) => {
          await lockReportConfiguration(tx, tenantId);
          const cycle = await readReportCycleExact(tx, tenantId, cycleId);
          if (!cycle) return { status: 'missing_native_cycle' } as const;
          await lockPulseReportCycleExact(tx, cycle);
          let timing = (await readReportFinalTiming(
            tx,
            tenantId,
            cycleId,
          )) as unknown as PulseReportFinalTiming | null;
          // Recovery is pinned to the first context even after edits and with an obsolete request.
          if (timing?.status === 'started') return { status: 'started', context: timing } as const;
          const head = await ensureReportConfigHead(tx, tenantId, assessPulseReportConfiguration);
          const source = await readReportConfigSource(tx, tenantId);
          if (reportSourceFingerprint(source) !== head.sourceFingerprint)
            return { status: 'blocked', reason: 'source_out_of_sync' } as const;
          if (head.revision !== expectedConfigRevision) return { status: 'stale_plan' } as const;
          if (!timing || timing.configRevision !== head.revision) {
            await refreshReportFinalTiming(tx, cycle, head, resolvePulseReportFinalSchedule);
            timing = (await readReportFinalTiming(
              tx,
              tenantId,
              cycleId,
            )) as unknown as PulseReportFinalTiming;
          }
          if (timing.status === 'blocked')
            return {
              status: 'blocked',
              reason: timing.blockedReason! as ReportScheduleUnavailable,
            } as const;
          const due = (await tx.execute(
            sql`select final_due_at<=clock_timestamp() as due from survey_report_final_timings where tenant_id=${tenantId}::uuid and cycle_scoring_policy_id=${cycleId}::uuid`,
          )) as { due: boolean }[];
          if (!due[0]?.due) return { status: 'not_due' } as const;
          // The trigger captures one clock_timestamp(), assigning both immutable fields.
          await tx.execute(
            sql`update survey_report_final_timings set status='started' where tenant_id=${tenantId}::uuid and cycle_scoring_policy_id=${cycleId}::uuid`,
          );
          return {
            status: 'started',
            context: (await readReportFinalTiming(
              tx,
              tenantId,
              cycleId,
            )) as unknown as PulseReportFinalTiming,
          } as const;
        },
        { isolationLevel: 'serializable' },
      ),
    );
  }
}
