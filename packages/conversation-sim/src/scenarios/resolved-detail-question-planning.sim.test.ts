import { agent as agentTurn, judge, judgeAgent, run, user, userSimulatorAgent } from '@langwatch/scenario';
import { describe, expect, it } from 'vitest';
import { createCoachAgent } from '../harness/coach-agent';
import { countQuestions } from '../harness/assertions';
import { reportRun } from '../harness/report';
import { judgeModel, simulatorModel } from './config';

const USER_TURNS = [
  'Three useful calls interrupted my analysis. Nobody was waiting on me afterward; I just lost about twenty minutes rebuilding the context each time.',
  'The second call hit while I was halfway through mapping a payment exception, and I had to reconstruct the whole flow. The calls themselves were useful.',
  "That live payment issue needed me then, and I don't regret joining. I'm just venting about losing my place in the analysis.",
] as const;

describe('resolved-detail question planning', () => {
  it('does not reopen a clarification branch the employee already resolved', async () => {
    const { agent, harness } = createCoachAgent({ userName: 'Ed' });
    const result = await run({
      name: 'D04-03 resolved-detail replay',
      description:
        'Evaluate only the final coach reply after the third employee turn. Earlier questions occur before the exact whole-flow detail is established and do not decide this verdict. The final coach reply must not reopen reconstructing the flow versus remembering where work stopped.',
      agents: [
        agent,
        userSimulatorAgent({ model: simulatorModel() }),
        judgeAgent({
          model: judgeModel(),
          criteria: [
            'Evaluate only the final coach reply after the third employee turn; ignore earlier coach questions for this verdict',
            'The final coach reply treats reconstructing the whole flow as already established',
            'The final coach reply does not ask whether the difficulty was rebuilding context or remembering the stopping point',
            'Any final question asks about a materially new uncertainty; ending without a question is also acceptable',
          ],
        }),
      ],
      script: [
        ...USER_TURNS.flatMap((text) => [user(text), agentTurn()]),
        judge(),
      ],
      maxTurns: 10,
      langwatch: { apiKey: '' },
    });

    const finalPlan = harness.generateResponseCalls[2]?.context.replyPlan;
    expect(finalPlan?.resolvedDetails, JSON.stringify(harness.turns[2]?.classification)).toEqual(expect.arrayContaining([
      expect.stringMatching(/reconstruct|rebuild/i),
    ]));
    expect(finalPlan?.questionPolicy.maxQuestions).toBe(1);

    const finalReply = harness.replies[2] ?? '';
    const finalQuestions = finalReply
      .split(/(?<=\?)/u)
      .filter((sentence) => sentence.includes('?'))
      .join(' ');
    expect(countQuestions(finalReply)).toBeLessThanOrEqual(1);
    expect(finalQuestions).not.toMatch(/reconstruct|rebuild|whole flow|where (?:you|they) (?:stopped|left off)|losing your place/i);
    expect(result.success, result.reasoning).toBe(true);

    await reportRun('D04-03 resolved-detail replay', harness, result);
  });

  it('keeps one neutral question available when no clarification branch is resolved', async () => {
    const { agent, harness } = createCoachAgent({ userName: 'Ed' });
    await run({
      name: 'CAP-6 unresolved-detail control',
      description: 'An ambiguous employee statement must keep one neutral clarification available.',
      agents: [agent, userSimulatorAgent({ model: simulatorModel() })],
      script: [user('My lead just said fine, and I am not sure what they meant.'), agentTurn()],
      maxTurns: 3,
      langwatch: { apiKey: '' },
    });

    const plan = harness.generateResponseCalls[0]?.context.replyPlan;
    expect(plan?.resolvedDetails ?? []).toEqual([]);
    expect(plan?.questionPolicy.maxQuestions).toBe(1);
    expect(countQuestions(harness.replies[0] ?? '')).toBe(1);
  });
});
