import { stableJson } from '../baseline';
import type { AgreementFile, JudgeFingerprint, JudgeTrust, LoadedSuite, SuiteConfig } from '../schema';
import { computeJudgeFingerprint } from './fingerprint';

/**
 * The judge trust decision for an L1/L2 run (architecture AD-8), in one place and pure.
 * `pin` is always the configured fingerprint (even for an unpinned run); `agreement` is the
 * file when present. The first failing check names the reason, most actionable first:
 *
 * 1. `unpinned-judge`: the run calls a model other than the pin (`--allow-unpinned-judge`);
 * 2. `no-agreement`: no agreement file (the normal state until QA labels exist);
 * 3. `fingerprint-mismatch:<field>`: the first differing fingerprint field, in the order
 *    provider, model, decoding, promptSha256, schemaSha256, guidanceSha256;
 * 4. `labels-mismatch`: the agreement was computed over other labels;
 * 5. `below-min-labels`: fewer than `judge.minLabels` labels;
 * 6. `below-threshold:overall` / 7. `below-threshold:kappa`: null or below the threshold;
 * 8. otherwise trusted, reason `calibrated`.
 */

export interface JudgeTrustInputs {
  judge: SuiteConfig['judge'];
  suite: Pick<LoadedSuite, 'tests'>;
  agreement: AgreementFile | null;
  /** `labelsSha256` of the suite's current labels. */
  labelsSha256: string;
  /** True when the run calls a judge model other than the pin. */
  unpinned: boolean;
}

export const FINGERPRINT_FIELDS = [
  'provider',
  'model',
  'decoding',
  'promptSha256',
  'schemaSha256',
  'guidanceSha256',
] as const satisfies ReadonlyArray<keyof JudgeFingerprint>;

// Compile-time exhaustiveness: a new fingerprint field must be added to FINGERPRINT_FIELDS.
type UnlistedFingerprintField = Exclude<keyof JudgeFingerprint, (typeof FINGERPRINT_FIELDS)[number]>;
const fingerprintFieldsAreExhaustive: [UnlistedFingerprintField] extends [never] ? true : never = true;
void fingerprintFieldsAreExhaustive;

export function decideJudgeTrust(inputs: JudgeTrustInputs): JudgeTrust {
  const pin = computeJudgeFingerprint(inputs.judge, inputs.suite);
  const agreement = inputs.agreement;
  const untrusted = (reason: string): JudgeTrust => ({ trusted: false, reason, pin, agreement });

  if (inputs.unpinned) return untrusted('unpinned-judge');
  if (agreement === null) return untrusted('no-agreement');
  const field = FINGERPRINT_FIELDS.find((name) => stableJson(agreement.fingerprint[name]) !== stableJson(pin[name]));
  if (field !== undefined) return untrusted(`fingerprint-mismatch:${field}`);
  if (agreement.labelsSha256 !== inputs.labelsSha256) return untrusted('labels-mismatch');
  if (agreement.n < inputs.judge.minLabels) return untrusted('below-min-labels');
  const threshold = inputs.judge.agreementThreshold;
  if (agreement.overall === null || agreement.overall < threshold.overall) return untrusted('below-threshold:overall');
  if (agreement.kappa === null || agreement.kappa < threshold.kappa) return untrusted('below-threshold:kappa');
  return { trusted: true, reason: 'calibrated', pin, agreement };
}
