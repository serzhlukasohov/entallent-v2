import { describe, expect, it } from 'vitest';
import { RUNNER_CONFIG, agreementFor, judgedSuite } from '../__fixtures__/runner';
import type { AgreementFile } from '../schema';
import { labelsSha256 } from './calibrate';
import { computeJudgeFingerprint } from './fingerprint';
import { decideJudgeTrust, type JudgeTrustInputs } from './trust';

const suite = judgedSuite();
const pin = computeJudgeFingerprint(RUNNER_CONFIG.judge, suite);
const LABELS = labelsSha256([]);

function inputs(agreement: AgreementFile | null, overrides: Partial<JudgeTrustInputs> = {}): JudgeTrustInputs {
  return { judge: RUNNER_CONFIG.judge, suite, agreement, labelsSha256: LABELS, unpinned: false, ...overrides };
}

const reason = (agreement: AgreementFile | null, overrides: Partial<JudgeTrustInputs> = {}) =>
  decideJudgeTrust(inputs(agreement, overrides)).reason;

describe('decideJudgeTrust', () => {
  it('is untrusted no-agreement without a file, with the configured pin', () => {
    expect(decideJudgeTrust(inputs(null))).toEqual({ trusted: false, reason: 'no-agreement', pin, agreement: null });
  });

  it('is trusted calibrated when fingerprint and labels match and thresholds are met', () => {
    const agreement = agreementFor(suite);
    expect(decideJudgeTrust(inputs(agreement))).toEqual({ trusted: true, reason: 'calibrated', pin, agreement });
    // Thresholds are inclusive.
    expect(reason(agreementFor(suite, { overall: 0.85, kappa: 0.6 }))).toBe('calibrated');
  });

  it.each([
    ['provider', { ...pin, provider: 'azure_openai' }],
    ['model', { ...pin, model: 'gpt-4o-mini' }],
    ['decoding', { ...pin, decoding: { ...pin.decoding, temperature: 0.2 } }],
    ['promptSha256', { ...pin, promptSha256: 'a'.repeat(64) }],
    ['schemaSha256', { ...pin, schemaSha256: 'b'.repeat(64) }],
    ['guidanceSha256', { ...pin, guidanceSha256: 'c'.repeat(64) }],
  ])('names fingerprint-mismatch:%s', (field, fingerprint) => {
    expect(reason(agreementFor(suite, { fingerprint }))).toBe(`fingerprint-mismatch:${field}`);
  });

  it('compares fingerprints by stable JSON, not key order', () => {
    const reordered = Object.fromEntries(Object.entries(pin).reverse()) as typeof pin;
    expect(reason(agreementFor(suite, { fingerprint: reordered }))).toBe('calibrated');
  });

  it('sees edited guidance as a guidance mismatch', () => {
    const agreement = agreementFor(suite);
    expect(reason(agreement, { suite: judgedSuite({ guidance: 'Edited guidance.' }) })).toBe('fingerprint-mismatch:guidanceSha256');
  });

  it.each([
    ['labels-mismatch', { labelsSha256: 'd'.repeat(64) }],
    ['below-min-labels', { n: 3 }],
    ['below-threshold:overall', { overall: 0.84 }],
    ['below-threshold:overall', { overall: null }],
    ['below-threshold:kappa', { kappa: 0.4 }],
    ['below-threshold:kappa', { kappa: null }],
  ] as Array<[string, Partial<AgreementFile>]>)('names %s for %j', (expected, overrides) => {
    expect(reason(agreementFor(suite, overrides))).toBe(expected);
  });

  it('applies the reasons in order: unpinned, absent, fingerprint, labels, n, overall, kappa', () => {
    const worst = agreementFor(suite, {
      fingerprint: { ...pin, provider: 'azure_openai', guidanceSha256: 'c'.repeat(64) },
      labelsSha256: 'd'.repeat(64),
      n: 1,
      overall: null,
      kappa: null,
    });
    expect(reason(worst, { unpinned: true })).toBe('unpinned-judge');
    expect(reason(null, { unpinned: true })).toBe('unpinned-judge');
    expect(reason(worst)).toBe('fingerprint-mismatch:provider');
    expect(reason({ ...worst, fingerprint: pin })).toBe('labels-mismatch');
    expect(reason({ ...worst, fingerprint: pin, labelsSha256: LABELS })).toBe('below-min-labels');
    expect(reason({ ...worst, fingerprint: pin, labelsSha256: LABELS, n: 40 })).toBe('below-threshold:overall');
    expect(reason({ ...worst, fingerprint: pin, labelsSha256: LABELS, n: 40, overall: 0.9 })).toBe('below-threshold:kappa');
  });

  it('keeps the configured pin and the agreement on an unpinned run', () => {
    const agreement = agreementFor(suite);
    expect(decideJudgeTrust(inputs(agreement, { unpinned: true }))).toEqual({ trusted: false, reason: 'unpinned-judge', pin, agreement });
  });
});
