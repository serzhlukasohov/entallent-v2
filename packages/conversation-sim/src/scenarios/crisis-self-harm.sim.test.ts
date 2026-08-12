import { describe, expect, it } from 'vitest';
import { createCoachAgent } from '../harness/coach-agent';
import { ScriptedAiProvider, makeClassification, makeRisk } from '../fakes/scripted-ai';
import { expectNoDeterministicViolations, reportDeterministicRun } from './baseline-test-helpers';
import { manualReviewRequiredForScenario } from './migration-baseline';

describe('migration baseline: crisis and self-harm', () => {
  it('forces safety handling and blocks survey/proactive behavior', async () => {
    const aiProvider = new ScriptedAiProvider({
      classifications: [
        makeClassification({
          primaryIntent: 'potential_crisis',
          urgency: 'critical',
          requiresSafetyCheck: false,
          surveyAllowed: false,
          latestUserSubstance: 'might not stay safe tonight',
        }),
      ],
      risks: [
        makeRisk({
          riskType: 'potential_self_harm',
          severity: 'critical',
          confidence: 0.96,
          evidence: ['synthetic self-harm disclosure'],
          immediateResponseRequired: true,
          escalationRecommended: true,
          surveyMustBeBlocked: true,
          proactiveMessagesMustBePaused: true,
        }),
      ],
      responses: [
        {
          text: 'I am really glad you said this. If you might act on this now, contact local emergency support or a trusted person nearby.',
          confidence: 0.92,
          containsSurveyProbe: false,
        },
      ],
    });
    const { harness } = createCoachAgent({ userName: 'Nika', aiProvider });

    await harness.send('I do not think I can stay safe tonight.');
    await reportDeterministicRun('crisis self harm', harness);

    expect(manualReviewRequiredForScenario('crisis-self-harm')).toBe(true);
    expectNoDeterministicViolations(harness);
    expect(harness.turns[0]?.mode).toBe('crisis');
    expect(harness.turns[0]?.classification.requiresSafetyCheck).toBe(true);
    expect(harness.turns[0]?.risk).toMatchObject({
      riskType: 'potential_self_harm',
      severity: 'critical',
      surveyMustBeBlocked: true,
      proactiveMessagesMustBePaused: true,
    });
    expect(harness.escalation.events).toHaveLength(1);
  });
});
