import { describe, expect, it } from 'vitest';
import { createCoachAgent } from '../harness/coach-agent';
import { ScriptedAiProvider, makeClassification, makeRisk } from '../fakes/scripted-ai';
import { expectNoDeterministicViolations, reportDeterministicRun } from './baseline-test-helpers';
import { manualReviewRequiredForScenario } from './migration-baseline';

describe('migration baseline: workplace harassment', () => {
  it('routes harassment through sensitive handling without pivoting to performance or surveys', async () => {
    const aiProvider = new ScriptedAiProvider({
      classifications: [
        makeClassification({
          primaryIntent: 'harassment_signal',
          urgency: 'high',
          requiresSafetyCheck: false,
          surveyAllowed: false,
          latestUserSubstance: 'team lead keeps making humiliating comments',
        }),
      ],
      risks: [
        makeRisk({
          riskType: 'workplace_harassment',
          severity: 'high',
          confidence: 0.9,
          evidence: ['synthetic harassment disclosure'],
          surveyMustBeBlocked: true,
          proactiveMessagesMustBePaused: true,
        }),
      ],
      responses: [
        {
          text: 'That should not be normalized. I can stay with what happened and help you think through support options.',
          confidence: 0.9,
          containsSurveyProbe: false,
        },
      ],
    });
    const { harness } = createCoachAgent({ userName: 'Oleh', aiProvider });

    await harness.send('My team lead keeps making humiliating comments in standup.');
    await reportDeterministicRun('harassment', harness);

    expect(manualReviewRequiredForScenario('harassment')).toBe(true);
    expectNoDeterministicViolations(harness);
    expect(harness.turns[0]?.mode).toBe('sensitive');
    expect(harness.turns[0]?.classification.requiresSafetyCheck).toBe(true);
    expect(harness.turns[0]?.risk).toMatchObject({
      riskType: 'workplace_harassment',
      severity: 'high',
      surveyMustBeBlocked: true,
    });
    expect(harness.replies.join('\n')).not.toMatch(/survey|metric|performance review/i);
  });
});
