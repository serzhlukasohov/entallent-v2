import type { PulseReportCollectionUnavailableReason } from '../ports/pulse-report-scope.repository.port';

type ReportInstant = Date | string;

function receiptMicros(value: ReportInstant | null): bigint | null {
  if (value === null) return null;
  const millis = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(millis)) return null;
  const fraction = typeof value === 'string' ? value.match(/\.(\d{1,6})(?:Z|[+-]\d{2}(?::?\d{2})?)$/)?.[1] : undefined;
  return BigInt(millis) * 1000n + BigInt(fraction?.padEnd(6, '0').slice(3) ?? '0');
}

export interface PulseReportAdmissionInput {
  periodStart: ReportInstant;
  periodEnd: ReportInstant;
  openedAt: ReportInstant;
  collectionStoppedAt: ReportInstant | null;
  fullReportingDenied: boolean;
  lineageExcluded: boolean;
  receivedAt: ReportInstant | null;
  /** Omit for capture; explicitly pass null when a required confirmation lacks proof. */
  confirmationReceivedAt?: ReportInstant | null;
}
export function evaluatePulseReportAdmission(input: PulseReportAdmissionInput): 'allowed' | PulseReportCollectionUnavailableReason {
  if (input.fullReportingDenied) return 'full_withdrawal';
  if (input.lineageExcluded) return 'lineage_excluded';
  const times = [input.receivedAt, ...(input.confirmationReceivedAt === undefined ? [] : [input.confirmationReceivedAt])].map(receiptMicros);
  const start = receiptMicros(input.periodStart);
  const end = receiptMicros(input.periodEnd);
  const opened = receiptMicros(input.openedAt);
  const stopped = receiptMicros(input.collectionStoppedAt);
  if (times.some((time) => time === null) || start === null || end === null || opened === null) return 'missing_proof';
  const lower = start > opened ? start : opened;
  const upper = stopped !== null && stopped < end ? stopped : end;
  return times.every((time) => time! >= lower && time! < upper) ? 'allowed' : 'stopped';
}
export function pulseReportDenominator(frozenRosterSize: number, fullWithdrawals: number) {
  if (!Number.isSafeInteger(frozenRosterSize) || !Number.isSafeInteger(fullWithdrawals)
    || fullWithdrawals < 0 || frozenRosterSize < fullWithdrawals) throw new Error('pulse_report_denominator_invalid');
  const denominator = frozenRosterSize - fullWithdrawals;
  return { denominator, threshold: Math.max(5, Math.ceil(0.8 * denominator)) };
}
