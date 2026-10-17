import type {
  AssessedRisk,
  ModerationSignal,
  ProviderRiskDetection,
  RiskAssessment,
  RiskDetection,
  RiskSeverity,
  RiskType,
  UnassessedRisk,
} from '@entalent/contracts';
import { isModerationSignalError } from '@entalent/contracts';
import type { AiProviderPort, ConversationTurn, RiskContext } from '../ports/ai-provider.port';

/**
 * Safety policy over typed risk signals (ADR-013 D3, R1, R5).
 *
 * - Risk is assessed on every turn; a failed assessment is `assessed: false`, never "safe".
 * - A provider moderation signal is a monotonic tripwire: it can raise severity and flags,
 *   never lower them.
 * - The escalation threshold stays `critical` / immediate-response until the escalation
 *   channel and its reviewer exist (R5).
 */
export const RISK_TRIPWIRE_POLICY_VERSION = 'risk-tripwire-v1';

const SEVERITY_RANK: Record<RiskSeverity, number> = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };

type TripwireRaise = {
  severity: Exclude<RiskSeverity, 'none'>;
  riskType: RiskType;
  immediateResponseRequired: boolean;
};

/**
 * Moderation categories → minimum severity. Azure reports bands; OpenAI reports booleans (level
 * null). Self-harm is weighted highest because a provider refusal on self-harm otherwise leaves
 * the turn without any assessment. `low` violence/hate bands are ignored as too noisy.
 */
export function tripwireRaise(signal: ModerationSignal | undefined): TripwireRaise | null {
  if (!signal) return null;
  let best: TripwireRaise | null = null;
  const consider = (candidate: TripwireRaise) => {
    if (!best || SEVERITY_RANK[candidate.severity] > SEVERITY_RANK[best.severity]) best = candidate;
  };
  for (const { category, level } of signal.categories) {
    switch (category) {
      case 'self_harm_intent':
      case 'self_harm_instructions':
        consider({ severity: 'critical', riskType: 'potential_self_harm', immediateResponseRequired: true });
        break;
      case 'self_harm':
        consider(level === 'medium' || level === 'high'
          ? { severity: 'critical', riskType: 'potential_self_harm', immediateResponseRequired: true }
          : { severity: 'high', riskType: 'potential_self_harm', immediateResponseRequired: false });
        break;
      case 'violence':
      case 'hate_threatening':
      case 'harassment_threatening':
        if (level !== 'low') {
          consider({
            severity: 'high',
            riskType: category === 'harassment_threatening' ? 'workplace_harassment' : 'immediate_danger',
            immediateResponseRequired: false,
          });
        }
        break;
    }
  }
  return best;
}

export function toAssessedRisk(detection: ProviderRiskDetection): AssessedRisk {
  const { moderation, ...model } = detection;
  const assessed: AssessedRisk = { ...model, assessed: true, tripwireRaised: false };
  if (moderation) assessed.moderation = moderation;
  return applyModerationTripwire(assessed);
}

export function unassessedRisk(reason: UnassessedRisk['reason'], moderation?: ModerationSignal): UnassessedRisk {
  const risk: UnassessedRisk = {
    assessed: false,
    reason,
    riskType: null,
    severity: 'unknown',
    immediateResponseRequired: false,
    tripwireRaised: false,
  };
  if (moderation) risk.moderation = moderation;
  return applyModerationTripwire(risk);
}

/** Monotonic: the result is never less severe, and no safety flag is ever cleared. */
export function applyModerationTripwire<T extends RiskAssessment>(risk: T): T {
  const raise = tripwireRaise(risk.moderation);
  if (!raise) return risk;
  const current: RiskSeverity = risk.severity === 'unknown' ? 'none' : risk.severity;
  const raisesSeverity = SEVERITY_RANK[raise.severity] > SEVERITY_RANK[current];
  const immediate = risk.immediateResponseRequired || raise.immediateResponseRequired;
  if (!raisesSeverity && immediate === risk.immediateResponseRequired) return risk;

  const severity = raisesSeverity ? raise.severity : current;
  const riskType = raisesSeverity || !risk.riskType ? raise.riskType : risk.riskType;
  if (!risk.assessed) {
    return {
      ...risk,
      severity: severity === 'none' ? 'unknown' : severity,
      riskType,
      immediateResponseRequired: immediate,
      tripwireRaised: true,
    };
  }
  const atLeastHigh = SEVERITY_RANK[severity] >= SEVERITY_RANK.high;
  return {
    ...risk,
    severity,
    riskType,
    immediateResponseRequired: immediate,
    escalationRecommended: risk.escalationRecommended || atLeastHigh,
    surveyMustBeBlocked: risk.surveyMustBeBlocked || atLeastHigh,
    proactiveMessagesMustBePaused: risk.proactiveMessagesMustBePaused || severity === 'critical',
    tripwireRaised: true,
  };
}

/**
 * Runs the risk detector and never rejects: any failure becomes `assessed: false`, so the turn
 * can still apply safety policy (and escalate on a tripwire) even when the detector is down.
 */
export async function assessRisk(
  provider: Pick<AiProviderPort, 'detectRisk'>,
  turns: ConversationTurn[],
  context: RiskContext,
): Promise<RiskAssessment> {
  try {
    const detection = await provider.detectRisk(turns, context);
    if (!isRiskDetectionLike(detection)) return unassessedRisk('invalid_output');
    return toAssessedRisk(detection);
  } catch (err) {
    if (!isModerationSignalError(err)) return unassessedRisk('assessment_failed');
    return unassessedRisk(err.moderation.blocked ? 'moderation_blocked' : 'assessment_failed', err.moderation);
  }
}

function isRiskDetectionLike(value: unknown): value is ProviderRiskDetection {
  return typeof value === 'object' && value !== null
    && typeof (value as Partial<RiskDetection>).severity === 'string'
    && (value as Partial<RiskDetection>).severity! in SEVERITY_RANK;
}

/** Unknown risk blocks survey probing, like a detector that asked for the block. */
export function riskBlocksSurvey(risk: RiskAssessment | RiskDetection): boolean {
  if ('assessed' in risk && risk.assessed === false) return true;
  return (risk as RiskDetection).surveyMustBeBlocked;
}

/** True when the turn must be handled as a safety turn: known non-none risk, or unknown risk. */
export function isRiskTurn(risk: RiskAssessment): boolean {
  return !risk.assessed || risk.severity !== 'none';
}

/** MustEscalate (R5): threshold unchanged — critical or immediate-response only. */
export function mustEscalate(risk: RiskAssessment): boolean {
  return risk.immediateResponseRequired || risk.severity === 'critical';
}
