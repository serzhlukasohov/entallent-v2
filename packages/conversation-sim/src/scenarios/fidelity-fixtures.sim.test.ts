import { describe, expect, it } from 'vitest';
import { createCoachAgent } from '../harness/coach-agent';
import { countQuestions } from '../harness/assertions';
import { findReaskedQuestions, findUnstatedEmotionWords } from '../harness/fidelity-checks';
import { ScriptedAiProvider, makeClassification } from '../fakes/scripted-ai';
import { expectNoDeterministicViolations, reportDeterministicRun } from './baseline-test-helpers';
import {
  CHANGED_ADVICE_FIXTURE,
  REASKED_QUESTION_FIXTURE,
  SENTIMENT_AMPLIFICATION_FIXTURE,
  type FidelityFixture,
} from './fidelity-fixtures';

/**
 * Offline replay of the S8 fidelity fixtures (GC round 3 CAP-8 / CAP-10) through the real
 * orchestrator with scripted model output. It proves the wiring and the deterministic checks:
 * a compliant transcript passes, and the behaviour the testers reported (T9, T13) is flagged.
 * The judge-only criterion of T12 cannot be reproduced offline; its replay checks the plan only.
 */
async function replay(
  fixture: FidelityFixture,
  replies: readonly string[],
  classifications: Parameters<typeof makeClassification>[0][],
) {
  const aiProvider = new ScriptedAiProvider({
    classifications: classifications.map((overrides) => makeClassification(overrides)),
    responses: replies.map((text) => ({ text, confidence: 0.9, containsSurveyProbe: false })),
  });
  const { harness } = createCoachAgent({ userName: 'Olena', aiProvider });
  for (const text of fixture.employeeTurns) await harness.send(text);
  return harness;
}

describe('S8 fidelity fixtures (offline scripted replay)', () => {
  it('T9: a compliant transcript passes the re-ask check', async () => {
    const harness = await replay(
      REASKED_QUESTION_FIXTURE,
      [
        'A single reviewer who is out, with nobody else allowed to sign off, is a process gap rather than something you missed. Who on the security side could grant a one-off exception?',
        'Two pings to the manager and a post in the channel means the ask is already on record. What does the team need to hear from you while the wait continues?',
      ],
      [
        { dialogueAct: 'new_substance', latestUserSubstance: 'release blocked on the only security reviewer being out' },
        {
          dialogueAct: 'continuation',
          latestUserSubstance: 'already pinged the reviewer manager twice and the security channel; team restless',
          resolvedDetails: ['the blocker is the security sign-off', 'the reviewer manager and the security channel were already pinged'],
        },
      ],
    );
    await reportDeterministicRun('S8 T9 offline replay', harness);

    expectNoDeterministicViolations(harness);
    expect(findReaskedQuestions(harness.replies, REASKED_QUESTION_FIXTURE.answeredDetails)).toEqual([]);
    expect(countQuestions(harness.replies[1] ?? '')).toBe(1);
    expect(harness.responseCallsByTurn[1]?.context.replyPlan?.resolvedDetails).toHaveLength(2);
  });

  it('T9: the reported behaviour (same question in other words) is flagged', async () => {
    const harness = await replay(
      REASKED_QUESTION_FIXTURE,
      [
        // Live sample, 2026-10-17: a re-ask of "nobody else is allowed to sign off".
        'If the code has been ready since Monday, the real pinch point is the sign-off rule. Is there any backup path for security approval, or is everyone waiting on that one person to come back?',
        'Understood. Have you tried reaching out to the security team about a backup reviewer?',
      ],
      [{ dialogueAct: 'new_substance' }, { dialogueAct: 'continuation', resolvedDetails: [] }],
    );
    await reportDeterministicRun('S8 T9 offline counter-case', harness);

    const reasked = findReaskedQuestions(harness.replies, REASKED_QUESTION_FIXTURE.answeredDetails);
    expect(reasked.map((item) => item.turn)).toEqual([1, 2]);
    expect(reasked[0]?.detail).toMatch(/nobody else is allowed to sign off/);
  });

  it('T12: the pushback turn reaches reply planning with the evidence boundary', async () => {
    const harness = await replay(
      CHANGED_ADVICE_FIXTURE,
      [
        'Before the retro, I would raise it with her directly once, so the retro is not the first time she hears it.',
        'Since the direct conversation already happened and she is away until next month, I am changing my suggestion: raise it in the retro, framed as a team norm for PR descriptions rather than about her.',
      ],
      [
        { dialogueAct: 'request', latestUserSubstance: 'whether to raise the PR rewrites in the retro' },
        { dialogueAct: 'correction', latestUserSubstance: 'already had the one-on-one; teammate on leave until next month' },
      ],
    );
    await reportDeterministicRun('S8 T12 offline replay', harness);

    expectNoDeterministicViolations(harness);
    expect(countQuestions(harness.replies[1] ?? '')).toBe(0);
    const finalPlan = harness.responseCallsByTurn[1]?.context.replyPlan;
    expect(finalPlan?.dialogueAct).toBe('correction');
    expect(finalPlan?.forbiddenMoves).toContain('unsupported_interpretation');
  });

  it('T13: a neutral transcript passes the amplification check', async () => {
    const harness = await replay(
      SENTIMENT_AMPLIFICATION_FIXTURE,
      [
        'So the rotation stays as it is for another quarter and the prep is still yours. What part of it do you want to keep?',
        'A week of capacity analysis is a solid base for the next round. Which decision do you want the doc to make easier?',
      ],
      [{ dialogueAct: 'new_substance' }, { dialogueAct: 'continuation' }],
    );
    await reportDeterministicRun('S8 T13 offline replay', harness);

    expectNoDeterministicViolations(harness);
    expect(findUnstatedEmotionWords(harness.replies, SENTIMENT_AMPLIFICATION_FIXTURE.employeeTurns)).toEqual([]);
    harness.responseCallsByTurn.forEach((call) => {
      expect(call?.context.replyPlan?.forbiddenMoves).toContain('unsupported_interpretation');
    });
  });

  it('T13: the reported behaviour (added "particularly unfair") is flagged', async () => {
    const harness = await replay(
      SENTIMENT_AMPLIFICATION_FIXTURE,
      [
        'That sounds particularly unfair after the work you put in. What do you want to do with the prep?',
        'It must be frustrating, but the analysis is still valuable. Which section would you reuse first?',
      ],
      [{ dialogueAct: 'new_substance' }, { dialogueAct: 'continuation' }],
    );
    await reportDeterministicRun('S8 T13 offline counter-case', harness);

    expect(findUnstatedEmotionWords(harness.replies, SENTIMENT_AMPLIFICATION_FIXTURE.employeeTurns)).toEqual([
      { turn: 1, word: 'unfair' },
      { turn: 2, word: 'frustrating' },
    ]);
  });
});
