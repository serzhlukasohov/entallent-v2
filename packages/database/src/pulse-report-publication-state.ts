import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { PulseReportExecutor } from './pulse-report-state';
export function pulseCanonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(pulseCanonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ':' + pulseCanonical(v))
        .join(',') +
      '}'
    );
  return JSON.stringify(value) ?? 'null';
}
export const pulsePublicationHash = (value: unknown) =>
  createHash('sha256').update(pulseCanonical(value)).digest('hex');
export async function boundPulsePublicationLocks(tx: PulseReportExecutor) {
  await tx.execute(sql`set local lock_timeout='2s'`);
  await tx.execute(sql`set local statement_timeout='15s'`);
}
