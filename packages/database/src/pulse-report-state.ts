import { sql, type SQL } from 'drizzle-orm';
export interface PulseReportExecutor { execute(query: SQL): PromiseLike<unknown> }
export async function lockPulseReportSubject(tx: PulseReportExecutor, tenantId: string, userId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('pulse-report-subject:' || ${tenantId}::uuid::text || ':' || ${userId}::uuid::text, 0))`);
}
export async function lockPulseReportCycle(tx: PulseReportExecutor, input: { tenantId: string; surveyDefinitionId: string; periodStart: Date; periodEnd: Date }): Promise<void> {
  // Identical text/cast order to the existing V2 cycle/window-policy triggers.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.tenantId}::uuid::text || ':' || ${input.surveyDefinitionId}::uuid::text || ':' || ${input.periodStart.toISOString()}::timestamptz::text || ':' || ${input.periodEnd.toISOString()}::timestamptz::text, 0))`);
}
export async function pulseReportAdmission(tx: PulseReportExecutor, input: {
  tenantId: string; userId: string; surveyWindowId: string; surveyQuestionId?: string; sourceMessageId?: string;
}): Promise<string> {
  await lockPulseReportSubject(tx, input.tenantId, input.userId);
  const rows = await tx.execute(sql`select pulse_report_admission(${input.tenantId}::uuid, ${input.userId}::uuid, ${input.surveyWindowId}::uuid, ${input.surveyQuestionId ?? null}::uuid, ${input.sourceMessageId ?? null}::uuid) as decision`) as { decision: string }[];
  return rows[0]?.decision ?? 'missing_proof';
}
export async function stopChangedPulseReportParticipants(tx: PulseReportExecutor, tenantId: string, auditId: string): Promise<void> {
  await tx.execute(sql`select pulse_report_stop_changed(${tenantId}::uuid, ${auditId}::uuid)`);
}
export async function withPulseReportSerializableRetry<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await run(); } catch (error) {
      let candidate: unknown = error;
      let retry = false;
      for (let depth = 0; depth < 5 && candidate && typeof candidate === 'object'; depth++) {
        const record = candidate as { code?: string; cause?: unknown; constraint_name?: string };
        if (record.code === '40001' || record.code === '40P01'
          || (record.code === '23505' && /^(survey_report_|tenant_report_config_revisions_|report_participant_one_window)/.test(record.constraint_name ?? ''))) retry = true;
        candidate = record.cause;
      }
      if (!retry || attempt >= 4) throw error;
    }
  }
}

/** Preserves persisted PostgreSQL microseconds in the trigger-compatible advisory key. */
export async function lockPulseReportCycleExact(tx: PulseReportExecutor, input: { tenantId: string; surveyDefinitionId: string; periodStart: string; periodEnd: string }): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.tenantId}::uuid::text || ':' || ${input.surveyDefinitionId}::uuid::text || ':' || ${input.periodStart}::timestamptz::text || ':' || ${input.periodEnd}::timestamptz::text, 0))`);
}
