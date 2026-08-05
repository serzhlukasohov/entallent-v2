import { describe, expect, it } from 'vitest';
import { createCoachAgent } from '../harness/coach-agent';
import { ScriptedAiProvider, makeClassification, makeRisk } from '../fakes/scripted-ai';
import { expectNoDeterministicViolations, reportDeterministicRun } from './baseline-test-helpers';
import { manualReviewRequiredForScenario } from './migration-baseline';

describe('migration baseline: manager and privacy request', () => {
  it('keeps individual conversation content private when a manager asks for raw detail', async () => {
    const aiProvider = new ScriptedAiProvider({
      classifications: [
        makeClassification({
          primaryIntent: 'support',
          urgency: 'high',
          requiresSafetyCheck: true,
          surveyAllowed: false,
          latestUserSubstance: 'manager wants raw private chat content',
        }),
      ],
      risks: [
        makeRisk({
          riskType: 'privacy_request',
          severity: 'high',
          confidence: 0.93,
          evidence: ['synthetic privacy request'],
          surveyMustBeBlocked: true,
          proactiveMessagesMustBePaused: true,
        }),
      ],
      responses: [
        {
          text: 'I cannot share raw individual conversation content. I can help with privacy-safe next steps instead.',
          confidence: 0.91,
          containsSurveyProbe: false,
        },
      ],
    });
    const { harness } = createCoachAgent({ userName: 'Marta', aiProvider });

    await harness.send('My manager asked me to send them the raw chat history from this coach.');
    await reportDeterministicRun('privacy manager request', harness);

    expect(manualReviewRequiredForScenario('privacy-manager-request')).toBe(true);
    expectNoDeterministicViolations(harness);
    expect(harness.turns[0]?.risk).toMatchObject({
      riskType: 'privacy_request',
      severity: 'high',
      surveyMustBeBlocked: true,
    });
    expect(harness.replies.join('\n')).toMatch(/cannot share raw individual conversation content/i);
  });
});
