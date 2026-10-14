import { describe, expect, it, vi } from 'vitest';
import { ModerationSignalError, type ModerationSignal, type RiskDetection } from '@entalent/contracts';
import {
  applyModerationTripwire,
  assessRisk,
  isRiskTurn,
  mustEscalate,
  riskBlocksSurvey,
  toAssessedRisk,
  unassessedRisk,
} from './risk-policy';

const NONE: RiskDetection = {
  riskType: null,
  severity: 'none',
  confidence: 0.8,
  evidence: [],
  immediateResponseRequired: false,
  escalationRecommended: false,
  surveyMustBeBlocked: false,
  proactiveMessagesMustBePaused: false,
  reasoningSummary: 'none',
};

const signal = (categories: ModerationSignal['categories'], blocked = false): ModerationSignal => ({
  source: blocked ? 'azure_content_filter' : 'openai_moderation', blocked, categories,
});

const SEVERITIES = ['none', 'low', 'medium', 'high', 'critical'] as const;
const RANK = Object.fromEntries(SEVERITIES.map((s, i) => [s, i])) as Record<string, number>;

describe('risk policy (ADR-013 D3/R1)', () => {
  it('marks a provider result as assessed and keeps the model confidence', () => {
    expect(toAssessedRisk(NONE)).toEqual({ ...NONE, assessed: true, tripwireRaised: false });
  });

  it('raises self-harm intent to critical with immediate response', () => {
    const risk = toAssessedRisk({ ...NONE, moderation: signal([{ category: 'self_harm_intent', level: null }]) });
    expect(risk).toMatchObject({
      severity: 'critical', riskType: 'potential_self_harm', immediateResponseRequired: true,
      surveyMustBeBlocked: true, proactiveMessagesMustBePaused: true, escalationRecommended: true,
      tripwireRaised: true, confidence: 0.8,
    });
    expect(mustEscalate(risk)).toBe(true);
  });

  it('raises a generic self-harm flag to high without escalating', () => {
    const risk = toAssessedRisk({ ...NONE, moderation: signal([{ category: 'self_harm', level: null }]) });
    expect(risk).toMatchObject({ severity: 'high', immediateResponseRequired: false, tripwireRaised: true });
    expect(mustEscalate(risk)).toBe(false);
  });

  it('ignores low violence bands as noise', () => {
    const risk = toAssessedRisk({ ...NONE, moderation: signal([{ category: 'violence', level: 'low' }]) });
    expect(risk).toMatchObject({ severity: 'none', tripwireRaised: false });
  });

  it('is monotonic: never lowers severity or clears a flag, for every severity × signal', () => {
    const signals: ModerationSignal['categories'][] = [
      [], [{ category: 'violence', level: 'low' }], [{ category: 'violence', level: 'medium' }],
      [{ category: 'self_harm', level: 'low' }], [{ category: 'self_harm', level: 'high' }],
      [{ category: 'harassment_threatening', level: null }], [{ category: 'self_harm_instructions', level: null }],
    ];
    for (const severity of SEVERITIES) {
      for (const flag of [false, true]) {
        for (const categories of signals) {
          const model: RiskDetection = {
            ...NONE, severity, riskType: severity === 'none' ? null : 'burnout',
            immediateResponseRequired: flag, surveyMustBeBlocked: flag,
            proactiveMessagesMustBePaused: flag, escalationRecommended: flag,
          };
          const raised = toAssessedRisk({ ...model, moderation: signal(categories) });
          expect(RANK[raised.severity]).toBeGreaterThanOrEqual(RANK[severity]!);
          for (const key of ['immediateResponseRequired', 'surveyMustBeBlocked', 'proactiveMessagesMustBePaused', 'escalationRecommended'] as const) {
            if (model[key]) expect(raised[key]).toBe(true);
          }
          if (RANK[raised.severity] === RANK[severity]) expect(raised.riskType).toBe(model.riskType ?? raised.riskType);
        }
      }
    }
  });

  it('unassessed risk carries no confidence and is never safe', () => {
    const risk = unassessedRisk('assessment_failed');
    expect(risk).not.toHaveProperty('confidence');
    expect(risk.severity).toBe('unknown');
    expect(isRiskTurn(risk)).toBe(true);
    expect(riskBlocksSurvey(risk)).toBe(true);
    expect(mustEscalate(risk)).toBe(false);
  });

  it('a moderation refusal on self-harm makes unassessed risk critical', () => {
    const risk = unassessedRisk('moderation_blocked', signal([{ category: 'self_harm', level: 'medium' }], true));
    expect(risk).toMatchObject({ assessed: false, severity: 'critical', tripwireRaised: true });
    expect(mustEscalate(risk)).toBe(true);
  });

  it('applyModerationTripwire is idempotent', () => {
    const once = toAssessedRisk({ ...NONE, moderation: signal([{ category: 'self_harm', level: 'high' }]) });
    expect(applyModerationTripwire(once)).toEqual(once);
  });

  describe('assessRisk', () => {
    const turns = [{ role: 'user' as const, content: 'hi', timestamp: new Date() }];

    it('never rejects on provider failure', async () => {
      const provider = { detectRisk: vi.fn().mockRejectedValue(new Error('boom')) };
      await expect(assessRisk(provider, turns, { userName: 'A' })).resolves.toMatchObject({
        assessed: false, reason: 'assessment_failed',
      });
    });

    it('treats malformed output as unassessed', async () => {
      const provider = { detectRisk: vi.fn().mockResolvedValue(undefined) };
      await expect(assessRisk(provider, turns, { userName: 'A' })).resolves.toMatchObject({
        assessed: false, reason: 'invalid_output',
      });
    });

    it('keeps the moderation signal of a failed call', async () => {
      const moderation = signal([{ category: 'self_harm_intent', level: null }]);
      const provider = { detectRisk: vi.fn().mockRejectedValue(new ModerationSignalError(moderation)) };
      await expect(assessRisk(provider, turns, { userName: 'A' })).resolves.toMatchObject({
        assessed: false, reason: 'assessment_failed', severity: 'critical', moderation,
      });
    });
  });
});
