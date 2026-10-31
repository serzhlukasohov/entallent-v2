import { describe, expect, it } from 'vitest';
import { evaluatePulseReportAdmission, pulseReportDenominator } from './pulse-report-scope-policy';

describe('frozen report admission', () => {
  const input = { periodStart: new Date(0), periodEnd: new Date(100), openedAt: new Date(10), collectionStoppedAt: new Date(80), fullReportingDenied: false, lineageExcluded: false, receivedAt: new Date(20), confirmationReceivedAt: new Date(70) };
  it('uses server receipts and half-open opening/stop bounds independently of processing time', () => {
    expect(evaluatePulseReportAdmission(input)).toBe('allowed');
    for (const receivedAt of [new Date(0), new Date(80), new Date(100), null]) {
      expect(evaluatePulseReportAdmission({ ...input, receivedAt })).not.toBe('allowed');
    }
    expect(evaluatePulseReportAdmission({ ...input, confirmationReceivedAt: new Date(80) })).toBe('stopped');
    expect(evaluatePulseReportAdmission({ ...input, collectionStoppedAt: null, receivedAt: new Date(1) })).toBe('stopped');
  });
  it('preserves PostgreSQL microsecond bounds without excluding a timely millisecond receipt', () => {
    const proof = { ...input, periodStart: '2026-10-22T00:00:00Z', openedAt: '2026-10-22T00:00:00.000001Z', periodEnd: '2026-10-23T00:00:00Z', collectionStoppedAt: '2026-10-22T01:00:00.000500Z', receivedAt: '2026-10-22T01:00:00.000000Z', confirmationReceivedAt: '2026-10-22T01:00:00.000499Z' };
    expect(evaluatePulseReportAdmission(proof)).toBe('allowed');
    expect(evaluatePulseReportAdmission({ ...proof, confirmationReceivedAt: proof.collectionStoppedAt })).toBe('stopped');
  });
  it('keeps lineage exclusion separate from full denial and departure', () => {
    expect(evaluatePulseReportAdmission({ ...input, fullReportingDenied: true })).toBe('full_withdrawal');
    expect(evaluatePulseReportAdmission({ ...input, lineageExcluded: true })).toBe('lineage_excluded');
    expect(pulseReportDenominator(10, 2)).toEqual({ denominator: 8, threshold: 7 });
    expect(pulseReportDenominator(10, 0)).toEqual({ denominator: 10, threshold: 8 });
  });
});
